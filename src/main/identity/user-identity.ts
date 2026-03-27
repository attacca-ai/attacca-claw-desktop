import { createHash, randomUUID } from 'crypto'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { app } from 'electron'

interface UserIdentity {
  id: string
  createdAt: string
}

let cachedUUID: string | null = null

function getIdentityPath(): string {
  return join(app.getPath('userData'), 'user-identity.json')
}

/**
 * Returns a stable UUID for this user. Generates one on first call
 * and persists it to {userData}/user-identity.json.
 */
export function getUserUUID(): string {
  if (cachedUUID) return cachedUUID

  const identityPath = getIdentityPath()

  if (existsSync(identityPath)) {
    try {
      const data = JSON.parse(readFileSync(identityPath, 'utf-8')) as UserIdentity
      if (data.id) {
        cachedUUID = data.id
        return cachedUUID
      }
    } catch {
      // Corrupted file — regenerate
    }
  }

  const identity: UserIdentity = {
    id: randomUUID(),
    createdAt: new Date().toISOString()
  }

  const dir = dirname(identityPath)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(identityPath, JSON.stringify(identity, null, 2), 'utf-8')

  cachedUUID = identity.id
  return cachedUUID
}

/**
 * Returns a SHA-256 hash of the user UUID for anonymous telemetry.
 */
export function getAnonymousId(): string {
  return createHash('sha256').update(getUserUUID()).digest('hex')
}

/**
 * Returns a Composio entity ID derived from the user UUID.
 * Uses the same hash chain as the old relay server: SHA256("composio:" + identifier).slice(0, 32)
 */
export function getComposioEntityId(): string {
  return createHash('sha256').update(`composio:${getUserUUID()}`).digest('hex').slice(0, 32)
}
