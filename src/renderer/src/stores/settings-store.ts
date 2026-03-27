import { create } from 'zustand'

type Locale = 'en' | 'es'

function detectLocale(): Locale {
  try {
    const lang = navigator.language?.slice(0, 2)?.toLowerCase()
    if (lang === 'es') return 'es'
  } catch {
    // SSR or unavailable
  }
  return 'en'
}

interface SettingsStore {
  locale: Locale
  morningBriefingTime: string
  eodSummaryTime: string
  userTimezone: string
  telegramConnected: boolean
  folderWatchEnabled: boolean
  folderWatchPath: string | null
  takeOverSummaryInterval: number
  takeOverAutoDisable: number
  byokEnabled: boolean
  byokProvider: string | null
  telemetryOptIn: boolean

  setSetting: <K extends keyof SettingsStore>(key: K, value: SettingsStore[K]) => void
  loadSettings: () => Promise<void>
  persist: () => Promise<void>
}

export const useSettingsStore = create<SettingsStore>((set, get) => ({
  locale: detectLocale(),
  morningBriefingTime: '07:00',
  eodSummaryTime: '18:00',
  userTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  telegramConnected: false,
  folderWatchEnabled: false,
  folderWatchPath: null,
  takeOverSummaryInterval: 2,
  takeOverAutoDisable: 8,
  byokEnabled: false,
  byokProvider: null,
  telemetryOptIn: false,

  setSetting: (key, value) => {
    set({ [key]: value } as Partial<SettingsStore>)
    get().persist()
  },

  loadSettings: async () => {
    try {
      const settings = await window.api.settings.get('attacca')
      if (settings && typeof settings === 'object') {
        set(settings as Partial<SettingsStore>)
      }
    } catch {
      // Use defaults
    }

    // Sync telemetry opt-in from main process
    try {
      const telemetry = await window.api.telemetry.getOptIn()
      if (telemetry) {
        set({ telemetryOptIn: telemetry.optIn })
      }
    } catch {
      // ignore
    }
  },

  persist: async () => {
    const {
      locale,
      morningBriefingTime,
      eodSummaryTime,
      userTimezone,
      telegramConnected,
      folderWatchEnabled,
      folderWatchPath,
      takeOverSummaryInterval,
      takeOverAutoDisable,
      byokEnabled,
      byokProvider,
      telemetryOptIn
    } = get()

    await window.api.settings.set('attacca', {
      locale,
      morningBriefingTime,
      eodSummaryTime,
      userTimezone,
      telegramConnected,
      folderWatchEnabled,
      folderWatchPath,
      takeOverSummaryInterval,
      takeOverAutoDisable,
      byokEnabled,
      byokProvider,
      telemetryOptIn
    })
  }
}))
