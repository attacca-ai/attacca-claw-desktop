import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { app } from 'electron'
import type { TelemetryEvent } from './types'

const QUEUE_FILE = 'telemetry-queue.json'

function getQueuePath(): string {
  return join(app.getPath('userData'), QUEUE_FILE)
}

export function loadQueue(): TelemetryEvent[] {
  const filePath = getQueuePath()
  if (!existsSync(filePath)) return []

  try {
    const raw = readFileSync(filePath, 'utf-8')
    const data = JSON.parse(raw)
    if (Array.isArray(data)) return data
    return []
  } catch {
    return []
  }
}

export function saveQueue(events: TelemetryEvent[]): void {
  const filePath = getQueuePath()
  const dir = dirname(filePath)

  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }

  writeFileSync(filePath, JSON.stringify(events), 'utf-8')
}

export function clearQueue(): void {
  saveQueue([])
}
