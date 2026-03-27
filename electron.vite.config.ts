import { resolve } from 'path'
import { config } from 'dotenv'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

config()

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: ['youtube-transcript'] })],
    build: {
      rollupOptions: {
        external: ['openclaw']
      }
    },
    define: {
      'process.env.DD_CLIENT_KEY': JSON.stringify(process.env.DD_CLIENT_KEY || '')
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    resolve: {
      alias: {
        '@': resolve('src/renderer/src'),
        '@renderer': resolve('src/renderer/src')
      }
    },
    plugins: [react(), tailwindcss()]
  }
})
