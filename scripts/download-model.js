/**
 * Downloads the all-MiniLM-L6-v2 ONNX model for local embedding generation.
 * Run: node scripts/download-model.js
 *
 * In production, model weights are bundled via electron-builder extraResources.
 * This script is for development setup only.
 */

const { existsSync, mkdirSync } = require('fs')
const { join } = require('path')

const MODEL_DIR = join(__dirname, '..', 'models', 'all-MiniLM-L6-v2')

async function main() {
  if (existsSync(join(MODEL_DIR, 'onnx'))) {
    console.log('Model already downloaded at:', MODEL_DIR)
    return
  }

  console.log('Downloading all-MiniLM-L6-v2 ONNX model...')
  console.log('This will be cached by @huggingface/transformers on first app launch.')
  console.log('For development, the model downloads automatically to {userData}/attacca-models/')
  console.log('')
  console.log('To bundle for production, download the model files to:')
  console.log(`  ${MODEL_DIR}`)
  console.log('')
  console.log('Required files from https://huggingface.co/Xenova/all-MiniLM-L6-v2:')
  console.log('  - onnx/model.onnx (~23MB)')
  console.log('  - tokenizer.json')
  console.log('  - tokenizer_config.json')
  console.log('  - config.json')

  mkdirSync(MODEL_DIR, { recursive: true })
  console.log(`\nCreated directory: ${MODEL_DIR}`)
  console.log('Download model files manually or let the app download on first run.')
}

main().catch(console.error)
