import { useState, useEffect } from 'react'
import { useAgentStore } from '@/stores/agent-store'
import { gatewayClient } from '@/lib/gateway-client'
import { useGatewayStore } from '@/stores/gateway-store'
import { OctagonX } from 'lucide-react'

export function EmergencyStop(): React.JSX.Element {
  const emergencyStop = useAgentStore((s) => s.emergencyStop)
  const connectionState = useGatewayStore((s) => s.connectionState)
  const [confirming, setConfirming] = useState(false)

  // Auto-cancel confirmation after 3 seconds
  useEffect(() => {
    if (!confirming) return
    const timer = setTimeout(() => setConfirming(false), 3000)
    return () => clearTimeout(timer)
  }, [confirming])

  const handleClick = async (): Promise<void> => {
    if (!confirming) {
      setConfirming(true)
      return
    }

    // Second click — execute stop
    emergencyStop()
    setConfirming(false)

    window.api.telemetry.emit('trust.kill_switch.activated', {})

    // Send stop to gateway
    if (connectionState === 'connected') {
      try {
        await gatewayClient.rpc('agent.stop')
      } catch {
        // Best effort
      }
    }
  }

  return (
    <div className="flex shrink-0 items-center justify-center border-t border-border bg-background px-4 py-2">
      <button
        onClick={handleClick}
        className={`flex items-center gap-2 rounded-md px-4 py-1.5 text-sm font-medium transition-all ${
          confirming
            ? 'animate-pulse bg-red-600 text-white'
            : 'bg-red-500/10 text-red-600 hover:bg-red-500/20 dark:text-red-400'
        }`}
        aria-label={confirming ? 'Confirm: Stop all agent activity' : 'Emergency stop'}
      >
        <OctagonX className="h-4 w-4" />
        {confirming ? 'CONFIRM: Stop All Agent Activity?' : 'Emergency Stop'}
      </button>
    </div>
  )
}
