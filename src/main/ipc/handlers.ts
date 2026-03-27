import { ipcMain, app, shell, dialog } from 'electron'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { homedir } from 'os'
import { IPC } from './channels'
import { getGatewayState, startGateway, stopGateway, restartGateway } from '../gateway/lifecycle'
import { checkGatewayHealth } from '../gateway/health'
import { writeConfig, readConfig, getGatewayToken, writeAgentAuthProfiles } from '../gateway/config'
import { registerActiveCollabHandlers } from './activecollab-handlers'
import { llmCompletion } from '../llm/completion'
import { extractUrl } from '../capture/extractor'
import { getMonthlyUsage, ensureUsageTables } from '../usage/tracker'
import { getTaskStatuses, setTaskEnabled, runTaskNow } from '../scheduler'
import { getComposioEntityId } from '../identity/user-identity'
import { resolvePermission } from '../composio/permission-gate'
import {
  saveComposioApiKey,
  getComposioApiKeyHint,
  initiateOAuth as composioInitiateOAuth,
  getConnectionStatus as composioGetStatus,
  getConnectedApps as composioGetConnected,
  listApps as composioListApps,
  proxyToolAction as composioCallTool,
  executeActionDirect as composioCallToolDirect
} from '../composio/service'
import { getTelemetryCollector } from '../telemetry/collector'
import { insertMemory, updateEmbedding, getMemoryStats, getIdentityTraits } from '../memory/db'
import { generateEmbedding, float32ToBuffer } from '../memory/embeddings'
import { searchMemories, searchMemoriesByKeyword } from '../memory/search'

export function registerIpcHandlers(): void {
  registerActiveCollabHandlers()
  // ── Gateway ──
  ipcMain.handle(IPC.GATEWAY_START, async () => {
    await startGateway()
    return { success: true }
  })

  ipcMain.handle(IPC.GATEWAY_STOP, async () => {
    await stopGateway()
    return { success: true }
  })

  ipcMain.handle(IPC.GATEWAY_RESTART, async () => {
    await restartGateway()
    return { success: true }
  })

  ipcMain.handle(IPC.GATEWAY_STATUS, () => {
    return getGatewayState()
  })

  ipcMain.handle(IPC.GATEWAY_HEALTH, async () => {
    return checkGatewayHealth()
  })

  ipcMain.handle(IPC.GATEWAY_GET_TOKEN, () => {
    return { token: getGatewayToken() }
  })

  // ── LLM Provider ──
  ipcMain.handle(IPC.LLM_TEST_CONNECTION, async (_event, provider: string, apiKey: string) => {
    try {
      const { testLLMConnection } = await import('../llm/test-connection')
      return testLLMConnection(provider, apiKey)
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Unknown error' }
    }
  })

  ipcMain.handle(
    IPC.LLM_SAVE_CONFIG,
    async (_event, provider: string, model: string, apiKey: string) => {
      console.log(`[llm] Saving config: provider=${provider} model=${model}`)
      const config = readConfig()
      config.llm = {
        provider: provider as 'anthropic' | 'openai' | 'google',
        model,
        apiKey
      }
      writeConfig(config)
      // Also write auth-profiles.json so the gateway process can find the key directly
      writeAgentAuthProfiles(provider, apiKey)
      console.log('[llm] Config saved + auth-profiles written')
      return { success: true }
    }
  )

  ipcMain.handle(IPC.LLM_GET_CONFIG, () => {
    const config = readConfig()
    if (!config.llm) return null
    return {
      provider: config.llm.provider,
      model: config.llm.model,
      apiKeyHint: config.llm.apiKey ? '****' + config.llm.apiKey.slice(-4) : null
    }
  })

  // ── Onboarding ──
  ipcMain.handle(IPC.ONBOARDING_GET_STATE, () => {
    const filePath = join(app.getPath('userData'), 'onboarding.json')
    if (!existsSync(filePath)) return null
    try {
      return JSON.parse(readFileSync(filePath, 'utf-8'))
    } catch {
      return null
    }
  })

  ipcMain.handle(IPC.ONBOARDING_SAVE_STATE, (_event, state: unknown) => {
    const filePath = join(app.getPath('userData'), 'onboarding.json')
    const dir = dirname(filePath)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    writeFileSync(filePath, JSON.stringify(state, null, 2), 'utf-8')
  })

  ipcMain.handle(IPC.ONBOARDING_COMPLETE, () => {
    console.log('[onboarding] Completed')
    const filePath = join(app.getPath('userData'), 'onboarding.json')
    const dir = dirname(filePath)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    let state: Record<string, unknown> = {}
    if (existsSync(filePath)) {
      try {
        state = JSON.parse(readFileSync(filePath, 'utf-8'))
      } catch {
        /* empty */
      }
    }
    state.completed = true
    writeFileSync(filePath, JSON.stringify(state, null, 2), 'utf-8')
  })

  // ── App ──
  ipcMain.handle(IPC.APP_GET_VERSION, () => {
    return app.getVersion()
  })

  ipcMain.handle(IPC.APP_OPEN_EXTERNAL, async (_event, url: string) => {
    await shell.openExternal(url)
  })

  ipcMain.handle(IPC.APP_QUIT, () => {
    app.quit()
  })

  // ── File system ──
  ipcMain.handle(IPC.FS_SELECT_FOLDER, async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory']
    })
    if (result.canceled) return null
    return result.filePaths[0]
  })

  // ── Settings ──
  ipcMain.handle(IPC.SETTINGS_GET, (_event, key: string) => {
    const filePath = join(app.getPath('userData'), 'settings.json')
    if (!existsSync(filePath)) return null
    try {
      const settings = JSON.parse(readFileSync(filePath, 'utf-8'))
      return settings[key] ?? null
    } catch {
      return null
    }
  })

  ipcMain.handle(IPC.SETTINGS_SET, (_event, key: string, value: unknown) => {
    const filePath = join(app.getPath('userData'), 'settings.json')
    let settings: Record<string, unknown> = {}
    if (existsSync(filePath)) {
      try {
        settings = JSON.parse(readFileSync(filePath, 'utf-8'))
      } catch {
        /* empty */
      }
    }
    settings[key] = value
    writeFileSync(filePath, JSON.stringify(settings, null, 2), 'utf-8')
  })

  // ── Composio (local) ──
  ipcMain.handle(IPC.COMPOSIO_SET_API_KEY, (_event, apiKey: string) => {
    try {
      saveComposioApiKey(apiKey)
      // Restart gateway so it detects existing connected tools and creates the MCP server
      restartGateway().catch((err) => {
        console.warn('[composio] Gateway restart after API key save failed:', err)
      })
      return { success: true }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Failed to save key' }
    }
  })

  ipcMain.handle(IPC.COMPOSIO_GET_API_KEY, () => {
    return { hint: getComposioApiKeyHint() }
  })

  ipcMain.handle(IPC.COMPOSIO_INITIATE_OAUTH, async (_event, appName: string) => {
    try {
      const entityId = getComposioEntityId()
      const result = await composioInitiateOAuth(entityId, appName)
      return { success: true, ...result }
    } catch (err) {
      console.error('[composio] OAuth initiation failed:', err)
      return {
        success: false,
        error: err instanceof Error ? err.message : 'OAuth initiation failed'
      }
    }
  })

  ipcMain.handle(IPC.COMPOSIO_GET_STATUS, async (_event, connectionId: string) => {
    try {
      return await composioGetStatus(connectionId)
    } catch (err) {
      return { status: 'failed', error: err instanceof Error ? err.message : 'Status check failed' }
    }
  })

  ipcMain.handle(IPC.COMPOSIO_GET_CONNECTED, async () => {
    try {
      const entityId = getComposioEntityId()
      const connected = await composioGetConnected(entityId)
      console.log('[composio] Connected tools:', connected)
      return connected
    } catch (err) {
      console.error('[composio] Failed to get connected tools:', err)
      return []
    }
  })

  ipcMain.handle(IPC.COMPOSIO_LIST_APPS, async () => {
    try {
      return await composioListApps()
    } catch {
      return []
    }
  })

  ipcMain.handle(
    IPC.COMPOSIO_CALL_TOOL,
    async (_event, actionName: string, params: Record<string, unknown>) => {
      try {
        const entityId = getComposioEntityId()
        let raw: Record<string, unknown>

        // Try SDK first, fall back to REST API (same pattern as composio server)
        try {
          raw = (await composioCallTool(entityId, actionName, params)) as Record<string, unknown>
        } catch (sdkErr) {
          console.warn(
            `[ipc] SDK call failed for ${actionName}, trying REST:`,
            (sdkErr as Error).message
          )
          raw = (await composioCallToolDirect(entityId, actionName, params)) as Record<
            string,
            unknown
          >
        }

        // Normalize Composio SDK response { successful, data, error }
        // to the shape callers expect { success, result, error }
        return {
          success: raw?.successful ?? true,
          result: raw?.data ?? raw,
          error: raw?.error ?? null
        }
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : 'Tool call failed' }
      }
    }
  )

  // ── Usage (local) ──
  ipcMain.handle(IPC.RELAY_GET_USAGE, () => {
    try {
      ensureUsageTables()
      const usage = getMonthlyUsage()
      return {
        totalCostUsd: usage.totalCostUsd,
        requestCount: usage.requestCount,
        models: usage.models,
        budgetAlert: usage.budgetAlert
      }
    } catch (err) {
      return {
        totalCostUsd: 0,
        requestCount: 0,
        models: {},
        budgetAlert: null,
        error: err instanceof Error ? err.message : 'Failed to get usage'
      }
    }
  })

  // ── LLM Completion (local BYOK) ──
  ipcMain.handle(
    IPC.RELAY_LLM_COMPLETION,
    async (
      _event,
      messages: Array<{ role: string; content: string }>,
      opts?: { model?: string; max_tokens?: number }
    ) => {
      console.log(
        `[ipc] relay:llm-completion messages=${messages.length} model=${opts?.model || 'default'}`
      )
      try {
        const result = await llmCompletion({ messages, ...opts })
        return result
      } catch (err) {
        console.error('[ipc] relay:llm-completion error:', err)
        return {
          success: false,
          error: err instanceof Error ? err.message : 'LLM completion failed'
        }
      }
    }
  )

  // ── URL Extraction (local) ──
  ipcMain.handle(IPC.RELAY_EXTRACT_URL, async (_event, url: string) => {
    try {
      return await extractUrl(url)
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'URL extraction failed' }
    }
  })

  // ── Agent state persistence ──
  ipcMain.handle(IPC.AGENT_GET_STATE, () => {
    const filePath = join(app.getPath('userData'), 'agent-state.json')
    if (!existsSync(filePath)) return null
    try {
      return JSON.parse(readFileSync(filePath, 'utf-8'))
    } catch {
      return null
    }
  })

  ipcMain.handle(IPC.AGENT_SET_STATE, (_event, state: unknown) => {
    const filePath = join(app.getPath('userData'), 'agent-state.json')
    const dir = dirname(filePath)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    writeFileSync(filePath, JSON.stringify(state, null, 2), 'utf-8')
  })

  // ── Knowledge Base ──
  ipcMain.handle(
    IPC.KB_SAVE_CAPTURE,
    (
      _event,
      data: {
        id: string
        sourceType: string
        title: string
        content: string
        result: {
          summary: string
          actionItems: Array<{ text: string; owner?: string }>
          decisions: string[]
          openQuestions: string[]
          keyPoints: string[]
          entities?: { people?: string[]; projects?: string[]; dates?: string[] }
        }
        timestamp: number
      }
    ) => {
      console.log(
        `[kb] Saving capture: id=${data.id} type=${data.sourceType} title="${data.title}"`
      )
      const kbDir = join(app.getPath('userData'), 'attacca-kb')
      const date = new Date(data.timestamp)
      const dateStr = date.toISOString().slice(0, 10)
      const timeStr = date.toTimeString().slice(0, 5)

      // Write inbox capture file
      const inboxDir = join(kbDir, 'inbox', dateStr)
      mkdirSync(inboxDir, { recursive: true })

      const actionItemsMd = data.result.actionItems.length
        ? data.result.actionItems
            .map((i) => `- [ ] ${i.text}${i.owner ? ` (${i.owner})` : ''}`)
            .join('\n')
        : '_None_'
      const decisionsMd = data.result.decisions.length
        ? data.result.decisions.map((d) => `- ${d}`).join('\n')
        : '_None_'
      const questionsMd = data.result.openQuestions.length
        ? data.result.openQuestions.map((q) => `- ${q}`).join('\n')
        : '_None_'
      const entities = data.result.entities ?? {}
      const entitiesMd =
        [
          entities.people?.length ? `People: ${entities.people.join(', ')}` : '',
          entities.projects?.length ? `Projects: ${entities.projects.join(', ')}` : '',
          entities.dates?.length ? `Dates: ${entities.dates.join(', ')}` : ''
        ]
          .filter(Boolean)
          .join('\n') || '_None_'

      const captureContent = `---
id: ${data.id}
date: ${dateStr}
source: ${data.sourceType}
title: ${data.title}
---

## Summary
${data.result.summary}

## Action Items
${actionItemsMd}

## Decisions
${decisionsMd}

## Open Questions
${questionsMd}

## Entities
${entitiesMd}
`
      writeFileSync(join(inboxDir, `${data.id}-${data.sourceType}.md`), captureContent, 'utf-8')

      // Update CONTEXT.md
      const memoryDir = join(kbDir, 'memory')
      mkdirSync(memoryDir, { recursive: true })
      const ctxPath = join(memoryDir, 'CONTEXT.md')

      let ctxContent = existsSync(ctxPath)
        ? readFileSync(ctxPath, 'utf-8')
        : `# Attacca User Context\n\n## Recent Captures (last 5)\n<!-- agent-managed: do not edit manually -->\n\n## Active Projects\n<!-- agent-managed: do not edit manually -->\n\n## Key People\n<!-- agent-managed: do not edit manually -->\n`

      // Update Recent Captures section
      const newCaptureEntry = `- [${data.sourceType}] "${data.title}" — ${dateStr} ${timeStr}`
      const recentMatch = ctxContent.match(
        /(## Recent Captures[^\n]*\n<!-- agent-managed[^\n]*\n)([\s\S]*?)(## Active Projects)/
      )
      if (recentMatch) {
        const existing = recentMatch[2]
          .trim()
          .split('\n')
          .filter((l) => l.startsWith('-'))
          .slice(0, 4)
        const updated = [newCaptureEntry, ...existing].join('\n')
        ctxContent = ctxContent.replace(
          /(## Recent Captures[^\n]*\n<!-- agent-managed[^\n]*\n)[\s\S]*?(## Active Projects)/,
          `$1${updated}\n\n$2`
        )
      }

      // Update Active Projects section
      if (entities.projects?.length) {
        for (const project of entities.projects) {
          if (!ctxContent.includes(project)) {
            ctxContent = ctxContent.replace(
              /(## Active Projects\n<!-- agent-managed[^\n]*\n)([\s\S]*?)(## Key People)/,
              (_m, header, body, next) => {
                const trimmed = body.trim()
                const newBody = trimmed ? `${trimmed}\n- ${project}` : `- ${project}`
                return `${header}${newBody}\n\n${next}`
              }
            )
          }
        }
      }

      // Update Key People section
      if (entities.people?.length) {
        for (const person of entities.people) {
          if (!ctxContent.includes(person)) {
            ctxContent = ctxContent.replace(
              /(## Key People\n<!-- agent-managed[^\n]*\n)([\s\S]*?)$/,
              (_m, header, body) => {
                const trimmed = body.trim()
                return `${header}${trimmed ? `${trimmed}\n- ${person}` : `- ${person}`}\n`
              }
            )
          }
        }
      }

      writeFileSync(ctxPath, ctxContent, 'utf-8')

      // Append to daily log
      const dailyDir = join(kbDir, 'daily')
      mkdirSync(dailyDir, { recursive: true })
      const dailyPath = join(dailyDir, `${dateStr}.md`)
      const dailyHeader = existsSync(dailyPath) ? '' : `# Daily Log — ${dateStr}\n\n`
      const logEntry = `${dailyHeader}## ${timeStr} — Capture saved\nSource: ${data.sourceType}\nTitle: ${data.title}\nAction items: ${data.result.actionItems.length} | Decisions: ${data.result.decisions.length} | Open questions: ${data.result.openQuestions.length}\n\n`
      writeFileSync(
        dailyPath,
        existsSync(dailyPath) ? readFileSync(dailyPath, 'utf-8') + logEntry : logEntry,
        'utf-8'
      )

      // Persist to memory DB for semantic search (embedding generated async — non-blocking)
      const memId = `mem_capture_${data.id}`
      const memContent = `${data.result.summary}\n\nKey points: ${(data.result.keyPoints || []).join('; ')}\nDecisions: ${data.result.decisions.join('; ') || 'none'}`
      const memTags = [
        ...(entities.people || []).map((p) => `person:${p}`),
        ...(entities.projects || []).map((p) => `project:${p}`),
        `source:${data.sourceType}`
      ]

      insertMemory({
        id: memId,
        type: 'capture',
        content: memContent,
        summary: data.result.summary,
        embedding: null, // filled async below
        source_id: data.id,
        tags: JSON.stringify(memTags),
        importance: data.result.decisions.length > 0 ? 0.7 : 0.5,
        created_at: data.timestamp,
        superseded_by: null
      })

      // Also write as markdown to ~/.openclaw/workspace/memory/ so the agent can find it via filesystem
      try {
        const ocMemDir = join(homedir(), '.openclaw', 'workspace', 'memory')
        if (!existsSync(ocMemDir)) mkdirSync(ocMemDir, { recursive: true })
        const ts = new Date(data.timestamp)
        const fileDateStr = ts.toISOString().slice(0, 10)
        const fileTimeStr = ts.toISOString().slice(11, 16).replace(':', '')
        const slug = data.result.summary
          .slice(0, 40)
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .toLowerCase()
          .replace(/[^a-z0-9 ]/g, '')
          .trim()
          .replace(/ +/g, '-')
          .slice(0, 40)
        const memFilePath = join(ocMemDir, `${fileDateStr}-${fileTimeStr}-${slug}.md`)
        writeFileSync(
          memFilePath,
          `# ${data.result.summary}\n\nDate: ${fileDateStr}\nType: capture\n\n${memContent}`,
          'utf-8'
        )
      } catch {
        /* non-critical */
      }

      // Generate embedding async — don't block the capture save
      generateEmbedding(`${data.result.summary}\n${memContent}`)
        .then((emb) => {
          if (emb) {
            updateEmbedding(memId, float32ToBuffer(emb))
          }
        })
        .catch(() => {
          /* embedding backfill will catch this later */
        })

      return { success: true }
    }
  )

  ipcMain.handle(IPC.KB_READ_CONTEXT, () => {
    const ctxPath = join(app.getPath('userData'), 'attacca-kb', 'memory', 'CONTEXT.md')
    if (!existsSync(ctxPath)) return ''
    try {
      return readFileSync(ctxPath, 'utf-8')
    } catch {
      return ''
    }
  })

  ipcMain.handle(IPC.KB_APPEND_DAILY_LOG, (_event, entry: string) => {
    const kbDir = join(app.getPath('userData'), 'attacca-kb')
    const dailyDir = join(kbDir, 'daily')
    mkdirSync(dailyDir, { recursive: true })
    const dateStr = new Date().toISOString().slice(0, 10)
    const dailyPath = join(dailyDir, `${dateStr}.md`)
    const header = existsSync(dailyPath) ? '' : `# Daily Log — ${dateStr}\n\n`
    writeFileSync(
      dailyPath,
      (existsSync(dailyPath) ? readFileSync(dailyPath, 'utf-8') : '') + header + entry + '\n',
      'utf-8'
    )
    return { success: true }
  })

  // ── Telemetry ──
  ipcMain.handle(IPC.TELEMETRY_SET_OPT_IN, (_event, optIn: boolean) => {
    const collector = getTelemetryCollector()
    collector.setOptIn(optIn)
    return { success: true }
  })

  ipcMain.handle(IPC.TELEMETRY_GET_OPT_IN, () => {
    const collector = getTelemetryCollector()
    return { optIn: collector.getOptIn() }
  })

  ipcMain.handle(IPC.TELEMETRY_DELETE_DATA, async () => {
    const collector = getTelemetryCollector()
    await collector.deleteData()
    return { success: true }
  })

  ipcMain.handle(
    IPC.TELEMETRY_EMIT,
    (_event, eventType: string, payload: Record<string, unknown>) => {
      const collector = getTelemetryCollector()
      collector.emit(eventType, payload)
      return { success: true }
    }
  )

  ipcMain.handle(IPC.TELEMETRY_GET_QUEUE, () => {
    const collector = getTelemetryCollector()
    return { events: collector.getQueuedEvents() }
  })

  ipcMain.handle(IPC.TELEMETRY_GET_STATUS, () => {
    const collector = getTelemetryCollector()
    return {
      optedIn: collector.getOptIn(),
      lastFlush: collector.getLastFlush(),
      queueSize: collector.getQueueSize()
    }
  })

  // ── Scheduler ──
  ipcMain.handle(IPC.SCHEDULER_GET_TASKS, () => {
    return getTaskStatuses()
  })

  ipcMain.handle(IPC.SCHEDULER_SET_ENABLED, (_event, taskId: string, enabled: boolean) => {
    setTaskEnabled(taskId, enabled)
    return { success: true }
  })

  ipcMain.handle(IPC.SCHEDULER_RUN_NOW, async (_event, taskId: string) => {
    try {
      await runTaskNow(taskId)
      return { success: true }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Task failed' }
    }
  })

  // ── Permissions ──
  ipcMain.handle(
    IPC.PERMISSION_RESOLVE,
    (_event, requestId: string, approved: boolean, standing: boolean) => {
      resolvePermission(requestId, approved, standing)
      return { success: true }
    }
  )

  // ── Memory ──
  ipcMain.handle(IPC.MEMORY_SEARCH, async (_event, query: string) => {
    console.log(`[memory] Search: "${query.slice(0, 80)}"`)
    try {
      const queryEmb = await generateEmbedding(query)
      const results = queryEmb ? searchMemories(queryEmb) : searchMemoriesByKeyword(query)
      console.log(
        `[memory] Search results: ${results.length} found (${queryEmb ? 'semantic' : 'keyword'})`
      )
      return { success: true, results }
    } catch (err) {
      console.error('[memory] Search error:', err)
      return { success: false, error: (err as Error).message, results: [] }
    }
  })

  ipcMain.handle(
    IPC.MEMORY_SAVE,
    async (
      _event,
      data: {
        content: string
        type?: string
        summary?: string
        tags?: string[]
        importance?: number
        source_id?: string
      }
    ) => {
      try {
        console.log(
          `[memory] Save: type=${data.type || 'preference'} content="${data.content.slice(0, 80)}..."`
        )
        const id = `mem_${crypto.randomUUID()}`
        const summary = data.summary || data.content.slice(0, 200)
        const embedding = await generateEmbedding(`${summary}\n${data.content}`)

        insertMemory({
          id,
          type: (data.type || 'preference') as
            | 'capture'
            | 'preference'
            | 'decision'
            | 'identity'
            | 'synthesis',
          content: data.content,
          summary,
          embedding: embedding ? float32ToBuffer(embedding) : null,
          source_id: data.source_id || null,
          tags: JSON.stringify(data.tags || []),
          importance: data.importance ?? 0.5,
          created_at: Date.now(),
          superseded_by: null
        })

        return { success: true, id }
      } catch (err) {
        return { success: false, error: (err as Error).message }
      }
    }
  )

  ipcMain.handle(IPC.MEMORY_GET_STATS, () => {
    try {
      return { success: true, ...getMemoryStats() }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  })

  ipcMain.handle(IPC.MEMORY_GET_IDENTITY, () => {
    try {
      const traits = getIdentityTraits()
      return {
        success: true,
        traits: traits.map((t) => ({ key: t.key, value: t.value, confidence: t.confidence }))
      }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  })
}
