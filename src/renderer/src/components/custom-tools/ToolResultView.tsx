export type RiskLevel = 'low' | 'mid' | 'high' | 'na'
export type CapabilityType = 'read' | 'write' | 'warn'
export type ResultStatus = 'success' | 'partial' | 'not_possible'

export interface ToolCapability {
  name: string
  type: CapabilityType
  risk: RiskLevel
}

export interface CustomToolResult {
  status: ResultStatus
  toolName: string
  toolType: string
  authType: string
  scopes: string[]
  webhooksAvailable: boolean
  webhookPlan?: string | null
  pollingFallback: boolean
  capabilities: ToolCapability[]
  limitations?: string | null
}

interface ToolResultViewProps {
  result: CustomToolResult
  onRetry: () => void
  onConnect: () => void
}

const RISK_STYLES: Record<RiskLevel, string> = {
  low: 'bg-[rgba(76,175,130,.1)] text-[#4caf82]',
  mid: 'bg-[rgba(212,168,67,.1)] text-[#d4a843]',
  high: 'bg-[rgba(224,92,92,.1)] text-[#e05c5c]',
  na: 'bg-[#232428] text-[#4a4d55]'
}

const RISK_LABELS: Record<RiskLevel, string> = {
  low: 'low-risk',
  mid: 'mid-risk',
  high: 'high-risk',
  na: 'según plan'
}

const CAP_ICON_STYLES: Record<CapabilityType, string> = {
  read: 'bg-[rgba(76,175,130,.1)] text-[#4caf82]',
  write: 'bg-[rgba(91,124,246,.12)] text-[#5b7cf6]',
  warn: 'bg-[rgba(212,168,67,.1)] text-[#d4a843]'
}

const CAP_ICONS: Record<CapabilityType, string> = {
  read: '👁',
  write: '✏️',
  warn: '⚠️'
}

export function ToolResultView({
  result,
  onRetry,
  onConnect
}: ToolResultViewProps): React.JSX.Element {
  const isNotPossible = result.status === 'not_possible'
  const isPartial = result.status === 'partial'
  const isSuccess = result.status === 'success'

  return (
    <div className="max-w-[520px]">
      {/* Result header */}
      <div
        className={`mb-5 flex items-start gap-[14px] rounded-[10px] border p-4 ${
          isSuccess
            ? 'border-[rgba(76,175,130,.25)] bg-[#151618]'
            : isPartial
              ? 'border-[rgba(212,168,67,.25)] bg-[#151618]'
              : 'border-[rgba(224,92,92,.25)] bg-[#151618]'
        }`}
      >
        <div
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
            isSuccess
              ? 'bg-[rgba(76,175,130,.1)] text-[#4caf82]'
              : isPartial
                ? 'bg-[rgba(212,168,67,.1)] text-[#d4a843]'
                : 'bg-[rgba(224,92,92,.1)] text-[#e05c5c]'
          }`}
        >
          {isNotPossible ? (
            <svg
              width="14"
              height="14"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M4 4l8 8M12 4l-8 8" />
            </svg>
          ) : (
            <svg
              width="14"
              height="14"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M3 8l4 4 6-7" />
            </svg>
          )}
        </div>
        <div>
          <div className="mb-[3px] text-[14px] font-medium text-[#e8e9eb]">
            {isSuccess
              ? `${result.toolName} — conexión posible`
              : isPartial
                ? `${result.toolName} — conexión posible, con una limitación`
                : `${result.toolName} — conexión no posible automáticamente`}
          </div>
          <div className="text-[12px] leading-[1.5] text-[#7a7d85]">
            {isNotPossible
              ? 'Esta herramienta requiere acceso privado o acuerdos enterprise que el agente no puede gestionar automáticamente.'
              : 'El agente puede conectarse y ejecutar las acciones descritas.'}
          </div>
        </div>
      </div>

      {/* Capabilities */}
      {result.capabilities.length > 0 && (
        <div className="mb-[18px]">
          <SectionLabel>Lo que el agente puede hacer</SectionLabel>
          <div className="flex flex-col gap-[6px]">
            {result.capabilities.map((cap, i) => (
              <div
                key={i}
                className="flex items-center gap-[10px] rounded-md border border-[#1f2024] bg-[#151618] px-3 py-[9px]"
              >
                <div
                  className={`flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-[4px] text-[11px] ${CAP_ICON_STYLES[cap.type]}`}
                >
                  {CAP_ICONS[cap.type]}
                </div>
                <span className="flex-1 text-[12px] text-[#7a7d85]">{cap.name}</span>
                <span
                  className={`shrink-0 rounded-[2px] px-[5px] py-[1px] font-mono text-[8px] ${RISK_STYLES[cap.risk]}`}
                >
                  {RISK_LABELS[cap.risk]}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Auth detail */}
      {result.authType && (
        <div className="mb-[18px]">
          <SectionLabel>Método de autenticación</SectionLabel>
          <div className="rounded-md border border-[#1f2024] bg-[#151618] px-[13px] py-[11px]">
            <AuthRow label="Tipo" value={result.authType} className="text-[#4caf82]" />
            {result.scopes.length > 0 && (
              <AuthRow label="Scopes" value={result.scopes.join(', ')} />
            )}
            <AuthRow
              label="Webhooks"
              value={
                result.webhooksAvailable
                  ? result.webhookPlan
                    ? `requiere plan ${result.webhookPlan}`
                    : 'disponibles'
                  : 'no disponibles'
              }
              className={
                result.webhooksAvailable && !result.webhookPlan
                  ? 'text-[#4caf82]'
                  : 'text-[#d4a843]'
              }
            />
            {result.pollingFallback && (
              <AuthRow
                label="Polling alt."
                value="disponible como alternativa"
                className="text-[#4caf82]"
              />
            )}
          </div>
        </div>
      )}

      {/* Actions */}
      {!isNotPossible && (
        <div className="mb-3 flex gap-2">
          <button
            onClick={onConnect}
            className="rounded-[6px] bg-[#5b7cf6] px-5 py-[9px] font-sans text-[12.5px] font-medium text-white transition-opacity hover:opacity-85"
          >
            Conectar {result.toolName}
          </button>
          <button
            onClick={onRetry}
            className="rounded-[6px] border border-[#2a2b2f] bg-transparent px-[14px] py-[9px] font-sans text-[12.5px] text-[#7a7d85] transition-all hover:border-[#4a4d55] hover:text-[#e8e9eb]"
          >
            Intentar otra herramienta
          </button>
        </div>
      )}

      {isNotPossible && (
        <div className="mb-3 flex gap-2">
          <button
            onClick={onRetry}
            className="rounded-[6px] bg-[#5b7cf6] px-5 py-[9px] font-sans text-[12.5px] font-medium text-white transition-opacity hover:opacity-85"
          >
            Intentar otra herramienta
          </button>
        </div>
      )}

      {/* Limitation note */}
      {result.limitations && (
        <div className="mt-3 flex gap-[10px] rounded-lg border border-[rgba(212,168,67,.2)] bg-[rgba(212,168,67,.06)] p-3">
          <span className="mt-[1px] shrink-0 text-[#d4a843]">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
              <path d="M8 2a6 6 0 100 12A6 6 0 008 2zm0 9a.75.75 0 110-1.5.75.75 0 010 1.5zm.75-3.25a.75.75 0 01-1.5 0V5.75a.75.75 0 011.5 0v2z" />
            </svg>
          </span>
          <p className="text-[11.5px] leading-[1.5] text-[#7a7d85]">{result.limitations}</p>
        </div>
      )}
    </div>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="mb-2 flex items-center gap-2 font-mono text-[9px] uppercase tracking-[.1em] text-[#4a4d55]">
      {children}
      <span className="h-px flex-1 bg-[#1f2024]" />
    </div>
  )
}

function AuthRow({
  label,
  value,
  className
}: {
  label: string
  value: string
  className?: string
}): React.JSX.Element {
  return (
    <div className="mb-[6px] flex items-center gap-2 last:mb-0">
      <span className="w-[90px] shrink-0 font-mono text-[9px] text-[#4a4d55]">{label}</span>
      <span className={`text-[12px] text-[#7a7d85] ${className ?? ''}`}>{value}</span>
    </div>
  )
}
