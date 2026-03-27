import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useNotificationStore } from '../notification-store'

describe('notification-store', () => {
  beforeEach(() => {
    useNotificationStore.setState({
      notifications: [],
      unreadCount: 0
    })

    // Mock Notification API
    Object.defineProperty(window, 'Notification', {
      value: vi.fn(),
      writable: true,
      configurable: true
    })
    Object.defineProperty(window.Notification, 'permission', {
      value: 'granted',
      writable: true,
      configurable: true
    })

    // Default: page is visible
    Object.defineProperty(document, 'hidden', {
      value: false,
      writable: true,
      configurable: true
    })
  })

  it('has correct initial state', () => {
    const state = useNotificationStore.getState()
    expect(state.notifications).toHaveLength(0)
    expect(state.unreadCount).toBe(0)
  })

  describe('add', () => {
    it('adds notification with auto-generated id and timestamp', () => {
      useNotificationStore.getState().add({
        type: 'info',
        title: 'Test',
        message: 'Hello world'
      })

      const state = useNotificationStore.getState()
      expect(state.notifications).toHaveLength(1)
      expect(state.notifications[0].id).toMatch(/^notif_/)
      expect(state.notifications[0].timestamp).toBeGreaterThan(0)
      expect(state.notifications[0].read).toBe(false)
      expect(state.notifications[0].dismissed).toBe(false)
    })

    it('prepends new notifications (newest first)', () => {
      useNotificationStore.getState().add({
        type: 'info',
        title: 'First',
        message: 'First message'
      })
      useNotificationStore.getState().add({
        type: 'info',
        title: 'Second',
        message: 'Second message'
      })

      const state = useNotificationStore.getState()
      expect(state.notifications[0].title).toBe('Second')
      expect(state.notifications[1].title).toBe('First')
    })

    it('increments unreadCount', () => {
      useNotificationStore.getState().add({ type: 'info', title: 'A', message: '' })
      useNotificationStore.getState().add({ type: 'info', title: 'B', message: '' })
      expect(useNotificationStore.getState().unreadCount).toBe(2)
    })

    it('triggers system notification when document is hidden', () => {
      Object.defineProperty(document, 'hidden', { value: true, configurable: true })

      useNotificationStore.getState().add({
        type: 'warning',
        title: 'Alert',
        message: 'Important!'
      })

      expect(window.Notification).toHaveBeenCalledWith('Alert', { body: 'Important!' })
    })

    it('does not trigger system notification when document is visible', () => {
      Object.defineProperty(document, 'hidden', { value: false, configurable: true })

      useNotificationStore.getState().add({
        type: 'info',
        title: 'Hello',
        message: 'World'
      })

      expect(window.Notification).not.toHaveBeenCalled()
    })
  })

  describe('markRead', () => {
    it('marks a notification as read', () => {
      useNotificationStore.getState().add({ type: 'info', title: 'Test', message: '' })
      const id = useNotificationStore.getState().notifications[0].id

      useNotificationStore.getState().markRead(id)

      const notif = useNotificationStore.getState().notifications.find((n) => n.id === id)
      expect(notif!.read).toBe(true)
    })

    it('decrements unreadCount', () => {
      useNotificationStore.getState().add({ type: 'info', title: 'A', message: '' })
      useNotificationStore.getState().add({ type: 'info', title: 'B', message: '' })
      expect(useNotificationStore.getState().unreadCount).toBe(2)

      const id = useNotificationStore.getState().notifications[0].id
      useNotificationStore.getState().markRead(id)
      expect(useNotificationStore.getState().unreadCount).toBe(1)
    })

    it('does not double-mark already read notification', () => {
      useNotificationStore.getState().add({ type: 'info', title: 'Test', message: '' })
      const id = useNotificationStore.getState().notifications[0].id

      useNotificationStore.getState().markRead(id)
      useNotificationStore.getState().markRead(id)
      expect(useNotificationStore.getState().unreadCount).toBe(0)
    })
  })

  describe('markAllRead', () => {
    it('marks all notifications as read', () => {
      useNotificationStore.getState().add({ type: 'info', title: 'A', message: '' })
      useNotificationStore.getState().add({ type: 'info', title: 'B', message: '' })

      useNotificationStore.getState().markAllRead()

      const state = useNotificationStore.getState()
      expect(state.unreadCount).toBe(0)
      state.notifications.forEach((n) => expect(n.read).toBe(true))
    })
  })

  describe('dismiss', () => {
    it('marks notification as dismissed and read', () => {
      useNotificationStore.getState().add({ type: 'info', title: 'Test', message: '' })
      const id = useNotificationStore.getState().notifications[0].id

      useNotificationStore.getState().dismiss(id)

      const notif = useNotificationStore.getState().notifications.find((n) => n.id === id)
      expect(notif!.dismissed).toBe(true)
      expect(notif!.read).toBe(true)
    })

    it('updates unreadCount when dismissing unread notification', () => {
      useNotificationStore.getState().add({ type: 'info', title: 'Test', message: '' })
      expect(useNotificationStore.getState().unreadCount).toBe(1)

      const id = useNotificationStore.getState().notifications[0].id
      useNotificationStore.getState().dismiss(id)
      expect(useNotificationStore.getState().unreadCount).toBe(0)
    })
  })

  describe('undo', () => {
    it('calls undoAction callback and removes notification', () => {
      const undoFn = vi.fn()
      useNotificationStore.getState().add({
        type: 'action-taken',
        title: 'Done',
        message: 'Thing done',
        undoable: true,
        undoAction: undoFn
      })

      const id = useNotificationStore.getState().notifications[0].id
      useNotificationStore.getState().undo(id)

      expect(undoFn).toHaveBeenCalled()
      expect(useNotificationStore.getState().notifications).toHaveLength(0)
    })

    it('does nothing when notification has no undoAction', () => {
      useNotificationStore.getState().add({
        type: 'info',
        title: 'Info',
        message: 'No undo'
      })

      const id = useNotificationStore.getState().notifications[0].id
      useNotificationStore.getState().undo(id)

      // Notification should still be there
      expect(useNotificationStore.getState().notifications).toHaveLength(1)
    })

    it('does nothing for nonexistent notification', () => {
      useNotificationStore.getState().undo('nonexistent')
      expect(useNotificationStore.getState().notifications).toHaveLength(0)
    })
  })

  describe('clear', () => {
    it('resets notifications and unreadCount', () => {
      useNotificationStore.getState().add({ type: 'info', title: 'A', message: '' })
      useNotificationStore.getState().add({ type: 'info', title: 'B', message: '' })

      useNotificationStore.getState().clear()

      const state = useNotificationStore.getState()
      expect(state.notifications).toHaveLength(0)
      expect(state.unreadCount).toBe(0)
    })
  })
})
