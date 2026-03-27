export type RiskTier = 'low' | 'medium' | 'high'

export interface PermissionGrant {
  toolId: string
  actionType: string
  tier: RiskTier
  grantedAt: number
  standing: boolean
  expiresAt: number | null
}

export interface ApprovalRequest {
  id: string
  actionType: string
  toolId: string
  tier: RiskTier
  description: string
  params?: Record<string, unknown>
  requestedAt: number
}
