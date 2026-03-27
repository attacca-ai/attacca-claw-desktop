import { describe, it, expect, beforeEach } from 'vitest'
import { useAppStore } from '../app-store'

describe('app-store', () => {
  beforeEach(() => {
    useAppStore.setState({
      page: 'onboarding',
      version: null,
      isOnline: true
    })
  })

  it('has correct initial state', () => {
    const state = useAppStore.getState()
    expect(state.page).toBe('onboarding')
    expect(state.version).toBeNull()
    expect(state.isOnline).toBe(true)
  })

  it('setPage transitions to dashboard', () => {
    useAppStore.getState().setPage('dashboard')
    expect(useAppStore.getState().page).toBe('dashboard')
  })

  it('setPage transitions from dashboard back to onboarding', () => {
    useAppStore.getState().setPage('dashboard')
    useAppStore.getState().setPage('onboarding')
    expect(useAppStore.getState().page).toBe('onboarding')
  })

  it('setVersion sets version string', () => {
    useAppStore.getState().setVersion('1.2.3')
    expect(useAppStore.getState().version).toBe('1.2.3')
  })

  it('setVersion can update version', () => {
    useAppStore.getState().setVersion('1.0.0')
    useAppStore.getState().setVersion('2.0.0')
    expect(useAppStore.getState().version).toBe('2.0.0')
  })

  it('setOnline sets to false', () => {
    useAppStore.getState().setOnline(false)
    expect(useAppStore.getState().isOnline).toBe(false)
  })

  it('setOnline sets back to true', () => {
    useAppStore.getState().setOnline(false)
    useAppStore.getState().setOnline(true)
    expect(useAppStore.getState().isOnline).toBe(true)
  })
})
