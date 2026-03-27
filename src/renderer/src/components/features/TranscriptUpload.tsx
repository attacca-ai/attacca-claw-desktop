import { useState, useRef, useEffect, useCallback } from 'react'
import { useSettingsStore } from '@/stores/settings-store'
import { gatewayClient } from '@/lib/gateway-client'
import { useGatewayStore } from '@/stores/gateway-store'
import type { OcEvent } from '@/types/gateway'
import { Upload, FileText, Clipboard, Check, RefreshCw, Clock } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { extractMessageText } from '@/lib/utils'

// ── Local types ──────────────────────────────────────────────────────────────

type ViewState = 'drop' | 'processing' | 'review'
type DraftType = 'calendar' | 'task' | 'email' | 'flag'
type DraftStatus = 'pending' | 'approved' | 'discarded'
type TagStyle = 'tool' | 'risk-mid' | 'risk-high' | 'owner' | 'note'

interface DraftTag {
  label: string
  style: TagStyle
}

interface DraftItem {
  id: string
  type: DraftType
  title: string
  description: string
  detail?: string
  tags: DraftTag[]
  status: DraftStatus
  flagged?: boolean
  primaryLabel: string
  executionPrompt: string
}

interface TranscriptResult {
  meetingName: string
  duration?: string
  wordCount?: number
  agentReading: string
  agentQuestion?: string | null
  attendees?: Array<{ initials: string; name: string; role: string }>
  actionCounts?: {
    mine: number
    others: number
    deliverables: number
    emails: number
    flags: number
  }
  items: Omit<DraftItem, 'status'>[]
}

interface RecentEntry {
  id: string
  name: string
  date: string
  status: 'done' | 'review'
  result?: TranscriptResult
  drafts?: DraftItem[]
}

// ── Style maps ───────────────────────────────────────────────────────────────

const TAG_CLASSES: Record<TagStyle, string> = {
  tool: 'bg-[#232428] text-[#4a4d55]',
  'risk-mid': 'bg-[rgba(212,168,67,.1)] text-[#d4a843]',
  'risk-high': 'bg-[rgba(224,92,92,.1)] text-[#e05c5c]',
  owner: 'bg-[rgba(91,124,246,.12)] text-[#5b7cf6]',
  note: 'bg-[rgba(212,168,67,.1)] text-[#d4a843]'
}

const SECTION_ICON_CLASSES: Record<DraftType, string> = {
  calendar: 'bg-[rgba(91,124,246,.12)] text-[#5b7cf6]',
  task: 'bg-[rgba(76,175,130,.1)] text-[#4caf82]',
  email: 'bg-[rgba(155,114,245,.12)] text-[#9b72f5]',
  flag: 'bg-[rgba(212,168,67,.1)] text-[#d4a843]'
}

const SECTION_LABELS: Record<DraftType, string> = {
  calendar: 'Calendar',
  task: 'Tasks',
  email: 'Emails',
  flag: 'Flags'
}

const SECTION_ICONS: Record<DraftType, string> = {
  calendar: '📅',
  task: '✓',
  email: '✉',
  flag: '⚑'
}

const STEPS = [
  'Transcript read and cleaned',
  'Participants and roles identified',
  'Extracting commitments and deliverables',
  'Preparing follow-up drafts',
  'Structuring for review'
]

const SUPPORTED_TYPES = ['.txt', '.md', '.docx', '.pdf', '.vtt', '.srt']

const DRAFT_ORDER: DraftType[] = ['calendar', 'task', 'email', 'flag']

// ── StateBar ─────────────────────────────────────────────────────────────────

interface StateBarProps {
  viewState: ViewState
  hasResult: boolean
  onNavigate: (s: ViewState) => void
}

function StateBar({ viewState, hasResult, onNavigate }: StateBarProps): React.JSX.Element {
  const btnBase =
    'px-2.5 py-1 rounded border font-mono text-[9px] uppercase tracking-[.06em] transition-all duration-[120ms] cursor-pointer'
  const btnActive = 'bg-[#5b7cf6] border-[#5b7cf6] text-white'
  const btnInactive =
    'border-[#2a2b2f] bg-transparent text-[#4a4d55] hover:border-[#5b7cf6] hover:text-[#5b7cf6]'
  const btnDisabled = 'border-[#2a2b2f] bg-transparent text-[#2a2b2f] cursor-default'

  return (
    <div
      className="fixed bottom-4 right-4 z-[999] flex items-center gap-1.5 rounded-lg border border-[#2a2b2f] bg-[#232428] p-2"
      style={{ boxShadow: '0 4px 16px rgba(0,0,0,.4)' }}
    >
      <span className="font-mono text-[8px] uppercase text-[#4a4d55]">State:</span>
      <button
        onClick={() => onNavigate('drop')}
        className={`${btnBase} ${viewState === 'drop' ? btnActive : btnInactive}`}
      >
        1 · Drop
      </button>
      <button
        disabled
        className={`${btnBase} ${viewState === 'processing' ? btnActive : btnDisabled}`}
      >
        2 · Processing
      </button>
      <button
        onClick={() => hasResult && onNavigate('review')}
        disabled={!hasResult}
        className={`${btnBase} ${
          viewState === 'review' ? btnActive : hasResult ? btnInactive : btnDisabled
        }`}
      >
        3 · Review
      </button>
    </div>
  )
}

// ── DraftCard ────────────────────────────────────────────────────────────────

interface DraftCardProps {
  item: DraftItem
  executing: boolean
  onAction: (item: DraftItem, action: 'approve' | 'discard') => Promise<void>
}

function DraftCard({ item, executing, onAction }: DraftCardProps): React.JSX.Element {
  const approved = item.status === 'approved'
  return (
    <div
      className={`rounded-md border bg-[#151618] p-4 transition-opacity ${
        item.flagged ? 'border-l-2 border-[#2a2b2f] border-l-[#d4a843]' : 'border-[#2a2b2f]'
      } ${approved ? 'opacity-50' : ''}`}
    >
      <div className="mb-1 text-sm font-medium text-foreground">{item.title}</div>
      <div className="mb-2 text-xs leading-relaxed text-[#7a7d85]">{item.description}</div>
      {item.detail && (
        <div className="mb-2 rounded bg-[#1c1d20] px-2 py-1.5 text-xs text-[#7a7d85]">
          {item.detail}
        </div>
      )}
      <div className="mb-3 flex flex-wrap gap-1">
        {item.tags.map((tag, i) => (
          <span key={i} className={`rounded px-1.5 py-0.5 text-[10px] ${TAG_CLASSES[tag.style]}`}>
            {tag.label}
          </span>
        ))}
      </div>
      {approved ? (
        <div className="flex items-center gap-1.5 text-xs text-[#4caf82]">
          <Check className="h-3 w-3" strokeWidth={2.5} />
          Approved
        </div>
      ) : (
        <div className="flex gap-2">
          <button
            onClick={() => void onAction(item, 'approve')}
            disabled={executing}
            className="flex items-center gap-1.5 rounded bg-[rgba(91,124,246,.12)] px-2.5 py-1.5 text-xs text-[#5b7cf6] transition-colors hover:bg-[rgba(91,124,246,.2)] disabled:opacity-50"
          >
            {executing && <RefreshCw className="h-3 w-3 animate-spin" />}
            {item.primaryLabel}
          </button>
          <button
            onClick={() => void onAction(item, 'discard')}
            disabled={executing}
            className="rounded px-2.5 py-1.5 text-xs text-[#4a4d55] transition-colors hover:bg-[#1c1d20] hover:text-[#e05c5c] disabled:opacity-50"
          >
            Discard
          </button>
        </div>
      )}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

interface TranscriptUploadProps {
  embedded?: boolean
}

export function TranscriptUpload({ embedded = false }: TranscriptUploadProps): React.JSX.Element {
  const connectionState = useGatewayStore((s) => s.connectionState)
  const folderWatchEnabled = useSettingsStore((s) => s.folderWatchEnabled)
  const folderWatchPath = useSettingsStore((s) => s.folderWatchPath)

  // View state
  const [viewState, setViewState] = useState<ViewState>('drop')

  // Drop state
  const [meetingName, setMeetingName] = useState('')
  const [notes, setNotes] = useState('')
  const [dragOver, setDragOver] = useState(false)
  const [pasteMode, setPasteMode] = useState(false)
  const [pasteText, setPasteText] = useState('')
  const [fileName, setFileName] = useState('')

  // Processing state
  const [processingStep, setProcessingStep] = useState(0)

  // Review state
  const [result, setResult] = useState<TranscriptResult | null>(null)
  const [drafts, setDrafts] = useState<DraftItem[]>([])
  const [executingId, setExecutingId] = useState<string | null>(null)

  // Recents (localStorage)
  const [recents, setRecents] = useState<RecentEntry[]>(() => {
    try {
      return JSON.parse(localStorage.getItem('attacca:transcripts:recent') ?? '[]') as RecentEntry[]
    } catch {
      return []
    }
  })

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const pendingSessionRef = useRef<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  // Use a ref so the gateway listener doesn't need fileName in its dep array
  const fileNameRef = useRef<string>('')
  const meetingNameRef = useRef<string>('')

  // Keep refs in sync
  fileNameRef.current = fileName
  meetingNameRef.current = meetingName

  // Timer cleanup on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [])

  // Sync draft status changes to localStorage recents
  useEffect(() => {
    if (drafts.length === 0) return
    setRecents((prev) => {
      const updated = prev.map((r) => {
        if (r.drafts && r.result === result) {
          return {
            ...r,
            drafts,
            status: drafts.every((d) => d.status !== 'pending')
              ? ('done' as const)
              : ('review' as const)
          }
        }
        return r
      })
      localStorage.setItem('attacca:transcripts:recent', JSON.stringify(updated))
      return updated
    })
  }, [drafts, result])

  // Gateway listener — registered once
  useEffect(() => {
    const handler = (ev: OcEvent): void => {
      if (ev.event !== 'chat') return
      const payload = (ev.payload ?? {}) as Record<string, unknown>
      if (payload.state !== 'final' || payload.sessionKey !== pendingSessionRef.current) return

      pendingSessionRef.current = null
      if (timerRef.current) {
        clearInterval(timerRef.current)
        timerRef.current = null
      }
      setProcessingStep(STEPS.length) // All steps done

      const rawText = extractMessageText(
        payload.message as Parameters<typeof extractMessageText>[0]
      )
      const jsonMatch = rawText.match(/\{[\s\S]*\}/)

      if (jsonMatch) {
        try {
          const parsed = JSON.parse(jsonMatch[0]) as TranscriptResult
          const draftItems = parsed.items.map((item) => ({
            ...item,
            status: 'pending' as DraftStatus
          }))
          setResult(parsed)
          setDrafts(draftItems)
          const entry: RecentEntry = {
            id: crypto.randomUUID(),
            name: parsed.meetingName || fileNameRef.current,
            date: new Date().toLocaleDateString('en', {
              weekday: 'short',
              day: 'numeric',
              month: 'short'
            }),
            status: 'review',
            result: parsed,
            drafts: draftItems
          }
          setRecents((prev) => {
            const updated = [entry, ...prev].slice(0, 10)
            localStorage.setItem('attacca:transcripts:recent', JSON.stringify(updated))
            return updated
          })

          // Persist to KB/RAG (non-blocking)
          const meetingTitle = parsed.meetingName || meetingNameRef.current || fileNameRef.current
          const attendeeNames = (parsed.attendees ?? []).map((a) => a.name)
          const taskItems = parsed.items
            .filter((i) => i.type === 'task' || i.type === 'calendar')
            .map((i) => ({ text: i.title, owner: undefined }))
          window.api.kb
            .saveCapture({
              id: entry.id,
              sourceType: 'transcript',
              title: meetingTitle,
              content: fileNameRef.current,
              result: {
                summary: parsed.agentReading,
                actionItems: taskItems,
                decisions: parsed.items.filter((i) => i.type === 'flag').map((i) => i.title),
                openQuestions: parsed.agentQuestion ? [parsed.agentQuestion] : [],
                keyPoints: parsed.items.map((i) => i.title),
                entities: {
                  people: attendeeNames,
                  projects: [meetingTitle].filter(Boolean),
                  dates: []
                }
              },
              timestamp: Date.now()
            })
            .catch(() => {
              /* KB write failure is non-fatal */
            })

          // Save each draft item to memory DB individually
          for (const item of parsed.items) {
            window.api.memory
              .save({
                content: `[${meetingTitle}] ${item.title}: ${item.description}${item.detail ? ` — ${item.detail}` : ''}`,
                type: item.type === 'flag' ? 'decision' : 'capture',
                summary: `${item.type}: ${item.title} (${meetingTitle})`,
                tags: [
                  `transcript:${entry.id}`,
                  `draft:${item.type}`,
                  ...attendeeNames.map((n) => `person:${n}`)
                ],
                importance: item.type === 'flag' ? 0.7 : 0.5,
                source_id: entry.id
              })
              .catch(() => {
                /* non-fatal */
              })
          }

          setTimeout(() => setViewState('review'), 600)
        } catch {
          setViewState('drop')
        }
      } else {
        setViewState('drop')
      }
    }

    gatewayClient.on('*', handler)
    return () => gatewayClient.off('*', handler)
  }, [])

  // Start processing a transcript
  const startProcessing = useCallback(
    async (content: string, name: string): Promise<void> => {
      setFileName(name)
      setViewState('processing')
      setProcessingStep(0)

      // Synthetic animation: advance one step every 5s, capped at STEPS.length-1
      timerRef.current = setInterval(() => {
        setProcessingStep((prev) => Math.min(prev + 1, STEPS.length - 1))
      }, 5000)

      if (connectionState !== 'connected') {
        clearInterval(timerRef.current)
        timerRef.current = null
        setViewState('drop')
        return
      }

      const sessionKey = `agent:main:transcript-${crypto.randomUUID()}`
      pendingSessionRef.current = sessionKey

      const prompt = `Analyze the following meeting transcript. Context: name="${meetingName}", notes="${notes}".

Return ONLY valid JSON:
{
  "meetingName": "...",
  "duration": "N min",
  "wordCount": N,
  "agentReading": "2-3 direct sentences summarizing the meeting",
  "agentQuestion": "a clarifying question or null",
  "attendees": [{"initials":"AB","name":"...","role":"..."}],
  "actionCounts": {"mine":N,"others":N,"deliverables":N,"emails":N,"flags":N},
  "items": [{
    "id":"uid","type":"calendar|task|email|flag",
    "title":"...","description":"...","detail":"...|null",
    "tags":[{"label":"...","style":"tool|risk-mid|risk-high|owner|note"}],
    "primaryLabel":"Confirm|Create task|Review and send|Add context",
    "executionPrompt":"concrete instruction to execute using tools"
  }]
}

Type rules:
- calendar: create/modify event in Google Calendar (with attendees → mid/high-risk)
- task: create task in PM tool (Trello/ClickUp/Asana)
- email: email draft (always high-risk · send)
- flag: attention point with no automatic action, requires human judgment

Transcript:
${content}`

      try {
        await gatewayClient.rpc('chat.send', {
          sessionKey,
          message: prompt,
          idempotencyKey: sessionKey
        })
      } catch {
        pendingSessionRef.current = null
        if (timerRef.current) {
          clearInterval(timerRef.current)
          timerRef.current = null
        }
        setViewState('drop')
      }
    },
    [connectionState, meetingName, notes]
  )

  const handleDrop = useCallback(
    async (e: React.DragEvent): Promise<void> => {
      e.preventDefault()
      setDragOver(false)
      const files = Array.from(e.dataTransfer.files)
      for (const file of files) {
        const ext = '.' + file.name.split('.').pop()?.toLowerCase()
        if (!SUPPORTED_TYPES.includes(ext)) continue
        const content = await file.text()
        await startProcessing(content, file.name)
        break
      }
    },
    [startProcessing]
  )

  const handleFileSelect = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>): Promise<void> => {
      const file = e.target.files?.[0]
      if (!file) return
      const content = await file.text()
      await startProcessing(content, file.name)
      e.target.value = ''
    },
    [startProcessing]
  )

  const handlePasteSubmit = useCallback(async (): Promise<void> => {
    if (!pasteText.trim()) return
    await startProcessing(pasteText.trim(), 'pasted transcript')
    setPasteText('')
    setPasteMode(false)
  }, [pasteText, startProcessing])

  const handleItemAction = useCallback(
    async (item: DraftItem, action: 'approve' | 'discard'): Promise<void> => {
      if (action === 'discard') {
        setDrafts((prev) => prev.map((d) => (d.id === item.id ? { ...d, status: 'discarded' } : d)))
        return
      }
      setExecutingId(item.id)
      const sessionKey = `agent:main:transcript-exec-${crypto.randomUUID()}`
      const prompt =
        `Execute this transcript action:\n"${item.executionPrompt}"\n` +
        `Use tools (Google Calendar, Gmail, ClickUp, etc.).\n` +
        `Respond ONLY with JSON: {"text":"Brief confirmation."}`
      try {
        await gatewayClient.rpc('chat.send', {
          sessionKey,
          message: prompt,
          idempotencyKey: sessionKey
        })
        setDrafts((prev) => prev.map((d) => (d.id === item.id ? { ...d, status: 'approved' } : d)))

        // Record the approved action as a decision in the memory DB
        const meetingTitle = result?.meetingName || meetingNameRef.current || fileNameRef.current
        window.api.memory
          .save({
            content: `Approved transcript action: ${item.title} — ${item.description}`,
            type: 'decision',
            summary: `Executed: ${item.title} (${meetingTitle})`,
            tags: [`draft:${item.type}`, `action:approved`],
            importance: 0.6
          })
          .catch(() => {
            /* non-fatal */
          })
      } catch {
        // no-op: leave item as pending
      } finally {
        setExecutingId(null)
      }
    },
    []
  )

  const handleApproveAll = useCallback((): void => {
    drafts
      .filter((d) => d.status === 'pending')
      .forEach((item) => void handleItemAction(item, 'approve'))
  }, [drafts, handleItemAction])

  function handleRecentClick(entry: RecentEntry): void {
    if (!entry.result) return
    const d: DraftItem[] =
      entry.drafts ??
      entry.result.items.map((item) => ({ ...item, status: 'pending' as DraftStatus }))
    setResult(entry.result)
    setDrafts(d)
    setFileName(entry.name)
    setViewState('review')
  }

  function handleStateNavigate(s: ViewState): void {
    if (s === 'drop') {
      if (timerRef.current) {
        clearInterval(timerRef.current)
        timerRef.current = null
      }
      pendingSessionRef.current = null
      setViewState('drop')
    } else if (s === 'review') {
      if (result) {
        setViewState('review')
      } else {
        const latest = recents.find((r) => r.result)
        if (latest) handleRecentClick(latest)
      }
    }
  }

  // Grouped draft items for review (discarded items hidden)
  const grouped = DRAFT_ORDER.map((type) => ({
    type,
    items: drafts.filter((d) => d.type === type && d.status !== 'discarded')
  })).filter((g) => g.items.length > 0)

  // ── STATE 1: DROP ───────────────────────────────────────────────────────────

  if (viewState === 'drop') {
    return (
      <div className="flex h-full overflow-hidden">
        <StateBar
          viewState={viewState}
          hasResult={!!result || recents.some((r) => !!r.result)}
          onNavigate={handleStateNavigate}
        />
        {/* Left panel */}
        <div
          className={`flex flex-1 flex-col overflow-y-auto ${embedded ? 'px-6 pb-6 pt-0' : 'p-8'}`}
        >
          {!embedded && (
            <>
              <div className="mb-1 text-xs font-medium uppercase tracking-[0.08em] text-[#4a4d55]">
                Transcripts
              </div>
              <div className="mb-2 text-2xl font-semibold text-foreground">New meeting</div>
              <p className="mb-6 text-sm leading-relaxed text-[#7a7d85]">
                Finish the meeting, drop the transcript and <em>go do whatever you need to do</em>.
                The agent processes everything and has drafts ready when you come back.
              </p>
            </>
          )}

          {/* Context frame */}
          <div className="mb-6 rounded-md border border-[#2a2b2f] bg-[#151618] p-4">
            <div className="mb-3 text-xs text-[#4a4d55]">Context for the agent</div>
            <div className="mb-3">
              <div className="mb-1 text-xs text-[#7a7d85]">
                What was the meeting called? <span className="text-[#e05c5c]">*</span>
              </div>
              <input
                type="text"
                value={meetingName}
                onChange={(e) => setMeetingName(e.target.value)}
                placeholder="e.g. Client kickoff / Product sync / 1:1 with Pedro"
                className="w-full rounded border border-[#2a2b2f] bg-[#1c1d20] px-3 py-2 text-sm text-foreground placeholder:text-[#4a4d55] focus:outline-none focus:ring-1 focus:ring-[#5b7cf6]"
              />
            </div>
            <div>
              <div className="mb-1 text-xs text-[#7a7d85]">
                Anything the agent should know before processing?
              </div>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="e.g. This was a new client meeting. I'm responsible for the proposal."
                rows={3}
                className="w-full resize-none rounded border border-[#2a2b2f] bg-[#1c1d20] px-3 py-2 text-sm text-foreground placeholder:text-[#4a4d55] focus:outline-none focus:ring-1 focus:ring-[#5b7cf6]"
              />
              <div className="mt-1 text-xs text-[#4a4d55]">
                The agent uses this to decide what belongs to you vs. others.
              </div>
            </div>
          </div>

          {/* Drop zone */}
          <div
            onDragOver={(e) => {
              if (!meetingName.trim()) return
              e.preventDefault()
              setDragOver(true)
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              if (!meetingName.trim()) return
              void handleDrop(e)
            }}
            className={`flex flex-col items-center justify-center gap-3 rounded-md border-2 border-dashed py-10 transition-colors ${
              !meetingName.trim()
                ? 'border-[#2a2b2f] opacity-40 cursor-not-allowed'
                : dragOver
                  ? 'border-[#5b7cf6] bg-[rgba(91,124,246,.05)]'
                  : 'border-[#2a2b2f] hover:border-[#4a4d55]'
            }`}
          >
            <div className="flex h-9 w-9 items-center justify-center rounded-md bg-[#1c1d20] text-[#4a4d55]">
              <Upload className="h-5 w-5" />
            </div>
            <div className="text-sm font-medium text-[#7a7d85]">Drop transcript file here</div>
            <div className="text-xs text-[#4a4d55]">{SUPPORTED_TYPES.join(' · ')}</div>
          </div>

          {/* Separator */}
          <div className="my-5 flex items-center gap-3">
            <div className="h-px flex-1 bg-[#1f2024]" />
            <div className="text-xs tracking-[0.08em] text-[#4a4d55]">OR</div>
            <div className="h-px flex-1 bg-[#1f2024]" />
          </div>

          {/* Paste button */}
          <button
            onClick={() => meetingName.trim() && setPasteMode(!pasteMode)}
            disabled={!meetingName.trim()}
            className="flex items-center gap-2 self-start rounded border border-[#2a2b2f] bg-[#151618] px-3 py-2 text-sm text-[#7a7d85] transition-colors hover:border-[#4a4d55] hover:text-foreground disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:border-[#2a2b2f] disabled:hover:text-[#7a7d85]"
          >
            <Clipboard className="h-3.5 w-3.5" />
            Paste transcript text
          </button>

          {/* Paste textarea */}
          {pasteMode && (
            <div className="mt-3 flex flex-col gap-2">
              <textarea
                value={pasteText}
                onChange={(e) => setPasteText(e.target.value)}
                placeholder="Paste your transcript here..."
                rows={8}
                className="w-full resize-y rounded border border-[#2a2b2f] bg-[#1c1d20] px-3 py-2 text-sm text-foreground placeholder:text-[#4a4d55] focus:outline-none focus:ring-1 focus:ring-[#5b7cf6]"
              />
              <div className="flex justify-end gap-2">
                <Button variant="ghost" size="sm" onClick={() => setPasteMode(false)}>
                  Cancel
                </Button>
                <Button size="sm" onClick={handlePasteSubmit} disabled={!pasteText.trim()}>
                  Process transcript
                </Button>
              </div>
            </div>
          )}

          {/* Browse button (hidden input) */}
          <div className="mt-3">
            <input
              ref={fileInputRef}
              type="file"
              accept={SUPPORTED_TYPES.join(',')}
              onChange={handleFileSelect}
              className="hidden"
            />
            <button
              onClick={() => meetingName.trim() && fileInputRef.current?.click()}
              disabled={!meetingName.trim()}
              className="flex items-center gap-2 rounded border border-[#2a2b2f] bg-[#151618] px-3 py-2 text-sm text-[#7a7d85] transition-colors hover:border-[#4a4d55] hover:text-foreground disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:border-[#2a2b2f] disabled:hover:text-[#7a7d85]"
            >
              <FileText className="h-3.5 w-3.5" />
              Browse files
            </button>
          </div>
        </div>

        {/* Right sidebar */}
        {!embedded && (
          <div className="flex w-60 shrink-0 flex-col border-l border-[#1f2024] p-5">
            <div className="mb-3 text-[10px] font-medium uppercase tracking-[0.08em] text-[#4a4d55]">
              Recent transcripts
            </div>
            {recents.length === 0 ? (
              <div className="text-xs text-[#4a4d55]">No transcripts yet.</div>
            ) : (
              <div className="flex flex-col gap-0.5">
                {recents.map((r) => (
                  <div
                    key={r.id}
                    onClick={() => handleRecentClick(r)}
                    className={`rounded px-2 py-2 transition-colors ${r.result ? 'cursor-pointer hover:bg-[#1c1d20]' : 'cursor-default opacity-40'}`}
                  >
                    <div className="mb-1 text-xs font-medium text-foreground">{r.name}</div>
                    <div className="flex items-center gap-2 text-[10px] text-[#4a4d55]">
                      <span>{r.date}</span>
                      <span
                        className={`rounded px-1.5 py-0.5 ${
                          r.status === 'done'
                            ? 'bg-[rgba(76,175,130,.1)] text-[#4caf82]'
                            : 'bg-[rgba(212,168,67,.1)] text-[#d4a843]'
                        }`}
                      >
                        {r.status === 'done' ? 'processed' : 'in review'}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {folderWatchEnabled && folderWatchPath && (
              <div className="mt-4 rounded border border-[#2a2b2f] bg-[#151618] p-3">
                <div className="mb-1 text-[10px] font-medium uppercase tracking-[0.08em] text-[#4a4d55]">
                  Watched folder
                </div>
                <div className="mb-1 font-mono text-[11px] text-[#5b7cf6]">{folderWatchPath}</div>
                <div className="text-[11px] text-[#4a4d55]">
                  New files in this folder are processed automatically.
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    )
  }

  // ── STATE 2: PROCESSING ──────────────────────────────────────────────────────

  if (viewState === 'processing') {
    const pct = Math.round((processingStep / STEPS.length) * 100)
    const stepLabel =
      processingStep < STEPS.length
        ? STEPS[processingStep].toLowerCase()
        : STEPS[STEPS.length - 1].toLowerCase()

    return (
      <div
        className={`flex h-full flex-col overflow-y-auto ${embedded ? 'px-6 pb-6 pt-0' : 'p-8'}`}
      >
        <StateBar
          viewState={viewState}
          hasResult={!!result || recents.some((r) => !!r.result)}
          onNavigate={handleStateNavigate}
        />
        {!embedded && (
          <>
            <div className="mb-1 text-xs font-medium uppercase tracking-[0.08em] text-[#4a4d55]">
              Transcripts · processing
            </div>
            <div className="mb-5 text-2xl font-semibold text-foreground">Agent is on it</div>
          </>
        )}

        {/* File card */}
        <div className="mb-5 flex items-center gap-3 rounded-md border border-[#2a2b2f] bg-[#151618] p-4">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded bg-[#1c1d20] text-[#4a4d55]">
            <FileText className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium text-foreground">{fileName}</div>
            {meetingName && <div className="truncate text-xs text-[#7a7d85]">{meetingName}</div>}
          </div>
          <div className="flex shrink-0 items-center gap-1.5 rounded border border-[#2a2b2f] px-2 py-1 text-xs text-[#7a7d85]">
            <div className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#5b7cf6]" />
            processing
          </div>
        </div>

        {/* Progress bar */}
        <div className="mb-5">
          <div className="mb-2 h-1 overflow-hidden rounded-full bg-[#1c1d20]">
            <div
              className="h-full rounded-full bg-[#5b7cf6] transition-all duration-500"
              style={{ width: `${pct}%` }}
            />
          </div>
          <div className="text-xs text-[#7a7d85]">
            Step {Math.min(processingStep + 1, STEPS.length)} of {STEPS.length} · {stepLabel}
          </div>
        </div>

        {/* Feed */}
        <div className="mb-2 text-[10px] font-medium uppercase tracking-[0.08em] text-[#4a4d55]">
          What the agent is doing
        </div>
        <div className="mb-6 flex flex-col gap-3">
          {STEPS.map((step, i) => {
            const done = i < processingStep
            const active = i === processingStep && processingStep < STEPS.length
            return (
              <div key={i} className="flex items-start gap-3">
                <div
                  className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${
                    done
                      ? 'bg-[rgba(76,175,130,.1)] text-[#4caf82]'
                      : active
                        ? 'bg-[rgba(91,124,246,.12)] text-[#5b7cf6]'
                        : 'bg-[#1c1d20] text-[#4a4d55]'
                  }`}
                >
                  {done ? (
                    <Check className="h-3 w-3" strokeWidth={2.5} />
                  ) : active ? (
                    <RefreshCw className="h-3 w-3 animate-spin" />
                  ) : (
                    <Clock className="h-3 w-3" />
                  )}
                </div>
                <div className={`text-sm ${done || active ? 'text-foreground' : 'text-[#4a4d55]'}`}>
                  {step}
                </div>
              </div>
            )
          })}
        </div>

        {/* Away note */}
        <div className="flex items-start gap-3 rounded-md border border-[#2a2b2f] bg-[#151618] p-4">
          <Clock className="mt-0.5 h-4 w-4 shrink-0 text-[#4a4d55]" />
          <div className="text-sm text-[#7a7d85]">
            <strong className="text-foreground">You can leave.</strong> When you're done with
            whatever you need to do, come back to Transcripts. Everything will be ready for you to
            review and approve — you don't need to wait here.
          </div>
        </div>
      </div>
    )
  }

  // ── STATE 3: REVIEW ──────────────────────────────────────────────────────────

  const r = result!
  const counts = r.actionCounts

  return (
    <div className="flex h-full overflow-hidden">
      <StateBar
        viewState={viewState}
        hasResult={!!result || recents.some((r) => !!r.result)}
        onNavigate={handleStateNavigate}
      />
      {/* Main panel */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Header */}
        <div className="shrink-0 border-b border-[#1f2024] px-6 pb-4 pt-6">
          <div className="mb-4 flex items-start justify-between gap-4">
            <div>
              <div className="mb-1 flex items-center gap-2">
                <div className="flex items-center gap-1.5 rounded border border-[rgba(76,175,130,.3)] bg-[rgba(76,175,130,.08)] px-2 py-0.5 text-xs text-[#4caf82]">
                  <Check className="h-2.5 w-2.5" strokeWidth={2.5} />
                  ready for review
                </div>
              </div>
              <div className="text-xl font-semibold text-foreground">
                {r.meetingName || fileName}
              </div>
              {(r.duration ?? r.wordCount) && (
                <div className="mt-0.5 text-xs text-[#4a4d55]">
                  {[r.duration, r.wordCount ? `${r.wordCount.toLocaleString()} words` : null]
                    .filter(Boolean)
                    .join(' · ')}
                </div>
              )}
            </div>
            <button
              onClick={handleApproveAll}
              className="shrink-0 rounded border border-[#2a2b2f] bg-[#151618] px-3 py-1.5 text-sm text-foreground transition-colors hover:border-[#5b7cf6] hover:text-[#5b7cf6]"
            >
              Approve all
            </button>
          </div>

          {/* Stats row */}
          {counts && (
            <div className="flex flex-wrap gap-4">
              {counts.mine > 0 && (
                <div className="flex items-center gap-1.5 text-xs text-[#7a7d85]">
                  <div className="h-1.5 w-1.5 rounded-full bg-[#4caf82]" />
                  {counts.mine} tasks
                </div>
              )}
              {counts.deliverables > 0 && (
                <div className="flex items-center gap-1.5 text-xs text-[#7a7d85]">
                  <div className="h-1.5 w-1.5 rounded-full bg-[#5b7cf6]" />
                  {counts.deliverables} events
                </div>
              )}
              {counts.emails > 0 && (
                <div className="flex items-center gap-1.5 text-xs text-[#7a7d85]">
                  <div className="h-1.5 w-1.5 rounded-full bg-[#9b72f5]" />
                  {counts.emails} emails
                </div>
              )}
              {counts.flags > 0 && (
                <div className="flex items-center gap-1.5 text-xs text-[#7a7d85]">
                  <div className="h-1.5 w-1.5 rounded-full bg-[#d4a843]" />
                  {counts.flags} flags
                </div>
              )}
            </div>
          )}
        </div>

        {/* Draft cards */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {grouped.map(({ type, items }) => (
            <div key={type} className="mb-7">
              {/* Section header */}
              <div className="mb-3 flex items-center gap-2">
                <div
                  className={`flex h-6 w-6 items-center justify-center rounded text-xs ${SECTION_ICON_CLASSES[type]}`}
                >
                  {SECTION_ICONS[type]}
                </div>
                <div className="text-sm font-medium text-foreground">{SECTION_LABELS[type]}</div>
                <span className="rounded bg-[#1c1d20] px-1.5 py-0.5 text-xs text-[#7a7d85]">
                  {items.length}
                </span>
              </div>

              {/* Cards */}
              <div className="flex flex-col gap-2">
                {items.map((item) => (
                  <DraftCard
                    key={item.id}
                    item={item}
                    executing={executingId === item.id}
                    onAction={handleItemAction}
                  />
                ))}
              </div>
            </div>
          ))}

          <button
            onClick={() => {
              setViewState('drop')
              setResult(null)
              setDrafts([])
            }}
            className="mb-4 text-xs text-[#4a4d55] hover:text-[#7a7d85]"
          >
            ← Process another transcript
          </button>
        </div>
      </div>

      {/* Aside */}
      <div className="flex w-72 shrink-0 flex-col gap-4 overflow-y-auto border-l border-[#1f2024] p-5">
        {/* Agent reading */}
        <div>
          <div className="mb-2 text-[10px] font-medium uppercase tracking-[0.08em] text-[#4a4d55]">
            Agent reading
          </div>
          <div className="text-sm leading-relaxed text-[#7a7d85]">{r.agentReading}</div>
          {r.agentQuestion && (
            <div className="mt-2 rounded border border-[#2a2b2f] bg-[#151618] p-2 text-xs text-[#7a7d85]">
              {r.agentQuestion}
            </div>
          )}
        </div>

        <div className="h-px bg-[#1f2024]" />

        {/* Attendees */}
        {r.attendees && r.attendees.length > 0 && (
          <>
            <div>
              <div className="mb-2 text-[10px] font-medium uppercase tracking-[0.08em] text-[#4a4d55]">
                Attendees
              </div>
              <div className="flex flex-col gap-2">
                {r.attendees.map((a, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded bg-[#1c1d20] font-mono text-[10px] text-[#4a4d55]">
                      {a.initials}
                    </div>
                    <div>
                      <div className="text-xs text-foreground">{a.name}</div>
                      <div className="text-[10px] text-[#4a4d55]">{a.role}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="h-px bg-[#1f2024]" />
          </>
        )}

        {/* Action counts */}
        {counts && (
          <div>
            <div className="mb-2 text-[10px] font-medium uppercase tracking-[0.08em] text-[#4a4d55]">
              Action summary
            </div>
            <div className="flex flex-col gap-1.5">
              {counts.mine > 0 && (
                <div className="flex justify-between text-xs">
                  <span className="text-[#7a7d85]">Yours</span>
                  <span className="text-foreground">{counts.mine} tasks</span>
                </div>
              )}
              {counts.others > 0 && (
                <div className="flex justify-between text-xs">
                  <span className="text-[#7a7d85]">Others (tracking)</span>
                  <span className="text-foreground">{counts.others} tasks</span>
                </div>
              )}
              {counts.deliverables > 0 && (
                <div className="flex justify-between text-xs">
                  <span className="text-[#7a7d85]">Deliverables</span>
                  <span className="text-foreground">{counts.deliverables} drafts</span>
                </div>
              )}
              {counts.emails > 0 && (
                <div className="flex justify-between text-xs">
                  <span className="text-[#7a7d85]">Outgoing emails</span>
                  <span className="text-foreground">{counts.emails} (high-risk)</span>
                </div>
              )}
              {counts.flags > 0 && (
                <div className="flex justify-between text-xs">
                  <span className="text-[#7a7d85]">Open flags</span>
                  <span className="text-foreground">{counts.flags}</span>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
