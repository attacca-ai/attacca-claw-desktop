import { create } from 'zustand'
import type { TrustProfile } from '@/types/trust'

interface TrustStore {
  profile: TrustProfile
  setProfile: (profile: TrustProfile) => void
  loadProfile: () => Promise<void>
}

export const useTrustStore = create<TrustStore>((set, get) => ({
  profile: 'cautious',

  setProfile: (profile) => {
    const prev = get().profile
    set({ profile })

    // Persist
    window.api.settings.set('trustProfile', profile)

    // Emit telemetry
    window.api.telemetry.emit('trust.profile_changed', {
      from_profile: prev,
      to_profile: profile
    })
  },

  loadProfile: async () => {
    try {
      const stored = await window.api.settings.get('trustProfile')
      if (stored && typeof stored === 'string') {
        const valid: TrustProfile[] = ['cautious', 'balanced', 'autonomous']
        if (valid.includes(stored as TrustProfile)) {
          set({ profile: stored as TrustProfile })
        }
      }
    } catch {
      // Use default
    }
  }
}))
