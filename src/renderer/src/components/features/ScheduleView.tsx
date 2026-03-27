import { useState, useEffect, useRef, useCallback } from 'react'
import { gatewayClient } from '@/lib/gateway-client'
import { useGatewayStore } from '@/stores/gateway-store'
import { useOnboardingStore } from '@/stores/onboarding-store'
import { normalizeComposioSlugs } from '@/lib/constants'
import { useAgentStore } from '@/stores/agent-store'
import { useSettingsStore } from '@/stores/settings-store'
import { cn, extractMessageText } from '@/lib/utils'
import { ChevronLeft, ChevronRight, ArrowUp, Square } from 'lucide-react'
import type { OcEvent } from '@/types/gateway'
import { t as tStatic } from '@/i18n'

// ── Local types ──────────────────────────────────────────────────────────────

type EventType = 'meeting' | 'focus' | 'personal' | 'flagged'

interface CalEvent {
  id: string
  title: string
  start: string // ISO datetime
  end: string
  type: EventType
  attendees?: string[]
  flagNote?: string
  source?: 'google' | 'outlook'
  hasConflict?: boolean
  priority?: 'critical' | 'flexible'
  colIndex?: number // 0-based column within overlap group
  colCount?: number // total columns in overlap group
}

interface ScheduleRead {
  message: string
  question: string | null
  suggestedActions: Array<{
    label: string
    icon: 'warn' | 'plus' | 'move' | 'send'
    risk: 'low' | 'mid' | 'high'
    prompt: string
  }>
}

interface ProposedChange {
  id: string
  title: string
  from: string
  to: string
  risk: 'low' | 'mid' | 'high'
  confirmationPrompt: string
}

// ── Constants ────────────────────────────────────────────────────────────────

const SCHEDULE_READ_CACHE_MS = 4 * 60 * 60 * 1000 // 4 hours

const HOUR_HEIGHT = 60
const DAY_START_HOUR = 0
const DAY_END_HOUR = 24
const HOURS = Array.from({ length: DAY_END_HOUR - DAY_START_HOUR }, (_, i) => DAY_START_HOUR + i)

const EVENT_TYPE_CLASSES: Record<EventType, string> = {
  meeting: 'bg-[rgba(91,124,246,.12)] border-l-2 border-[#5b7cf6]',
  focus: 'bg-[rgba(76,175,130,.1)] border-l-2 border-[#4caf82]',
  personal: 'bg-[rgba(155,114,245,.12)] border-l-2 border-[#9b72f5]',
  flagged: 'bg-[rgba(212,168,67,.1)] border-l-2 border-[#d4a843]'
}

const CHIP_ICON_CLASSES: Record<string, string> = {
  warn: 'bg-[rgba(212,168,67,.1)] text-[#d4a843]',
  plus: 'bg-[rgba(76,175,130,.1)] text-[#4caf82]',
  move: 'bg-[rgba(91,124,246,.12)] text-[#5b7cf6]',
  send: 'bg-[rgba(155,114,245,.12)] text-[#9b72f5]'
}

const RISK_CLASSES: Record<string, string> = {
  low: '',
  mid: 'bg-[rgba(212,168,67,.1)] text-[#d4a843]',
  high: 'bg-[rgba(224,92,92,.1)] text-[#e05c5c]'
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function startOfDay(d: Date): Date {
  const r = new Date(d)
  r.setHours(0, 0, 0, 0)
  return r
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })
}

function formatHour(h: number): string {
  if (h === 0 || h === 12) return h === 0 ? '12 AM' : '12 PM'
  return h < 12 ? `${h} AM` : `${h - 12} PM`
}

/** Normalize Outlook datetime strings to proper UTC ISO.
 *  Outlook/MS Graph returns "2026-03-14T16:00:00.0000000" (UTC, no Z, 7-digit fractions).
 *  Without a timezone indicator JS treats it as local time → 6-hour shift for UTC-6 users. */
function toUtcIso(dt: string): string {
  if (!dt || !dt.includes('T')) return dt // all-day date-only strings — leave as-is
  if (/Z$/.test(dt) || /[+-]\d{2}:\d{2}$/.test(dt)) return dt // already has tz indicator
  return dt.replace(/(\.\d{3})\d+/, '$1') + 'Z' // trim to ms precision, append Z
}

function classifyEvent(
  item: {
    id: string
    summary?: string
    subject?: string // Outlook uses subject instead of summary
    start?: { dateTime?: string; date?: string }
    end?: { dateTime?: string; date?: string }
    attendees?: Array<{ email?: string; emailAddress?: { address?: string } }>
  },
  source: 'google' | 'outlook' = 'google'
): CalEvent {
  const title = item.summary ?? item.subject ?? tStatic('schedule.no_title')
  const lower = title.toLowerCase()
  let type: EventType = 'meeting'
  if (/focus|deep work|bloque|block/i.test(lower)) type = 'focus'
  else if (/lunch|almuerzo|gym|personal/i.test(lower)) type = 'personal'

  const attendees = item.attendees
    ?.map((a) => a.email ?? a.emailAddress?.address ?? '')
    .filter(Boolean)

  // Outlook datetimes are UTC without 'Z' → normalize so JS parses them as UTC
  const normDt = (dt: string | undefined): string | undefined =>
    source === 'outlook' && dt ? toUtcIso(dt) : dt

  const event: CalEvent = {
    id: item.id,
    title,
    start: normDt(item.start?.dateTime) ?? item.start?.date ?? '',
    end: normDt(item.end?.dateTime) ?? item.end?.date ?? '',
    type,
    attendees,
    source
  }

  // Classify priority: external attendees or 3+ attendees = critical
  const isExternal = attendees?.some((a) => !a.includes('@') || a.includes('.')) ?? false
  const hasManyAttendees = (attendees?.length ?? 0) >= 3
  const isCriticalKeyword =
    /client|cliente|board|legal|investor|review|demo|presentation|external|externo/i.test(title)
  event.priority = isExternal || hasManyAttendees || isCriticalKeyword ? 'critical' : 'flexible'

  return event
}

/** Assign side-by-side columns to overlapping events (like Outlook/Google Calendar).
 *  Each event gets colIndex (0-based) and colCount (# of concurrent columns in its group). */
function assignColumns(events: CalEvent[]): CalEvent[] {
  const result = events.map((e) => ({ ...e, colIndex: 0, colCount: 1 }))

  // Build a day → [result indices] map
  const dayMap = new Map<string, number[]>()
  result.forEach((e, i) => {
    if (!e.start.includes('T')) return
    const day = e.start.slice(0, 10)
    if (!dayMap.has(day)) dayMap.set(day, [])
    dayMap.get(day)!.push(i)
  })

  for (const indices of dayMap.values()) {
    if (indices.length <= 1) continue

    // Sort indices by start time
    const sorted = [...indices].sort(
      (a, b) => new Date(result[a].start).getTime() - new Date(result[b].start).getTime()
    )

    // Greedy column assignment: place each event in the first column where it doesn't overlap
    const colEndTimes: number[] = []
    const colAssign = new Map<number, number>()

    for (const idx of sorted) {
      const evStart = new Date(result[idx].start).getTime()
      const evEnd = new Date(result[idx].end).getTime()
      let placed = false
      for (let c = 0; c < colEndTimes.length; c++) {
        if (colEndTimes[c] <= evStart) {
          colEndTimes[c] = evEnd
          colAssign.set(idx, c)
          placed = true
          break
        }
      }
      if (!placed) {
        colAssign.set(idx, colEndTimes.length)
        colEndTimes.push(evEnd)
      }
    }

    // colCount per event = number of distinct columns that overlap with it
    for (const idx of indices) {
      const evStart = new Date(result[idx].start).getTime()
      const evEnd = new Date(result[idx].end).getTime()
      const overlapCols = new Set([colAssign.get(idx) ?? 0])
      for (const other of indices) {
        if (other === idx) continue
        const oStart = new Date(result[other].start).getTime()
        const oEnd = new Date(result[other].end).getTime()
        if (evStart < oEnd && oStart < evEnd) {
          overlapCols.add(colAssign.get(other) ?? 0)
        }
      }
      result[idx].colIndex = colAssign.get(idx) ?? 0
      result[idx].colCount = overlapCols.size
    }
  }

  return result
}

function detectConflicts(events: CalEvent[]): CalEvent[] {
  const result = events.map((e) => ({ ...e, hasConflict: false }))
  // Only check events with specific times (not all-day)
  for (let i = 0; i < result.length; i++) {
    if (!result[i].start.includes('T')) continue
    for (let j = i + 1; j < result.length; j++) {
      if (!result[j].start.includes('T')) continue
      if (!isSameDay(new Date(result[i].start), new Date(result[j].start))) continue
      const aStart = new Date(result[i].start).getTime()
      const aEnd = new Date(result[i].end).getTime()
      const bStart = new Date(result[j].start).getTime()
      const bEnd = new Date(result[j].end).getTime()
      if (aStart < bEnd && bStart < aEnd) {
        result[i].hasConflict = true
        result[j].hasConflict = true
      }
    }
  }
  return result
}

function eventStyle(event: CalEvent): React.CSSProperties {
  const s = new Date(event.start)
  const e = new Date(event.end)
  // top = minutes-offset WITHIN the hour cell (0–59px), not from the top of the whole day.
  // Events are rendered inside their start-hour cell; height overflows into subsequent cells.
  const topPx = (s.getMinutes() / 60) * HOUR_HEIGHT
  const startTotal = (s.getHours() - DAY_START_HOUR) * HOUR_HEIGHT + topPx
  const endTotal =
    (e.getHours() - DAY_START_HOUR) * HOUR_HEIGHT + (e.getMinutes() / 60) * HOUR_HEIGHT

  // Side-by-side columns for overlapping events (Outlook-style)
  const colCount = event.colCount ?? 1
  const colIndex = event.colIndex ?? 0
  const pct = 100 / colCount
  const gap = 2 // px gap between columns

  return {
    position: 'absolute',
    top: Math.max(0, topPx),
    height: Math.max(20, endTotal - startTotal),
    left: `calc(${colIndex * pct}% + ${gap}px)`,
    right: `calc(${(colCount - colIndex - 1) * pct}% + ${gap}px)`,
    zIndex: 5
  }
}

function nowLineTop(): number {
  const n = new Date()
  return (n.getHours() - DAY_START_HOUR) * HOUR_HEIGHT + (n.getMinutes() / 60) * HOUR_HEIGHT
}

function chipIconLabel(icon: string): string {
  if (icon === 'warn') return '⚠'
  if (icon === 'plus') return '+'
  if (icon === 'move') return '→'
  if (icon === 'send') return '↗'
  return '·'
}

/** Cheap content hash of today's events for cache invalidation.
 *  Changes when events are added, removed, or rescheduled. */
function hashTodayEvents(events: CalEvent[]): string {
  const today = startOfDay(new Date())
  const todayEvents = events
    .filter((e) => isSameDay(new Date(e.start), today))
    .map((e) => `${e.id}|${e.start}|${e.end}|${e.title}`)
    .sort()
    .join('\n')
  // Simple DJB2 hash — fast and sufficient for change detection
  let hash = 5381
  for (let i = 0; i < todayEvents.length; i++) {
    hash = ((hash << 5) + hash + todayEvents.charCodeAt(i)) | 0
  }
  return hash.toString(36)
}

// ── Main component ────────────────────────────────────────────────────────────

export function ScheduleView(): React.JSX.Element {
  const connectionState = useGatewayStore((s) => s.connectionState)
  const scheduleChatHistory = useAgentStore((s) => s.scheduleChatHistory)
  const setScheduleChatHistory = useAgentStore((s) => s.setScheduleChatHistory)
  const setScheduleReadCache = useAgentStore((s) => s.setScheduleReadCache)
  const emergencyStop = useAgentStore((s) => s.emergencyStop)
  const userTimezone = useSettingsStore((s) => s.userTimezone)
  const storeTools = useOnboardingStore((s) => s.connectedTools)

  // Which calendars are actually connected (load from Composio on mount)
  const [activeCalendars, setActiveCalendars] = useState<{ google: boolean; outlook: boolean }>({
    google: false,
    outlook: false
  })
  useEffect(() => {
    // Prefer live Composio data; fall back to onboarding store
    window.api.composio
      .getConnected()
      .then((slugs) => {
        const tools = normalizeComposioSlugs(slugs)
        setActiveCalendars({
          google: tools.includes('google-calendar'),
          outlook: tools.includes('outlook-calendar')
        })
      })
      .catch(() => {
        setActiveCalendars({
          google: storeTools.includes('google-calendar'),
          outlook: storeTools.includes('outlook-calendar')
        })
      })
  }, [storeTools])

  // Calendar state
  const [events, setEvents] = useState<CalEvent[]>([])
  const [loadingEvents, setLoadingEvents] = useState(false)
  const [calendarConnected, setCalendarConnected] = useState<boolean | null>(null)
  const [connectedSources, setConnectedSources] = useState<string[]>([])

  // 7-day week view — baseDate is Monday of the visible week
  const [baseDate, setBaseDate] = useState(() => {
    const d = startOfDay(new Date())
    const day = d.getDay() // 0=Sun
    const diff = day === 0 ? -6 : 1 - day // back to Monday
    return new Date(d.getTime() + diff * 86400000)
  })

  // Agent read
  const [scheduleRead, setScheduleRead] = useState<ScheduleRead | null>(null)
  const [generatingRead, setGeneratingRead] = useState(false)

  // Chat
  const [chatInput, setChatInput] = useState('')
  const [sending, setSending] = useState(false)

  // Proposed change
  const [pendingChange, setPendingChange] = useState<ProposedChange | null>(null)
  const [executing, setExecuting] = useState(false)

  // Session key refs to filter gateway events
  const pendingReadSessionRef = useRef<string | null>(null)
  const pendingChatSessionRef = useRef<string | null>(null)
  const chatEndRef = useRef<HTMLDivElement>(null)
  const timelineRef = useRef<HTMLDivElement>(null)

  // Now-line tick
  const [nowTop, setNowTop] = useState(() => nowLineTop())
  useEffect(() => {
    const id = setInterval(() => setNowTop(nowLineTop()), 60000)
    return () => clearInterval(id)
  }, [])

  // Scroll to current time on mount (2 hours above now-line)
  useEffect(() => {
    if (!timelineRef.current) return
    const offset = Math.max(0, nowLineTop() - 2 * HOUR_HEIGHT)
    timelineRef.current.scrollTop = offset
  }, [])

  // Auto-scroll chat
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [scheduleChatHistory, sending, executing])

  // ── Generate schedule read ──────────────────────────────────────────────────
  const generateScheduleRead = useCallback(
    async (loadedEvents: CalEvent[]) => {
      if (connectionState !== 'connected') return
      setScheduleRead(null)
      setGeneratingRead(true)
      const sessionKey = `agent:main:schedule-read-${crypto.randomUUID()}`
      pendingReadSessionRef.current = sessionKey

      const todayDate = startOfDay(new Date())
      const todayEvents = loadedEvents.filter((e) => isSameDay(new Date(e.start), todayDate))
      const conflicts = todayEvents.filter((e) => e.hasConflict)

      const todayEventsText =
        todayEvents
          .map((e) => {
            const tags = [
              e.source === 'outlook' ? 'Outlook' : 'Google',
              e.priority === 'critical' ? 'crítica' : 'flexible',
              e.hasConflict ? '⚠ conflicto' : null
            ]
              .filter(Boolean)
              .join(', ')
            return `  - ${formatTime(e.start)}–${formatTime(e.end)}: ${e.title} [${tags}]`
          })
          .join('\n') || '  (sin eventos hoy)'

      const conflictSection =
        conflicts.length > 0
          ? `\nCONFLICTOS DETECTADOS (${conflicts.length} eventos se superponen):\n` +
            conflicts
              .map((e) => `  - ${formatTime(e.start)}: ${e.title} (${e.priority})`)
              .join('\n') +
            `\n\nPrincipio de conciliación: haz UNA sola pregunta sobre cuál reunión el usuario considera inamovible antes de proponer cualquier cambio. Nunca encadenes más de un cambio de agenda sin confirmación intermedia.`
          : ''

      const prompt =
        `Analiza la agenda del usuario para hoy. Eres un asistente de productividad. Principios: observa antes de actuar, una pregunta a la vez, riesgo = reversibilidad × alcance.\n` +
        `Zona horaria: ${userTimezone}. Todas las horas son hora local.\n\n` +
        `Eventos de hoy (fuente, prioridad, conflicto):\n${todayEventsText}` +
        conflictSection +
        `\n\n` +
        `Responde SOLO con JSON válido (sin markdown):\n` +
        `{"message":"2-3 frases directas sobre el día. Si hay conflictos, menciónalos brevemente.",` +
        `"question":"Si hay conflictos, pregunta UNA cosa: cuál reunión es inamovible. Si no hay conflictos, null.",` +
        `"suggestedActions":[{"label":"Texto corto","icon":"warn|plus|move|send","risk":"low|mid|high","prompt":"Texto exacto que se envía al agente al hacer clic"}]}\n` +
        `Máximo 3 sugerencias enfocadas en productividad. Prioriza resolver conflictos si los hay.`

      try {
        await gatewayClient.rpc('chat.send', {
          sessionKey,
          message: prompt,
          idempotencyKey: sessionKey
        })
      } catch {
        setGeneratingRead(false)
        pendingReadSessionRef.current = null
      }
    },
    [connectionState, baseDate, userTimezone]
  )

  // ── Fetch calendar events ──────────────────────────────────────────────────
  // skipRead: when true, refresh calendar data without triggering LLM analysis
  // (used after chat actions where the user already has agent context)
  const fetchEvents = useCallback(
    async (opts?: { skipRead?: boolean }) => {
      if (connectionState !== 'connected') return
      setLoadingEvents(true)
      try {
        const timeMin = baseDate.toISOString()
        const timeMax = new Date(baseDate.getTime() + 7 * 86400000).toISOString()

        let allEvents: CalEvent[] = []
        const sources: string[] = []

        // Fetch Google Calendar events (only if connected)
        if (activeCalendars.google) {
          try {
            const googleResp = await window.api.composio.callTool('GOOGLECALENDAR_EVENTS_LIST', {
              calendarId: 'primary',
              timeMin,
              timeMax,
              maxResults: 50,
              singleEvents: true,
              orderBy: 'startTime'
            })
            if (googleResp.success) {
              sources.push('Google')
              const result = googleResp.result as {
                data?: { items?: unknown[] }
                items?: unknown[]
              }
              const items = (result.data?.items ?? result.items ?? []) as Parameters<
                typeof classifyEvent
              >[0][]
              allEvents = [...allEvents, ...items.map((item) => classifyEvent(item, 'google'))]
            }
          } catch {
            // Google Calendar unavailable
          }
        }

        // Fetch Outlook Calendar events (only if connected)
        if (activeCalendars.outlook) {
          try {
            const outlookResp = await window.api.composio.callTool('OUTLOOK_LIST_EVENTS', {
              timeMin,
              timeMax,
              top: 50
            })
            if (outlookResp.success) {
              sources.push('Outlook')
              const result = outlookResp.result as {
                data?: { value?: unknown[]; items?: unknown[] }
                value?: unknown[]
                items?: unknown[]
              }
              const items = (result.data?.value ??
                result.data?.items ??
                result.value ??
                result.items ??
                []) as Parameters<typeof classifyEvent>[0][]
              allEvents = [...allEvents, ...items.map((item) => classifyEvent(item, 'outlook'))]
            }
          } catch {
            // Outlook unavailable
          }
        }

        setConnectedSources(sources)
        setCalendarConnected(sources.length > 0)

        // Sort by start time and detect conflicts
        const sorted = allEvents.sort(
          (a, b) => new Date(a.start).getTime() - new Date(b.start).getTime()
        )
        const withConflicts = detectConflicts(sorted)
        const withColumns = assignColumns(withConflicts)
        setEvents(withColumns)

        if (opts?.skipRead) {
          // After chat actions: invalidate cache so next visit re-analyzes,
          // but don't call the LLM now (user already has agent context).
          const currentHash = hashTodayEvents(withColumns)
          const cache = useAgentStore.getState().scheduleReadCache
          if (cache && cache.eventsHash !== currentHash) {
            setScheduleReadCache({ ...cache, eventsHash: '' }) // force stale on next visit
          }
        } else {
          // Only call the LLM if the cache is stale (>4h) or today's events changed
          const currentHash = hashTodayEvents(withColumns)
          const cache = useAgentStore.getState().scheduleReadCache
          const cacheAge = cache ? Date.now() - cache.generatedAt : Infinity
          const eventsChanged = !cache || cache.eventsHash !== currentHash
          if (cacheAge > SCHEDULE_READ_CACHE_MS || eventsChanged) {
            void generateScheduleRead(withColumns)
          } else {
            // Restore from cache — no LLM call needed
            setScheduleRead({
              message: cache.message,
              question: cache.question,
              suggestedActions: cache.suggestedActions
            })
          }
        }
      } catch {
        // silent
      } finally {
        setLoadingEvents(false)
      }
    },
    [connectionState, baseDate, activeCalendars, generateScheduleRead, setScheduleReadCache]
  )

  useEffect(() => {
    void fetchEvents()
  }, [fetchEvents])

  // ── Gateway event listener ─────────────────────────────────────────────────
  useEffect(() => {
    const handler = (ev: OcEvent): void => {
      if (ev.event !== 'chat') return
      const payload = (ev.payload ?? {}) as Record<string, unknown>
      if (payload.state !== 'final') return
      const sk = payload.sessionKey as string
      const rawText = extractMessageText(
        payload.message as Parameters<typeof extractMessageText>[0]
      )
      const jsonMatch = rawText.match(/\{[\s\S]*\}/)

      // Schedule read response
      if (sk === pendingReadSessionRef.current) {
        pendingReadSessionRef.current = null
        setGeneratingRead(false)
        if (jsonMatch) {
          try {
            const parsed = JSON.parse(jsonMatch[0]) as ScheduleRead
            setScheduleRead(parsed)
            // Persist to cache so subsequent visits skip the LLM call
            setScheduleReadCache({
              message: parsed.message,
              question: parsed.question,
              suggestedActions: parsed.suggestedActions,
              generatedAt: Date.now(),
              eventsHash: hashTodayEvents(events)
            })
          } catch {
            // ignore parse error
          }
        }
        return
      }

      // Chat / confirm response
      if (sk === pendingChatSessionRef.current) {
        pendingChatSessionRef.current = null
        setSending(false)
        setExecuting(false)
        let text = rawText
        if (jsonMatch) {
          try {
            const p = JSON.parse(jsonMatch[0]) as {
              text?: string
              proposedChange?: Omit<ProposedChange, 'id'> | null
            }
            if (p.text) text = p.text
            if (p.proposedChange) {
              setPendingChange({ ...p.proposedChange, id: crypto.randomUUID() })
            }
          } catch {
            // use rawText
          }
        }
        const msg = { id: crypto.randomUUID(), role: 'assistant' as const, text }
        setScheduleChatHistory([...useAgentStore.getState().scheduleChatHistory, msg])
        // Refresh events (free) but skip LLM re-analysis — user already has agent context
        void fetchEvents({ skipRead: true })
      }
    }

    gatewayClient.on('*', handler)
    return () => gatewayClient.off('*', handler)
  }, [fetchEvents, setScheduleChatHistory])

  // ── Chat send ──────────────────────────────────────────────────────────────
  const handleSend = useCallback(
    async (text?: string) => {
      const userText = (text ?? chatInput).trim()
      if (!userText || sending || executing || connectionState !== 'connected') return
      setChatInput('')

      const userMsg = { id: crypto.randomUUID(), role: 'user' as const, text: userText }
      setScheduleChatHistory([...useAgentStore.getState().scheduleChatHistory, userMsg])
      setSending(true)

      const sessionKey = `agent:main:schedule-chat-${crypto.randomUUID()}`
      pendingChatSessionRef.current = sessionKey

      const weekContext = Array.from({ length: 7 }, (_, i) => {
        const day = new Date(baseDate.getTime() + i * 86400000)
        const label = day.toLocaleDateString('es', {
          weekday: 'long',
          day: 'numeric',
          month: 'long'
        })
        const dayEvts =
          events
            .filter((e) => isSameDay(new Date(e.start), day))
            .map((e) => `  - ${formatTime(e.start)}–${formatTime(e.end)}: ${e.title}`)
            .join('\n') || '  (sin eventos)'
        return `${label}:\n${dayEvts}`
      }).join('\n\n')

      const conflictsThisWeek = events.filter((e) => e.hasConflict)
      const conflictContext =
        conflictsThisWeek.length > 0
          ? `\nConflictos activos esta semana:\n` +
            conflictsThisWeek
              .map(
                (e) =>
                  `  - ${formatTime(e.start)}: ${e.title} (${e.source ?? 'google'}, ${e.priority ?? 'flexible'})`
              )
              .join('\n') +
            '\n'
          : ''

      const prompt =
        `Eres el asistente de agenda del usuario. Principios: una pregunta a la vez, nunca encadenes más de un cambio sin confirmación, confirma siempre antes de modificar el calendario.\n` +
        `Zona horaria: ${userTimezone}. Cuando el usuario dice una hora (ej. "1pm"), esa hora YA es hora local. Construye el datetime directo: 1pm → 13:00:00 con offset de ${userTimezone}. NUNCA interpretes la hora como UTC.\n\n` +
        `Agenda de la semana (Google Calendar + Outlook combinados):\n${weekContext}` +
        conflictContext +
        `\n` +
        `El usuario dice: "${userText}"\n\n` +
        `Responde SOLO con JSON válido (sin markdown):\n` +
        `{"text":"Tu respuesta en lenguaje claro. Si propones mover una reunión y hay conflicto, menciona el impacto.",` +
        `"proposedChange":{"title":"...","from":"hora actual legible","to":"nueva hora legible","risk":"low|mid|high","confirmationPrompt":"Texto exacto para ejecutar"}}\n` +
        `proposedChange SOLO si propones UN cambio concreto al calendario. Si no, usa null. Nunca propongas más de un cambio a la vez.`

      try {
        await gatewayClient.rpc('chat.send', {
          sessionKey,
          message: prompt,
          idempotencyKey: sessionKey
        })
      } catch {
        setSending(false)
        pendingChatSessionRef.current = null
      }
    },
    [
      chatInput,
      sending,
      executing,
      connectionState,
      events,
      baseDate,
      userTimezone,
      setScheduleChatHistory
    ]
  )

  // ── Proposed change: confirm/cancel ────────────────────────────────────────
  const handleConfirm = useCallback(async () => {
    if (!pendingChange || executing) return
    setExecuting(true)
    const change = pendingChange
    setPendingChange(null)

    const sessionKey = `agent:main:schedule-confirm-${crypto.randomUUID()}`
    pendingChatSessionRef.current = sessionKey

    const prompt =
      `El usuario confirmó el cambio propuesto. Ejecuta ahora:\n` +
      `"${change.confirmationPrompt}"\n\n` +
      `Zona horaria: ${userTimezone}. Todas las horas son hora local — al construir datetimes, usa la hora tal cual con el offset de ${userTimezone}.\n` +
      `Llama las herramientas de calendario necesarias.\n` +
      `Responde SOLO con JSON válido: {"text":"Confirmación breve de lo que ejecutaste."}`

    try {
      await gatewayClient.rpc('chat.send', {
        sessionKey,
        message: prompt,
        idempotencyKey: sessionKey
      })
    } catch {
      setExecuting(false)
      pendingChatSessionRef.current = null
    }
  }, [pendingChange, executing, userTimezone])

  // ── Inline reschedule suggestion from conflicting event ───────────────────
  const handleSuggestReschedule = useCallback(
    (conflictingEvent: CalEvent) => {
      const prompt =
        `Hay un conflicto en mi agenda con "${conflictingEvent.title}" ` +
        `(${formatTime(conflictingEvent.start)}–${formatTime(conflictingEvent.end)}). ` +
        `Revisa mi calendario completo (Google Calendar y Outlook) y propón cómo reorganizar ` +
        `este evento considerando las prioridades: reuniones con clientes o más de 3 personas son ` +
        `críticas e inamovibles, bloques de trabajo son flexibles.`
      void handleSend(prompt)
    },
    [handleSend]
  )

  // ── Navigation ─────────────────────────────────────────────────────────────
  const visibleDays = Array.from(
    { length: 7 },
    (_, i) => new Date(baseDate.getTime() + i * 86400000)
  )
  const today = startOfDay(new Date())

  function goToThisWeek(): void {
    const d = startOfDay(new Date())
    const day = d.getDay()
    const diff = day === 0 ? -6 : 1 - day
    setBaseDate(new Date(d.getTime() + diff * 86400000))
  }

  const DAY_NAMES = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb']
  const MONTH_NAMES = [
    'Ene',
    'Feb',
    'Mar',
    'Abr',
    'May',
    'Jun',
    'Jul',
    'Ago',
    'Sep',
    'Oct',
    'Nov',
    'Dic'
  ]

  function dayLabel(d: Date): string {
    return `${DAY_NAMES[d.getDay()]} ${d.getDate()} ${MONTH_NAMES[d.getMonth()]}`
  }

  const totalHeight = HOURS.length * HOUR_HEIGHT

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-1 overflow-hidden">
      {/* ══════════════════════════════ LEFT: TIMELINE ══════════════════════════════ */}
      <div className="flex flex-1 flex-col overflow-hidden border-r border-[#1f2024]">
        {/* Header */}
        <div className="flex shrink-0 items-start justify-between border-b border-[#1f2024] px-6 py-[18px]">
          <div>
            <p className="mb-1 font-mono text-[9px] uppercase tracking-[.12em] text-muted-foreground/40">
              {`${visibleDays[0].getDate()} ${MONTH_NAMES[visibleDays[0].getMonth()]} – ${visibleDays[6].getDate()} ${MONTH_NAMES[visibleDays[6].getMonth()]} ${visibleDays[6].getFullYear()}`}
              {' · '}
              {userTimezone}
            </p>
            <h2 className="text-[20px] font-light tracking-[-0.01em] text-foreground">
              {visibleDays.some((d) => isSameDay(d, today))
                ? 'Esta semana'
                : dayLabel(visibleDays[0])}
            </h2>
            <p className="mt-[3px] text-[12px] text-muted-foreground">
              {loadingEvents
                ? 'Cargando eventos…'
                : calendarConnected === false
                  ? 'Conecta Google Calendar u Outlook en Conexiones'
                  : (() => {
                      const todayEvts = events.filter((e) => isSameDay(new Date(e.start), today))
                      const conflictCount = todayEvts.filter((e) => e.hasConflict).length
                      const evtLabel =
                        todayEvts.length > 0
                          ? `${todayEvts.length} evento(s) hoy`
                          : `${events.length} evento(s) esta semana`
                      const sourceLabel =
                        connectedSources.length > 0 ? ` · ${connectedSources.join(' + ')}` : ''
                      return conflictCount > 0
                        ? `${evtLabel} · ${conflictCount} conflicto(s)${sourceLabel}`
                        : `${evtLabel}${sourceLabel}`
                    })()}
            </p>
          </div>
          <div className="flex items-center gap-[10px]">
            <button
              onClick={goToThisWeek}
              className="rounded border border-[#2a2b2f] px-[10px] py-[5px] font-mono text-[9px] uppercase tracking-[.06em] text-muted-foreground transition-colors hover:border-[#5b7cf6] hover:bg-[rgba(91,124,246,.12)] hover:text-[#5b7cf6]"
            >
              hoy
            </button>
            <button
              onClick={() => setBaseDate(new Date(baseDate.getTime() - 7 * 86400000))}
              className="flex h-7 w-7 items-center justify-center rounded border border-[#2a2b2f] text-muted-foreground transition-colors hover:border-muted-foreground hover:text-foreground"
            >
              <ChevronLeft className="h-3 w-3" />
            </button>
            <button
              onClick={() => setBaseDate(new Date(baseDate.getTime() + 7 * 86400000))}
              className="flex h-7 w-7 items-center justify-center rounded border border-[#2a2b2f] text-muted-foreground transition-colors hover:border-muted-foreground hover:text-foreground"
            >
              <ChevronRight className="h-3 w-3" />
            </button>
          </div>
        </div>

        {/* Day column headers */}
        <div
          className="grid shrink-0 border-b border-[#1f2024]"
          style={{ gridTemplateColumns: '48px repeat(7, 1fr)' }}
        >
          <div className="py-2" />
          {visibleDays.map((day) => {
            const isToday = isSameDay(day, today)
            return (
              <div key={day.toISOString()} className="border-l border-[#1f2024] px-4 py-2">
                <p
                  className={cn(
                    'font-mono text-[9px] uppercase tracking-[.1em]',
                    isToday ? 'text-[#5b7cf6]' : 'text-muted-foreground/40'
                  )}
                >
                  {DAY_NAMES[day.getDay()]}
                  {isToday ? ' · hoy' : ''}
                </p>
                <p
                  className={cn(
                    'text-[18px] font-light leading-[1.2]',
                    isToday ? 'text-[#5b7cf6]' : 'text-muted-foreground'
                  )}
                >
                  {day.getDate()}
                </p>
              </div>
            )
          })}
        </div>

        {/* Timeline body */}
        <div ref={timelineRef} className="flex-1 overflow-y-auto">
          <div
            className="grid"
            style={{ gridTemplateColumns: '48px repeat(7, 1fr)', minHeight: totalHeight }}
          >
            {HOURS.map((hour) => (
              <>
                {/* Time label */}
                <div
                  key={`label-${hour}`}
                  className="flex items-start px-2 pt-1"
                  style={{ height: HOUR_HEIGHT }}
                >
                  <span className="mt-[-1px] whitespace-nowrap font-mono text-[9px] text-muted-foreground/40">
                    {formatHour(hour)}
                  </span>
                </div>

                {/* Day grid cells */}
                {visibleDays.map((day) => {
                  const isToday = isSameDay(day, today)
                  const dayEvents = events.filter((e) => {
                    if (!e.start) return false
                    const s = new Date(e.start)
                    return isSameDay(s, day) && s.getHours() === hour
                  })

                  return (
                    <div
                      key={`${day.toISOString()}-${hour}`}
                      className={cn(
                        'relative border-l border-t border-[#1f2024]',
                        hour === DAY_START_HOUR && 'border-t-0'
                      )}
                      style={{ height: HOUR_HEIGHT }}
                    >
                      {/* Events in this hour */}
                      {dayEvents.map((event) => {
                        const durationMin =
                          (new Date(event.end).getTime() - new Date(event.start).getTime()) / 60000
                        const isShort = durationMin <= 45
                        return (
                          <div
                            key={event.id}
                            className={cn(
                              'absolute overflow-hidden rounded-[5px] px-2 transition-all hover:brightness-110',
                              isShort ? 'py-[3px]' : 'py-[6px]',
                              EVENT_TYPE_CLASSES[event.type],
                              event.hasConflict && 'ring-1 ring-[#e05c5c]/40'
                            )}
                            style={eventStyle(event)}
                          >
                            {isShort ? (
                              /* Compact single-line layout for short events */
                              <div className="flex items-center gap-[6px]">
                                <p className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-[11px] font-medium leading-none text-foreground">
                                  {event.title}
                                </p>
                                <span className="shrink-0 font-mono text-[9px] leading-none text-muted-foreground/50">
                                  {formatTime(event.start)}–{formatTime(event.end)}
                                </span>
                                {event.hasConflict && (
                                  <span className="shrink-0 font-mono text-[8px] text-[#e05c5c]">
                                    ⚠
                                  </span>
                                )}
                                {event.source === 'outlook' && (
                                  <span
                                    className="shrink-0 h-[6px] w-[6px] rounded-full bg-[#d4a843]"
                                    title="Outlook"
                                  />
                                )}
                              </div>
                            ) : (
                              /* Standard two-line layout for longer events */
                              <>
                                <div className="flex items-start gap-[4px]">
                                  <p className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-[11px] font-medium leading-[1.3] text-foreground">
                                    {event.title}
                                  </p>
                                  {event.hasConflict && (
                                    <span className="mt-[1px] shrink-0 font-mono text-[8px] text-[#e05c5c]">
                                      ⚠
                                    </span>
                                  )}
                                  {event.source === 'outlook' && (
                                    <span
                                      className="mt-[1px] shrink-0 h-[6px] w-[6px] rounded-full bg-[#d4a843]"
                                      title="Outlook"
                                    />
                                  )}
                                </div>
                                <p className="mt-[2px] font-mono text-[9px] text-muted-foreground/50">
                                  {formatTime(event.start)}–{formatTime(event.end)}
                                </p>
                                {event.flagNote && (
                                  <p className="mt-[3px] font-mono text-[8px] text-[#d4a843]">
                                    {event.flagNote}
                                  </p>
                                )}
                                {event.hasConflict && (
                                  <button
                                    onClick={(ev) => {
                                      ev.stopPropagation()
                                      handleSuggestReschedule(event)
                                    }}
                                    className="mt-[4px] font-mono text-[8px] text-[#e05c5c]/60 transition-colors hover:text-[#e05c5c]"
                                  >
                                    Reorganizar →
                                  </button>
                                )}
                              </>
                            )}
                          </div>
                        )
                      })}

                      {/* Now line — only in today's column */}
                      {isToday &&
                        nowTop >= (hour - DAY_START_HOUR) * HOUR_HEIGHT &&
                        nowTop < (hour - DAY_START_HOUR + 1) * HOUR_HEIGHT && (
                          <div
                            className="pointer-events-none absolute left-0 right-0 z-10"
                            style={{ top: nowTop - (hour - DAY_START_HOUR) * HOUR_HEIGHT }}
                          >
                            <div className="relative h-px bg-[#5b7cf6]">
                              <div className="absolute -left-[4px] -top-[3px] h-[7px] w-[7px] rounded-full bg-[#5b7cf6]" />
                            </div>
                          </div>
                        )}
                    </div>
                  )
                })}
              </>
            ))}
          </div>
        </div>
      </div>

      {/* ══════════════════════════════ RIGHT: AGENT PANEL ══════════════════════════════ */}
      <div className="flex w-80 shrink-0 flex-col bg-background">
        {/* Lectura del día */}
        <div className="shrink-0 border-b border-[#1f2024] px-[18px] py-[18px]">
          <p className="mb-2 font-mono text-[9px] uppercase tracking-[.1em] text-muted-foreground/40">
            Lectura del día
          </p>
          {generatingRead ? (
            <p className="text-[13px] font-light leading-[1.6] text-muted-foreground/50 animate-pulse">
              Analizando agenda…
            </p>
          ) : scheduleRead ? (
            <>
              <p className="text-[13.5px] font-light leading-[1.6] text-foreground">
                {scheduleRead.message}
              </p>
              {scheduleRead.question && (
                <p className="mt-[10px] border-l-2 border-[#2a2b2f] pl-[10px] text-[12px] italic leading-[1.5] text-muted-foreground">
                  {scheduleRead.question}
                </p>
              )}
            </>
          ) : connectionState !== 'connected' ? (
            <p className="text-[13px] font-light leading-[1.6] text-muted-foreground/50">
              Conectando al agente…
            </p>
          ) : (
            <p className="text-[13px] font-light leading-[1.6] text-muted-foreground/50">
              Sin lectura disponible.
            </p>
          )}
        </div>

        {/* Suggested actions */}
        {scheduleRead && scheduleRead.suggestedActions.length > 0 && (
          <div className="flex shrink-0 flex-col gap-[6px] border-b border-[#1f2024] px-[18px] py-3">
            {scheduleRead.suggestedActions.map((action, i) => (
              <button
                key={i}
                onClick={() => void handleSend(action.prompt)}
                disabled={sending || executing || connectionState !== 'connected'}
                className="flex items-center gap-2 rounded border border-[#2a2b2f] bg-[#151618] px-[10px] py-2 text-left text-[11.5px] text-muted-foreground transition-all hover:border-[#5b7cf6] hover:bg-[rgba(91,124,246,.12)] hover:text-foreground disabled:opacity-40"
              >
                <span
                  className={cn(
                    'flex h-[14px] w-[14px] shrink-0 items-center justify-center rounded-[3px] text-[10px]',
                    CHIP_ICON_CLASSES[action.icon] ?? ''
                  )}
                >
                  {chipIconLabel(action.icon)}
                </span>
                <span className="flex-1 leading-[1.3]">{action.label}</span>
                {action.risk !== 'low' && (
                  <span
                    className={cn(
                      'shrink-0 rounded-[2px] px-[5px] py-[1px] font-mono text-[8px]',
                      RISK_CLASSES[action.risk]
                    )}
                  >
                    {action.risk}
                  </span>
                )}
              </button>
            ))}
          </div>
        )}

        {/* Conversation */}
        <div className="flex flex-1 flex-col gap-[10px] overflow-y-auto px-[18px] py-[14px]">
          {scheduleChatHistory.length === 0 && !sending && !executing && (
            <p className="text-center text-[11px] text-muted-foreground/40">
              Pregunta sobre tu agenda o pide un cambio.
            </p>
          )}

          {scheduleChatHistory.map((msg) => (
            <div
              key={msg.id}
              className={cn(
                'flex flex-col gap-[3px]',
                msg.role === 'user' ? 'items-end' : 'items-start'
              )}
            >
              {/* Proposed change card rendered inline for assistant messages that precede a pending change */}
              {msg.role === 'assistant' &&
              pendingChange &&
              msg === scheduleChatHistory[scheduleChatHistory.length - 1] ? (
                <>
                  <div className="max-w-[240px] rounded-[10px_10px_10px_3px] border border-[#1f2024] bg-[#1c1d20] px-3 py-2 text-[12px] leading-[1.5] text-muted-foreground">
                    {msg.text}
                  </div>
                  <ProposedCard
                    change={pendingChange}
                    executing={executing}
                    onConfirm={() => void handleConfirm()}
                    onCancel={() => setPendingChange(null)}
                  />
                </>
              ) : (
                <div
                  className={cn(
                    'max-w-[240px] rounded-[10px] px-3 py-2 text-[12px] leading-[1.5]',
                    msg.role === 'user'
                      ? 'rounded-[10px_10px_3px_10px] bg-[#232428] text-foreground'
                      : 'rounded-[10px_10px_10px_3px] border border-[#1f2024] bg-[#1c1d20] text-muted-foreground'
                  )}
                >
                  {msg.text}
                </div>
              )}
            </div>
          ))}

          {/* Pending proposed card (no preceding message) */}
          {pendingChange && scheduleChatHistory.length === 0 && (
            <div className="flex flex-col items-start gap-[3px]">
              <ProposedCard
                change={pendingChange}
                executing={executing}
                onConfirm={() => void handleConfirm()}
                onCancel={() => setPendingChange(null)}
              />
            </div>
          )}

          {(sending || executing) && (
            <div className="flex justify-start">
              <div className="rounded-[10px_10px_10px_3px] border border-[#1f2024] bg-[#1c1d20] px-3 py-2">
                <span className="animate-pulse text-[11px] text-muted-foreground/50">
                  {executing ? 'ejecutando…' : 'pensando…'}
                </span>
              </div>
            </div>
          )}

          <div ref={chatEndRef} />
        </div>

        {/* Input */}
        <div className="shrink-0 border-t border-[#1f2024] px-4 py-3">
          <div className="flex items-center gap-2 rounded-lg border border-[#2a2b2f] bg-[#151618] px-3 py-2 transition-colors focus-within:border-[#5b7cf6]/50">
            <input
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  void handleSend()
                }
              }}
              placeholder='"Mueve mi reunion a las 2 PM al lunes"'
              disabled={sending || executing || connectionState !== 'connected'}
              className="flex-1 bg-transparent text-[12.5px] text-foreground outline-none placeholder:text-muted-foreground/40 disabled:opacity-50"
            />
            <button
              onClick={() => void handleSend()}
              disabled={
                !chatInput.trim() || sending || executing || connectionState !== 'connected'
              }
              className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded bg-[#5b7cf6] transition-opacity hover:opacity-85 disabled:opacity-40"
            >
              <ArrowUp className="h-3 w-3 text-white" />
            </button>
          </div>
        </div>

        {/* Emergency */}
        <div className="flex shrink-0 items-center justify-between border-t border-[#1f2024] px-4 py-2">
          <button
            onClick={emergencyStop}
            className="flex items-center gap-[6px] rounded border border-[rgba(224,92,92,.3)] px-[10px] py-[5px] font-mono text-[9px] tracking-[.06em] text-[#e05c5c] transition-all hover:border-[#e05c5c] hover:bg-[rgba(224,92,92,.1)]"
          >
            <Square className="h-[9px] w-[9px] fill-current" />
            Parar agente
          </button>
          <span className="font-mono text-[9px] text-muted-foreground/30">OpenClaw · local</span>
        </div>
      </div>
    </div>
  )
}

// ── Proposed change card ──────────────────────────────────────────────────────

interface ProposedCardProps {
  change: ProposedChange
  executing: boolean
  onConfirm: () => void
  onCancel: () => void
}

function ProposedCard({
  change,
  executing,
  onConfirm,
  onCancel
}: ProposedCardProps): React.JSX.Element {
  return (
    <div className="max-w-[260px] rounded-lg border border-[#2a2b2f] bg-[#151618] px-3 py-[10px]">
      <p className="mb-[6px] font-mono text-[8px] uppercase tracking-[.08em] text-[#5b7cf6]">
        Cambio propuesto · {change.risk}-risk
      </p>
      <p className="mb-2 text-[11.5px] leading-[1.5] text-muted-foreground">
        Actualizar <strong className="font-medium text-foreground">{change.title}</strong>
      </p>
      <p className="font-mono text-[10px] text-muted-foreground/50 line-through">{change.from}</p>
      <p className="font-mono text-[10px] text-[#4caf82]">{change.to}</p>
      <div className="mt-[10px] flex gap-[6px]">
        <button
          onClick={onConfirm}
          disabled={executing}
          className="flex-1 rounded bg-[#5b7cf6] py-[5px] text-[11px] font-medium text-white disabled:opacity-50"
        >
          {executing ? 'Ejecutando…' : 'Confirmar'}
        </button>
        <button
          onClick={onCancel}
          disabled={executing}
          className="rounded border border-[#2a2b2f] px-[10px] py-[5px] text-[11px] text-muted-foreground/50 transition-colors hover:border-[#e05c5c] hover:text-[#e05c5c] disabled:opacity-40"
        >
          Cancelar
        </button>
      </div>
    </div>
  )
}
