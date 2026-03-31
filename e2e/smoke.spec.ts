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
    await app.close()
  }
})

test('app window is visible', async () => {
  const visible = await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0]
    return win?.isVisible() ?? false
  })
  expect(visible).toBe(true)
})

test('window has correct title', async () => {
  const title = await page.title()
  expect(title).toBe('Attacca')
})

test('shows onboarding wizard on first launch', async () => {
  await page.waitForSelector('text=Welcome to Attacca', { timeout: 15_000 })
  const heading = page.locator('text=Welcome to Attacca')
  await expect(heading).toBeVisible()
})

test('no critical console errors', async () => {
  const errors: string[] = []
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      errors.push(msg.text())
    }
  })

  // Wait a bit for any async errors to surface
  await page.waitForTimeout(3_000)

  const critical = errors.filter(
    (e) => !e.includes('net::ERR_') && !e.includes('favicon') && !e.includes('DevTools')
  )
  expect(critical).toEqual([])
})
