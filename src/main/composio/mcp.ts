/**
 * Composio MCP server management.
 * Creates a single hosted MCP server on Composio's backend that exposes all
 * connected toolkits, then writes the mcporter config so the OpenClaw agent
 * can call tools via `mcporter call composio.<TOOL> key=value`.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import { app } from 'electron'
import { loadComposioApiKey } from './service'
import { getComposioEntityId } from '../identity/user-identity'

// Map frontend tool IDs → Composio toolkit slugs
const TOOL_TO_TOOLKIT: Record<string, string> = {
  'google-calendar': 'googlecalendar',
  'google-drive': 'googledrive',
  'outlook-email': 'outlook',
  'outlook-calendar': 'outlook',
  gmail: 'gmail',
  slack: 'slack',
  trello: 'trello',
  clickup: 'clickup',
  asana: 'asana',
  notion: 'notion',
  onedrive: 'one_drive',
  dropbox: 'dropbox',
  teams: 'teams',
  telegram: 'telegram'
}

interface McpLocalConfig {
  serverId: string
  mcpUrl: string
  toolkits: string[]
}

const MCP_CONFIG_PATH = join(app.getPath('userData'), 'composio-mcp.json')
const MCPORTER_CONFIG_DIR = join(homedir(), '.mcporter')
const MCPORTER_CONFIG_PATH = join(MCPORTER_CONFIG_DIR, 'mcporter.json')

function loadLocalConfig(): McpLocalConfig | null {
  if (!existsSync(MCP_CONFIG_PATH)) return null
  try {
    return JSON.parse(readFileSync(MCP_CONFIG_PATH, 'utf-8')) as McpLocalConfig
  } catch {
    return null
  }
}

function saveLocalConfig(config: McpLocalConfig): void {
  writeFileSync(MCP_CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8')
}

/**
 * Ensures a Composio MCP server exists with the given connected tools.
 * Creates or updates the server as needed, writes mcporter config.
 * Returns the MCP URL or null if setup fails.
 */
export async function ensureComposioMcpServer(connectedTools: string[]): Promise<string | null> {
  const apiKey = loadComposioApiKey()
  if (!apiKey || connectedTools.length === 0) return null

  // Deduplicate toolkit slugs
  const toolkits = [
    ...new Set(connectedTools.map((t) => TOOL_TO_TOOLKIT[t] ?? t.toLowerCase()).filter(Boolean))
  ].sort()

  const entityId = getComposioEntityId()
  const existing = loadLocalConfig()

  // Skip if toolkits haven't changed
  if (existing && JSON.stringify(toolkits) === JSON.stringify(existing.toolkits.sort())) {
    writeMcporterConfig(existing.mcpUrl, apiKey)
    return existing.mcpUrl
  }

  try {
    const { Composio } = await import('@composio/core')
    const composio = new Composio({ apiKey })

    let serverId: string

    if (existing?.serverId) {
      // Update existing server with new toolkits
      console.log('[composio-mcp] Updating MCP server:', existing.serverId)
      await (composio as any).mcp.update(existing.serverId, {
        toolkits,
        manuallyManageConnections: true
      })
      serverId = existing.serverId
    } else {
      // No local config — search Composio for existing "attacca-tools" servers
      // (handles reinstalls or multi-device setups)
      serverId = await findAndCleanMcpServers(composio)

      if (serverId) {
        console.log('[composio-mcp] Reusing existing MCP server:', serverId)
        await (composio as any).mcp.update(serverId, {
          toolkits,
          manuallyManageConnections: true
        })
      } else {
        // Create new server
        console.log('[composio-mcp] Creating MCP server with toolkits:', toolkits)
        const server = await (composio as any).mcp.create('attacca-tools', {
          toolkits,
          manuallyManageConnections: true
        })
        serverId = server.id ?? server.serverId ?? server.mcpId
        console.log('[composio-mcp] Created MCP server:', serverId)
      }
    }

    // Generate user-specific URL (must match manuallyManageConnections from create)
    const instance = await (composio as any).mcp.generate(entityId, serverId, {
      manuallyManageConnections: true
    })
    const mcpUrl: string = instance.url ?? instance.mcpUrl ?? ''
    if (!mcpUrl) {
      console.error('[composio-mcp] No MCP URL returned from generate()')
      return null
    }

    console.log('[composio-mcp] MCP URL generated:', mcpUrl.slice(0, 60) + '...')

    // Persist locally
    saveLocalConfig({ serverId, mcpUrl, toolkits })

    // Write mcporter config
    writeMcporterConfig(mcpUrl, apiKey)

    return mcpUrl
  } catch (err) {
    console.error('[composio-mcp] Failed to set up MCP server:', err)
    // Return existing URL as fallback
    if (existing?.mcpUrl) {
      writeMcporterConfig(existing.mcpUrl, apiKey)
      return existing.mcpUrl
    }
    return null
  }
}

/**
 * Writes the mcporter config file at ~/.mcporter/mcporter.json so the
 * OpenClaw agent can call `mcporter call composio.<TOOL> key=value`.
 */
function writeMcporterConfig(mcpUrl: string, apiKey: string): void {
  if (!existsSync(MCPORTER_CONFIG_DIR)) {
    mkdirSync(MCPORTER_CONFIG_DIR, { recursive: true })
  }

  // Read existing config to preserve other servers
  let config: Record<string, unknown> = { mcpServers: {}, imports: [] }
  if (existsSync(MCPORTER_CONFIG_PATH)) {
    try {
      config = JSON.parse(readFileSync(MCPORTER_CONFIG_PATH, 'utf-8'))
    } catch {
      config = { mcpServers: {}, imports: [] }
    }
  }

  const mcpServers = (config.mcpServers ?? {}) as Record<string, unknown>
  mcpServers['composio'] = {
    baseUrl: mcpUrl,
    headers: { 'x-api-key': apiKey }
  }
  config.mcpServers = mcpServers

  writeFileSync(MCPORTER_CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8')
  console.log('[composio-mcp] mcporter config written')
}

/**
 * Searches Composio for existing MCP servers.
 * Prefers "attacca-tools" if found, otherwise reuses any existing server.
 * Deletes duplicate "attacca-tools" servers (orphaned from failed setups).
 * Returns the server ID to reuse, or empty string if none found.
 */
async function findAndCleanMcpServers(composio: any): Promise<string> {
  try {
    const result = await composio.mcp.list({ limit: 20 })
    const items = result?.items ?? result ?? []
    if (!Array.isArray(items) || items.length === 0) return ''

    // Separate attacca-tools servers from others
    const attaccaServers: any[] = []
    const otherServers: any[] = []
    for (const item of items) {
      const name = item.name ?? item.serverName ?? ''
      if (name === 'attacca-tools') {
        attaccaServers.push(item)
      } else {
        otherServers.push(item)
      }
    }

    // Prefer attacca-tools, fall back to any existing server
    let serverId: string
    if (attaccaServers.length > 0) {
      serverId = attaccaServers[0].id ?? attaccaServers[0].serverId ?? ''
      // Delete duplicate attacca-tools servers (keep only the first)
      for (let i = 1; i < attaccaServers.length; i++) {
        const dupId = attaccaServers[i].id ?? attaccaServers[i].serverId
        if (dupId) {
          console.log('[composio-mcp] Deleting duplicate attacca-tools server:', dupId)
          try {
            await composio.mcp.delete(dupId)
          } catch {
            // Non-fatal — best effort cleanup
          }
        }
      }
    } else if (otherServers.length > 0) {
      // Reuse user's existing server (any name)
      const picked = otherServers[0]
      serverId = picked.id ?? picked.serverId ?? ''
      console.log(
        '[composio-mcp] No attacca-tools server found, reusing existing:',
        picked.name ?? picked.serverName ?? serverId
      )
    } else {
      return ''
    }

    return serverId
  } catch {
    // list may not be available or may fail — fall through to create
  }
  return ''
}

/**
 * Returns the stored MCP server ID, if any.
 */
export function getMcpServerId(): string | null {
  return loadLocalConfig()?.serverId ?? null
}
