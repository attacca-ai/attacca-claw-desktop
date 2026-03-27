import { describe, it, expect, beforeEach } from 'vitest'
import { useGatewayStore } from '../gateway-store'

describe('gateway-store', () => {
  beforeEach(() => {
    useGatewayStore.setState({
      connectionState: 'disconnected',
      processState: null,
      health: null
    })
  })

  it('has correct initial state', () => {
    const state = useGatewayStore.getState()
    expect(state.connectionState).toBe('disconnected')
    expect(state.processState).toBeNull()
    expect(state.health).toBeNull()
  })

  it('setConnectionState updates connection state', () => {
    useGatewayStore.getState().setConnectionState('connecting')
    expect(useGatewayStore.getState().connectionState).toBe('connecting')
  })

  it('setConnectionState to connected', () => {
    useGatewayStore.getState().setConnectionState('connected')
    expect(useGatewayStore.getState().connectionState).toBe('connected')
  })

  it('setConnectionState to error', () => {
    useGatewayStore.getState().setConnectionState('error')
    expect(useGatewayStore.getState().connectionState).toBe('error')
  })

  it('setProcessState updates process state', () => {
    const processState = {
      state: 'running' as const,
      pid: 1234,
      restartCount: 0,
      lastError: null,
      startedAt: Date.now()
    }
    useGatewayStore.getState().setProcessState(processState)
    expect(useGatewayStore.getState().processState).toEqual(processState)
  })

  it('setHealth updates health status', () => {
    const health = {
      ok: true,
      latency: 15,
      error: null,
      checkedAt: Date.now()
    }
    useGatewayStore.getState().setHealth(health)
    expect(useGatewayStore.getState().health).toEqual(health)
  })

  it('full state transition: disconnected → connecting → connected', () => {
    const store = useGatewayStore.getState()
    store.setConnectionState('connecting')
    expect(useGatewayStore.getState().connectionState).toBe('connecting')

    store.setConnectionState('connected')
    expect(useGatewayStore.getState().connectionState).toBe('connected')
  })

  it('full state transition: connected → error → disconnected', () => {
    useGatewayStore.getState().setConnectionState('connected')
    useGatewayStore.getState().setConnectionState('error')
    expect(useGatewayStore.getState().connectionState).toBe('error')

    useGatewayStore.getState().setConnectionState('disconnected')
    expect(useGatewayStore.getState().connectionState).toBe('disconnected')
  })

  it('setHealth with error', () => {
    const health = {
      ok: false,
      latency: null,
      error: 'Connection refused',
      checkedAt: Date.now()
    }
    useGatewayStore.getState().setHealth(health)
    expect(useGatewayStore.getState().health!.ok).toBe(false)
    expect(useGatewayStore.getState().health!.error).toBe('Connection refused')
  })

  it('setProcessState with error state', () => {
    const processState = {
      state: 'error' as const,
      pid: null,
      restartCount: 3,
      lastError: 'Process crashed',
      startedAt: null
    }
    useGatewayStore.getState().setProcessState(processState)
    expect(useGatewayStore.getState().processState!.state).toBe('error')
    expect(useGatewayStore.getState().processState!.lastError).toBe('Process crashed')
  })
})
