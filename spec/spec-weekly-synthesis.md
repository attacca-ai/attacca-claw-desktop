---
date: 2026-03-18
tags: [spec, attacca, memory, synthesis, identity]
status: active
relevant-to: [attacca-claw, memory-system]
depends-on: [spec-background-scheduler]
---

# Spec — Weekly Memory Synthesis

## 1. System Purpose

### What

Implement a daily and weekly synthesis engine that distills accumulated memories into identity traits, decays unused memories' importance, and compacts old daily logs. The agent's understanding of the user deepens automatically over time without manual curation.

### Why

The memory system currently captures and retrieves, but never learns patterns. A user who captures 100 notes over a month has 100 discrete items — no distilled understanding of "this user prefers concise communication" or "this user's key project is the Q2 launch." Synthesis transforms raw memory into actionable identity, which feeds into CONTEXT.md, morning briefings, and agent behavior.

### Organizational Goal

The "it gets smarter over time" loop. This is the feature that makes Attacca sticky — the longer you use it, the more it understands you, and the harder it is to switch. Without synthesis, the memory system is just a note store.

### Key Trade-Offs

| Trade-Off                                  | Favored Side              | Condition                                                                                               |
| ------------------------------------------ | ------------------------- | ------------------------------------------------------------------------------------------------------- |
| LLM cost per synthesis vs quality          | Accept cost               | One LLM call per synthesis run (~$0.01-0.05). Runs max once daily. Trivial compared to agent chat costs |
| Aggressive decay vs memory preservation    | Conservative decay        | Never delete — only reduce importance. User can always find old memories via keyword search             |
| Automated identity updates vs user control | Automated with visibility | Identity traits update automatically, but user can see and correct them in Settings                     |
| Synthesis frequency (daily vs weekly)      | Both                      | Daily = lightweight (new memories → patterns). Weekly = deep (patterns → identity traits)               |

### Hard Boundaries (NEVER Cross)

1. **Synthesis must NEVER delete memories.** It can reduce importance, supersede with a more refined version, but never DROP rows
2. **Identity trait updates must be evidence-backed.** Every trait must reference the memory IDs that support it. No hallucinated personality
3. **Synthesis must NEVER run during active user interaction.** Only when the app is idle or on a scheduled timer
4. **LLM calls for synthesis use the user's own key.** No hidden API costs — same BYOK key as agent chat

---

## 2. Current Architecture (What Exists)

### What's Built

- `synthesis_log` table with schema: `id, run_date, type (daily|weekly), input_memory_ids, output_memory_ids, identity_updates, created_at`
- `insertSynthesisLog()` and `getLastSynthesis()` queries in `db.ts`
- `identity` table with: `key, value, evidence (JSON array of memory IDs), confidence, updated_at`
- `upsertIdentity()`, `getIdentityTraits()`, `getAllIdentityTraits()` in `db.ts`
- Identity traits are already read by `readKbContext()` in `config.ts` and injected into SKILL.md

### What's Missing

- No `synthesizer.ts` runtime file
- No LLM call to analyze memories and extract patterns
- No importance decay logic
- No daily log compaction
- No trigger mechanism (depends on background scheduler spec)

---

## 3. Behavioral Specification

### 3.1 Daily Synthesis

**Purpose:** Process new memories captured since the last synthesis. Extract lightweight observations — patterns that might become identity traits with more evidence.

**Trigger:** Once per day, when the app has been idle for 5+ minutes AND at least 3 new memories exist since the last daily synthesis. If the user never captures 3 memories in a day, daily synthesis is skipped.

**File to create:** `src/main/memory/synthesizer.ts`

**Input:** All active memories created since the last daily synthesis (`getMemoriesSince(lastDailySynthesis.created_at)`).

**LLM Prompt:**

```
You are analyzing a user's recent notes, captures, and decisions to identify patterns.

Here are the memories captured since {{lastSynthesisDate}}:

{{memories as numbered list: type, summary, content (truncated to 500 chars)}}

Existing identity traits (for context — do not repeat these):
{{current identity traits as key: value list}}

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
- Maximum 5 observations per run
```

**Processing after LLM response:**

1. For each observation with `suggested_trait_key != null` and `confidence >= 0.6`:
   - Call `upsertIdentity(key, value, evidenceIds, confidence)`
   - If trait already exists: merge evidence arrays, use higher confidence
2. For each `importance_adjustment`:
   - Update the memory's importance in SQLite: `UPDATE memories SET importance = ? WHERE id = ?`
3. Insert a `synthesis_log` entry with type `'daily'`
4. Log: `[synthesis] Daily: {n} observations, {m} traits updated, {k} importance adjustments`

### 3.2 Weekly Synthesis

**Purpose:** Deep analysis across the full week's memories + daily observations. Promotes tentative observations to confirmed identity traits. Compacts redundant memories. Updates CONTEXT.md.

**Trigger:** Once per week (Sunday 3 AM local time, or on first idle after that time). Requires at least 1 daily synthesis to have run that week. If no daily synthesis ran, weekly synthesis is skipped.

**Input:**

- All active memories from the past 7 days
- All daily synthesis logs from the past 7 days (observations that weren't promoted to traits)
- Current identity traits

**LLM Prompt:**

```
You are performing a weekly analysis of a user's accumulated knowledge, patterns, and identity.

## This Week's Memories ({{count}} total)
{{memories grouped by type: captures, preferences, decisions}}

## Daily Observations (not yet promoted to traits)
{{observations from daily synthesis logs that had confidence < 0.6}}

## Current Identity Profile
{{all identity traits with confidence scores}}

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
  "context_summary": "2-3 sentence summary of this user's current focus, priorities, and notable patterns. This goes into CONTEXT.md."
}

Rules:
- Only promote observations to identity traits if confidence >= 0.6 with 3+ evidence memories
- "remove" action: only if a trait is contradicted by recent evidence (set confidence to 0.1, don't delete)
- memory_supersessions: mark memories that are fully captured by a newer, more complete memory. The superseded memory's content is preserved but excluded from active search
- context_summary: focus on CURRENT state (this week's priorities, active projects, recent decisions). Not historical
- Maximum 10 identity updates per run
- Maximum 20 memory supersessions per run
```

**Processing after LLM response:**

1. For each `identity_update`:
   - `action: "create"` or `"update"` → `upsertIdentity(key, value, evidenceIds, confidence)`
   - `action: "remove"` → `upsertIdentity(key, value, evidenceIds, 0.1)` (soft remove — drops below display threshold)
2. For each `memory_supersession`:
   - `supersedeMemory(old_id, 'weekly-synthesis-' + run_id)` — marks as superseded
3. Update CONTEXT.md with `context_summary`:
   - Read current CONTEXT.md
   - Replace the `## Weekly Summary` section (or append if none exists)
   - Write back
4. Insert `synthesis_log` with type `'weekly'`
5. Log: `[synthesis] Weekly: {n} identity updates, {m} supersessions, context updated`

### 3.3 Importance Decay

**Purpose:** Memories that are never accessed gradually lose importance, making room for newer, more relevant memories to rank higher in search results.

**Trigger:** Runs as part of weekly synthesis (after the LLM analysis).

**Logic:**

```typescript
function decayImportance(): number {
  const db = getMemoryDb()
  const THIRTY_DAYS_MS = 30 * 86400000
  const now = Date.now()

  // Memories not accessed in 30+ days: reduce importance by 10%
  // Floor: 0.1 (never fully zero — always findable by keyword)
  const rows = db
    .prepare(
      `
    SELECT id, importance FROM memories
    WHERE superseded_by IS NULL
    AND accessed_at < ?
    AND importance > 0.1
  `
    )
    .all(now - THIRTY_DAYS_MS) as Array<{ id: string; importance: number }>

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
  return decayed
}
```

### 3.4 CONTEXT.md Update

**File to modify:** The weekly synthesis writes to `{userData}/attacca-kb/memory/CONTEXT.md`.

**Format:**

```markdown
## Weekly Summary

<!-- Auto-generated by weekly synthesis — do not edit manually -->

{{context_summary from LLM}}

## Recent Captures

<!-- Auto-updated on each capture -->

- [2026-03-18] Meeting notes: Q2 planning session
- [2026-03-17] Decision: Switch to local embeddings
  ...

## Active Projects

...

## Key People

...
```

The `## Weekly Summary` section is the only part managed by synthesis. Other sections remain managed by the capture handler (existing behavior).

### 3.5 LLM Call Routing

Synthesis uses the same LLM path as agent chat — the user's BYOK key.

**Implementation:** Use the local LLM completion service (`src/main/llm/completion.ts`) which calls the user's BYOK provider directly.

**In the main process:**

```typescript
import { llmCompletion } from '../llm/completion'

async function synthesisLlmCall(systemPrompt: string, userPrompt: string): Promise<string> {
  // Use the cheapest model available — synthesis doesn't need top-tier reasoning
  const response = await llmCompletion({
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ],
    model: 'claude-haiku-4-5-20251001', // cheapest, sufficient for pattern extraction
    max_tokens: 2000
  })
  return response.content
}
```

**Cost estimate:**

- Daily synthesis: ~1K input tokens, ~500 output tokens → ~$0.001 with Haiku
- Weekly synthesis: ~5K input tokens, ~1K output tokens → ~$0.005 with Haiku
- Monthly total: ~$0.05 — negligible

---

## 4. Delegation Framework

| Decision                                              | Who Decides                            | Escalation                                     |
| ----------------------------------------------------- | -------------------------------------- | ---------------------------------------------- |
| LLM prompt wording                                    | Agent — implement as specced           | If response quality is poor, iterate on prompt |
| Confidence thresholds (0.6 for daily, 0.6 for weekly) | Spec — locked                          | Only change based on user feedback             |
| Decay rate (10% per 30 days, floor 0.1)               | Spec — locked                          | None                                           |
| Model choice for synthesis (Haiku)                    | Agent — use cheapest available         | If only expensive model available, still run   |
| Synthesis trigger timing                              | Spec — daily idle + weekly Sunday 3 AM | Scheduler spec handles exact cron expression   |
| CONTEXT.md format                                     | Agent — follow existing structure      | Don't break readKbContext() parsing            |

---

## 5. Behavioral Scenarios

### Scenario 1: First Daily Synthesis

```
GIVEN: User has captured 5 memories over 2 days, no synthesis has ever run
WHEN: App has been idle for 5+ minutes and scheduler triggers daily synthesis
THEN:
  - getLastSynthesis('daily') returns undefined → all active memories are input
  - LLM analyzes 5 memories
  - Returns 2 observations: "user frequently mentions Q2 launch" (confidence 0.7), "user prefers morning meetings" (confidence 0.4)
  - First observation → upsertIdentity('active_project', 'Q2 launch', [...], 0.7)
  - Second observation → stored in synthesis_log only (confidence < 0.6)
  - synthesis_log entry created
```

### Scenario 2: Weekly Promotion of Observations

```
GIVEN: 3 daily syntheses ran this week, each noting "user prefers concise communication" at confidence 0.5
WHEN: Weekly synthesis runs
THEN:
  - LLM sees the repeated observation across 3 daily logs
  - Promotes to identity trait: communication_style = "prefers concise, direct responses" at confidence 0.8
  - upsertIdentity() called
  - Next time agent generates a morning briefing, readKbContext() includes this trait
  - Agent adjusts behavior accordingly
```

### Scenario 3: Importance Decay

```
GIVEN: Memory "meeting notes from January" has importance 0.5, last accessed 45 days ago
WHEN: Weekly synthesis runs decay step
THEN:
  - importance decayed: 0.5 × 0.9 = 0.45
  - Memory still findable via search, but ranks lower
  - After 6 months of no access: importance ≈ 0.1 (floor)
  - Memory never deleted — keyword search still works
```

### Scenario 4: Identity Trait Correction

```
GIVEN: Identity trait "scheduling_preferences" = "prefers morning meetings" (confidence 0.6)
       User captures 3 new memories about scheduling afternoon meetings
WHEN: Weekly synthesis runs
THEN:
  - LLM sees contradiction between existing trait and new evidence
  - Returns identity_update with action: "update", new value: "flexible scheduling, recently shifting to afternoons"
  - Confidence updated based on combined evidence
```

### Scenario 5: Not Enough Data

```
GIVEN: User captured 1 memory this week
WHEN: Daily synthesis trigger fires
THEN:
  - Check: memories since last synthesis < 3 → skip
  - Log: "[synthesis] Daily skipped — only 1 new memory (minimum 3)"
  - No LLM call made, no cost incurred
```

### Scenario 6: No LLM Key Available

```
GIVEN: App is running but LLM API call fails (key expired, network down)
WHEN: Synthesis attempts to run
THEN:
  - LLM call fails gracefully
  - Log: "[synthesis] Daily synthesis failed: LLM unavailable"
  - No changes to identity or memories
  - Retry on next scheduled trigger
  - App continues to function normally
```

---

## 6. File Inventory

### Files to CREATE

| Path                             | Purpose                                                                             |
| -------------------------------- | ----------------------------------------------------------------------------------- |
| `src/main/memory/synthesizer.ts` | Core synthesis engine: daily + weekly analysis, importance decay, CONTEXT.md update |

### Files to MODIFY

| Path                       | Change                                                                                                                          |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `src/main/memory/db.ts`    | Add `getMemoriesForSynthesis()` helper (memories since date, grouped by type). Add `updateImportance(id, newImportance)` helper |
| `src/main/ipc/handlers.ts` | Add `memory:run-synthesis` IPC channel for manual trigger from Settings (optional)                                              |

### Files UNTOUCHED

| Path                         | Reason                                                                                   |
| ---------------------------- | ---------------------------------------------------------------------------------------- |
| `src/main/memory/search.ts`  | Search already uses importance in ranking — benefits automatically from decay            |
| `src/main/memory/server.ts`  | No changes — server calls existing search functions                                      |
| `src/main/gateway/config.ts` | `readKbContext()` already reads identity traits — benefits automatically from new traits |

---

## 7. Implementation Order

```
1. Create synthesizer.ts with daily synthesis function
2. Test daily synthesis with mock LLM response
3. Add weekly synthesis function
4. Add importance decay logic
5. Add CONTEXT.md weekly summary update
6. Wire into background scheduler (see spec-background-scheduler)
7. Test full cycle: capture → daily synthesis → weekly synthesis → identity trait appears in SKILL.md
```

---

## 8. Connections

- [[spec-background-scheduler]] — Provides the trigger mechanism for daily/weekly runs
- [[spec-local-embeddings]] — New memories from synthesis need embedding
- [[spec-attacca-claw-open-source-transition]] — Synthesis uses BYOK LLM key
- [[attacca-claw-architecture-and-roadmap]] — Phase 2 roadmap: "Self-Evolving Identity"
