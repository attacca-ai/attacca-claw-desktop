import { ChildProcess, spawn } from 'child_process'
import path from 'path'
import { existsSync, readFileSync, appendFileSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'
import {
  ensureConfig,
  ensureControlUiConfig,
  ensureRelayProviderConfig,
  ensureComposioSkill,
  clearSessionSkillsSnapshot
} from './config'
import { getConnectedApps as composioGetConnected } from '../composio/service'
import { getComposioEntityId } from '../identity/user-identity'
import { getMainWindow } from '../window/main-window'
import { IPC } from '../ipc/channels'
import { getTelemetryCollector } from '../telemetry/collector'

/** Write to a persistent log file so we can diagnose packaged-app issues */
function logToFile(msg: string): void {
  try {
    const logPath = join(app.getPath('userData'), 'gateway.log')
    appendFileSync(logPath, `[${new Date().toISOString()}] ${msg}\n`)
  } catch {
    // Best effort
  }
}

function isOnboardingComplete(): boolean {
  try {
    const filePath = join(app.getPath('userData'), 'onboarding.json')
    if (!existsSync(filePath)) return false
    const state = JSON.parse(readFileSync(filePath, 'utf-8'))
    return state?.completed === true
  } catch {
    return false
  }
}

export type GatewayState = 'stopped' | 'starting' | 'running' | 'stopping' | 'error'

interface GatewayInfo {
  state: GatewayState
  pid: number | null
  restartCount: number
  lastError: string | null
  startedAt: number | null
}

let gatewayProcess: ChildProcess | null = null
let state: GatewayState = 'stopped'
let restartCount = 0
let lastError: string | null = null
let startedAt: number | null = null

const MAX_RESTARTS = 5
const RESTART_WINDOW_MS = 60_000
let restartTimestamps: number[] = []

function setState(newState: GatewayState): void {
  state = newState
  const mainWindow = getMainWindow()
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(IPC.EVENT_GATEWAY_STATE_CHANGED, getGatewayState())
  }
}

export function getGatewayState(): GatewayInfo {
  return {
    state,
    pid: gatewayProcess?.pid ?? null,
    restartCount,
    lastError,
    startedAt
  }
}

function resolveOpenClawMjs(): string {
  if (app.isPackaged) {
    // Production: bundled in extraResources
    return path.join(process.resourcesPath, 'openclaw', 'openclaw.mjs')
  }
  // Development: resolve from node_modules
  return path.join(app.getAppPath(), 'node_modules', 'openclaw', 'openclaw.mjs')
}

export async function startGateway(): Promise<void> {
  if (state === 'running' || state === 'starting') {
    return
  }

  // Check restart rate limiting
  const now = Date.now()
  restartTimestamps = restartTimestamps.filter((t) => now - t < RESTART_WINDOW_MS)
  if (restartTimestamps.length >= MAX_RESTARTS) {
    const err = `Gateway restart limit reached (${MAX_RESTARTS} restarts in ${RESTART_WINDOW_MS / 1000}s)`
    lastError = err
    setState('error')
    throw new Error(err)
  }

  setState('starting')
  const gatewayStartTime = Date.now()
  logToFile('--- Gateway starting ---')
  ensureControlUiConfig()
  const config = ensureConfig()

  // Configure OpenClaw LLM routing.
  // If the user has set a BYOK key, use the built-in provider directly.
  // Otherwise, fall back to the relay proxy (interim — relay removed in Phase 3).
  ensureRelayProviderConfig(
    config.llm ? { provider: config.llm.provider, model: config.llm.model } : null
  )

  // Write the Composio workspace skill so the agent can call Gmail, Calendar, etc.
  // Pass connected tools so only relevant tool docs are included (reduces token usage).
  // Skip if onboarding hasn't completed yet (API key may exist from a previous install).
  // IMPORTANT: We await this before spawning the gateway so SKILL.md is current
  // and the agent doesn't see stale tool documentation from a previous run.
  if (isOnboardingComplete()) {
    try {
      const entityId = getComposioEntityId()
      console.log('[gateway] Composio entityId:', entityId)
      try {
        const connectedTools = await composioGetConnected(entityId)
        console.log('[gateway] Connected tools for skill:', connectedTools)
        ensureComposioSkill(entityId, connectedTools)
      } catch (err) {
        console.warn('[gateway] Could not fetch Composio tools:', err)
        ensureComposioSkill(entityId, [])
      }
    } catch (err) {
      console.warn('[gateway] Could not write Composio skill:', err)
    }
  } else {
    console.log('[gateway] Skipping Composio setup — onboarding not complete')
  }

  // Clear stale skills snapshot so the gateway rebuilds it with the current skill set.
  clearSessionSkillsSnapshot()

  // Inject LLM API key into gateway env so OpenClaw can find it
  const gatewayEnv: NodeJS.ProcessEnv = { ...process.env }
  // In production, use Electron's bundled Node.js instead of system 'node'
  if (app.isPackaged) {
    gatewayEnv.ELECTRON_RUN_AS_NODE = '1'
  }
  if (config.llm?.apiKey) {
    const provider = config.llm.provider
    if (provider === 'anthropic') gatewayEnv.ANTHROPIC_API_KEY = config.llm.apiKey
    else if (provider === 'openai') gatewayEnv.OPENAI_API_KEY = config.llm.apiKey
    else if (provider === 'google') gatewayEnv.GOOGLE_API_KEY = config.llm.apiKey
  }

  return new Promise((resolve, reject) => {
    try {
      const openclawMjs = resolveOpenClawMjs()
      const nodeCmd = app.isPackaged ? process.execPath : 'node'
      logToFile(`Spawning: ${nodeCmd} ${openclawMjs} gateway --port ${config.gateway.port}`)
      logToFile(`File exists: ${existsSync(openclawMjs)}`)
      logToFile(`isPackaged: ${app.isPackaged}, resourcesPath: ${process.resourcesPath}`)
      gatewayProcess = spawn(
        nodeCmd,
        [openclawMjs, 'gateway', '--port', String(config.gateway.port)],
        {
          stdio: ['ignore', 'pipe', 'pipe'],
          env: gatewayEnv,
          windowsHide: true
        }
      )

      logToFile(`Process spawned, pid=${gatewayProcess.pid}`)

      gatewayProcess.stdout?.on('data', (data: Buffer) => {
        const msg = data.toString().trim()
        console.log(`[gateway] ${msg}`)
        logToFile(`[stdout] ${msg}`)

        // Detect when gateway is ready
        if (msg.includes('listening') || msg.includes('started') || msg.includes('ready')) {
          const startupMs = gatewayStartTime ? Date.now() - gatewayStartTime : 0
          startedAt = Date.now()
          setState('running')
          getTelemetryCollector().emit('gateway.started', { startupMs })
          resolve()
        }
      })

      gatewayProcess.stderr?.on('data', (data: Buffer) => {
        const msg = data.toString().trim()
        console.error(`[gateway:err] ${msg}`)
        logToFile(`[stderr] ${msg}`)
      })

      gatewayProcess.on('error', (err) => {
        console.error('[gateway] Process error:', err.message)
        logToFile(`[error] ${err.message}`)
        lastError = err.message
        setState('error')
        getTelemetryCollector().emit('gateway.error', { error: err.message })
        gatewayProcess = null
        reject(err)
      })

      gatewayProcess.on('exit', (code, signal) => {
        console.log(`[gateway] Process exited (code=${code}, signal=${signal})`)
        logToFile(`[exit] code=${code}, signal=${signal}`)
        gatewayProcess = null

        if (state === 'stopping') {
          setState('stopped')
          return
        }

        // Unexpected exit — attempt restart
        lastError = `Process exited with code ${code}`
        setState('error')
        getTelemetryCollector().emit('gateway.error', { error: lastError })
        restartTimestamps.push(Date.now())
        restartCount++

        // Auto-restart with backoff
        const backoff = Math.min(1000 * Math.pow(2, restartCount - 1), 30_000)
        console.log(`[gateway] Restarting in ${backoff}ms (attempt ${restartCount})...`)
        getTelemetryCollector().emit('gateway.restarted', { restartCount, reason: 'unexpected_exit' })
        setTimeout(() => {
          startGateway().catch((e) => console.error('[gateway] Restart failed:', e))
        }, backoff)
      })

      // If we don't get a ready signal within 10s, resolve anyway
      setTimeout(() => {
        if (state === 'starting') {
          startedAt = Date.now()
          setState('running')
          resolve()
        }
      }, 10_000)
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err)
      logToFile(`[catch] ${lastError}`)
      setState('error')
      reject(err)
    }
  })
}

export async function stopGateway(): Promise<void> {
  if (!gatewayProcess || state === 'stopped' || state === 'stopping') {
    return
  }

  setState('stopping')

  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      // Force kill if graceful shutdown takes too long
      if (gatewayProcess) {
        console.log('[gateway] Force killing process')
        gatewayProcess.kill('SIGKILL')
      }
      gatewayProcess = null
      setState('stopped')
      resolve()
    }, 5000)

    if (gatewayProcess) {
      gatewayProcess.once('exit', () => {
        clearTimeout(timeout)
        gatewayProcess = null
        setState('stopped')
        resolve()
      })

      // Graceful shutdown
      gatewayProcess.kill('SIGTERM')
    } else {
      clearTimeout(timeout)
      setState('stopped')
      resolve()
    }
  })
}

export async function restartGateway(): Promise<void> {
  await stopGateway()
  await startGateway()
}
