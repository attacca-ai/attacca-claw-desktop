import { useState, useEffect, useRef } from 'react'
import { Switch } from '@/components/ui/switch'
import { Loader2, FolderOpen } from 'lucide-react'
import { LLM_PROVIDERS, type LLMProviderKey } from '@/lib/constants'
import { useSettingsStore } from '@/stores/settings-store'
import { useTrustStore } from '@/stores/trust-store'
import { useUsageStore } from '@/stores/usage-store'
import { TRUST_PROFILES, type TrustProfile } from '@/types/trust'
import { useTranslation } from '@/i18n'
import { BYOKGuide } from './BYOKGuide'
import { TelemetryDataCategories } from './TelemetryDataCategories'
import { TelemetryViewer } from './TelemetryViewer'
import { SystemHealth } from './SystemHealth'

// ── Mono font shorthand ──────────────────────────────────────
const MONO = "'IBM Plex Mono', monospace"

// ── Left nav sections ────────────────────────────────────────
function getSections(t: (key: string) => string) {
  return [
    { id: 'trust', label: t('settings.section.trust'), group: t('settings.group.behavior') },
    { id: 'rhythm', label: t('settings.section.rhythm'), group: t('settings.group.behavior') },
    { id: 'usage', label: t('settings.section.usage'), group: t('settings.group.advanced') },
    { id: 'byok', label: t('settings.section.byok'), group: t('settings.group.advanced') },
    { id: 'composio', label: t('settings.section.composio'), group: t('settings.group.advanced') },
    {
      id: 'telemetry',
      label: t('settings.section.telemetry'),
      group: t('settings.group.advanced')
    },
    { id: 'health', label: t('settings.section.health'), group: t('settings.group.advanced') }
  ]
}

// ── Trust profile extended data ──────────────────────────────
function getTrustExtra(t: (key: string) => string) {
  return {
    cautious: {
      tag: t('settings.trust.tag.cautious'),
      tagCls: 'bg-[rgba(76,175,130,.1)] text-[#4caf82]',
      scenario: t('settings.trust.scenario.cautious'),
      risks: [
        {
          label: t('settings.trust.risk.low_silent'),
          cls: 'bg-[rgba(76,175,130,.1)] text-[#4caf82]'
        },
        {
          label: t('settings.trust.risk.mid_confirm'),
          cls: 'bg-[rgba(212,168,67,.1)] text-[#d4a843]'
        },
        {
          label: t('settings.trust.risk.high_block'),
          cls: 'bg-[rgba(224,92,92,.1)] text-[#e05c5c]'
        }
      ]
    },
    balanced: {
      tag: t('settings.trust.tag.balanced'),
      tagCls: 'bg-[rgba(91,124,246,.12)] text-[#5b7cf6]',
      scenario: t('settings.trust.scenario.balanced'),
      risks: [
        {
          label: t('settings.trust.risk.low_silent'),
          cls: 'bg-[rgba(76,175,130,.1)] text-[#4caf82]'
        },
        {
          label: t('settings.trust.risk.mid_notify'),
          cls: 'bg-[rgba(212,168,67,.1)] text-[#d4a843]'
        },
        {
          label: t('settings.trust.risk.high_block'),
          cls: 'bg-[rgba(224,92,92,.1)] text-[#e05c5c]'
        }
      ]
    },
    autonomous: {
      tag: t('settings.trust.tag.autonomous'),
      tagCls: 'bg-[rgba(240,160,75,.1)] text-[#f0a04b]',
      scenario: t('settings.trust.scenario.autonomous'),
      risks: [
        {
          label: t('settings.trust.risk.low_silent'),
          cls: 'bg-[rgba(76,175,130,.1)] text-[#4caf82]'
        },
        {
          label: t('settings.trust.risk.mid_silent'),
          cls: 'bg-[rgba(212,168,67,.1)] text-[#d4a843]'
        },
        {
          label: t('settings.trust.risk.high_countdown'),
          cls: 'bg-[rgba(224,92,92,.1)] text-[#e05c5c]'
        }
      ]
    }
  } as Record<
    TrustProfile,
    { tag: string; tagCls: string; scenario: string; risks: { label: string; cls: string }[] }
  >
}

// ── Helpers ──────────────────────────────────────────────────
function formatTime(value: string): string {
  if (!value) return '—'
  const [hStr, mStr] = value.split(':')
  const h = parseInt(hStr, 10)
  const m = mStr ?? '00'
  const suffix = h >= 12 ? 'PM' : 'AM'
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12}:${m} ${suffix}`
}

// ── Section header ────────────────────────────────────────────
function SectionHeader({
  eyebrow,
  title,
  desc
}: {
  eyebrow: string
  title: string
  desc: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="mb-5">
      <div
        className="text-[9px] uppercase tracking-[.12em] text-[#4a4d55] mb-1.5"
        style={{ fontFamily: MONO }}
      >
        {eyebrow}
      </div>
      <div className="text-[17px] font-light text-[#e8e9eb] tracking-[-0.01em] mb-1.5">{title}</div>
      <div className="text-[12.5px] text-[#7a7d85] leading-[1.55] max-w-[480px]">{desc}</div>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────
export function SettingsPage(): React.JSX.Element {
  const { t } = useTranslation()
  const sections = getSections(t)
  const trustExtra = getTrustExtra(t)

  // BYOK state
  const [selectedProvider, setSelectedProvider] = useState<LLMProviderKey>('anthropic')
  const [apiKey, setApiKey] = useState('')
  const [apiKeyHint, setApiKeyHint] = useState<string | null>(null)
  const [testing, setTesting] = useState(false)
  const [saving, setSaving] = useState(false)
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(
    null
  )
  // Telemetry viewer
  const [showTelemetryViewer, setShowTelemetryViewer] = useState(false)
  // Composio key state
  const [composioKey, setComposioKey] = useState('')
  const [composioKeyHint, setComposioKeyHint] = useState<string | null>(null)
  const [savingComposio, setSavingComposio] = useState(false)
  const [composioFeedback, setComposioFeedback] = useState<{
    type: 'success' | 'error'
    message: string
  } | null>(null)
  // Rhythm: inline edit state
  const [editingTime, setEditingTime] = useState<'morning' | 'eod' | null>(null)

  // Left nav active section
  const [activeSection, setActiveSection] = useState('trust')
  const scrollRef = useRef<HTMLDivElement>(null)

  // Stores
  const settings = useSettingsStore()
  const { loadSettings } = settings
  const { costUsd, requestCount, fetchUsage } = useUsageStore()
  const trustProfile = useTrustStore((s) => s.profile)
  const setTrustProfile = useTrustStore((s) => s.setProfile)
  const loadTrustProfile = useTrustStore((s) => s.loadProfile)

  // Load on mount
  useEffect(() => {
    loadSettings()
    loadLLMConfig()
    loadComposioConfig()
    loadTrustProfile()
    fetchUsage()
  }, [loadSettings, loadTrustProfile, fetchUsage])

  async function loadComposioConfig(): Promise<void> {
    try {
      const result = await window.api.composio.getApiKey()
      if (result?.hint) setComposioKeyHint(result.hint)
    } catch {
      // No key configured
    }
  }

  async function handleSaveComposioKey(): Promise<void> {
    if (!composioKey.trim()) return
    setSavingComposio(true)
    setComposioFeedback(null)
    try {
      const result = await window.api.composio.setApiKey(composioKey)
      if (result.success) {
        setComposioKeyHint(composioKey.slice(0, 4) + '...' + composioKey.slice(-4))
        setComposioKey('')
        setComposioFeedback({ type: 'success', message: t('settings.composio.success') })
      } else {
        setComposioFeedback({
          type: 'error',
          message: result.error || t('settings.composio.error_save')
        })
      }
    } catch (err) {
      setComposioFeedback({
        type: 'error',
        message: err instanceof Error ? err.message : t('settings.composio.error_save')
      })
    } finally {
      setSavingComposio(false)
    }
  }

  // Scroll-spy via IntersectionObserver
  useEffect(() => {
    const root = scrollRef.current
    if (!root) return
    const observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            setActiveSection(e.target.id.replace('s-', ''))
          }
        }
      },
      { root, rootMargin: '-25% 0px -65% 0px', threshold: 0 }
    )
    sections.forEach(({ id }) => {
      const el = root.querySelector(`#s-${id}`)
      if (el) observer.observe(el)
    })
    return () => observer.disconnect()
  }, [])

  function scrollToSection(id: string): void {
    const el = scrollRef.current?.querySelector(`#s-${id}`)
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    setActiveSection(id)
  }

  async function loadLLMConfig(): Promise<void> {
    try {
      const config = await window.api.llm.getConfig()
      if (config) {
        setSelectedProvider(config.provider as LLMProviderKey)
        setApiKeyHint(config.apiKeyHint)
      }
    } catch {
      // No config yet
    }
  }

  async function handleTestAndSave(): Promise<void> {
    if (!apiKey.trim()) {
      setFeedback({ type: 'error', message: t('settings.byok.error_empty') })
      return
    }
    setTesting(true)
    setFeedback(null)
    try {
      const result = await window.api.llm.testConnection(selectedProvider, apiKey)
      if (!result.success) {
        setFeedback({ type: 'error', message: result.error || t('settings.byok.error_test') })
        setTesting(false)
        return
      }
      setTesting(false)
      setSaving(true)
      const provider = LLM_PROVIDERS[selectedProvider]
      await window.api.llm.saveConfig(selectedProvider, provider.defaultModel, apiKey)
      await window.api.gateway.restart()
      setApiKeyHint('****' + apiKey.slice(-4))
      setApiKey('')
      setFeedback({ type: 'success', message: t('settings.byok.success_saved') })
    } catch (err) {
      setFeedback({
        type: 'error',
        message: err instanceof Error ? err.message : t('settings.byok.error_save')
      })
    } finally {
      setTesting(false)
      setSaving(false)
    }
  }

  function handleToggleBYOK(enabled: boolean): void {
    settings.setSetting('byokEnabled', enabled)
    if (!enabled) settings.setSetting('byokProvider', null)
  }

  async function handleTelemetryToggle(optIn: boolean): Promise<void> {
    settings.setSetting('telemetryOptIn', optIn)
    await window.api.telemetry.setOptIn(optIn)
  }

  async function handleDeleteTelemetryData(): Promise<void> {
    await window.api.telemetry.deleteData()
    setFeedback({ type: 'success', message: t('settings.telemetry.deleted') })
  }

  async function handleSelectFolder(): Promise<void> {
    const path = await window.api.fs.selectFolder()
    if (path) settings.setSetting('folderWatchPath', path)
  }

  // Usage is now informational only (no ceiling)

  return (
    <div
      className="flex h-full overflow-hidden bg-background"
      style={{ color: '#e8e9eb', fontSize: 13 }}
    >
      {/* ── Left nav ── */}
      <div
        className="w-[200px] flex-shrink-0 flex flex-col py-5 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        style={{ borderRight: '1px solid #1f2024' }}
      >
        <div className="px-4 mb-5 text-[16px] font-light text-[#e8e9eb] tracking-[-0.01em]">
          {t('settings.title')}
        </div>

        {/* Group: Behavior */}
        <div className="mb-1 px-4">
          <div
            className="text-[8.5px] uppercase tracking-[.12em] text-[#4a4d55] mb-1"
            style={{ fontFamily: MONO }}
          >
            {t('settings.group.behavior')}
          </div>
        </div>
        {sections
          .filter((s) => s.group === t('settings.group.behavior'))
          .map((s) => (
            <button
              key={s.id}
              onClick={() => scrollToSection(s.id)}
              className="mx-2.5 flex items-center gap-2 px-2 py-[7px] rounded-[6px] text-[12px] cursor-pointer transition-all text-left"
              style={{
                background: activeSection === s.id ? 'rgba(91,124,246,.12)' : 'transparent',
                color: activeSection === s.id ? '#5b7cf6' : '#7a7d85'
              }}
            >
              <div
                className="w-1.5 h-1.5 rounded-full flex-shrink-0 transition-colors"
                style={{ background: activeSection === s.id ? '#5b7cf6' : '#4a4d55' }}
              />
              {s.label}
            </button>
          ))}

        <div className="mx-4 my-2.5 h-px" style={{ background: '#1f2024' }} />

        {/* Group: Advanced */}
        <div className="mb-1 px-4">
          <div
            className="text-[8.5px] uppercase tracking-[.12em] text-[#4a4d55] mb-1"
            style={{ fontFamily: MONO }}
          >
            {t('settings.group.advanced')}
          </div>
        </div>
        {sections
          .filter((s) => s.group === t('settings.group.advanced'))
          .map((s) => (
            <button
              key={s.id}
              onClick={() => scrollToSection(s.id)}
              className="mx-2.5 flex items-center gap-2 px-2 py-[7px] rounded-[6px] text-[12px] cursor-pointer transition-all text-left"
              style={{
                background: activeSection === s.id ? 'rgba(91,124,246,.12)' : 'transparent',
                color: activeSection === s.id ? '#5b7cf6' : '#7a7d85'
              }}
            >
              <div
                className="w-1.5 h-1.5 rounded-full flex-shrink-0 transition-colors"
                style={{ background: activeSection === s.id ? '#5b7cf6' : '#4a4d55' }}
              />
              {s.label}
            </button>
          ))}
      </div>

      {/* ── Main content ── */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        style={{ padding: '32px 40px' }}
      >
        {/* ══ §1 Trust Profile ══ */}
        <section id="s-trust" className="max-w-[620px] mb-12" style={{ scrollMarginTop: 32 }}>
          <SectionHeader
            eyebrow={t('settings.trust.eyebrow')}
            title={t('settings.trust.title')}
            desc={
              <>
                {t('settings.trust.desc')}{' '}
                <span style={{ color: '#f0a04b' }}>{t('settings.trust.desc_accent')}</span>
                {t('settings.trust.desc_tail')}
              </>
            }
          />

          <div className="flex flex-col gap-2">
            {(
              Object.entries(TRUST_PROFILES) as [
                TrustProfile,
                (typeof TRUST_PROFILES)[TrustProfile]
              ][]
            ).map(([key, _config]) => {
              const extra = trustExtra[key]
              const selected = trustProfile === key
              return (
                <div
                  key={key}
                  onClick={() => setTrustProfile(key)}
                  className="relative overflow-hidden rounded-[10px] cursor-pointer transition-all"
                  style={{
                    background: '#151618',
                    border: `1.5px solid ${selected ? '#5b7cf6' : '#1f2024'}`
                  }}
                >
                  {/* Top blue bar when selected */}
                  {selected && (
                    <div
                      className="absolute top-0 left-0 right-0 h-[2px]"
                      style={{ background: '#5b7cf6' }}
                    />
                  )}

                  {/* Card header row */}
                  <div className="flex items-center gap-3 px-4 pt-3.5 pb-3">
                    {/* Radio dot */}
                    <div
                      className="w-4 h-4 rounded-full border-2 flex-shrink-0 flex items-center justify-center transition-all"
                      style={{
                        borderColor: selected ? '#5b7cf6' : '#2a2b2f',
                        background: selected ? '#5b7cf6' : 'transparent'
                      }}
                    >
                      {selected && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
                    </div>
                    <div className="flex-1 text-[13.5px] font-medium text-[#e8e9eb]">
                      {t(`settings.trust.profile.label.${key}`)}
                    </div>
                    <span
                      className="text-[8px] px-[7px] py-[2px] rounded-[3px]"
                      style={{ fontFamily: MONO }}
                    >
                      <span
                        className={`${extra.tagCls} text-[8px] px-[7px] py-[2px] rounded-[3px]`}
                        style={{ fontFamily: MONO }}
                      >
                        {extra.tag}
                      </span>
                    </span>
                  </div>

                  {/* Description */}
                  <div className="text-[12px] text-[#7a7d85] leading-[1.45] px-4 pb-3.5 pl-[44px]">
                    {t(`settings.trust.profile.desc.${key}`)}
                  </div>

                  {/* Scenario */}
                  <div
                    className="mx-4 mb-3.5 ml-[44px] rounded-[6px] p-2.5 flex gap-2.5 items-start"
                    style={{ background: '#1c1d20', border: '1px solid #1f2024' }}
                  >
                    <span
                      className="text-[8px] text-[#4a4d55] flex-shrink-0 mt-0.5 tracking-[.06em] whitespace-nowrap"
                      style={{ fontFamily: MONO }}
                    >
                      {t('settings.trust.example_label')}
                    </span>
                    <div
                      className="text-[11.5px] text-[#7a7d85] leading-[1.45]"
                      dangerouslySetInnerHTML={{ __html: extra.scenario }}
                    />
                  </div>

                  {/* Risk row */}
                  <div className="flex gap-1.5 px-4 pb-3.5 pl-[44px]">
                    {extra.risks.map((r) => (
                      <span
                        key={r.label}
                        className={`${r.cls} text-[8px] px-[7px] py-[2px] rounded-[3px]`}
                        style={{ fontFamily: MONO }}
                      >
                        {r.label}
                      </span>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        </section>

        {/* ══ §2 Tu Rutina ══ */}
        <section id="s-rhythm" className="max-w-[620px] mb-12" style={{ scrollMarginTop: 32 }}>
          <SectionHeader
            eyebrow={t('settings.rhythm.eyebrow')}
            title={t('settings.rhythm.title')}
            desc={t('settings.rhythm.desc')}
          />

          <div className="grid grid-cols-2 gap-2.5">
            {/* Morning briefing */}
            <div
              className="rounded-lg p-3"
              style={{ background: '#151618', border: '1px solid #1f2024' }}
            >
              <div className="text-[11px] text-[#4a4d55] mb-1.5">
                {t('settings.rhythm.morning')}
              </div>
              <div className="flex items-center justify-between">
                {editingTime === 'morning' ? (
                  <input
                    type="time"
                    value={settings.morningBriefingTime}
                    onChange={(e) => settings.setSetting('morningBriefingTime', e.target.value)}
                    onBlur={() => setEditingTime(null)}
                    autoFocus
                    className="text-[14px] text-[#e8e9eb] bg-transparent outline-none border-b border-[#5b7cf6]"
                  />
                ) : (
                  <span className="text-[14px] text-[#e8e9eb]">
                    {formatTime(settings.morningBriefingTime)}
                  </span>
                )}
                <button
                  onClick={() => setEditingTime('morning')}
                  className="text-[9px] text-[#4a4d55] px-2 py-1 rounded border border-transparent hover:border-[#2a2b2f] hover:text-[#7a7d85] transition-all"
                  style={{ fontFamily: MONO }}
                >
                  {t('settings.rhythm.edit')}
                </button>
              </div>
            </div>

            {/* EOD summary */}
            <div
              className="rounded-lg p-3"
              style={{ background: '#151618', border: '1px solid #1f2024' }}
            >
              <div className="text-[11px] text-[#4a4d55] mb-1.5">{t('settings.rhythm.eod')}</div>
              <div className="flex items-center justify-between">
                {editingTime === 'eod' ? (
                  <input
                    type="time"
                    value={settings.eodSummaryTime}
                    onChange={(e) => settings.setSetting('eodSummaryTime', e.target.value)}
                    onBlur={() => setEditingTime(null)}
                    autoFocus
                    className="text-[14px] text-[#e8e9eb] bg-transparent outline-none border-b border-[#5b7cf6]"
                  />
                ) : (
                  <span className="text-[14px] text-[#e8e9eb]">
                    {formatTime(settings.eodSummaryTime)}
                  </span>
                )}
                <button
                  onClick={() => setEditingTime('eod')}
                  className="text-[9px] text-[#4a4d55] px-2 py-1 rounded border border-transparent hover:border-[#2a2b2f] hover:text-[#7a7d85] transition-all"
                  style={{ fontFamily: MONO }}
                >
                  {t('settings.rhythm.edit')}
                </button>
              </div>
            </div>

            {/* Take Over summary interval */}
            <div
              className="rounded-lg p-3"
              style={{ background: '#151618', border: '1px solid #1f2024' }}
            >
              <div className="text-[11px] text-[#4a4d55] mb-1.5">
                {t('settings.rhythm.takeover_interval')}
              </div>
              <div className="flex items-center justify-between">
                <select
                  value={String(settings.takeOverSummaryInterval)}
                  onChange={(e) =>
                    settings.setSetting('takeOverSummaryInterval', Number(e.target.value))
                  }
                  style={{
                    background: 'transparent',
                    border: 'none',
                    fontSize: 14,
                    color: '#e8e9eb',
                    outline: 'none',
                    cursor: 'pointer',
                    width: '100%',
                    appearance: 'none',
                    WebkitAppearance: 'none',
                    fontFamily: 'inherit'
                  }}
                >
                  <option value="1" style={{ background: '#232428' }}>
                    {t('settings.rhythm.every_hour')}
                  </option>
                  <option value="2" style={{ background: '#232428' }}>
                    {t('settings.rhythm.every_2h')}
                  </option>
                  <option value="3" style={{ background: '#232428' }}>
                    {t('settings.rhythm.every_3h')}
                  </option>
                  <option value="4" style={{ background: '#232428' }}>
                    {t('settings.rhythm.every_4h')}
                  </option>
                </select>
              </div>
            </div>

            {/* Take Over auto-disable */}
            <div
              className="rounded-lg p-3"
              style={{ background: '#151618', border: '1px solid #1f2024' }}
            >
              <div className="text-[11px] text-[#4a4d55] mb-1.5">
                {t('settings.rhythm.takeover_disable')}
              </div>
              <div className="flex items-center justify-between">
                <select
                  value={String(settings.takeOverAutoDisable)}
                  onChange={(e) =>
                    settings.setSetting('takeOverAutoDisable', Number(e.target.value))
                  }
                  style={{
                    background: 'transparent',
                    border: 'none',
                    fontSize: 14,
                    color: '#e8e9eb',
                    outline: 'none',
                    cursor: 'pointer',
                    width: '100%',
                    appearance: 'none',
                    WebkitAppearance: 'none',
                    fontFamily: 'inherit'
                  }}
                >
                  {[4, 5, 6, 7, 8, 9, 10, 11, 12].map((h) => (
                    <option key={h} value={String(h)} style={{ background: '#232428' }}>
                      {t('settings.rhythm.hours', { h })}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Folder watch — full width */}
            <div
              className="col-span-2 rounded-lg p-3 flex items-start gap-3"
              style={{ background: '#151618', border: '1px solid #1f2024' }}
            >
              <div className="flex-1">
                <div className="text-[13px] text-[#e8e9eb] mb-1">
                  {t('settings.rhythm.folder_watch')}
                </div>
                <div className="text-[11.5px] text-[#4a4d55] leading-[1.4]">
                  {t('settings.rhythm.folder_watch_desc')}
                </div>
                {settings.folderWatchEnabled && settings.folderWatchPath && (
                  <div
                    className="text-[10px] text-[#5b7cf6] mt-1.5 flex items-center gap-1.5 cursor-pointer hover:underline"
                    onClick={handleSelectFolder}
                  >
                    <FolderOpen className="w-3 h-3" />
                    {settings.folderWatchPath}
                  </div>
                )}
                {settings.folderWatchEnabled && !settings.folderWatchPath && (
                  <button
                    onClick={handleSelectFolder}
                    className="mt-1.5 text-[10px] text-[#5b7cf6] underline cursor-pointer bg-transparent border-0 p-0"
                    style={{ fontFamily: MONO }}
                  >
                    {t('settings.rhythm.select_folder')}
                  </button>
                )}
              </div>
              {/* Custom toggle */}
              <div
                onClick={() =>
                  settings.setSetting('folderWatchEnabled', !settings.folderWatchEnabled)
                }
                className="flex-shrink-0 mt-0.5 cursor-pointer"
              >
                <div
                  className="w-[34px] h-[19px] rounded-[10px] relative transition-colors"
                  style={{ background: settings.folderWatchEnabled ? '#4caf82' : '#232428' }}
                >
                  <div
                    className="absolute w-[15px] h-[15px] rounded-full bg-white top-[2px] transition-all"
                    style={{ [settings.folderWatchEnabled ? 'right' : 'left']: 2 }}
                  />
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ══ Avanzado divider ══ */}
        <div className="flex items-center gap-3 max-w-[620px] mb-12 mt-4">
          <div className="flex-1 h-px" style={{ background: '#1f2024' }} />
          <span
            className="text-[9px] text-[#4a4d55] uppercase tracking-[.1em] whitespace-nowrap"
            style={{ fontFamily: MONO }}
          >
            {t('settings.advanced_divider')}
          </span>
          <div className="flex-1 h-px" style={{ background: '#1f2024' }} />
        </div>

        {/* ══ §3 Uso del agente (Usage) ══ */}
        <section id="s-usage" className="max-w-[620px] mb-12" style={{ scrollMarginTop: 32 }}>
          <SectionHeader
            eyebrow={t('settings.usage.eyebrow')}
            title={t('settings.usage.title')}
            desc={t('settings.usage.desc')}
          />

          <div
            className="rounded-[10px] p-4"
            style={{ background: '#151618', border: '1px solid #1f2024' }}
          >
            <div className="flex items-start justify-between">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <div
                    className="w-2 h-2 rounded-full"
                    style={{ background: '#4caf82', boxShadow: '0 0 5px #4caf82' }}
                  />
                  <span className="text-[13px] text-[#e8e9eb]">{t('settings.usage.normal')}</span>
                </div>
                <div className="text-[9px] text-[#4a4d55]" style={{ fontFamily: MONO }}>
                  {t('settings.usage.requests', { count: requestCount })}
                </div>
              </div>
              <div className="text-right">
                <div className="text-[20px] font-light text-[#e8e9eb]" style={{ fontFamily: MONO }}>
                  ${costUsd.toFixed(2)}
                </div>
                <div className="text-[10px] text-[#4a4d55]" style={{ fontFamily: MONO }}>
                  {t('settings.usage.cost')}
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ══ §4 BYOK ══ */}
        <section id="s-byok" className="max-w-[620px] mb-12" style={{ scrollMarginTop: 32 }}>
          <SectionHeader
            eyebrow={t('settings.byok.eyebrow')}
            title={t('settings.byok.title')}
            desc={t('settings.byok.desc')}
          />

          <div
            className="rounded-[10px] p-4"
            style={{ background: '#151618', border: '1px solid #1f2024' }}
          >
            {/* Toggle row */}
            <div className="flex items-start gap-3">
              <div className="flex-1">
                <div className="text-[13px] text-[#e8e9eb] mb-1">
                  {t('settings.byok.toggle_label')}
                </div>
                <div className="text-[11.5px] text-[#4a4d55] leading-[1.4]">
                  {settings.byokEnabled
                    ? t('settings.byok.enabled_desc')
                    : t('settings.byok.disabled_desc')}
                </div>
              </div>
              <div
                onClick={() => handleToggleBYOK(!settings.byokEnabled)}
                className="flex-shrink-0 mt-0.5 cursor-pointer"
              >
                <div
                  className="w-[34px] h-[19px] rounded-[10px] relative transition-colors"
                  style={{ background: settings.byokEnabled ? '#5b7cf6' : '#232428' }}
                >
                  <div
                    className="absolute w-[15px] h-[15px] rounded-full bg-white top-[2px] transition-all"
                    style={{ [settings.byokEnabled ? 'right' : 'left']: 2 }}
                  />
                </div>
              </div>
            </div>

            {/* Expanded when enabled */}
            {settings.byokEnabled && (
              <div className="mt-4 pt-4" style={{ borderTop: '1px solid #1f2024' }}>
                <div className="text-[11px] text-[#4a4d55] mb-2">
                  {t('settings.byok.provider_q')}
                </div>

                {/* Provider chips */}
                <div className="flex gap-1.5 mb-3">
                  {(
                    Object.entries(LLM_PROVIDERS) as [
                      LLMProviderKey,
                      (typeof LLM_PROVIDERS)[LLMProviderKey]
                    ][]
                  ).map(([key, provider]) => (
                    <button
                      key={key}
                      onClick={() => {
                        setSelectedProvider(key)
                        setFeedback(null)
                      }}
                      className="px-3 py-1.5 rounded-full text-[12px] border transition-all cursor-pointer"
                      style={{
                        background:
                          selectedProvider === key ? 'rgba(91,124,246,.12)' : 'transparent',
                        borderColor: selectedProvider === key ? '#5b7cf6' : '#2a2b2f',
                        color: selectedProvider === key ? '#5b7cf6' : '#7a7d85',
                        fontFamily: 'inherit'
                      }}
                    >
                      {provider.name}
                    </button>
                  ))}
                </div>

                <BYOKGuide provider={selectedProvider} />

                {apiKeyHint && (
                  <p className="text-[11px] text-[#4a4d55] mb-2" style={{ fontFamily: MONO }}>
                    {t('settings.byok.current_key', { hint: apiKeyHint })}
                  </p>
                )}

                {/* API key input row */}
                <div className="flex gap-2 mt-2">
                  <input
                    type="password"
                    placeholder={
                      apiKeyHint
                        ? t('settings.byok.placeholder_new')
                        : t('settings.byok.placeholder')
                    }
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    className="flex-1 rounded-[6px] px-3 py-2 text-[11px] text-[#e8e9eb] outline-none transition-colors"
                    style={{
                      background: '#1c1d20',
                      border: '1px solid #2a2b2f',
                      fontFamily: MONO
                    }}
                    onFocus={(e) => (e.currentTarget.style.borderColor = '#5b7cf6')}
                    onBlur={(e) => (e.currentTarget.style.borderColor = '#2a2b2f')}
                  />
                  <button
                    onClick={handleTestAndSave}
                    disabled={testing || saving || !apiKey.trim()}
                    className="px-3.5 py-2 rounded-[6px] text-[12px] border transition-all cursor-pointer whitespace-nowrap disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5"
                    style={{
                      background: 'transparent',
                      border: '1px solid #2a2b2f',
                      color: '#7a7d85',
                      fontFamily: 'inherit'
                    }}
                    onMouseEnter={(e) => {
                      if (!testing && !saving && apiKey.trim()) {
                        e.currentTarget.style.borderColor = '#5b7cf6'
                        e.currentTarget.style.color = '#5b7cf6'
                      }
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.borderColor = '#2a2b2f'
                      e.currentTarget.style.color = '#7a7d85'
                    }}
                  >
                    {(testing || saving) && <Loader2 className="w-3 h-3 animate-spin" />}
                    {testing
                      ? t('settings.byok.testing')
                      : saving
                        ? t('settings.byok.saving')
                        : t('settings.byok.test_btn')}
                  </button>
                </div>

                {feedback && (
                  <p
                    className="mt-2 text-[11px]"
                    style={{ color: feedback.type === 'success' ? '#4caf82' : '#e05c5c' }}
                  >
                    {feedback.message}
                  </p>
                )}
              </div>
            )}
          </div>
        </section>

        {/* ══ §5 Composio ══ */}
        <section id="s-composio" className="max-w-[620px] mb-12" style={{ scrollMarginTop: 32 }}>
          <SectionHeader
            eyebrow={t('settings.composio.eyebrow')}
            title={t('settings.composio.title')}
            desc={
              <>
                {t('settings.composio.desc')}{' '}
                <button
                  onClick={() => window.api.app.openExternal('https://composio.dev')}
                  className="text-[#5b7cf6] hover:underline cursor-pointer"
                  style={{ background: 'none', border: 'none', padding: 0, font: 'inherit' }}
                >
                  {t('settings.composio.get_key')}
                </button>
              </>
            }
          />

          <div
            className="rounded-[10px] p-4"
            style={{ background: '#151618', border: '1px solid #1f2024' }}
          >
            {composioKeyHint && (
              <p className="text-[11px] text-[#4a4d55] mb-2" style={{ fontFamily: MONO }}>
                {t('settings.composio.current_key', { hint: composioKeyHint })}
              </p>
            )}

            <div className="flex gap-2">
              <input
                type="password"
                placeholder={
                  composioKeyHint
                    ? t('settings.composio.placeholder_new')
                    : t('settings.composio.placeholder')
                }
                value={composioKey}
                onChange={(e) => setComposioKey(e.target.value)}
                className="flex-1 rounded-[6px] px-3 py-2 text-[11px] text-[#e8e9eb] outline-none transition-colors"
                style={{
                  background: '#1c1d20',
                  border: '1px solid #2a2b2f',
                  fontFamily: MONO
                }}
                onFocus={(e) => (e.currentTarget.style.borderColor = '#5b7cf6')}
                onBlur={(e) => (e.currentTarget.style.borderColor = '#2a2b2f')}
              />
              <button
                onClick={handleSaveComposioKey}
                disabled={savingComposio || !composioKey.trim()}
                className="px-3.5 py-2 rounded-[6px] text-[12px] border transition-all cursor-pointer whitespace-nowrap disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5"
                style={{
                  background: 'transparent',
                  border: '1px solid #2a2b2f',
                  color: '#7a7d85',
                  fontFamily: 'inherit'
                }}
                onMouseEnter={(e) => {
                  if (!savingComposio && composioKey.trim()) {
                    e.currentTarget.style.borderColor = '#5b7cf6'
                    e.currentTarget.style.color = '#5b7cf6'
                  }
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = '#2a2b2f'
                  e.currentTarget.style.color = '#7a7d85'
                }}
              >
                {savingComposio && <Loader2 className="w-3 h-3 animate-spin" />}
                {savingComposio ? t('settings.composio.saving') : t('settings.composio.save_btn')}
              </button>
            </div>

            {composioFeedback && (
              <p
                className="mt-2 text-[11px]"
                style={{ color: composioFeedback.type === 'success' ? '#4caf82' : '#e05c5c' }}
              >
                {composioFeedback.message}
              </p>
            )}

            {!composioKeyHint && (
              <p className="mt-3 text-[11px] text-[#4a4d55] leading-[1.4]">
                {t('settings.composio.no_key_hint')}
              </p>
            )}
          </div>
        </section>

        {/* ══ §6 Telemetry ══ */}
        <section id="s-telemetry" className="max-w-[620px] mb-12" style={{ scrollMarginTop: 32 }}>
          <SectionHeader
            eyebrow={t('settings.telemetry.eyebrow')}
            title={t('settings.telemetry.title')}
            desc={t('settings.telemetry.desc')}
          />

          <div
            className="rounded-[10px] overflow-hidden"
            style={{ background: '#151618', border: '1px solid #1f2024' }}
          >
            <div className="flex items-start gap-3 p-4">
              <div className="flex-1">
                <div className="text-[13px] text-[#e8e9eb] mb-1">
                  {t('settings.telemetry.toggle_label')}
                </div>
                <div className="text-[11.5px] text-[#4a4d55] leading-[1.4]">
                  {t('settings.telemetry.toggle_desc')}
                </div>
              </div>
              <Switch checked={settings.telemetryOptIn} onCheckedChange={handleTelemetryToggle} />
            </div>
            <div
              className="flex items-center gap-2 px-4 py-2.5"
              style={{ borderTop: '1px solid #1f2024' }}
            >
              <TelemetryDataCategories />
              <button
                onClick={() => setShowTelemetryViewer(true)}
                className="px-3 py-1 rounded-[6px] text-[11.5px] border transition-colors cursor-pointer"
                style={{
                  background: 'transparent',
                  border: '1px solid #2a2b2f',
                  color: '#7a7d85',
                  fontFamily: 'inherit'
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = '#5b7cf6'
                  e.currentTarget.style.color = '#5b7cf6'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = '#2a2b2f'
                  e.currentTarget.style.color = '#7a7d85'
                }}
              >
                {t('settings.telemetry.view_data')}
              </button>
              <button
                onClick={handleDeleteTelemetryData}
                className="px-3 py-1 rounded-[6px] text-[11.5px] border transition-colors cursor-pointer"
                style={{
                  background: 'transparent',
                  border: '1px solid #2a2b2f',
                  color: '#7a7d85',
                  fontFamily: 'inherit'
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = '#e05c5c'
                  e.currentTarget.style.color = '#e05c5c'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = '#2a2b2f'
                  e.currentTarget.style.color = '#7a7d85'
                }}
              >
                {t('settings.telemetry.delete_data')}
              </button>
            </div>
          </div>
        </section>

        {/* ══ §7 System Health ══ */}
        <section id="s-health" className="max-w-[620px] mb-12" style={{ scrollMarginTop: 32 }}>
          <SectionHeader
            eyebrow={t('settings.health.eyebrow')}
            title={t('settings.health.title')}
            desc={t('settings.health.desc')}
          />
          <SystemHealth />
        </section>

        {showTelemetryViewer && <TelemetryViewer onClose={() => setShowTelemetryViewer(false)} />}
      </div>
    </div>
  )
}
