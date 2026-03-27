import { useEffect, useRef } from 'react'
import { useAgentStore, type ActivityEntry } from '@/stores/agent-store'
import { Activity, AlertCircle, CheckCircle, Wrench, MessageSquare, Info } from 'lucide-react'
import { cn } from '@/lib/utils'

const TYPE_CONFIG: Record<ActivityEntry['type'], { icon: React.ReactNode; color: string }> = {
  info: { icon: <Info className="h-3 w-3" />, color: 'text-blue-500' },
  action: { icon: <CheckCircle className="h-3 w-3" />, color: 'text-green-500' },
  tool_call: { icon: <Wrench className="h-3 w-3" />, color: 'text-purple-500' },
  tool_result: { icon: <CheckCircle className="h-3 w-3" />, color: 'text-green-500' },
  error: { icon: <AlertCircle className="h-3 w-3" />, color: 'text-red-500' },
  message: { icon: <MessageSquare className="h-3 w-3" />, color: 'text-foreground' }
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  })
}

export function ActivityFeed(): React.JSX.Element {
  const activityFeed = useAgentStore((s) => s.activityFeed)
  const scrollRef = useRef<HTMLDivElement>(null)

  // Auto-scroll to bottom on new entries
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [activityFeed.length])

  return (
    <div className="flex h-full flex-col">
      <div className="mb-3 flex items-center gap-2">
        <Activity className="h-4 w-4 text-muted-foreground" />
        <h3 className="text-sm font-semibold text-foreground">Activity Feed</h3>
        <span className="text-xs text-muted-foreground">({activityFeed.length})</span>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-auto" role="log" aria-live="polite">
        {activityFeed.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <p className="text-sm text-muted-foreground">
              No activity yet. Add a task to get started.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-1">
            {activityFeed.map((entry) => {
              const config = TYPE_CONFIG[entry.type]
              return (
                <div
                  key={entry.id}
                  className="flex items-start gap-2 rounded px-1 py-0.5 text-xs hover:bg-muted/50"
                >
                  <span className={cn('mt-0.5 shrink-0', config.color)}>{config.icon}</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                      <span className="text-muted-foreground">{formatTime(entry.timestamp)}</span>
                      <span className="text-foreground">{entry.description}</span>
                    </div>
                    {entry.details && (
                      <pre className="mt-0.5 max-h-20 overflow-auto whitespace-pre-wrap rounded bg-muted/50 p-1 text-[10px] text-muted-foreground">
                        {entry.details}
                      </pre>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
