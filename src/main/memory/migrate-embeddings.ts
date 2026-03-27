import { getMemoryDb } from './db'
import { generateEmbedding, float32ToBuffer } from './embeddings'
import { EMBEDDING_DIMS } from '../lib/constants'

/**
 * Regenerate embeddings for memories that need it (wrong dimension or missing).
 * Used by both migration and backfill.
 */
async function processRows(
  rows: Array<{ id: string; content: string; summary: string }>
): Promise<{ success: number; failed: number }> {
  const db = getMemoryDb()
  const stmt = db.prepare('UPDATE memories SET embedding = ? WHERE id = ?')
  let success = 0
  let failed = 0

  for (const row of rows) {
    const text = `${row.summary}\n${row.content}`
    const emb = await generateEmbedding(text)
    if (emb) {
      stmt.run(float32ToBuffer(emb), row.id)
      success++
    } else {
      failed++
    }
  }

  return { success, failed }
}

/**
 * Regenerates all embeddings using the local model (384 dims).
 * Filters in SQL to avoid loading correct-dimension BLOBs into memory.
 */
export async function migrateEmbeddings(): Promise<{ migrated: number; failed: number }> {
  const db = getMemoryDb()
  const expectedBytes = EMBEDDING_DIMS * 4 // Float32 = 4 bytes per dim

  // Only fetch rows that need migration: NULL embedding or wrong dimension
  const rows = db
    .prepare(
      'SELECT id, content, summary FROM memories WHERE superseded_by IS NULL AND (embedding IS NULL OR LENGTH(embedding) != ?)'
    )
    .all(expectedBytes) as Array<{ id: string; content: string; summary: string }>

  if (rows.length === 0) return { migrated: 0, failed: 0 }

  const result = await processRows(rows)
  return { migrated: result.success, failed: result.failed }
}

/**
 * Generates embeddings for memories that were saved without them (offline captures).
 * Called periodically by the background scheduler.
 */
export async function backfillEmbeddings(): Promise<{ filled: number; failed: number }> {
  const db = getMemoryDb()
  const rows = db
    .prepare(
      'SELECT id, content, summary FROM memories WHERE embedding IS NULL AND superseded_by IS NULL'
    )
    .all() as Array<{ id: string; content: string; summary: string }>

  if (rows.length === 0) return { filled: 0, failed: 0 }

  const result = await processRows(rows)
  console.log(`[memory] Backfill: ${result.success} filled, ${result.failed} failed`)
  return { filled: result.success, failed: result.failed }
}
