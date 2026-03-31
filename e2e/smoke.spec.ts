import { test, expect, ElectronApplication, Page } from '@playwright/test'
import { _electron as electron } from 'playwright'

let app: ElectronApplication
let page: Page

test.beforeAll(async () => {
  const executablePath = process.env.ELECTRON_APP_PATH
  if (!executablePath) {
    throw new Error('ELECTRON_APP_PATH env var must point to the app executable')
  }

  app = await electron.launch({ executablePath })
  page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
})

test.afterAll(async () => {
  if (app) {
    // Force kill — the app has cleanup handlers (gateway, servers) that hang in CI
    const pid = app.process().pid
    try {
      await Promise.race([
        app.close(),
        new Promise((resolve) => setTimeout(resolve, 5_000))
      ])
    } catch {
      // ignore close errors
    }
    try {
      if (pid) process.kill(pid, 'SIGKILL')
    } catch {
      // already exited
    }
  }
})

test('app window exists', async () => {
  const windowCount = await app.evaluate(({ BrowserWindow }) => {
    return BrowserWindow.getAllWindows().length
  })
  expect(windowCount).toBeGreaterThan(0)
})

test('window has correct title', async () => {
  const title = await page.title()
  expect(title).toBe('Attacca')
})

test('renderer loaded React app', async () => {
  // The React root should have rendered content (either onboarding or dashboard).
  // Don't wait for specific text — IPC calls to gateway/servers may hang in CI.
  // Just verify the React app mounted and rendered something into #root.
  const rootHasContent = await page.evaluate(() => {
    const root = document.getElementById('root')
    return root !== null && root.children.length > 0
  })
  expect(rootHasContent).toBe(true)
})
