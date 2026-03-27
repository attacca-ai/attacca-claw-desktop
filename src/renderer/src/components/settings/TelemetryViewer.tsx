import { useState, useEffect } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'

const MONO = "'IBM Plex Mono', monospace"

interface TelemetryEvent {
  eventType: string
  payload: Record<string, unknown>
  timestamp: string
  anonymousId: string
}

interface TelemetryStatus {
  optedIn: boolean
  lastFlush: string | null
  queueSize: number
}

export function TelemetryViewer({ onClose }: { onClose: () => void }): React.JSX.Element {
  const [events, setEvents] = useState<TelemetryEvent[]>([])
  const [status, setStatus] = useState<TelemetryStatus | null>(null)
  const [expanded, setExpanded] = useState<Set<number>>(new Set())

  useEffect(() => {
    window.api.telemetry.getQueue().then((r) => setEvents(r.events))
    window.api.telemetry.getStatus().then(setStatus)
  }, [])

  function toggleExpand(idx: number): void {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(idx)) next.delete(idx)
      else next.add(idx)
      return next
    })
  }

  function formatTime(iso: string): string {
    try {
      const d = new Date(iso)
      return d.toLocaleString('es-ES', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        day: 'numeric',
        month: 'short'
      })
    } catch {
      return iso
    }
  }

  // Categorize events
  const categories: Record<string, TelemetryEvent[]> = {}
  for (const evt of events) {
    const cat = evt.eventType.split('_')[0] || 'other'
    if (!categories[cat]) categories[cat] = []
    categories[cat].push(evt)
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,.6)' }}
      onClick={onClose}
    >
      <div
        className="w-[560px] max-h-[80vh] rounded-[12px] overflow-hidden flex flex-col"
        style={{ background: '#151618', border: '1px solid #1f2024' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className="px-5 py-4 flex items-center justify-between"
          style={{ borderBottom: '1px solid #1f2024' }}
        >
          <div>
            <div className="text-[14px] text-[#e8e9eb] font-light">Datos de telemetria</div>
            <div className="text-[11px] text-[#4a4d55] mt-0.5" style={{ fontFamily: MONO }}>
              {status
                ? `${status.queueSize} eventos en cola${status.lastFlush ? ` · ultimo envio: ${formatTime(status.lastFlush)}` : ''} · ${status.optedIn ? 'activo' : 'desactivado'}`
                : 'Cargando...'}
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-[#4a4d55] hover:text-[#7a7d85] text-[18px] cursor-pointer"
            style={{ background: 'none', border: 'none', fontFamily: 'inherit' }}
          >
            x
          </button>
        </div>

        {/* Events list */}
        <div className="flex-1 overflow-y-auto px-5 py-3 [scrollbar-width:thin]">
          {events.length === 0 ? (
            <div className="text-[12px] text-[#4a4d55] text-center py-8">
              No hay eventos en cola.
            </div>
          ) : (
            events.map((evt, i) => (
              <div
                key={i}
                className="mb-1.5 rounded-[6px] overflow-hidden"
                style={{ background: '#1c1d20', border: '1px solid #232428' }}
              >
                <button
                  onClick={() => toggleExpand(i)}
                  className="w-full flex items-center gap-2 px-3 py-2 text-left cursor-pointer"
                  style={{ background: 'none', border: 'none', fontFamily: 'inherit' }}
                >
                  {expanded.has(i) ? (
                    <ChevronDown className="w-3 h-3 text-[#4a4d55] flex-shrink-0" />
                  ) : (
                    <ChevronRight className="w-3 h-3 text-[#4a4d55] flex-shrink-0" />
                  )}
                  <span className="text-[11px] text-[#e8e9eb]" style={{ fontFamily: MONO }}>
                    {evt.eventType}
                  </span>
                  <span className="text-[10px] text-[#4a4d55] ml-auto" style={{ fontFamily: MONO }}>
                    {formatTime(evt.timestamp)}
                  </span>
                </button>

                {expanded.has(i) && (
                  <div className="px-3 pb-2.5" style={{ borderTop: '1px solid #232428' }}>
                    <pre
                      className="text-[10px] text-[#7a7d85] mt-2 whitespace-pre-wrap break-all"
                      style={{ fontFamily: MONO }}
                    >
                      {JSON.stringify(evt.payload, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
