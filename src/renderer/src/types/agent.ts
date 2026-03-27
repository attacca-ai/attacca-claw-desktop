export interface AgentTask {
  id: string
  description: string
  status: 'pending' | 'in_progress' | 'completed' | 'failed'
  createdAt: number
  startedAt?: number
  completedAt?: number
  result?: string
  error?: string
}

export interface AgentTurnEvent {
  type: 'turn.start' | 'turn.end'
  taskId?: string
  timestamp: number
}

export interface AgentToolCallEvent {
  type: 'tool.call'
  tool: string
  params?: Record<string, unknown>
  timestamp: number
}

export interface AgentToolResultEvent {
  type: 'tool.result'
  tool: string
  result: unknown
  timestamp: number
}

export interface AgentMessageEvent {
  type: 'message'
  content: string
  timestamp: number
}

export interface AgentErrorEvent {
  type: 'error'
  message: string
  code?: string
  timestamp: number
}

export type AgentEvent =
  | AgentTurnEvent
  | AgentToolCallEvent
  | AgentToolResultEvent
  | AgentMessageEvent
  | AgentErrorEvent
