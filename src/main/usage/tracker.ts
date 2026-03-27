import { getMemoryDb } from '../memory/db'
import { calculateCost } from './pricing'

// Ensure usage tables exist (called once on init)
export function ensureUsageTables(): void {
  const db = getMemoryDb()

  db.exec(`
    CREATE TABLE IF NOT EXISTS usage_tracking (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      month_year TEXT NOT NULL UNIQUE,
      total_cost_usd REAL DEFAULT 0,
      request_count INTEGER DEFAULT 0,
      last_request_at TEXT
    );

    CREATE TABLE IF NOT EXISTS request_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      model TEXT NOT NULL,
      input_tokens INTEGER NOT NULL,
      output_tokens INTEGER NOT NULL,
      cache_write_tokens INTEGER DEFAULT 0,
      cache_read_tokens INTEGER DEFAULT 0,
      cost_usd REAL NOT NULL,
      logged_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS budget_alert (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      threshold_usd REAL
    );
  `)
}

function getMonthYear(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export function trackRequest(
  model: string,
  inputTokens: number,
  outputTokens: number,
  cacheWriteTokens = 0,
  cacheReadTokens = 0
): void {
  const db = getMemoryDb()
  const cost = calculateCost(model, inputTokens, outputTokens, cacheWriteTokens, cacheReadTokens)
  const monthYear = getMonthYear()

  const tx = db.transaction(() => {
    // Log the individual request
    db.prepare(
      `
      INSERT INTO request_logs (model, input_tokens, output_tokens, cache_write_tokens, cache_read_tokens, cost_usd)
      VALUES (?, ?, ?, ?, ?, ?)
    `
    ).run(model, inputTokens, outputTokens, cacheWriteTokens, cacheReadTokens, cost)

    // Upsert monthly aggregate (single statement, no read-then-write)
    db.prepare(
      `
      INSERT INTO usage_tracking (month_year, total_cost_usd, request_count, last_request_at)
      VALUES (?, ?, 1, datetime('now'))
      ON CONFLICT(month_year) DO UPDATE SET
        total_cost_usd = total_cost_usd + excluded.total_cost_usd,
        request_count = request_count + 1,
        last_request_at = datetime('now')
    `
    ).run(monthYear, cost)
  })
  tx()
}

export interface MonthlyUsage {
  totalCostUsd: number
  requestCount: number
  models: Record<string, number>
  budgetAlert: number | null
}

export function getMonthlyUsage(): MonthlyUsage {
  const db = getMemoryDb()
  const monthYear = getMonthYear()

  const row = db
    .prepare('SELECT total_cost_usd, request_count FROM usage_tracking WHERE month_year = ?')
    .get(monthYear) as { total_cost_usd: number; request_count: number } | undefined

  // Per-model breakdown for current month
  const modelRows = db
    .prepare(
      `
    SELECT model, SUM(cost_usd) as total
    FROM request_logs
    WHERE logged_at >= date('now', 'start of month')
    GROUP BY model
  `
    )
    .all() as Array<{ model: string; total: number }>

  const models: Record<string, number> = {}
  for (const r of modelRows) models[r.model] = r.total

  const alertRow = db.prepare('SELECT threshold_usd FROM budget_alert WHERE id = 1').get() as
    | { threshold_usd: number | null }
    | undefined

  return {
    totalCostUsd: row?.total_cost_usd ?? 0,
    requestCount: row?.request_count ?? 0,
    models,
    budgetAlert: alertRow?.threshold_usd ?? null
  }
}

export function setBudgetAlert(usd: number | null): void {
  const db = getMemoryDb()
  if (usd === null) {
    db.prepare('DELETE FROM budget_alert WHERE id = 1').run()
  } else {
    db.prepare('INSERT OR REPLACE INTO budget_alert (id, threshold_usd) VALUES (1, ?)').run(usd)
  }
}

export function getBudgetAlert(): number | null {
  const db = getMemoryDb()
  const row = db.prepare('SELECT threshold_usd FROM budget_alert WHERE id = 1').get() as
    | { threshold_usd: number | null }
    | undefined
  return row?.threshold_usd ?? null
}
