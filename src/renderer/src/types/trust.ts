export type TrustProfile = 'cautious' | 'balanced' | 'autonomous'

export interface TrustProfileConfig {
  label: string
  description: string
}

export const TRUST_PROFILES: Record<TrustProfile, TrustProfileConfig> = {
  cautious: {
    label: 'Cautious',
    description:
      'All medium-risk actions require confirmation. High-risk actions require blocking approval.'
  },
  balanced: {
    label: 'Balanced',
    description:
      'Medium-risk actions show a notification with undo. High-risk actions require blocking approval.'
  },
  autonomous: {
    label: 'Autonomous',
    description:
      'Medium-risk actions are silently logged. High-risk actions proceed after a 2-minute delay with undo.'
  }
}
