import { useState, useEffect } from 'react'
import { Loader2, Play } from 'lucide-react'
import { Switch } from '@/components/ui/switch'
import { useTranslation } from '@/i18n'

const MONO = "'IBM Plex Mono', monospace"

interface TaskStatus {
  id: string
  name: string
  description: string
  enabled: boolean
  lastRun: number | null
  lastResult: string | null
  lastError: string | null
}

function formatTimeAgo(
  ts: number | null,
  t: (key: string, params?: Record<string, string | number>) => string
): string {
  if (!ts) return t('settings.health.never')
  const diff = Date.now() - ts
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return t('settings.health.just_now')
  if (mins < 60) return t('settings.health.mins_ago', { n: mins })
  const hours = Math.floor(mins / 60)
  if (hours < 24) return t('settings.health.hours_ago', { n: hours })
  const days = Math.floor(hours / 24)
  return t('settings.health.days_ago', { n: days })
}

function statusDot(result: string | null): { color: string; shadow?: string } {
  switch (result) {
    case 'success':
      return { color: '#4caf82', shadow: '0 0 5px #4caf82' }
    case 'skipped':
      return { color: '#d4a843' }
    case 'failed':
      return { color: '#e05c5c' }
    default:
      return { color: '#4a4d55' }
  }
}

export function SystemHealth(): React.JSX.Element {
  const { t } = useTranslation()
  const [tasks, setTasks] = useState<TaskStatus[]>([])
  const [running, setRunning] = useState<string | null>(null)
  const [stats, setStats] = useState<{ total: number; withEmbeddings: number } | null>(null)

  function refresh(): void {
    window.api.scheduler.getTasks().then(setTasks)
    window.api.memory.getStats().then((r) => {
      if (r.success) setStats({ total: r.total ?? 0, withEmbeddings: r.withEmbeddings ?? 0 })
    })
  }

  useEffect(() => {
    refresh()
    const interval = setInterval(refresh, 30000)
    return () => clearInterval(interval)
  }, [])

  async function handleToggle(taskId: string, enabled: boolean): Promise<void> {
    await window.api.scheduler.setEnabled(taskId, enabled)
    refresh()
  }

  async function handleRunNow(taskId: string): Promise<void> {
    setRunning(taskId)
    await window.api.scheduler.runNow(taskId)
    setRunning(null)
    refresh()
  }

  return (
    <div>
      <div className="space-y-2">
        {tasks.map((task) => {
          const dot = statusDot(task.lastResult)
          const taskName =
            t(`settings.health.task.${task.id}.name`) !== `settings.health.task.${task.id}.name`
              ? t(`settings.health.task.${task.id}.name`)
              : task.name
          const taskDesc =
            t(`settings.health.task.${task.id}.desc`) !== `settings.health.task.${task.id}.desc`
              ? t(`settings.health.task.${task.id}.desc`)
              : task.description
          return (
            <div
              key={task.id}
              className="rounded-[8px] p-3.5"
              style={{ background: '#1c1d20', border: '1px solid #232428' }}
            >
              <div className="flex items-start gap-3">
                <div
                  className="w-2 h-2 rounded-full mt-1.5 flex-shrink-0"
                  style={{ background: dot.color, boxShadow: dot.shadow }}
                  title={task.lastResult ?? 'never run'}
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-0.5">
                    <span className="text-[12.5px] text-[#e8e9eb]">{taskName}</span>
                    <span className="text-[10px] text-[#4a4d55]" style={{ fontFamily: MONO }}>
                      {formatTimeAgo(task.lastRun, t)}
                    </span>
                  </div>
                  <div className="text-[11px] text-[#4a4d55] leading-[1.4] mb-2">{taskDesc}</div>
                  {task.lastError && (
                    <div
                      className="text-[10px] text-[#e05c5c] mb-2 truncate"
                      title={task.lastError}
                    >
                      {task.lastError}
                    </div>
                  )}
                  <div className="flex items-center gap-3">
                    <Switch
                      checked={task.enabled}
                      onCheckedChange={(checked) => handleToggle(task.id, checked)}
                    />
                    <button
                      onClick={() => handleRunNow(task.id)}
                      disabled={running === task.id}
                      className="flex items-center gap-1 px-2 py-1 rounded-[5px] text-[10.5px] border cursor-pointer transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                      style={{
                        background: 'transparent',
                        border: '1px solid #2a2b2f',
                        color: '#7a7d85',
                        fontFamily: 'inherit'
                      }}
                    >
                      {running === task.id ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : (
                        <Play className="w-3 h-3" />
                      )}
                      {running === task.id
                        ? t('settings.health.running')
                        : t('settings.health.run_now')}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {stats && (
        <div
          className="mt-3 pt-3 flex items-center gap-4 text-[10px] text-[#4a4d55]"
          style={{ borderTop: '1px solid #232428', fontFamily: MONO }}
        >
          <span>{t('settings.health.memories', { n: stats.total })}</span>
          <span>{t('settings.health.with_embeddings', { n: stats.withEmbeddings })}</span>
        </div>
      )}
    </div>
  )
}
