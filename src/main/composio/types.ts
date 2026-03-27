export interface ComposioOAuthInitResult {
  connectionId: string
  redirectUrl: string
}

export interface ComposioConnectionStatus {
  id: string
  status: 'initiated' | 'active' | 'failed' | 'expired'
  appName: string
}

export interface ComposioApp {
  slug: string
  name: string
  categories: string[]
  description: string
}
