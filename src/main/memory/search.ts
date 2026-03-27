import {
  getMemoriesWithEmbeddings,
  getMemory,
  markAccessed,
  getActiveMemories,
  type MemoryRow
} from './db'

export interface SearchResult {
  id: string
  type: string
  summary: string
  content: string
  score: number
  created_at: number
}

/** Cosine similarity between two Float32Array vectors */
function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0
  let normA = 0
  let normB = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB)
  return denom === 0 ? 0 : dot / denom
}

/** Deserialize a Buffer back into Float32Array */
function bufferToFloat32(buf: Buffer): Float32Array {
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
  return new Float32Array(ab)
}

/**
 * Search memories by semantic similarity.
 * queryEmbedding: Float32Array from the embedding endpoint.
 * Returns top-N results ranked by similarity × importance × recency boost.
 */
export function searchMemories(queryEmbedding: Float32Array, topN = 5): SearchResult[] {
  const rows = getMemoriesWithEmbeddings()
  if (rows.length === 0) return []

  const now = Date.now()
  const ONE_DAY_MS = 86400000

  const scored = rows.map((row) => {
    const embedding = bufferToFloat32(row.embedding)
    const similarity = cosineSimilarity(queryEmbedding, embedding)

    // Recency boost: memories from today get 1.2×, decays to 1.0× over 30 days
    const ageInDays = (now - row.accessed_at) / ONE_DAY_MS
    const recencyBoost = 1 + Math.max(0, 0.2 * (1 - ageInDays / 30))

    // Importance ranges 0–1, default 0.5
    const score = similarity * (0.5 + row.importance * 0.5) * recencyBoost

    return { id: row.id, score }
  })

  // Sort by score descending, take top N
  scored.sort((a, b) => b.score - a.score)
  const topIds = scored.slice(0, topN)

  // Mark as accessed (feeds importance tracking)
  markAccessed(topIds.map((r) => r.id))

  // Fetch full memory data for results
  const results: SearchResult[] = []
  for (const { id, score } of topIds) {
    const mem = getMemory(id)
    if (mem) {
      results.push({
        id: mem.id,
        type: mem.type,
        summary: mem.summary,
        content: mem.content,
        score,
        created_at: mem.created_at
      })
    }
  }

  return results
}

/**
 * Keyword fallback search (for when embeddings aren't available).
 * Simple full-text match on content and summary.
 */
export function searchMemoriesByKeyword(query: string, topN = 5): SearchResult[] {
  const all = getActiveMemories(undefined, 500)
  const lower = query.toLowerCase()
  const words = lower.split(/\s+/).filter((w) => w.length > 2)

  const scored: Array<{ mem: MemoryRow; score: number }> = []
  for (const mem of all) {
    const text = `${mem.summary} ${mem.content}`.toLowerCase()
    let matchCount = 0
    for (const word of words) {
      if (text.includes(word)) matchCount++
    }
    if (matchCount > 0) {
      scored.push({ mem, score: matchCount / words.length })
    }
  }

  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, topN).map(({ mem, score }) => ({
    id: mem.id,
    type: mem.type,
    summary: mem.summary,
    content: mem.content,
    score,
    created_at: mem.created_at
  }))
}
