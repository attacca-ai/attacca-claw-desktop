import { app, BrowserWindow } from 'electron'
import { electronApp, optimizer } from '@electron-toolkit/utils'
import { createMainWindow, destroyMainWindow, getMainWindow } from './window/main-window'
import { createTray, destroyTray } from './tray/tray'
import { registerIpcHandlers } from './ipc/handlers'
import { startGateway, stopGateway } from './gateway/lifecycle'
import { startComposioServer, stopComposioServer } from './composio/server'
import { ensureUsageTables } from './usage/tracker'
import { registerAllTasks } from './scheduler/tasks'
import { stopAll as stopScheduler } from './scheduler'
import { initTelemetryCollector, getTelemetryCollector } from './telemetry/collector'
import { getMemoryDb, closeMemoryDb } from './memory/db'
import { startMemoryServer, stopMemoryServer } from './memory/server'

// Single instance lock
const gotTheLock = app.requestSingleInstanceLock()
if (!gotTheLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const mainWindow = getMainWindow()
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.show()
      mainWindow.focus()
    }
  })

  app.whenReady().then(async () => {
    electronApp.setAppUserModelId('com.attaccaclaw.app')

    app.on('browser-window-created', (_, window) => {
      optimizer.watchWindowShortcuts(window)
    })

    // Initialize telemetry collector
    const collector = initTelemetryCollector()

    // Emit session started event
    collector.emit('app.session_started', {
      platform: process.platform,
      appVersion: app.getVersion(),
      isPackaged: app.isPackaged
    })

    // Register IPC handlers before creating windows
    registerIpcHandlers()

    // Create main window
    createMainWindow()

    // Create system tray
    createTray(() => quitApp())

    // Initialize memory database (creates tables if needed)
    getMemoryDb()

    // Start local memory server for agent skill access
    startMemoryServer()
      .then((port) => console.log(`[main] Memory server on port ${port}`))
      .catch((err) => console.error('[main] Memory server failed:', err))

    // Initialize usage tracking tables
    ensureUsageTables()

    // Register background scheduler tasks
    registerAllTasks()

    // Start local Composio server for agent tool calls
    startComposioServer()
      .then((port) => console.log(`[main] Composio server on port ${port}`))
      .catch((err) => console.error('[main] Composio server failed:', err))

    // Start OpenClaw gateway
    try {
      await startGateway()
      console.log('[main] OpenClaw gateway started')
    } catch (err) {
      console.error('[main] Failed to start OpenClaw gateway:', err)
    }
  })

  // Keep app running when all windows are closed (tray mode)
  app.on('window-all-closed', () => {
    // Don't quit — stay in tray
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow()
    }
  })
}

let isQuitting = false

async function quitApp(): Promise<void> {
  if (isQuitting) return
  isQuitting = true

  console.log('[main] Quitting application...')

  try {
    await stopGateway()
  } catch (err) {
    console.error('[main] Error stopping gateway:', err)
  }

  stopScheduler()
  stopComposioServer()
  stopMemoryServer()
  closeMemoryDb()
  destroyTray()
  destroyMainWindow()
  app.quit()
}

app.on('before-quit', async () => {
  isQuitting = true
  // Flush telemetry queue before quitting
  try {
    const collector = getTelemetryCollector()
    await collector.flush()
  } catch {
    // Best effort
  }
})
