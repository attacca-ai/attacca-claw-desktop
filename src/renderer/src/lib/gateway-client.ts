import { buildRequest, parseFrame, isResponse, isEvent } from './rpc'
import type { OcResponse, OcEvent, GatewayConnectionState } from '@/types/gateway'

type EventHandler = (event: OcEvent) => void
type StateHandler = (state: GatewayConnectionState) => void

interface PendingRequest {
  resolve: (value: unknown) => void
  reject: (reason: Error) => void
  timeout: ReturnType<typeof setTimeout>
}

const DEFAULT_URL = 'ws://127.0.0.1:18789'
const RPC_TIMEOUT = 30_000
const RECONNECT_BASE = 1000
const RECONNECT_MAX = 30_000
// Matches OpenClaw's internal connectDelayMs default
const CONNECT_HANDSHAKE_DELAY_MS = 750
const PROTOCOL_VERSION = 3

export class GatewayClient {
  private ws: WebSocket | null = null
  private url: string
  private token: string | null = null
  private handshakeId: string | null = null
  private handshakeTimer: ReturnType<typeof setTimeout> | null = null
  private state: GatewayConnectionState = 'disconnected'
  private pendingRequests = new Map<string, PendingRequest>()
  private eventHandlers = new Map<string, Set<EventHandler>>()
  private stateHandlers = new Set<StateHandler>()
  private reconnectAttempt = 0
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private shouldReconnect = true

  constructor(url: string = DEFAULT_URL) {
    this.url = url
  }

  setToken(token: string): void {
    this.token = token
  }

  connect(): void {
    if (this.state === 'connecting' || this.state === 'connected') return

    this.shouldReconnect = true
    this.setState('connecting')

    try {
      // Connect with plain URL — auth token is sent via the connect handshake message
      this.ws = new WebSocket(this.url)

      this.ws.onopen = () => {
        // Schedule the connect handshake after the OpenClaw-standard delay
        this.handshakeTimer = setTimeout(() => {
          this.handshakeTimer = null
          this.sendConnectHandshake()
        }, CONNECT_HANDSHAKE_DELAY_MS)
      }

      this.ws.onmessage = (event) => {
        this.handleMessage(event.data as string)
      }

      this.ws.onclose = () => {
        this.ws = null
        this.handshakeId = null
        if (this.handshakeTimer) {
          clearTimeout(this.handshakeTimer)
          this.handshakeTimer = null
        }
        if (this.shouldReconnect) {
          this.setState('disconnected')
          this.scheduleReconnect()
        } else {
          this.setState('disconnected')
        }
      }

      this.ws.onerror = () => {
        // onclose will fire after onerror, so reconnect logic is handled there
        this.setState('error')
      }
    } catch {
      this.setState('error')
      this.scheduleReconnect()
    }
  }

  private sendConnectHandshake(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return

    const request = buildRequest('connect', {
      minProtocol: PROTOCOL_VERSION,
      maxProtocol: PROTOCOL_VERSION,
      client: {
        id: 'openclaw-control-ui',
        mode: 'backend',
        version: 'dev',
        platform: navigator.platform || 'win32'
      },
      caps: [],
      ...(this.token ? { auth: { token: this.token } } : {}),
      role: 'operator',
      scopes: ['operator.admin']
    })

    this.handshakeId = request.id
    console.log('[gateway-client] Sending connect handshake to', this.url)
    this.ws.send(JSON.stringify(request))
  }

  disconnect(): void {
    this.shouldReconnect = false
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    if (this.handshakeTimer) {
      clearTimeout(this.handshakeTimer)
      this.handshakeTimer = null
    }
    if (this.ws) {
      this.ws.close()
      this.ws = null
    }
    this.handshakeId = null
    this.rejectAllPending('Client disconnected')
    this.setState('disconnected')
  }

  async rpc<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T> {
    if (this.state !== 'connected' || !this.ws) {
      throw new Error('Not connected to gateway')
    }

    const request = buildRequest(method, params)

    return new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(request.id)
        reject(new Error(`RPC timeout: ${method} (${RPC_TIMEOUT}ms)`))
      }, RPC_TIMEOUT)

      this.pendingRequests.set(request.id, {
        resolve: resolve as (value: unknown) => void,
        reject,
        timeout
      })

      this.ws!.send(JSON.stringify(request))
    })
  }

  on(eventType: string, handler: EventHandler): void {
    if (!this.eventHandlers.has(eventType)) {
      this.eventHandlers.set(eventType, new Set())
    }
    this.eventHandlers.get(eventType)!.add(handler)
  }

  off(eventType: string, handler: EventHandler): void {
    this.eventHandlers.get(eventType)?.delete(handler)
  }

  onStateChange(handler: StateHandler): () => void {
    this.stateHandlers.add(handler)
    return () => this.stateHandlers.delete(handler)
  }

  getState(): GatewayConnectionState {
    return this.state
  }

  private handleMessage(raw: string): void {
    const frame = parseFrame(raw)
    if (!frame) return

    if (isResponse(frame)) {
      // Check if this is the connect handshake response
      if (this.handshakeId && frame.id === this.handshakeId) {
        this.handshakeId = null
        if (!frame.ok || frame.error) {
          console.error('[gateway-client] Connect handshake rejected:', frame.error?.message)
          this.ws?.close(1008, 'connect failed')
        } else {
          this.reconnectAttempt = 0
          this.setState('connected')
          console.log('[gateway-client] Authenticated and connected to', this.url)
        }
        return
      }
      this.handleResponse(frame)
    } else if (isEvent(frame)) {
      this.handleEvent(frame)
    }
  }

  private handleResponse(response: OcResponse): void {
    const pending = this.pendingRequests.get(response.id)
    if (!pending) return

    clearTimeout(pending.timeout)
    this.pendingRequests.delete(response.id)

    if (!response.ok || response.error) {
      pending.reject(new Error(response.error?.message ?? 'Request failed'))
    } else {
      pending.resolve(response.result)
    }
  }

  private handleEvent(event: OcEvent): void {
    const handlers = this.eventHandlers.get(event.event)
    if (handlers) {
      for (const handler of handlers) {
        try {
          handler(event)
        } catch (err) {
          console.error('[gateway-client] Event handler error:', err)
        }
      }
    }

    // Also fire wildcard handlers
    const wildcardHandlers = this.eventHandlers.get('*')
    if (wildcardHandlers) {
      for (const handler of wildcardHandlers) {
        try {
          handler(event)
        } catch (err) {
          console.error('[gateway-client] Wildcard handler error:', err)
        }
      }
    }
  }

  private setState(newState: GatewayConnectionState): void {
    if (this.state === newState) return
    this.state = newState
    for (const handler of this.stateHandlers) {
      try {
        handler(newState)
      } catch (err) {
        console.error('[gateway-client] State handler error:', err)
      }
    }
  }

  private scheduleReconnect(): void {
    if (!this.shouldReconnect) return

    const delay = Math.min(RECONNECT_BASE * Math.pow(2, this.reconnectAttempt), RECONNECT_MAX)
    this.reconnectAttempt++

    console.log(`[gateway-client] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempt})`)

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.connect()
    }, delay)
  }

  private rejectAllPending(reason: string): void {
    for (const [id, pending] of this.pendingRequests) {
      clearTimeout(pending.timeout)
      pending.reject(new Error(reason))
      this.pendingRequests.delete(id)
    }
  }
}

// Singleton instance
export const gatewayClient = new GatewayClient()
