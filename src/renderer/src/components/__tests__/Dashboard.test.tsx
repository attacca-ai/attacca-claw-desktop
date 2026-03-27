import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { Dashboard } from '../dashboard/Dashboard'
import { useGatewayStore } from '../../stores/gateway-store'
import { useAgentStore } from '../../stores/agent-store'

// Mock child components to isolate Dashboard tests
vi.mock('../dashboard/LandscapeView', () => ({
  LandscapeView: () => <div data-testid="landscape-view">LandscapeView</div>
}))
vi.mock('../dashboard/CapturePanel', () => ({
  CapturePanel: () => <div data-testid="capture-panel">CapturePanel</div>
}))
vi.mock('@/components/shared/UsageLimitBanner', () => ({
  UsageLimitBanner: () => <div data-testid="usage-limit-banner" />
}))
// ApprovalDialog was moved to AppShell for global coverage

// Mock gateway client
const mockOn = vi.fn()
const mockOff = vi.fn()

vi.mock('@/lib/gateway-client', () => ({
  gatewayClient: {
    on: (...args: unknown[]) => mockOn(...args),
    off: (...args: unknown[]) => mockOff(...args)
  }
}))

describe('Dashboard', () => {
  beforeEach(() => {
    useGatewayStore.setState({
      connectionState: 'disconnected',
      processState: null,
      health: null
    })
    useAgentStore.setState({
      currentTask: null,
      taskQueue: [],
      activityFeed: [],
      isProcessing: false,
      morningBriefing: null,
      briefingDate: null
    })
    mockOn.mockClear()
    mockOff.mockClear()
  })

  afterEach(() => {
    cleanup()
  })

  it('renders landscape view and capture panel', () => {
    render(<Dashboard />)
    expect(screen.getByTestId('landscape-view')).toBeInTheDocument()
    expect(screen.getByTestId('capture-panel')).toBeInTheDocument()
  })

  it('subscribes to gateway wildcard events when connected', () => {
    useGatewayStore.setState({ connectionState: 'connected' })
    render(<Dashboard />)

    expect(mockOn).toHaveBeenCalledWith('*', expect.any(Function))
  })

  it('does not subscribe when disconnected', () => {
    useGatewayStore.setState({ connectionState: 'disconnected' })
    render(<Dashboard />)

    expect(mockOn).not.toHaveBeenCalled()
  })

  it('unsubscribes on unmount', () => {
    useGatewayStore.setState({ connectionState: 'connected' })
    const { unmount } = render(<Dashboard />)

    unmount()
    expect(mockOff).toHaveBeenCalledWith('*', expect.any(Function))
  })

  it('maps agent lifecycle start to info activity', () => {
    useGatewayStore.setState({ connectionState: 'connected' })
    render(<Dashboard />)

    const handler = mockOn.mock.calls.find((c: unknown[]) => c[0] === '*')![1] as (
      event: Record<string, unknown>
    ) => void
    handler({
      type: 'event',
      event: 'agent',
      payload: {
        stream: 'lifecycle',
        data: { phase: 'start' },
        runId: 'r1',
        seq: 1,
        ts: Date.now()
      }
    })

    const activity = useAgentStore.getState().activityFeed
    expect(
      activity.some((a) => a.type === 'info' && a.description.includes('started processing'))
    ).toBe(true)
  })

  it('maps agent tool start to tool_call activity', () => {
    useGatewayStore.setState({ connectionState: 'connected' })
    render(<Dashboard />)

    const handler = mockOn.mock.calls.find((c: unknown[]) => c[0] === '*')![1] as (
      event: Record<string, unknown>
    ) => void
    handler({
      type: 'event',
      event: 'agent',
      payload: {
        stream: 'tool',
        data: { phase: 'start', name: 'read_file', args: { path: '/tmp/x' } },
        runId: 'r1',
        seq: 2,
        ts: Date.now()
      }
    })

    const activity = useAgentStore.getState().activityFeed
    expect(
      activity.some((a) => a.type === 'tool_call' && a.description.includes('read_file'))
    ).toBe(true)
  })

  it('maps agent tool end to tool_result activity', () => {
    useGatewayStore.setState({ connectionState: 'connected' })
    render(<Dashboard />)

    const handler = mockOn.mock.calls.find((c: unknown[]) => c[0] === '*')![1] as (
      event: Record<string, unknown>
    ) => void
    handler({
      type: 'event',
      event: 'agent',
      payload: {
        stream: 'tool',
        data: { phase: 'end', name: 'read_file', result: 'file contents' },
        runId: 'r1',
        seq: 3,
        ts: Date.now()
      }
    })

    const activity = useAgentStore.getState().activityFeed
    expect(activity.some((a) => a.type === 'tool_result')).toBe(true)
  })

  it('maps chat final state to message activity', () => {
    useGatewayStore.setState({ connectionState: 'connected' })
    render(<Dashboard />)

    const handler = mockOn.mock.calls.find((c: unknown[]) => c[0] === '*')![1] as (
      event: Record<string, unknown>
    ) => void
    handler({
      type: 'event',
      event: 'chat',
      payload: {
        state: 'final',
        runId: 'r1',
        seq: 4,
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'Hello from agent' }],
          timestamp: Date.now()
        }
      }
    })

    const activity = useAgentStore.getState().activityFeed
    expect(activity.some((a) => a.type === 'message' && a.description === 'Hello from agent')).toBe(
      true
    )
  })

  it('maps agent lifecycle error to error activity', () => {
    useGatewayStore.setState({ connectionState: 'connected' })
    render(<Dashboard />)

    const handler = mockOn.mock.calls.find((c: unknown[]) => c[0] === '*')![1] as (
      event: Record<string, unknown>
    ) => void
    handler({
      type: 'event',
      event: 'agent',
      payload: {
        stream: 'lifecycle',
        data: { phase: 'error', error: 'Something failed' },
        runId: 'r1',
        seq: 5,
        ts: Date.now()
      }
    })

    const activity = useAgentStore.getState().activityFeed
    expect(activity.some((a) => a.type === 'error' && a.description === 'Something failed')).toBe(
      true
    )
  })
})
