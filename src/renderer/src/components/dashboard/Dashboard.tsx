import { useEffect, useRef } from 'react'
import { gatewayClient } from '@/lib/gateway-client'
import { useAgentStore } from '@/stores/agent-store'
import { useGatewayStore } from '@/stores/gateway-store'
import { useUsageStore } from '@/stores/usage-store'
import { LandscapeView } from './LandscapeView'
import { CapturePanel } from './CapturePanel'
import { UsageLimitBanner } from '@/components/shared/UsageLimitBanner'
// ApprovalDialog moved to AppShell for global coverage
import { extractMessageText } from '@/lib/utils'
import type { JsonRpcEvent } from '@/types/gateway'

export function Dashboard(): React.JSX.Element {
  const connectionState = useGatewayStore((s) => s.connectionState)
  const { addActivity, completeTask, failTask, hydrate } = useAgentStore()
  const fetchUsage = useUsageStore((s) => s.fetchUsage)
  const lastMessageRef = useRef<string | null>(null)
  const captureTextareaRef = useRef<HTMLTextAreaElement>(null)

  // Restore persisted state on mount
  useEffect(() => {
    hydrate()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch usage on mount and periodically
  useEffect(() => {
    fetchUsage()
    const interval = setInterval(fetchUsage, 5 * 60 * 1000)
    return () => clearInterval(interval)
  }, [fetchUsage])

  // Subscribe to gateway events
  useEffect(() => {
    if (connectionState !== 'connected') return

    const handler = (event: JsonRpcEvent): void => {
      const payload = (event.payload ?? {}) as Record<string, unknown>

      if (event.event === 'agent') {
        const stream = payload.stream as string
        const data = (payload.data ?? {}) as Record<string, unknown>
        const phase = data.phase as string | undefined

        if (stream === 'lifecycle') {
          if (phase === 'start') {
            lastMessageRef.current = null
            addActivity({ type: 'info', description: 'Agent started processing...' })
          } else if (phase === 'end') {
            addActivity({ type: 'info', description: 'Agent finished processing' })
            const task = useAgentStore.getState().currentTask
            if (task) completeTask(task.id, lastMessageRef.current ?? undefined)
            lastMessageRef.current = null
          } else if (phase === 'error') {
            const errorMsg = typeof data.error === 'string' ? data.error : 'An error occurred'
            addActivity({ type: 'error', description: errorMsg })
            const task = useAgentStore.getState().currentTask
            if (task) failTask(task.id, errorMsg)
          }
        } else if (stream === 'tool' && phase === 'start') {
          addActivity({
            type: 'tool_call',
            description: `Calling tool: ${(data.name as string) || 'unknown'}`,
            details: JSON.stringify(data.args, null, 2)
          })
        } else if (stream === 'tool' && phase === 'end') {
          addActivity({
            type: 'tool_result',
            description: 'Tool result received',
            details: typeof data.result === 'string' ? data.result : JSON.stringify(data.result)
          })
        }
      } else if (event.event === 'chat') {
        const state = payload.state as string
        if (state === 'final') {
          const text = extractMessageText(
            payload.message as Parameters<typeof extractMessageText>[0]
          )
          if (text) {
            lastMessageRef.current = text
            addActivity({ type: 'message', description: text })
          }
        } else if (state === 'error') {
          const errorMsg = (payload.errorMessage as string) || 'An error occurred'
          addActivity({ type: 'error', description: errorMsg })
          const task = useAgentStore.getState().currentTask
          if (task) failTask(task.id, errorMsg)
        }
      }
    }

    gatewayClient.on('*', handler)
    return () => gatewayClient.off('*', handler)
  }, [connectionState, addActivity, completeTask, failTask])

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <UsageLimitBanner />

      <div className="flex flex-1 overflow-hidden">
        {/* Center: Landscape */}
        <div className="flex flex-1 flex-col overflow-hidden">
          <LandscapeView />
        </div>

        {/* Right panel: Capture + Activity + Emergency (280px) */}
        <div className="flex w-72 flex-col overflow-hidden">
          <CapturePanel captureRef={captureTextareaRef} />
        </div>
      </div>
    </div>
  )
}
