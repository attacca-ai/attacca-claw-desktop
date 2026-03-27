/**
 * Lightweight HTTP server for agent tool execution via Composio.
 * Replaces relay's POST /agent/tools endpoint.
 * Listens on port 3102 so the OpenClaw call-tool.cjs script can reach it.
 */

import { createServer, type Server } from 'http'
import { proxyToolAction, executeActionDirect, listAppActions } from './service'
import { readBody, sendJson } from '../lib/http-helpers'
import { getTelemetryCollector } from '../telemetry/collector'
import { checkPermission } from './permission-gate'

let server: Server | null = null
let actualPort = 3102

/**
 * Checks if an error message indicates the toolkit is not connected for this user.
 * Covers both "ConnectedAccountNotFound" (no OAuth link) and "ToolNotFound" (invalid action name).
 */
function isNotConnectedError(msg: string): boolean {
  return /ConnectedAccountNotFound|No connected account found|No active connection exists/i.test(
    msg
  )
}

function isToolNotFoundError(msg: string): boolean {
  return /Tool_ToolNotFound|Tool .+ not found/i.test(msg)
}

/**
 * Extracts the toolkit name from a Composio action name.
 * e.g. "CLICKUP_GET_WORKSPACES" → "ClickUp", "GMAIL_FETCH_EMAILS" → "Gmail"
 */
function extractToolkitFromAction(actionName: string): string {
  const prefix = (actionName.split('_')[0] ?? '').toLowerCase()
  const names: Record<string, string> = {
    gmail: 'Gmail',
    googlecalendar: 'Google Calendar',
    outlook: 'Outlook',
    slack: 'Slack',
    trello: 'Trello',
    clickup: 'ClickUp',
    asana: 'Asana',
    notion: 'Notion',
    googledrive: 'Google Drive',
    onedrive: 'OneDrive',
    dropbox: 'Dropbox',
    teams: 'Teams',
    telegram: 'Telegram',
    github: 'GitHub'
  }
  return names[prefix] ?? (prefix || 'Unknown')
}

export function startComposioServer(): Promise<number> {
  return new Promise((resolve, reject) => {
    if (server) {
      resolve(actualPort)
      return
    }

    server = createServer(async (req, res) => {
      res.setHeader('Access-Control-Allow-Origin', '*')
      res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

      if (req.method === 'OPTIONS') {
        res.writeHead(204)
        res.end()
        return
      }

      if (req.method !== 'POST' || req.url !== '/execute') {
        sendJson(res, 404, { success: false, error: 'Not found' })
        return
      }

      // Track actionName outside try/catch so error handler can reference it
      let currentAction = ''

      try {
        const body = JSON.parse(await readBody(req)) as {
          actionName: string
          entityId: string
          params: Record<string, unknown>
        }

        const { actionName, entityId, params } = body
        currentAction = actionName
        if (!actionName || !entityId) {
          sendJson(res, 400, { success: false, error: 'Missing actionName or entityId' })
          return
        }

        console.log(
          `[composio-server] ▶ Tool call: ${actionName} entity=${entityId.slice(0, 8)}... params=${JSON.stringify(params).slice(0, 200)}`
        )

        // Permission gate — blocks for medium/high risk actions based on trust profile
        const approved = await checkPermission(actionName, params || {})
        if (!approved) {
          console.log(`[composio-server] ✗ ${actionName} denied by user`)
          getTelemetryCollector().emit('agent.tool_call.failed', {
            actionName,
            toolkit: extractToolkitFromAction(actionName),
            errorCategory: 'permission_denied'
          })
          sendJson(res, 200, {
            success: false,
            error: `Action "${actionName}" was denied by the user. Do not retry this action unless the user explicitly asks you to.`
          })
          return
        }

        // Meta-action: discover available actions for an app
        let result: unknown
        if (actionName === '_DISCOVER_ACTIONS') {
          const appSlug = (params?.app as string) ?? ''
          if (!appSlug) {
            sendJson(res, 400, {
              success: false,
              error: 'Missing params.app for _DISCOVER_ACTIONS'
            })
            return
          }
          const actions = await listAppActions(appSlug)
          result = { actions }
          console.log(
            `[composio-server] ✓ _DISCOVER_ACTIONS for ${appSlug}: ${actions.length} actions`
          )
        } else {
          // Try SDK execution first, fall back to direct REST API
          try {
            result = await proxyToolAction(entityId, actionName, params || {})
            console.log(`[composio-server] ✓ ${actionName} succeeded (SDK)`)
            getTelemetryCollector().emit('agent.tool_call.succeeded', {
              actionName,
              toolkit: extractToolkitFromAction(actionName),
              method: 'sdk'
            })
          } catch (sdkErr) {
            const sdkMsg = (sdkErr as Error).message ?? ''
            // If the toolkit is not connected for this user, return immediately
            // with a clear message so the agent stops retrying.
            if (isNotConnectedError(sdkMsg)) {
              const toolkit = extractToolkitFromAction(actionName)
              console.warn(`[composio-server] ${toolkit} is not connected — skipping ${actionName}`)
              getTelemetryCollector().emit('agent.tool_call.failed', {
                actionName,
                toolkit,
                errorCategory: 'not_connected'
              })
              sendJson(res, 200, {
                success: false,
                error: `${toolkit} is not connected. Do not call any more ${toolkit} actions — the user has not connected this tool.`
              })
              return
            }
            console.warn(`[composio-server] SDK failed for ${actionName}, trying REST:`, sdkMsg)
            result = await executeActionDirect(entityId, actionName, params || {})
            console.log(`[composio-server] ✓ ${actionName} succeeded (REST)`)
            getTelemetryCollector().emit('agent.tool_call.succeeded', {
              actionName,
              toolkit: extractToolkitFromAction(actionName),
              method: 'rest'
            })
          }
        }

        sendJson(res, 200, { success: true, result })
      } catch (err) {
        const errMsg = (err as Error).message ?? ''
        // Catch "not connected" errors from the REST fallback as well
        if (isNotConnectedError(errMsg)) {
          const toolkit = extractToolkitFromAction(currentAction)
          console.warn(`[composio-server] ${toolkit} is not connected — skipping ${currentAction}`)
          getTelemetryCollector().emit('agent.tool_call.failed', {
            actionName: currentAction,
            toolkit,
            errorCategory: 'not_connected'
          })
          sendJson(res, 200, {
            success: false,
            error: `${toolkit} is not connected. Do not retry — the user has not connected this tool.`
          })
          return
        }
        // Tool action name doesn't exist in Composio
        if (isToolNotFoundError(errMsg)) {
          console.warn(`[composio-server] Action not found: ${currentAction}`)
          getTelemetryCollector().emit('agent.tool_call.failed', {
            actionName: currentAction,
            toolkit: extractToolkitFromAction(currentAction),
            errorCategory: 'tool_not_found'
          })
          sendJson(res, 200, {
            success: false,
            error: `Action "${currentAction}" does not exist. Use _DISCOVER_ACTIONS to find valid action names, or skip this tool if it is not connected.`
          })
          return
        }
        console.error('[composio-server] Error:', err)
        getTelemetryCollector().emit('agent.tool_call.failed', {
          actionName: currentAction,
          toolkit: extractToolkitFromAction(currentAction),
          errorCategory: 'unknown'
        })
        sendJson(res, 500, { success: false, error: errMsg })
      }
    })

    const tryPort: number = 3102
    server.listen(tryPort, '127.0.0.1', () => {
      const addr = server!.address()
      actualPort = typeof addr === 'object' && addr ? addr.port : tryPort
      console.log(`[composio] Server listening on http://127.0.0.1:${actualPort}`)
      resolve(actualPort)
    })

    server.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE' && tryPort !== 0) {
        console.warn(`[composio] Port ${tryPort} in use, using random port`)
        server!.listen(0, '127.0.0.1')
      } else {
        console.error('[composio] Server error:', err)
        reject(err)
      }
    })
  })
}

export function stopComposioServer(): void {
  if (server) {
    server.close()
    server = null
  }
}
