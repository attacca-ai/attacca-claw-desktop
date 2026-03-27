import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { useSettingsStore } from '../settings-store'
import { installMockApi, cleanupMockApi } from '../../../../../tests/helpers'

describe('settings-store', () => {
  beforeEach(() => {
    installMockApi()
    useSettingsStore.setState({
      morningBriefingTime: '07:00',
      eodSummaryTime: '18:00',
      telegramConnected: false,
      folderWatchEnabled: false,
      folderWatchPath: null,
      takeOverSummaryInterval: 2,
      takeOverAutoDisable: 8,
      byokEnabled: false,
      byokProvider: null,
      telemetryOptIn: false
    })
  })

  afterEach(() => {
    cleanupMockApi()
  })

  it('has correct default values', () => {
    const state = useSettingsStore.getState()
    expect(state.morningBriefingTime).toBe('07:00')
    expect(state.eodSummaryTime).toBe('18:00')
    expect(state.telegramConnected).toBe(false)
    expect(state.folderWatchEnabled).toBe(false)
    expect(state.folderWatchPath).toBeNull()
    expect(state.takeOverSummaryInterval).toBe(2)
    expect(state.takeOverAutoDisable).toBe(8)
  })

  describe('setSetting', () => {
    it('sets morningBriefingTime', () => {
      useSettingsStore.getState().setSetting('morningBriefingTime', '08:30')
      expect(useSettingsStore.getState().morningBriefingTime).toBe('08:30')
    })

    it('sets eodSummaryTime', () => {
      useSettingsStore.getState().setSetting('eodSummaryTime', '17:00')
      expect(useSettingsStore.getState().eodSummaryTime).toBe('17:00')
    })

    it('sets telegramConnected', () => {
      useSettingsStore.getState().setSetting('telegramConnected', true)
      expect(useSettingsStore.getState().telegramConnected).toBe(true)
    })

    it('sets folderWatchEnabled and path', () => {
      useSettingsStore.getState().setSetting('folderWatchEnabled', true)
      useSettingsStore.getState().setSetting('folderWatchPath', '/home/user/docs')
      expect(useSettingsStore.getState().folderWatchEnabled).toBe(true)
      expect(useSettingsStore.getState().folderWatchPath).toBe('/home/user/docs')
    })

    it('persists after setting', () => {
      useSettingsStore.getState().setSetting('morningBriefingTime', '09:00')
      expect(window.api.settings.set).toHaveBeenCalledWith(
        'attacca',
        expect.objectContaining({ morningBriefingTime: '09:00' })
      )
    })

    it('sets numeric settings', () => {
      useSettingsStore.getState().setSetting('takeOverSummaryInterval', 5)
      useSettingsStore.getState().setSetting('takeOverAutoDisable', 12)
      expect(useSettingsStore.getState().takeOverSummaryInterval).toBe(5)
      expect(useSettingsStore.getState().takeOverAutoDisable).toBe(12)
    })
  })

  describe('loadSettings', () => {
    it('loads settings from IPC', async () => {
      window.api.settings.get = vi.fn().mockResolvedValue({
        morningBriefingTime: '06:00',
        eodSummaryTime: '19:00',
        telegramConnected: true,
        folderWatchEnabled: true,
        folderWatchPath: '/some/path',
        takeOverSummaryInterval: 3,
        takeOverAutoDisable: 10
      })

      await useSettingsStore.getState().loadSettings()
      const state = useSettingsStore.getState()

      expect(state.morningBriefingTime).toBe('06:00')
      expect(state.eodSummaryTime).toBe('19:00')
      expect(state.telegramConnected).toBe(true)
      expect(state.folderWatchPath).toBe('/some/path')
    })

    it('keeps defaults when IPC returns null', async () => {
      window.api.settings.get = vi.fn().mockResolvedValue(null)
      await useSettingsStore.getState().loadSettings()
      expect(useSettingsStore.getState().morningBriefingTime).toBe('07:00')
    })

    it('keeps defaults on IPC error', async () => {
      window.api.settings.get = vi.fn().mockRejectedValue(new Error('IPC fail'))
      await useSettingsStore.getState().loadSettings()
      expect(useSettingsStore.getState().morningBriefingTime).toBe('07:00')
    })

    it('keeps defaults when IPC returns non-object', async () => {
      window.api.settings.get = vi.fn().mockResolvedValue('string')
      await useSettingsStore.getState().loadSettings()
      expect(useSettingsStore.getState().morningBriefingTime).toBe('07:00')
    })
  })

  describe('persist', () => {
    it('saves all settings via IPC', async () => {
      await useSettingsStore.getState().persist()
      expect(window.api.settings.set).toHaveBeenCalledWith('attacca', {
        locale: 'en',
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
        telemetryOptIn: false
      })
    })
  })
})
