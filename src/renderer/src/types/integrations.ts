export type ToolCategory = 'calendar' | 'email' | 'pm' | 'storage' | 'communication'

export interface ToolConnection {
  id: string
  name: string
  category: ToolCategory
  connected: boolean
  connectedAt?: number
  authType: 'oauth' | 'apikey'
  provider?: string
}

export interface OAuthConfig {
  clientId: string
  authUrl: string
  tokenUrl: string
  scopes: string[]
}
