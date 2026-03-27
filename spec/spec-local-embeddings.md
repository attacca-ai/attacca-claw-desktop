---
date: 2026-03-18
tags: [spec, attacca, embeddings, local-first, memory]
status: active
relevant-to: [attacca-claw, open-source-transition]
depends-on: [spec-attacca-claw-open-source-transition]
---

# Spec — Local Embedding Model

## 1. System Purpose

### What

Replace all remote embedding API calls (OpenAI `text-embedding-3-small`, Voyage-3-lite) with a locally-bundled transformer model (`all-MiniLM-L6-v2`) that runs on-device in the Electron main process. Semantic search works out of the box — no API key, no internet, no cost.

### Why

The open-source transition (spec 3.2.3) moves embeddings from the relay to the user's BYOK key. This spec goes further: eliminate the embedding API key requirement entirely. For an open-source app, every external dependency is friction. Users who only have an Anthropic key (no OpenAI key) currently get no semantic search at all — just keyword fallback.

### Organizational Goal

Zero-setup memory system. User installs Attacca, captures knowledge, and semantic search works immediately. No signup for a second API provider.

### Key Trade-Offs

| Trade-Off                                         | Favored Side   | Condition                                                                                              |
| ------------------------------------------------- | -------------- | ------------------------------------------------------------------------------------------------------ |
| Model quality vs zero-cost                        | Zero-cost      | all-MiniLM-L6-v2 is proven for personal knowledge retrieval. 384 dims is sufficient for <100K memories |
| App bundle size (+23MB) vs no API dependency      | Larger bundle  | 23MB is negligible for an Electron app (already ~200MB+)                                               |
| First-embed latency (~50ms/text) vs instant       | Accept latency | Embedding happens async after save — user never waits                                                  |
| Dimension migration (1536→384) vs backward compat | Migration      | No active users exist. Clean cut, no dual-dimension support                                            |

### Hard Boundaries (NEVER Cross)

1. **Embedding generation must NEVER block the UI thread.** All inference runs in the main process on a background thread (ONNX runtime handles this internally)
2. **Existing memories with NULL embeddings must still work.** Keyword fallback remains the safety net during and after migration
3. **No network calls for embeddings.** The model and its weights are bundled with the app binary. No download-on-first-use pattern
4. **OpenClaw's native memory search must also use local embeddings.** The `/memory/embeddings` endpoint (OpenAI-compatible) must serve local vectors, not proxy to OpenAI

---

## 2. Current Architecture (What Exists — Post Open-Source Transition)

### Embedding Flow (Current)

```
Capture → main/memory/server.ts → generateEmbedding()
                                        ↓
                              net.fetch("https://api.openai.com/v1/embeddings")
                                        ↓
                              User's BYOK OpenAI key (direct, no relay)
                                        ↓
                              OpenAI text-embedding-3-small (1536 dims)
                                        ↓
                              Float32Array → Buffer → SQLite BLOB
```

**Note:** The relay server was eliminated in the open-source transition. Embeddings are called directly from `src/main/memory/embeddings.ts` using the user's BYOK key. If the user only has an Anthropic key (no OpenAI), `generateEmbedding()` returns `null` and keyword fallback is used.

### Key Files

| File                            | Role                                                                                                                                                                                                           |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/main/memory/embeddings.ts` | `generateEmbedding()` — calls OpenAI directly with BYOK key, returns `Float32Array \| null`. Returns `null` if no OpenAI key.                                                                                  |
| `src/main/memory/search.ts`     | `searchMemories()` — cosine similarity over stored embeddings. `searchMemoriesByKeyword()` — fallback                                                                                                          |
| `src/main/memory/server.ts`     | HTTP server (port 3101) — `/search`, `/save`, `/stats`, `/identity`, `/embeddings`, `/v1/embeddings` endpoints. The `/v1/embeddings` route serves OpenAI-compatible vectors for OpenClaw native memory search. |
| `src/main/memory/db.ts`         | `embedding BLOB` column — stores raw Float32Array bytes. `getMemoriesWithEmbeddings()` — fetches all vectors. Also has `identity`, `synthesis_log` tables.                                                     |
| `src/main/gateway/config.ts`    | `ensureRelayProviderConfig()` — writes `memorySearch.remote.baseUrl` pointing to local memory server (`localhost:3101`)                                                                                        |

### Dimensions

- Current: **1536** (OpenAI text-embedding-3-small) — only works if user has an OpenAI BYOK key
- No fallback: users without an OpenAI key get `null` embeddings and keyword-only search

---

## 3. Behavioral Specification

### 3.1 Bundle the Model

**Package:** `@xenova/transformers` (now `@huggingface/transformers` v3+)

**Model:** `Xenova/all-MiniLM-L6-v2` — 23MB ONNX weights, 384-dimension output, optimized for semantic similarity.

**Install:**

```bash
npm install @huggingface/transformers
```

**Model weight caching:** On first app launch, the model downloads from HuggingFace Hub to `{userData}/attacca-models/`. Subsequent launches load from cache. If offline and no cache exists, semantic search degrades to keyword-only (same as current offline behavior).

> **Alternative (bundle in binary):** Copy ONNX weights into `resources/models/` at build time. Eliminates first-run download. Adds ~23MB to installer. Preferred for open-source release — no HuggingFace dependency at runtime.

**Decision: Bundle in binary.** Download-on-first-use adds complexity and a network dependency. The ONNX weights should be included in `resources/models/all-MiniLM-L6-v2/` and loaded from there.

**File to create:** `src/main/memory/local-embeddings.ts`

```typescript
import { pipeline, type FeatureExtractionPipeline } from '@huggingface/transformers'
import { join } from 'path'

let embedder: FeatureExtractionPipeline | null = null
let loadingPromise: Promise<FeatureExtractionPipeline> | null = null

const MODEL_ID = 'Xenova/all-MiniLM-L6-v2'
export const EMBEDDING_DIMS = 384

/**
 * Lazy-load the embedding model. First call takes ~1-2s (ONNX init).
 * Subsequent calls return the cached pipeline instantly.
 */
export async function getEmbedder(): Promise<FeatureExtractionPipeline> {
  if (embedder) return embedder
  if (loadingPromise) return loadingPromise

  loadingPromise = pipeline('feature-extraction', MODEL_ID, {
    // Load from bundled weights, not HuggingFace Hub
    local_files_only: true,
    cache_dir: getModelCacheDir()
  })

  embedder = await loadingPromise
  loadingPromise = null
  return embedder
}

/**
 * Generate a 384-dim embedding for the given text.
 * Returns null only if the model fails to load (should not happen with bundled weights).
 */
export async function generateLocalEmbedding(text: string): Promise<Float32Array | null> {
  try {
    const pipe = await getEmbedder()
    // Truncate to ~256 tokens (~1024 chars) — model max is 512 tokens
    const truncated = text.slice(0, 2048)
    const output = await pipe(truncated, { pooling: 'mean', normalize: true })
    return new Float32Array(output.data)
  } catch (err) {
    console.warn('[memory] Local embedding failed:', (err as Error).message)
    return null
  }
}

function getModelCacheDir(): string {
  // In production: bundled in app resources
  // In dev: downloaded to userData on first run
  const { app } = require('electron')
  const resourcePath = join(process.resourcesPath || '', 'models')
  const userPath = join(app.getPath('userData'), 'attacca-models')
  return require('fs').existsSync(resourcePath) ? resourcePath : userPath
}
```

### 3.2 Replace `embeddings.ts`

**File to modify:** `src/main/memory/embeddings.ts`

**Current:** Calls OpenAI `text-embedding-3-small` directly with BYOK key via `net.fetch`. Returns `null` if no OpenAI key configured.

**New:**

```typescript
import { generateLocalEmbedding, EMBEDDING_DIMS } from './local-embeddings'

export { EMBEDDING_DIMS }

/**
 * Generate an embedding vector for the given text using the local model.
 * No network calls, no API key required.
 */
export async function generateEmbedding(text: string): Promise<Float32Array | null> {
  return generateLocalEmbedding(text)
}

/** Convert Float32Array to Buffer for SQLite storage */
export function float32ToBuffer(arr: Float32Array): Buffer {
  return Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength)
}

/** Convert Buffer back to Float32Array */
export function bufferToFloat32(buf: Buffer): Buffer {
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
  return new Float32Array(ab)
}
```

**Signature is unchanged** — `generateEmbedding(text: string): Promise<Float32Array | null>`. All callers (`server.ts`, IPC handlers) work without modification.

### 3.3 Update Local Embeddings Endpoint for OpenClaw

**Context:** OpenClaw's native memory search (`memorySearch` config in `openclaw.json`) calls `POST /v1/embeddings` (OpenAI-compatible format) to get vectors for its own `.md` file indexing.

**Current:** This endpoint already exists in the local memory server (`src/main/memory/server.ts`, port 3101) — it was added during the open-source transition. It currently proxies to `generateEmbedding()` which calls OpenAI directly.

**Change:** The existing `/v1/embeddings` route in `server.ts` already has the right structure. After replacing `embeddings.ts` (step 3.2), this endpoint will automatically serve local 384-dim vectors instead of OpenAI 1536-dim vectors. No additional route changes needed.

**File to modify:** `src/main/memory/server.ts`

Add a new route handler:

```typescript
// POST /v1/embeddings — OpenAI-compatible endpoint for OpenClaw
if (req.url === '/v1/embeddings') {
  const { input } = body as { input?: string | string[] }
  if (!input) {
    sendJson(res, 400, { error: { message: 'Missing input', type: 'invalid_request_error' } })
    return
  }

  const inputs = Array.isArray(input) ? input : [input]
  const data = []

  for (let i = 0; i < inputs.length; i++) {
    const emb = await generateEmbedding(inputs[i])
    if (!emb) {
      sendJson(res, 500, { error: { message: 'Embedding failed', type: 'server_error' } })
      return
    }
    data.push({ object: 'embedding', embedding: Array.from(emb), index: i })
  }

  sendJson(res, 200, {
    object: 'list',
    data,
    model: 'all-MiniLM-L6-v2',
    usage: { prompt_tokens: 0, total_tokens: 0 }
  })
  return
}
```

**File:** `src/main/gateway/config.ts` — **Already correct.** The `memorySearch` config already points to `http://localhost:3101` (local memory server) with `apiKey: 'local'`. No changes needed here — the dimension change is transparent to OpenClaw since it re-indexes on dimension mismatch.

### 3.4 Dimension Migration

**Problem:** Existing memories have 1536-dim embeddings (from OpenAI). New embeddings are 384-dim. Cosine similarity requires matching dimensions — mixed vectors would crash or return garbage.

**Strategy: Regenerate all on upgrade.**

**File to create:** `src/main/memory/migrate-embeddings.ts`

```typescript
import { getMemoryDb } from './db'
import { generateEmbedding, float32ToBuffer, EMBEDDING_DIMS } from './embeddings'

/**
 * Regenerates all embeddings using the local model.
 * Called once on first launch after the upgrade.
 * Runs in background — does not block app startup.
 */
export async function migrateEmbeddings(): Promise<{ migrated: number; failed: number }> {
  const db = getMemoryDb()
  const rows = db
    .prepare('SELECT id, content, summary, embedding FROM memories WHERE superseded_by IS NULL')
    .all() as Array<{ id: string; content: string; summary: string; embedding: Buffer | null }>

  let migrated = 0
  let failed = 0

  for (const row of rows) {
    // Check if embedding exists and is wrong dimension
    if (row.embedding) {
      const dims = row.embedding.byteLength / 4 // Float32 = 4 bytes
      if (dims === EMBEDDING_DIMS) continue // already correct dimension
    }

    const text = `${row.summary}\n${row.content}`
    const emb = await generateEmbedding(text)
    if (emb) {
      db.prepare('UPDATE memories SET embedding = ? WHERE id = ?').run(float32ToBuffer(emb), row.id)
      migrated++
    } else {
      failed++
    }
  }

  return { migrated, failed }
}
```

**Trigger:** Add a migration check in the memory DB initialization path.

**File to modify:** `src/main/memory/db.ts`

After `initSchema()`, add a metadata table to track migration state:

```sql
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
```

In `getMemoryDb()`, after schema init:

```typescript
const migrationKey = 'embedding_dims'
const current = db.prepare('SELECT value FROM meta WHERE key = ?').get(migrationKey)
if (!current || current.value !== String(EMBEDDING_DIMS)) {
  // Trigger async migration — does not block
  import('./migrate-embeddings')
    .then((m) => m.migrateEmbeddings())
    .then((result) => {
      console.log(
        `[memory] Embedding migration: ${result.migrated} migrated, ${result.failed} failed`
      )
      db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').run(
        migrationKey,
        String(EMBEDDING_DIMS)
      )
    })
}
```

### 3.5 Build Configuration

**File to modify:** `electron.vite.config.ts` (or equivalent build config)

The ONNX model weights must be copied to the app resources during build:

```typescript
// In electron-builder config (package.json or electron-builder.yml):
{
  "extraResources": [
    {
      "from": "models/all-MiniLM-L6-v2",
      "to": "models/all-MiniLM-L6-v2"
    }
  ]
}
```

**Model download script** (dev setup):

**File to create:** `scripts/download-model.js`

```javascript
// Run during `npm install` or `npm run setup` to download ONNX weights for development
const { execSync } = require('child_process')
const { existsSync, mkdirSync } = require('fs')
const modelDir = 'models/all-MiniLM-L6-v2'
if (!existsSync(modelDir)) {
  mkdirSync(modelDir, { recursive: true })
  console.log('Downloading all-MiniLM-L6-v2 ONNX weights...')
  // huggingface-cli or manual fetch of model.onnx + tokenizer files
}
```

### 3.6 OpenClaw Regeneration

**Context:** After the open-source transition eliminates the relay, OpenClaw's `memorySearch` needs to point to the local memory server which now serves local embeddings.

**File to modify:** `src/main/gateway/config.ts` — `ensureRelayProviderConfig()` (or its post-transition successor)

The `memorySearch` config must point to the local memory server's `/v1/embeddings` path. OpenClaw will then get 384-dim vectors and index them into its own `sqlite-vec` DB. Since OpenClaw manages its own vector index, the dimension change is transparent — OpenClaw re-indexes on dimension mismatch.

---

## 4. Delegation Framework

| Decision                            | Who Decides                          | Escalation                                             |
| ----------------------------------- | ------------------------------------ | ------------------------------------------------------ |
| Model selection (all-MiniLM-L6-v2)  | Spec — locked                        | Only change if ONNX runtime incompatibility discovered |
| Bundle vs download-on-first-use     | Spec — bundle in binary              | None                                                   |
| Dimension (384)                     | Spec — locked                        | None                                                   |
| Migration strategy (regenerate all) | Spec — locked                        | None                                                   |
| `@huggingface/transformers` version | Agent — use latest stable            | If v3+ API differs from examples, adapt                |
| ONNX runtime backend (CPU vs GPU)   | Agent — CPU only                     | GPU adds complexity for minimal gain on short texts    |
| Build config (extraResources)       | Agent — follow electron-builder docs | If bundling fails on CI, flag                          |

---

## 5. Behavioral Scenarios

### Scenario 1: First Launch After Upgrade (Migration)

```
GIVEN: User has 50 memories with 1536-dim embeddings from OpenAI
WHEN: App launches with local embedding model
THEN:
  - App starts normally (migration does not block UI)
  - Background task regenerates all 50 embeddings at 384 dims
  - During migration: searches use keyword fallback for not-yet-migrated memories
  - After migration: all searches use semantic similarity
  - meta table records embedding_dims = 384
  - Console logs: "[memory] Embedding migration: 50 migrated, 0 failed"
```

### Scenario 2: New Capture (Happy Path)

```
GIVEN: Local embedding model is loaded
WHEN: User saves a capture via CaptureView
THEN:
  - Memory inserted into SQLite with summary + content
  - generateEmbedding() called with summary + content
  - 384-dim Float32Array returned in ~50ms
  - Embedding stored as BLOB (1,536 bytes = 384 × 4)
  - No network call made
```

### Scenario 3: OpenClaw Memory Search

```
GIVEN: OpenClaw indexes workspace/memory/*.md files
WHEN: Agent uses memory_search tool
THEN:
  - OpenClaw calls POST http://127.0.0.1:3101/v1/embeddings
  - Local memory server generates 384-dim vector via local model
  - Returns OpenAI-compatible response format
  - OpenClaw indexes the vector into its sqlite-vec DB
  - Hybrid BM25 + vector search works
```

### Scenario 4: No Model Weights (Corrupted Install)

```
GIVEN: Model files missing from resources/models/
WHEN: generateLocalEmbedding() is called
THEN:
  - Returns null (same as current offline behavior)
  - Console warns: "[memory] Local embedding failed: model not found"
  - All search falls back to keyword matching
  - App continues to function normally
```

### Scenario 5: User Has No OpenAI Key (Open Source User)

```
GIVEN: User only configured an Anthropic API key in the setup wizard
WHEN: User captures knowledge and searches memories
THEN:
  - Embeddings generated locally — no OpenAI key needed
  - Semantic search works immediately
  - No degradation compared to a user with an OpenAI key
```

---

## 6. Performance Targets

| Metric                   | Target  | Notes                              |
| ------------------------ | ------- | ---------------------------------- |
| Model load time (cold)   | < 2s    | First call only. ONNX session init |
| Model load time (warm)   | < 1ms   | Cached pipeline singleton          |
| Single embedding         | < 100ms | CPU inference on modern hardware   |
| Migration (100 memories) | < 15s   | Background, non-blocking           |
| Memory overhead          | < 80MB  | Model weights + ONNX runtime       |
| Bundle size increase     | ~23MB   | ONNX weights only                  |

---

## 7. Interaction with Open-Source Transition Spec

The open-source transition has been completed. The relay server was eliminated and embeddings now call OpenAI directly via the user's BYOK key. This spec **takes that further** by eliminating the OpenAI key requirement entirely — replacing remote API calls with a local transformer model.

**What the transition already did (no action needed):**

- Relay server eliminated — no `/memory/embed` or `/memory/embeddings` relay endpoints exist
- `src/main/memory/server.ts` already serves `/v1/embeddings` locally (currently calls OpenAI via BYOK)
- `src/main/gateway/config.ts` already points `memorySearch` to `localhost:3101`

**What this spec changes on top of the transition:**

- `src/main/memory/embeddings.ts` — Replace direct OpenAI BYOK calls with local model inference
- `src/main/memory/db.ts` — Add `meta` table for migration tracking
- New: `src/main/memory/local-embeddings.ts` — Local transformer model loader
- New: `src/main/memory/migrate-embeddings.ts` — Dimension migration (1536→384)

---

## 8. File Inventory

### Files to CREATE

| Path                                    | Purpose                                                  |
| --------------------------------------- | -------------------------------------------------------- |
| `src/main/memory/local-embeddings.ts`   | Local transformer model loader + inference               |
| `src/main/memory/migrate-embeddings.ts` | One-time dimension migration (1536→384)                  |
| `scripts/download-model.js`             | Dev script to download ONNX weights                      |
| `models/all-MiniLM-L6-v2/`              | Bundled ONNX weights (copied to resources at build time) |

### Files to MODIFY

| Path                            | Change                                                                                                                             |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `src/main/memory/embeddings.ts` | Replace relay call with local model call. Export `EMBEDDING_DIMS`                                                                  |
| `src/main/memory/server.ts`     | No route changes needed — `/v1/embeddings` already exists. Will automatically serve local vectors after `embeddings.ts` is updated |
| `src/main/memory/db.ts`         | Add `meta` table. Trigger migration on dimension mismatch                                                                          |
| `src/main/gateway/config.ts`    | No changes needed — already points `memorySearch` to `localhost:3101`                                                              |
| `package.json`                  | Add `@huggingface/transformers` dependency                                                                                         |
| `electron-builder` config       | Add `extraResources` for model weights                                                                                             |

### Files to DELETE

None — relay server was already eliminated in the open-source transition.

---

## 9. Implementation Order

```
1. Install @huggingface/transformers, create local-embeddings.ts, verify inference works
2. Rewrite embeddings.ts to use local model
3. Add /v1/embeddings to memory server (for OpenClaw)
4. Add meta table + migration logic to db.ts
5. Create migrate-embeddings.ts, test with existing 1536-dim data
6. Update gateway config to point memorySearch at local server
7. Update build config (extraResources, download script)
8. Test: capture → embed → search end-to-end
9. Test: OpenClaw memory_search → local embeddings → vector results
```

---

## 10. Connections

- [[spec-attacca-claw-open-source-transition]] — Supersedes section 3.2.3
- [[attacca-claw-architecture-and-roadmap]] — Phase 1 roadmap item: "Local embedding model"
- [[spec-weekly-synthesis]] — Synthesis generates new memories that need embedding
- [[spec-background-scheduler]] — Migration runs as a background task
