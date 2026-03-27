import { cn } from '@/lib/utils'

interface ExplorationStep {
  title: string
  detail: string
  doneTag: string
  activeTag: string
}

const STEPS: ExplorationStep[] = [
  {
    title: 'Herramienta identificada',
    detail: 'Buscando documentación pública y clasificando el producto',
    doneTag: 'encontrado',
    activeTag: 'identificando'
  },
  {
    title: 'API REST pública confirmada',
    detail: 'Verificando si existe documentación de API y endpoints disponibles',
    doneTag: 'API disponible',
    activeTag: 'verificando'
  },
  {
    title: 'Autenticación verificada',
    detail: 'Comprobando soporte OAuth 2.0, API key u otros métodos de auth',
    doneTag: 'auth verificada',
    activeTag: 'comprobando'
  },
  {
    title: 'Mapeando capacidades a tu uso',
    detail: 'Relacionando endpoints disponibles con lo que describes para el agente',
    doneTag: 'capacidades mapeadas',
    activeTag: 'verificando'
  },
  {
    title: 'Preparando definición de conexión',
    detail: 'Creando el adaptador con clasificación de riesgo para OpenClaw',
    doneTag: 'definición lista',
    activeTag: 'preparando'
  }
]

interface ExplorationFeedProps {
  toolName: string
  currentStep: number // 0 = none done, 1 = first done, etc.
}

export function ExplorationFeed({
  toolName,
  currentStep
}: ExplorationFeedProps): React.JSX.Element {
  return (
    <div className="max-w-[520px]">
      {/* File card */}
      <div className="mb-5 flex items-center gap-3 rounded-lg border border-[#1f2024] bg-[#151618] px-4 py-3">
        <div className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-md bg-[rgba(91,124,246,.12)] text-[#5b7cf6]">
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          >
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.35-4.35" />
          </svg>
        </div>
        <div className="flex-1">
          <div className="text-[13px] font-medium text-[#e8e9eb]">
            {toolName || 'Herramienta'} · API Research
          </div>
          <div className="font-mono text-[9px] text-[#4a4d55]">
            Investigando API y capacidades de conexión
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-[5px] rounded-[10px] bg-[rgba(91,124,246,.12)] px-2 py-[3px] font-mono text-[9px] text-[#5b7cf6]">
          <span className="h-[5px] w-[5px] animate-pulse rounded-full bg-[#5b7cf6]" />
          explorando
        </div>
      </div>

      {/* Steps feed */}
      <div className="flex flex-col">
        {STEPS.map((step, idx) => {
          const isDone = currentStep > idx
          const isActive = currentStep === idx
          const isPending = currentStep < idx

          return (
            <div
              key={idx}
              className={cn(
                'flex items-start gap-3 border-b border-[#1f2024] py-[10px]',
                'last:border-b-0'
              )}
            >
              {/* Icon */}
              <div
                className={cn(
                  'mt-[2px] flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full',
                  isDone && 'bg-[rgba(76,175,130,.1)] text-[#4caf82]',
                  isActive && 'bg-[rgba(91,124,246,.12)] text-[#5b7cf6]',
                  isPending && 'bg-[#1c1d20] text-[#4a4d55]'
                )}
              >
                {isDone ? (
                  <svg
                    width="11"
                    height="11"
                    viewBox="0 0 16 16"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                  >
                    <path d="M3 8l4 4 6-7" />
                  </svg>
                ) : isActive ? (
                  <svg
                    className="animate-spin"
                    width="11"
                    height="11"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                  >
                    <path d="M21 12a9 9 0 11-6.22-8.56" />
                  </svg>
                ) : (
                  <svg
                    width="11"
                    height="11"
                    viewBox="0 0 16 16"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                  >
                    <circle cx="8" cy="8" r="6" />
                    <path d="M8 5v3" />
                  </svg>
                )}
              </div>

              {/* Content */}
              <div className="flex-1">
                <div
                  className={cn(
                    'mb-[2px] text-[12.5px] leading-[1.3]',
                    isPending ? 'text-[#4a4d55]' : 'text-[#e8e9eb]'
                  )}
                >
                  {step.title}
                </div>
                <div
                  className={cn(
                    'text-[11px] leading-[1.4]',
                    isPending ? 'text-[#2a2b2f]' : 'text-[#7a7d85]'
                  )}
                >
                  {step.detail}
                </div>
                {!isPending && (
                  <span
                    className={cn(
                      'mt-1 inline-block rounded-[2px] px-[5px] py-[1px] font-mono text-[8.5px]',
                      isDone && 'bg-[rgba(76,175,130,.1)] text-[#4caf82]',
                      isActive && 'bg-[rgba(91,124,246,.12)] text-[#5b7cf6]'
                    )}
                  >
                    {isDone ? step.doneTag : step.activeTag}
                  </span>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
