export const IPC = {
  // Gateway
  GATEWAY_START: 'gateway:start',
  GATEWAY_STOP: 'gateway:stop',
  GATEWAY_RESTART: 'gateway:restart',
  GATEWAY_STATUS: 'gateway:status',
  GATEWAY_HEALTH: 'gateway:health',
  GATEWAY_GET_TOKEN: 'gateway:get-token',

  // Onboarding
  ONBOARDING_GET_STATE: 'onboarding:get-state',
  ONBOARDING_SAVE_STATE: 'onboarding:save-state',
  ONBOARDING_COMPLETE: 'onboarding:complete',

  // LLM Provider
  LLM_TEST_CONNECTION: 'llm:test-connection',
  LLM_SAVE_CONFIG: 'llm:save-config',
  LLM_GET_CONFIG: 'llm:get-config',

  // App
  APP_QUIT: 'app:quit',
  APP_MINIMIZE_TO_TRAY: 'app:minimize-to-tray',
  APP_SHOW_WINDOW: 'app:show-window',
  APP_GET_VERSION: 'app:get-version',
  APP_OPEN_EXTERNAL: 'app:open-external',

  // Settings
  SETTINGS_GET: 'settings:get',
  SETTINGS_SET: 'settings:set',

  // File system
  FS_READ_FILE: 'fs:read-file',
  FS_WRITE_FILE: 'fs:write-file',
  FS_SELECT_FOLDER: 'fs:select-folder',

  // Composio (local)
  COMPOSIO_SET_API_KEY: 'composio:set-api-key',
  COMPOSIO_GET_API_KEY: 'composio:get-api-key',
  COMPOSIO_INITIATE_OAUTH: 'composio:initiate-oauth',
  COMPOSIO_GET_STATUS: 'composio:get-status',
  COMPOSIO_GET_CONNECTED: 'composio:get-connected',
  COMPOSIO_LIST_APPS: 'composio:list-apps',
  COMPOSIO_CALL_TOOL: 'composio:call-tool',

  // Relay (remaining — moved to local in Phase 3)
  RELAY_GET_USAGE: 'relay:get-usage',
  RELAY_LLM_COMPLETION: 'relay:llm-completion',
  RELAY_EXTRACT_URL: 'relay:extract-url',

  // Agent state persistence
  AGENT_GET_STATE: 'agent:get-state',
  AGENT_SET_STATE: 'agent:set-state',

  // Telemetry
  TELEMETRY_SET_OPT_IN: 'telemetry:set-opt-in',
  TELEMETRY_GET_OPT_IN: 'telemetry:get-opt-in',
  TELEMETRY_DELETE_DATA: 'telemetry:delete-data',
  TELEMETRY_EMIT: 'telemetry:emit',
  TELEMETRY_GET_QUEUE: 'telemetry:get-queue',
  TELEMETRY_GET_STATUS: 'telemetry:get-status',

  // Knowledge Base
  KB_SAVE_CAPTURE: 'kb:save-capture',
  KB_READ_CONTEXT: 'kb:read-context',
  KB_APPEND_DAILY_LOG: 'kb:append-daily-log',

  // Memory
  MEMORY_SEARCH: 'memory:search',
  MEMORY_SAVE: 'memory:save',
  MEMORY_GET_STATS: 'memory:get-stats',
  MEMORY_GET_IDENTITY: 'memory:get-identity',

  // Scheduler
  SCHEDULER_GET_TASKS: 'scheduler:get-tasks',
  SCHEDULER_SET_ENABLED: 'scheduler:set-enabled',
  SCHEDULER_RUN_NOW: 'scheduler:run-now',

  // Permissions
  PERMISSION_RESOLVE: 'permission:resolve',

  // Events (main → renderer)
  EVENT_GATEWAY_STATE_CHANGED: 'event:gateway-state-changed',
  EVENT_PERMISSION_REQUEST: 'event:permission-request'
} as const

export type IPCChannel = (typeof IPC)[keyof typeof IPC]
