import { existsSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'
import { EMBEDDING_MODEL_ID } from '../lib/constants'

let embedder: any = null
let loadingPromise: Promise<any> | null = null

/**
 * Resolve the model cache directory.
 * Production: bundled in app resources (extraResources).
 * Development: downloaded to {userData}/attacca-models/ on first run.
 */
function getModelCacheDir(): string {
  const resourcePath = join(process.resourcesPath || '', 'models')
  if (existsSync(resourcePath)) return resourcePath
  return join(app.getPath('userData'), 'attacca-models')
}

/**
 * Lazy-load the embedding model. First call takes ~1-2s (ONNX init).
 * Subsequent calls return the cached pipeline instantly.
 */
async function getEmbedder(): Promise<any> {
  if (embedder) return embedder
  if (loadingPromise) return loadingPromise

  loadingPromise = (async () => {
    const { pipeline } = await import('@huggingface/transformers')
    const cacheDir = getModelCacheDir()
    const hasBundled = existsSync(join(cacheDir, 'onnx'))

    const pipe = await pipeline('feature-extraction', EMBEDDING_MODEL_ID, {
      // Use bundled weights if available, otherwise download from HuggingFace Hub
      ...(hasBundled
        ? { local_files_only: true, cache_dir: cacheDir }
        : { cache_dir: getModelCacheDir() }),
      dtype: 'fp32'
    })
    return pipe
  })()

  embedder = await loadingPromise
  loadingPromise = null
  return embedder
}

/**
 * Generate a 384-dim embedding for the given text using the local model.
 * Returns null only if the model fails to load.
 */
export async function generateLocalEmbedding(text: string): Promise<Float32Array | null> {
  try {
    const pipe = await getEmbedder()
    // Truncate to ~256 tokens (~2048 chars) — model max is 512 tokens
    const truncated = text.slice(0, 2048)
    const output = await pipe(truncated, { pooling: 'mean', normalize: true })
    return new Float32Array(output.data)
  } catch (err) {
    console.warn('[memory] Local embedding failed:', (err as Error).message)
    return null
  }
}
