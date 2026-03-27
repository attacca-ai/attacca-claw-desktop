import { watch, type FSWatcher } from 'fs'
import { readFileSync, renameSync, existsSync, mkdirSync } from 'fs'
import { join, extname } from 'path'
import { getMainWindow } from '../window/main-window'

const SUPPORTED_EXTENSIONS = ['.txt', '.md', '.docx', '.pdf', '.vtt', '.srt']

let watcher: FSWatcher | null = null
let watchPath: string | null = null

export function startFolderWatch(folderPath: string): void {
  stopFolderWatch()

  if (!existsSync(folderPath)) {
    console.error('[folder-watcher] Folder does not exist:', folderPath)
    return
  }

  watchPath = folderPath
  const processedDir = join(folderPath, 'processed')
  if (!existsSync(processedDir)) {
    mkdirSync(processedDir, { recursive: true })
  }

  console.log('[folder-watcher] Watching:', folderPath)

  watcher = watch(folderPath, (eventType, filename) => {
    if (eventType !== 'rename' || !filename) return

    const ext = extname(filename).toLowerCase()
    if (!SUPPORTED_EXTENSIONS.includes(ext)) return

    const filePath = join(folderPath, filename)
    if (!existsSync(filePath)) return

    console.log('[folder-watcher] New transcript file:', filename)

    try {
      const content = readFileSync(filePath, 'utf-8')

      // Notify renderer
      const mainWindow = getMainWindow()
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('event:transcript-detected', {
          filename,
          content,
          path: filePath
        })
      }

      // Move to processed folder
      const destPath = join(processedDir, filename)
      renameSync(filePath, destPath)
      console.log('[folder-watcher] Moved to processed:', filename)
    } catch (err) {
      console.error('[folder-watcher] Error processing file:', err)
    }
  })
}

export function stopFolderWatch(): void {
  if (watcher) {
    watcher.close()
    watcher = null
    watchPath = null
    console.log('[folder-watcher] Stopped watching')
  }
}

export function getWatchPath(): string | null {
  return watchPath
}

export function isWatching(): boolean {
  return watcher !== null
}
