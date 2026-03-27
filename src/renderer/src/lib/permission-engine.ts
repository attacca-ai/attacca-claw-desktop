// Three-tier risk classification per spec RD3
// Agent can escalate but never downgrade below the static floor

export type RiskTier = 'low' | 'medium' | 'high'

// Static Risk Floor Map (v1) from spec
const RISK_FLOOR_MAP: Record<string, RiskTier> = {
  // Read operations
  'read.calendar': 'low',
  'read.email': 'low',
  'read.tasks': 'low',
  'read.files': 'low',
  'read.messages': 'low',

  // Calendar
  'create.calendar.personal': 'medium',
  'create.calendar.shared': 'high',
  'update.calendar': 'high',
  'delete.calendar': 'high',
  'reschedule.meeting': 'high',

  // Email
  'draft.email': 'medium',
  'send.email': 'high',
  'archive.email': 'medium',
  'label.email': 'medium',

  // Project Management
  'create.task': 'medium',
  'update.task': 'medium',
  'delete.task': 'high',

  // File Storage
  'upload.file': 'medium',
  'create.file': 'medium',
  'modify.file.personal': 'medium',
  'modify.file.shared': 'high',
  'delete.file': 'high',

  // Communication
  'post.message.channel': 'high',
  'post.message.dm': 'high',
  'react.message': 'low',
  'update.status': 'medium'
}

const TIER_ORDER: Record<RiskTier, number> = {
  low: 0,
  medium: 1,
  high: 2
}

export interface ActionClassification {
  actionType: string
  tier: RiskTier
  floorTier: RiskTier
  escalated: boolean
}

export function classifyAction(
  actionType: string,
  context?: { shared?: boolean; hasAttendees?: boolean }
): ActionClassification {
  // Look up floor tier
  let floorTier = RISK_FLOOR_MAP[actionType] ?? 'high' // Default to high for unknown actions

  // Context-based escalation
  let tier = floorTier

  if (context?.shared && tier !== 'high') {
    tier = 'high'
  }

  if (context?.hasAttendees && actionType.includes('calendar') && tier !== 'high') {
    tier = 'high'
  }

  return {
    actionType,
    tier,
    floorTier,
    escalated: TIER_ORDER[tier] > TIER_ORDER[floorTier]
  }
}

export function getTierColor(tier: RiskTier): string {
  switch (tier) {
    case 'low':
      return 'text-green-600 dark:text-green-400'
    case 'medium':
      return 'text-yellow-600 dark:text-yellow-400'
    case 'high':
      return 'text-red-600 dark:text-red-400'
  }
}

export function getTierBgColor(tier: RiskTier): string {
  switch (tier) {
    case 'low':
      return 'bg-green-500/10 border-green-500/30'
    case 'medium':
      return 'bg-yellow-500/10 border-yellow-500/30'
    case 'high':
      return 'bg-red-500/10 border-red-500/30'
  }
}

export function getTierLabel(tier: RiskTier): string {
  switch (tier) {
    case 'low':
      return 'Low Risk'
    case 'medium':
      return 'Medium Risk'
    case 'high':
      return 'High Risk — Requires Approval'
  }
}

// ── Trust Profile Behavior ──

import type { TrustProfile } from '@/types/trust'

export interface ActionBehavior {
  requireConfirmation?: boolean
  showNotification?: boolean
  undoAvailable?: boolean
  silentLog?: boolean
  blockingApproval?: boolean
  delayMs?: number
}

/**
 * Determines presentation behavior based on risk tier and trust profile.
 * classifyAction() always returns the same risk tier regardless of profile (never downgrades).
 * This function only affects how the action is presented to the user.
 */
export function getActionBehavior(tier: RiskTier, profile: TrustProfile): ActionBehavior {
  if (tier === 'low') {
    // Low-risk: always auto-approved
    return { silentLog: true }
  }

  if (tier === 'medium') {
    switch (profile) {
      case 'cautious':
        return { requireConfirmation: true }
      case 'balanced':
        return { showNotification: true, undoAvailable: true }
      case 'autonomous':
        return { silentLog: true }
    }
  }

  // High-risk
  switch (profile) {
    case 'cautious':
    case 'balanced':
      return { blockingApproval: true }
    case 'autonomous':
      return { delayMs: 120_000, undoAvailable: true }
  }
}
