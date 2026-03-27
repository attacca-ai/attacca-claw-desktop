import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import App from '../../App'
import { useAppStore } from '../../stores/app-store'
import { useOnboardingStore } from '../../stores/onboarding-store'
import { installMockApi, cleanupMockApi } from '../../../../../tests/helpers'

// Mock hooks
vi.mock('@/hooks/useGateway', () => ({
  useGateway: vi.fn()
}))
vi.mock('@/hooks/useOnlineStatus', () => ({
  useOnlineStatus: vi.fn().mockReturnValue(true)
}))

// Mock child page components to isolate App tests
vi.mock('@/components/onboarding/SetupWizard', () => ({
  SetupWizard: ({ onComplete }: { onComplete: () => void }) => (
    <div data-testid="onboarding-wizard">
      <button onClick={onComplete}>Complete</button>
    </div>
  )
}))
vi.mock('@/components/layout/AppShell', () => ({
  AppShell: () => <div data-testid="app-shell">AppShell</div>
}))

describe('App', () => {
  beforeEach(() => {
    installMockApi()
    useAppStore.setState({
      page: 'onboarding',
      version: null,
      isOnline: true
    })
    useOnboardingStore.setState({
      currentStep: 0,
      connectedTools: [],
      selectedUseCases: [],
      telemetryOptIn: false,
      completed: false
    })
  })

  afterEach(() => {
    cleanupMockApi()
  })

  it('shows SetupWizard when page is onboarding', () => {
    useAppStore.setState({ page: 'onboarding' })
    render(<App />)

    expect(screen.getByTestId('onboarding-wizard')).toBeInTheDocument()
  })

  it('shows AppShell when page is dashboard', () => {
    useAppStore.setState({ page: 'dashboard' })
    render(<App />)

    expect(screen.getByTestId('app-shell')).toBeInTheDocument()
  })

  it('fetches and sets app version on mount', async () => {
    window.api.app.getVersion = vi.fn().mockResolvedValue('2.0.0')
    window.api.onboarding.getState = vi.fn().mockResolvedValue({
      currentStep: 0,
      completed: false,
      connectedTools: [],
      selectedUseCases: [],
      telemetryOptIn: false
    })

    render(<App />)

    await waitFor(() => {
      expect(window.api.app.getVersion).toHaveBeenCalled()
      expect(useAppStore.getState().version).toBe('2.0.0')
    })
  })

  it('navigates to dashboard when onboarding is complete', async () => {
    window.api.onboarding.getState = vi.fn().mockResolvedValue({
      currentStep: 4,
      completed: true,
      connectedTools: [],
      selectedUseCases: [],
      telemetryOptIn: false
    })

    render(<App />)

    await waitFor(() => {
      expect(useAppStore.getState().page).toBe('dashboard')
    })
  })

  it('stays on onboarding when not complete', async () => {
    window.api.onboarding.getState = vi.fn().mockResolvedValue({
      currentStep: 1,
      completed: false,
      connectedTools: [],
      selectedUseCases: [],
      telemetryOptIn: false
    })

    render(<App />)

    await waitFor(() => {
      expect(useAppStore.getState().page).toBe('onboarding')
    })
  })
})
