import { useEffect } from 'react'
import { useAppStore } from '@/stores/app-store'
import { useOnboardingStore } from '@/stores/onboarding-store'
import { useSettingsStore } from '@/stores/settings-store'
import { useGateway } from '@/hooks/useGateway'
import { useOnlineStatus } from '@/hooks/useOnlineStatus'
import { SetupWizard } from '@/components/onboarding/SetupWizard'
import { AppShell } from '@/components/layout/AppShell'

function App(): React.JSX.Element {
  const page = useAppStore((s) => s.page)
  const setPage = useAppStore((s) => s.setPage)
  const setVersion = useAppStore((s) => s.setVersion)
  const { loadState } = useOnboardingStore()

  // Initialize gateway connection
  useGateway()
  useOnlineStatus()

  // Check onboarding state on mount
  useEffect(() => {
    async function init(): Promise<void> {
      const version = await window.api.app.getVersion()
      setVersion(version)

      // Load persisted settings (locale, etc.) before first render
      await useSettingsStore.getState().loadSettings()

      // Load onboarding state — go to dashboard if complete, else onboarding
      await loadState()
      const state = useOnboardingStore.getState()
      if (state.completed) {
        setPage('dashboard')
      } else {
        setPage('onboarding')
      }
    }
    init()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const handleOnboardingComplete = (): void => {
    setPage('dashboard')
  }

  switch (page) {
    case 'onboarding':
      return <SetupWizard onComplete={handleOnboardingComplete} />
    case 'dashboard':
      return <AppShell />
    default:
      return <SetupWizard onComplete={handleOnboardingComplete} />
  }
}

export default App
