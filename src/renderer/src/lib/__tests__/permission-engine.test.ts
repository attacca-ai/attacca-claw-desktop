import { describe, it, expect } from 'vitest'
import { classifyAction, getTierColor, getTierBgColor, getTierLabel } from '../permission-engine'

describe('permission-engine', () => {
  describe('classifyAction', () => {
    it('classifies read operations as low risk', () => {
      expect(classifyAction('read.calendar').tier).toBe('low')
      expect(classifyAction('read.email').tier).toBe('low')
      expect(classifyAction('read.tasks').tier).toBe('low')
      expect(classifyAction('read.files').tier).toBe('low')
      expect(classifyAction('read.messages').tier).toBe('low')
    })

    it('classifies personal calendar creation as medium risk', () => {
      const result = classifyAction('create.calendar.personal')
      expect(result.tier).toBe('medium')
      expect(result.floorTier).toBe('medium')
      expect(result.escalated).toBe(false)
    })

    it('classifies shared calendar creation as high risk', () => {
      expect(classifyAction('create.calendar.shared').tier).toBe('high')
    })

    it('classifies send.email as high risk', () => {
      expect(classifyAction('send.email').tier).toBe('high')
    })

    it('classifies draft.email as medium risk', () => {
      expect(classifyAction('draft.email').tier).toBe('medium')
    })

    it('classifies task management correctly', () => {
      expect(classifyAction('create.task').tier).toBe('medium')
      expect(classifyAction('update.task').tier).toBe('medium')
      expect(classifyAction('delete.task').tier).toBe('high')
    })

    it('classifies file operations correctly', () => {
      expect(classifyAction('upload.file').tier).toBe('medium')
      expect(classifyAction('modify.file.personal').tier).toBe('medium')
      expect(classifyAction('modify.file.shared').tier).toBe('high')
      expect(classifyAction('delete.file').tier).toBe('high')
    })

    it('classifies communication actions correctly', () => {
      expect(classifyAction('post.message.channel').tier).toBe('high')
      expect(classifyAction('post.message.dm').tier).toBe('high')
      expect(classifyAction('react.message').tier).toBe('low')
      expect(classifyAction('update.status').tier).toBe('medium')
    })

    it('defaults unknown actions to high risk', () => {
      const result = classifyAction('unknown.action.type')
      expect(result.tier).toBe('high')
      expect(result.floorTier).toBe('high')
    })

    it('escalates to high when shared context is true', () => {
      const result = classifyAction('create.calendar.personal', { shared: true })
      expect(result.tier).toBe('high')
      expect(result.floorTier).toBe('medium')
      expect(result.escalated).toBe(true)
    })

    it('escalates calendar actions when hasAttendees is true', () => {
      const result = classifyAction('create.calendar.personal', { hasAttendees: true })
      expect(result.tier).toBe('high')
      expect(result.escalated).toBe(true)
    })

    it('does not escalate already-high actions', () => {
      const result = classifyAction('send.email', { shared: true })
      expect(result.tier).toBe('high')
      expect(result.escalated).toBe(false)
    })

    it('does not escalate non-calendar actions for hasAttendees', () => {
      const result = classifyAction('draft.email', { hasAttendees: true })
      expect(result.tier).toBe('medium')
      expect(result.escalated).toBe(false)
    })

    it('never downgrades below floor tier', () => {
      // All classified tiers should be >= floor tier
      const actions = ['read.calendar', 'send.email', 'delete.task', 'create.calendar.personal']
      for (const action of actions) {
        const result = classifyAction(action)
        expect(result.tier).toBe(result.floorTier)
        expect(result.escalated).toBe(false)
      }
    })
  })

  describe('getTierColor', () => {
    it('returns green classes for low risk', () => {
      expect(getTierColor('low')).toContain('green')
    })

    it('returns yellow classes for medium risk', () => {
      expect(getTierColor('medium')).toContain('yellow')
    })

    it('returns red classes for high risk', () => {
      expect(getTierColor('high')).toContain('red')
    })
  })

  describe('getTierBgColor', () => {
    it('returns green bg for low risk', () => {
      expect(getTierBgColor('low')).toContain('green')
    })

    it('returns yellow bg for medium risk', () => {
      expect(getTierBgColor('medium')).toContain('yellow')
    })

    it('returns red bg for high risk', () => {
      expect(getTierBgColor('high')).toContain('red')
    })
  })

  describe('getTierLabel', () => {
    it('returns correct labels for each tier', () => {
      expect(getTierLabel('low')).toBe('Low Risk')
      expect(getTierLabel('medium')).toBe('Medium Risk')
      expect(getTierLabel('high')).toBe('High Risk — Requires Approval')
    })
  })
})
