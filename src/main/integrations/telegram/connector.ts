import { app, shell } from 'electron'
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'fs'
import { join } from 'path'
import crypto from 'crypto'
import { net } from 'electron'

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || ''
const BASE_URL = `https://api.telegram.org/bot${BOT_TOKEN}`
const CONFIG_PATH = join(app.getPath('userData'), 'telegram-config.json')

export interface TelegramConfig {
  chatId: number
  username?: string
  firstName?: string
  connectedAt: string
}

function loadConfig(): TelegramConfig | null {
  if (!existsSync(CONFIG_PATH)) return null
  try {
    return JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'))
  } catch {
    return null
  }
}

function saveConfig(config: TelegramConfig): void {
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8')
}

export function isConnected(): boolean {
  return loadConfig() !== null
}

export function getConfig(): TelegramConfig | null {
  return loadConfig()
}

export function disconnect(): void {
  if (existsSync(CONFIG_PATH)) unlinkSync(CONFIG_PATH)
}

export async function telegramApi(
  method: string,
  params: Record<string, unknown> = {}
): Promise<{ ok: boolean; result?: unknown; description?: string }> {
  const response = await net.fetch(`${BASE_URL}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params)
  })

  const data = (await response.json()) as { ok: boolean; result?: unknown; description?: string }
  if (!data.ok) {
    throw new Error(`Telegram API error (${method}): ${data.description}`)
  }
  return data
}

/**
 * Start the Telegram connection flow:
 * 1. Generate a 6-digit verification code
 * 2. Open a deep link to the bot with the code as a start parameter
 * 3. Poll for the user sending /start with that code
 * 4. Capture their chat_id and save it
 */
export async function startConnection(): Promise<TelegramConfig> {
  if (!BOT_TOKEN) throw new Error('TELEGRAM_BOT_TOKEN not set')

  const verificationCode = crypto.randomInt(100000, 999999).toString()

  // Get bot username
  const botInfo = (await telegramApi('getMe')) as {
    ok: boolean
    result: { username: string }
  }
  const botUsername = botInfo.result.username

  // Open Telegram deep link
  const deepLink = `https://t.me/${botUsername}?start=${verificationCode}`
  await shell.openExternal(deepLink)

  // Poll for the user's /start message with the verification code
  let lastUpdateId = 0
  const maxAttempts = 60 // Poll for 5 minutes (5-second intervals)

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 5000))

    try {
      const updates = (await telegramApi('getUpdates', {
        offset: lastUpdateId + 1,
        timeout: 3,
        allowed_updates: ['message']
      })) as {
        ok: boolean
        result: Array<{
          update_id: number
          message?: {
            text?: string
            chat: { id: number; username?: string; first_name?: string }
          }
        }>
      }

      if (!updates.result?.length) continue

      for (const update of updates.result) {
        lastUpdateId = update.update_id

        if (
          update.message?.text === `/start ${verificationCode}` ||
          update.message?.text === '/start'
        ) {
          const chat = update.message.chat
          const config: TelegramConfig = {
            chatId: chat.id,
            username: chat.username,
            firstName: chat.first_name,
            connectedAt: new Date().toISOString()
          }

          saveConfig(config)

          // Confirm to user in Telegram
          await telegramApi('sendMessage', {
            chat_id: chat.id,
            text: "Connected to Attacca!\n\nI'll send you daily summaries and task updates here.",
            disable_web_page_preview: true
          })

          return config
        }
      }
    } catch (err) {
      console.warn('[Telegram] Polling error:', err)
    }
  }

  throw new Error('Telegram connection timed out. The user did not open the bot within 5 minutes.')
}
