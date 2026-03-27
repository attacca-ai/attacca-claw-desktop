import { useState, useEffect, useCallback, useRef } from 'react'
import { gatewayClient } from '@/lib/gateway-client'
import {
  useAgentStore,
  type AgentThread,
  type LandscapeTheme,
  type MorningLandscape
} from '@/stores/agent-store'
import { useGatewayStore } from '@/stores/gateway-store'
import { useOnboardingStore } from '@/stores/onboarding-store'
import { normalizeComposioSlugs } from '@/lib/constants'
import { useSettingsStore } from '@/stores/settings-store'
import { ArrowLeft, ArrowUp, Loader2, RefreshCw, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn, extractMessageText } from '@/lib/utils'
import type { OcEvent } from '@/types/gateway'

const LANDSCAPE_TIMEOUT_MS = 120_000
const LANDSCAPE_REFRESH_MS = 6 * 60 * 60 * 1000 // 6 hours

/** Maps connection tool IDs to the Composio actions the agent should call */
const TOOL_ACTIONS: Record<string, string> = {
  // Email
  gmail: 'GMAIL_FETCH_EMAILS with query "is:unread newer_than:3d" and max_results 20',
  outlook:
    'fetch unread Outlook emails using OUTLOOK_FETCH_EMAILS with {"folder":"inbox","top":20,"is_read":false}',
  // Calendar
  'google-calendar':
    'call GOOGLECALENDAR_EVENTS_LIST via the attacca-tools skill to fetch upcoming calendar events',
  'outlook-calendar':
    'call OUTLOOK_LIST_EVENTS via the attacca-tools skill to fetch upcoming meetings and events',
  // Messaging
  slack: 'SLACK_LIST_ALL_CHANNELS_IN_THE_SLACK_WORKSPACE then read recent activity',
  // Project management
  trello:
    'call TRELLO_GET_MEMBERS_BOARDS_BY_ID_MEMBER with {"idMember":"me"} then TRELLO_GET_BOARDS_CARDS_BY_ID_BOARD for each board',
  clickup: 'CLICKUP_GET_FILTERED_TEAM_TASKS with statuses open and in-progress',
  asana: 'ASANA_GET_TASKS_LIST with assignee "me" and completed_since "now"',
  notion: 'NOTION_SEARCH for recent pages and databases',
  // Storage
  'google-drive': 'check recent Google Drive files using available Drive actions'
}

function buildLandscapePrompt(
  connectedTools: string[],
  recentCaptureLines: string[],
  openThreadLines: string[]
): string {
  const toolLines = connectedTools.filter((t) => TOOL_ACTIONS[t]).map((t) => `- ${TOOL_ACTIONS[t]}`)

  // Inject context from the store so the LLM has local knowledge even before tool calls
  const contextParts: string[] = []
  if (recentCaptureLines.length > 0) {
    contextParts.push(`Recent captures from the user:\n${recentCaptureLines.join('\n')}`)
  }
  if (openThreadLines.length > 0) {
    contextParts.push(
      `Open threads (unresolved questions the agent is holding):\n${openThreadLines.join('\n')}`
    )
  }
  const contextSection =
    contextParts.length > 0
      ? `\n\nCONTEXT from recent activity:\n${contextParts.join('\n\n')}\n`
      : ''

  const connectedList =
    connectedTools.length > 0
      ? `The user has these tools connected: ${connectedTools.join(', ')}.`
      : 'The user has no tools connected yet.'

  // Step 1: gather live data — only act on tools the user actually has connected
  const step1 =
    toolLines.length > 0
      ? `\n${connectedList}\n\nSTEP 1 — GATHER LIVE DATA (you MUST do this before generating your response):\nCALL ONLY the tools listed below — do NOT call any other tools, even if you have documentation for them. If a tool is not in this list the user has NOT connected it:\n${toolLines.join('\n')}\n`
      : `\n${connectedList}\n\n(No supported tools are connected — base the landscape on the context above and today's date. Do NOT attempt to call any tools.)\n`

  const step2Label = toolLines.length > 0 ? '\nSTEP 2 — ' : '\n'

  return `You are generating a daily work landscape for a knowledge worker.${contextSection}${step1}${step2Label}After gathering data, return ONLY valid JSON (no markdown fences, no other text):
{
  "message": "Exactly 3 sentences about what stands out today based on the data you gathered. Speak like a knowledgeable colleague giving a terrain reading, not a bullet list. Use [entity]key topic[/entity] to highlight important named items.",
  "question": "One short open question based on the theme with the highest mentionCount from recent captures, or null if there are no captures or nothing needs orienting. Omit if not genuinely relevant.",
  "themes": [
    { "title": "Two words max", "description": "Why this matters right now", "weight": "high|mid|low|neutral", "tags": ["tag1"], "mentionCount": 1 }
  ],
  "threads": [
    { "title": "3-5 word topic", "holdingNote": "First-person max 2 sentences about what needs clarification before acting." }
  ],
  "suggestedActions": [
    { "label": "Action label", "actionType": "capture", "payload": {} }
  ]
}
Weights: high=urgent deadline, mid=needs attention, low=ongoing, neutral=informational. Max 4 themes, max 2 threads (only if genuine ambiguity exists in the data), max 2 suggestedActions.`
}

/** Truncates text to at most N sentences */
function truncateToSentences(text: string, max: number): string {
  const sentences = text.split(/(?<=[.!?])\s+/).filter(Boolean)
  return sentences.length > max ? sentences.slice(0, max).join(' ') : text
}

const WEIGHT_STYLES: Record<LandscapeTheme['weight'], { strip: string; label: string }> = {
  high: { strip: 'bg-[#e05c5c]', label: 'text-[#e05c5c]' },
  mid: { strip: 'bg-[#d4a843]', label: 'text-[#d4a843]' },
  low: { strip: 'bg-[#4caf82]', label: 'text-[#4caf82]' },
  neutral: { strip: 'bg-[#5b7cf6]', label: 'text-[#5b7cf6]' }
}

const WEIGHT_LABELS: Record<LandscapeTheme['weight'], string> = {
  high: 'HIGH WEIGHT',
  mid: 'NEEDS ATTENTION',
  low: 'LOW WEIGHT',
  neutral: 'SIMMERING'
}

/** Parses [entity]...[/entity] tags into highlighted <em> spans */
function parseAgentMessage(text: string): React.ReactNode[] {
  const parts = text.split(/(\[entity\].*?\[\/entity\])/g)
  return parts.map((part, i) => {
    const match = part.match(/^\[entity\](.*?)\[\/entity\]$/)
    if (match) {
      return (
        <em key={i} className="not-italic font-normal text-amber-400">
          {match[1]}
        </em>
      )
    }
    return <span key={i}>{part}</span>
  })
}

function formatThreadAge(createdAt: number): { label: string; colorClass: string } {
  const diffMs = Date.now() - createdAt
  const diffDays = Math.floor(diffMs / 86_400_000)
  const diffHours = Math.floor(diffMs / 3_600_000)
  const label =
    diffDays >= 1 ? `${diffDays}d open` : diffHours >= 1 ? `${diffHours}h open` : 'just opened'
  const colorClass =
    diffDays >= 7 ? 'text-red-500' : diffDays >= 3 ? 'text-yellow-500' : 'text-muted-foreground/50'
  return { label, colorClass }
}

function formatTimestamp(timeZone?: string): string {
  const opts: Intl.DateTimeFormatOptions = {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    ...(timeZone ? { timeZone } : {})
  }
  const base = new Intl.DateTimeFormat('en-US', opts).format(new Date()).toUpperCase()
  if (!timeZone) return base
  // Extract city name from IANA string: "America/Bogota" → "Bogota", "America/New_York" → "New York"
  const city = timeZone.split('/').pop()?.replace(/_/g, ' ') ?? timeZone
  return `${base} · ${city.toUpperCase()}`
}

interface ThreadMessage {
  role: 'agent' | 'user'
  text: string
  ts: number
}

function ThreadChatPanel({
  thread,
  onBack
}: {
  thread: AgentThread
  onBack: () => void
}): React.JSX.Element {
  const [messages, setMessages] = useState<ThreadMessage[]>([
    { role: 'agent', text: thread.holdingNote || 'Procesando…', ts: thread.createdAt }
  ])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const pendingSessionKeyRef = useRef<string | null>(null)
  const { updateThreadNote, closeThread } = useAgentStore()
  const connectionState = useGatewayStore((s) => s.connectionState)

  useEffect(() => {
    const handler = (ev: OcEvent): void => {
      if (ev.event !== 'chat') return
      const payload = (ev.payload ?? {}) as Record<string, unknown>
      if (payload.state !== 'final') return
      if (!pendingSessionKeyRef.current || payload.sessionKey !== pendingSessionKeyRef.current)
        return
      const rawText = extractMessageText(
        payload.message as Parameters<typeof extractMessageText>[0]
      )
      pendingSessionKeyRef.current = null
      setSending(false)
      let note = rawText
      let newHoldingNote: string | null | undefined = undefined
      let resolvedIds: string[] = []
      const jsonMatch = rawText.match(/\{[\s\S]*\}/)
      if (jsonMatch) {
        try {
          const parsed = JSON.parse(jsonMatch[0]) as {
            note?: string
            holdingNote?: string | null
            resolvedThreadIds?: string[]
          }
          if (parsed.note) note = parsed.note
          if ('holdingNote' in parsed) newHoldingNote = parsed.holdingNote
          if (Array.isArray(parsed.resolvedThreadIds)) resolvedIds = parsed.resolvedThreadIds
        } catch {
          /* use raw */
        }
      }
      setMessages((prev) => [...prev, { role: 'agent', text: note, ts: Date.now() }])
      if (typeof newHoldingNote === 'string') {
        updateThreadNote(thread.id, newHoldingNote)
      }
      if (resolvedIds.includes(thread.id)) {
        closeThread(thread.id)
        onBack()
      }
    }
    gatewayClient.on('*', handler)
    return () => gatewayClient.off('*', handler)
  }, [thread.id, thread.holdingNote, updateThreadNote, closeThread, onBack])

  const handleSend = async (): Promise<void> => {
    if (!input.trim() || sending || connectionState !== 'connected') return
    const userText = input.trim()
    setInput('')
    setMessages((prev) => [...prev, { role: 'user', text: userText, ts: Date.now() }])
    setSending(true)
    const sessionKey = `agent:main:thread-${thread.id}-${crypto.randomUUID()}`
    pendingSessionKeyRef.current = sessionKey
    const prompt =
      `Retomas un hilo abierto. Hilo: "${thread.title}". Estabas esperando: "${thread.holdingNote}".\n` +
      `El usuario responde: "${userText}"\n\n` +
      `Ayúdale a pensar y ejecuta si corresponde. Llama herramientas si necesitas datos.\n` +
      `Responde SOLO con JSON válido (sin markdown):\n` +
      `{"note":"Tu respuesta conversacional.","holdingNote":"Qué sigues esperando (null si resuelto).","resolvedThreadIds":[]}\n` +
      `- Incluye "${thread.id}" en resolvedThreadIds si este hilo queda completamente resuelto.`
    try {
      await gatewayClient.rpc('chat.send', {
        sessionKey,
        message: prompt,
        idempotencyKey: sessionKey
      })
    } catch {
      setSending(false)
      pendingSessionKeyRef.current = null
    }
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-[#1f2024] px-6 py-4">
        <button
          onClick={onBack}
          className="rounded p-1 text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <span className="flex-1 text-[13px] font-medium text-foreground">{thread.title}</span>
        <span className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground/50">
          hilo abierto
        </span>
      </div>

      {/* Messages */}
      <div className="flex flex-1 flex-col gap-3 overflow-y-auto px-6 py-4">
        {messages.map((m, i) => (
          <div key={i} className={cn('flex', m.role === 'user' ? 'justify-end' : 'justify-start')}>
            <div
              className={cn(
                'max-w-[80%] rounded-lg px-3 py-2 text-[12.5px] leading-[1.5]',
                m.role === 'user'
                  ? 'bg-[rgba(91,124,246,.15)] text-foreground'
                  : 'bg-[#232428] italic text-muted-foreground'
              )}
            >
              {m.text}
            </div>
          </div>
        ))}
        {sending && (
          <div className="flex justify-start">
            <div className="rounded-lg bg-[#232428] px-3 py-2">
              <span className="animate-pulse text-[11px] text-muted-foreground/50">pensando…</span>
            </div>
          </div>
        )}
      </div>

      {/* Input */}
      <div className="shrink-0 border-t border-[#1f2024] px-6 py-4">
        <div className="flex gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                void handleSend()
              }
            }}
            placeholder="Responde al agente…"
            className="flex-1 rounded-md border border-[#1f2024] bg-[#151618] px-3 py-2 text-[12.5px] text-foreground placeholder:text-muted-foreground/40 outline-none focus:border-[#5b7cf6]/50"
          />
          <button
            onClick={() => void handleSend()}
            disabled={!input.trim() || sending || connectionState !== 'connected'}
            className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-md bg-[#5b7cf6] text-white transition-opacity disabled:opacity-40"
          >
            <ArrowUp className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  )
}

export function LandscapeView(): React.JSX.Element {
  const {
    morningLandscape,
    themes,
    threads,
    setMorningLandscape,
    setThemes,
    setThreads,
    closeThread
  } = useAgentStore()
  const connectionState = useGatewayStore((s) => s.connectionState)
  const connectedTools = useOnboardingStore((s) => s.connectedTools)
  const userTimezone = useSettingsStore((s) => s.userTimezone)
  const [loading, setLoading] = useState(false)
  const [timestamp, setTimestamp] = useState(() => formatTimestamp(userTimezone))
  const [activeThread, setActiveThread] = useState<AgentThread | null>(null)
  // Ensures auto-trigger fires at most once per app session
  const hasAutoTriggeredRef = useRef(false)

  // Update timestamp every minute
  useEffect(() => {
    const interval = setInterval(() => setTimestamp(formatTimestamp(userTimezone)), 60_000)
    return () => clearInterval(interval)
  }, [])

  const focusCapture = (context: string): void => {
    window.dispatchEvent(new CustomEvent('attacca:focus-capture', { detail: { context } }))
  }

  const handleSuggestedAction = (action: { actionType: string; payload: unknown }): void => {
    if (action.actionType === 'capture') {
      const payload = (action.payload ?? {}) as Record<string, unknown>
      focusCapture((payload.text as string) || '')
      return
    }
    if (connectionState !== 'connected') return
    gatewayClient
      .rpc('chat.send', {
        sessionKey: 'agent:main:main',
        message: JSON.stringify({ type: action.actionType, payload: action.payload }),
        idempotencyKey: crypto.randomUUID()
      })
      .catch(() => undefined)
  }

  const generateLandscape = useCallback(async (): Promise<void> => {
    if (connectionState !== 'connected' || loading) return
    setLoading(true)

    // Always fetch the latest connected apps so we never use a stale snapshot.
    let liveTools = connectedTools
    try {
      const relayApps = await window.api.composio.getConnected()
      // Normalize Composio slugs (e.g. "googlecalendar" → "google-calendar")
      if (relayApps.length > 0) liveTools = normalizeComposioSlugs(relayApps)
    } catch {
      // Relay unavailable — fall back to store
    }

    // Build context from store state at call time (avoids stale closure issues)
    const storeState = useAgentStore.getState()
    const recentCaptureLines = storeState.rawCaptures
      .slice(0, 5)
      .map((c) => `  [${c.type}] "${c.text}"`)
    const openThreadLines = storeState.threads
      .slice(0, 3)
      .map((t) => `  "${t.title}": ${t.holdingNote}`)

    // Use a unique session per generation so the agent starts with clean context
    // and won't carry over stale "tool disconnected" memory from previous turns.
    const idempotencyKey = crypto.randomUUID()
    const sessionKey = `agent:main:landscape-${idempotencyKey}`

    try {
      await gatewayClient.rpc('chat.send', {
        sessionKey,
        message: buildLandscapePrompt(liveTools, recentCaptureLines, openThreadLines),
        idempotencyKey
      })

      let done = false
      const timeoutId = setTimeout(() => {
        if (!done) {
          done = true
          gatewayClient.off('*', handler)
          setLoading(false)
        }
      }, LANDSCAPE_TIMEOUT_MS)

      const handler = (event: OcEvent): void => {
        if (event.event !== 'chat') return
        const payload = (event.payload ?? {}) as Record<string, unknown>
        const state = payload.state as string

        // Only process events from this landscape session
        if (payload.sessionKey !== undefined && payload.sessionKey !== sessionKey) return

        if (state === 'final' && !done) {
          done = true
          clearTimeout(timeoutId)
          gatewayClient.off('*', handler)
          setLoading(false)

          const rawText = extractMessageText(
            payload.message as Parameters<typeof extractMessageText>[0]
          )

          // Extract JSON — strip possible markdown code fences
          const jsonMatch = rawText.match(/\{[\s\S]*\}/)
          if (!jsonMatch) return

          try {
            const parsed = JSON.parse(jsonMatch[0]) as {
              message?: string
              question?: string | null
              themes?: LandscapeTheme[]
              threads?: Array<{ title: string; holdingNote: string }>
              suggestedActions?: MorningLandscape['suggestedActions']
            }

            // Hard limit: truncate message to max 3 sentences in renderer
            const msg = truncateToSentences(parsed.message ?? '', 3)

            const landscape: MorningLandscape = {
              message: msg,
              question: parsed.question ?? null,
              suggestedActions: parsed.suggestedActions ?? [],
              generatedAt: Date.now()
            }

            setMorningLandscape(landscape)
            setThemes(
              (parsed.themes ?? []).map((t, i) => ({
                ...t,
                id: t.id ?? `theme_${i}`,
                tags: t.tags ?? [],
                mentionCount: t.mentionCount ?? 1
              }))
            )
            // Replace threads from previous briefing runs — deduplicate by title
            // to avoid accumulating duplicates across refreshes. Existing threads
            // not present in the new response are dropped; user-closed ones are
            // already gone from the store.
            const freshThreads = (parsed.threads ?? [])
              .filter((t) => t.title && t.holdingNote)
              .map((t, i) => ({
                id: `thread_briefing_${i}_${Date.now()}`,
                title: t.title as string,
                holdingNote: t.holdingNote as string,
                createdAt: Date.now()
              }))
            // Merge: keep manually-added threads (id not starting with "thread_briefing_")
            // and replace all briefing-generated ones with the fresh set.
            const storeState = useAgentStore.getState()
            const manualThreads = storeState.threads.filter(
              (t) => !t.id.startsWith('thread_briefing_')
            )
            setThreads([...manualThreads, ...freshThreads])
          } catch {
            // JSON parse failed — silently ignore, user can retry
          }
        } else if (state === 'error' && !done) {
          done = true
          clearTimeout(timeoutId)
          gatewayClient.off('*', handler)
          setLoading(false)
        }
      }

      gatewayClient.on('*', handler)
    } catch {
      setLoading(false)
    }
  }, [connectionState, loading, connectedTools, setMorningLandscape, setThemes, setThreads])

  // Auto-trigger landscape when connected if missing or stale (>6h since last generation)
  useEffect(() => {
    if (connectionState !== 'connected') return
    if (hasAutoTriggeredRef.current) return

    const landscape = useAgentStore.getState().morningLandscape
    const isStale = !landscape || Date.now() - landscape.generatedAt > LANDSCAPE_REFRESH_MS
    if (isStale) {
      hasAutoTriggeredRef.current = true
      generateLandscape()
    }
  }, [connectionState]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* ── Header ── */}
      <div className="shrink-0 border-b border-border px-6 py-[18px]">
        {/* Timestamp */}
        <div className="mb-2 font-mono text-[10px] tracking-widest text-muted-foreground/60">
          {timestamp}
        </div>

        {morningLandscape ? (
          <>
            {/* Morning message */}
            <p className="max-w-[520px] text-[15px] font-light leading-relaxed text-foreground">
              {parseAgentMessage(morningLandscape.message)}
            </p>

            {/* Agent question */}
            {morningLandscape.question && (
              <p className="mt-3 border-l-2 border-border pl-3 text-sm italic text-muted-foreground">
                <strong className="font-normal not-italic text-blue-400">
                  {morningLandscape.question}
                </strong>
              </p>
            )}

            {/* Action buttons */}
            <div className="mt-3 flex flex-wrap gap-2">
              {/* "Responder" — always first */}
              <Button
                size="sm"
                variant="default"
                className="text-xs"
                onClick={() => focusCapture(morningLandscape.message)}
              >
                Responder
              </Button>
              {/* Up to 2 contextual actions from suggestedActions */}
              {morningLandscape.suggestedActions.slice(0, 2).map((action, i) => (
                <Button
                  key={i}
                  size="sm"
                  variant="outline"
                  className="text-xs"
                  onClick={() => handleSuggestedAction(action)}
                >
                  {action.label}
                </Button>
              ))}
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={generateLandscape}
                disabled={loading || connectionState !== 'connected'}
                title="Refresh landscape"
                className="ml-auto"
              >
                <RefreshCw className={cn('h-3 w-3', loading && 'animate-spin')} />
              </Button>
            </div>
          </>
        ) : (
          <div className="flex items-center gap-4">
            <p className="text-sm text-muted-foreground">
              {loading
                ? 'Reading your calendar, inbox and tasks…'
                : 'Generate your daily landscape to see what matters today.'}
            </p>
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            ) : (
              <Button
                size="sm"
                variant="outline"
                onClick={generateLandscape}
                disabled={connectionState !== 'connected'}
              >
                Generate Landscape
              </Button>
            )}
          </div>
        )}
      </div>

      {/* ── Body ── */}
      {activeThread ? (
        <ThreadChatPanel thread={activeThread} onBack={() => setActiveThread(null)} />
      ) : null}
      <div className={cn('flex-1 overflow-y-auto px-6 py-5', activeThread ? 'hidden' : '')}>
        {/* Themes */}
        <div className="mb-6">
          <p className="mb-3 font-mono text-[9px] uppercase tracking-widest text-muted-foreground/60">
            What I&apos;m noticing · themes
          </p>

          {themes.length > 0 ? (
            <div className="grid grid-cols-2 gap-[10px]">
              {themes.slice(0, 4).map((theme) => {
                const styles = WEIGHT_STYLES[theme.weight]
                return (
                  <div
                    key={theme.id}
                    className="relative cursor-pointer overflow-hidden rounded-lg border border-[#1f2024] bg-[#151618] px-4 py-[14px] transition-colors hover:bg-[#1c1d20]"
                  >
                    {/* Left accent strip */}
                    <div className={cn('absolute bottom-0 left-0 top-0 w-[3px]', styles.strip)} />

                    <p
                      className={cn(
                        'mb-[5px] font-mono text-[9px] uppercase tracking-[.1em]',
                        styles.label
                      )}
                    >
                      {WEIGHT_LABELS[theme.weight]}
                    </p>
                    <p className="mb-1 text-[13px] font-medium text-foreground">{theme.title}</p>
                    <p className="text-[11.5px] leading-[1.45] text-muted-foreground">
                      {theme.description}
                    </p>
                    <div className="mt-[10px] flex items-center gap-1.5">
                      {theme.tags.map((tag) => (
                        <span
                          key={tag}
                          className="rounded-[3px] bg-[#232428] px-[6px] py-[2px] font-mono text-[9px] text-muted-foreground/60"
                        >
                          {tag}
                        </span>
                      ))}
                      {theme.mentionCount > 1 && (
                        <span className="ml-auto font-mono text-[9px] text-muted-foreground/50">
                          ×{theme.mentionCount} esta semana
                        </span>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-border/60 px-4 py-6 text-center">
              <p className="text-sm text-muted-foreground">
                {morningLandscape
                  ? 'No themes detected yet.'
                  : "Generate your landscape to surface today's key themes."}
              </p>
            </div>
          )}
        </div>

        {/* Open Threads */}
        {threads.length > 0 && (
          <div>
            <p className="mb-3 font-mono text-[9px] uppercase tracking-widest text-muted-foreground/60">
              Open threads · what I&apos;m holding
            </p>
            <div className="flex flex-col gap-[8px]">
              {threads.map((thread) => {
                const { label: ageLabel, colorClass: ageColor } = formatThreadAge(thread.createdAt)
                return (
                  <div
                    key={thread.id}
                    onClick={() => setActiveThread(thread)}
                    className="cursor-pointer rounded-lg border border-[#1f2024] bg-[#151618] px-[15px] py-[13px] transition-colors hover:bg-[#1c1d20]"
                  >
                    <div className="mb-[6px] flex items-center gap-[10px]">
                      <span className="flex-1 text-[12.5px] font-medium text-foreground">
                        {thread.title}
                      </span>
                      <span className={cn('font-mono text-[9px]', ageColor)}>{ageLabel}</span>
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          closeThread(thread.id)
                        }}
                        className="rounded p-0.5 text-muted-foreground/40 transition-colors hover:text-muted-foreground"
                        title="Close thread"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                    {thread.holdingNote && (
                      <p className="rounded-[4px] border-l-2 border-border bg-[#232428] px-[10px] py-[6px] text-[11.5px] italic text-muted-foreground before:mr-1 before:font-mono before:text-[9px] before:not-italic before:uppercase before:tracking-[.06em] before:text-muted-foreground/50 before:content-['esperando_→']">
                        {thread.holdingNote}
                      </p>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
