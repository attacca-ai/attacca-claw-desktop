import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import { app } from 'electron'

const OPENCLAW_DIR = join(homedir(), '.openclaw')
const CONFIG_PATH = join(OPENCLAW_DIR, 'openclaw.json')

export interface OpenClawConfig {
  gateway: {
    port: number
    mode?: string
    auth?: {
      mode?: string
      token?: string
    }
    controlUi?: {
      dangerouslyDisableDeviceAuth?: boolean
      allowedOrigins?: string[]
    }
  }
  llm?: {
    provider: 'anthropic' | 'openai' | 'google'
    model: string
    apiKey: string
  }
  tools?: {
    exec?: {
      host?: string
    }
  }
  workspace?: string
}

const DEFAULT_CONFIG: OpenClawConfig = {
  gateway: {
    port: 18789,
    mode: 'local'
  }
}

export function ensureConfig(): OpenClawConfig {
  if (!existsSync(OPENCLAW_DIR)) {
    mkdirSync(OPENCLAW_DIR, { recursive: true })
  }

  if (!existsSync(CONFIG_PATH)) {
    writeFileSync(CONFIG_PATH, JSON.stringify(DEFAULT_CONFIG, null, 2), 'utf-8')
    return DEFAULT_CONFIG
  }

  try {
    const raw = readFileSync(CONFIG_PATH, 'utf-8')
    return JSON.parse(raw) as OpenClawConfig
  } catch {
    writeFileSync(CONFIG_PATH, JSON.stringify(DEFAULT_CONFIG, null, 2), 'utf-8')
    return DEFAULT_CONFIG
  }
}

export function readConfig(): OpenClawConfig {
  if (!existsSync(CONFIG_PATH)) {
    return ensureConfig()
  }
  const raw = readFileSync(CONFIG_PATH, 'utf-8')
  const config = JSON.parse(raw) as OpenClawConfig
  // Merge llm config from separate file (kept out of openclaw.json)
  if (existsSync(LLM_CONFIG_PATH)) {
    try {
      config.llm = JSON.parse(readFileSync(LLM_CONFIG_PATH, 'utf-8'))
    } catch {
      /* ignore corrupt file */
    }
  }
  return config
}

const LLM_CONFIG_PATH = join(app.getPath('userData'), 'llm-config.json')

export function writeConfig(config: OpenClawConfig): void {
  if (!existsSync(OPENCLAW_DIR)) {
    mkdirSync(OPENCLAW_DIR, { recursive: true })
  }
  // Save llm config separately — OpenClaw rejects unrecognized keys
  if (config.llm) {
    writeFileSync(LLM_CONFIG_PATH, JSON.stringify(config.llm, null, 2), 'utf-8')
  }
  const openclawConfig = { ...config }
  delete openclawConfig.llm
  writeFileSync(CONFIG_PATH, JSON.stringify(openclawConfig, null, 2), 'utf-8')
}

export function getGatewayUrl(): string {
  const config = readConfig()
  return `ws://127.0.0.1:${config.gateway.port}`
}

export function getGatewayToken(): string | null {
  const config = readConfig()
  return config.gateway.auth?.token ?? null
}

/**
 * Writes the LLM API key to the default agent's auth-profiles.json so
 * OpenClaw can find it without needing an environment variable.
 * Format: { profiles: { "attacca-<provider>": { provider, type, key } } }
 */
export function writeAgentAuthProfiles(provider: string, apiKey: string): void {
  const agentDir = join(OPENCLAW_DIR, 'agents', 'main', 'agent')
  const authProfilesPath = join(agentDir, 'auth-profiles.json')

  if (!existsSync(agentDir)) {
    mkdirSync(agentDir, { recursive: true })
  }

  // Preserve existing profiles, update or add ours
  let existing: Record<string, unknown> = { profiles: {} }
  if (existsSync(authProfilesPath)) {
    try {
      existing = JSON.parse(readFileSync(authProfilesPath, 'utf-8'))
    } catch {
      existing = { profiles: {} }
    }
  }

  const profiles = (existing.profiles ?? {}) as Record<string, unknown>
  profiles[`attacca-${provider}`] = { provider, type: 'api_key', key: apiKey }
  existing.profiles = profiles

  writeFileSync(authProfilesPath, JSON.stringify(existing, null, 2), 'utf-8')
}

/**
 * Ensures the openclaw.json config has the controlUi bypass flag set.
 * This allows the renderer to connect as the Control UI client without
 * device-level authentication, while still requiring the auth token.
 */
export function ensureControlUiConfig(): void {
  const config = ensureConfig()
  const ui = config.gateway.controlUi
  const hasAuth = ui?.dangerouslyDisableDeviceAuth === true
  // file:// URLs have an opaque origin per the URL spec — new URL("file://").origin
  // returns the string "null". OpenClaw compares parsedOrigin.origin against this list,
  // so we must include "null" (not "file://") for packaged Electron apps.
  const hasOrigin = Array.isArray(ui?.allowedOrigins) && ui.allowedOrigins.includes('null')
  if (hasAuth && hasOrigin) return

  config.gateway.controlUi = {
    ...ui,
    dangerouslyDisableDeviceAuth: true,
    allowedOrigins: ['null']
  }
  writeConfig(config)
}

const MEMORY_SERVER_PORT = 3101
const COMPOSIO_SERVER_PORT = 3102

/**
 * Configures OpenClaw's LLM routing and memory search.
 * BYOK is the only mode — routes directly to the user's provider.
 *
 * Reads and rewrites the full openclaw.json to preserve OpenClaw-managed fields
 * (commands, meta, agents.defaults.compaction, etc.).
 */
/**
 * Configures OpenClaw's LLM routing and memory search.
 * BYOK is the only mode — routes directly to the user's provider.
 */
export function ensureRelayProviderConfig(
  byokConfig?: { provider: string; model: string } | null
): void {
  let rawConfig: Record<string, unknown> = {}
  if (existsSync(CONFIG_PATH)) {
    try {
      rawConfig = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'))
    } catch {
      rawConfig = {}
    }
  }

  // Allow skill-driven tool execution in the OpenClaw sandbox host.
  const tools = (rawConfig.tools ?? {}) as Record<string, unknown>
  const exec = (tools.exec ?? {}) as Record<string, unknown>
  exec.host = 'sandbox'
  tools.exec = exec
  rawConfig.tools = tools

  // Set default model via BYOK built-in provider
  const agents = (rawConfig.agents ?? {}) as Record<string, unknown>
  const defaults = (agents.defaults ?? {}) as Record<string, unknown>
  if (byokConfig) {
    defaults.model = { primary: `${byokConfig.provider}/${byokConfig.model}` }
  } else {
    // No BYOK configured yet — use anthropic as default (user must set key in wizard)
    defaults.model = { primary: 'anthropic/claude-sonnet-4-6' }
  }

  // Enable native memory search via local memory server (port 3101)
  defaults.memorySearch = {
    provider: 'openai',
    remote: {
      baseUrl: `http://localhost:${MEMORY_SERVER_PORT}`,
      apiKey: 'local',
      batch: { enabled: false }
    },
    sync: {
      onSearch: true,
      watch: true
    }
  }

  agents.defaults = defaults
  rawConfig.agents = agents

  // Clean up legacy relay provider config from pre-OSS installs
  const models = (rawConfig.models ?? {}) as Record<string, unknown>
  const providers = (models.providers ?? {}) as Record<string, unknown>
  delete providers['attacca-relay']
  models.providers = providers
  rawConfig.models = models

  // Write via writeConfig to strip llm key (OpenClaw rejects unknown keys)
  writeConfig(rawConfig as unknown as OpenClawConfig)
}

export function getConfigPath(): string {
  return CONFIG_PATH
}

export function getOpenClawDir(): string {
  return OPENCLAW_DIR
}

const SKILL_DIR = join(OPENCLAW_DIR, 'workspace', 'skills', 'attacca-tools')
const SESSIONS_JSON = join(OPENCLAW_DIR, 'agents', 'main', 'sessions', 'sessions.json')

/**
 * Clears the cached skillsSnapshot from the persisted sessions.json so
 * OpenClaw rebuilds the skills prompt on the next agent turn.
 * This must be called whenever the skill content changes (e.g. on every startup)
 * so stale snapshots never block new skills from being seen by the agent.
 */
export function clearSessionSkillsSnapshot(): void {
  if (!existsSync(SESSIONS_JSON)) return
  try {
    const raw = readFileSync(SESSIONS_JSON, 'utf-8')
    const data = JSON.parse(raw) as Record<string, Record<string, unknown>>
    let changed = false
    for (const key of Object.keys(data)) {
      if ('skillsSnapshot' in data[key] || 'systemPromptReport' in data[key]) {
        delete data[key].skillsSnapshot
        delete data[key].systemPromptReport
        changed = true
      }
    }
    if (changed) {
      writeFileSync(SESSIONS_JSON, JSON.stringify(data, null, 2), 'utf-8')
    }
  } catch {
    // Not critical — gateway will just rebuild the snapshot anyway
  }
}

/**
 * Writes a custom OpenClaw workspace skill that lets the agent call Composio
 * tool actions (Gmail, Google Calendar, Slack, etc.) via the Composio MCP server
 * through mcporter, or via the local Composio service as fallback.
 *
 * The entityId is derived from the user UUID and matches Composio OAuth connections.
 * The skill is re-written on every gateway start so it stays current.
 */
export function ensureComposioSkill(entityId: string, connectedTools?: string[]): void {
  if (!existsSync(SKILL_DIR)) {
    mkdirSync(SKILL_DIR, { recursive: true })
  }

  const tools = connectedTools ?? []

  // Write fallback call-tool.cjs for _DISCOVER_ACTIONS and direct tool calls
  writeFileSync(join(SKILL_DIR, 'call-tool.cjs'), buildCallToolScript(entityId), 'utf-8')
  writeFileSync(join(SKILL_DIR, 'memory-search.cjs'), buildMemorySearchScript(), 'utf-8')

  // Set up Composio MCP server + mcporter config (async, non-blocking)
  if (tools.length > 0) {
    import('../composio/mcp')
      .then(({ ensureComposioMcpServer }) => ensureComposioMcpServer(tools))
      .then((mcpUrl) => {
        if (mcpUrl) {
          console.log('[gateway] Composio MCP server ready')
        } else {
          console.warn('[gateway] MCP setup failed, agent will use call-tool.cjs fallback')
        }
      })
      .catch((err) => {
        console.warn('[gateway] MCP setup error:', err)
      })
  }

  writeFileSync(join(SKILL_DIR, 'SKILL.md'), buildSkillContent(tools), 'utf-8')
}

/**
 * Generates a portable Node.js CJS script that calls the local Composio server.
 * Using node instead of curl avoids Windows cmd.exe single-quote quoting issues.
 * The entityId is baked in at generation time.
 */
function buildCallToolScript(entityId: string): string {
  return `'use strict'
var fs = require('fs')
var ACTION_NAME = process.argv[2]
var paramsArg = process.argv[3]
var ENTITY_ID = ${JSON.stringify(entityId)}

function run(params) {
  fetch('http://localhost:${COMPOSIO_SERVER_PORT}/execute', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ actionName: ACTION_NAME, entityId: ENTITY_ID, params: params })
  })
    .then(function(r) { return r.json() })
    .then(function(data) { process.stdout.write(JSON.stringify(data) + '\\n') })
    .catch(function(err) { process.stdout.write(JSON.stringify({ success: false, error: err.message }) + '\\n') })
}

// Decode param arg: supports raw JSON, b64:... (base64-encoded JSON), or @filepath
function decodeArg(arg) {
  if (!arg) return null
  if (arg.startsWith('b64:')) {
    try { return JSON.parse(Buffer.from(arg.slice(4), 'base64').toString('utf-8')) }
    catch (_) { return null }
  }
  if (arg.startsWith('@')) {
    try { return JSON.parse(fs.readFileSync(arg.slice(1), 'utf-8').trim()) }
    catch (_) { return null }
  }
  try { return JSON.parse(arg) }
  catch (_) { return null }
}

function readStdinAndRun() {
  var chunks = []
  process.stdin.on('data', function(d) { chunks.push(d) })
  process.stdin.on('end', function() {
    var str = Buffer.concat(chunks).toString().trim()
    try { run(str ? JSON.parse(str) : {}) } catch (_) { run({}) }
  })
  process.stdin.on('error', function() { run({}) })
}

var decoded = decodeArg(paramsArg)
if (decoded) {
  run(decoded)
} else if (paramsArg) {
  readStdinAndRun()
} else if (process.stdin.isTTY) {
  run({})
} else {
  readStdinAndRun()
}
`
}

/**
 * Generates a portable Node.js CJS script that calls the local memory server.
 * The port is discovered at runtime by reading the port file written by the memory server.
 * Falls back to port 3101 if the file doesn't exist.
 */
function buildMemorySearchScript(): string {
  return `'use strict'
var ACTION = process.argv[2] // SEARCH or SAVE
var MEMORY_PORT = 3101

function run(params) {
  var endpoint = ACTION === 'SAVE' ? '/save' : '/search'
  fetch('http://127.0.0.1:' + MEMORY_PORT + endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params)
  })
    .then(function(r) { return r.json() })
    .then(function(data) { process.stdout.write(JSON.stringify(data) + '\\n') })
    .catch(function(err) { process.stdout.write(JSON.stringify({ success: false, error: err.message }) + '\\n') })
}

// argv[3] is the plain query/content string (no JSON needed — avoids cmd.exe quoting issues)
// argv[4] is the type for SAVE (default: 'preference')
var arg3 = process.argv[3]
var arg4 = process.argv[4]

if (arg3) {
  var parsed = null
  try { parsed = JSON.parse(arg3) } catch (_) { parsed = null }
  if (parsed) {
    run(parsed)
  } else if (ACTION === 'SAVE') {
    run({ content: arg3, type: arg4 || 'preference', summary: arg3.slice(0, 200) })
  } else {
    run({ query: arg3 })
  }
} else {
  run({})
}
`
}

function readKbContext(): string {
  const sections: string[] = []

  // Tier 1: Identity traits from memory DB (compact, high-value)
  try {
    const { getIdentityTraits } = require('../memory/db') as typeof import('../memory/db')
    const traits = getIdentityTraits(0.4)
    if (traits.length > 0) {
      const traitLines = traits
        .map((t) => `- **${t.key.replace(/_/g, ' ')}**: ${t.value}`)
        .join('\n')
      sections.push(`## About This User\n\n${traitLines}`)
    }
  } catch {
    // Memory DB not initialized yet — skip
  }

  // Tier 2: CONTEXT.md (captures, projects, people — kept for backward compat)
  try {
    const ctxPath = join(app.getPath('userData'), 'attacca-kb', 'memory', 'CONTEXT.md')
    if (existsSync(ctxPath)) {
      const ctx = readFileSync(ctxPath, 'utf-8').trim()
      if (ctx) sections.push(ctx)
    }
  } catch {
    // ignore — KB context is optional
  }

  if (sections.length === 0) return ''
  return sections.join('\n\n') + '\n\n---\n\n'
}

function buildSkillContent(connectedTools: string[]): string {
  const kbContext = readKbContext()
  const tzName = Intl.DateTimeFormat().resolvedOptions().timeZone
  const tzOffsetMin = -new Date().getTimezoneOffset()
  const tzSign = tzOffsetMin >= 0 ? '+' : '-'
  const tzH = String(Math.floor(Math.abs(tzOffsetMin) / 60)).padStart(2, '0')
  const tzM = String(Math.abs(tzOffsetMin) % 60).padStart(2, '0')
  const tzOffset = `${tzSign}${tzH}:${tzM}`

  // Fallback script for direct API calls (used when mcporter is not available)
  const scriptPath = join(SKILL_DIR, 'call-tool.cjs').replace(/\\/g, '/')
  const fallbackCall = (action: string, paramsJson: string): string =>
    `echo '${paramsJson}' | node "${scriptPath}" ${action}`

  // Normalize connected tool IDs for matching
  const has = (id: string): boolean => connectedTools.some((t) => t.toLowerCase() === id)
  const hasGmail = has('gmail')
  const hasGcal = has('googlecalendar')
  const hasOutlook = has('outlook')
  const hasSlack = has('slack')
  const hasTrello = has('trello')
  const hasClickup = has('clickup')
  const hasAsana = has('asana')
  const hasNotion = has('notion')
  const hasAnyTool = connectedTools.length > 0

  // Build list of active tool names for the description
  const activeNames = [
    hasGmail && 'Gmail',
    hasGcal && 'Google Calendar',
    hasOutlook && 'Outlook',
    hasSlack && 'Slack',
    hasTrello && 'Trello',
    hasClickup && 'ClickUp',
    hasAsana && 'Asana',
    hasNotion && 'Notion'
  ].filter(Boolean)
  const toolList =
    activeNames.length > 0
      ? activeNames.join(', ')
      : 'productivity tools (none currently connected)'

  // Determine if both email providers or both calendar providers are active
  const hasBothEmail = hasGmail && hasOutlook
  const hasBothCal = hasGcal && hasOutlook

  // --- Compressed Principles ---
  const principles = `## Principles

1. **Zero Trust** — Only use connected tools. Never suggest connecting others unless the task requires it.
2. **Observe first** — Read/summarize before creating/sending/modifying. Confirm patterns before treating them as preferences.
3. **One question at a time** — Propose a default and confirm: "I'll schedule 30 min at 2 PM. Sound good?"
4. **Minimal scope** — Use only the tools the current task needs. Start narrow, expand on request.
5. **Risk classification** — LOW (read/list/draft): proceed. MEDIUM (create/update): notify + undo option. HIGH (send/delete/post): **block until explicit approval**.
   - **Always require approval**: sending any communication, deleting anything, modifying shared resources, first-time actions.
6. **Plain language** — Never expose API names, error codes, or tool internals. Report results, not process.
7. **Graceful degradation** — Never silently fail or invent data. Say what failed and what you can still do.
8. **Intent over words** — Interpret meaning ("clear my afternoon" = reschedule, not delete). Confirm before medium/high-risk interpretation. One step at a time — never cascade without confirmation.${
    hasBothEmail || hasBothCal
      ? `
9. **Tool loyalty** — ${hasBothEmail ? 'If context references Outlook → use only Outlook tools; if Gmail → only Gmail. If ambiguous → ask.' : ''}${hasBothCal ? ' Same for Google Calendar vs Outlook Calendar.' : ''} Never cross-reply (e.g., reply to Outlook email via Gmail).`
      : ''
  }
10. **Timezone** — User timezone: \`${tzName}\` (UTC${tzOffset}). When the user says a time, that IS local time — NEVER convert to UTC first.
    - "a las 10" or "10am" → \`10:00:00${tzOffset}\` ✅  "a las 2pm" → \`14:00:00${tzOffset}\` ✅
    - WRONG: "a las 10" → 22:00 ❌  WRONG: any UTC conversion before appending ${tzOffset} ❌
    - Ambiguous hour (e.g. "3", "4", "5"): if morning context → use as AM; otherwise ask. "10" alone = 10:00 AM.
    - **After any successful calendar create/update: STOP. Do NOT call update/verify/fix. One call = done.**`

  // --- Tool sections ---
  const sections: string[] = []

  // Primary invocation: mcporter (Composio MCP server)
  sections.push(`## Tool Invocation

**Primary — mcporter** (preferred):
\`\`\`
mcporter call composio.<TOOL_NAME> key=value key2=value2
\`\`\`

**Discover available tools**: \`mcporter list composio --schema --output json\`

**Fallback** (if mcporter fails or is not available):
\`\`\`
echo '{"key":"value"}' | node "${scriptPath}" TOOL_NAME
\`\`\`
For non-ASCII params (accents, ñ, emojis): \`node "${scriptPath}" TOOL_NAME b64:BASE64_ENCODED_JSON\`

Always try mcporter first. Use the fallback only if mcporter returns an error.`)

  if (hasGmail) {
    sections.push(`## Gmail

- **List/search**: \`mcporter call composio.GMAIL_FETCH_EMAILS max_results=20 query="is:unread"\`
- **Get by ID**: \`mcporter call composio.GMAIL_FETCH_MESSAGE_BY_MESSAGE_ID message_id="<id>"\`
- **Get thread**: \`mcporter call composio.GMAIL_FETCH_MESSAGE_BY_THREAD_ID thread_id="<id>"\`
- **Send**: \`mcporter call composio.GMAIL_SEND_EMAIL recipient_email="to@example.com" subject="Subject" body="Body" is_html=false\`
- **Reply** (use for replies, not SEND): \`mcporter call composio.GMAIL_REPLY_TO_THREAD thread_id="<id>" body="Reply text" recipient_email="to@example.com" is_html=false\`
- **Draft**: \`mcporter call composio.GMAIL_CREATE_EMAIL_DRAFT recipient_email="to@example.com" subject="Subject" body="Body"\`

Use \`GMAIL_REPLY_TO_THREAD\` (not SEND) for replies. \`thread_id\` comes from \`GMAIL_FETCH_EMAILS\` results.`)
  }

  if (hasGcal) {
    sections.push(`## Google Calendar

- **List events**: \`mcporter call composio.GOOGLECALENDAR_EVENTS_LIST calendarId=primary timeMin="2024-01-15T00:00:00Z" timeMax="2024-01-22T00:00:00Z" singleEvents=true orderBy=startTime\`
- **Search**: \`mcporter call composio.GOOGLECALENDAR_FIND_EVENT calendarId=primary query="meeting" timeMin="2024-01-15T00:00:00Z"\`
- **Create**: \`mcporter call composio.GOOGLECALENDAR_CREATE_EVENT summary="Meeting" start_datetime="2024-01-15T10:00:00${tzOffset}" end_datetime="2024-01-15T11:00:00${tzOffset}" timeZone="${tzName}"\`
  Datetimes MUST include offset (${tzOffset}). "10am" → \`10:00:00${tzOffset}\`, "2pm" → \`14:00:00${tzOffset}\`. NEVER use UTC times. Do NOT include \`calendar_id\`.
  **ALWAYS include \`timeZone="${tzName}"\`** — without it, Google Calendar may ignore the offset and treat the time as UTC.
  **CRITICAL: After a successful create, DO NOT call UPDATE or any other tool on that event. Success = done.**
- **Update/move**: \`mcporter call composio.GOOGLECALENDAR_UPDATE_EVENT eventId="<id>" summary="Original Title" start_datetime="2024-01-15T14:00:00${tzOffset}" end_datetime="2024-01-15T15:00:00${tzOffset}" timeZone="${tzName}" attendees=["email1@example.com","email2@example.com"]\`
  Re-send ALL fields (summary, attendees, datetimes, timeZone). One successful call = done — do NOT verify or re-call. Never delete+create.
- **Delete**: \`mcporter call composio.GOOGLECALENDAR_DELETE_EVENT calendarId=primary eventId="<id>"\``)
  }

  if (hasOutlook) {
    sections.push(`## Outlook

Discover exact Outlook action names first: \`mcporter list composio --schema --output json\` and filter for OUTLOOK_.

Common patterns:
- **List emails**: \`mcporter call composio.OUTLOOK_FETCH_EMAILS folder=inbox top=20\`
- **Send email**: \`mcporter call composio.OUTLOOK_SEND_EMAIL subject="Hello" body="Message" --args '{"to":["recipient@example.com"]}'\`
- **List events**: \`mcporter call composio.OUTLOOK_LIST_EVENTS timeMin="2024-01-15T00:00:00Z" timeMax="2024-01-22T00:00:00Z"\`
- **Create event**: \`mcporter call composio.OUTLOOK_CREATE_EVENT subject="Meeting" start="2024-01-15T10:00:00${tzOffset}" end="2024-01-15T11:00:00${tzOffset}" timeZone="${tzName}"\`
  Datetimes MUST include timezone offset (${tzOffset}). **ALWAYS include \`timeZone="${tzName}"\`**.

**If an Outlook action returns 404**, discover correct names with: \`mcporter list composio --schema --output json\`
Outlook format: title=\`subject\` (not \`summary\`), attendees=\`emailAddress.address\`.`)

    if (hasGcal) {
      sections.push(`## Cross-Calendar Scheduling

When combining Google Calendar + Outlook events:
1. Merge by start time. Conflicts = overlapping events.
2. Priority: external attendees or 3+ attendees → critical; focus/personal → flexible.
3. Ask ONE question about immovable meetings before proposing changes.`)
    }
  }

  if (hasSlack) {
    sections.push(`## Slack

- **List channels**: \`mcporter call composio.SLACK_LIST_ALL_CHANNELS_IN_THE_SLACK_WORKSPACE\`
- **Send message**: \`mcporter call composio.SLACK_SENDS_A_MESSAGE_TO_A_SLACK_CHANNEL channel="#general" text="Hello!"\``)
  }

  if (hasTrello) {
    sections.push(`## Trello

- **My boards**: \`mcporter call composio.TRELLO_GET_MEMBERS_BOARDS_BY_ID_MEMBER idMember=me\`
- **Board cards**: \`mcporter call composio.TRELLO_GET_BOARDS_CARDS_BY_ID_BOARD idBoard="<id>"\`
- **Update card**: \`mcporter call composio.TRELLO_UPDATE_CARDS_BY_ID_CARD idCard="<id>" name="New title"\`
- **Comment**: \`mcporter call composio.TRELLO_CREATE_CARDS_ACTIONS_COMMENTS_BY_ID_CARD idCard="<id>" text="Comment"\`
- **Archive**: \`mcporter call composio.TRELLO_UPDATE_CARDS_BY_ID_CARD idCard="<id>" closed=true\``)
  }

  if (hasClickup) {
    sections.push(`## ClickUp

- **Teams**: \`mcporter call composio.CLICKUP_GET_AUTHORIZED_TEAMS\`
- **Tasks**: \`mcporter call composio.CLICKUP_GET_FILTERED_TEAM_TASKS --args '{"team_id":"<id>","statuses":["open","in progress"]}'\``)
  }

  if (hasAsana) {
    sections.push(`## Asana

- **My tasks**: \`mcporter call composio.ASANA_GET_TASKS_LIST assignee=me completed_since=now\``)
  }

  if (hasNotion) {
    sections.push(`## Notion

- **Search**: \`mcporter call composio.NOTION_SEARCH --args '{"query":"","filter":{"value":"page","property":"object"}}'\``)
  }

  // Discovery + error handling (always included if any tool is connected)
  if (hasAnyTool) {
    sections.push(`## Errors & Discovery

On \`success: false\` or tool error: note failure, continue with other tasks. Don't report as "disconnected" unless asked. Don't include tool errors in briefings.

**Discover tools**: \`mcporter list composio --schema --output json\` — shows all available tools with their parameters.
**Fallback discovery**: \`${fallbackCall('_DISCOVER_ACTIONS', '{"app":"<app-slug>"}')}\`
App slugs: gmail, googlecalendar, outlook, slack, trello, clickup, asana, notion, googledrive, onedrive, dropbox, teams.
Only connected tools will work.`)
  }

  // Memory skill — always included
  const memoryScriptPath = join(SKILL_DIR, 'memory-search.cjs').replace(/\\/g, '/')
  sections.push(`## Memory

This user's memory is stored in a local database. When asked about past events, conversations, or meetings, you MUST run the search command below — it is the ONLY source of actual user data.

**REQUIRED workflow** when user asks about past events/people/meetings:
1. Run \`memory_search\` (may return empty — that is normal)
2. **ALWAYS also run** the node command: this searches the ACTUAL database

**Commands:**
- **Search**: \`node "${memoryScriptPath}" SEARCH "keywords here"\`
- **Save preference**: \`node "${memoryScriptPath}" SAVE "User prefers..." preference\`
- **Save decision**: \`node "${memoryScriptPath}" SAVE "User decided to..." decision\`

**Do NOT** look in \`~/.openclaw/workspace/memory/\` or any folder — use the node command above.

**Rules:**
- Step 2 (node command) is REQUIRED even when step 1 (memory_search) returns empty.
- Use the node command results to answer the user.
- When you learn new preferences or decisions, save them with the node command.
- Never mention the memory system — use it silently.`)

  return `---
name: attacca-tools
description: "${toolList} via Composio MCP"
metadata:
  {
    "openclaw": {
      "emoji": "🔧",
      "always": true
    }
  }
---

# Attacca Productivity Tools

You are a productivity assistant for a non-technical knowledge worker.${hasAnyTool ? ` Connected tools: ${activeNames.join(', ')}.` : ' No tools currently connected.'}

${kbContext ? `## User Context\n\n${kbContext}\n` : ''}
${principles}

${sections.join('\n\n')}
`
}
