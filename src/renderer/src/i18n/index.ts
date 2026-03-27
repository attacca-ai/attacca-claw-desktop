import { useCallback } from 'react'
import { useSettingsStore } from '@/stores/settings-store'
import en from './en.json'
import es from './es.json'

export type Locale = 'en' | 'es'
type Translations = Record<string, string>

const TRANSLATIONS: Record<Locale, Translations> = { en, es }

/** Standalone translate — reads locale from Zustand store (non-reactive). */
export function t(key: string, params?: Record<string, string | number>): string {
  const locale = useSettingsStore.getState().locale
  const translations = TRANSLATIONS[locale] ?? TRANSLATIONS.en
  let value = translations[key] ?? TRANSLATIONS.en[key] ?? key

  if (params) {
    for (const [k, v] of Object.entries(params)) {
      value = value.replace(`{${k}}`, String(v))
    }
  }

  return value
}

export function getLocale(): Locale {
  return useSettingsStore.getState().locale
}

export function setLocale(locale: Locale): void {
  useSettingsStore.getState().setSetting('locale', locale)
}

/** React hook — reactive to locale changes via Zustand subscription. */
export function useTranslation(): {
  t: (key: string, params?: Record<string, string | number>) => string
  locale: Locale
  setLocale: (l: Locale) => void
} {
  const locale = useSettingsStore((s) => s.locale)
  const setSetting = useSettingsStore((s) => s.setSetting)

  const translate = useCallback(
    (key: string, params?: Record<string, string | number>): string => {
      const translations = TRANSLATIONS[locale] ?? TRANSLATIONS.en
      let value = translations[key] ?? TRANSLATIONS.en[key] ?? key

      if (params) {
        for (const [k, v] of Object.entries(params)) {
          value = value.replace(`{${k}}`, String(v))
        }
      }

      return value
    },
    [locale]
  )

  const changeLocale = useCallback(
    (l: Locale) => {
      setSetting('locale', l)
    },
    [setSetting]
  )

  return { t: translate, locale, setLocale: changeLocale }
}
