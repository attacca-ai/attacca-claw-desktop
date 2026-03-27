---
date: 2026-03-17
tags: [spec, attacca, open-source, transition]
status: active
relevant-to: [attacca-claw, dark-factory]
---

# Spec — Attacca Claw Open Source Transition

## 1. System Purpose

### What

Transform Attacca Claw from a paid consumer product ($24.97/mo via Gumroad) into a fully open-source desktop application. Eliminate the central relay server dependency. All services move to local execution with user-provided API keys (BYOK). Telemetry transitions to opt-in Datadog integration for research.

### Why

No competitive advantage over OpenAI building directly on OpenClaw. Open source gains: community contributions, research telemetry at scale, zero infrastructure cost, Dark Factory credibility showcase, immigration proof of real business activity.

### Organizational Goal

Establish Attacca as a credible open-source AI company. The research telemetry (how non-technical users delegate to agents, trust tier usage patterns, task success/failure) is the long-term strategic asset — not subscription revenue.

### Key Trade-Offs

| Trade-Off                             | Favored Side    | Condition                                                                           |
| ------------------------------------- | --------------- | ----------------------------------------------------------------------------------- |
| Simplicity vs backward compatibility  | Simplicity      | No active subscribers exist. Hard cut, no migration paths                           |
| User friction vs zero infrastructure  | Accept friction | Users must obtain their own API keys. Guided wizard mitigates                       |
| Telemetry coverage vs user trust      | User trust      | Opt-in only. Transparency panel shows exactly what is sent. Less data is acceptable |
| Feature parity vs speed of transition | Speed           | Ship working open-source version first, polish later                                |

### Hard Boundaries (NEVER Cross)

1. **User API keys must NEVER leave the local machine.** No phoning home with secrets, no remote storage of keys, no analytics that include key material
2. **Trust architecture static floor must NOT be weakened.** The permission engine (`src/renderer/src/lib/permission-engine.ts`) is untouched. High-risk actions ALWAYS require human approval
3. **Telemetry must NEVER be enabled without explicit user consent.** Default is OFF. No silent collection, no dark patterns in the wizard
4. **No managed/hosted tier.** BYOK is the only LLM path. This is a hard cut, not a "for now"

---

## 2. Current Architecture (What Exists)

### Desktop App (Electron)

- **Runtime**: Electron 39, React 19, Zustand 5, Tailwind 4
- **Agent**: OpenClaw `^2026.2.19-2` as child process on `localhost:18789`
- **Local DB**: SQLite via `better-sqlite3` (memory, identity, synthesis)
- **Codebase**: `C:\Users\jhon1\projects\attacca`

### Relay Server (Being Eliminated)

- **Runtime**: Express.js on `localhost:3100`
- **DB**: PostgreSQL (usage_tracking, request_logs, telemetry_events, license_cache)
- **Location**: `C:\Users\jhon1\projects\attacca\relay-server\`

### Data Flow (Current)

```
User → LicenseGate (Gumroad verify) → App
App → Relay (Bearer licenseKey) → Anthropic/OpenAI (LLM)
App → Relay → Composio SDK (OAuth + tool execution)
App → Relay → PostgreSQL (usage tracking)
App → Relay → PostgreSQL (telemetry events)
```

### Data Flow (Target)

```
User → Setup Wizard (enter API keys) → App
App → Anthropic/OpenAI directly (user's own keys)
App → Composio SDK locally (user's own key)
App → Local SQLite (usage tracking)
App → Datadog (opt-in telemetry)
```

---

## 3. Behavioral Specification

### Phase 1 — Remove Access Gates

#### 3.1.1 Delete Gumroad Licensing

**Files to delete entirely:**

- `src/main/license/gumroad.ts`
- `src/main/license/store.ts`
- `src/main/license/validator.ts`
- `src/main/license/llm-test.ts`
- `relay-server/src/services/license.ts`

**Files to modify:**

| File                                                  | Change                                                               |
| ----------------------------------------------------- | -------------------------------------------------------------------- |
| `src/renderer/src/components/license/LicenseGate.tsx` | Delete this component entirely                                       |
| `src/renderer/src/stores/license-store.ts`            | Delete this store entirely                                           |
| Any parent component that renders `<LicenseGate>`     | Remove the gate wrapper — app renders directly without license check |
| `src/main/` IPC handlers                              | Remove all `license:*` IPC channels (validate, checkExisting, etc.)  |
| `src/preload/`                                        | Remove license API exposure to renderer                              |

**Behavior after change:**

- App launches directly into the setup wizard (if first run) or main dashboard (if configured)
- No license key prompt, no Gumroad verification, no grace period logic
- The hardcoded Gumroad product ID (`GHIxOJd-ONuldh9bhDQkYQ==`) must not appear anywhere in the codebase

#### 3.1.2 Remove Relay Auth Middleware

**Files to modify:**

- `relay-server/src/middleware/auth.ts` — Delete (relay is being eliminated, but this goes first to unblock other phases)

**Behavior after change:**

- No Bearer token authentication on any endpoint
- This is an intermediate state — the relay is fully removed in Phase 3

#### 3.1.3 Remove $30 Usage Ceiling

**Files to modify:**

- `relay-server/src/middleware/usage.ts` — Delete `usageCeilingMiddleware`
- `relay-server/src/services/usage.ts` — Remove `MONTHLY_CEILING_USD` constant and `isLimitReached()` function

**Note:** Usage TRACKING is preserved and moved to local SQLite in Phase 3. Only the CEILING enforcement is removed.

---

### Phase 2 — BYOK Everything

#### 3.2.1 Composio Key in Settings

**New behavior:**

- Settings page gets a new field: "Composio API Key"
- Stored locally using Electron `safeStorage` (same pattern as current BYOK LLM keys)
- Key is loaded into the main process and passed to Composio SDK directly
- If no Composio key is set, tool integrations are disabled but the app works for basic agent chat

**Files to create:**

- `src/main/composio/service.ts` — New file. Moves all Composio SDK logic from `relay-server/src/services/composio.ts` to the main process. **Lazy-load** the `@composio/core` SDK via dynamic import (`const { Composio } = await import('@composio/core')`) inside functions — not a top-level import. Keeps app startup fast for users who skip Composio setup

**Functions to move from relay `composio.ts` → main `composio/service.ts`:**

| Function              | Signature                                                                            | Changes                                                             |
| --------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------- |
| `getEntityId`         | `(userUUID: string) → string`                                                        | Input changes from `licenseKeyHash` to local `userUUID` (see 3.2.2) |
| `initiateOAuth`       | `(userUUID: string, appName: string) → {connectionId, redirectUrl}`                  | Same logic, runs locally                                            |
| `getConnectionStatus` | `(connectionId: string) → {id, status, appName}`                                     | Same logic, runs locally                                            |
| `proxyToolAction`     | `(userUUID: string, actionName: string, params: object) → unknown`                   | Same logic, runs locally                                            |
| `executeActionDirect` | `(entityId: string, actionName: string, params: object, version?: string) → unknown` | Same logic, runs locally                                            |
| `listOutlookEvents`   | `(userUUID: string, calendarId: string, params: object) → unknown`                   | Same logic, runs locally                                            |
| `getConnectedApps`    | `(userUUID: string) → string[]`                                                      | Same logic, runs locally                                            |
| `listApps`            | `() → ComposioApp[]`                                                                 | Same logic, runs locally                                            |

**Preserve:**

- `APP_SLUG_MAP` constant (google-calendar → googlecalendar, etc.)
- 50-app static fallback if Composio API is unreachable
- Special Outlook handling (two-step: list calendars → list events)

**Files to modify:**

| File                                                    | Change                                                                                                                                                                                                                                             |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/renderer/src/components/settings/SettingsPage.tsx` | Add Composio API Key field (same pattern as BYOK LLM key section, lines 638-759). Show connection status. If key is empty, show message: "Add a Composio API key to connect tools like Gmail, Calendar, and Slack. Get a free key at composio.dev" |
| `src/main/relay/client.ts`                              | All `relay*` functions that call Composio endpoints → replace with direct calls to local `composio/service.ts`                                                                                                                                     |
| `src/main/gateway/config.ts`                            | `buildSkillContent()` — update tool call endpoint from relay URL to local IPC                                                                                                                                                                      |
| `src/preload/`                                          | Add `composio:*` IPC API (initiateOAuth, getStatus, getConnected, listApps, setApiKey)                                                                                                                                                             |

**IPC channels to add:**

- `composio:set-api-key` — Save Composio key via safeStorage
- `composio:get-api-key` — Retrieve (for validation display, never expose full key to renderer — show masked `ck_...xxxx`)
- `composio:initiate-oauth` — Start OAuth flow for an app
- `composio:get-oauth-status` — Poll OAuth completion
- `composio:get-connected` — List connected apps
- `composio:list-apps` — List available apps
- `composio:proxy-action` — Execute a tool action

#### 3.2.2 User Identity (Replaces License Key Hash)

**Current:** Entity isolation in Composio uses `SHA256("composio:" + licenseKeyHash)`. With no license key, we need a new stable identifier.

**New behavior:**

- On first launch, generate a random UUID v4
- Store in `{userData}/user-identity.json` (plaintext — not a secret, just an identifier)
- This UUID is used for:
  - Composio entity ID: `SHA256("composio:" + userUUID).slice(0, 32)`
  - Telemetry anonymous ID: `SHA256(userUUID)`
  - Local usage tracking key

**File to create:**

- `src/main/identity/user-identity.ts`
  - `getUserUUID(): string` — Returns stored UUID, generates one if none exists
  - `getAnonymousId(): string` — Returns `SHA256(userUUID)` for telemetry
  - `getComposioEntityId(): string` — Returns `SHA256("composio:" + userUUID).slice(0, 32)`

#### 3.2.3 Embeddings via User's Key

**Current:** Relay calls OpenAI embedding API (`text-embedding-3-small`) using server-side `OPENAI_API_KEY`.

**New behavior:**

- Embeddings use the user's own OpenAI key (already stored via BYOK)
- If user only has Anthropic key → use Voyage embeddings via Anthropic (if available) or skip embedding-based features
- Embedding calls move from relay route to main process

**Files to modify:**

- `relay-server/src/routes/memory.ts` → Move embedding logic to `src/main/memory/` (existing memory module)
- Use user's stored BYOK OpenAI key for `text-embedding-3-small` calls
- Fallback: if no OpenAI key, disable semantic search but keep BM25 text search in OpenClaw

---

### Phase 3 — Eliminate Relay Server

#### 3.3.1 Move LLM Proxy to Main Process

**Current:** Desktop → Relay (`POST /llm/completions`) → Anthropic/OpenAI. Relay tracks usage.

**New behavior:**

- Desktop main process calls Anthropic/OpenAI APIs directly using stored BYOK keys
- No intermediate proxy
- Usage tracking happens locally after each call (see 3.3.3)

**Key change in gateway config:**

- `src/main/gateway/config.ts` — The OpenClaw gateway currently routes LLM calls through the relay's Anthropic-compatible endpoint (`http://127.0.0.1:3100/anthropic/v1/messages`)
- Change to route directly to `https://api.anthropic.com/v1/messages` using the user's stored API key
- For OpenAI: route to `https://api.openai.com/v1/chat/completions`
- The model registry in gateway config should list real provider endpoints, not relay endpoints

**Files to modify:**

- `src/main/gateway/config.ts` — Update LLM provider config to use direct API endpoints with BYOK keys
- `src/main/relay/client.ts` → Rename to `src/main/api/llm-client.ts`. Replace relay fetch with direct provider calls

#### 3.3.2 Move Content Extraction to Main Process

**Current:** Relay endpoint `GET /capture/extract-url` uses `@mozilla/readability` + `jsdom` + `youtube-transcript`.

**New behavior:**

- Move extraction logic to main process
- Add dependencies to root `package.json`: `@mozilla/readability`, `jsdom`, `youtube-transcript`
- These are stateless functions — no auth, no DB

**File to create:**

- `src/main/capture/extractor.ts` — Port logic from `relay-server/src/routes/capture.ts`

**IPC to update:**

- `capture:extract-url` — Call local extractor instead of relay

#### 3.3.3 Move Usage Tracking to Local SQLite

**Current:** PostgreSQL tables `usage_tracking` + `request_logs` on relay.

**New behavior:**

- Create new tables in the existing Attacca SQLite database (`{userData}/attacca-memory/memory.db`)
- Track per-model costs locally
- No ceiling enforcement — informational only
- Optional budget alert (user sets threshold in Settings)

**File to create:**

- `src/main/usage/tracker.ts`
  - `trackRequest(model: string, inputTokens: number, outputTokens: number, cacheWriteTokens?: number, cacheReadTokens?: number): void`
  - `getMonthlyUsage(): { totalCostUsd: number, requestCount: number, models: Record<string, number> }`
  - `getRequestHistory(limit?: number): RequestLogEntry[]`
  - `getBudgetAlert(): number | null` — Returns user-set threshold or null
  - `setBudgetAlert(usd: number | null): void`

**Pricing logic:** Move `relay-server/src/services/pricing.ts` → `src/main/usage/pricing.ts` (same `calculateCost` function, same price table)

**SQLite schema to add:**

```sql
CREATE TABLE IF NOT EXISTS usage_tracking (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  month_year TEXT NOT NULL,           -- "2026-03"
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
```

**Files to modify:**

| File                                                    | Change                                                                                                                                          |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/renderer/src/stores/usage-store.ts`                | `fetchUsage()` calls local IPC instead of `window.api.relay.getUsage()`. Remove `limitUsd`, `limitReached`. Add `budgetAlert` field             |
| `src/renderer/src/components/settings/SettingsPage.tsx` | Usage section (lines 580-635): Remove "$30 limit" display. Show monthly spend + optional budget alert threshold input. Show per-model breakdown |

#### 3.3.4 Move Tool Execution to Main Process

**Current:** Agent calls tools via relay: `POST /agent/tools` → Composio SDK.

**New behavior:**

- Agent tool calls route through local Composio service (created in 3.2.1)
- `call-tool.cjs` (OpenClaw workspace skill script) calls local IPC instead of relay HTTP

**Files to modify:**

- `src/main/gateway/config.ts` — Update `call-tool.cjs` generation to call local endpoint instead of `http://127.0.0.1:3100/agent/tools`

#### 3.3.5 Delete Relay Server

After all features are moved:

**Delete entirely:**

- `relay-server/` directory (all contents)
- `src/main/relay/` directory (client.ts, lifecycle.ts, types.ts)
- Any relay startup logic in the main process
- `relay-server/package.json` dependencies no longer needed at root level

**Add to root `package.json`:**

- `@composio/core` (moved from relay)
- `@mozilla/readability` (moved from relay)
- `jsdom` (moved from relay)
- `youtube-transcript` (moved from relay)

**Remove from root process:**

- Relay server spawn/lifecycle management in main process
- Any health checks against `localhost:3100`

---

### Phase 4 — Telemetry Transition (Datadog)

#### 3.4.1 Update Anonymous ID

**File to modify:** `src/main/telemetry/collector.ts`

**Current** (lines 44-48):

```typescript
private computeAnonymousId(): string {
  const stored = loadLicense()
  if (!stored?.key) return 'unknown'
  return createHash('sha256').update(stored.key).digest('hex')
}
```

**New:**

```typescript
private computeAnonymousId(): string {
  return getAnonymousId() // from src/main/identity/user-identity.ts
}
```

- Import `getAnonymousId` from the new user identity module (created in 3.2.2)
- Remove import of `loadLicense` from license store (which no longer exists)

#### 3.4.2 Update Telemetry Endpoint (Datadog)

**File to modify:** `src/main/telemetry/collector.ts`

**Current** (line 10):

```typescript
const RELAY_TELEMETRY_URL = 'http://127.0.0.1:3100/telemetry/events'
```

**New behavior:**

- Send events to Datadog Logs API (US region): `https://http-intake.logs.datadoghq.com/api/v2/logs`
- API key: build-time env var `DD_CLIENT_KEY`, injected during CI/CD build, baked into Electron binary. NOT in source code
- If `DD_CLIENT_KEY` is not set (fork builds), telemetry silently disables — events still queue locally but never flush

**Event format mapping (Attacca → Datadog):**

| Attacca Field | Datadog Field                                       |
| ------------- | --------------------------------------------------- |
| `eventType`   | `ddsource: "attacca-claw"`, event type as `message` |
| `payload`     | `attributes` (nested JSON)                          |
| `timestamp`   | `date` (ISO 8601)                                   |
| `anonymousId` | `usr.id`                                            |

**Flush logic changes:**

- Current: POST to relay with Bearer token auth
- New: POST to Datadog with `DD-API-KEY` header
- Keep: 60-second flush interval, local queue persistence, batch sending
- Keep: `deleteData` function — call Datadog's data deletion API or document manual process

**File to modify:** `src/main/telemetry/store.ts`

- Remove Bearer token auth from flush requests
- Update endpoint URL
- Update request headers for Datadog format

#### 3.4.3 Telemetry Event Types (Keep As-Is)

**File:** `src/main/telemetry/types.ts` — No changes needed. All 21 event types remain valid:

- Permission events (6): high_risk presented/resolved, mid_risk presented/viewed/undo_used, standing_approval granted/expired
- Trust events (5): profile_changed, kill_switch activated/resumed, takeover activated/deactivated, first_standing_approval
- Agent events (4): task completed/failed/fallback_created, workflow added/removed
- Parity events (3): draft approved, task reopened, fallback_rate

These are the research-valuable events — how users interact with the trust architecture.

#### 3.4.4 Telemetry Viewer UI

**New component:** `src/renderer/src/components/settings/TelemetryViewer.tsx`

**Behavior:**

- Accessible from Settings → Telemetry section
- Shows a scrollable list of queued events (from local `telemetry-queue.json`)
- Each event displays: timestamp, eventType, payload (expandable JSON)
- Header shows: total events queued, last flush timestamp, opt-in status
- Purpose: transparency — user can see exactly what data would be sent

**IPC to add:**

- `telemetry:get-queue` — Returns current queued events
- `telemetry:get-status` — Returns { optedIn, lastFlush, queueSize }

**Settings page integration:**

- Add "View telemetry data" button in the existing telemetry section (lines 762-812 of `SettingsPage.tsx`)
- Opens `TelemetryViewer` as a modal or expandable panel

---

### Phase 5 — Setup Wizard & Open Source Prep

#### 3.5.1 First-Run Setup Wizard

**New component:** `src/renderer/src/components/onboarding/SetupWizard.tsx`

**Replaces:** `LicenseGate.tsx` (deleted in Phase 1)

**Steps:**

| Step | Title                | Content                                                                                                                                                                            | Required?                                        |
| ---- | -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| 1    | Welcome              | "Attacca Claw — AI productivity assistant. Let's set you up." Brief description of what the app does                                                                               | N/A (info)                                       |
| 2    | LLM API Key          | Select provider (Anthropic/OpenAI/Google). Enter API key. Test connection button. Link to provider signup page                                                                     | **Yes** — app cannot function without an LLM key |
| 3    | Composio (Optional)  | Enter Composio API key. Explain what it enables (Gmail, Calendar, Slack integrations). "Skip for now" option. Link to composio.dev signup                                          | **No** — app works without tools                 |
| 4    | Telemetry (Optional) | Explain what is collected (trust tier usage, task outcomes). Explain what is NOT collected (API keys, personal data, conversation content). Opt-in toggle. "View sample data" link | **No** — default OFF                             |
| 5    | Ready                | Summary of what's configured. "Start using Attacca Claw" button                                                                                                                    | N/A                                              |

**State management:**

- `src/renderer/src/stores/onboarding-store.ts` — Track wizard completion
- Store wizard-complete flag in `{userData}/onboarding-complete.json`
- App checks on launch: if file missing → show wizard. If present → show dashboard

**Behavior:**

- Wizard is full-screen (replaces the old `LicenseGate` full-screen pattern)
- User can go back to any step
- Step 2 (LLM key) is blocking — cannot proceed without a valid key
- Steps 3-4 can be skipped
- After completion, user lands on the main dashboard
- **i18n**: Wizard supports Spanish (ES) and English (EN). Auto-detect system locale. Default to EN for unsupported locales. Language switcher in wizard header. Use a simple i18n approach (JSON translation files, e.g., `src/renderer/src/i18n/en.json`, `es.json`) — no heavy i18n library needed

#### 3.5.2 Pin OpenClaw Version

**File to modify:** `package.json`

**Current:** `"openclaw": "^2026.2.19-2"` (accepts minor updates)
**New:** `"openclaw": "2026.2.19-2"` (exact pin, no `^`)

**Add to README:** "Attacca Claw is tested with OpenClaw v2026.2.19-2. Other versions may work but are not officially supported."

#### 3.5.3 Open Source Files

**Files to create at project root:**

1. **`LICENSE`** — MIT License (simplest, most permissive, aligns with OpenClaw ecosystem)

2. **`README.md`** — Sections:
   - What is Attacca Claw (1 paragraph)
   - Features (trust architecture, tool integrations, memory system)
   - Quick start (download, run setup wizard, enter keys)
   - Requirements (Node.js, API keys)
   - OpenClaw compatibility (pinned version)
   - Telemetry transparency (what is collected, how to opt out)
   - Contributing
   - License

3. **`.env.example`** — Template showing required/optional env vars:

   ```
   # No environment variables required for the desktop app.
   # All configuration is done through the in-app Setup Wizard.
   #
   # Optional: Datadog client key for telemetry (embedded in app by default)
   # DD_CLIENT_KEY=your_datadog_client_key
   ```

4. **`CONTRIBUTING.md`** — Basic contribution guide:
   - How to set up dev environment
   - How to run locally
   - PR process
   - Code style (existing patterns)

5. **`.github/workflows/ci.yml`** — Basic CI:
   - Lint
   - Type check
   - Build (Electron)
   - Run on push to main + PRs

**Files to update:**

- `.gitignore` — Ensure no secrets, build artifacts, or user data dirs are tracked
- `package.json` — Update `name`, `description`, `repository`, `license` fields. Remove `private: true` if set

**Files to delete:**

- Any `.env` files with real API keys (should already be in `.gitignore`)
- `relay-server/` (already deleted in Phase 3)

---

## 4. Delegation Framework

| Decision                           | Who Decides                                          | Escalation                                     |
| ---------------------------------- | ---------------------------------------------------- | ---------------------------------------------- |
| File deletion (listed in spec)     | Agent — autonomous                                   | None needed, spec is explicit                  |
| New file creation (listed in spec) | Agent — autonomous                                   | None needed, spec is explicit                  |
| Function signature changes         | Agent — autonomous within spec                       | If return type changes beyond spec, flag       |
| UI text/copy changes               | Agent — autonomous (implement i18n, support ES + EN) | Auto-detect locale, default EN for unsupported |
| Dependency additions               | Agent — autonomous for listed deps                   | New unlisted dependencies → flag for review    |
| Architecture decisions not in spec | **STOP — flag for human**                            | Any structural choice not covered here         |
| Datadog API key handling           | **STOP — flag for human**                            | User must provide the actual DD client key     |
| GitHub repo creation               | **STOP — flag for human**                            | User creates org + repo manually               |

---

## 5. Behavioral Scenarios

### Scenario 1: First Launch (Clean Install)

```
GIVEN: App is installed fresh, no previous data
WHEN: User launches the app
THEN:
  - No license gate appears
  - Setup Wizard displays (Step 1: Welcome)
  - User UUID is generated and stored in {userData}/user-identity.json
  - App does not call any external service until user provides API keys
```

### Scenario 2: LLM Key Validation in Wizard

```
GIVEN: User is on Step 2 of Setup Wizard
WHEN: User enters an Anthropic API key and clicks "Test"
THEN:
  - App makes a minimal API call directly to api.anthropic.com (NOT through relay)
  - On success: green checkmark, "Next" button enabled
  - On failure: red error with message from provider, "Next" stays disabled
  - Key is stored locally via Electron safeStorage
  - Key NEVER leaves the local machine
```

### Scenario 3: App Without Composio Key

```
GIVEN: User skipped Composio setup in wizard
WHEN: User opens the dashboard
THEN:
  - Agent chat works (LLM key is configured)
  - Tool integrations panel shows "No tools connected"
  - Settings shows Composio field with helper text and link to composio.dev
  - Agent SKILL.md is generated WITHOUT tool documentation (no Gmail, Slack, etc.)
  - Agent can still use memory, capture, and basic chat features
```

### Scenario 4: Usage Tracking Without Ceiling

```
GIVEN: User has been using the app for several days
WHEN: User opens Settings → Usage section
THEN:
  - Shows total spend this month (calculated from local SQLite)
  - Shows per-model breakdown (Claude Sonnet: $X, GPT-4o: $Y)
  - Shows request count
  - Optional: budget alert threshold input ("Alert me when I exceed $__")
  - No "limit reached" state — usage is informational only
  - If budget alert is set and exceeded: non-blocking toast notification
```

### Scenario 5: Telemetry Opt-In with Viewer

```
GIVEN: User opted into telemetry during setup
WHEN: User clicks "View telemetry data" in Settings
THEN:
  - Modal/panel opens showing queued events
  - Each event shows: timestamp, eventType, payload (expandable)
  - Header shows: "12 events queued, last sent 3 minutes ago"
  - User can toggle telemetry off from this view
  - When toggled off: local queue is cleared, no more events collected
```

### Scenario 6: Composio OAuth Flow (Local)

```
GIVEN: User has entered a valid Composio API key
WHEN: User clicks "Connect Gmail"
THEN:
  - Main process calls Composio SDK directly (NOT via relay)
  - Entity ID derived from local user UUID
  - Browser opens with OAuth redirect URL
  - App polls connection status via local Composio service
  - On success: Gmail appears in connected tools list
  - SKILL.md is regenerated with Gmail documentation included
```

### Scenario 7: No Relay Server Running

```
GIVEN: The relay server code has been removed
WHEN: App launches
THEN:
  - No process is spawned on port 3100
  - No health checks against localhost:3100
  - No HTTP requests to localhost:3100
  - All functionality works via direct API calls and local services
  - App startup is faster (no relay spawn + health check delay)
```

---

## 6. Ambiguity Warnings — ALL RESOLVED

| #        | Ambiguity                        | Resolution                                                                                                                                                                                                                                                                                                                                                        |
| -------- | -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **AW-1** | **Datadog API key**              | **Build-time env var.** `DD_CLIENT_KEY` injected at build time via CI/CD, baked into the binary. Not in source code. Forks can use their own Datadog account or disable telemetry. DD client keys are write-only (safe if extracted from binary)                                                                                                                  |
| **AW-2** | **Datadog region**               | **US** — endpoint: `https://http-intake.logs.datadoghq.com/api/v2/logs`                                                                                                                                                                                                                                                                                           |
| **AW-3** | **UI language**                  | **Both Spanish and English.** Implement i18n. Existing Settings UI stays Spanish. Setup Wizard has both. Auto-detect system locale, default to English for unsupported locales                                                                                                                                                                                    |
| **AW-4** | **OpenClaw gateway auth**        | **Already solved.** BYOK flow exists: main process injects API key as env var (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GOOGLE_API_KEY`) when spawning OpenClaw. Also writes `auth-profiles.json`. Config switches model from `attacca-relay/claude-sonnet-4-6` → `anthropic/claude-sonnet-4-5-20250514`. Just remove relay as default and make BYOK the only mode |
| **AW-5** | **Composio dependency weight**   | **Lazy-load.** Use dynamic `await import('@composio/core')` inside functions that need it (first tool connection attempt). App starts faster, Composio SDK only loads when needed                                                                                                                                                                                 |
| **AW-6** | **Existing user data migration** | **Ignore.** No active subscribers. No migration path needed                                                                                                                                                                                                                                                                                                       |

---

## 7. Out of Scope

- Server-side telemetry infrastructure (Datadog setup, dashboards, alerts) — handled separately
- GitHub org creation, repo setup, initial push — done manually
- macOS/Linux testing and support — future
- Community management (Discord, Discussions) — future
- Marketing, launch announcement — future
- The trust architecture / permission engine — explicitly untouched
- OpenClaw upstream changes — pin version, deal with updates separately

---

## 8. File Inventory (Complete Change List)

### Files to DELETE

| Path                                                  | Reason                                |
| ----------------------------------------------------- | ------------------------------------- |
| `src/main/license/gumroad.ts`                         | Gumroad licensing removed             |
| `src/main/license/store.ts`                           | License storage removed               |
| `src/main/license/validator.ts`                       | License validation removed            |
| `src/main/license/llm-test.ts`                        | License-related LLM test removed      |
| `src/main/relay/client.ts`                            | Relay client eliminated               |
| `src/main/relay/lifecycle.ts`                         | Relay lifecycle management eliminated |
| `src/main/relay/types.ts`                             | Relay types eliminated                |
| `src/renderer/src/components/license/LicenseGate.tsx` | License gate UI removed               |
| `src/renderer/src/stores/license-store.ts`            | License store removed                 |
| `relay-server/` (entire directory)                    | Relay server eliminated               |

### Files to CREATE

| Path                                                       | Purpose                                               |
| ---------------------------------------------------------- | ----------------------------------------------------- |
| `src/main/identity/user-identity.ts`                       | UUID generation + anonymous ID + Composio entity ID   |
| `src/main/composio/service.ts`                             | Local Composio SDK wrapper (moved from relay)         |
| `src/main/usage/tracker.ts`                                | Local SQLite usage tracking                           |
| `src/main/usage/pricing.ts`                                | Token cost calculation (moved from relay)             |
| `src/main/capture/extractor.ts`                            | URL/YouTube content extraction (moved from relay)     |
| `src/renderer/src/components/onboarding/SetupWizard.tsx`   | First-run setup wizard                                |
| `src/renderer/src/components/settings/TelemetryViewer.tsx` | Telemetry transparency panel                          |
| `src/renderer/src/stores/onboarding-store.ts`              | Wizard completion state                               |
| `src/renderer/src/i18n/en.json`                            | English translations                                  |
| `src/renderer/src/i18n/es.json`                            | Spanish translations                                  |
| `src/renderer/src/i18n/index.ts`                           | i18n loader (detect locale, provide translation hook) |
| `LICENSE`                                                  | MIT license                                           |
| `README.md`                                                | Project documentation                                 |
| `.env.example`                                             | Environment variable template                         |
| `CONTRIBUTING.md`                                          | Contribution guide                                    |
| `.github/workflows/ci.yml`                                 | CI pipeline                                           |

### Files to MODIFY

| Path                                                    | Change Summary                                                                                                            |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `src/main/telemetry/collector.ts`                       | Update anonymousId (use UUID), endpoint (Datadog), remove Bearer auth, remove license import                              |
| `src/main/telemetry/store.ts`                           | Update flush endpoint and headers for Datadog                                                                             |
| `src/main/gateway/config.ts`                            | Update LLM routing (direct API, not relay), update tool call script, remove relay references                              |
| `src/renderer/src/components/settings/SettingsPage.tsx` | Add Composio key field, update usage section (remove ceiling), add telemetry viewer button, remove any license references |
| `src/renderer/src/stores/usage-store.ts`                | Fetch from local IPC instead of relay. Remove limit fields                                                                |
| `src/preload/` (index.ts or api.ts)                     | Remove license API, add composio API, add telemetry viewer API, update usage API                                          |
| `package.json`                                          | Pin OpenClaw version, add moved dependencies, update metadata, remove `private`                                           |
| `.gitignore`                                            | Ensure user data, keys, env files excluded                                                                                |
| Parent component wrapping LicenseGate                   | Remove gate, render app directly or show SetupWizard                                                                      |

### Files UNTOUCHED (Explicitly Preserved)

| Path                                        | Reason                                                   |
| ------------------------------------------- | -------------------------------------------------------- |
| `src/renderer/src/lib/permission-engine.ts` | Trust architecture is the differentiator — do not modify |
| `src/main/telemetry/types.ts`               | All 21 event types remain valid for research             |
| `src/main/memory/`                          | Memory system unchanged                                  |
| `src/main/gateway/lifecycle.ts`             | OpenClaw gateway lifecycle unchanged                     |
| All UI components except listed             | Dashboard, capture, schedule, workflows — unchanged      |

---

## 9. Implementation Order

Execute phases sequentially. Each phase should result in a working (if incomplete) app.

```
Phase 1 → App launches without license gate. Relay still works.
Phase 2 → BYOK for all services. Relay still exists but optional.
Phase 3 → Relay eliminated. Everything local. App fully standalone.
Phase 4 → Telemetry sends to Datadog. Viewer UI added.
Phase 5 → Setup Wizard replaces license gate. Open source files added.
```

**Test at each phase boundary:** App launches, agent responds, tools connect (where applicable), usage tracks, telemetry works.

---

## 10. Connections

- [[attacca-claw]] — Parent project note
- [[2026-03-17-attacca-claw-open-source-transition]] — Decision analysis artifact
- [[attacca-claw-architecture-and-roadmap]] — Current architecture reference
- [[hyperscaler-risk-radar]] — Update risk assessment post-transition
