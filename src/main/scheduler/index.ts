import * as cron from 'node-cron'
import { powerMonitor } from 'electron'
import { getMemoryDb } from '../memory/db'

export interface ScheduledTask {
  id: string
  name: string
  description: string
  cronExpression: string
  enabled: boolean
  handler: () => Promise<void>
  requiresIdle: boolean
  lastRun: number | null
  lastResult: 'success' | 'failed' | 'skipped' | null
  lastError: string | null
}

const tasks: Map<string, ScheduledTask> = new Map()
const cronJobs: Map<string, cron.ScheduledTask> = new Map()
const retryTimers: Map<string, ReturnType<typeof setTimeout>> = new Map()

const IDLE_THRESHOLD_SECONDS = 300 // 5 minutes

function isAppIdle(): boolean {
  try {
    return powerMonitor.getSystemIdleTime() >= IDLE_THRESHOLD_SECONDS
  } catch {
    return true // assume idle if detection fails
  }
}

/**
 * Register a background task with a cron schedule.
 */
export function registerTask(
  task: Omit<ScheduledTask, 'lastRun' | 'lastResult' | 'lastError'>
): void {
  const persisted = loadTaskState(task.id)

  const fullTask: ScheduledTask = {
    ...task,
    enabled: persisted?.enabled ?? task.enabled,
    lastRun: persisted?.lastRun ?? null,
    lastResult: (persisted?.lastResult as ScheduledTask['lastResult']) ?? null,
    lastError: persisted?.lastError ?? null
  }

  tasks.set(task.id, fullTask)

  if (fullTask.enabled) {
    scheduleTask(fullTask)
  }
}

function scheduleTask(task: ScheduledTask): void {
  cronJobs.get(task.id)?.stop()

  const job = cron.schedule(
    task.cronExpression,
    async () => {
      if (task.requiresIdle && !isAppIdle()) {
        console.log(`[scheduler] ${task.id} skipped — user is active`)
        task.lastResult = 'skipped'
        saveTaskState(task)
        // Retry once in 5 minutes (tracked for cleanup on quit)
        const existing = retryTimers.get(task.id)
        if (existing) clearTimeout(existing)
        retryTimers.set(
          task.id,
          setTimeout(
            async () => {
              retryTimers.delete(task.id)
              if (isAppIdle()) {
                await executeTask(task)
              }
            },
            5 * 60 * 1000
          )
        )
        return
      }

      await executeTask(task)
    },
    {
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
    }
  )

  cronJobs.set(task.id, job)
}

async function executeTask(task: ScheduledTask): Promise<void> {
  try {
    console.log(`[scheduler] Running: ${task.id}`)
    await task.handler()
    task.lastRun = Date.now()
    task.lastResult = 'success'
    task.lastError = null
  } catch (err) {
    task.lastRun = Date.now()
    task.lastResult = 'failed'
    task.lastError = (err as Error).message
    console.error(`[scheduler] ${task.id} failed:`, err)
  }

  saveTaskState(task)
}

/**
 * Enable or disable a task at runtime.
 */
export function setTaskEnabled(taskId: string, enabled: boolean): void {
  const task = tasks.get(taskId)
  if (!task) return

  task.enabled = enabled
  if (enabled) {
    scheduleTask(task)
  } else {
    cronJobs.get(taskId)?.stop()
    cronJobs.delete(taskId)
  }
  saveTaskState(task)
}

/**
 * Manually trigger a task (from UI or IPC). Skips idle check.
 */
export async function runTaskNow(taskId: string): Promise<void> {
  const task = tasks.get(taskId)
  if (!task) throw new Error(`Unknown task: ${taskId}`)
  await executeTask(task)
}

/**
 * Get status of all registered tasks (for System Health UI).
 */
export function getTaskStatuses(): Array<{
  id: string
  name: string
  description: string
  enabled: boolean
  lastRun: number | null
  lastResult: string | null
  lastError: string | null
}> {
  return Array.from(tasks.values()).map((t) => ({
    id: t.id,
    name: t.name,
    description: t.description,
    enabled: t.enabled,
    lastRun: t.lastRun,
    lastResult: t.lastResult,
    lastError: t.lastError
  }))
}

/**
 * Stop all tasks. Call on app quit.
 */
export function stopAll(): void {
  for (const job of cronJobs.values()) {
    job.stop()
  }
  cronJobs.clear()
  for (const timer of retryTimers.values()) {
    clearTimeout(timer)
  }
  retryTimers.clear()
}

// ── Persistence ──────────────────────────────────────────────────────────

interface TaskState {
  lastRun: number | null
  lastResult: string | null
  lastError: string | null
  enabled: boolean
}

function loadTaskState(taskId: string): TaskState | null {
  try {
    const db = getMemoryDb()
    const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(`task:${taskId}`) as
      | { value: string }
      | undefined
    return row ? JSON.parse(row.value) : null
  } catch {
    return null
  }
}

function saveTaskState(task: ScheduledTask): void {
  try {
    const db = getMemoryDb()
    const state: TaskState = {
      lastRun: task.lastRun,
      lastResult: task.lastResult,
      lastError: task.lastError,
      enabled: task.enabled
    }
    db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').run(
      `task:${task.id}`,
      JSON.stringify(state)
    )
  } catch (err) {
    console.warn(`[scheduler] Failed to persist state for ${task.id}:`, err)
  }
}
