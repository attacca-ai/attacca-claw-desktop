import { app } from 'electron'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { getAnonymousId } from '../identity/user-identity'
import { loadQueue, saveQueue, clearQueue } from './store'
import type { TelemetryEvent } from './types'

const FLUSH_INTERVAL_MS = 60 * 1000 // 1 minute

// Datadog HTTP intake (US5 region)
const DATADOG_LOGS_URL = 'https://http-intake.logs.us5.datadoghq.com/api/v2/logs'

// Build-time env var — baked into the binary by CI/CD. Not in source code.
// If not set (fork builds), telemetry silently disables — events queue locally but never flush.
const DD_CLIENT_KEY = process.env.DD_CLIENT_KEY ?? ''

class TelemetryCollector {
  private queue: TelemetryEvent[] = []
  private optIn = false
  private anonymousId = ''
  private flushTimer: ReturnType<typeof setInterval> | null = null
  private lastFlush: string | null = null
  private optInPath: string

  constructor() {
    this.optInPath = join(app.getPath('userData'), 'telemetry-opt-in.json')
    this.loadOptIn()
    this.queue = loadQueue()
    this.anonymousId = getAnonymousId()

    // Start periodic flush
    this.flushTimer = setInterval(() => this.flush(), FLUSH_INTERVAL_MS)
  }

  private loadOptIn(): void {
    try {
      if (existsSync(this.optInPath)) {
        const data = JSON.parse(readFileSync(this.optInPath, 'utf-8'))
        this.optIn = data.optIn === true
      }
    } catch {
      this.optIn = false
    }
  }

  private saveOptIn(): void {
    writeFileSync(this.optInPath, JSON.stringify({ optIn: this.optIn }), 'utf-8')
  }

  setOptIn(optIn: boolean): void {
    this.optIn = optIn
    this.saveOptIn()

    if (!optIn) {
      this.queue = []
      clearQueue()
    } else {
      this.flush().catch(() => {})
    }
  }

  getOptIn(): boolean {
    return this.optIn
  }

  getLastFlush(): string | null {
    return this.lastFlush
  }

  getQueueSize(): number {
    return this.queue.length
  }

  getQueuedEvents(): TelemetryEvent[] {
    return [...this.queue]
  }

  emit(eventType: string, payload: Record<string, unknown>): void {
    if (!this.optIn) return

    const event: TelemetryEvent = {
      eventType,
      payload,
      timestamp: new Date().toISOString(),
      anonymousId: this.anonymousId
    }

    this.queue.push(event)
    saveQueue(this.queue)
    console.log(`[telemetry] Queued event: ${eventType}`, JSON.stringify(payload))
    this.flush().catch(() => {})
  }

  async flush(): Promise<void> {
    if (!this.optIn || this.queue.length === 0) return

    // If no Datadog key, events stay queued locally but never send
    if (!DD_CLIENT_KEY) return

    const batch = [...this.queue]
    this.queue = []
    saveQueue(this.queue)

    try {
      // Convert Attacca events to Datadog log format
      const ddLogs = batch.map((event) => ({
        ddsource: 'attacca-claw',
        service: 'attacca-claw',
        hostname: `attacca-${process.platform}`,
        ddtags: `env:production,version:${app.getVersion()}`,
        message: event.eventType,
        date: event.timestamp,
        attributes: {
          evt: event.eventType,
          ...event.payload
        },
        usr: { id: event.anonymousId }
      }))

      const response = await fetch(DATADOG_LOGS_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'DD-API-KEY': DD_CLIENT_KEY
        },
        body: JSON.stringify(ddLogs)
      })

      if (!response.ok) {
        // Put events back in queue for retry
        this.queue = [...batch, ...this.queue]
        saveQueue(this.queue)
        console.error('[telemetry] Datadog flush failed:', response.status)
      } else {
        this.lastFlush = new Date().toISOString()
        console.log(
          `[telemetry] Flushed ${batch.length} event(s) to Datadog:`,
          batch.map((e) => e.eventType).join(', ')
        )
      }
    } catch (err) {
      // Network error — put events back
      this.queue = [...batch, ...this.queue]
      saveQueue(this.queue)
      console.error('[telemetry] Flush error:', err)
    }
  }

  async deleteData(): Promise<void> {
    this.queue = []
    clearQueue()
  }

  destroy(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer)
      this.flushTimer = null
    }
  }
}

let collectorInstance: TelemetryCollector | null = null

export function initTelemetryCollector(): TelemetryCollector {
  if (!collectorInstance) {
    collectorInstance = new TelemetryCollector()
  }
  return collectorInstance
}

export function getTelemetryCollector(): TelemetryCollector {
  if (!collectorInstance) {
    return initTelemetryCollector()
  }
  return collectorInstance
}
