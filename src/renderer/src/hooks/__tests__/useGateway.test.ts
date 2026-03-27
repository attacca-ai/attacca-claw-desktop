import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useGateway } from '../useGateway'
import { useGatewayStore } from '../../stores/gateway-store'
import { installMockApi, cleanupMockApi } from '../../../../../tests/helpers'

// Mock the gateway client module
const mockOnStateChange = vi.fn().mockReturnValue(vi.fn())
const mockConnect = vi.fn()
const mockDisconnect = vi.fn()
const mockGetState = vi.fn().mockReturnValue('disconnected')

vi.mock('@/lib/gateway-client', () => ({
  gatewayClient: {
    onStateChange: (...args: unknown[]) => mockOnStateChange(...args),
    connect: (...args: unknown[]) => mockConnect(...args),
    disconnect: (...args: unknown[]) => mockDisconnect(...args),
    getState: (...args: unknown[]) => mockGetState(...args)
  }
}))

describe('useGateway', () => {
  beforeEach(() => {
    installMockApi()
    useGatewayStore.setState({
      connectionState: 'disconnected',
      processState: null,
      health: null
    })
    vi.clearAllMocks()
    mockOnStateChange.mockReturnValue(vi.fn())
  })

  afterEach(() => {
    cleanupMockApi()
  })

  it('subscribes to gatewayClient.onStateChange on mount', () => {
    renderHook(() => useGateway())
    expect(mockOnStateChange).toHaveBeenCalledWith(expect.any(Function))
  })

  it('subscribes to window.api.gateway.onStateChanged on mount', () => {
    renderHook(() => useGateway())
    expect(window.api.gateway.onStateChanged).toHaveBeenCalledWith(expect.any(Function))
  })

  it('calls window.api.gateway.status() on mount', () => {
    renderHook(() => useGateway())
    expect(window.api.gateway.status).toHaveBeenCalled()
  })

  it('connects when processState is running', async () => {
    mockGetState.mockReturnValue('disconnected')
    window.api.gateway.status = vi.fn().mockResolvedValue({
      state: 'running',
      pid: 1234,
      restartCount: 0,
      lastError: null,
      startedAt: Date.now()
    })

    renderHook(() => useGateway())

    // Wait for the async status call to resolve
    await vi.waitFor(() => {
      expect(mockConnect).toHaveBeenCalled()
    })
  })

  it('does not connect when processState is not running', async () => {
    window.api.gateway.status = vi.fn().mockResolvedValue({
      state: 'stopped',
      pid: null,
      restartCount: 0,
      lastError: null,
      startedAt: null
    })

    renderHook(() => useGateway())

    // Let async resolve
    await vi.waitFor(() => {
      expect(window.api.gateway.status).toHaveBeenCalled()
    })

    expect(mockConnect).not.toHaveBeenCalled()
  })

  it('auto-connects when onStateChanged reports running', () => {
    mockGetState.mockReturnValue('disconnected')

    // Capture the callback passed to onStateChanged
    let stateCallback: (state: Record<string, unknown>) => void
    window.api.gateway.onStateChanged = vi.fn((cb) => {
      stateCallback = cb
      return vi.fn()
    })

    renderHook(() => useGateway())

    // Simulate gateway starting
    stateCallback!({
      state: 'running',
      pid: 5678,
      restartCount: 0,
      lastError: null,
      startedAt: Date.now()
    })

    expect(mockConnect).toHaveBeenCalled()
  })

  it('cleans up subscriptions and disconnects on unmount', () => {
    const unsubStateChange = vi.fn()
    const unsubProcess = vi.fn()

    mockOnStateChange.mockReturnValue(unsubStateChange)
    window.api.gateway.onStateChanged = vi.fn().mockReturnValue(unsubProcess)

    const { unmount } = renderHook(() => useGateway())
    unmount()

    expect(unsubStateChange).toHaveBeenCalled()
    expect(unsubProcess).toHaveBeenCalled()
    expect(mockDisconnect).toHaveBeenCalled()
  })
})
