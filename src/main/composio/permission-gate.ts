/**
 * Permission gate for Composio tool calls.
 * Classifies actions by risk tier, checks trust profile, and gates execution
 * by sending approval requests to the renderer via IPC.
 */

import { randomUUID } from 'crypto'
import { app } from 'electron'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { getMainWindow } from '../window/main-window'

// ── Risk classification ──

type RiskTier = 'low' | 'medium' | 'high'
type TrustProfile = 'cautious' | 'balanced' | 'autonomous'

const HIGH_VERBS = ['SEND', 'DELETE', 'REMOVE', 'POST', 'CANCEL']
const LOW_VERBS = ['GET', 'LIST', 'FETCH', 'FIND', 'READ', 'SEARCH', 'CHECK', 'DISCOVER', 'COUNT']

function classifyAction(actionName: string): RiskTier {
  if (actionName === '_DISCOVER_ACTIONS') return 'low'

  const parts = actionName.toUpperCase().split('_')
  if (parts.some((p) => HIGH_VERBS.includes(p))) return 'high'
  if (parts.some((p) => LOW_VERBS.includes(p))) return 'low'
  // Everything else (CREATE, UPDATE, MODIFY, ARCHIVE, LABEL, etc.) → medium
  return 'medium'
}

function getTrustProfile(): TrustProfile {
  const filePath = join(app.getPath('userData'), 'settings.json')
  if (!existsSync(filePath)) return 'cautious'
  try {
    const settings = JSON.parse(readFileSync(filePath, 'utf-8'))
    const p = settings.trustProfile
    if (p === 'cautious' || p === 'balanced' || p === 'autonomous') return p
  } catch {
    /* use default */
  }
  return 'cautious'
}

function needsGate(tier: RiskTier, profile: TrustProfile): boolean {
  if (tier === 'low') return false
  if (tier === 'medium') return profile === 'cautious'
  return true // high always gated
}

// ── Toolkit name helper (mirrors server.ts) ──

const TOOLKIT_NAMES: Record<string, string> = {
  gmail: 'Gmail',
  googlecalendar: 'Google Calendar',
  outlook: 'Outlook',
  slack: 'Slack',
  trello: 'Trello',
  clickup: 'ClickUp',
  asana: 'Asana',
  notion: 'Notion',
  googledrive: 'Google Drive',
  onedrive: 'OneDrive',
  dropbox: 'Dropbox',
  teams: 'Teams',
  telegram: 'Telegram',
  github: 'GitHub'
}

function toolkitFromAction(actionName: string): string {
  const prefix = (actionName.split('_')[0] ?? '').toLowerCase()
  return TOOLKIT_NAMES[prefix] ?? (prefix || 'Unknown')
}

function describeAction(actionName: string): string {
  const toolkit = toolkitFromAction(actionName)
  const prefix = actionName.split('_')[0] ?? ''
  const rest = actionName.slice(prefix.length + 1)
  const readable = rest.toLowerCase().replace(/_/g, ' ')
  return `${readable.charAt(0).toUpperCase() + readable.slice(1)} (${toolkit})`
}

// ── Standing approvals (in-memory, per session) ──

const STANDING_DURATION_MS = 30 * 24 * 60 * 60 * 1000
const standingApprovals = new Map<string, number>() // actionName → expiresAt

function hasStandingApproval(actionName: string): boolean {
  const expires = standingApprovals.get(actionName)
  if (!expires) return false
  if (Date.now() > expires) {
    standingApprovals.delete(actionName)
    return false
  }
  return true
}

// ── Pending requests ──

const GATE_TIMEOUT_MS = 5 * 60 * 1000 // 5 minutes
const pendingRequests = new Map<
  string,
  { resolve: (approved: boolean) => void; timeout: ReturnType<typeof setTimeout> }
>()

/**
 * Called by the IPC handler when the renderer resolves a permission request.
 */
export function resolvePermission(requestId: string, approved: boolean, standing: boolean): void {
  const pending = pendingRequests.get(requestId)
  if (!pending) return
  clearTimeout(pending.timeout)
  pendingRequests.delete(requestId)

  // Store standing approval if granted
  if (approved && standing) {
    // Extract actionName from the request — we stored it as part of the pending info
    // Actually we don't have it here. Let's store it differently.
    // We'll handle standing in a separate map keyed by requestId → actionName
    const actionName = pendingActionNames.get(requestId)
    if (actionName) {
      standingApprovals.set(actionName, Date.now() + STANDING_DURATION_MS)
      pendingActionNames.delete(requestId)
    }
  } else {
    pendingActionNames.delete(requestId)
  }

  pending.resolve(approved)
}

// Map requestId → actionName so resolvePermission can store standing approvals
const pendingActionNames = new Map<string, string>()

/**
 * Main entry point: checks if a tool call needs user approval.
 * Returns true if approved (or no gate needed), false if denied.
 */
export async function checkPermission(
  actionName: string,
  params: Record<string, unknown>
): Promise<boolean> {
  const tier = classifyAction(actionName)
  const profile = getTrustProfile()

  if (!needsGate(tier, profile)) return true
  if (hasStandingApproval(actionName)) return true

  const mainWindow = getMainWindow()
  if (!mainWindow || mainWindow.isDestroyed()) {
    console.warn('[permission-gate] No window available — denying action')
    return false
  }

  const requestId = randomUUID()
  pendingActionNames.set(requestId, actionName)

  return new Promise<boolean>((resolve) => {
    const timeout = setTimeout(() => {
      pendingRequests.delete(requestId)
      pendingActionNames.delete(requestId)
      console.warn(`[permission-gate] Timeout for ${actionName} — denying`)
      resolve(false)
    }, GATE_TIMEOUT_MS)

    pendingRequests.set(requestId, { resolve, timeout })

    mainWindow.webContents.send('event:permission-request', {
      requestId,
      actionName,
      toolkit: toolkitFromAction(actionName),
      tier,
      description: describeAction(actionName),
      params
    })

    console.log(
      `[permission-gate] ⏳ Awaiting approval for ${actionName} (${tier} risk, ${profile} profile)`
    )
  })
}
