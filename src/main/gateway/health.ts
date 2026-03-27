import WebSocket from 'ws'
import { getGatewayUrl } from './config'
import { getGatewayState } from './lifecycle'

let healthInterval: ReturnType<typeof setInterval> | null = null

export interface HealthStatus {
  ok: boolean
  latency: number | null
  error: string | null
  checkedAt: number
}

export async function checkGatewayHealth(): Promise<HealthStatus> {
  const gatewayState = getGatewayState()

  if (gatewayState.state !== 'running') {
    return {
      ok: false,
      latency: null,
      error: `Gateway is ${gatewayState.state}`,
      checkedAt: Date.now()
    }
  }

  const url = getGatewayUrl()
  const start = Date.now()

  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      ws.close()
      resolve({
        ok: false,
        latency: null,
        error: 'Health check timed out (5s)',
        checkedAt: Date.now()
      })
    }, 5000)

    const ws = new WebSocket(url)

    ws.on('open', () => {
      const latency = Date.now() - start
      clearTimeout(timeout)
      ws.close()
      resolve({
        ok: true,
        latency,
        error: null,
        checkedAt: Date.now()
      })
    })

    ws.on('error', (err) => {
      clearTimeout(timeout)
      resolve({
        ok: false,
        latency: null,
        error: err.message,
        checkedAt: Date.now()
      })
    })
  })
}

export function startHealthMonitor(intervalMs = 30_000): void {
  stopHealthMonitor()
  healthInterval = setInterval(async () => {
    const status = await checkGatewayHealth()
    if (!status.ok) {
      console.warn('[health] Gateway health check failed:', status.error)
    }
  }, intervalMs)
}

export function stopHealthMonitor(): void {
  if (healthInterval) {
    clearInterval(healthInterval)
    healthInterval = null
  }
}
