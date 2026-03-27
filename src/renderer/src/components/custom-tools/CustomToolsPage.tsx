import { useState, useEffect, useRef } from 'react'
import { ArrowLeft } from 'lucide-react'
import { ExplorationFeed } from './ExplorationFeed'
import { ToolResultView, type CustomToolResult } from './ToolResultView'
import { useTranslation } from '@/i18n'

type SubState = 'describe' | 'exploring' | 'result'

interface RecentCustomTool {
  name: string
  connectedAt: string
  status: 'active' | 'partial'
}

const STORAGE_KEY = 'attacca_custom_tools'

function loadRecentTools(): RecentCustomTool[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]')
  } catch {
    return []
  }
}

function saveRecentTool(tool: RecentCustomTool): void {
  const existing = loadRecentTools().filter((t) => t.name !== tool.name)
  localStorage.setItem(STORAGE_KEY, JSON.stringify([tool, ...existing].slice(0, 10)))
}

function buildLLMPrompt(toolName: string, usageDescription: string): string {
  return `Eres un agente técnico experto en APIs y automatización. El usuario quiere conectar "${toolName}" a un asistente de IA personal (OpenClaw). 

Uso descrito por el usuario: "${usageDescription}"

Tu tarea:
1. Determina si "${toolName}" tiene una API REST o GraphQL pública y documentada
2. Verifica si soporta OAuth 2.0 (preferido) o API key
3. Evalúa si tiene webhooks y si requieren algún plan específico
4. Mapea qué acciones serían posibles dado el uso descrito, con su nivel de riesgo

Responde SOLO con JSON válido (sin markdown, sin explicaciones extra) con exactamente esta estructura:
{
  "status": "success" | "partial" | "not_possible",
  "toolName": "${toolName}",
  "toolType": "descripción corta del tipo de herramienta",
  "authType": "OAuth 2.0" | "API Key" | "OAuth 2.0 + API Key fallback" | "No disponible",
  "scopes": ["scope1", "scope2"],
  "webhooksAvailable": true | false,
  "webhookPlan": "nombre del plan requerido o null",
  "pollingFallback": true | false,
  "capabilities": [
    { "name": "descripción de la acción", "type": "read" | "write" | "warn", "risk": "low" | "mid" | "high" | "na" }
  ],
  "limitations": "descripción de la limitación principal o null"
}

Reglas de riesgo: read=low, write=mid por defecto, operaciones destructivas=high, requiere plan especial=na.
Si la API es privada, enterprise-only o no existe documentación pública → status: "not_possible".
Si funciona pero con alguna limitación → status: "partial".
Si funciona completamente → status: "success".`
}

interface CustomToolsPageProps {
  initialToolName?: string
  onBack: () => void
}

export function CustomToolsPage({
  initialToolName = '',
  onBack
}: CustomToolsPageProps): React.JSX.Element {
  const { t } = useTranslation()
  const [subState, setSubState] = useState<SubState>('describe')
  const [toolName, setToolName] = useState(initialToolName)
  const [usageDescription, setUsageDescription] = useState('')
  const [explorationStep, setExplorationStep] = useState(0)
  const [result, setResult] = useState<CustomToolResult | null>(null)
  const [recentTools, setRecentTools] = useState<RecentCustomTool[]>([])

  const explorationRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const llmResultRef = useRef<CustomToolResult | null>(null)
  const llmDoneRef = useRef(false)

  useEffect(() => {
    setRecentTools(loadRecentTools())
  }, [])

  // When initialToolName changes (navigated from catalog)
  useEffect(() => {
    if (initialToolName) setToolName(initialToolName)
  }, [initialToolName])

  const handleStartExploration = async (): Promise<void> => {
    if (!toolName.trim()) return
    setSubState('exploring')
    setExplorationStep(0)
    llmDoneRef.current = false
    llmResultRef.current = null

    // Animate steps (one per 1.8s for first 4, then wait for LLM)
    let step = 0
    explorationRef.current = setInterval(() => {
      step += 1
      setExplorationStep(step)
      if (step >= 4) {
        // Stop auto-advancing; wait for LLM
        if (explorationRef.current) clearInterval(explorationRef.current)
        explorationRef.current = null
        // If LLM already done, finalize
        if (llmDoneRef.current && llmResultRef.current) {
          setExplorationStep(5)
          setTimeout(() => {
            setResult(llmResultRef.current!)
            setSubState('result')
          }, 800)
        }
      }
    }, 1800)

    // Call LLM in parallel
    try {
      const messages = [
        { role: 'user', content: buildLLMPrompt(toolName.trim(), usageDescription.trim()) }
      ]
      const response = await window.api.relay.llmCompletion(messages, { max_tokens: 1024 })

      let parsed: CustomToolResult | null = null
      if ('content' in response && response.content) {
        // Strip any markdown code fences if present
        const raw = response.content.replace(/```(?:json)?\n?/g, '').trim()
        try {
          parsed = JSON.parse(raw) as CustomToolResult
        } catch {
          // Try to extract JSON from the response
          const match = raw.match(/\{[\s\S]*\}/)
          if (match) {
            try {
              parsed = JSON.parse(match[0]) as CustomToolResult
            } catch {
              /* fall through */
            }
          }
        }
      }

      if (!parsed) {
        parsed = {
          status: 'not_possible',
          toolName: toolName.trim(),
          toolType: 'Herramienta desconocida',
          authType: 'No disponible',
          scopes: [],
          webhooksAvailable: false,
          webhookPlan: null,
          pollingFallback: false,
          capabilities: [],
          limitations:
            'No se pudo obtener información de la API de esta herramienta automáticamente.'
        }
      }

      llmResultRef.current = parsed
      llmDoneRef.current = true

      // If animation already at step 4+, finalize now
      if (explorationRef.current === null) {
        setExplorationStep(5)
        setTimeout(() => {
          setResult(parsed!)
          setSubState('result')
          if (parsed!.status !== 'not_possible') {
            saveRecentTool({
              name: toolName.trim(),
              connectedAt: 'ahora mismo',
              status: parsed!.status === 'partial' ? 'partial' : 'active'
            })
            setRecentTools(loadRecentTools())
          }
        }, 800)
      }
    } catch {
      llmDoneRef.current = true
      llmResultRef.current = {
        status: 'not_possible',
        toolName: toolName.trim(),
        toolType: 'Desconocido',
        authType: 'No disponible',
        scopes: [],
        webhooksAvailable: false,
        webhookPlan: null,
        pollingFallback: false,
        capabilities: [],
        limitations:
          'No se pudo conectar al servicio de investigación. Verifica tu conexión e inténtalo de nuevo.'
      }
      if (explorationRef.current === null) {
        setExplorationStep(5)
        setTimeout(() => {
          setResult(llmResultRef.current!)
          setSubState('result')
        }, 800)
      }
    }
  }

  // Cleanup
  useEffect(() => {
    return () => {
      if (explorationRef.current) clearInterval(explorationRef.current)
    }
  }, [])

  const handleRetry = (): void => {
    setSubState('describe')
    setToolName('')
    setUsageDescription('')
    setResult(null)
    setExplorationStep(0)
    llmDoneRef.current = false
    llmResultRef.current = null
  }

  const handleConnect = (): void => {
    // Save to recent list
    if (result) {
      saveRecentTool({
        name: result.toolName,
        connectedAt: 'ahora mismo',
        status: result.status === 'partial' ? 'partial' : 'active'
      })
      setRecentTools(loadRecentTools())
    }
    onBack()
  }

  const tabLabel = (s: SubState, n: number, label: string): React.JSX.Element => (
    <button
      onClick={() => {
        if (s === 'describe') handleRetry()
      }}
      className={`rounded-[4px] border px-[10px] py-1 font-mono text-[9px] uppercase tracking-[.06em] transition-all ${
        subState === s
          ? 'border-[#5b7cf6] bg-[#5b7cf6] text-white'
          : 'border-[#2a2b2f] bg-transparent text-[#4a4d55]'
      }`}
    >
      {n} · {label}
    </button>
  )

  return (
    <div className="flex flex-1 overflow-hidden bg-[#0e0f11]">
      {/* ── Left panel ── */}
      <div className="flex flex-1 flex-col overflow-hidden border-r border-[#1f2024]">
        {/* Header */}
        <div className="shrink-0 border-b border-[#1f2024] px-8 py-6">
          <div className="mb-[5px] flex items-center gap-1 font-mono text-[9px] uppercase tracking-[.12em] text-[#4a4d55]">
            <button onClick={onBack} className="hover:text-[#7a7d85]">
              {t('customTools.breadcrumb_connections')}
            </button>
            <span>·</span>
            <span>{t('customTools.breadcrumb_custom')}</span>
          </div>
          <h1 className="mb-1 text-[20px] font-light tracking-[-0.01em] text-[#e8e9eb]">
            {t('customTools.title')}
          </h1>
          <p className="max-w-[480px] text-[12.5px] leading-[1.5] text-[#7a7d85]">
            {t('customTools.desc')}
          </p>

          {/* Sub-state tabs */}
          <div className="mt-[10px] flex items-center gap-[5px]">
            <span className="mr-[2px] self-center font-mono text-[9px] text-[#4a4d55]">
              {t('customTools.step_label')}
            </span>
            {tabLabel('describe', 1, t('customTools.step.describe'))}
            {tabLabel('exploring', 2, t('customTools.step.exploring'))}
            {tabLabel('result', 3, t('customTools.step.result'))}
          </div>
        </div>

        {/* Body */}
        <div
          className="flex-1 overflow-y-auto px-8 py-6"
          style={{ scrollbarWidth: 'thin', scrollbarColor: '#2a2b2f transparent' }}
        >
          {/* ── DESCRIBE ── */}
          {subState === 'describe' && (
            <div>
              <p className="mb-5 max-w-[460px] text-[13px] leading-[1.6] text-[#7a7d85]">
                {t('customTools.no_tech')}
              </p>

              <div className="mb-[14px] max-w-[520px]">
                <div className="mb-[6px] text-[12px] text-[#7a7d85]">
                  {t('customTools.tool_label')}
                </div>
                <input
                  type="text"
                  value={toolName}
                  onChange={(e) => setToolName(e.target.value)}
                  placeholder={t('customTools.tool_placeholder')}
                  className="w-full rounded-[6px] border border-[#2a2b2f] bg-[#151618] px-3 py-[9px] font-sans text-[13px] text-[#e8e9eb] outline-none placeholder:text-[#4a4d55] focus:border-[#5b7cf6]"
                />
                <div className="mt-[5px] text-[11px] text-[#4a4d55]">
                  {t('customTools.tool_hint')}
                </div>
              </div>

              <div className="mb-[14px] max-w-[520px]">
                <div className="mb-[6px] text-[12px] text-[#7a7d85]">
                  {t('customTools.usage_label')}
                </div>
                <textarea
                  value={usageDescription}
                  onChange={(e) => setUsageDescription(e.target.value)}
                  placeholder={t('customTools.usage_placeholder')}
                  className="h-[80px] w-full resize-none rounded-[6px] border border-[#2a2b2f] bg-[#151618] px-3 py-[9px] font-sans text-[12.5px] leading-[1.5] text-[#e8e9eb] outline-none placeholder:text-[#4a4d55] focus:border-[#5b7cf6]"
                />
              </div>

              <button
                disabled={!toolName.trim()}
                onClick={handleStartExploration}
                className="mt-1 inline-flex items-center gap-[7px] rounded-[6px] bg-[#5b7cf6] px-5 py-[9px] font-sans text-[12.5px] font-medium text-white transition-opacity hover:opacity-85 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <svg
                  width="13"
                  height="13"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <circle cx="11" cy="11" r="8" />
                  <path d="m21 21-4.35-4.35" />
                </svg>
                {t('customTools.explore_btn')}
              </button>

              {/* Experimental note */}
              <div className="mt-4 flex max-w-[520px] items-start gap-[10px] rounded-lg border border-[#1f2024] bg-[#151618] px-[14px] py-3">
                <span className="mt-[1px] shrink-0 text-[#4a4d55]">
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 16 16"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                  >
                    <circle cx="8" cy="8" r="6" />
                    <path d="M8 5v3l2 2" />
                  </svg>
                </span>
                <p className="text-[11.5px] leading-[1.5] text-[#4a4d55]">
                  {t('customTools.experimental_warn')}
                </p>
              </div>
            </div>
          )}

          {/* ── EXPLORING ── */}
          {subState === 'exploring' && (
            <ExplorationFeed toolName={toolName} currentStep={explorationStep} />
          )}

          {/* ── RESULT ── */}
          {subState === 'result' && result && (
            <ToolResultView result={result} onRetry={handleRetry} onConnect={handleConnect} />
          )}
        </div>
      </div>

      {/* ── Aside panel ── */}
      <div
        className="flex w-[260px] shrink-0 flex-col gap-[18px] overflow-y-auto p-5"
        style={{ scrollbarWidth: 'thin', scrollbarColor: '#2a2b2f transparent' }}
      >
        {/* How it works */}
        <div>
          <div className="mb-2 font-mono text-[9px] uppercase tracking-[.1em] text-[#4a4d55]">
            {t('customTools.how_it_works')}
          </div>
          <p className="text-[12px] leading-[1.55] text-[#7a7d85]">
            El agente busca la API pública de la herramienta, verifica qué puede hacer con ella, y
            mapea las capacidades a tu uso específico.{' '}
            <span className="text-[#f0a04b]">Tú no tocas ninguna configuración técnica.</span>
          </p>
        </div>

        <div className="h-px bg-[#1f2024]" />

        {/* Back button */}
        <button
          onClick={onBack}
          className="flex items-center gap-2 text-[12px] text-[#4a4d55] transition-colors hover:text-[#7a7d85]"
        >
          <ArrowLeft className="h-3 w-3" />
          {t('customTools.back')}
        </button>

        <div className="h-px bg-[#1f2024]" />

        {/* Recent custom connections */}
        {recentTools.length > 0 && (
          <div>
            <div className="mb-2 font-mono text-[9px] uppercase tracking-[.1em] text-[#4a4d55]">
              {t('customTools.recent_title')}
            </div>
            <div className="flex flex-col">
              {recentTools.map((tool, i) => (
                <div
                  key={i}
                  className="cursor-pointer border-b border-[#1f2024] py-2 last:border-b-0"
                >
                  <div className="text-[12px] text-[#7a7d85]">{tool.name}</div>
                  <div className="mt-[2px] flex gap-[6px] font-mono text-[9px]">
                    <span className="text-[#4a4d55]">{tool.connectedAt}</span>
                    <span
                      className={`rounded-[2px] px-[5px] py-[1px] text-[8px] ${
                        tool.status === 'active'
                          ? 'bg-[rgba(76,175,130,.1)] text-[#4caf82]'
                          : 'bg-[rgba(212,168,67,.1)] text-[#d4a843]'
                      }`}
                    >
                      {tool.status === 'active'
                        ? t('customTools.status.active')
                        : t('customTools.status.partial')}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {recentTools.length > 0 && <div className="h-px bg-[#1f2024]" />}

        {/* Request official integration CTA */}
        <div className="rounded-lg border border-[#1f2024] bg-[#151618] p-[14px]">
          <div className="mb-1 text-[12px] font-medium text-[#e8e9eb]">
            {t('customTools.not_working')}
          </div>
          <button
            onClick={() =>
              window.api.app.openExternal('https://request.composio.dev/boards/tool-requests')
            }
            className="w-full rounded-[6px] border border-[#2a2b2f] bg-transparent py-[7px] font-sans text-[12px] text-[#7a7d85] transition-all hover:border-[#5b7cf6] hover:text-[#5b7cf6]"
          >
            {t('customTools.request_official')}
          </button>
        </div>
      </div>
    </div>
  )
}
