import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { usePermissionStore } from '../permission-store'
import type { PendingApproval } from '../permission-store'
import { installMockApi, cleanupMockApi } from '../../../../../tests/helpers'

describe('permission-store', () => {
  beforeEach(() => {
    installMockApi()
    usePermissionStore.setState({
      grants: new Map(),
      pendingApprovals: []
    })
    vi.useRealTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    cleanupMockApi()
  })

  it('has correct initial state', () => {
    const state = usePermissionStore.getState()
    expect(state.grants.size).toBe(0)
    expect(state.pendingApprovals).toHaveLength(0)
  })

  describe('addPendingApproval', () => {
    it('adds a pending approval with auto-generated id', () => {
      const id = usePermissionStore.getState().addPendingApproval({
        actionType: 'send.email',
        toolId: 'gmail',
        tier: 'high',
        description: 'Send an email'
      })

      expect(id).toMatch(/^approval_/)
      const approvals = usePermissionStore.getState().pendingApprovals
      expect(approvals).toHaveLength(1)
      expect(approvals[0].actionType).toBe('send.email')
      expect(approvals[0].requestedAt).toBeGreaterThan(0)
    })

    it('adds multiple approvals', () => {
      usePermissionStore.getState().addPendingApproval({
        actionType: 'send.email',
        toolId: 'gmail',
        tier: 'high',
        description: 'Send email 1'
      })
      usePermissionStore.getState().addPendingApproval({
        actionType: 'delete.file',
        toolId: 'drive',
        tier: 'high',
        description: 'Delete file'
      })

      expect(usePermissionStore.getState().pendingApprovals).toHaveLength(2)
    })
  })

  describe('getPendingApprovals', () => {
    it('returns all pending approvals', () => {
      usePermissionStore.getState().addPendingApproval({
        actionType: 'send.email',
        toolId: 'gmail',
        tier: 'high',
        description: 'Send email'
      })

      const approvals = usePermissionStore.getState().getPendingApprovals()
      expect(approvals).toHaveLength(1)
    })
  })

  describe('grantPermission', () => {
    it('adds to grants map and removes from pending', () => {
      const id = usePermissionStore.getState().addPendingApproval({
        actionType: 'send.email',
        toolId: 'gmail',
        tier: 'high',
        description: 'Send email'
      })

      const approval = usePermissionStore.getState().pendingApprovals.find((a) => a.id === id)!
      usePermissionStore.getState().grantPermission(approval)

      const state = usePermissionStore.getState()
      expect(state.pendingApprovals).toHaveLength(0)
      expect(state.grants.has('gmail:send.email')).toBe(true)
    })

    it('grants non-standing permission by default', () => {
      const id = usePermissionStore.getState().addPendingApproval({
        actionType: 'send.email',
        toolId: 'gmail',
        tier: 'high',
        description: 'Send email'
      })

      const approval = usePermissionStore.getState().pendingApprovals.find((a) => a.id === id)!
      usePermissionStore.getState().grantPermission(approval)

      const grant = usePermissionStore.getState().grants.get('gmail:send.email')!
      expect(grant.standing).toBe(false)
    })

    it('grants standing permission when requested', () => {
      const id = usePermissionStore.getState().addPendingApproval({
        actionType: 'send.email',
        toolId: 'gmail',
        tier: 'high',
        description: 'Send email'
      })

      const approval = usePermissionStore.getState().pendingApprovals.find((a) => a.id === id)!
      usePermissionStore.getState().grantPermission(approval, true)

      const grant = usePermissionStore.getState().grants.get('gmail:send.email')!
      expect(grant.standing).toBe(true)
      expect(grant.expiresAt).toBeGreaterThan(Date.now())
    })
  })

  describe('denyPermission', () => {
    it('removes from pending without granting', () => {
      const id = usePermissionStore.getState().addPendingApproval({
        actionType: 'send.email',
        toolId: 'gmail',
        tier: 'high',
        description: 'Send email'
      })

      usePermissionStore.getState().denyPermission(id)

      const state = usePermissionStore.getState()
      expect(state.pendingApprovals).toHaveLength(0)
      expect(state.grants.size).toBe(0)
    })
  })

  describe('revokeStanding', () => {
    it('removes grant by toolId and actionType', () => {
      const id = usePermissionStore.getState().addPendingApproval({
        actionType: 'send.email',
        toolId: 'gmail',
        tier: 'high',
        description: 'Send email'
      })

      const approval = usePermissionStore.getState().pendingApprovals.find((a) => a.id === id)!
      usePermissionStore.getState().grantPermission(approval, true)
      expect(usePermissionStore.getState().grants.has('gmail:send.email')).toBe(true)

      usePermissionStore.getState().revokeStanding('gmail', 'send.email')
      expect(usePermissionStore.getState().grants.has('gmail:send.email')).toBe(false)
    })
  })

  describe('isApproved', () => {
    it('returns false with no grants', () => {
      expect(usePermissionStore.getState().isApproved('gmail', 'send.email', 'high')).toBe(false)
    })

    it('returns true for low tier after grant', () => {
      const approval: PendingApproval = {
        id: 'test',
        actionType: 'read.email',
        toolId: 'gmail',
        tier: 'low',
        description: 'Read email',
        requestedAt: Date.now()
      }
      usePermissionStore.getState().grantPermission(approval)
      expect(usePermissionStore.getState().isApproved('gmail', 'read.email', 'low')).toBe(true)
    })

    it('returns true for medium tier after grant', () => {
      const approval: PendingApproval = {
        id: 'test',
        actionType: 'draft.email',
        toolId: 'gmail',
        tier: 'medium',
        description: 'Draft email',
        requestedAt: Date.now()
      }
      usePermissionStore.getState().grantPermission(approval)
      expect(usePermissionStore.getState().isApproved('gmail', 'draft.email', 'medium')).toBe(true)
    })

    it('returns false for high tier without standing', () => {
      const approval: PendingApproval = {
        id: 'test',
        actionType: 'send.email',
        toolId: 'gmail',
        tier: 'high',
        description: 'Send email',
        requestedAt: Date.now()
      }
      usePermissionStore.getState().grantPermission(approval, false)
      expect(usePermissionStore.getState().isApproved('gmail', 'send.email', 'high')).toBe(false)
    })

    it('returns true for high tier with standing', () => {
      const approval: PendingApproval = {
        id: 'test',
        actionType: 'send.email',
        toolId: 'gmail',
        tier: 'high',
        description: 'Send email',
        requestedAt: Date.now()
      }
      usePermissionStore.getState().grantPermission(approval, true)
      expect(usePermissionStore.getState().isApproved('gmail', 'send.email', 'high')).toBe(true)
    })

    it('handles expiration of standing approval', () => {
      vi.useFakeTimers()
      const now = Date.now()
      vi.setSystemTime(now)

      const approval: PendingApproval = {
        id: 'test',
        actionType: 'send.email',
        toolId: 'gmail',
        tier: 'high',
        description: 'Send email',
        requestedAt: now
      }
      usePermissionStore.getState().grantPermission(approval, true)
      expect(usePermissionStore.getState().isApproved('gmail', 'send.email', 'high')).toBe(true)

      // Advance 31 days
      vi.setSystemTime(now + 31 * 24 * 60 * 60 * 1000)
      expect(usePermissionStore.getState().isApproved('gmail', 'send.email', 'high')).toBe(false)
      // Grant should be cleaned up
      expect(usePermissionStore.getState().grants.has('gmail:send.email')).toBe(false)
    })

    it('non-expired standing approval still works', () => {
      vi.useFakeTimers()
      const now = Date.now()
      vi.setSystemTime(now)

      const approval: PendingApproval = {
        id: 'test',
        actionType: 'send.email',
        toolId: 'gmail',
        tier: 'high',
        description: 'Send email',
        requestedAt: now
      }
      usePermissionStore.getState().grantPermission(approval, true)

      // Advance 15 days (not expired)
      vi.setSystemTime(now + 15 * 24 * 60 * 60 * 1000)
      expect(usePermissionStore.getState().isApproved('gmail', 'send.email', 'high')).toBe(true)
    })
  })
})
