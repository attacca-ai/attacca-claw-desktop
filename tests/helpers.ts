import { vi } from 'vitest'

// ─── Mock window.api ────────────────────────────────────────────────────────

export function installMockApi(): void {
  const api = {
    gateway: {
      start: vi.fn().mockResolvedValue({ success: true }),
      stop: vi.fn().mockResolvedValue({ success: true }),
      restart: vi.fn().mockResolvedValue({ success: true }),
      status: vi.fn().mockResolvedValue({
        state: 'stopped',
        pid: null,
        restartCount: 0,
        lastError: null,
        startedAt: null
      }),
      health: vi.fn().mockResolvedValue({
        ok: true,
        latency: 10,
        error: null,
        checkedAt: Date.now()
      }),
      getToken: vi.fn().mockResolvedValue({ token: null }),
      onStateChanged: vi.fn().mockReturnValue(vi.fn())
    },
    onboarding: {
      getState: vi.fn().mockResolvedValue(null),
      saveState: vi.fn().mockResolvedValue(undefined),
      complete: vi.fn().mockResolvedValue(undefined)
    },
    llm: {
      testConnection: vi.fn().mockResolvedValue({ success: true }),
      saveConfig: vi.fn().mockResolvedValue({ success: true })
    },
    app: {
      quit: vi.fn().mockResolvedValue(undefined),
      minimizeToTray: vi.fn().mockResolvedValue(undefined),
      showWindow: vi.fn().mockResolvedValue(undefined),
      getVersion: vi.fn().mockResolvedValue('1.0.0'),
      openExternal: vi.fn().mockResolvedValue(undefined)
    },
    settings: {
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn().mockResolvedValue(undefined)
    },
    fs: {
      selectFolder: vi.fn().mockResolvedValue(null)
    },
    activecollab: {
      connectCloud: vi.fn().mockResolvedValue({ success: true }),
      connectSelfHosted: vi.fn().mockResolvedValue({ success: true }),
      status: vi.fn().mockResolvedValue({ connected: false, config: null }),
      disconnect: vi.fn().mockResolvedValue({ success: true })
    },
    composio: {
      setApiKey: vi.fn().mockResolvedValue({ success: true }),
      getApiKey: vi.fn().mockResolvedValue({ hint: null }),
      initiateOAuth: vi.fn().mockResolvedValue({
        success: true,
        connectionId: 'conn_1',
        redirectUrl: 'https://example.com'
      }),
      getStatus: vi
        .fn()
        .mockResolvedValue({ connectionId: 'conn_1', status: 'active', appName: 'test' }),
      getConnected: vi.fn().mockResolvedValue([]),
      listApps: vi.fn().mockResolvedValue([]),
      callTool: vi.fn().mockResolvedValue({ success: true, result: { data: { items: [] } } })
    },
    scheduler: {
      getTasks: vi.fn().mockResolvedValue([]),
      setEnabled: vi.fn().mockResolvedValue({ success: true }),
      runNow: vi.fn().mockResolvedValue({ success: true })
    },
    relay: {
      getUsage: vi.fn().mockResolvedValue({
        totalCostUsd: 0,
        limitUsd: 30,
        requestCount: 0,
        limitReached: false,
        resetDate: '2026-03-01'
      }),
      llmCompletion: vi.fn().mockResolvedValue({ success: true, content: '' }),
      extractUrl: vi
        .fn()
        .mockResolvedValue({ success: true, type: 'article', title: '', text: '', wordCount: 0 })
    },
    agent: {
      getState: vi.fn().mockResolvedValue(null),
      setState: vi.fn().mockResolvedValue(undefined)
    },
    permission: {
      onRequest: vi.fn().mockReturnValue(vi.fn()),
      resolve: vi.fn().mockResolvedValue({ success: true })
    },
    telemetry: {
      setOptIn: vi.fn().mockResolvedValue({ success: true }),
      getOptIn: vi.fn().mockResolvedValue({ optIn: false }),
      deleteData: vi.fn().mockResolvedValue({ success: true }),
      emit: vi.fn().mockResolvedValue({ success: true })
    }
  }

  Object.defineProperty(window, 'api', {
    value: api,
    writable: true,
    configurable: true
  })
}

export function cleanupMockApi(): void {
  // @ts-expect-error Cleaning up test mock
  delete window.api
}

// ─── MockWebSocket ──────────────────────────────────────────────────────────

export class MockWebSocket {
  static instances: MockWebSocket[] = []
  static CONNECTING = 0
  static OPEN = 1
  static CLOSING = 2
  static CLOSED = 3

  url: string
  readyState: number = 0 // CONNECTING
  onopen: ((ev: Event) => void) | null = null
  onclose: ((ev: CloseEvent) => void) | null = null
  onmessage: ((ev: MessageEvent) => void) | null = null
  onerror: ((ev: Event) => void) | null = null

  sent: string[] = []

  constructor(url: string) {
    this.url = url
    MockWebSocket.instances.push(this)
  }

  send(data: string): void {
    this.sent.push(data)
  }

  close(): void {
    this.readyState = 3 // CLOSED
    if (this.onclose) {
      this.onclose(new CloseEvent('close'))
    }
  }

  simulateOpen(): void {
    this.readyState = 1 // OPEN
    if (this.onopen) {
      this.onopen(new Event('open'))
    }
  }

  simulateClose(): void {
    this.readyState = 3 // CLOSED
    if (this.onclose) {
      this.onclose(new CloseEvent('close'))
    }
  }

  simulateMessage(data: string): void {
    if (this.onmessage) {
      this.onmessage(new MessageEvent('message', { data }))
    }
  }

  simulateError(): void {
    if (this.onerror) {
      this.onerror(new Event('error'))
    }
  }

  static reset(): void {
    MockWebSocket.instances = []
  }
}

// ─── Notification API mock ──────────────────────────────────────────────────

export function createMockNotification(): typeof Notification {
  const MockNotif = vi.fn() as unknown as typeof Notification
  Object.defineProperty(MockNotif, 'permission', {
    value: 'granted',
    writable: true,
    configurable: true
  })
  MockNotif.requestPermission = vi.fn().mockResolvedValue('granted')
  return MockNotif
}
