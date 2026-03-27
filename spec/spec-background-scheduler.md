---
date: 2026-03-18
tags: [spec, attacca, scheduler, cron, background]
status: active
relevant-to: [attacca-claw, memory-system]
depends-on: [spec-attacca-claw-open-source-transition]
---

# Spec — Background Task Scheduler

## 1. System Purpose

### What

Add a lightweight cron-style scheduler to the Electron main process that manages recurring background tasks: memory synthesis, importance decay, embedding migration, and future background intelligence features. Includes a System Health panel in the UI that surfaces scheduler activity.

### Why

The app currently uses scattered `setInterval` calls for health checks, license validation, and telemetry flushing. As we add synthesis (daily/weekly), decay, and future features (CRM, backups, proactive surfacing), we need a centralized scheduler that:

1. Runs tasks at the right time
2. Skips tasks when conditions aren't met (e.g., not enough data)
3. Persists last-run timestamps across app restarts
4. Surfaces activity to the user (transparency)

### Organizational Goal

Foundation for Phase 3 roadmap ("Background Intelligence"). Every future background feature (meeting polling, backups, CRM staleness checks) plugs into this scheduler. Build it once, use it for everything.

### Key Trade-Offs

| Trade-Off                                                 | Favored Side     | Condition                                                                                           |
| --------------------------------------------------------- | ---------------- | --------------------------------------------------------------------------------------------------- |
| Library (node-cron) vs custom implementation              | Library          | node-cron is 0 deps, well-tested, 15KB. No reason to reinvent                                       |
| Task isolation (worker threads) vs main thread            | Main thread      | Tasks are I/O-bound (DB queries + LLM calls), not CPU-bound. Worker thread overhead isn't justified |
| Complex scheduling (cron expressions) vs simple intervals | Cron expressions | Weekly synthesis needs "Sunday 3 AM", not "every 168 hours from startup"                            |
| Always-running vs only-when-idle                          | Hybrid           | Tasks check idle state themselves. Scheduler always fires; task decides whether to execute          |

### Hard Boundaries (NEVER Cross)

1. **Scheduler must NEVER run tasks during active user interaction.** Each task checks `isAppIdle()` before executing. If not idle, reschedule for 5 minutes later
2. **Failed tasks must NEVER crash the app.** Every task runs in a try-catch. Failures are logged and surfaced in System Health, not thrown
3. **Scheduler must NEVER make external network calls on its own.** Tasks that need LLM or API calls use the user's configured keys through the standard LLM client
4. **All task state must be persisted.** If the app restarts, the scheduler knows when each task last ran and doesn't re-run immediately

---

## 2. Current Architecture (What Exists)

### Existing Interval-Based Tasks

| Task                    | Location                          | Mechanism     | Interval |
| ----------------------- | --------------------------------- | ------------- | -------- |
| Gateway health check    | `src/main/gateway/health.ts`      | `setInterval` | 30s      |
| Telemetry flush         | `src/main/telemetry/collector.ts` | `setInterval` | 60s      |
| Gateway startup timeout | `src/main/gateway/lifecycle.ts`   | `setTimeout`  | 10s      |

**Note:** License revalidation (`src/main/license/validator.ts`) was removed in the open-source transition — no license gate exists.

### What's Missing

- No centralized scheduler
- No cron-expression support
- No last-run persistence
- No idle detection
- No UI visibility into background tasks

---

## 3. Behavioral Specification

### 3.1 Scheduler Core

**Package:** `node-cron` (MIT, 0 deps, 15KB)

```bash
npm install node-cron
npm install -D @types/node-cron
```

**File to create:** `src/main/scheduler/index.ts`

```typescript
import cron from 'node-cron'
import { getMemoryDb } from '../memory/db'
import { app, powerMonitor } from 'electron'

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

// Idle detection: user hasn't interacted for 5+ minutes
const IDLE_THRESHOLD_SECONDS = 300

function isAppIdle(): boolean {
  return powerMonitor.getSystemIdleTime() >= IDLE_THRESHOLD_SECONDS
}

/**
 * Register a background task with a cron schedule.
 */
export function registerTask(
  task: Omit<ScheduledTask, 'lastRun' | 'lastResult' | 'lastError'>
): void {
  // Load persisted state
  const persisted = loadTaskState(task.id)

  const fullTask: ScheduledTask = {
    ...task,
    lastRun: persisted?.lastRun ?? null,
    lastResult: persisted?.lastResult ?? null,
    lastError: persisted?.lastError ?? null
  }

  tasks.set(task.id, fullTask)

  if (task.enabled) {
    scheduleTask(fullTask)
  }
}

function scheduleTask(task: ScheduledTask): void {
  // Cancel existing job if any
  cronJobs.get(task.id)?.stop()

  const job = cron.schedule(
    task.cronExpression,
    async () => {
      if (task.requiresIdle && !isAppIdle()) {
        console.log(`[scheduler] ${task.id} skipped — user is active`)
        task.lastResult = 'skipped'
        saveTaskState(task)
        // Retry in 5 minutes
        setTimeout(() => task.handler().catch(() => {}), 5 * 60 * 1000)
        return
      }

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
    },
    {
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
    }
  )

  cronJobs.set(task.id, job)
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
 * Manually trigger a task (from UI or IPC).
 */
export async function runTaskNow(taskId: string): Promise<void> {
  const task = tasks.get(taskId)
  if (!task) throw new Error(`Unknown task: ${taskId}`)
  await task.handler()
  task.lastRun = Date.now()
  task.lastResult = 'success'
  task.lastError = null
  saveTaskState(task)
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
  nextRun: string | null
}> {
  return Array.from(tasks.values()).map((t) => ({
    id: t.id,
    name: t.name,
    description: t.description,
    enabled: t.enabled,
    lastRun: t.lastRun,
    lastResult: t.lastResult,
    lastError: t.lastError,
    nextRun: null // node-cron doesn't expose next run time easily; can compute if needed
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
    // Ensure meta table exists (created by local-embeddings migration)
    db.exec('CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)')
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
    console.warn(`[scheduler] Failed to persist task state for ${task.id}:`, err)
  }
}
```

### 3.2 Task Registration

**File to create:** `src/main/scheduler/tasks.ts`

Registers all background tasks at app startup:

```typescript
import { registerTask } from './index'

export function registerAllTasks(): void {
  // ── Memory Synthesis ─────────────────────────────────────

  registerTask({
    id: 'daily-synthesis',
    name: 'Daily Memory Synthesis',
    description: 'Analyzes recent captures to identify patterns and update identity traits',
    cronExpression: '0 2 * * *', // 2:00 AM daily
    enabled: true,
    requiresIdle: true,
    handler: async () => {
      const { runDailySynthesis } = await import('../memory/synthesizer')
      await runDailySynthesis()
    }
  })

  registerTask({
    id: 'weekly-synthesis',
    name: 'Weekly Deep Synthesis',
    description:
      'Deep analysis of the week — promotes patterns to identity traits, compacts old memories',
    cronExpression: '0 3 * * 0', // 3:00 AM Sunday
    enabled: true,
    requiresIdle: true,
    handler: async () => {
      const { runWeeklySynthesis } = await import('../memory/synthesizer')
      await runWeeklySynthesis()
    }
  })

  // ── Importance Decay ─────────────────────────────────────

  registerTask({
    id: 'importance-decay',
    name: 'Memory Importance Decay',
    description: 'Reduces importance of memories not accessed in 30+ days',
    cronExpression: '0 4 * * 0', // 4:00 AM Sunday (after weekly synthesis)
    enabled: true,
    requiresIdle: false, // lightweight DB-only operation
    handler: async () => {
      const { runImportanceDecay } = await import('../memory/synthesizer')
      await runImportanceDecay()
    }
  })

  // ── Embedding Backfill ───────────────────────────────────

  registerTask({
    id: 'embedding-backfill',
    name: 'Embedding Backfill',
    description:
      'Generates embeddings for memories that were saved without them (offline captures)',
    cronExpression: '*/30 * * * *', // Every 30 minutes
    enabled: true,
    requiresIdle: true,
    handler: async () => {
      const { backfillEmbeddings } = await import('../memory/migrate-embeddings')
      await backfillEmbeddings()
    }
  })
}
```

### 3.3 App Integration

**File to modify:** `src/main/index.ts`

Current startup sequence: `initTelemetryCollector()` → `registerIpcHandlers()` → `createMainWindow()` → `createTray()` → `getMemoryDb()` → `startMemoryServer()` → `ensureUsageTables()` → `startComposioServer()` → `startGateway()`.

Add scheduler after memory DB is initialized (tasks depend on SQLite meta table):

```typescript
import { registerAllTasks } from './scheduler/tasks'
import { stopAll } from './scheduler'

// In app.whenReady(), after getMemoryDb():
registerAllTasks()

// In quitApp(), before closeMemoryDb():
stopAll()
```

### 3.4 IPC Channels

**File to modify:** `src/main/ipc/channels.ts`

Add:

```typescript
SCHEDULER_GET_TASKS: 'scheduler:get-tasks',
SCHEDULER_SET_ENABLED: 'scheduler:set-enabled',
SCHEDULER_RUN_NOW: 'scheduler:run-now'
```

**File to modify:** `src/main/ipc/handlers.ts`

```typescript
ipcMain.handle(IPC.SCHEDULER_GET_TASKS, () => {
  return getTaskStatuses()
})

ipcMain.handle(IPC.SCHEDULER_SET_ENABLED, (_event, taskId: string, enabled: boolean) => {
  setTaskEnabled(taskId, enabled)
})

ipcMain.handle(IPC.SCHEDULER_RUN_NOW, async (_event, taskId: string) => {
  await runTaskNow(taskId)
})
```

**File to modify:** `src/preload/index.ts`

Add to `window.api`:

```typescript
scheduler: {
  getTasks: () => ipcRenderer.invoke('scheduler:get-tasks'),
  setEnabled: (taskId: string, enabled: boolean) => ipcRenderer.invoke('scheduler:set-enabled', taskId, enabled),
  runNow: (taskId: string) => ipcRenderer.invoke('scheduler:run-now', taskId)
}
```

### 3.5 System Health Panel

**File to create:** `src/renderer/src/components/settings/SystemHealth.tsx`

A panel in Settings that shows all scheduled tasks:

**Layout:**

```
┌─────────────────────────────────────────────────────────┐
│  System Health                                           │
├─────────────────────────────────────────────────────────┤
│  ● Daily Memory Synthesis          Last: 2h ago  ✓      │
│    Analyzes recent captures...     Next: 2:00 AM        │
│    [Enabled ○─●] [Run Now]                              │
│                                                          │
│  ● Weekly Deep Synthesis           Last: 3 days ago  ✓  │
│    Deep analysis of the week...    Next: Sun 3:00 AM    │
│    [Enabled ○─●] [Run Now]                              │
│                                                          │
│  ● Memory Importance Decay         Last: 3 days ago  ✓  │
│    Reduces importance of old...    Next: Sun 4:00 AM    │
│    [Enabled ○─●]                                        │
│                                                          │
│  ● Embedding Backfill              Last: 25 min ago  ✓  │
│    Generates embeddings for...     Next: 30 min         │
│    [Enabled ○─●]                                        │
│                                                          │
│  ─────────────────────────────────────────────────────  │
│  Memory Stats:  142 memories  │  128 with embeddings    │
│  Identity Traits: 8  │  Last synthesis: 2h ago          │
└─────────────────────────────────────────────────────────┘
```

**Data fetching:**

```typescript
const [tasks, setTasks] = useState<TaskStatus[]>([])

useEffect(() => {
  window.api.scheduler.getTasks().then(setTasks)
  const interval = setInterval(() => {
    window.api.scheduler.getTasks().then(setTasks)
  }, 30000) // refresh every 30s
  return () => clearInterval(interval)
}, [])
```

**Status indicators:**

- Green dot (●): last result = success
- Yellow dot (●): last result = skipped
- Red dot (●): last result = failed (show error on hover)
- Gray dot (●): never run

**Controls:**

- Toggle switch: enable/disable task
- "Run Now" button: manually trigger (disabled during execution)

**Integration:** Add as a section in `SettingsPage.tsx`, below the existing sections. Or as a new sidebar view `'system-health'` — depending on design preference. Since it's informational and low-traffic, nesting in Settings is simpler.

### 3.6 Migrate Existing Intervals

**Not in scope for initial implementation.** The existing `setInterval` tasks (health check, telemetry flush) work fine and run at high frequency (30s, 60s). Moving them to the cron scheduler would add complexity for no benefit. The scheduler is for **daily+ cadence tasks** that need persistence, idle checks, and UI visibility.

If future cleanup is desired, these can be migrated later — but it's not blocking.

---

## 4. Delegation Framework

| Decision                                   | Who Decides                    | Escalation                                               |
| ------------------------------------------ | ------------------------------ | -------------------------------------------------------- |
| Cron expressions for each task             | Spec — locked                  | Change if user feedback indicates bad timing             |
| Idle threshold (5 min)                     | Spec — 300 seconds             | None                                                     |
| node-cron vs custom                        | Spec — node-cron               | None                                                     |
| Task state persistence (SQLite meta table) | Spec — locked                  | None                                                     |
| UI placement (Settings vs sidebar)         | Agent — Settings section       | If Settings is too crowded, flag                         |
| Retry logic (5 min after idle skip)        | Agent — implement simple retry | Don't build exponential backoff — tasks run daily anyway |

---

## 5. Behavioral Scenarios

### Scenario 1: App Startup (Tasks Registered)

```
GIVEN: App launches for the first time
WHEN: registerAllTasks() runs
THEN:
  - 4 tasks registered (daily synthesis, weekly synthesis, decay, backfill)
  - All enabled by default
  - lastRun = null for all (never run)
  - node-cron jobs scheduled in user's local timezone
  - Console: "[scheduler] Registered 4 tasks"
```

### Scenario 2: Daily Synthesis Fires While User Is Active

```
GIVEN: It's 2:00 AM, user is still typing in the chat
WHEN: daily-synthesis cron fires
THEN:
  - isAppIdle() returns false (system idle time < 300s)
  - Task logged as 'skipped'
  - Retry scheduled for 5 minutes later
  - If user goes idle within those 5 minutes, synthesis runs
  - If still active, retry fires again (one retry only — next cron at 2 AM tomorrow)
```

### Scenario 3: Task Fails

```
GIVEN: Weekly synthesis is running
WHEN: LLM call fails (network error)
THEN:
  - Error caught by try-catch in scheduler
  - task.lastResult = 'failed'
  - task.lastError = 'Network error: ECONNREFUSED'
  - State persisted to SQLite
  - System Health shows red dot with error on hover
  - App continues normally — no crash, no retry spam
  - Task will run again at next scheduled time (next Sunday 3 AM)
```

### Scenario 4: User Disables a Task

```
GIVEN: System Health panel is open
WHEN: User toggles off "Weekly Deep Synthesis"
THEN:
  - IPC: scheduler:set-enabled('weekly-synthesis', false)
  - node-cron job stopped
  - State persisted (enabled: false)
  - After app restart, task remains disabled
  - User can re-enable at any time
```

### Scenario 5: Manual Trigger

```
GIVEN: User wants to force a synthesis run
WHEN: User clicks "Run Now" on Daily Memory Synthesis
THEN:
  - IPC: scheduler:run-now('daily-synthesis')
  - Task handler executes immediately (no idle check for manual triggers)
  - UI shows loading state on the button
  - On completion: lastRun updates, status refreshes
  - Green dot appears
```

### Scenario 6: App Restart Persistence

```
GIVEN: Daily synthesis last ran 18 hours ago, then app was closed
WHEN: App relaunches
THEN:
  - registerAllTasks() loads persisted state from SQLite meta table
  - daily-synthesis shows lastRun = 18h ago, lastResult = 'success'
  - Next cron fires at 2:00 AM as scheduled
  - No immediate re-run (cron schedule governs timing, not "time since last run")
```

---

## 6. File Inventory

### Files to CREATE

| Path                                                    | Purpose                                                 |
| ------------------------------------------------------- | ------------------------------------------------------- |
| `src/main/scheduler/index.ts`                           | Core scheduler: register, schedule, persist, idle check |
| `src/main/scheduler/tasks.ts`                           | Task registry: defines all background tasks             |
| `src/renderer/src/components/settings/SystemHealth.tsx` | UI panel showing task statuses                          |

### Files to MODIFY

| Path                                                    | Change                                                  |
| ------------------------------------------------------- | ------------------------------------------------------- |
| `src/main/index.ts` (or app entry)                      | Call `registerAllTasks()` on ready, `stopAll()` on quit |
| `src/main/ipc/channels.ts`                              | Add `scheduler:*` channels                              |
| `src/main/ipc/handlers.ts`                              | Add scheduler IPC handlers                              |
| `src/preload/index.ts`                                  | Expose `window.api.scheduler`                           |
| `src/renderer/src/components/settings/SettingsPage.tsx` | Add SystemHealth section                                |
| `package.json`                                          | Add `node-cron` + `@types/node-cron`                    |

### Files UNTOUCHED

| Path                              | Reason                                                               |
| --------------------------------- | -------------------------------------------------------------------- |
| `src/main/gateway/health.ts`      | Existing 30s health check stays as setInterval (not worth migrating) |
| `src/main/telemetry/collector.ts` | Existing 60s flush stays as setInterval                              |

---

## 7. Implementation Order

```
1. Install node-cron, create scheduler/index.ts
2. Create scheduler/tasks.ts with all 4 task registrations
3. Wire into app lifecycle (main/index.ts)
4. Add IPC channels + handlers + preload
5. Create SystemHealth.tsx component
6. Add to SettingsPage
7. Test: task registration → cron fires → handler executes → state persists → UI reflects
8. Test: disable/enable toggle persists across restart
9. Test: manual "Run Now" works
```

---

## 8. Future Tasks (Not In This Spec)

These tasks will be added to the scheduler in future phases:

| Task                       | Phase   | Cron          | Description                             |
| -------------------------- | ------- | ------------- | --------------------------------------- |
| Meeting transcript polling | Phase 3 | `*/5 * * * *` | Poll Fathom for new transcripts         |
| CRM staleness check        | Phase 3 | `0 9 * * 1`   | Flag contacts not contacted in 30+ days |
| Automated backups          | Phase 3 | `0 * * * *`   | Hourly backup of local DBs              |
| Self-update check          | Phase 3 | `0 21 * * *`  | Check for app updates at 9 PM           |

The scheduler is designed to accommodate these by simply adding new `registerTask()` calls in `tasks.ts`.

---

## 9. Connections

- [[spec-weekly-synthesis]] — Daily and weekly synthesis tasks are the primary consumers
- [[spec-local-embeddings]] — Embedding backfill task runs through scheduler
- [[attacca-claw-architecture-and-roadmap]] — Phase 3 roadmap: "Background Intelligence"
- [[spec-attacca-claw-open-source-transition]] — Scheduler replaces need for relay-based cron
