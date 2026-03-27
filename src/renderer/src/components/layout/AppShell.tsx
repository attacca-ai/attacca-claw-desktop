import { useState, useRef, useEffect, useMemo } from 'react'
import { TitleBar } from './TitleBar'
import { Sidebar, type SidebarView } from './Sidebar'
import { OfflineBanner } from '@/components/shared/OfflineBanner'
import { ErrorBoundary } from '@/components/shared/ErrorBoundary'
import { Dashboard } from '@/components/dashboard/Dashboard'
import { ScheduleView } from '@/components/features/ScheduleView'
import { WorkflowAdder } from '@/components/features/WorkflowAdder'
import { TakeOverMode } from '@/components/features/TakeOverMode'
import { MetaAgent } from '@/components/features/MetaAgent'
import { SettingsPage } from '@/components/settings/SettingsPage'
import { ConnectionsPage } from '@/components/settings/ConnectionsPage'
import { CustomToolsPage } from '@/components/custom-tools/CustomToolsPage'
import { CaptureView } from '@/components/features/CaptureView'
import { ApprovalDialog } from '@/components/permissions/ApprovalDialog'
import { MidRiskNotification } from '@/components/permissions/MidRiskNotification'
import { usePermissionStore } from '@/stores/permission-store'
import type { RiskTier } from '@/lib/permission-engine'

export function AppShell(): React.JSX.Element {
  const [activeView, setActiveView] = useState<SidebarView>('dashboard')
  const [customToolName, setCustomToolName] = useState<string>('')
  const prevViewRef = useRef<SidebarView>('dashboard')
  const pendingApprovals = usePermissionStore((s) => s.pendingApprovals)
  const midRiskApprovals = useMemo(
    () => pendingApprovals.filter((a) => a.tier === 'medium'),
    [pendingApprovals]
  )

  useEffect(() => {
    const prev = prevViewRef.current
    if (prev !== activeView) {
      window.api.telemetry.emit('feature.viewed', { view: activeView, previousView: prev })
      prevViewRef.current = activeView
    }
  }, [activeView])

  // Listen for permission requests from the main process (Composio server)
  useEffect(() => {
    const unsub = window.api.permission.onRequest((request) => {
      const { isStandingApprovalActive, addPendingApproval } = usePermissionStore.getState()

      // Check renderer-side standing approval first
      if (isStandingApprovalActive(request.actionName, request.toolkit)) {
        window.api.permission.resolve(request.requestId, true, false)
        return
      }

      addPendingApproval(
        {
          actionType: request.actionName,
          toolId: request.toolkit,
          tier: request.tier as RiskTier,
          description: request.description,
          params: request.params
        },
        request.requestId
      )
    })
    return unsub
  }, [])

  const handleNavigateToCustomTools = (toolName: string): void => {
    setCustomToolName(toolName)
    setActiveView('custom-tools')
  }

  return (
    <div className="flex h-screen flex-col bg-background">
      <TitleBar />
      <OfflineBanner />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar activeView={activeView} onViewChange={setActiveView} />
        <main className="flex flex-1 flex-col overflow-hidden">
          <ErrorBoundary>
            {activeView === 'dashboard' && <Dashboard />}
            {activeView === 'capture' && <CaptureView />}
            {activeView === 'schedule' && <ScheduleView />}
            {activeView === 'workflows' && <WorkflowAdder />}
            {activeView === 'takeover' && <TakeOverMode />}
            {activeView === 'meta-agent' && <MetaAgent />}
            {activeView === 'settings' && <SettingsPage />}
            {activeView === 'connections' && (
              <ConnectionsPage onNavigateToCustomTools={handleNavigateToCustomTools} />
            )}
            {activeView === 'custom-tools' && (
              <CustomToolsPage
                initialToolName={customToolName}
                onBack={() => setActiveView('connections')}
              />
            )}
          </ErrorBoundary>
        </main>
      </div>

      {/* Permission UI — renders globally so it works from any view */}
      <ApprovalDialog />
      {midRiskApprovals.map((a) => (
        <div key={a.id} className="fixed bottom-4 right-4 z-50 w-96">
          <MidRiskNotification approval={a} />
        </div>
      ))}
    </div>
  )
}
