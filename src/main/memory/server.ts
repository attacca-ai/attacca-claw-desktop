import { createServer, type Server } from 'http'
import { randomUUID } from 'crypto'
import { searchMemories, searchMemoriesByKeyword } from './search'
import { insertMemory, getMemoryStats, getIdentityTraits } from './db'
import { generateEmbedding, float32ToBuffer } from './embeddings'
import { readBody, sendJson } from '../lib/http-helpers'
import { EMBEDDING_MODEL_ID } from '../lib/constants'

let server: Server | null = null
let actualPort = 3101

/** Returns the port the memory server is listening on */
export function getMemoryServerPort(): number {
  return actualPort
}

export function startMemoryServer(): Promise<number> {
  return new Promise((resolve, reject) => {
    if (server) {
      resolve(actualPort)
      return
    }

    server = createServer(async (req, res) => {
      // CORS for local access
      res.setHeader('Access-Control-Allow-Origin', '*')
      res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

      if (req.method === 'OPTIONS') {
        res.writeHead(204)
        res.end()
        return
      }

      if (req.method !== 'POST') {
        sendJson(res, 405, { success: false, error: 'Method not allowed' })
        return
      }

      try {
        const body = JSON.parse(await readBody(req)) as Record<string, unknown>

        if (req.url === '/search') {
          const query = body.query as string
          if (!query) {
            sendJson(res, 400, { success: false, error: 'Missing query' })
            return
          }

          console.log(`[memory-server] ▶ Search: "${query.slice(0, 100)}"`)

          // Semantic search + keyword supplement for memories without embeddings yet
          const queryEmb = await generateEmbedding(query)
          let results = queryEmb ? searchMemories(queryEmb) : searchMemoriesByKeyword(query)

          // Always merge keyword results (catches memories with pending embeddings)
          if (queryEmb) {
            const kw = searchMemoriesByKeyword(query)
            const seen = new Set(results.map((r) => r.id))
            for (const r of kw) {
              if (!seen.has(r.id)) results.push(r)
            }
            results = results.slice(0, 5)
          }

          console.log(`[memory-server] ✓ Search returned ${results.length} results`)
          sendJson(res, 200, { success: true, results })
          return
        }

        if (req.url === '/save') {
          const content = body.content as string
          const VALID_TYPES = ['capture', 'preference', 'decision', 'identity', 'synthesis']
          const rawType = (body.type as string) || 'preference'
          const type = VALID_TYPES.includes(rawType) ? rawType : 'capture'
          const summary = (body.summary as string) || content.slice(0, 200)
          const tags = (body.tags as string[]) || []

          if (!content) {
            sendJson(res, 400, { success: false, error: 'Missing content' })
            return
          }

          console.log(`[memory-server] ▶ Save: type=${type} summary="${summary.slice(0, 80)}"`)

          const id = `mem_${randomUUID()}`
          const embedding = await generateEmbedding(`${summary}\n${content}`)

          insertMemory({
            id,
            type: type as 'capture' | 'preference' | 'decision' | 'identity' | 'synthesis',
            content,
            summary,
            embedding: embedding ? float32ToBuffer(embedding) : null,
            source_id: (body.source_id as string) || null,
            tags: JSON.stringify(tags),
            importance: (body.importance as number) ?? 0.5,
            created_at: Date.now(),
            superseded_by: null
          })

          console.log(`[memory-server] ✓ Saved memory ${id}`)
          sendJson(res, 200, { success: true, id })
          return
        }

        if (req.url === '/stats') {
          sendJson(res, 200, { success: true, ...getMemoryStats() })
          return
        }

        if (req.url === '/identity') {
          const traits = getIdentityTraits()
          sendJson(res, 200, {
            success: true,
            traits: traits.map((t) => ({ key: t.key, value: t.value, confidence: t.confidence }))
          })
          return
        }

        // OpenAI-compatible embeddings endpoint for OpenClaw native memory search
        if (req.url === '/embeddings' || req.url === '/v1/embeddings') {
          const input = body.input as string | string[]
          const texts = Array.isArray(input) ? input : [input]
          const results: Array<{ object: string; index: number; embedding: number[] }> = []

          for (let i = 0; i < texts.length; i++) {
            const emb = await generateEmbedding(texts[i])
            if (emb) {
              results.push({ object: 'embedding', index: i, embedding: Array.from(emb) })
            }
          }

          sendJson(res, 200, {
            object: 'list',
            data: results,
            model: EMBEDDING_MODEL_ID,
            usage: { prompt_tokens: 0, total_tokens: 0 }
          })
          return
        }

        sendJson(res, 404, { success: false, error: 'Not found' })
      } catch (err) {
        console.error('[memory-server] Error:', err)
        sendJson(res, 500, { success: false, error: (err as Error).message })
      }
    })

    // Use fixed port 3101 so the agent skill script can find it reliably.
    // Falls back to OS-assigned port if 3101 is taken.
    const tryPort: number = 3101
    server.listen(tryPort, '127.0.0.1', () => {
      const addr = server!.address()
      actualPort = typeof addr === 'object' && addr ? addr.port : tryPort
      console.log(`[memory] Server listening on http://127.0.0.1:${actualPort}`)
      resolve(actualPort)
    })

    server.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE' && tryPort !== 0) {
        // Port 3101 is taken — retry with OS-assigned port
        console.warn(`[memory] Port ${tryPort} in use, using random port`)
        server!.listen(0, '127.0.0.1')
      } else {
        console.error('[memory] Server error:', err)
        reject(err)
      }
    })
  })
}

export function stopMemoryServer(): void {
  if (server) {
    server.close()
    server = null
  }
}
