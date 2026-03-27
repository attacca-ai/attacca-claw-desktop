import { useGatewayStore } from '@/stores/gateway-store'
import { useAppStore } from '@/stores/app-store'
import { Badge } from '@/components/ui/badge'

export function DashboardPlaceholder(): React.JSX.Element {
  const connectionState = useGatewayStore((s) => s.connectionState)
  const processState = useGatewayStore((s) => s.processState)
  const version = useAppStore((s) => s.version)

  const statusColor = {
    connected: 'bg-green-500',
    connecting: 'bg-yellow-500',
    disconnected: 'bg-gray-500',
    error: 'bg-red-500'
  }[connectionState]

  return (
    <div className="flex h-screen flex-col bg-background">
      {/* Title bar drag region */}
      <div
        className="flex h-9 shrink-0 items-center justify-between border-b border-border px-4"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      >
        <span className="text-sm font-medium text-foreground">Attacca</span>
        <div
          className="flex items-center gap-2"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          <div className={`h-2 w-2 rounded-full ${statusColor}`} />
          <span className="text-xs text-muted-foreground">{processState?.state ?? 'unknown'}</span>
          <Badge variant="outline" className="text-xs">
            WS: {connectionState}
          </Badge>
          {version && <span className="text-xs text-muted-foreground">v{version}</span>}
        </div>
      </div>

      {/* Dashboard content — full implementation in Phase 3 */}
      <div className="flex flex-1 items-center justify-center p-8">
        <div className="flex flex-col items-center gap-4 text-center">
          <h2 className="text-2xl font-semibold text-foreground">Action Dashboard</h2>
          <p className="max-w-md text-muted-foreground">
            Your assistant is ready. The full dashboard with morning briefings, activity feed, task
            queue, and permission controls is coming in Phase 3.
          </p>
          <div className="mt-4 flex flex-col gap-2 text-sm text-muted-foreground">
            <p>Gateway: {processState?.state ?? 'not started'}</p>
            <p>WebSocket: {connectionState}</p>
            {processState?.lastError && (
              <p className="text-destructive">{processState.lastError}</p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
