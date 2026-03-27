import { useState, useEffect, useRef, useCallback } from 'react'
import { useAgentStore } from '@/stores/agent-store'
import { useGatewayStore } from '@/stores/gateway-store'
import { useSettingsStore } from '@/stores/settings-store'
import { normalizeComposioSlugs } from '@/lib/constants'
import { gatewayClient } from '@/lib/gateway-client'
import { extractMessageText } from '@/lib/utils'
import { useTranslation } from '@/i18n'
import type { OcEvent } from '@/types/gateway'

// ── Types ────────────────────────────────────────────────────────────────────

type Phase = 'briefing' | 'active' | 'return'

interface ScopeAction {
  label: string
  desc: string
  risk: 'mid' | 'hold'
}

interface ToolkitScope {
  icon: string
  label: string
  actions: ScopeAction[]
}

interface ScopeToggle {
  toolId: string
  actionLabel: string
  enabled: boolean
}

interface ActivityItem {
  id: string
  status: 'active' | 'done' | 'held'
  title: string
  sub: string
  tool: string
  time: string
  risk?: 'mid' | 'high'
}

interface HeldCard {
  id: string
  title: string
  desc: string
  detail: string
  tool: string
  risk: 'mid' | 'high'
  primaryAction: string
  acknowledged: boolean
}

interface DoneCard {
  id: string
  title: string
  desc: string
  tool: string
  seen: boolean
}

interface TimelineItem {
  status: 'done' | 'held'
  text: string
  time: string
}

interface TakeOverResponse {
  done?: Array<{ title: string; detail: string; tool: string }>
  held?: Array<{
    title: string
    detail: string
    tool: string
    risk?: string
    suggestedAction?: string
  }>
  summary?: string
}

interface WrapUpResponse {
  summary?: string
  recommendations?: string[]
}

// ── Constants ─────────────────────────────────────────────────────────────────

function getToolkitScope(t: (key: string) => string): Record<string, ToolkitScope> {
  return {
    'google-calendar': {
      icon: '📅',
      label: t('takeover.scope.gcal.label'),
      actions: [
        {
          label: t('takeover.scope.gcal.accept_label'),
          desc: t('takeover.scope.gcal.accept_desc'),
          risk: 'mid'
        },
        {
          label: t('takeover.scope.gcal.reject_label'),
          desc: t('takeover.scope.gcal.reject_desc'),
          risk: 'mid'
        }
      ]
    },
    gmail: {
      icon: '✉',
      label: t('takeover.scope.gmail.label'),
      actions: [
        {
          label: t('takeover.scope.gmail.archive_label'),
          desc: t('takeover.scope.gmail.archive_desc'),
          risk: 'mid'
        },
        {
          label: t('takeover.scope.gmail.reply_label'),
          desc: t('takeover.scope.gmail.reply_desc'),
          risk: 'hold'
        }
      ]
    },
    slack: {
      icon: '💬',
      label: t('takeover.scope.slack.label'),
      actions: [
        {
          label: t('takeover.scope.slack.read_label'),
          desc: t('takeover.scope.slack.read_desc'),
          risk: 'mid'
        },
        {
          label: t('takeover.scope.slack.post_label'),
          desc: t('takeover.scope.slack.post_desc'),
          risk: 'hold'
        }
      ]
    },
    clickup: {
      icon: '✓',
      label: t('takeover.scope.clickup.label'),
      actions: [
        {
          label: t('takeover.scope.clickup.tasks_label'),
          desc: t('takeover.scope.clickup.tasks_desc'),
          risk: 'mid'
        }
      ]
    },
    asana: {
      icon: '✓',
      label: t('takeover.scope.asana.label'),
      actions: [
        {
          label: t('takeover.scope.asana.tasks_label'),
          desc: t('takeover.scope.asana.tasks_desc'),
          risk: 'mid'
        }
      ]
    },
    trello: {
      icon: '📋',
      label: t('takeover.scope.trello.label'),
      actions: [
        {
          label: t('takeover.scope.trello.cards_label'),
          desc: t('takeover.scope.trello.cards_desc'),
          risk: 'mid'
        }
      ]
    },
    notion: {
      icon: '📄',
      label: t('takeover.scope.notion.label'),
      actions: [
        {
          label: t('takeover.scope.notion.pages_label'),
          desc: t('takeover.scope.notion.pages_desc'),
          risk: 'mid'
        }
      ]
    },
    'google-drive': {
      icon: '📁',
      label: t('takeover.scope.gdrive.label'),
      actions: [
        {
          label: t('takeover.scope.gdrive.files_label'),
          desc: t('takeover.scope.gdrive.files_desc'),
          risk: 'mid'
        }
      ]
    }
  }
}

function getDurationChips(t: (key: string) => string): string[] {
  return [
    t('takeover.duration.1h'),
    t('takeover.duration.2h'),
    t('takeover.duration.half_day'),
    t('takeover.duration.all_day'),
    t('takeover.duration.until_return')
  ]
}

const ACTION_PREFIX_TO_LABEL: Record<string, string> = {
  GMAIL: 'Gmail',
  GOOGLECALENDAR: 'Google Calendar',
  OUTLOOK: 'Outlook',
  SLACK: 'Slack',
  CLICKUP: 'ClickUp',
  ASANA: 'Asana',
  TRELLO: 'Trello',
  NOTION: 'Notion',
  GOOGLEDRIVE: 'Google Drive',
  GOOGLE_DRIVE: 'Google Drive'
}

// ── Style tokens ──────────────────────────────────────────────────────────────

const RISK_BADGE: Record<string, string> = {
  mid: 'bg-[rgba(212,168,67,.1)] text-[#d4a843]',
  hold: 'bg-[#232428] text-[#4a4d55]'
}

const ACT_DOT: Record<string, string> = {
  done: 'bg-[#4caf82]',
  active: 'bg-[#5b7cf6] animate-pulse',
  held: 'bg-[#d4a843]'
}

const TAG_TOOL = 'bg-[#232428] text-[#4a4d55]'
const TAG_DONE = 'bg-[rgba(76,175,130,.1)] text-[#4caf82]'
const TAG_HOLD = 'bg-[rgba(212,168,67,.1)] text-[#d4a843]'
const TAG_HIGH = 'bg-[rgba(224,92,92,.1)] text-[#e05c5c]'

// ── Helpers ───────────────────────────────────────────────────────────────────

function toolLabelFromActionName(name: string): string {
  const cleaned = name.replace(/^composio\./, '')
  for (const [prefix, label] of Object.entries(ACTION_PREFIX_TO_LABEL)) {
    if (cleaned.startsWith(prefix)) return label
  }
  return cleaned.split('_').slice(0, 2).join(' ')
}

function nowTimeStr(): string {
  return new Date().toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })
}

function buildTakeOverPrompt(
  enabled: ScopeToggle[],
  disabled: ScopeToggle[],
  durationText: string,
  exceptionsText: string,
  toolkitScope: Record<string, ToolkitScope>
): string {
  const allowedByTool: Record<string, string[]> = {}
  for (const t of enabled) {
    if (!allowedByTool[t.toolId]) allowedByTool[t.toolId] = []
    allowedByTool[t.toolId].push(t.actionLabel)
  }
  const allowedLines = Object.entries(allowedByTool)
    .map(([toolId, actions]) => `- ${toolkitScope[toolId]?.label ?? toolId}: ${actions.join(', ')}`)
    .join('\n')

  const heldLines = disabled
    .map(
      (t) =>
        `- ${toolkitScope[t.toolId]?.label ?? t.toolId}: ${t.actionLabel} → LOG ONLY, do NOT execute`
    )
    .join('\n')

  return `You are in TAKE OVER autonomous mode. The user is away for ${durationText}. Work autonomously.

ALLOWED ACTIONS (execute these):
${allowedLines || '(none)'}

HELD ACTIONS (log but do NOT execute — save for user review):
${heldLines || '(none)'}
${exceptionsText ? `\nUSER EXCEPTIONS:\n${exceptionsText}\n` : ''}
INSTRUCTIONS:
1. Fetch data from ALL connected tools listed above
2. Process what you find: triage inbox, check calendar, read messages
3. Execute allowed actions autonomously
4. For held actions or anything risky, log it with details but do NOT execute
5. Report results as JSON

Return ONLY valid JSON:
{"done":[{"title":"What was done","detail":"Brief explanation","tool":"ToolName"}],"held":[{"title":"What needs attention","detail":"Why held","tool":"ToolName","risk":"mid|high"}],"summary":"2-3 sentences summary"}`
}

function buildPollPrompt(): string {
  return `TAKE OVER mode — periodic check. Fetch latest data from all connected tools and report any NEW items since last check.

Return ONLY valid JSON with same schema:
{"done":[{"title":"...","detail":"...","tool":"..."}],"held":[{"title":"...","detail":"...","tool":"...","risk":"mid|high"}],"summary":"What changed"}`
}

function buildWrapUpPrompt(): string {
  return `TAKE OVER mode ending — the user is back. Provide a brief summary of everything you did and what's pending.

Return ONLY valid JSON:
{"summary":"3-5 sentence summary of everything done and pending"}`
}

// ── Component ─────────────────────────────────────────────────────────────────

export function TakeOverMode(): React.JSX.Element {
  const addActivity = useAgentStore((s) => s.addActivity)
  const connectionState = useGatewayStore((s) => s.connectionState)
  const takeOverSummaryInterval = useSettingsStore((s) => s.takeOverSummaryInterval)
  const { t } = useTranslation()

  const toolkitScope = getToolkitScope(t)
  const durationChips = getDurationChips(t)

  // Phase state machine
  const [phase, setPhase] = useState<Phase>('briefing')

  // Connected tools
  const [connectedTools, setConnectedTools] = useState<string[]>([])

  // Briefing config — durationIdx: 0=1h, 1=2h, 2=half day, 3=all day, 4=until return
  const [durationIdx, setDurationIdx] = useState(1)
  const [customHours, setCustomHours] = useState('2')
  const [scopeToggles, setScopeToggles] = useState<ScopeToggle[]>([])
  const [exceptions, setExceptions] = useState('')

  // Active phase
  const [startedAt, setStartedAt] = useState<number | null>(null)
  const [endAt, setEndAt] = useState<number | null>(null)
  const [activityItems, setActivityItems] = useState<ActivityItem[]>([])
  const [elapsed, setElapsed] = useState(t('takeover.active.elapsed_min', { m: 0 }))
  const [progress, setProgress] = useState(0)

  // Return phase
  const [heldCards, setHeldCards] = useState<HeldCard[]>([])
  const [doneCards, setDoneCards] = useState<DoneCard[]>([])
  const [timeline, setTimeline] = useState<TimelineItem[]>([])
  const [agentSummary, setAgentSummary] = useState('')

  // Agent integration refs
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const wrapUpSessionRef = useRef<string | null>(null)
  const stoppedRef = useRef(false)
  const wrapUpTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const activityItemsRef = useRef<ActivityItem[]>([])

  // Keep activityItemsRef in sync
  useEffect(() => {
    activityItemsRef.current = activityItems
  }, [activityItems])

  // Load connected tools on mount
  useEffect(() => {
    window.api.composio
      .getConnected()
      .then((tools) => {
        const normalized = normalizeComposioSlugs(tools)
        setConnectedTools(normalized)
        const toggles: ScopeToggle[] = []
        for (const toolId of normalized) {
          const scope = toolkitScope[toolId]
          if (!scope) continue
          for (const action of scope.actions) {
            toggles.push({ toolId, actionLabel: action.label, enabled: action.risk === 'mid' })
          }
        }
        setScopeToggles(toggles)
      })
      .catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Elapsed timer during active phase
  useEffect(() => {
    if (phase !== 'active' || !startedAt) return
    const tick = (): void => {
      const ms = Date.now() - startedAt
      const mins = Math.floor(ms / 60_000)
      const hrs = Math.floor(mins / 60)
      setElapsed(
        hrs > 0
          ? t('takeover.active.elapsed', { h: hrs, m: mins % 60 })
          : t('takeover.active.elapsed_min', { m: mins })
      )
      if (endAt) setProgress(Math.min(100, Math.round((ms / (endAt - startedAt)) * 100)))
    }
    tick()
    const id = setInterval(tick, 30_000)
    return () => clearInterval(id)
  }, [phase, startedAt, endAt, t])

  // ── Agent event listener ──────────────────────────────────────────────────

  const transitionToReturn = useCallback((): void => {
    const items = activityItemsRef.current
    const held = items.filter((i) => i.status === 'held')
    const done = items.filter((i) => i.status === 'done')

    setHeldCards(
      held.map((i) => ({
        id: i.id,
        title: i.title,
        desc: i.sub,
        detail: '',
        tool: i.tool,
        risk: i.risk ?? 'mid',
        primaryAction: 'Ver detalle',
        acknowledged: false
      }))
    )
    setDoneCards(
      done.map((i) => ({ id: i.id, title: i.title, desc: i.sub, tool: i.tool, seen: false }))
    )
    setTimeline(
      [...done, ...held].map((i) => ({
        status: i.status === 'done' ? ('done' as const) : ('held' as const),
        text: i.title,
        time: i.time
      }))
    )
    setPhase('return')
  }, [])

  useEffect(() => {
    if (phase !== 'active') return

    const handler = (ev: OcEvent): void => {
      if (stoppedRef.current) return
      const payload = (ev.payload ?? {}) as Record<string, unknown>

      // ── Tool call events → real-time activity feed ──
      if (ev.event === 'agent') {
        const stream = payload.stream as string
        const data = (payload.data ?? {}) as Record<string, unknown>
        const eventPhase = data.phase as string | undefined
        const toolName = (data.name as string) || ''

        if (stream === 'tool' && eventPhase === 'start') {
          const label = toolLabelFromActionName(toolName)
          setActivityItems((prev) => [
            ...prev,
            {
              id: crypto.randomUUID(),
              status: 'active',
              title: toolName.replace(/^composio\./, ''),
              sub: t('takeover.active.using', { tool: label }),
              tool: label,
              time: nowTimeStr(),
              risk: 'mid'
            }
          ])
        } else if (stream === 'tool' && eventPhase === 'end') {
          const label = toolLabelFromActionName(toolName)
          setActivityItems((prev) => {
            const idx = [...prev]
              .reverse()
              .findIndex((i) => i.status === 'active' && i.tool === label)
            if (idx === -1) return prev
            const actualIdx = prev.length - 1 - idx
            const updated = [...prev]
            updated[actualIdx] = { ...updated[actualIdx], status: 'done' }
            return updated
          })
        }
      }

      // ── Chat final events → structured JSON results ──
      if (ev.event === 'chat') {
        const state = payload.state as string
        if (state !== 'final') return
        const sessionKey = payload.sessionKey as string | undefined
        if (!sessionKey) return

        const rawText = extractMessageText(
          payload.message as Parameters<typeof extractMessageText>[0]
        )
        const jsonMatch = rawText.match(/\{[\s\S]*\}/)
        if (!jsonMatch) return

        // Wrap-up response
        if (sessionKey === wrapUpSessionRef.current) {
          wrapUpSessionRef.current = null
          if (wrapUpTimeoutRef.current) {
            clearTimeout(wrapUpTimeoutRef.current)
            wrapUpTimeoutRef.current = null
          }
          try {
            const parsed = JSON.parse(jsonMatch[0]) as WrapUpResponse
            if (parsed.summary) setAgentSummary(parsed.summary)
          } catch {
            /* ignore */
          }
          transitionToReturn()
          return
        }

        // Regular takeover response (initial or poll)
        if (!sessionKey.startsWith('agent:main:takeover-')) return
        try {
          const parsed = JSON.parse(jsonMatch[0]) as TakeOverResponse
          const now = nowTimeStr()

          if (parsed.done) {
            for (const item of parsed.done) {
              setActivityItems((prev) => [
                ...prev,
                {
                  id: crypto.randomUUID(),
                  status: 'done',
                  title: item.title,
                  sub: item.detail,
                  tool: item.tool,
                  time: now
                }
              ])
            }
          }
          if (parsed.held) {
            for (const item of parsed.held) {
              setActivityItems((prev) => [
                ...prev,
                {
                  id: crypto.randomUUID(),
                  status: 'held',
                  title: item.title,
                  sub: item.detail,
                  tool: item.tool,
                  time: now,
                  risk: (item.risk as 'mid' | 'high') ?? 'mid'
                }
              ])
            }
          }
          if (parsed.summary) setAgentSummary(parsed.summary)
        } catch {
          /* ignore parse errors */
        }
      }
    }

    gatewayClient.on('*', handler)
    return () => gatewayClient.off('*', handler)
  }, [phase, transitionToReturn, t])

  // ── Auto-stop when duration expires ───────────────────────────────────────

  const handleReturn = useCallback(async (): Promise<void> => {
    if (stoppedRef.current) return
    stoppedRef.current = true

    // Stop polling
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current)
      pollIntervalRef.current = null
    }

    const durationMs = startedAt ? Date.now() - startedAt : 0
    window.api.telemetry.emit('trust.takeover.deactivated', { durationMs, trigger: 'manual' })
    addActivity({ type: 'info', description: t('takeover.ended') })

    // Send wrap-up prompt for summary
    if (connectionState === 'connected') {
      const wrapUpKey = `agent:main:takeover-summary-${crypto.randomUUID()}`
      wrapUpSessionRef.current = wrapUpKey

      // Timeout — if no response in 30s, transition anyway
      wrapUpTimeoutRef.current = setTimeout(() => {
        wrapUpSessionRef.current = null
        wrapUpTimeoutRef.current = null
        transitionToReturn()
      }, 30_000)

      try {
        await gatewayClient.rpc('chat.send', {
          sessionKey: wrapUpKey,
          message: buildWrapUpPrompt(),
          idempotencyKey: wrapUpKey
        })
      } catch {
        if (wrapUpTimeoutRef.current) {
          clearTimeout(wrapUpTimeoutRef.current)
          wrapUpTimeoutRef.current = null
        }
        wrapUpSessionRef.current = null
        transitionToReturn()
      }
    } else {
      transitionToReturn()
    }
  }, [startedAt, connectionState, addActivity, transitionToReturn, t])

  useEffect(() => {
    if (phase !== 'active' || !endAt) return
    const check = (): void => {
      if (Date.now() >= endAt && !stoppedRef.current) {
        void handleReturn()
      }
    }
    const id = setInterval(check, 30_000)
    check()
    return () => clearInterval(id)
  }, [phase, endAt, handleReturn])

  // ── Handlers ────────────────────────────────────────────────────────────────

  function toggleScope(toolId: string, actionLabel: string): void {
    setScopeToggles((prev) =>
      prev.map((tog) =>
        tog.toolId === toolId && tog.actionLabel === actionLabel
          ? { ...tog, enabled: !tog.enabled }
          : tog
      )
    )
  }

  // ── Derived (before callbacks that use them) ───────────────────────────────
  const enabledToggles = scopeToggles.filter((tog) => tog.enabled)
  const disabledToggles = scopeToggles.filter((tog) => !tog.enabled)

  const handleActivate = useCallback(async (): Promise<void> => {
    if (connectionState !== 'connected') return

    const now = Date.now()
    const hours =
      durationIdx === 4
        ? Infinity
        : durationIdx === 3
          ? 8
          : durationIdx === 2
            ? 4
            : durationIdx === 1
              ? 2
              : durationIdx === 0
                ? 1
                : Number(customHours) || 2

    const durationText = hours === Infinity ? 'until they return' : `${hours} hours`

    setStartedAt(now)
    setEndAt(hours === Infinity ? null : now + hours * 3_600_000)
    setActivityItems([])
    stoppedRef.current = false
    setAgentSummary('')

    addActivity({ type: 'info', description: t('takeover.activated') })
    window.api.telemetry.emit('trust.takeover.activated', {})
    setPhase('active')

    // Send initial prompt to agent
    const sessionKey = `agent:main:takeover-${crypto.randomUUID()}`
    const prompt = buildTakeOverPrompt(
      enabledToggles,
      disabledToggles,
      durationText,
      exceptions,
      toolkitScope
    )

    try {
      await gatewayClient.rpc('chat.send', {
        sessionKey,
        message: prompt,
        idempotencyKey: sessionKey
      })
    } catch {
      setActivityItems((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          status: 'held',
          title: t('takeover.active.error_start'),
          sub: t('takeover.active.error_start_desc'),
          tool: 'Sistema',
          time: nowTimeStr(),
          risk: 'high'
        }
      ])
    }

    // Set up periodic polling
    const pollMs = (takeOverSummaryInterval || 2) * 3_600_000
    pollIntervalRef.current = setInterval(() => {
      if (stoppedRef.current) return
      const pollKey = `agent:main:takeover-${crypto.randomUUID()}`
      gatewayClient
        .rpc('chat.send', {
          sessionKey: pollKey,
          message: buildPollPrompt(),
          idempotencyKey: pollKey
        })
        .catch(() => {})
    }, pollMs)
  }, [
    connectionState,
    durationIdx,
    customHours,
    enabledToggles,
    disabledToggles,
    exceptions,
    takeOverSummaryInterval,
    addActivity,
    toolkitScope,
    t
  ])

  function acknowledgeHeld(id: string): void {
    setHeldCards((prev) =>
      prev.map((c) => (c.id === id ? { ...c, acknowledged: !c.acknowledged } : c))
    )
  }

  function markAllSeen(): void {
    setDoneCards((prev) => prev.map((c) => ({ ...c, seen: true })))
  }

  function handleReset(): void {
    stoppedRef.current = false
    wrapUpSessionRef.current = null
    setAgentSummary('')
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current)
      pollIntervalRef.current = null
    }
    if (wrapUpTimeoutRef.current) {
      clearTimeout(wrapUpTimeoutRef.current)
      wrapUpTimeoutRef.current = null
    }
    setPhase('briefing')
    setStartedAt(null)
    setEndAt(null)
    setActivityItems([])
    setHeldCards([])
    setDoneCards([])
    setTimeline([])
    setElapsed(t('takeover.active.elapsed_min', { m: 0 }))
    setProgress(0)
  }

  // ── Derived ──────────────────────────────────────────────────────────────────

  const activeItems = activityItems.filter((i) => i.status === 'active')
  const doneItems = activityItems.filter((i) => i.status === 'done')
  const heldItems = activityItems.filter((i) => i.status === 'held')

  const startedAtStr = startedAt
    ? new Date(startedAt).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })
    : ''
  const endAtStr = endAt
    ? new Date(endAt).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })
    : null

  const durationStr = startedAt
    ? (() => {
        const ms = (endAt ?? Date.now()) - startedAt
        const mins = Math.floor(ms / 60_000)
        const hrs = Math.floor(mins / 60)
        return hrs > 0 ? `${hrs}h ${mins % 60}min` : `${mins} min`
      })()
    : ''

  // ── Render phases ─────────────────────────────────────────────────────────────

  // ─ PHASE 1: BRIEFING ──────────────────────────────────────────────────────────

  function renderBriefing(): React.JSX.Element {
    // Build aside preview items from scope toggles
    const asideHandled = enabledToggles.slice(0, 4).map((tog) => ({
      icon: toolkitScope[tog.toolId]?.icon ?? '·',
      label: tog.actionLabel,
      meta: toolkitScope[tog.toolId]?.label ?? tog.toolId
    }))
    const asideHeld = disabledToggles.slice(0, 3).map((tog) => ({
      icon: toolkitScope[tog.toolId]?.icon ?? '·',
      label: tog.actionLabel,
      meta: t('takeover.briefing.aside_hold_meta')
    }))

    return (
      <div className="flex flex-1 overflow-hidden">
        {/* Main */}
        <div className="flex flex-1 flex-col overflow-hidden border-r border-[#1f2024]">
          {/* Header */}
          <div className="flex-shrink-0 border-b border-[#1f2024] px-9 pb-6 pt-7">
            <div className="mb-1.5 font-mono text-[9px] uppercase tracking-[.12em] text-[#4a4d55]">
              {t('takeover.briefing.eyebrow')}
            </div>
            <div className="mb-1 text-[22px] font-light leading-tight tracking-[-0.01em] text-[#e8e9eb]">
              {t('takeover.briefing.title')}
            </div>
            <div className="max-w-[500px] text-[13px] leading-[1.55] text-[#7a7d85]">
              {t('takeover.briefing.desc')}{' '}
              <span className="text-[#f0a04b]">{t('takeover.briefing.desc_accent')}</span>{' '}
              {t('takeover.briefing.desc_tail')}
            </div>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto px-9 py-6 [scrollbar-width:thin]">
            {/* Duration */}
            <div className="mb-7">
              <div className="mb-2.5 flex items-center gap-2 font-mono text-[9px] uppercase tracking-[.12em] text-[#4a4d55] after:h-px after:flex-1 after:bg-[#1f2024] after:content-['']">
                {t('takeover.briefing.duration_q')}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {durationChips.map((chip, i) => (
                  <button
                    key={chip}
                    onClick={() => setDurationIdx(i)}
                    className={`rounded-full border px-3.5 py-1.5 text-[12px] transition-all ${
                      durationIdx === i
                        ? 'border-[#f0a04b] bg-[rgba(240,160,75,.1)] text-[#f0a04b]'
                        : 'border-[#2a2b2f] text-[#7a7d85] hover:border-[#4a4d55] hover:text-[#e8e9eb]'
                    }`}
                  >
                    {chip}
                  </button>
                ))}
              </div>
              <div className="mt-2 flex items-center gap-2">
                <input
                  type="text"
                  value={customHours}
                  onChange={(e) => setCustomHours(e.target.value)}
                  className="w-14 rounded border border-[#2a2b2f] bg-[#151618] px-2.5 py-1.5 text-center text-[12px] text-[#e8e9eb] outline-none transition-colors focus:border-[#5b7cf6]"
                  placeholder="N"
                />
                <span className="text-[12px] text-[#7a7d85]">{t('takeover.hours_exact')}</span>
              </div>
            </div>

            {/* Scope */}
            <div className="mb-7">
              <div className="mb-2.5 flex items-center gap-2 font-mono text-[9px] uppercase tracking-[.12em] text-[#4a4d55] after:h-px after:flex-1 after:bg-[#1f2024] after:content-['']">
                {t('takeover.briefing.scope_q')}
              </div>

              {connectedTools.length === 0 ? (
                <div className="rounded-lg border border-dashed border-[#2a2b2f] px-4 py-6 text-center text-[12px] text-[#4a4d55]">
                  {t('takeover.briefing.no_tools')}{' '}
                  <span className="text-[#7a7d85]">{t('takeover.briefing.no_tools_hint')}</span>
                </div>
              ) : (
                <div className="overflow-hidden rounded-[10px] border border-[#1f2024] bg-[#151618]">
                  {connectedTools.flatMap((toolId) => {
                    const scope = toolkitScope[toolId]
                    if (!scope) return []
                    return scope.actions.map((action) => {
                      const toggle = scopeToggles.find(
                        (tog) => tog.toolId === toolId && tog.actionLabel === action.label
                      )
                      const enabled = toggle?.enabled ?? false
                      return (
                        <div
                          key={`${toolId}:${action.label}`}
                          className="flex cursor-pointer items-center gap-3.5 border-b border-[#1f2024] px-4 py-3 transition-colors last:border-b-0 hover:bg-[#1c1d20]"
                          onClick={() => toggleScope(toolId, action.label)}
                        >
                          {/* Icon */}
                          <div
                            className={`flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md text-[12px] ${
                              toolId === 'google-calendar'
                                ? 'bg-[rgba(91,124,246,.12)] text-[#5b7cf6]'
                                : toolId === 'gmail'
                                  ? 'bg-[rgba(155,114,245,.12)] text-[#9b72f5]'
                                  : toolId === 'slack'
                                    ? 'bg-[rgba(74,21,75,.3)] text-[#b39ddb]'
                                    : 'bg-[rgba(76,175,130,.1)] text-[#4caf82]'
                            }`}
                          >
                            {scope.icon}
                          </div>
                          {/* Info */}
                          <div className="flex-1">
                            <div className="mb-0.5 text-[12.5px] text-[#e8e9eb]">
                              {action.label}
                            </div>
                            <div className="text-[11px] leading-[1.3] text-[#4a4d55]">
                              {action.desc}
                            </div>
                          </div>
                          {/* Risk badge */}
                          <span
                            className={`flex-shrink-0 rounded-[2px] px-1.5 py-px font-mono text-[8px] ${RISK_BADGE[action.risk]}`}
                          >
                            {action.risk}
                          </span>
                          {/* Toggle */}
                          <div
                            className={`relative h-[18px] w-8 flex-shrink-0 rounded-full transition-colors ${
                              enabled ? 'bg-[#4caf82]' : 'bg-[#232428]'
                            }`}
                          >
                            <div
                              className={`absolute top-[2px] h-3.5 w-3.5 rounded-full bg-white transition-all ${
                                enabled ? 'right-[2px]' : 'left-[2px]'
                              }`}
                            />
                          </div>
                        </div>
                      )
                    })
                  })}
                </div>
              )}
            </div>

            {/* Exceptions */}
            <div className="mb-7">
              <div className="mb-2.5 flex items-center gap-2 font-mono text-[9px] uppercase tracking-[.12em] text-[#4a4d55] after:h-px after:flex-1 after:bg-[#1f2024] after:content-['']">
                {t('takeover.briefing.exceptions_q')}
              </div>
              <textarea
                value={exceptions}
                onChange={(e) => setExceptions(e.target.value)}
                placeholder={t('takeover.briefing.exceptions_placeholder')}
                className="h-[72px] w-full resize-none rounded border border-[#2a2b2f] bg-[#151618] px-3.5 py-2.5 text-[12.5px] leading-[1.5] text-[#e8e9eb] outline-none transition-colors placeholder:text-[#4a4d55] focus:border-[#5b7cf6]"
              />
              <div className="mt-1.5 text-[11px] italic text-[#4a4d55]">
                {t('takeover.briefing.exceptions_hint')}
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="flex flex-shrink-0 items-center gap-3 border-t border-[#1f2024] px-9 py-4">
            <button
              onClick={() => void handleActivate()}
              disabled={connectedTools.length === 0 || connectionState !== 'connected'}
              className="flex items-center gap-1.5 rounded bg-[#f0a04b] px-7 py-2.5 text-[13px] font-semibold tracking-[.01em] text-[#1a1200] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <svg
                width="13"
                height="13"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
              >
                <path d="M5 3l8 5-8 5V3z" />
              </svg>
              {t('takeover.briefing.activate')}
            </button>
            <div className="text-[11.5px] leading-[1.4] text-[#4a4d55]">
              {t('takeover.briefing.activate_desc')}{' '}
              <span className="font-medium text-[#7a7d85]">
                {t('takeover.briefing.activate_now')}
              </span>
              .
              <br />
              {t('takeover.briefing.activate_stop')}
            </div>
          </div>
        </div>

        {/* Aside */}
        <div className="flex w-[300px] flex-shrink-0 flex-col overflow-hidden">
          <div className="flex-shrink-0 border-b border-[#1f2024] px-5 pb-3.5 pt-5">
            <div className="mb-2 font-mono text-[9px] uppercase tracking-[.1em] text-[#4a4d55]">
              {t('takeover.briefing.aside_title')}
            </div>
            <div className="text-[13px] font-light leading-[1.6] text-[#e8e9eb]">
              <span className="text-[#f0a04b]">
                {t('takeover.briefing.aside_desc_actions', { count: scopeToggles.length })}
              </span>{' '}
              {t('takeover.briefing.aside_desc')}{' '}
              <span className="text-[#f0a04b]">
                {t('takeover.briefing.aside_desc_enabled', { count: enabledToggles.length })}
              </span>{' '}
              {t('takeover.briefing.aside_desc_tail', { count: disabledToggles.length })}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto px-5 py-3.5 [scrollbar-width:thin]">
            {asideHandled.length > 0 && (
              <div className="mb-4.5">
                <div className="mb-2 flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-[.1em] text-[#4a4d55] after:h-px after:flex-1 after:bg-[#1f2024] after:content-['']">
                  {t('takeover.briefing.aside_handles')}
                </div>
                {asideHandled.map((item, i) => (
                  <div
                    key={i}
                    className="flex items-start gap-2 border-b border-[#1f2024] py-2 last:border-b-0"
                  >
                    <div className="mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded text-[10px] bg-[rgba(76,175,130,.1)] text-[#4caf82]">
                      {item.icon}
                    </div>
                    <div className="flex-1">
                      <div className="text-[12px] leading-[1.3] text-[#7a7d85]">{item.label}</div>
                      <div className="font-mono text-[9px] text-[#4a4d55]">{item.meta}</div>
                    </div>
                    <span className="mt-0.5 flex-shrink-0 rounded-[2px] bg-[rgba(76,175,130,.1)] px-1.5 py-px font-mono text-[8px] text-[#4caf82]">
                      {t('takeover.briefing.aside_process')}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {asideHeld.length > 0 && (
              <div>
                <div className="mb-2 flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-[.1em] text-[#4a4d55] after:h-px after:flex-1 after:bg-[#1f2024] after:content-['']">
                  {t('takeover.briefing.aside_holds')}
                </div>
                {asideHeld.map((item, i) => (
                  <div
                    key={i}
                    className="flex items-start gap-2 border-b border-[#1f2024] py-2 last:border-b-0"
                  >
                    <div className="mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded text-[10px] bg-[rgba(212,168,67,.1)] text-[#d4a843]">
                      ⚑
                    </div>
                    <div className="flex-1">
                      <div className="text-[12px] leading-[1.3] text-[#7a7d85]">{item.label}</div>
                      <div className="font-mono text-[9px] text-[#4a4d55]">{item.meta}</div>
                    </div>
                    <span className="mt-0.5 flex-shrink-0 rounded-[2px] bg-[rgba(212,168,67,.1)] px-1.5 py-px font-mono text-[8px] text-[#d4a843]">
                      {t('takeover.briefing.aside_hold')}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {scopeToggles.length === 0 && (
              <div className="py-4 text-center text-[12px] text-[#4a4d55]">
                {t('takeover.briefing.aside_empty')}
              </div>
            )}
          </div>
        </div>
      </div>
    )
  }

  // ─ PHASE 2: ACTIVE ────────────────────────────────────────────────────────────

  function renderActive(): React.JSX.Element {
    return (
      <div className="flex flex-1 overflow-hidden">
        {/* Main */}
        <div className="flex flex-1 flex-col overflow-hidden border-r border-[#1f2024]">
          {/* Hero */}
          <div className="flex-shrink-0 border-b border-[rgba(240,160,75,.2)] bg-gradient-to-b from-[rgba(240,160,75,.06)] to-transparent px-9 pb-5 pt-6">
            <div className="mb-2.5 inline-flex items-center gap-1.5 rounded-full border border-[rgba(240,160,75,.3)] bg-[rgba(240,160,75,.1)] px-3 py-1 font-mono text-[9px] tracking-[.08em] text-[#f0a04b]">
              <div className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#f0a04b]" />
              {t('takeover.active.badge')}
            </div>
            <div className="mb-1 text-[22px] font-light leading-tight tracking-[-0.01em] text-[#e8e9eb]">
              {t('takeover.active.title')}
            </div>
            <div className="mb-3.5 flex items-center gap-4 text-[12px] text-[#7a7d85]">
              <span>
                {t('takeover.active.started_at')}{' '}
                <strong className="font-medium text-[#e8e9eb]">{startedAtStr}</strong>
              </span>
              <span>·</span>
              <span className="font-mono text-[#f0a04b]">{elapsed}</span>
              {endAtStr && (
                <>
                  <span>·</span>
                  <span>
                    {t('takeover.active.ends_at')}{' '}
                    <strong className="font-medium text-[#e8e9eb]">{endAtStr}</strong>
                  </span>
                </>
              )}
            </div>
            <div className="flex max-w-[480px] items-center gap-2.5">
              <div className="h-[3px] flex-1 overflow-hidden rounded-full bg-[#232428]">
                <div
                  className="h-full rounded-full bg-[#f0a04b] transition-all duration-500"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <div className="flex-shrink-0 font-mono text-[9px] text-[#4a4d55]">
                {t('takeover.active.progress', { pct: progress })}
              </div>
            </div>
          </div>

          {/* Activity */}
          <div className="flex-1 overflow-y-auto px-9 py-5 [scrollbar-width:thin]">
            {/* Active */}
            {activeItems.length > 0 && (
              <div className="mb-6">
                <div className="mb-2.5 flex items-center gap-2 font-mono text-[9px] uppercase tracking-[.12em] text-[#4a4d55] after:h-px after:flex-1 after:bg-[#1f2024] after:content-['']">
                  {t('takeover.active.handling_now')}
                  <span className="rounded-[3px] bg-[#232428] px-1.5 py-px text-[9px] text-[#4a4d55]">
                    {t('takeover.active.active_count', { count: activeItems.length })}
                  </span>
                </div>
                {activeItems.map((item) => (
                  <ActivityRow key={item.id} item={item} t={t} />
                ))}
              </div>
            )}

            {/* Done */}
            {doneItems.length > 0 && (
              <div className="mb-6">
                <div className="mb-2.5 flex items-center gap-2 font-mono text-[9px] uppercase tracking-[.12em] text-[#4a4d55] after:h-px after:flex-1 after:bg-[#1f2024] after:content-['']">
                  {t('takeover.active.completed')}
                  <span className="rounded-[3px] bg-[#232428] px-1.5 py-px text-[9px] text-[#4a4d55]">
                    {t('takeover.active.items_count', { count: doneItems.length })}
                  </span>
                </div>
                {doneItems.map((item) => (
                  <ActivityRow key={item.id} item={item} t={t} />
                ))}
              </div>
            )}

            {/* Held */}
            {heldItems.length > 0 && (
              <div className="mb-6">
                <div className="mb-2.5 flex items-center gap-2 font-mono text-[9px] uppercase tracking-[.12em] text-[#4a4d55] after:h-px after:flex-1 after:bg-[#1f2024] after:content-['']">
                  {t('takeover.active.saving_for_you')}
                  <span className="rounded-[3px] bg-[#232428] px-1.5 py-px text-[9px] text-[#4a4d55]">
                    {t('takeover.active.items_count', { count: heldItems.length })}
                  </span>
                </div>
                {heldItems.map((item) => (
                  <ActivityRow key={item.id} item={item} t={t} />
                ))}
              </div>
            )}

            {activityItems.length === 0 && (
              <div className="py-8 text-center text-[12px] text-[#4a4d55]">
                {t('takeover.active.initializing')}
              </div>
            )}
          </div>
        </div>

        {/* Aside */}
        <div className="flex w-[280px] flex-shrink-0 flex-col overflow-hidden">
          {/* Stats */}
          <div className="flex flex-shrink-0 flex-col gap-3 border-b border-[#1f2024] p-5">
            <div className="mb-1.5 font-mono text-[9px] uppercase tracking-[.1em] text-[#4a4d55]">
              {t('takeover.active.summary_title')}
            </div>
            <StatRow
              label={t('takeover.active.stat_handled')}
              value={String(doneItems.length)}
              color="good"
            />
            <StatRow
              label={t('takeover.active.stat_saved')}
              value={String(heldItems.length)}
              color="warn"
            />
            <StatRow
              label={t('takeover.active.stat_high_risk')}
              value={String(heldItems.filter((i) => i.risk === 'high').length)}
              color={heldItems.some((i) => i.risk === 'high') ? 'warn' : 'good'}
            />
          </div>

          {/* Held list */}
          <div className="flex-1 overflow-y-auto px-5 py-4 [scrollbar-width:thin]">
            <div className="mb-2.5 font-mono text-[9px] uppercase tracking-[.1em] text-[#4a4d55]">
              {t('takeover.active.held_queue')}
            </div>
            {heldItems.length === 0 ? (
              <div className="text-[11.5px] text-[#4a4d55]">{t('takeover.active.held_empty')}</div>
            ) : (
              heldItems.map((item) => (
                <div
                  key={item.id}
                  className="mb-1.5 rounded-md border border-l-2 border-[#1f2024] border-l-[#d4a843] bg-[#151618] px-3 py-2.5"
                >
                  <div className="mb-0.5 text-[12px] leading-[1.3] text-[#e8e9eb]">
                    {item.title}
                  </div>
                  <div className="text-[11px] italic leading-[1.4] text-[#4a4d55]">{item.sub}</div>
                </div>
              ))
            )}
          </div>

          {/* Stop */}
          <div className="flex-shrink-0 border-t border-[#1f2024] p-3.5">
            <button
              onClick={() => void handleReturn()}
              className="flex w-full items-center justify-center gap-1.5 rounded border border-[rgba(224,92,92,.35)] bg-transparent py-2.5 text-[12px] text-[#e05c5c] transition-all hover:border-[#e05c5c] hover:bg-[rgba(224,92,92,.1)]"
            >
              <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor">
                <rect x="3" y="3" width="10" height="10" rx="1" />
              </svg>
              {t('takeover.active.return_btn_full')}
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ─ PHASE 3: RETURN ────────────────────────────────────────────────────────────

  function renderReturn(): React.JSX.Element {
    return (
      <div className="flex flex-1 overflow-hidden">
        {/* Main */}
        <div className="flex flex-1 flex-col overflow-hidden border-r border-[#1f2024]">
          {/* Header */}
          <div className="flex-shrink-0 border-b border-[#1f2024] px-9 pb-5 pt-6">
            <div className="mb-2.5 inline-flex items-center gap-1.5 rounded-full border border-[rgba(76,175,130,.3)] bg-[rgba(76,175,130,.1)] px-3 py-1 font-mono text-[9px] text-[#4caf82]">
              <svg
                width="8"
                height="8"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
              >
                <path d="M3 8l4 4 6-7" />
              </svg>
              {t('takeover.return.welcome_back')}
            </div>
            <div className="mb-1 text-[22px] font-light leading-tight tracking-[-0.01em] text-[#e8e9eb]">
              {t('takeover.return.while_away')}
            </div>
            <div className="mb-3.5 text-[12px] text-[#7a7d85]">
              {t('takeover.return.active_summary', { duration: durationStr, start: startedAtStr })}
            </div>
            <div className="flex gap-4.5">
              <ReturnStat
                value={String(doneCards.length)}
                label={t('takeover.return.stat_handled')}
                color="text-[#e8e9eb]"
              />
              <div className="w-px bg-[#1f2024]" />
              <ReturnStat
                value={String(heldCards.filter((c) => !c.acknowledged).length)}
                label={t('takeover.return.stat_attention')}
                color="text-[#d4a843]"
              />
              <div className="w-px bg-[#1f2024]" />
              <ReturnStat
                value={String(heldCards.filter((c) => c.risk === 'high').length)}
                label={t('takeover.return.stat_high_risk')}
                color="text-[#4caf82]"
              />
            </div>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto px-9 py-5 [scrollbar-width:thin]">
            {/* Needs attention */}
            {heldCards.length > 0 && (
              <div className="mb-7">
                <div className="mb-3 flex items-center gap-2">
                  <div className="flex h-[22px] w-[22px] flex-shrink-0 items-center justify-center rounded-[5px] bg-[rgba(212,168,67,.1)] text-[11px] text-[#d4a843]">
                    ⚑
                  </div>
                  <div className="text-[12.5px] font-medium text-[#e8e9eb]">
                    {t('takeover.return.needs_attention')}
                  </div>
                  <span className="rounded-[3px] bg-[#232428] px-1.5 py-px font-mono text-[9px] text-[#4a4d55]">
                    {heldCards.filter((c) => !c.acknowledged).length}
                  </span>
                </div>
                <div className="flex flex-col gap-2">
                  {heldCards.map((card) => (
                    <div
                      key={card.id}
                      className={`flex items-start gap-2.5 rounded-lg border border-l-2 border-[#1f2024] border-l-[#d4a843] bg-[#151618] px-3.5 py-3 transition-opacity ${
                        card.acknowledged ? 'opacity-55' : ''
                      }`}
                    >
                      {/* Checkbox */}
                      <button
                        onClick={() => acknowledgeHeld(card.id)}
                        className={`mt-0.5 flex h-[18px] w-[18px] flex-shrink-0 items-center justify-center rounded border transition-all ${
                          card.acknowledged
                            ? 'border-[#4caf82] bg-[#4caf82]'
                            : 'border-[#2a2b2f] bg-transparent'
                        }`}
                      >
                        {card.acknowledged && (
                          <span className="text-[9px] font-bold text-white">✓</span>
                        )}
                      </button>
                      {/* Body */}
                      <div className="flex-1">
                        <div className="mb-0.5 text-[12.5px] font-medium leading-[1.3] text-[#e8e9eb]">
                          {card.title}
                        </div>
                        <div className="mb-1.5 text-[11.5px] leading-[1.4] text-[#7a7d85]">
                          {card.desc || t('takeover.return.requires_judgment')}
                        </div>
                        {card.detail && (
                          <div className="mb-1.5 rounded bg-[#1c1d20] px-2 py-1 font-mono text-[10px] leading-[1.5] text-[#4a4d55]">
                            {card.detail}
                          </div>
                        )}
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span
                            className={`rounded-[2px] px-1.5 py-px font-mono text-[8px] ${TAG_TOOL}`}
                          >
                            {card.tool}
                          </span>
                          <span
                            className={`rounded-[2px] px-1.5 py-px font-mono text-[8px] ${
                              card.risk === 'high' ? TAG_HIGH : TAG_HOLD
                            }`}
                          >
                            {card.risk}-risk
                          </span>
                        </div>
                      </div>
                      {/* Actions */}
                      <div className="flex flex-shrink-0 flex-col gap-1.5">
                        <button className="rounded border border-[#5b7cf6] bg-[#5b7cf6] px-2.5 py-1.5 text-[11px] font-medium text-white transition-opacity hover:opacity-90">
                          {card.primaryAction}
                        </button>
                        <button className="rounded border border-[#2a2b2f] bg-transparent px-2.5 py-1.5 text-[11px] text-[#7a7d85] transition-all hover:border-[#4a4d55] hover:text-[#e8e9eb]">
                          {t('takeover.return.ignore')}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Agent handled */}
            {doneCards.length > 0 && (
              <div className="mb-7">
                <div className="mb-3 flex items-center gap-2">
                  <div className="flex h-[22px] w-[22px] flex-shrink-0 items-center justify-center rounded-[5px] bg-[rgba(76,175,130,.1)] text-[11px] text-[#4caf82]">
                    ✓
                  </div>
                  <div className="text-[12.5px] font-medium text-[#e8e9eb]">
                    {t('takeover.return.agent_handled')}
                  </div>
                  <span className="rounded-[3px] bg-[#232428] px-1.5 py-px font-mono text-[9px] text-[#4a4d55]">
                    {doneCards.length}
                  </span>
                  <button
                    onClick={markAllSeen}
                    className="ml-auto rounded border border-transparent bg-transparent px-2 py-0.5 font-mono text-[9px] text-[#4a4d55] transition-all hover:border-[#4caf82] hover:text-[#4caf82]"
                  >
                    {t('takeover.return.mark_all_seen')}
                  </button>
                </div>
                <div className="flex flex-col gap-2">
                  {doneCards.map((card) => (
                    <div
                      key={card.id}
                      className={`flex items-start gap-2.5 rounded-lg border border-[#1f2024] bg-[#151618] px-3.5 py-3 transition-opacity ${
                        card.seen ? 'opacity-55' : ''
                      }`}
                    >
                      <div className="mt-0.5 flex h-[18px] w-[18px] flex-shrink-0 items-center justify-center rounded border border-[#4caf82] bg-[#4caf82]">
                        <span className="text-[9px] font-bold text-white">✓</span>
                      </div>
                      <div className="flex-1">
                        <div className="mb-0.5 text-[12.5px] font-medium leading-[1.3] text-[#e8e9eb]">
                          {card.title}
                        </div>
                        <div className="mb-1.5 text-[11.5px] leading-[1.4] text-[#7a7d85]">
                          {card.desc}
                        </div>
                        <div className="flex gap-1.5">
                          <span
                            className={`rounded-[2px] px-1.5 py-px font-mono text-[8px] ${TAG_DONE}`}
                          >
                            {t('takeover.return.tag_completed')}
                          </span>
                          <span
                            className={`rounded-[2px] px-1.5 py-px font-mono text-[8px] ${TAG_TOOL}`}
                          >
                            {card.tool}
                          </span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {doneCards.length === 0 && heldCards.length === 0 && (
              <div className="py-8 text-center text-[12px] text-[#4a4d55]">
                {t('takeover.return.no_activity')}
              </div>
            )}

            {/* New take over button */}
            <div className="pt-2">
              <button
                onClick={handleReset}
                className="rounded border border-[#2a2b2f] bg-transparent px-4 py-2 text-[12px] text-[#7a7d85] transition-all hover:border-[#4a4d55] hover:text-[#e8e9eb]"
              >
                {t('takeover.return.new_takeover')}
              </button>
            </div>
          </div>
        </div>

        {/* Aside */}
        <div className="flex w-[280px] flex-shrink-0 flex-col gap-4.5 overflow-y-auto p-5 [scrollbar-width:thin]">
          <div>
            <div className="mb-2 font-mono text-[9px] uppercase tracking-[.1em] text-[#4a4d55]">
              {t('takeover.return.agent_read')}
            </div>
            <div className="mb-2.5 text-[13px] font-light leading-[1.6] text-[#e8e9eb]">
              {agentSummary ||
                (doneCards.length > 0
                  ? t('takeover.return.agent_fallback_done', { count: doneCards.length })
                  : t('takeover.return.agent_fallback_empty'))}{' '}
              {heldCards.length > 0 && (
                <span className="text-[#f0a04b]">
                  {t('takeover.return.agent_held_note', { count: heldCards.length })}
                </span>
              )}
            </div>
            {heldCards.length > 0 && (
              <div className="border-l-2 border-[#2a2b2f] pl-2.5 text-[12px] italic leading-[1.5] text-[#7a7d85]">
                {t('takeover.return.review_held')}
              </div>
            )}
          </div>

          <div className="h-px bg-[#1f2024]" />

          {timeline.length > 0 && (
            <div>
              <div className="mb-2 font-mono text-[9px] uppercase tracking-[.1em] text-[#4a4d55]">
                {t('takeover.return.timeline')}
              </div>
              <div>
                {timeline.map((item, i) => (
                  <div
                    key={i}
                    className="flex items-start gap-2.5 border-b border-[#1f2024] py-2 last:border-b-0"
                  >
                    <div
                      className={`mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full ${
                        item.status === 'done' ? 'bg-[#4caf82]' : 'bg-[#d4a843]'
                      }`}
                    />
                    <div className="flex-1">
                      <div className="text-[11.5px] leading-[1.3] text-[#7a7d85]">{item.text}</div>
                      <div className="font-mono text-[9px] text-[#4a4d55]">{item.time}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    )
  }

  // ── Root render ───────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-[#0e0f11] font-sans text-[13px] text-[#e8e9eb]">
      {phase === 'briefing' && renderBriefing()}
      {phase === 'active' && renderActive()}
      {phase === 'return' && renderReturn()}
    </div>
  )
}

// ── Small helper components ───────────────────────────────────────────────────

function ActivityRow({
  item,
  t
}: {
  item: ActivityItem
  t: (key: string, params?: Record<string, string | number>) => string
}): React.JSX.Element {
  return (
    <div className="flex items-start gap-2.5 border-b border-[#1f2024] py-2.5 last:border-b-0">
      <div className={`mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full ${ACT_DOT[item.status]}`} />
      <div className="flex-1">
        <div className="mb-0.5 text-[12.5px] leading-[1.3] text-[#e8e9eb]">{item.title}</div>
        <div className="mb-1.5 text-[11.5px] leading-[1.4] text-[#7a7d85]">{item.sub}</div>
        <div className="flex flex-wrap gap-1.5">
          {item.status === 'done' && (
            <span className={`rounded-[2px] px-1.5 py-px font-mono text-[8px] ${TAG_DONE}`}>
              {t('takeover.return.tag_completed')}
            </span>
          )}
          {item.status === 'held' && (
            <span className={`rounded-[2px] px-1.5 py-px font-mono text-[8px] ${TAG_HOLD}`}>
              {t('takeover.return.tag_saved')}
            </span>
          )}
          {item.risk === 'high' && (
            <span className={`rounded-[2px] px-1.5 py-px font-mono text-[8px] ${TAG_HIGH}`}>
              high-risk
            </span>
          )}
          <span className={`rounded-[2px] px-1.5 py-px font-mono text-[8px] ${TAG_TOOL}`}>
            {item.tool}
          </span>
        </div>
      </div>
      <div className="flex-shrink-0 font-mono text-[9px] text-[#4a4d55]">{item.time}</div>
    </div>
  )
}

function StatRow({
  label,
  value,
  color
}: {
  label: string
  value: string
  color: 'good' | 'warn' | 'neutral'
}): React.JSX.Element {
  const valClass =
    color === 'good' ? 'text-[#4caf82]' : color === 'warn' ? 'text-[#d4a843]' : 'text-[#e8e9eb]'
  return (
    <div className="flex items-center justify-between text-[12px] text-[#7a7d85]">
      <span>{label}</span>
      <span className={`font-mono text-[13px] font-medium ${valClass}`}>{value}</span>
    </div>
  )
}

function ReturnStat({
  value,
  label,
  color
}: {
  value: string
  label: string
  color: string
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-0.5">
      <div className={`font-mono text-[18px] font-light ${color}`}>{value}</div>
      <div className="text-[10.5px] text-[#4a4d55]">{label}</div>
    </div>
  )
}
