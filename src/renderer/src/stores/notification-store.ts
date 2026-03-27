import { create } from 'zustand'

export type NotificationType = 'info' | 'warning' | 'action-taken' | 'approval-needed'

export interface AppNotification {
  id: string
  type: NotificationType
  title: string
  message: string
  timestamp: number
  read: boolean
  undoable?: boolean
  undoAction?: () => void
  dismissed?: boolean
}

interface NotificationStore {
  notifications: AppNotification[]
  unreadCount: number

  add: (notification: Omit<AppNotification, 'id' | 'timestamp' | 'read' | 'dismissed'>) => void
  markRead: (id: string) => void
  markAllRead: () => void
  undo: (id: string) => void
  dismiss: (id: string) => void
  clear: () => void
}

let notifIdCounter = 0

export const useNotificationStore = create<NotificationStore>((set, get) => ({
  notifications: [],
  unreadCount: 0,

  add: (notification) => {
    const full: AppNotification = {
      ...notification,
      id: `notif_${++notifIdCounter}`,
      timestamp: Date.now(),
      read: false,
      dismissed: false
    }

    const notifications = [full, ...get().notifications]
    set({ notifications, unreadCount: get().unreadCount + 1 })

    // Send system notification if window is hidden
    if (document.hidden && 'Notification' in window && Notification.permission === 'granted') {
      new Notification(notification.title, { body: notification.message })
    }
  },

  markRead: (id) => {
    const notifications = get().notifications.map((n) =>
      n.id === id && !n.read ? { ...n, read: true } : n
    )
    const unreadCount = notifications.filter((n) => !n.read && !n.dismissed).length
    set({ notifications, unreadCount })
  },

  markAllRead: () => {
    set({
      notifications: get().notifications.map((n) => ({ ...n, read: true })),
      unreadCount: 0
    })
  },

  undo: (id) => {
    const notif = get().notifications.find((n) => n.id === id)
    if (notif?.undoAction) {
      notif.undoAction()
      set({
        notifications: get().notifications.filter((n) => n.id !== id)
      })
    }
  },

  dismiss: (id) => {
    const notifications = get().notifications.map((n) =>
      n.id === id ? { ...n, dismissed: true, read: true } : n
    )
    const unreadCount = notifications.filter((n) => !n.read && !n.dismissed).length
    set({ notifications, unreadCount })
  },

  clear: () => set({ notifications: [], unreadCount: 0 })
}))
