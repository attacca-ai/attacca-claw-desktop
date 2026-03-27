import { useState, useRef, useEffect, useCallback } from 'react'
import { gatewayClient } from '@/lib/gateway-client'
import { useGatewayStore } from '@/stores/gateway-store'
import { useAgentStore, type LibraryEntry } from '@/stores/agent-store'
import { extractMessageText } from '@/lib/utils'
import type { OcEvent } from '@/types/gateway'
import { Send, RefreshCw, Check, Play, Zap, Copy, Eye, EyeOff, ArrowLeft } from 'lucide-react'

// ── Local types ───────────────────────────────────────────────────────────────

type ConvoState = 'empty' | 'clarifying' | 'ready'

interface WfMessage {
  id: string
  role: 'user' | 'agent'
  text: string
  time: string
  htmlContent?: string // extracted from html code block in agent response
}

interface ClarifyOption {
  key: string
  text: string
}

interface ClarifyCard {
  label: string
  question: string
  why?: string
  options: ClarifyOption[]
}

interface WfStep {
  num: number
  action: string
  detail?: string
  tags: Array<{ label: string; style: 'tool' | 'mid' | 'high' | 'low' }>
  pending?: boolean
}

interface WfAmbiguity {
  aspect: string
  text: string
}

interface ToolBadge {
  label: string
  dot: 'cal' | 'email' | 'task' | 'slack' | 'default'
}

interface WorkflowDefinition {
  name: string
  description: string
  triggerText: string
  steps: WfStep[]
  ambiguities: WfAmbiguity[]
  tools: ToolBadge[]
  confidence: number
}

interface AgentResponse {
  message: string
  state: 'clarifying' | 'ready'
  clarifyingQuestion: ClarifyCard | null
  workflow: WorkflowDefinition | null
  ready: boolean
}

// ── Style constants ───────────────────────────────────────────────────────────

const STEP_TAG_CLASSES: Record<string, string> = {
  tool: 'bg-[#232428] text-[#4a4d55]',
  mid: 'bg-[rgba(212,168,67,.1)] text-[#d4a843]',
  high: 'bg-[rgba(224,92,92,.1)] text-[#e05c5c]',
  low: 'bg-[rgba(76,175,130,.1)] text-[#4caf82]'
}

const TOOL_DOT_CLASSES: Record<string, string> = {
  cal: 'bg-[#5b7cf6]',
  email: 'bg-[#9b72f5]',
  task: 'bg-[#4caf82]',
  slack: 'bg-[#4a154b]',
  default: 'bg-[#4a4d55]'
}

const EXAMPLE_ICON_CLASSES: Record<string, string> = {
  blue: 'bg-[rgba(91,124,246,.12)] text-[#5b7cf6]',
  green: 'bg-[rgba(76,175,130,.1)] text-[#4caf82]',
  yellow: 'bg-[rgba(212,168,67,.1)] text-[#d4a843]',
  purple: 'bg-[rgba(155,114,245,.12)] text-[#9b72f5]'
}

const EXAMPLES = [
  {
    icon: '📅',
    color: 'blue',
    title: 'Meeting invitations.',
    text: 'When someone sends me a meeting invite by email, check my calendar, accept if available, and alert if there is a conflict.'
  },
  {
    icon: '👤',
    color: 'green',
    title: 'Recruiting pipeline.',
    text: 'After every candidate interview, update their status in the tracking sheet, remind me to send feedback to HR, and block decision time on my calendar.'
  },
  {
    icon: '📋',
    color: 'yellow',
    title: 'Weekly review.',
    text: 'Every Monday, give me a summary of last week: completed tasks, pending items, and suggested priorities for this week.'
  },
  {
    icon: '✉',
    color: 'purple',
    title: 'Reply triage.',
    text: 'When a client replies to one of my emails, classify it as urgent or not, and notify me via Telegram if urgent.'
  }
]

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildAgentPrompt(history: WfMessage[], userText: string): string {
  const historyText = history
    .slice(0, -1)
    .map((m) => `${m.role === 'user' ? 'User' : 'Agent'}: ${m.text}`)
    .join('\n')

  return `You are a workflow assistant. The user is describing a workflow they want their AI agent to automate.

${historyText ? `Conversation so far:\n${historyText}\n\n` : ''}New user message: "${userText}"

Respond ONLY with valid JSON:
{
  "message": "Your response text (1-3 sentences, natural language)",
  "state": "clarifying|ready",
  "clarifyingQuestion": {
    "label": "Question N of M · aspect",
    "question": "...",
    "why": "Why this matters for the workflow",
    "options": [{"key":"A","text":"..."},{"key":"B","text":"..."},{"key":"C","text":"..."}]
  },
  "workflow": {
    "name": "Short workflow name",
    "description": "1-2 sentence description",
    "triggerText": "What triggers this workflow",
    "steps": [
      {"num":1,"action":"Step description","detail":"More detail","tags":[{"label":"Google Calendar","style":"tool"},{"label":"mid-risk","style":"mid"}],"pending":false}
    ],
    "ambiguities": [{"aspect":"Trigger:","text":"What exactly triggers this?"}],
    "tools": [{"label":"Gmail","dot":"email"},{"label":"Google Calendar","dot":"cal"}],
    "confidence": 75
  },
  "ready": false
}

Rules:
- clarifyingQuestion must be null (not omitted) when not asking a question
- workflow must be null (not omitted) when not yet defined
- Ask ONE clarifying question at a time if something is ambiguous
- "ready" is true only when no ambiguities remain and confidence >= 90
- When ready=true, set clarifyingQuestion to null and ambiguities to []
- Steps with unresolved info have "pending": true
- dot values: "cal" (Google Calendar), "email" (Gmail), "task" (Sheets/ClickUp/Trello), "slack" (Slack), "default" (other)
- Start building the workflow definition from the very first message`
}

function buildRunPrompt(entry: LibraryEntry, userText: string): string {
  return `Execute the workflow named "${entry.name}".
${entry.description ? `Workflow description: ${entry.description}` : ''}

User input to process:
${userText}

Complete all the steps of this workflow using available tools (Gmail, Google Calendar, Google Sheets, Slack, ClickUp, etc.).
Respond in plain text describing what you did.
If you generate an email template, HTML document, or any HTML output, wrap it in a code block like this:

\`\`\`html
[your html here]
\`\`\`

Be concise and clear about what was done.`
}

// Extract HTML from a ```html ... ``` code block, returns null if none
function extractHtmlBlock(text: string): string | null {
  const match = text.match(/```html\s*([\s\S]*?)```/)
  return match ? match[1].trim() : null
}

// Strip the html code block from a message text for display
function stripHtmlBlock(text: string): string {
  return text.replace(/```html\s*[\s\S]*?```/, '').trim()
}

// ── Main component ────────────────────────────────────────────────────────────

export function WorkflowAdder(): React.JSX.Element {
  const connectionState = useGatewayStore((s) => s.connectionState)
  const addActivity = useAgentStore((s) => s.addActivity)

  // Workflow building state
  const [convoState, setConvoState] = useState<ConvoState>('empty')
  const [messages, setMessages] = useState<WfMessage[]>([])
  const [clarifyCard, setClarifyCard] = useState<ClarifyCard | null>(null)
  const [workflow, setWorkflow] = useState<WorkflowDefinition | null>(null)
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [activating, setActivating] = useState(false)
  const [activated, setActivated] = useState(false)
  const [selectedOption, setSelectedOption] = useState<string | null>(null)

  // Run mode state
  const [runEntry, setRunEntry] = useState<LibraryEntry | null>(null)
  const [runMessages, setRunMessages] = useState<WfMessage[]>([])
  const [runInput, setRunInput] = useState('')
  const [runSending, setRunSending] = useState(false)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [previewId, setPreviewId] = useState<string | null>(null)

  // Library (DB-backed via agent store)
  const library = useAgentStore((s) => s.workflowLibrary)
  const addWorkflow = useAgentStore((s) => s.addWorkflow)
  const updateWorkflowRuns = useAgentStore((s) => s.updateWorkflowRuns)

  const pendingSessionRef = useRef<string | null>(null)
  const pendingRunRef = useRef<string | null>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const runBodyRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Auto-scroll
  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight
  }, [messages, clarifyCard])

  useEffect(() => {
    if (runBodyRef.current) runBodyRef.current.scrollTop = runBodyRef.current.scrollHeight
  }, [runMessages])

  // Gateway listener — handles both building and run sessions
  useEffect(() => {
    const handler = (ev: OcEvent): void => {
      if (ev.event !== 'chat') return
      const payload = (ev.payload ?? {}) as Record<string, unknown>
      if (payload.state !== 'final') return

      const sessionKey = payload.sessionKey as string | undefined

      // ── Run session response ──
      if (sessionKey && sessionKey === pendingRunRef.current) {
        pendingRunRef.current = null
        setRunSending(false)

        const rawText = extractMessageText(
          payload.message as Parameters<typeof extractMessageText>[0]
        )

        const htmlContent = extractHtmlBlock(rawText) ?? undefined
        const displayText = htmlContent ? stripHtmlBlock(rawText) : rawText

        setRunMessages((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            role: 'agent',
            text: displayText || 'Done.',
            time: new Date().toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' }),
            htmlContent
          }
        ])

        // Increment run counter for this entry
        if (runEntry?.name) {
          updateWorkflowRuns(runEntry.name)
        }
        return
      }

      // ── Workflow building session response ──
      if (sessionKey !== pendingSessionRef.current) return
      pendingSessionRef.current = null
      setSending(false)

      const rawText = extractMessageText(
        payload.message as Parameters<typeof extractMessageText>[0]
      )
      const jsonMatch = rawText.match(/\{[\s\S]*\}/)
      if (!jsonMatch) return

      try {
        const parsed = JSON.parse(jsonMatch[0]) as AgentResponse

        setMessages((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            role: 'agent',
            text: parsed.message,
            time: new Date().toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' })
          }
        ])

        if (parsed.workflow) setWorkflow(parsed.workflow)
        setClarifyCard(parsed.clarifyingQuestion ?? null)
        setSelectedOption(null)

        if (parsed.ready) {
          setConvoState('ready')
          setClarifyCard(null)
        } else {
          setConvoState('clarifying')
        }
      } catch {
        /* no-op */
      }
    }

    gatewayClient.on('*', handler)
    return () => gatewayClient.off('*', handler)
  }, [runEntry])

  // ── Handlers ─────────────────────────────────────────────────────────────

  const handleSend = useCallback(
    async (text?: string): Promise<void> => {
      const msg = (text ?? input).trim()
      if (!msg || sending || connectionState !== 'connected') return

      const now = new Date().toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' })
      const userMsg: WfMessage = { id: crypto.randomUUID(), role: 'user', text: msg, time: now }

      setMessages((prev) => {
        const updated = [...prev, userMsg]
        const sessionKey = `agent:main:workflow-${crypto.randomUUID()}`
        pendingSessionRef.current = sessionKey
        setSending(true)
        if (convoState === 'empty') setConvoState('clarifying')
        setInput('')

        const prompt = buildAgentPrompt(updated, msg)
        void gatewayClient
          .rpc('chat.send', { sessionKey, message: prompt, idempotencyKey: sessionKey })
          .catch(() => {
            setSending(false)
            pendingSessionRef.current = null
          })

        return updated
      })
    },
    [input, sending, connectionState, convoState]
  )

  const handleRunExecute = useCallback(
    async (text?: string): Promise<void> => {
      if (!runEntry) return
      const msg = (text ?? runInput).trim()
      if (!msg || runSending || connectionState !== 'connected') return

      const now = new Date().toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' })
      setRunMessages((prev) => [
        ...prev,
        { id: crypto.randomUUID(), role: 'user', text: msg, time: now }
      ])
      setRunInput('')
      setRunSending(true)

      const sessionKey = `agent:main:workflow-run-${crypto.randomUUID()}`
      pendingRunRef.current = sessionKey

      const prompt = buildRunPrompt(runEntry, msg)
      try {
        await gatewayClient.rpc('chat.send', {
          sessionKey,
          message: prompt,
          idempotencyKey: sessionKey
        })
        window.api.telemetry.emit('workflow.run', { workflowName: runEntry.name })
      } catch {
        setRunSending(false)
        pendingRunRef.current = null
      }
    },
    [runEntry, runInput, runSending, connectionState]
  )

  const handleActivate = useCallback(async (): Promise<void> => {
    if (!workflow || activating || activated) return
    setActivating(true)

    try {
      await gatewayClient.rpc('skill.create', {
        name: workflow.name,
        description: workflow.description
      })
    } catch {
      /* best-effort */
    }

    const entry: LibraryEntry = {
      id: crypto.randomUUID(),
      name: workflow.name,
      description: workflow.description,
      status: 'active',
      runs: 0
    }
    addWorkflow(entry)

    addActivity({ type: 'info', description: `Workflow activated: ${workflow.name}` })
    window.api.telemetry.emit('workflow.created', { workflowName: workflow.name })
    setActivated(true)
    setActivating(false)
  }, [workflow, activating, activated, addActivity, addWorkflow])

  function handleCopy(id: string, text: string): void {
    void navigator.clipboard.writeText(text).then(() => {
      setCopiedId(id)
      setTimeout(() => setCopiedId(null), 2000)
    })
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>): void {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void handleSend()
    }
  }

  function handleRunKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>): void {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void handleRunExecute()
    }
  }

  function handleTextareaInput(e: React.ChangeEvent<HTMLTextAreaElement>): void {
    setInput(e.target.value)
    const el = e.target
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 80) + 'px'
  }

  function handleRunTextareaInput(e: React.ChangeEvent<HTMLTextAreaElement>): void {
    setRunInput(e.target.value)
    const el = e.target
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 80) + 'px'
  }

  // Preview status
  const previewStatus = !workflow
    ? { label: 'Waiting...', cls: 'bg-[#232428] text-[#4a4d55]' }
    : convoState === 'ready'
      ? { label: 'Ready to activate', cls: 'bg-[rgba(76,175,130,.1)] text-[#4caf82]' }
      : { label: 'Building...', cls: 'bg-[rgba(91,124,246,.12)] text-[#5b7cf6]' }

  const activeCount = library.filter((e) => e.status === 'active').length

  // ── RENDER ────────────────────────────────────────────────────────────────

  return (
    <div className="flex h-full overflow-hidden">
      {/* ── LEFT: CONVERSATION / RUN PANEL ── */}
      <div className="flex flex-1 flex-col overflow-hidden border-r border-[#1f2024]">
        {runEntry ? (
          /* ═══ RUN MODE ═══ */
          <>
            {/* Run header */}
            <div className="shrink-0 border-b border-[#1f2024] px-7 pb-4 pt-5">
              <button
                onClick={() => {
                  setRunEntry(null)
                  setRunMessages([])
                  setRunInput('')
                }}
                className="mb-2 flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-[.1em] text-[#4a4d55] transition-colors hover:text-[#7a7d85]"
              >
                <ArrowLeft className="h-3 w-3" />
                Back to workflows
              </button>
              <div className="mb-0.5 flex items-center gap-2">
                <div className="h-1.5 w-1.5 rounded-full bg-[#4caf82] shadow-[0_0_4px_#4caf82]" />
                <div className="font-mono text-[9px] uppercase tracking-[.1em] text-[#4a4d55]">
                  Running workflow
                </div>
              </div>
              <div
                className="text-xl font-light text-foreground"
                style={{ letterSpacing: '-.01em' }}
              >
                {runEntry.name}
              </div>
              {runEntry.description && (
                <div className="mt-1 max-w-[480px] text-[12px] text-[#7a7d85]">
                  {runEntry.description}
                </div>
              )}
            </div>

            {/* Run messages */}
            <div
              ref={runBodyRef}
              className="flex flex-1 flex-col gap-4 overflow-y-auto px-7 py-5"
              style={{ scrollbarWidth: 'thin', scrollbarColor: '#2a2b2f transparent' }}
            >
              {runMessages.length === 0 && (
                <div className="text-[13px] leading-relaxed text-[#7a7d85]">
                  Paste the text you want to process, or describe what to run.
                </div>
              )}

              {runMessages.map((msg) => {
                const isUser = msg.role === 'user'
                return (
                  <div
                    key={msg.id}
                    className={`flex flex-col gap-1 ${isUser ? 'items-end' : 'items-start'}`}
                  >
                    {msg.text && (
                      <div
                        className={`max-w-[420px] rounded-[10px] px-3.5 py-2.5 text-[12.5px] leading-[1.55] ${
                          isUser
                            ? 'rounded-br-[3px] bg-[#232428] text-foreground'
                            : 'rounded-bl-[3px] border border-[#1f2024] bg-[#1c1d20] text-[#7a7d85]'
                        }`}
                      >
                        {msg.text}
                      </div>
                    )}
                    <div className="px-1 font-mono text-[8.5px] text-[#4a4d55]">{msg.time}</div>

                    {/* HTML output block */}
                    {msg.htmlContent && (
                      <div className="w-full max-w-[560px] overflow-hidden rounded-lg border border-[#2a2b2f] bg-[#151618]">
                        {/* Block header */}
                        <div className="flex items-center justify-between border-b border-[#1f2024] px-3 py-2">
                          <span className="font-mono text-[9px] uppercase tracking-[.1em] text-[#4a4d55]">
                            HTML output
                          </span>
                          <div className="flex items-center gap-1.5">
                            <button
                              onClick={() => setPreviewId(previewId === msg.id ? null : msg.id)}
                              className="flex items-center gap-1 rounded px-2 py-1 font-mono text-[9px] text-[#4a4d55] transition-colors hover:bg-[#1c1d20] hover:text-[#7a7d85]"
                            >
                              {previewId === msg.id ? (
                                <EyeOff className="h-3 w-3" />
                              ) : (
                                <Eye className="h-3 w-3" />
                              )}
                              {previewId === msg.id ? 'Code' : 'Preview'}
                            </button>
                            <button
                              onClick={() => handleCopy(msg.id, msg.htmlContent!)}
                              className="flex items-center gap-1 rounded px-2 py-1 font-mono text-[9px] text-[#4a4d55] transition-colors hover:bg-[#1c1d20] hover:text-[#7a7d85]"
                            >
                              {copiedId === msg.id ? (
                                <Check className="h-3 w-3 text-[#4caf82]" />
                              ) : (
                                <Copy className="h-3 w-3" />
                              )}
                              {copiedId === msg.id ? 'Copied' : 'Copy'}
                            </button>
                          </div>
                        </div>

                        {/* Code view */}
                        {previewId !== msg.id && (
                          <pre
                            className="max-h-[300px] overflow-auto px-3 py-3 font-mono text-[11px] leading-relaxed text-[#7a7d85]"
                            style={{
                              scrollbarWidth: 'thin',
                              scrollbarColor: '#2a2b2f transparent'
                            }}
                          >
                            {msg.htmlContent}
                          </pre>
                        )}

                        {/* Preview (rendered) */}
                        {previewId === msg.id && (
                          <iframe
                            srcDoc={msg.htmlContent}
                            sandbox="allow-same-origin"
                            className="h-[300px] w-full border-0 bg-white"
                            title="HTML preview"
                          />
                        )}
                      </div>
                    )}
                  </div>
                )
              })}

              {runSending && (
                <div className="flex items-center gap-2 text-[12px] text-[#4a4d55]">
                  <RefreshCw className="h-3 w-3 animate-spin" />
                  <span>Running workflow...</span>
                </div>
              )}
            </div>

            {/* Run input */}
            <div className="shrink-0 border-t border-[#1f2024] px-5 py-3">
              <div className="flex items-end gap-2 rounded-lg border border-[#2a2b2f] bg-[#151618] px-3 py-2.5 transition-colors focus-within:border-[#5b7cf6]">
                <textarea
                  value={runInput}
                  onChange={handleRunTextareaInput}
                  onKeyDown={handleRunKeyDown}
                  placeholder="Paste the text to process, or describe the input..."
                  rows={1}
                  disabled={runSending || connectionState !== 'connected'}
                  className="flex-1 resize-none bg-transparent text-[12.5px] leading-relaxed text-foreground outline-none placeholder:text-[#4a4d55] disabled:opacity-50"
                  style={{ minHeight: '20px', maxHeight: '80px' }}
                />
                <button
                  onClick={() => void handleRunExecute()}
                  disabled={!runInput.trim() || runSending || connectionState !== 'connected'}
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-[#5b7cf6] transition-opacity hover:opacity-85 disabled:opacity-30"
                >
                  <Send className="h-3 w-3 text-white" />
                </button>
              </div>
            </div>
          </>
        ) : (
          /* ═══ WORKFLOW BUILDING MODE ═══ */
          <>
            {/* Header */}
            <div className="shrink-0 border-b border-[#1f2024] px-7 pb-4 pt-5">
              <div className="mb-1 font-mono text-[9px] uppercase tracking-[.12em] text-[#4a4d55]">
                Workflows · new
              </div>
              <div
                className="mb-1 text-xl font-light text-foreground"
                style={{ letterSpacing: '-.01em' }}
              >
                Teach the agent
              </div>
              <div className="max-w-[480px] text-[12.5px] leading-relaxed text-[#7a7d85]">
                Describe in your own words what you want the agent to do — when, with which tools,
                and what you decide.{' '}
                <span className="text-[#f0a04b]">
                  The agent asks about what it doesn't understand, one question at a time.
                </span>
              </div>

              {/* State tabs */}
              <div className="mt-2.5 flex items-center gap-1.5">
                <span className="font-mono text-[9px] text-[#4a4d55]">STATE:</span>
                {(['empty', 'clarifying', 'ready'] as const).map((s) => (
                  <button
                    key={s}
                    disabled
                    className={`rounded border px-2.5 py-1 font-mono text-[9px] uppercase tracking-[.06em] transition-all duration-[120ms] ${
                      convoState === s
                        ? 'border-[#5b7cf6] bg-[#5b7cf6] text-white'
                        : 'border-[#2a2b2f] bg-transparent text-[#4a4d55]'
                    }`}
                  >
                    {s === 'empty' ? 'Empty' : s === 'clarifying' ? 'Clarifying' : 'Ready'}
                  </button>
                ))}
              </div>
            </div>

            {/* Body */}
            <div
              ref={bodyRef}
              className="flex flex-1 flex-col gap-4 overflow-y-auto px-7 py-5"
              style={{ scrollbarWidth: 'thin', scrollbarColor: '#2a2b2f transparent' }}
            >
              {/* Empty state */}
              {convoState === 'empty' && (
                <>
                  <div className="max-w-[460px] text-[13px] leading-relaxed text-[#7a7d85]">
                    There is no right format. You can be as vague or as precise as you want — the
                    agent resolves ambiguities with you before doing anything.
                  </div>
                  <div className="flex w-full max-w-[520px] flex-col gap-2">
                    <div className="mb-0.5 font-mono text-[9px] uppercase tracking-[.1em] text-[#4a4d55]">
                      Examples to get started
                    </div>
                    {EXAMPLES.map((ex, i) => (
                      <button
                        key={i}
                        onClick={() => void handleSend(ex.text)}
                        disabled={connectionState !== 'connected'}
                        className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-[#1f2024] bg-[#151618] px-3.5 py-2.5 text-left transition-all duration-[120ms] hover:border-[#5b7cf6] hover:bg-[rgba(91,124,246,.05)] disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        <div
                          className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded text-[11px] ${EXAMPLE_ICON_CLASSES[ex.color]}`}
                        >
                          {ex.icon}
                        </div>
                        <div className="text-[12.5px] leading-snug text-[#7a7d85]">
                          <strong className="font-medium text-foreground">{ex.title}</strong>{' '}
                          {ex.text}
                        </div>
                      </button>
                    ))}
                  </div>
                </>
              )}

              {/* Messages */}
              {convoState !== 'empty' &&
                messages.map((msg, i) => {
                  const isUser = msg.role === 'user'
                  return (
                    <div
                      key={msg.id}
                      className={`flex flex-col gap-1 ${isUser ? 'items-end' : 'items-start'}`}
                    >
                      <div
                        className={`max-w-[420px] rounded-[10px] px-3.5 py-2.5 text-[12.5px] leading-[1.55] ${
                          isUser
                            ? 'rounded-br-[3px] bg-[#232428] text-foreground'
                            : 'rounded-bl-[3px] border border-[#1f2024] bg-[#1c1d20] text-[#7a7d85]'
                        }`}
                      >
                        {msg.text}
                      </div>
                      <div className="px-1 font-mono text-[8.5px] text-[#4a4d55]">{msg.time}</div>

                      {/* Clarify card */}
                      {!isUser && i === messages.length - 1 && clarifyCard && (
                        <div className="mt-1 max-w-[440px] rounded-lg border border-[#2a2b2f] border-l-[3px] border-l-[#5b7cf6] bg-[#151618] p-4">
                          <div className="mb-2 font-mono text-[8.5px] uppercase tracking-[.1em] text-[#5b7cf6]">
                            {clarifyCard.label}
                          </div>
                          <div className="mb-2 text-[13px] font-normal leading-relaxed text-foreground">
                            {clarifyCard.question}
                          </div>
                          {clarifyCard.why && (
                            <div className="mb-3 text-[11px] italic leading-snug text-[#4a4d55]">
                              {clarifyCard.why}
                            </div>
                          )}
                          <div className="flex flex-col gap-1.5">
                            {clarifyCard.options.map((opt) => (
                              <button
                                key={opt.key}
                                onClick={() => {
                                  setSelectedOption(opt.key)
                                  void handleSend(opt.text)
                                }}
                                className={`flex cursor-pointer items-center gap-2 rounded-md border px-3 py-1.5 text-left text-[12px] transition-all duration-[120ms] ${
                                  selectedOption === opt.key
                                    ? 'border-[#5b7cf6] bg-[rgba(91,124,246,.12)] text-foreground'
                                    : 'border-[#2a2b2f] bg-transparent text-[#7a7d85] hover:border-[#5b7cf6] hover:bg-[rgba(91,124,246,.08)] hover:text-foreground'
                                }`}
                              >
                                <span className="shrink-0 rounded bg-[#232428] px-1 py-0.5 font-mono text-[8px] text-[#4a4d55]">
                                  {opt.key}
                                </span>
                                {opt.text}
                              </button>
                            ))}
                            <div className="my-1 text-center font-mono text-[9px] text-[#4a4d55]">
                              — or type your answer —
                            </div>
                            <input
                              type="text"
                              placeholder="Other..."
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' && e.currentTarget.value.trim()) {
                                  void handleSend(e.currentTarget.value.trim())
                                  e.currentTarget.value = ''
                                }
                              }}
                              className="w-full rounded border border-[#2a2b2f] bg-[#1c1d20] px-2.5 py-1.5 text-[12px] text-foreground placeholder:text-[#4a4d55] outline-none transition-colors focus:border-[#5b7cf6]"
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })}

              {/* Confidence bar */}
              {workflow && convoState !== 'empty' && (
                <div className="flex max-w-[440px] items-center gap-2.5 rounded-md border border-[#1f2024] bg-[#151618] px-3 py-2">
                  <span className="shrink-0 font-mono text-[9px] text-[#4a4d55]">Confidence</span>
                  <div className="h-1 flex-1 overflow-hidden rounded-full bg-[#232428]">
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{
                        width: `${workflow.confidence}%`,
                        background: workflow.confidence >= 80 ? '#4caf82' : '#d4a843'
                      }}
                    />
                  </div>
                  <span
                    className="shrink-0 font-mono text-[9px]"
                    style={{ color: workflow.confidence >= 80 ? '#4caf82' : '#d4a843' }}
                  >
                    {workflow.confidence}%
                  </span>
                </div>
              )}

              {sending && (
                <div className="flex items-center gap-2 text-[12px] text-[#4a4d55]">
                  <RefreshCw className="h-3 w-3 animate-spin" />
                  <span>Agent is thinking...</span>
                </div>
              )}
            </div>

            {/* Build input */}
            <div className="shrink-0 border-t border-[#1f2024] px-5 py-3">
              <div className="flex items-end gap-2 rounded-lg border border-[#2a2b2f] bg-[#151618] px-3 py-2.5 transition-colors focus-within:border-[#5b7cf6]">
                <textarea
                  ref={textareaRef}
                  value={input}
                  onChange={handleTextareaInput}
                  onKeyDown={handleKeyDown}
                  placeholder="Describe the workflow you want the agent to learn..."
                  rows={1}
                  disabled={sending || connectionState !== 'connected'}
                  className="flex-1 resize-none bg-transparent text-[12.5px] leading-relaxed text-foreground outline-none placeholder:text-[#4a4d55] disabled:opacity-50"
                  style={{ minHeight: '20px', maxHeight: '80px' }}
                />
                <button
                  onClick={() => void handleSend()}
                  disabled={!input.trim() || sending || connectionState !== 'connected'}
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-[#5b7cf6] transition-opacity hover:opacity-85 disabled:opacity-30"
                >
                  <Send className="h-3 w-3 text-white" />
                </button>
              </div>
            </div>
          </>
        )}
      </div>

      {/* ── RIGHT: PREVIEW + LIBRARY ── */}
      <div className="flex w-[340px] shrink-0 flex-col overflow-hidden">
        {/* Workflow Preview */}
        <div className="flex flex-1 flex-col overflow-hidden border-b border-[#1f2024]">
          <div className="flex shrink-0 items-center justify-between border-b border-[#1f2024] px-5 pb-3 pt-4">
            <span className="font-mono text-[9px] uppercase tracking-[.1em] text-[#4a4d55]">
              Workflow definition
            </span>
            <span className={`rounded px-1.5 py-0.5 font-mono text-[8.5px] ${previewStatus.cls}`}>
              {previewStatus.label}
            </span>
          </div>

          <div
            className="flex-1 overflow-y-auto px-5 py-4"
            style={{ scrollbarWidth: 'thin', scrollbarColor: '#2a2b2f transparent' }}
          >
            {!workflow ? (
              <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
                <div className="mb-1 text-[#4a4d55] opacity-40">
                  <svg
                    width="32"
                    height="32"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1"
                  >
                    <rect x="3" y="3" width="18" height="18" rx="3" />
                    <path d="M9 12h6M12 9v6" />
                  </svg>
                </div>
                <div className="text-[12px] leading-relaxed text-[#4a4d55]">
                  As you describe the workflow, the definition will appear here in real time.
                </div>
              </div>
            ) : (
              <div>
                <div className="mb-1 text-[14px] font-medium leading-snug text-foreground">
                  {workflow.name}
                </div>
                <div className="mb-4 text-[11.5px] leading-relaxed text-[#7a7d85]">
                  {workflow.description}
                </div>

                {/* Trigger */}
                <div className="mb-4">
                  <div className="mb-2 flex items-center gap-1.5 font-mono text-[8.5px] uppercase tracking-[.1em] text-[#4a4d55] after:h-px after:flex-1 after:bg-[#1f2024]">
                    Trigger
                  </div>
                  <div className="flex items-start gap-2.5 rounded-md border border-[#1f2024] bg-[#151618] px-3 py-2.5">
                    <div className="mt-0.5 flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded bg-[rgba(91,124,246,.12)] text-[11px] text-[#5b7cf6]">
                      <Zap className="h-3 w-3" />
                    </div>
                    <div className="text-[12px] leading-snug text-[#7a7d85]">
                      {workflow.triggerText}
                    </div>
                  </div>
                </div>

                {/* Steps */}
                {workflow.steps.length > 0 && (
                  <div className="mb-4">
                    <div className="mb-2 flex items-center gap-1.5 font-mono text-[8.5px] uppercase tracking-[.1em] text-[#4a4d55] after:h-px after:flex-1 after:bg-[#1f2024]">
                      Steps
                    </div>
                    <div className="flex flex-col gap-1.5">
                      {workflow.steps.map((step, i) => (
                        <div
                          key={i}
                          className={`flex items-start gap-2 rounded-md border border-[#1f2024] bg-[#151618] px-3 py-2 ${
                            step.pending ? 'border-dashed opacity-40' : ''
                          }`}
                        >
                          <div className="mt-0.5 flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full bg-[#232428] font-mono text-[9px] text-[#4a4d55]">
                            {step.num}
                          </div>
                          <div className="flex-1">
                            <div className="mb-0.5 text-[12px] leading-snug text-foreground">
                              {step.action}
                            </div>
                            {step.detail && (
                              <div className="mb-1 text-[11px] leading-snug text-[#4a4d55]">
                                {step.detail}
                              </div>
                            )}
                            {step.tags && step.tags.length > 0 && (
                              <div className="flex flex-wrap gap-1">
                                {step.tags.map((tag, j) => (
                                  <span
                                    key={j}
                                    className={`rounded px-1 py-0.5 font-mono text-[8px] ${STEP_TAG_CLASSES[tag.style] ?? STEP_TAG_CLASSES.tool}`}
                                  >
                                    {tag.label}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Ambiguities */}
                {workflow.ambiguities && workflow.ambiguities.length > 0 && (
                  <div className="mb-4">
                    <div className="mb-2 flex items-center gap-1.5 font-mono text-[8.5px] uppercase tracking-[.1em] text-[#4a4d55] after:h-px after:flex-1 after:bg-[#1f2024]">
                      Active ambiguities
                    </div>
                    <div className="flex flex-col gap-1.5">
                      {workflow.ambiguities.map((amb, i) => (
                        <div
                          key={i}
                          className="flex items-start gap-2 rounded-md border border-[rgba(212,168,67,.25)] bg-[rgba(212,168,67,.05)] px-3 py-2.5"
                        >
                          <div className="mt-0.5 shrink-0 text-[#d4a843]">
                            <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
                              <path d="M8 2a6 6 0 100 12A6 6 0 008 2zm0 9a.75.75 0 110-1.5A.75.75 0 018 11zm.75-3.25a.75.75 0 01-1.5 0V5.75a.75.75 0 011.5 0v2z" />
                            </svg>
                          </div>
                          <div className="text-[11px] leading-snug text-[#7a7d85]">
                            <strong className="font-medium text-[#d4a843]">{amb.aspect}</strong>{' '}
                            {amb.text}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Tools */}
                {workflow.tools && workflow.tools.length > 0 && (
                  <div className="mb-2">
                    <div className="mb-2 flex items-center gap-1.5 font-mono text-[8.5px] uppercase tracking-[.1em] text-[#4a4d55] after:h-px after:flex-1 after:bg-[#1f2024]">
                      Required tools
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {workflow.tools.map((tool, i) => (
                        <div
                          key={i}
                          className="flex items-center gap-1.5 rounded border border-[#1f2024] bg-[#151618] px-2 py-1 font-mono text-[9px] text-[#7a7d85]"
                        >
                          <div
                            className={`h-[5px] w-[5px] rounded-full ${TOOL_DOT_CLASSES[tool.dot] ?? TOOL_DOT_CLASSES.default}`}
                          />
                          {tool.label}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Activate button */}
          <div className="flex shrink-0 flex-col gap-2 border-t border-[#1f2024] px-5 py-3.5">
            {activated ? (
              <div className="flex items-center justify-center gap-2 text-[12.5px] text-[#4caf82]">
                <Check className="h-3.5 w-3.5" strokeWidth={2.5} />
                Workflow activated
              </div>
            ) : (
              <button
                onClick={() => void handleActivate()}
                disabled={convoState !== 'ready' || !workflow || activating}
                className="flex w-full items-center justify-center gap-1.5 rounded-md bg-[#5b7cf6] py-2.5 text-[12.5px] font-medium text-white transition-opacity hover:opacity-85 disabled:cursor-not-allowed disabled:opacity-30"
              >
                {activating ? (
                  <RefreshCw className="h-3 w-3 animate-spin" />
                ) : (
                  <Play className="h-3 w-3" />
                )}
                Activate workflow
              </button>
            )}
            <div className="text-center text-[10.5px] leading-snug text-[#4a4d55]">
              {convoState === 'ready'
                ? 'Review the steps and tools before activating.'
                : convoState === 'clarifying'
                  ? `${workflow?.ambiguities?.length ?? 0} ambiguities left to resolve.`
                  : 'Answer the agent questions to unlock activation.'}
            </div>
          </div>
        </div>

        {/* Library */}
        <div className="flex h-[220px] shrink-0 flex-col overflow-hidden">
          <div className="flex shrink-0 items-center justify-between border-b border-[#1f2024] px-5 pb-2.5 pt-3">
            <span className="font-mono text-[9px] uppercase tracking-[.1em] text-[#4a4d55]">
              Active workflows
            </span>
            <span className="rounded bg-[#232428] px-1.5 py-0.5 font-mono text-[9px] text-[#4a4d55]">
              {activeCount} active
            </span>
          </div>
          <div
            className="flex-1 overflow-y-auto px-3 py-2"
            style={{ scrollbarWidth: 'thin', scrollbarColor: '#2a2b2f transparent' }}
          >
            {library.length === 0 ? (
              <div className="px-2 pt-2 text-[11px] text-[#4a4d55]">No workflows yet.</div>
            ) : (
              library.map((entry) => (
                <div
                  key={entry.id}
                  className="group flex items-center gap-2.5 rounded-md px-2 py-1.5 transition-colors hover:bg-[#1c1d20]"
                >
                  <div
                    className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                      entry.status === 'active'
                        ? 'bg-[#4caf82] shadow-[0_0_4px_#4caf82]'
                        : 'bg-[#d4a843]'
                    }`}
                  />
                  <div className="flex-1 truncate text-[12px] text-[#7a7d85]">{entry.name}</div>
                  {/* Run button — visible on hover */}
                  <button
                    onClick={() => {
                      setRunEntry(entry)
                      setRunMessages([])
                      setRunInput('')
                    }}
                    disabled={connectionState !== 'connected' || entry.status === 'paused'}
                    className="hidden shrink-0 items-center gap-1 rounded bg-[rgba(91,124,246,.12)] px-1.5 py-0.5 font-mono text-[8px] text-[#5b7cf6] transition-colors hover:bg-[rgba(91,124,246,.2)] disabled:cursor-not-allowed disabled:opacity-40 group-hover:flex"
                  >
                    <Play className="h-2.5 w-2.5" />
                    Run
                  </button>
                  <div
                    className={`shrink-0 font-mono text-[9px] text-[#4a4d55] ${entry.status !== 'paused' ? 'group-hover:hidden' : ''}`}
                  >
                    {entry.status === 'paused' ? 'paused' : `×${entry.runs}`}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
