import { describe, it, expect } from 'vitest'
import {
  buildRequest,
  buildResponse,
  buildErrorResponse,
  parseFrame,
  isResponse,
  isEvent,
  isRequest
} from '../rpc'

describe('rpc (OpenClaw protocol)', () => {
  describe('buildRequest', () => {
    it('creates a valid OpenClaw request frame', () => {
      const req = buildRequest('agent.request', { text: 'hello' })
      expect(req.type).toBe('req')
      expect(req.id).toBeDefined()
      expect(req.method).toBe('agent.request')
      expect(req.params).toEqual({ text: 'hello' })
    })

    it('generates unique ids for each request', () => {
      const req1 = buildRequest('method1')
      const req2 = buildRequest('method2')
      expect(req1.id).not.toBe(req2.id)
    })

    it('omits params when not provided', () => {
      const req = buildRequest('agent.stop')
      expect(req).not.toHaveProperty('params')
    })
  })

  describe('buildResponse', () => {
    it('creates a valid OpenClaw success response', () => {
      const res = buildResponse('req_1', { status: 'ok' })
      expect(res.type).toBe('res')
      expect(res.id).toBe('req_1')
      expect(res.ok).toBe(true)
      expect(res.result).toEqual({ status: 'ok' })
    })
  })

  describe('buildErrorResponse', () => {
    it('creates a valid OpenClaw error response', () => {
      const res = buildErrorResponse('req_1', 'INVALID_REQUEST', 'Invalid Request')
      expect(res.type).toBe('res')
      expect(res.id).toBe('req_1')
      expect(res.ok).toBe(false)
      expect(res.error).toEqual({ code: 'INVALID_REQUEST', message: 'Invalid Request' })
    })

    it('includes optional data in error', () => {
      const res = buildErrorResponse('req_1', 'ERR', 'Invalid', { detail: 'missing field' })
      expect(res.error?.data).toEqual({ detail: 'missing field' })
    })

    it('excludes data when not provided', () => {
      const res = buildErrorResponse('req_1', 'ERR', 'Invalid')
      expect(res.error).not.toHaveProperty('data')
    })
  })

  describe('parseFrame', () => {
    it('parses a valid OpenClaw request frame', () => {
      const raw = JSON.stringify({ type: 'req', id: '1', method: 'test' })
      const frame = parseFrame(raw)
      expect(frame).not.toBeNull()
      expect(frame!.type).toBe('req')
    })

    it('parses a valid OpenClaw response frame', () => {
      const raw = JSON.stringify({ type: 'res', id: '1', ok: true, result: 42 })
      const frame = parseFrame(raw)
      expect(frame).not.toBeNull()
      expect(frame!.type).toBe('res')
    })

    it('parses a valid OpenClaw event frame', () => {
      const raw = JSON.stringify({ type: 'event', event: 'agent.turn.start', payload: {} })
      const frame = parseFrame(raw)
      expect(frame).not.toBeNull()
      expect(frame!.type).toBe('event')
    })

    it('returns null for invalid JSON', () => {
      expect(parseFrame('not json')).toBeNull()
    })

    it('returns null for unknown frame type', () => {
      const raw = JSON.stringify({ type: 'unknown', id: '1' })
      expect(parseFrame(raw)).toBeNull()
    })

    it('returns null for JSON-RPC 2.0 frames (not OpenClaw protocol)', () => {
      const raw = JSON.stringify({ jsonrpc: '2.0', id: '1', method: 'test' })
      expect(parseFrame(raw)).toBeNull()
    })
  })

  describe('type guards', () => {
    it('isResponse identifies response frames', () => {
      const res = buildResponse('1', 'ok')
      expect(isResponse(res)).toBe(true)
      expect(isRequest(res)).toBe(false)
      expect(isEvent(res)).toBe(false)
    })

    it('isResponse identifies error response frames', () => {
      const res = buildErrorResponse('1', 'ERR', 'Error')
      expect(isResponse(res)).toBe(true)
    })

    it('isRequest identifies request frames', () => {
      const req = buildRequest('test.method')
      expect(isRequest(req)).toBe(true)
      expect(isResponse(req)).toBe(false)
      expect(isEvent(req)).toBe(false)
    })

    it('isEvent identifies event frames', () => {
      const event = { type: 'event' as const, event: 'agent.turn.start', payload: {} }
      expect(isEvent(event)).toBe(true)
      expect(isRequest(event)).toBe(false)
      expect(isResponse(event)).toBe(false)
    })
  })
})
