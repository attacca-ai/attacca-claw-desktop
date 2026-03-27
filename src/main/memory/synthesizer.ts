import { randomUUID } from 'crypto'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { app } from 'electron'
import { llmCompletion } from '../llm/completion'
import { readConfig } from '../gateway/config'
import { parseLlmJson } from '../lib/parse-llm-json'
import {
  getMemoriesSince,
  getAllIdentityTraits,
  getLastSynthesis,
  upsertIdentity,
  updateImportance,
  supersedeMemory,
  insertSynthesisLog,
  getMemoryDb,
  type MemoryRow,
  type SynthesisLogRow
} from './db'

// ── LLM Helper ──────────────────────────────────────────────────────────────

// Cheapest model per provider — synthesis doesn't need top-tier reasoning
const CHEAP_MODELS: Record<string, string> = {
  anthropic: 'claude-haiku-4-5-20251001',
  openai: 'gpt-4o-mini',
  google: 'gemini-2.0-flash'
}

async function synthesisLlmCall(systemPrompt: string, userPrompt: string): Promise<string> {
  const config = readConfig()
  const provider = config.llm?.provider ?? 'anthropic'
  const model = CHEAP_MODELS[provider] ?? CHEAP_MODELS.anthropic

  const response = await llmCompletion({
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ],
    model,
    max_tokens: 2000
  })
  return response.content
}

// ── Daily Synthesis ─────────────────────────────────────────────────────────

const MIN_MEMORIES_FOR_DAILY = 3

interface DailyObservation {
  pattern: string
  evidence_ids: string[]
  suggested_trait_key: string | null
  suggested_trait_value: string | null
  confidence: number
}

interface ImportanceAdjustment {
  memory_id: string
  new_importance: number
  reason: string
}

export async function runDailySynthesis(): Promise<void> {
  const lastDaily = getLastSynthesis('daily')
  const since = lastDaily?.created_at ?? 0
  const memories = getMemoriesSince(since)

  if (memories.length < MIN_MEMORIES_FOR_DAILY) {
    console.log(
      `[synthesis] Daily skipped — only ${memories.length} new memories (minimum ${MIN_MEMORIES_FOR_DAILY})`
    )
    return
  }

  const currentTraits = getAllIdentityTraits()
  const traitsStr =
    currentTraits.length > 0
      ? currentTraits.map((t) => `- ${t.key}: ${t.value} (confidence: ${t.confidence})`).join('\n')
      : 'None yet'

  const memoriesStr = memories
    .map((m, i) => `${i + 1}. [${m.type}] ${m.summary}\n   ${m.content.slice(0, 500)}`)
    .join('\n\n')

  const systemPrompt =
    "You are analyzing a user's recent notes, captures, and decisions to identify patterns. Respond with JSON only."

  const userPrompt = `Here are the memories captured since ${lastDaily ? new Date(lastDaily.created_at).toISOString() : 'the beginning'}:

${memoriesStr}

Existing identity traits (for context — do not repeat these):
${traitsStr}

Respond with JSON only:
{
  "observations": [
    {
      "pattern": "Short description of the observed pattern",
      "evidence_ids": ["mem_xxx", "mem_yyy"],
      "suggested_trait_key": "snake_case_key or null if not yet confident",
      "suggested_trait_value": "value or null",
      "confidence": 0.0-1.0
    }
  ],
  "importance_adjustments": [
    {
      "memory_id": "mem_xxx",
      "new_importance": 0.0-1.0,
      "reason": "Why this memory's importance should change"
    }
  ]
}

Rules:
- Only suggest a trait (suggested_trait_key != null) if confidence >= 0.6 AND at least 2 evidence memories support it
- Observations with confidence < 0.6 are stored for future weekly synthesis to potentially promote
- importance_adjustments: raise importance for memories that are part of a pattern, lower for one-off captures that duplicate existing knowledge
- Keep observations concise (1 sentence each)
- Maximum 5 observations per run`

  const raw = await synthesisLlmCall(systemPrompt, userPrompt)

  let result: { observations: DailyObservation[]; importance_adjustments: ImportanceAdjustment[] }
  try {
    result = parseLlmJson(raw)
  } catch {
    console.error('[synthesis] Daily: failed to parse LLM response')
    return
  }

  // Apply observations → identity traits
  let traitsUpdated = 0
  for (const obs of result.observations ?? []) {
    if (obs.suggested_trait_key && obs.confidence >= 0.6 && obs.evidence_ids.length >= 2) {
      upsertIdentity(
        obs.suggested_trait_key,
        obs.suggested_trait_value ?? obs.pattern,
        obs.evidence_ids,
        obs.confidence
      )
      traitsUpdated++
    }
  }

  // Apply importance adjustments
  for (const adj of result.importance_adjustments ?? []) {
    updateImportance(adj.memory_id, Math.max(0.1, Math.min(1.0, adj.new_importance)))
  }

  // Log synthesis run
  const logEntry: SynthesisLogRow = {
    id: `synth_daily_${randomUUID()}`,
    run_date: new Date().toISOString().slice(0, 10),
    type: 'daily',
    input_memory_ids: JSON.stringify(memories.map((m) => m.id)),
    output_memory_ids: JSON.stringify([]),
    identity_updates: JSON.stringify(result.observations ?? []),
    created_at: Date.now()
  }
  insertSynthesisLog(logEntry)

  console.log(
    `[synthesis] Daily: ${result.observations?.length ?? 0} observations, ${traitsUpdated} traits updated, ${result.importance_adjustments?.length ?? 0} importance adjustments`
  )
}

// ── Weekly Synthesis ─────────────────────────────────────────────────────────

interface IdentityUpdate {
  key: string
  value: string
  evidence_ids: string[]
  confidence: number
  action: 'create' | 'update' | 'remove'
}

interface MemorySupersession {
  old_id: string
  reason: string
}

export async function runWeeklySynthesis(): Promise<void> {
  // Check if at least one daily synthesis ran this week
  const lastWeekly = getLastSynthesis('weekly')
  const lastDaily = getLastSynthesis('daily')
  const weekAgo = Date.now() - 7 * 86400000

  if (!lastDaily || lastDaily.created_at < weekAgo) {
    console.log('[synthesis] Weekly skipped — no daily synthesis ran this week')
    return
  }

  const since = lastWeekly?.created_at ?? weekAgo
  const memories = getMemoriesSince(since)
  const currentTraits = getAllIdentityTraits()

  if (memories.length === 0) {
    console.log('[synthesis] Weekly skipped — no memories this week')
    return
  }

  // Group memories by type
  const grouped: Record<string, MemoryRow[]> = {}
  for (const m of memories) {
    if (!grouped[m.type]) grouped[m.type] = []
    grouped[m.type].push(m)
  }
  const memoriesStr = Object.entries(grouped)
    .map(
      ([type, mems]) =>
        `### ${type} (${mems.length})\n${mems.map((m) => `- ${m.summary} [${m.id}]`).join('\n')}`
    )
    .join('\n\n')

  const traitsStr =
    currentTraits.length > 0
      ? currentTraits.map((t) => `- ${t.key}: ${t.value} (confidence: ${t.confidence})`).join('\n')
      : 'None yet'

  // Get daily observations from this week's synthesis logs
  const db = getMemoryDb()
  const dailyLogs = db
    .prepare('SELECT identity_updates FROM synthesis_log WHERE type = ? AND created_at >= ?')
    .all('daily', since) as Array<{ identity_updates: string }>
  const dailyObservations = dailyLogs
    .flatMap((log) => {
      try {
        return JSON.parse(log.identity_updates)
      } catch {
        return []
      }
    })
    .filter((obs: DailyObservation) => obs.confidence < 0.6)

  const obsStr =
    dailyObservations.length > 0
      ? dailyObservations
          .map((o: DailyObservation) => `- ${o.pattern} (confidence: ${o.confidence})`)
          .join('\n')
      : 'None'

  const systemPrompt =
    "You are performing a weekly analysis of a user's accumulated knowledge, patterns, and identity. Respond with JSON only."

  const userPrompt = `## This Week's Memories (${memories.length} total)
${memoriesStr}

## Daily Observations (not yet promoted to traits)
${obsStr}

## Current Identity Profile
${traitsStr}

Respond with JSON only:
{
  "identity_updates": [
    {
      "key": "snake_case_key",
      "value": "Updated or new trait value",
      "evidence_ids": ["mem_xxx", "mem_yyy", "mem_zzz"],
      "confidence": 0.0-1.0,
      "action": "create | update | remove"
    }
  ],
  "memory_supersessions": [
    {
      "old_id": "mem_xxx",
      "reason": "Why this memory is redundant or superseded"
    }
  ],
  "context_summary": "2-3 sentence summary of this user's current focus, priorities, and notable patterns."
}

Rules:
- Only promote observations to identity traits if confidence >= 0.6 with 3+ evidence memories
- "remove" action: only if a trait is contradicted by recent evidence (set confidence to 0.1)
- memory_supersessions: mark memories fully captured by newer, more complete memories
- context_summary: focus on CURRENT state (this week's priorities, active projects, recent decisions)
- Maximum 10 identity updates per run
- Maximum 20 memory supersessions per run`

  const raw = await synthesisLlmCall(systemPrompt, userPrompt)

  let result: {
    identity_updates: IdentityUpdate[]
    memory_supersessions: MemorySupersession[]
    context_summary: string
  }
  try {
    result = parseLlmJson(raw)
  } catch {
    console.error('[synthesis] Weekly: failed to parse LLM response')
    return
  }

  const runId = `synth_weekly_${randomUUID()}`

  // Apply identity updates
  let identityUpdated = 0
  for (const update of result.identity_updates ?? []) {
    if (update.action === 'remove') {
      upsertIdentity(update.key, update.value, update.evidence_ids, 0.1)
    } else {
      upsertIdentity(update.key, update.value, update.evidence_ids, update.confidence)
    }
    identityUpdated++
  }

  // Apply memory supersessions
  let superseded = 0
  for (const sup of result.memory_supersessions ?? []) {
    supersedeMemory(sup.old_id, runId)
    superseded++
  }

  // Update CONTEXT.md weekly summary
  if (result.context_summary) {
    updateContextSummary(result.context_summary)
  }

  // Log synthesis run
  const logEntry: SynthesisLogRow = {
    id: runId,
    run_date: new Date().toISOString().slice(0, 10),
    type: 'weekly',
    input_memory_ids: JSON.stringify(memories.map((m) => m.id)),
    output_memory_ids: JSON.stringify([]),
    identity_updates: JSON.stringify(result.identity_updates ?? []),
    created_at: Date.now()
  }
  insertSynthesisLog(logEntry)

  console.log(
    `[synthesis] Weekly: ${identityUpdated} identity updates, ${superseded} supersessions, context updated`
  )
}

// ── Importance Decay ────────────────────────────────────────────────────────

export function runImportanceDecay(): number {
  const db = getMemoryDb()
  const THIRTY_DAYS_MS = 30 * 86400000
  const cutoff = Date.now() - THIRTY_DAYS_MS

  const rows = db
    .prepare(
      'SELECT id, importance FROM memories WHERE superseded_by IS NULL AND accessed_at < ? AND importance > 0.1'
    )
    .all(cutoff) as Array<{ id: string; importance: number }>

  const stmt = db.prepare('UPDATE memories SET importance = ? WHERE id = ?')
  let decayed = 0
  const tx = db.transaction(() => {
    for (const row of rows) {
      const newImportance = Math.max(0.1, row.importance * 0.9)
      stmt.run(newImportance, row.id)
      decayed++
    }
  })
  tx()

  console.log(`[synthesis] Importance decay: ${decayed} memories decayed`)
  return decayed
}

// ── CONTEXT.md Update ───────────────────────────────────────────────────────

function updateContextSummary(summary: string): void {
  const ctxPath = join(app.getPath('userData'), 'attacca-kb', 'memory', 'CONTEXT.md')
  const dir = dirname(ctxPath)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })

  let content = existsSync(ctxPath) ? readFileSync(ctxPath, 'utf-8') : ''

  const weeklySectionHeader = '## Weekly Summary'
  const weeklySectionContent = `${weeklySectionHeader}\n<!-- Auto-generated by weekly synthesis — do not edit manually -->\n${summary}\n`

  if (content.includes(weeklySectionHeader)) {
    // Replace existing weekly summary section
    content = content.replace(
      /## Weekly Summary\n<!-- Auto-generated[^\n]*\n[\s\S]*?(?=\n## |$)/,
      weeklySectionContent
    )
  } else {
    // Prepend weekly summary before other sections
    content = weeklySectionContent + '\n' + content
  }

  writeFileSync(ctxPath, content, 'utf-8')
}
