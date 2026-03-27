import { contextBridge, ipcRenderer } from 'electron'

const api = {
  // Gateway
  gateway: {
    start: () => ipcRenderer.invoke('gateway:start'),
    stop: () => ipcRenderer.invoke('gateway:stop'),
    restart: () => ipcRenderer.invoke('gateway:restart'),
    status: () => ipcRenderer.invoke('gateway:status'),
    health: () => ipcRenderer.invoke('gateway:health'),
    getToken: () => ipcRenderer.invoke('gateway:get-token'),
    onStateChanged: (callback: (state: unknown) => void) => {
      const handler = (_event: unknown, state: unknown): void => callback(state)
      ipcRenderer.on('event:gateway-state-changed', handler)
      return () => ipcRenderer.removeListener('event:gateway-state-changed', handler)
    }
  },

  // Onboarding
  onboarding: {
    getState: () => ipcRenderer.invoke('onboarding:get-state'),
    saveState: (state: unknown) => ipcRenderer.invoke('onboarding:save-state', state),
    complete: () => ipcRenderer.invoke('onboarding:complete')
  },

  // LLM Provider
  llm: {
    testConnection: (provider: string, apiKey: string) =>
      ipcRenderer.invoke('llm:test-connection', provider, apiKey),
    saveConfig: (provider: string, model: string, apiKey: string) =>
      ipcRenderer.invoke('llm:save-config', provider, model, apiKey),
    getConfig: () => ipcRenderer.invoke('llm:get-config')
  },

  // App
  app: {
    quit: () => ipcRenderer.invoke('app:quit'),
    minimizeToTray: () => ipcRenderer.invoke('app:minimize-to-tray'),
    showWindow: () => ipcRenderer.invoke('app:show-window'),
    getVersion: () => ipcRenderer.invoke('app:get-version'),
    openExternal: (url: string) => ipcRenderer.invoke('app:open-external', url)
  },

  // Agent state persistence
  agent: {
    getState: () => ipcRenderer.invoke('agent:get-state'),
    setState: (state: unknown) => ipcRenderer.invoke('agent:set-state', state)
  },

  // Settings
  settings: {
    get: (key: string) => ipcRenderer.invoke('settings:get', key),
    set: (key: string, value: unknown) => ipcRenderer.invoke('settings:set', key, value)
  },

  // File system
  fs: {
    selectFolder: () => ipcRenderer.invoke('fs:select-folder')
  },

  // ActiveCollab (non-OAuth — credential-based auth)
  activecollab: {
    connectCloud: (email: string, password: string) =>
      ipcRenderer.invoke('activecollab:connect-cloud', email, password),
    connectSelfHosted: (url: string, email: string, password: string) =>
      ipcRenderer.invoke('activecollab:connect-selfhosted', url, email, password),
    status: () => ipcRenderer.invoke('activecollab:status'),
    disconnect: () => ipcRenderer.invoke('activecollab:disconnect')
  },

  // Composio (local)
  composio: {
    setApiKey: (apiKey: string) => ipcRenderer.invoke('composio:set-api-key', apiKey),
    getApiKey: () => ipcRenderer.invoke('composio:get-api-key'),
    initiateOAuth: (appName: string) => ipcRenderer.invoke('composio:initiate-oauth', appName),
    getStatus: (connectionId: string) => ipcRenderer.invoke('composio:get-status', connectionId),
    getConnected: () => ipcRenderer.invoke('composio:get-connected'),
    listApps: () => ipcRenderer.invoke('composio:list-apps'),
    callTool: (actionName: string, params: Record<string, unknown>) =>
      ipcRenderer.invoke('composio:call-tool', actionName, params)
  },

  // Relay (remaining — moved to local in Phase 3)
  relay: {
    getUsage: () => ipcRenderer.invoke('relay:get-usage'),
    llmCompletion: (
      messages: Array<{ role: string; content: string }>,
      opts?: { model?: string; max_tokens?: number }
    ) => ipcRenderer.invoke('relay:llm-completion', messages, opts),
    extractUrl: (url: string) => ipcRenderer.invoke('relay:extract-url', url)
  },

  // Knowledge Base
  kb: {
    saveCapture: (data: unknown) => ipcRenderer.invoke('kb:save-capture', data),
    readContext: () => ipcRenderer.invoke('kb:read-context'),
    appendDailyLog: (entry: string) => ipcRenderer.invoke('kb:append-daily-log', entry)
  },

  // Memory
  memory: {
    search: (query: string) => ipcRenderer.invoke('memory:search', query),
    save: (data: {
      content: string
      type?: string
      summary?: string
      tags?: string[]
      importance?: number
      source_id?: string
    }) => ipcRenderer.invoke('memory:save', data),
    getStats: () => ipcRenderer.invoke('memory:get-stats'),
    getIdentity: () => ipcRenderer.invoke('memory:get-identity')
  },

  // Scheduler
  scheduler: {
    getTasks: () => ipcRenderer.invoke('scheduler:get-tasks'),
    setEnabled: (taskId: string, enabled: boolean) =>
      ipcRenderer.invoke('scheduler:set-enabled', taskId, enabled),
    runNow: (taskId: string) => ipcRenderer.invoke('scheduler:run-now', taskId)
  },

  // Permissions
  permission: {
    onRequest: (
      callback: (request: {
        requestId: string
        actionName: string
        toolkit: string
        tier: 'low' | 'medium' | 'high'
        description: string
        params: Record<string, unknown>
      }) => void
    ) => {
      const handler = (_event: unknown, request: unknown): void =>
        callback(request as Parameters<typeof callback>[0])
      ipcRenderer.on('event:permission-request', handler)
      return () => ipcRenderer.removeListener('event:permission-request', handler)
    },
    resolve: (requestId: string, approved: boolean, standing: boolean) =>
      ipcRenderer.invoke('permission:resolve', requestId, approved, standing)
  },

  // Telemetry
  telemetry: {
    setOptIn: (optIn: boolean) => ipcRenderer.invoke('telemetry:set-opt-in', optIn),
    getOptIn: () => ipcRenderer.invoke('telemetry:get-opt-in'),
    deleteData: () => ipcRenderer.invoke('telemetry:delete-data'),
    emit: (eventType: string, payload: Record<string, unknown>) =>
      ipcRenderer.invoke('telemetry:emit', eventType, payload),
    getQueue: () => ipcRenderer.invoke('telemetry:get-queue'),
    getStatus: () => ipcRenderer.invoke('telemetry:get-status')
  }
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore
  window.api = api
}
