import { useNotificationStore, type AppNotification } from '@/stores/notification-store'
import { Bell, X, Undo2, Info, AlertTriangle, CheckCircle, ShieldAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

const TYPE_CONFIG: Record<AppNotification['type'], { icon: React.ReactNode; color: string }> = {
  info: { icon: <Info className="h-3 w-3" />, color: 'text-blue-500' },
  warning: { icon: <AlertTriangle className="h-3 w-3" />, color: 'text-yellow-500' },
  'action-taken': { icon: <CheckCircle className="h-3 w-3" />, color: 'text-green-500' },
  'approval-needed': { icon: <ShieldAlert className="h-3 w-3" />, color: 'text-red-500' }
}

function formatTimeAgo(ts: number): string {
  const diff = Date.now() - ts
  if (diff < 60_000) return 'just now'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
  return new Date(ts).toLocaleDateString()
}

export function NotificationBox(): React.JSX.Element {
  const { notifications, unreadCount, markRead, markAllRead, undo, dismiss } =
    useNotificationStore()

  const visible = notifications.filter((n) => !n.dismissed)

  return (
    <div className="flex h-full flex-col">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Bell className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold text-foreground">Notifications</h3>
          {unreadCount > 0 && (
            <Badge variant="default" className="h-4 px-1.5 text-[10px]">
              {unreadCount}
            </Badge>
          )}
        </div>
        {unreadCount > 0 && (
          <Button variant="ghost" size="sm" onClick={markAllRead} className="text-xs">
            Mark all read
          </Button>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-1 overflow-auto">
        {visible.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <p className="text-sm text-muted-foreground">No notifications</p>
          </div>
        ) : (
          visible.map((notif) => {
            const config = TYPE_CONFIG[notif.type]
            return (
              <div
                key={notif.id}
                className={cn(
                  'flex items-start gap-2 rounded-md border p-2 text-xs transition-colors',
                  notif.read ? 'border-border bg-background' : 'border-primary/20 bg-primary/5'
                )}
                onClick={() => markRead(notif.id)}
              >
                <span className={cn('mt-0.5 shrink-0', config.color)}>{config.icon}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-1">
                    <span className="font-medium text-foreground">{notif.title}</span>
                    <span className="shrink-0 text-[10px] text-muted-foreground">
                      {formatTimeAgo(notif.timestamp)}
                    </span>
                  </div>
                  <p className="text-muted-foreground">{notif.message}</p>
                  {notif.undoable && (
                    <Button
                      variant="ghost"
                      size="xs"
                      onClick={(e) => {
                        e.stopPropagation()
                        undo(notif.id)
                      }}
                      className="mt-1"
                    >
                      <Undo2 className="h-3 w-3" />
                      Undo
                    </Button>
                  )}
                </div>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  onClick={(e) => {
                    e.stopPropagation()
                    dismiss(notif.id)
                  }}
                  className="shrink-0 opacity-50 hover:opacity-100"
                >
                  <X className="h-3 w-3" />
                </Button>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
