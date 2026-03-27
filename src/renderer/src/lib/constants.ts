export const GATEWAY_WS_URL = 'ws://127.0.0.1:18789'
export const GATEWAY_PORT = 18789

export const APP_NAME = 'Attacca'
export const APP_DESCRIPTION = 'AI Productivity Assistant'

export const MONO_FONT = "'IBM Plex Mono', monospace"

export const LLM_PROVIDERS = {
  anthropic: {
    name: 'Anthropic Claude',
    models: ['claude-sonnet-4-6'],
    defaultModel: 'claude-sonnet-4-6',
    apiKeyUrl: 'https://console.anthropic.com/settings/keys'
  },
  openai: {
    name: 'OpenAI',
    models: ['gpt-4o'],
    defaultModel: 'gpt-4o',
    apiKeyUrl: 'https://platform.openai.com/api-keys'
  },
  google: {
    name: 'Google Gemini',
    models: ['gemini-2.0-flash'],
    defaultModel: 'gemini-2.0-flash',
    apiKeyUrl: 'https://aistudio.google.com/apikey'
  }
} as const

export type LLMProviderKey = keyof typeof LLM_PROVIDERS

export const TOOL_CATEGORIES = {
  calendar: { name: 'Calendar', tools: ['google-calendar', 'outlook-calendar'] },
  email: { name: 'Email', tools: ['gmail', 'outlook-email'] },
  pm: {
    name: 'Project Management',
    tools: ['clickup', 'asana', 'trello', 'notion', 'activecollab']
  },
  storage: { name: 'File Storage', tools: ['google-drive', 'onedrive', 'dropbox'] },
  communication: { name: 'Communication', tools: ['slack', 'teams', 'telegram'] }
} as const

/**
 * Maps Composio toolkit slugs → frontend tool IDs.
 * Composio returns slugs like "googlecalendar" but our UI uses "google-calendar".
 * Some Composio slugs map to multiple frontend tools (e.g. "outlook" → email + calendar).
 */
const COMPOSIO_SLUG_TO_FRONTEND: Record<string, string[]> = {
  googlecalendar: ['google-calendar'],
  googledrive: ['google-drive'],
  one_drive: ['onedrive'],
  outlook: ['outlook-email', 'outlook-calendar'],
  outlookcalendar: ['outlook-calendar'],
  microsoftoutlook: ['outlook-email']
}

/** Normalizes an array of Composio toolkit slugs to frontend tool IDs. */
export function normalizeComposioSlugs(slugs: string[]): string[] {
  const result: string[] = []
  for (const slug of slugs) {
    const mapped = COMPOSIO_SLUG_TO_FRONTEND[slug]
    if (mapped) {
      result.push(...mapped)
    } else {
      result.push(slug)
    }
  }
  return [...new Set(result)]
}
