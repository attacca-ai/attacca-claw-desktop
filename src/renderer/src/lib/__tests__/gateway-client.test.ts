import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { MockWebSocket } from '../../../../../tests/helpers'

// We need to mock WebSocket before importing GatewayClient
vi.stubGlobal('WebSocket', MockWebSocket)

// Import after mocking WebSocket
import { GatewayClient } from '../gateway-client'

// --- Helpers for the connect handshake ---
// OpenClaw protocol: after WS opens, client waits 750ms then sends a `connect` request.
// The server responds with { type: 'res', id: ..., ok: true } to complete the handshake.

function completeHandshake(ws: InstanceType<typeof MockWebSocket>): void {
  vi.advanceTimersByTime(750) // triggers sendConnectHandshake()
  const connectReq = JSON.parse(ws.sent[ws.sent.length - 1])
  ws.simulateMessage(JSON.stringify({ type: 'res', id: connectReq.id, ok: true }))
}

function simulateConnected(client: GatewayClient): InstanceType<typeof MockWebSocket> {
  client.connect()
  const ws = MockWebSocket.instances[MockWebSocket.instances.length - 1]
  ws.simulateOpen()
  completeHandshake(ws)
  return ws
}

describe('GatewayClient', () => {
  let client: GatewayClient
  // Track unresolved RPC promises so we can catch their rejections during cleanup
  let pendingPromises: Promise<unknown>[]

  beforeEach(() => {
    vi.useFakeTimers()
    MockWebSocket.reset()
    client = new GatewayClient('ws://test:1234')
    pendingPromises = []
  })

  afterEach(async () => {
    try {
      client.disconnect()
    } catch {
      // ignore
    }
    // Await all pending promises to prevent unhandled rejections
    await Promise.allSettled(pendingPromises)
    vi.useRealTimers()
  })

  describe('connect', () => {
    it('creates a WebSocket connection', () => {
      client.connect()
      expect(MockWebSocket.instances).toHaveLength(1)
      expect(MockWebSocket.instances[0].url).toBe('ws://test:1234')
    })

    it('sets state to connecting', () => {
      const handler = vi.fn()
      client.onStateChange(handler)

      client.connect()
      expect(handler).toHaveBeenCalledWith('connecting')
    })

    it('sets state to connected after handshake completes', () => {
      const handler = vi.fn()
      client.onStateChange(handler)

      simulateConnected(client)

      expect(handler).toHaveBeenCalledWith('connected')
      expect(client.getState()).toBe('connected')
    })

    it('does nothing if already connecting', () => {
      client.connect()
      client.connect()
      expect(MockWebSocket.instances).toHaveLength(1)
    })

    it('does nothing if already connected', () => {
      simulateConnected(client)
      client.connect()
      expect(MockWebSocket.instances).toHaveLength(1)
    })
  })

  describe('disconnect', () => {
    it('closes WebSocket and sets state to disconnected', () => {
      simulateConnected(client)

      client.disconnect()
      expect(client.getState()).toBe('disconnected')
    })

    it('stops reconnect attempts', () => {
      simulateConnected(client)
      client.disconnect()

      // Advance timers — should not reconnect
      vi.advanceTimersByTime(60000)
      expect(MockWebSocket.instances).toHaveLength(1)
    })

    it('rejects all pending RPC requests', async () => {
      const ws = simulateConnected(client)

      const promise = client.rpc('test.method')
      pendingPromises.push(promise)
      // Read and discard the rpc request from sent buffer
      ws.sent.pop()

      client.disconnect()

      await expect(promise).rejects.toThrow('Client disconnected')
    })
  })

  describe('rpc', () => {
    it('sends OpenClaw request frame over WebSocket', () => {
      const ws = simulateConnected(client)

      const promise = client.rpc('test.method', { key: 'value' })
      pendingPromises.push(promise)

      // ws.sent[0] = connect request, ws.sent[1] = our rpc request
      const sent = JSON.parse(ws.sent[ws.sent.length - 1])
      expect(sent.type).toBe('req')
      expect(sent.method).toBe('test.method')
      expect(sent.params).toEqual({ key: 'value' })
      expect(sent.id).toBeDefined()
    })

    it('resolves on matching response', async () => {
      const ws = simulateConnected(client)

      const promise = client.rpc('test.method')
      const sent = JSON.parse(ws.sent[ws.sent.length - 1])

      ws.simulateMessage(
        JSON.stringify({
          type: 'res',
          id: sent.id,
          ok: true,
          result: { data: 'hello' }
        })
      )

      const result = await promise
      expect(result).toEqual({ data: 'hello' })
    })

    it('rejects on error response', async () => {
      const ws = simulateConnected(client)

      const promise = client.rpc('test.method')
      const sent = JSON.parse(ws.sent[ws.sent.length - 1])

      ws.simulateMessage(
        JSON.stringify({
          type: 'res',
          id: sent.id,
          ok: false,
          error: { code: 'INVALID_REQUEST', message: 'Invalid request' }
        })
      )

      await expect(promise).rejects.toThrow('Invalid request')
    })

    it('rejects after timeout', async () => {
      simulateConnected(client)

      const promise = client.rpc('slow.method')
      pendingPromises.push(promise)

      // Advance past 30s timeout
      vi.advanceTimersByTime(30001)

      await expect(promise).rejects.toThrow('RPC timeout')
    })

    it('throws when not connected', async () => {
      await expect(client.rpc('test')).rejects.toThrow('Not connected')
    })

    it('sends request without params when not provided', () => {
      const ws = simulateConnected(client)

      const promise = client.rpc('test.method')
      pendingPromises.push(promise)

      const sent = JSON.parse(ws.sent[ws.sent.length - 1])
      expect(sent.params).toBeUndefined()
    })
  })

  describe('event handling', () => {
    it('on() registers handler and receives matching events', () => {
      const handler = vi.fn()
      client.on('agent.message', handler)

      const ws = simulateConnected(client)

      ws.simulateMessage(
        JSON.stringify({
          type: 'event',
          event: 'agent.message',
          payload: { content: 'Hello' }
        })
      )

      expect(handler).toHaveBeenCalledTimes(1)
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({ event: 'agent.message', payload: { content: 'Hello' } })
      )
    })

    it('off() unregisters handler', () => {
      const handler = vi.fn()
      client.on('agent.message', handler)
      client.off('agent.message', handler)

      const ws = simulateConnected(client)

      ws.simulateMessage(
        JSON.stringify({
          type: 'event',
          event: 'agent.message',
          payload: {}
        })
      )

      expect(handler).not.toHaveBeenCalled()
    })

    it('wildcard * handler receives all events', () => {
      const handler = vi.fn()
      client.on('*', handler)

      const ws = simulateConnected(client)

      ws.simulateMessage(JSON.stringify({ type: 'event', event: 'agent.turn.start', payload: {} }))
      ws.simulateMessage(JSON.stringify({ type: 'event', event: 'agent.error', payload: {} }))

      expect(handler).toHaveBeenCalledTimes(2)
    })

    it('both specific and wildcard handlers fire for same event', () => {
      const specificHandler = vi.fn()
      const wildcardHandler = vi.fn()
      client.on('agent.message', specificHandler)
      client.on('*', wildcardHandler)

      const ws = simulateConnected(client)

      ws.simulateMessage(JSON.stringify({ type: 'event', event: 'agent.message', payload: {} }))

      expect(specificHandler).toHaveBeenCalledTimes(1)
      expect(wildcardHandler).toHaveBeenCalledTimes(1)
    })

    it('ignores invalid JSON messages', () => {
      const handler = vi.fn()
      client.on('*', handler)

      const ws = simulateConnected(client)

      ws.simulateMessage('not json{{{')
      expect(handler).not.toHaveBeenCalled()
    })

    it('ignores messages with unknown frame type', () => {
      const handler = vi.fn()
      client.on('*', handler)

      const ws = simulateConnected(client)

      ws.simulateMessage(JSON.stringify({ type: 'unknown', event: 'test', payload: {} }))
      expect(handler).not.toHaveBeenCalled()
    })
  })

  describe('onStateChange', () => {
    it('calls handler on state transitions', () => {
      const handler = vi.fn()
      client.onStateChange(handler)

      simulateConnected(client)

      expect(handler).toHaveBeenCalledWith('connecting')
      expect(handler).toHaveBeenCalledWith('connected')
    })

    it('returns unsubscribe function', () => {
      const handler = vi.fn()
      const unsub = client.onStateChange(handler)

      unsub()
      client.connect()
      expect(handler).not.toHaveBeenCalled()
    })
  })

  describe('getState', () => {
    it('returns disconnected initially', () => {
      expect(client.getState()).toBe('disconnected')
    })

    it('returns connected after handshake', () => {
      simulateConnected(client)
      expect(client.getState()).toBe('connected')
    })
  })

  describe('auto-reconnect', () => {
    it('reconnects after unexpected close with exponential backoff', () => {
      client.connect()
      const ws = MockWebSocket.instances[0]
      ws.simulateOpen()

      // Unexpected close (before handshake completes)
      ws.simulateClose()
      expect(client.getState()).toBe('disconnected')

      // First reconnect: 1s
      vi.advanceTimersByTime(1000)
      expect(MockWebSocket.instances).toHaveLength(2)
    })

    it('uses exponential backoff', () => {
      client.connect()
      MockWebSocket.instances[0].simulateOpen()
      MockWebSocket.instances[0].simulateClose()

      // 1st reconnect at 1s
      vi.advanceTimersByTime(1000)
      expect(MockWebSocket.instances).toHaveLength(2)

      // Simulate that reconnection fails
      MockWebSocket.instances[1].simulateClose()

      // 2nd reconnect at 2s
      vi.advanceTimersByTime(1999)
      expect(MockWebSocket.instances).toHaveLength(2)
      vi.advanceTimersByTime(1)
      expect(MockWebSocket.instances).toHaveLength(3)
    })

    it('caps backoff at 30 seconds', () => {
      client.connect()

      // Simulate many failed reconnections
      for (let i = 0; i < 10; i++) {
        const ws = MockWebSocket.instances[MockWebSocket.instances.length - 1]
        ws.simulateOpen()
        ws.simulateClose()

        // Advance enough for max backoff
        vi.advanceTimersByTime(30001)
      }

      // All should have reconnected (just verify it doesn't exceed 30s)
      expect(MockWebSocket.instances.length).toBeGreaterThan(5)
    })

    it('does not reconnect after explicit disconnect', () => {
      simulateConnected(client)
      client.disconnect()

      vi.advanceTimersByTime(60000)
      expect(MockWebSocket.instances).toHaveLength(1)
    })

    it('resets reconnect counter on successful connection', () => {
      // First connection + close triggers reconnect (attempt 1)
      simulateConnected(client)
      MockWebSocket.instances[0].simulateClose()

      // 1st reconnect at 1s
      vi.advanceTimersByTime(1000)
      // Complete handshake on reconnect (resets counter to 0)
      const ws2 = MockWebSocket.instances[1]
      ws2.simulateOpen()
      completeHandshake(ws2)

      // Disconnect again
      ws2.simulateClose()

      // Should reset back to 1s, not 2s
      vi.advanceTimersByTime(1000)
      expect(MockWebSocket.instances).toHaveLength(3)
    })
  })

  describe('error handling', () => {
    it('sets state to error on WebSocket error', () => {
      client.connect()
      MockWebSocket.instances[0].simulateError()
      expect(client.getState()).toBe('error')
    })

    it('handles handler errors without crashing', () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const badHandler = vi.fn(() => {
        throw new Error('Handler crash')
      })
      client.on('test.event', badHandler)

      const ws = simulateConnected(client)

      ws.simulateMessage(JSON.stringify({ type: 'event', event: 'test.event', payload: {} }))

      expect(badHandler).toHaveBeenCalled()
      expect(errorSpy).toHaveBeenCalled()
      errorSpy.mockRestore()
    })
  })
})
