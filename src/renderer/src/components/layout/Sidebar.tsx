import { useState } from 'react'
import { Settings } from 'lucide-react'
import { useAgentStore } from '@/stores/agent-store'
import { useGatewayStore } from '@/stores/gateway-store'
import { cn } from '@/lib/utils'
import { useTranslation } from '@/i18n'

export type SidebarView =
  | 'dashboard'
  | 'capture'
  | 'schedule'
  | 'workflows'
  | 'takeover'
  | 'meta-agent'
  | 'connections'
  | 'custom-tools'
  | 'settings'

interface SidebarProps {
  activeView: SidebarView
  onViewChange: (view: SidebarView) => void
}

// ── Inline SVG icons ──────────────────────────────────────────────────────────
const IconCollapse = ({ flipped }: { flipped?: boolean }): React.JSX.Element => (
  <svg
    className={cn('h-[13px] w-[13px] shrink-0 transition-transform', flipped && 'rotate-180')}
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
  >
    <path d="M10 4l-4 4 4 4" />
  </svg>
)

const IconLandscape = (): React.JSX.Element => (
  <svg
    className="h-[14px] w-[14px] shrink-0"
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
  >
    <rect x="2" y="2" width="5" height="5" rx="1" />
    <rect x="9" y="2" width="5" height="5" rx="1" />
    <rect x="2" y="9" width="5" height="5" rx="1" />
    <rect x="9" y="9" width="5" height="5" rx="1" />
  </svg>
)

const IconCapture = (): React.JSX.Element => (
  <svg
    className="h-[14px] w-[14px] shrink-0"
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
  >
    <rect x="2" y="2" width="12" height="12" rx="2" />
    <path d="M5 8h6M8 5v6" />
  </svg>
)

const IconSchedule = (): React.JSX.Element => (
  <svg
    className="h-[14px] w-[14px] shrink-0"
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
  >
    <circle cx="8" cy="8" r="6" />
    <path d="M8 4v4l3 2" />
  </svg>
)

const IconWorkflows = (): React.JSX.Element => (
  <svg
    className="h-[14px] w-[14px] shrink-0"
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
  >
    <path d="M2 8c0-3.3 2.7-6 6-6s6 2.7 6 6-2.7 6-6 6" />
    <path d="M8 10a2 2 0 100-4 2 2 0 000 4" />
  </svg>
)

const IconTakeOver = (): React.JSX.Element => (
  <svg
    className="h-[14px] w-[14px] shrink-0"
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
  >
    <path d="M2 2l12 6-12 6V2z" />
  </svg>
)

const IconConnections = (): React.JSX.Element => (
  <svg
    className="h-[14px] w-[14px] shrink-0"
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
  >
    <path d="M3 8h10M8 3v10" />
    <circle cx="8" cy="8" r="2" />
  </svg>
)

// ── Collapsed icon button ─────────────────────────────────────────────────────
interface IconBtnProps {
  view: SidebarView
  icon: React.ReactNode
  title: string
  badge?: number
  isActive: boolean
  onViewChange: (view: SidebarView) => void
}

function IconBtn({
  view,
  icon,
  title,
  badge,
  isActive,
  onViewChange
}: IconBtnProps): React.JSX.Element {
  return (
    <button
      onClick={() => onViewChange(view)}
      title={title}
      className={cn(
        'relative mx-auto flex h-9 w-9 items-center justify-center rounded transition-colors',
        isActive
          ? 'bg-[rgba(91,124,246,.12)] text-[#5b7cf6]'
          : 'text-muted-foreground/60 hover:bg-muted/20 hover:text-foreground'
      )}
    >
      {icon}
      {badge !== undefined && badge > 0 && (
        <span className="absolute right-[5px] top-[5px] flex h-[13px] min-w-[13px] items-center justify-center rounded-full bg-[#5b7cf6] px-[2px] font-mono text-[7px] text-white">
          {badge > 9 ? '9+' : badge}
        </span>
      )}
    </button>
  )
}

// ── Expanded nav item ─────────────────────────────────────────────────────────
interface NavItemProps {
  view: SidebarView
  label: string
  icon: React.ReactNode
  badge?: number
  isActive: boolean
  onViewChange: (view: SidebarView) => void
}

function NavItem({
  view,
  label,
  icon,
  badge,
  isActive,
  onViewChange
}: NavItemProps): React.JSX.Element {
  return (
    <button
      onClick={() => onViewChange(view)}
      className={cn(
        'flex w-full items-center gap-[9px] rounded px-2 py-[7px] text-left text-[12.5px] transition-colors',
        isActive
          ? 'bg-[rgba(91,124,246,.12)] text-[#5b7cf6]'
          : 'text-muted-foreground hover:bg-muted/30 hover:text-foreground'
      )}
    >
      <span className={cn('shrink-0', isActive ? 'opacity-100' : 'opacity-[.7]')}>{icon}</span>
      <span className="flex-1">{label}</span>
      {badge !== undefined && badge > 0 && (
        <span className="min-w-[18px] rounded-[10px] bg-[#5b7cf6] px-[5px] py-[1px] text-center font-mono text-[9px] text-white">
          {badge}
        </span>
      )}
    </button>
  )
}

export function Sidebar({ activeView, onViewChange }: SidebarProps): React.JSX.Element {
  const [collapsed, setCollapsed] = useState(false)
  const { t } = useTranslation()
  const rawCapturesCount = useAgentStore((s) => s.rawCapturesCount)
  const connectionState = useGatewayStore((s) => s.connectionState)
  const isProcessing = useAgentStore((s) => s.isProcessing)

  const agentStatus =
    connectionState !== 'connected' ? 'offline' : isProcessing ? 'working' : 'watching'

  // ── Collapsed: icon-only rail ─────────────────────────────────────────────
  if (collapsed) {
    return (
      <div className="flex w-11 shrink-0 flex-col border-r border-[#1f2024] bg-background py-2">
        {/* Expand toggle */}
        <button
          onClick={() => setCollapsed(false)}
          title={t('sidebar.expand')}
          className="mx-auto mb-1 flex h-9 w-9 items-center justify-center rounded text-muted-foreground/30 transition-colors hover:bg-muted/20 hover:text-muted-foreground"
        >
          <IconCollapse flipped />
        </button>

        {/* Workspace icons */}
        <IconBtn
          view="dashboard"
          icon={<IconLandscape />}
          title={t('sidebar.landscape')}
          isActive={activeView === 'dashboard'}
          onViewChange={onViewChange}
        />
        <IconBtn
          view="capture"
          icon={<IconCapture />}
          title={t('sidebar.capture')}
          isActive={activeView === 'capture'}
          badge={rawCapturesCount > 0 ? rawCapturesCount : undefined}
          onViewChange={onViewChange}
        />
        <IconBtn
          view="schedule"
          icon={<IconSchedule />}
          title={t('sidebar.schedule')}
          isActive={activeView === 'schedule'}
          onViewChange={onViewChange}
        />
        <div className="mx-auto my-2 h-px w-6 bg-[#1f2024]" />

        {/* Agent icons */}
        <IconBtn
          view="workflows"
          icon={<IconWorkflows />}
          title={t('sidebar.workflows')}
          isActive={activeView === 'workflows'}
          onViewChange={onViewChange}
        />
        <IconBtn
          view="takeover"
          icon={<IconTakeOver />}
          title={t('sidebar.takeover')}
          isActive={activeView === 'takeover'}
          onViewChange={onViewChange}
        />
        <IconBtn
          view="connections"
          icon={<IconConnections />}
          title={t('sidebar.connections')}
          isActive={activeView === 'connections' || activeView === 'custom-tools'}
          onViewChange={onViewChange}
        />

        {/* Bottom */}
        <div className="mt-auto">
          <div className="mx-auto mb-1 h-px w-6 bg-[#1f2024]" />
          <IconBtn
            view="settings"
            icon={<Settings className="h-[14px] w-[14px]" />}
            title={t('sidebar.settings')}
            isActive={activeView === 'settings'}
            onViewChange={onViewChange}
          />
          {/* Status dot */}
          <div
            className="mx-auto mt-1 flex h-8 w-8 items-center justify-center"
            title={t('sidebar.agent_status', { status: t(`sidebar.status.${agentStatus}`) })}
          >
            <div
              className={cn(
                'h-[7px] w-[7px] rounded-full',
                agentStatus === 'offline'
                  ? 'bg-muted-foreground/40'
                  : agentStatus === 'working'
                    ? 'animate-pulse bg-[#5b7cf6]'
                    : 'animate-pulse bg-[#4caf82] shadow-[0_0_5px_#4caf82]'
              )}
            />
          </div>
        </div>
      </div>
    )
  }

  // ── Expanded: full sidebar with labels ────────────────────────────────────
  return (
    <div className="flex w-[220px] shrink-0 flex-col border-r border-[#1f2024] bg-background py-4">
      {/* ── Collapse toggle ── */}
      <div className="mb-2 flex items-center justify-between px-3 pb-1">
        <p className="mb-1 px-2 font-mono text-[9px] uppercase tracking-[.12em] text-muted-foreground/50">
          {t('sidebar.workspace')}
        </p>
        <button
          onClick={() => setCollapsed(true)}
          title={t('sidebar.collapse')}
          className="rounded p-1 text-muted-foreground/30 transition-colors hover:bg-muted/20 hover:text-muted-foreground"
        >
          <IconCollapse />
        </button>
      </div>

      {/* ── WORKSPACE ── */}
      <div className="mb-2 px-3">
        <nav className="flex flex-col gap-0.5">
          <NavItem
            view="dashboard"
            label={t('sidebar.landscape')}
            icon={<IconLandscape />}
            isActive={activeView === 'dashboard'}
            onViewChange={onViewChange}
          />
          <NavItem
            view="capture"
            label={t('sidebar.capture')}
            icon={<IconCapture />}
            isActive={activeView === 'capture'}
            badge={rawCapturesCount > 0 ? rawCapturesCount : undefined}
            onViewChange={onViewChange}
          />
          <NavItem
            view="schedule"
            label={t('sidebar.schedule')}
            icon={<IconSchedule />}
            isActive={activeView === 'schedule'}
            onViewChange={onViewChange}
          />
        </nav>
      </div>

      <div className="mx-3 my-[10px] h-px bg-[#1f2024]" />

      {/* ── AGENT ── */}
      <div className="px-3">
        <p className="mb-1 px-2 font-mono text-[9px] uppercase tracking-[.12em] text-muted-foreground/50">
          {t('sidebar.agent')}
        </p>
        <nav className="flex flex-col gap-0.5">
          <NavItem
            view="workflows"
            label={t('sidebar.workflows')}
            icon={<IconWorkflows />}
            isActive={activeView === 'workflows'}
            onViewChange={onViewChange}
          />
          <NavItem
            view="takeover"
            label={t('sidebar.takeover')}
            icon={<IconTakeOver />}
            isActive={activeView === 'takeover'}
            onViewChange={onViewChange}
          />
          <NavItem
            view="connections"
            label={t('sidebar.connections')}
            icon={<IconConnections />}
            isActive={activeView === 'connections' || activeView === 'custom-tools'}
            onViewChange={onViewChange}
          />
        </nav>
      </div>

      {/* ── BOTTOM ── */}
      <div className="mt-auto px-3">
        <div className="mb-[10px] h-px bg-[#1f2024]" />

        <NavItem
          view="settings"
          label={t('sidebar.settings')}
          icon={<Settings className="h-[14px] w-[14px]" />}
          isActive={activeView === 'settings'}
          onViewChange={onViewChange}
        />

        {/* Agent status widget */}
        <div className="mt-2 flex items-center gap-2 rounded-[6px] border border-[#1f2024] bg-[#151618] px-2 py-[10px]">
          <div
            className={cn(
              'h-[7px] w-[7px] shrink-0 rounded-full',
              agentStatus === 'offline'
                ? 'bg-muted-foreground/50'
                : agentStatus === 'working'
                  ? 'animate-pulse bg-[#5b7cf6]'
                  : 'animate-pulse bg-[#4caf82] shadow-[0_0_6px_#4caf82]'
            )}
          />
          <span className="text-[11px] text-muted-foreground">
            <strong className="font-medium text-foreground">{t('sidebar.agent')}</strong>
            {' · '}
            {t(`sidebar.status.${agentStatus}`)}
          </span>
        </div>
      </div>
    </div>
  )
}
