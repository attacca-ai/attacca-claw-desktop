// OpenClaw gateway proprietary protocol helpers
// Frame format: { type: "req"|"res"|"event", ... } — NOT JSON-RPC 2.0
import type { OcRequest, OcResponse, OcEvent, OcFrame } from '@/types/gateway'

let idCounter = 0

function nextId(): string {
  return `req_${++idCounter}_${Date.now()}`
}

export function buildRequest(method: string, params?: Record<string, unknown>): OcRequest {
  return {
    type: 'req',
    id: nextId(),
    method,
    ...(params && { params })
  }
}

export function buildResponse(id: string, result: unknown): OcResponse {
  return {
    type: 'res',
    id,
    ok: true,
    result
  }
}

export function buildErrorResponse(
  id: string,
  code: string | number,
  message: string,
  data?: unknown
): OcResponse {
  return {
    type: 'res',
    id,
    ok: false,
    error: { code: String(code), message, ...(data !== undefined && { data }) }
  }
}

export function parseFrame(raw: string): OcFrame | null {
  try {
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return null
    const t = parsed.type
    if (t !== 'req' && t !== 'res' && t !== 'event') return null
    return parsed as OcFrame
  } catch {
    return null
  }
}

export function isResponse(frame: OcFrame): frame is OcResponse {
  return frame.type === 'res'
}

export function isEvent(frame: OcFrame): frame is OcEvent {
  return frame.type === 'event'
}

export function isRequest(frame: OcFrame): frame is OcRequest {
  return frame.type === 'req'
}
