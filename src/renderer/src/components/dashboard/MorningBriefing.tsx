import { useAgentStore } from '@/stores/agent-store'
import { Sun, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { gatewayClient } from '@/lib/gateway-client'
import { useGatewayStore } from '@/stores/gateway-store'
import { extractMessageText } from '@/lib/utils'
import { useState } from 'react'
import type { OcEvent } from '@/types/gateway'

const BRIEFING_PROMPT =
  "Generate a morning briefing. Summarize: today's calendar, pending emails requiring action, overdue tasks, and suggested priorities for the day. Format as concise markdown."
const BRIEFING_TIMEOUT_MS = 120_000

export function MorningBriefing(): React.JSX.Element {
  const { morningBriefing, briefingDate, setMorningBriefing } = useAgentStore()
  const connectionState = useGatewayStore((s) => s.connectionState)
  const [loading, setLoading] = useState(false)

  const today = new Date().toISOString().split('T')[0]
  const isToday = briefingDate === today

  const generateBriefing = async (): Promise<void> => {
    if (connectionState !== 'connected') return
    setLoading(true)

    try {
      // chat.send triggers the agent; the response arrives asynchronously via 'chat' event
      await gatewayClient.rpc('chat.send', {
        sessionKey: 'agent:main:main',
        message: BRIEFING_PROMPT,
        idempotencyKey: crypto.randomUUID()
      })

      // Listen for the chat final/error event for this session
      const startedAt = Date.now()
      let done = false
      const cleanup = (): void => {
        if (done) return
        done = true
        gatewayClient.off('*', handler)
        setLoading(false)
      }

      const timeoutId = setTimeout(() => {
        cleanup()
        setMorningBriefing('Briefing timed out — agent took too long to respond.')
      }, BRIEFING_TIMEOUT_MS)

      const handler = (event: OcEvent): void => {
        if (event.event !== 'chat') return
        const payload = (event.payload ?? {}) as Record<string, unknown>
        // Only handle events for our session
        if (payload.sessionKey !== 'agent:main:main') return

        const state = payload.state as string
        if (state === 'final') {
          const text = extractMessageText(
            payload.message as Parameters<typeof extractMessageText>[0]
          )
          setMorningBriefing(text || 'Briefing generated but contained no text.')
          clearTimeout(timeoutId)
          const durationMs = Date.now() - startedAt
          window.api.telemetry.emit('agent.task.completed', { durationMs, hadFallback: false })
          cleanup()
        } else if (state === 'error') {
          const errorMsg = (payload.errorMessage as string) || 'Error generating briefing.'
          setMorningBriefing(errorMsg)
          clearTimeout(timeoutId)
          const durationMs = Date.now() - startedAt
          window.api.telemetry.emit('agent.task.failed', {
            durationMs,
            errorCategory: 'briefing_error'
          })
          cleanup()
        }
      }

      gatewayClient.on('*', handler)
    } catch {
      setMorningBriefing(
        'Could not generate morning briefing. Your assistant may not be connected yet.'
      )
      setLoading(false)
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Sun className="h-4 w-4 text-yellow-500" />
          <h3 className="text-sm font-semibold text-foreground">Morning Briefing</h3>
        </div>
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={generateBriefing}
          disabled={loading || connectionState !== 'connected'}
          title="Refresh briefing"
        >
          <RefreshCw className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} />
        </Button>
      </div>

      {morningBriefing ? (
        <div className="flex-1 overflow-auto">
          <div className="prose prose-sm dark:prose-invert max-w-none text-sm text-muted-foreground">
            {morningBriefing.split('\n').map((line, i) => (
              <p key={i} className={line.startsWith('#') ? 'font-medium text-foreground' : ''}>
                {line.replace(/^#+\s*/, '')}
              </p>
            ))}
          </div>
          {!isToday && (
            <p className="mt-2 text-xs text-muted-foreground">Last updated: {briefingDate}</p>
          )}
        </div>
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
          <p className="text-sm text-muted-foreground">No briefing yet for today.</p>
          <Button
            variant="outline"
            size="sm"
            onClick={generateBriefing}
            disabled={loading || connectionState !== 'connected'}
          >
            {loading ? 'Generating...' : 'Generate Briefing'}
          </Button>
        </div>
      )}
    </div>
  )
}
