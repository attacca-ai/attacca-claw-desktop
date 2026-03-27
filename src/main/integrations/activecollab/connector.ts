import { app } from 'electron'
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'fs'
import { join } from 'path'
import { net } from 'electron'

const CONFIG_PATH = join(app.getPath('userData'), 'activecollab-config.json')

export interface ActiveCollabConfig {
  instanceUrl: string // e.g. "https://app.activecollab.com/12345" or "https://projects.mycompany.com"
  token: string
  userId: number
  email: string
  companyName?: string
  isCloud: boolean
  connectedAt: string
}

function loadConfig(): ActiveCollabConfig | null {
  if (!existsSync(CONFIG_PATH)) return null
  try {
    return JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'))
  } catch {
    return null
  }
}

function saveConfig(config: ActiveCollabConfig): void {
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8')
}

export function isConnected(): boolean {
  return loadConfig() !== null
}

export function getConfig(): ActiveCollabConfig | null {
  return loadConfig()
}

export function disconnect(): void {
  if (existsSync(CONFIG_PATH)) unlinkSync(CONFIG_PATH)
}

/**
 * Connect to ActiveCollab Cloud
 * Step 1: POST email/password to external/login -> get intent + accounts
 * Step 2: POST intent to issue-token-intent on the account URL -> get token
 */
export async function connectCloud(email: string, password: string): Promise<ActiveCollabConfig> {
  // Step 1: Login to get intent and accounts
  const loginResponse = await net.fetch('https://activecollab.com/api/v1/external/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password })
  })

  if (!loginResponse.ok) {
    const errorText = await loginResponse.text()
    throw new Error(`ActiveCollab login failed: ${errorText}`)
  }

  const loginData = (await loginResponse.json()) as {
    is_ok: boolean
    user?: {
      intent: string
      accounts?: Array<{ name: string; display_url: string; url: string; class: string }>
    }
    // 2FA flow
    intent_id?: string
    message?: string
  }

  if (!loginData.is_ok) {
    throw new Error(loginData.message || 'ActiveCollab login failed')
  }

  if (loginData.intent_id) {
    throw new Error(
      'Your account has 2FA enabled. Please disable it temporarily or use a Self-Hosted connection.'
    )
  }

  if (!loginData.user?.intent || !loginData.user?.accounts?.length) {
    throw new Error('No ActiveCollab accounts found for this email.')
  }

  const intent = loginData.user.intent
  const account = loginData.user.accounts[0]
  const accountUrl = account.url.replace(/\/$/, '')

  // Step 2: Exchange intent for a token
  const tokenResponse = await net.fetch(`${accountUrl}/api/v1/issue-token-intent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      intent,
      client_name: 'Attacca',
      client_vendor: 'Attacca AI'
    })
  })

  if (!tokenResponse.ok) {
    throw new Error(`Token issuance failed: ${await tokenResponse.text()}`)
  }

  const tokenData = (await tokenResponse.json()) as {
    is_ok: boolean
    token?: string
    logged_user_id?: number
    message?: string
  }

  if (!tokenData.is_ok || !tokenData.token) {
    throw new Error(`Token error: ${tokenData.message || 'Unknown error'}`)
  }

  const config: ActiveCollabConfig = {
    instanceUrl: accountUrl,
    token: tokenData.token,
    userId: tokenData.logged_user_id || 0,
    email,
    companyName: account.name,
    isCloud: true,
    connectedAt: new Date().toISOString()
  }

  saveConfig(config)
  return config
}

/**
 * Connect to ActiveCollab Self-Hosted
 * Direct token issuance via instance URL + credentials
 */
export async function connectSelfHosted(
  instanceUrl: string,
  email: string,
  password: string
): Promise<ActiveCollabConfig> {
  const baseUrl = instanceUrl.replace(/\/$/, '')

  const response = await net.fetch(`${baseUrl}/api/v1/issue-token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: email,
      password: password,
      client_name: 'Attacca',
      client_vendor: 'Attacca AI'
    })
  })

  if (!response.ok) {
    throw new Error(`Self-hosted connection failed: ${await response.text()}`)
  }

  const data = (await response.json()) as {
    is_ok: boolean
    token?: string
    logged_user_id?: number
    message?: string
  }

  if (!data.is_ok || !data.token) {
    throw new Error(`Authentication failed: ${data.message || 'Invalid credentials'}`)
  }

  const config: ActiveCollabConfig = {
    instanceUrl: baseUrl,
    token: data.token,
    userId: data.logged_user_id || 0,
    email,
    isCloud: false,
    connectedAt: new Date().toISOString()
  }

  saveConfig(config)
  return config
}
