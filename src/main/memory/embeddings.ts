import { generateLocalEmbedding } from './local-embeddings'
import { EMBEDDING_DIMS } from '../lib/constants'

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
export function bufferToFloat32(buf: Buffer): Float32Array {
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
  return new Float32Array(ab)
}
