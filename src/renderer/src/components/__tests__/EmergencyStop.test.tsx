import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { EmergencyStop } from '../dashboard/EmergencyStop'
import { useAgentStore } from '../../stores/agent-store'
import { useGatewayStore } from '../../stores/gateway-store'
import { installMockApi, cleanupMockApi } from '../../../../../tests/helpers'

// Mock gateway client module
const mockRpc = vi.fn().mockResolvedValue(undefined)

vi.mock('@/lib/gateway-client', () => ({
  gatewayClient: {
    rpc: (...args: unknown[]) => mockRpc(...args)
  }
}))

describe('EmergencyStop', () => {
  beforeEach(() => {
    installMockApi()
    vi.useFakeTimers()
    useAgentStore.setState({
      currentTask: null,
      taskQueue: [],
      activityFeed: [],
      isProcessing: false,
      usageLimitReached: false,
      morningBriefing: null,
      briefingDate: null
    })
    useGatewayStore.setState({ connectionState: 'connected' })
    mockRpc.mockClear()
  })

  afterEach(() => {
    vi.useRealTimers()
    cleanupMockApi()
  })

  it('shows "Emergency Stop" text initially', () => {
    render(<EmergencyStop />)
    expect(screen.getByText('Emergency Stop')).toBeInTheDocument()
  })

  it('first click shows CONFIRM text', () => {
    render(<EmergencyStop />)
    fireEvent.click(screen.getByRole('button'))

    expect(screen.getByText(/CONFIRM/i)).toBeInTheDocument()
  })

  it('second click executes emergencyStop and sends RPC', async () => {
    render(<EmergencyStop />)

    // First click
    fireEvent.click(screen.getByRole('button'))
    // Second click
    fireEvent.click(screen.getByRole('button'))

    expect(useAgentStore.getState().currentTask).toBeNull()
    expect(useAgentStore.getState().isProcessing).toBe(false)
    expect(mockRpc).toHaveBeenCalledWith('agent.stop')
  })

  it('auto-resets confirmation after 3 seconds', () => {
    render(<EmergencyStop />)
    fireEvent.click(screen.getByRole('button'))

    expect(screen.getByText(/CONFIRM/i)).toBeInTheDocument()

    act(() => {
      vi.advanceTimersByTime(3001)
    })

    expect(screen.getByText('Emergency Stop')).toBeInTheDocument()
  })

  it('sends RPC only when gateway is connected', () => {
    useGatewayStore.setState({ connectionState: 'connected' })
    render(<EmergencyStop />)

    fireEvent.click(screen.getByRole('button'))
    fireEvent.click(screen.getByRole('button'))

    expect(mockRpc).toHaveBeenCalledWith('agent.stop')
  })

  it('does not send RPC when disconnected', () => {
    useGatewayStore.setState({ connectionState: 'disconnected' })
    render(<EmergencyStop />)

    fireEvent.click(screen.getByRole('button'))
    fireEvent.click(screen.getByRole('button'))

    expect(mockRpc).not.toHaveBeenCalled()
  })

  it('resets confirming state after executing stop', () => {
    render(<EmergencyStop />)
    fireEvent.click(screen.getByRole('button'))
    fireEvent.click(screen.getByRole('button'))

    expect(screen.getByText('Emergency Stop')).toBeInTheDocument()
  })
})
