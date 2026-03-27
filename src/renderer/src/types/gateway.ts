// OpenClaw gateway proprietary frame protocol (NOT JSON-RPC 2.0)
// Frame format discovered from openclaw dist source (gateway-cli-D4HbtwPr.js)

export interface OcRequest {
  type: 'req'
  id: string
  method: string
  params?: Record<string, unknown>
}

export interface OcResponse {
  type: 'res'
  id: string
  ok: boolean
  result?: unknown
  error?: OcError
}

export interface OcEvent {
  type: 'event'
  event: string
  payload?: Record<string, unknown>
}

export interface OcError {
  code: string
  message: string
  data?: unknown
}

export type OcFrame = OcRequest | OcResponse | OcEvent

// Backward-compat aliases used in existing event handlers
export type JsonRpcEvent = OcEvent

// Gateway connection states
export type GatewayConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error'

// Gateway events emitted by the agent runtime
export type GatewayEventType =
  | 'agent.turn.start'
  | 'agent.turn.end'
  | 'agent.tool.call'
  | 'agent.tool.result'
  | 'agent.message'
  | 'agent.error'
  | 'exec.approval.requested'
  | 'exec.approval.resolved'
  | 'task.created'
  | 'task.updated'
  | 'task.completed'
  | 'task.failed'

export interface GatewayEvent {
  type: GatewayEventType
  timestamp: number
  data: Record<string, unknown>
}

// Health status from main process
export interface GatewayHealthStatus {
  ok: boolean
  latency: number | null
  error: string | null
  checkedAt: number
}

// Process state from main process
export interface GatewayProcessState {
  state: 'stopped' | 'starting' | 'running' | 'stopping' | 'error'
  pid: number | null
  restartCount: number
  lastError: string | null
  startedAt: number | null
}
