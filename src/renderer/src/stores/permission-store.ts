import { create } from 'zustand'
import type { RiskTier } from '@/lib/permission-engine'
import { useTrustStore } from '@/stores/trust-store'

export interface PermissionGrant {
  toolId: string
  actionType: string
  tier: RiskTier
  grantedAt: number
  standing: boolean
  expiresAt: number | null // null = permanent for low tier
}

export interface PendingApproval {
  id: string
  actionType: string
  toolId: string
  tier: RiskTier
  description: string
  params?: Record<string, unknown>
  requestedAt: number
}

interface PermissionStore {
  grants: Map<string, PermissionGrant>
  pendingApprovals: PendingApproval[]

  grantPermission: (approval: PendingApproval, standing?: boolean) => void
  denyPermission: (approvalId: string) => void
  revokeStanding: (toolId: string, actionType: string) => void
  grantStandingApproval: (actionType: string, toolId: string) => void
  isStandingApprovalActive: (actionType: string, toolId: string) => boolean
  isApproved: (toolId: string, actionType: string, tier: RiskTier) => boolean
  addPendingApproval: (
    approval: Omit<PendingApproval, 'id' | 'requestedAt'>,
    explicitId?: string
  ) => string
  getPendingApprovals: () => PendingApproval[]
}

const STANDING_DURATION_MS = 30 * 24 * 60 * 60 * 1000 // 30 days
let approvalIdCounter = 0

function grantKey(toolId: string, actionType: string): string {
  return `${toolId}:${actionType}`
}

export const usePermissionStore = create<PermissionStore>((set, get) => ({
  grants: new Map(),
  pendingApprovals: [],

  grantPermission: (approval, standing = false) => {
    const key = grantKey(approval.toolId, approval.actionType)
    const grants = new Map(get().grants)

    grants.set(key, {
      toolId: approval.toolId,
      actionType: approval.actionType,
      tier: approval.tier,
      grantedAt: Date.now(),
      standing,
      expiresAt: standing
        ? Date.now() + STANDING_DURATION_MS
        : approval.tier === 'low'
          ? null
          : null
    })

    set({
      grants,
      pendingApprovals: get().pendingApprovals.filter((a) => a.id !== approval.id)
    })

    // Notify main process (resolves the Composio server's pending Promise)
    window.api.permission.resolve(approval.id, true, standing)

    // Emit telemetry
    const eventType = standing
      ? 'permission.standing_approval.granted'
      : `permission.${approval.tier}_risk.resolved`

    window.api.telemetry.emit(eventType, {
      actionType: approval.actionType,
      toolId: approval.toolId,
      resolution: 'approved',
      standingApproval: standing,
      time_to_response_ms: Date.now() - approval.requestedAt
    })
  },

  denyPermission: (approvalId) => {
    const approval = get().pendingApprovals.find((a) => a.id === approvalId)

    set({
      pendingApprovals: get().pendingApprovals.filter((a) => a.id !== approvalId)
    })

    // Notify main process
    window.api.permission.resolve(approvalId, false, false)

    if (approval) {
      window.api.telemetry.emit(`permission.${approval.tier}_risk.resolved`, {
        actionType: approval.actionType,
        toolId: approval.toolId,
        resolution: 'denied',
        standingApproval: false,
        time_to_response_ms: Date.now() - approval.requestedAt
      })
    }
  },

  revokeStanding: (toolId, actionType) => {
    const key = grantKey(toolId, actionType)
    const grants = new Map(get().grants)
    grants.delete(key)
    set({ grants })
  },

  grantStandingApproval: (actionType, toolId) => {
    const key = grantKey(toolId, actionType)
    const grants = new Map(get().grants)

    grants.set(key, {
      toolId,
      actionType,
      tier: 'high',
      grantedAt: Date.now(),
      standing: true,
      expiresAt: Date.now() + STANDING_DURATION_MS
    })

    set({ grants })

    window.api.telemetry.emit('permission.standing_approval.granted', {
      actionType,
      toolId
    })
  },

  isStandingApprovalActive: (actionType, toolId) => {
    const key = grantKey(toolId, actionType)
    const grant = get().grants.get(key)

    if (!grant || !grant.standing) return false

    if (grant.expiresAt && Date.now() > grant.expiresAt) {
      // Expired — clean up and emit telemetry
      const grants = new Map(get().grants)
      grants.delete(key)
      set({ grants })

      window.api.telemetry.emit('permission.standing_approval.expired', {
        actionType,
        toolId,
        durationDays: 30
      })

      return false
    }

    return true
  },

  isApproved: (toolId, actionType, tier) => {
    const key = grantKey(toolId, actionType)
    const grant = get().grants.get(key)

    if (!grant) return false

    // Check expiration
    if (grant.expiresAt && Date.now() > grant.expiresAt) {
      const grants = new Map(get().grants)
      grants.delete(key)
      set({ grants })
      return false
    }

    // Low tier: always approved after first grant
    if (tier === 'low') return true

    // Medium tier: auto-approved
    if (tier === 'medium') return true

    // High tier: only if standing approval exists
    if (tier === 'high') return grant.standing

    return false
  },

  addPendingApproval: (approval, explicitId?) => {
    const id = explicitId ?? `approval_${++approvalIdCounter}`
    const pending: PendingApproval = {
      ...approval,
      id,
      requestedAt: Date.now()
    }
    set({ pendingApprovals: [...get().pendingApprovals, pending] })

    // Emit telemetry for presentation
    window.api.telemetry.emit(`permission.${approval.tier}_risk.presented`, {
      actionType: approval.actionType,
      toolId: approval.toolId,
      trustProfile: useTrustStore.getState().profile
    })

    return id
  },

  getPendingApprovals: () => get().pendingApprovals
}))
