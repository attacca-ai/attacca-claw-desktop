import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ApprovalDialog } from '../permissions/ApprovalDialog'
import { usePermissionStore } from '../../stores/permission-store'
import { useNotificationStore } from '../../stores/notification-store'
import { useTrustStore } from '../../stores/trust-store'
import { installMockApi, cleanupMockApi } from '../../../../../tests/helpers'

// Mock CountdownApproval to avoid rendering it in tests
vi.mock('../permissions/CountdownApproval', () => ({
  CountdownApproval: () => <div data-testid="countdown-approval">Countdown</div>
}))

describe('ApprovalDialog', () => {
  beforeEach(() => {
    installMockApi()
    usePermissionStore.setState({
      grants: new Map(),
      pendingApprovals: []
    })
    useNotificationStore.setState({
      notifications: [],
      unreadCount: 0
    })
    useTrustStore.setState({
      profile: 'cautious'
    })
  })

  afterEach(() => {
    cleanupMockApi()
  })

  it('returns null when no pending approvals', () => {
    const { container } = render(<ApprovalDialog />)
    expect(container.firstChild).toBeNull()
  })

  it('renders dialog with description when approval pending', () => {
    usePermissionStore.getState().addPendingApproval({
      actionType: 'send.email',
      toolId: 'gmail',
      tier: 'high',
      description: 'Send an email to Bob'
    })

    render(<ApprovalDialog />)
    expect(screen.getByText('Approval Required')).toBeInTheDocument()
    expect(screen.getByText('Send an email to Bob')).toBeInTheDocument()
  })

  it('shows tool ID when present', () => {
    usePermissionStore.getState().addPendingApproval({
      actionType: 'send.email',
      toolId: 'gmail',
      tier: 'high',
      description: 'Send email'
    })

    render(<ApprovalDialog />)
    expect(screen.getByText('Tool: gmail')).toBeInTheDocument()
  })

  it('shows params as JSON when present', () => {
    usePermissionStore.getState().addPendingApproval({
      actionType: 'send.email',
      toolId: 'gmail',
      tier: 'high',
      description: 'Send email',
      params: { to: 'bob@example.com', subject: 'Hello' }
    })

    render(<ApprovalDialog />)
    expect(screen.getByText(/bob@example.com/)).toBeInTheDocument()
  })

  it('shows "30-day standing approval" checkbox only for high tier', () => {
    usePermissionStore.getState().addPendingApproval({
      actionType: 'send.email',
      toolId: 'gmail',
      tier: 'high',
      description: 'Send email'
    })

    render(<ApprovalDialog />)
    expect(screen.getByText(/30-day standing approval/i)).toBeInTheDocument()
  })

  it('returns null for medium tier (dialog only shows high-risk)', () => {
    usePermissionStore.getState().addPendingApproval({
      actionType: 'draft.email',
      toolId: 'gmail',
      tier: 'medium',
      description: 'Draft email'
    })

    const { container } = render(<ApprovalDialog />)
    expect(container.firstChild).toBeNull()
  })

  it('approve click grants permission, removes from pending, adds notification', () => {
    usePermissionStore.getState().addPendingApproval({
      actionType: 'send.email',
      toolId: 'gmail',
      tier: 'high',
      description: 'Send email'
    })

    render(<ApprovalDialog />)
    fireEvent.click(screen.getByText('Approve'))

    expect(usePermissionStore.getState().pendingApprovals).toHaveLength(0)
    expect(usePermissionStore.getState().grants.has('gmail:send.email')).toBe(true)
    expect(useNotificationStore.getState().notifications).toHaveLength(1)
    expect(useNotificationStore.getState().notifications[0].title).toBe('Action Approved')
  })

  it('deny click denies permission, removes from pending, adds notification', () => {
    usePermissionStore.getState().addPendingApproval({
      actionType: 'send.email',
      toolId: 'gmail',
      tier: 'high',
      description: 'Send email'
    })

    render(<ApprovalDialog />)
    fireEvent.click(screen.getByText('Deny'))

    expect(usePermissionStore.getState().pendingApprovals).toHaveLength(0)
    expect(usePermissionStore.getState().grants.size).toBe(0)
    expect(useNotificationStore.getState().notifications).toHaveLength(1)
    expect(useNotificationStore.getState().notifications[0].title).toBe('Action Denied')
  })

  it('shows queue count when multiple approvals pending', () => {
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
    usePermissionStore.getState().addPendingApproval({
      actionType: 'post.message.channel',
      toolId: 'slack',
      tier: 'high',
      description: 'Post message'
    })

    render(<ApprovalDialog />)
    expect(screen.getByText(/2 more approval/i)).toBeInTheDocument()
  })

  it('displays correct tier label', () => {
    usePermissionStore.getState().addPendingApproval({
      actionType: 'send.email',
      toolId: 'gmail',
      tier: 'high',
      description: 'Send email'
    })

    render(<ApprovalDialog />)
    expect(screen.getByText(/High Risk/i)).toBeInTheDocument()
  })

  it('approve with standing checkbox checked grants standing permission', () => {
    usePermissionStore.getState().addPendingApproval({
      actionType: 'send.email',
      toolId: 'gmail',
      tier: 'high',
      description: 'Send email'
    })

    render(<ApprovalDialog />)
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(screen.getByText('Approve'))

    const grant = usePermissionStore.getState().grants.get('gmail:send.email')
    expect(grant).toBeDefined()
    expect(grant!.standing).toBe(true)
  })

  it('shows countdown for autonomous profile high-risk', () => {
    useTrustStore.setState({ profile: 'autonomous' })

    usePermissionStore.getState().addPendingApproval({
      actionType: 'send.email',
      toolId: 'gmail',
      tier: 'high',
      description: 'Send email'
    })

    render(<ApprovalDialog />)
    expect(screen.getByTestId('countdown-approval')).toBeInTheDocument()
  })
})
