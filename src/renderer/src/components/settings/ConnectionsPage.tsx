import { useState, useEffect, useRef } from 'react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { Loader2 } from 'lucide-react'
import { useOnboardingStore } from '@/stores/onboarding-store'
import { TOOL_CATEGORIES, normalizeComposioSlugs } from '@/lib/constants'
import { useTranslation } from '@/i18n'
import { ToolCard } from './connections/ToolCard'
import { CatalogPanel } from './connections/CatalogPanel'
import { EscapeHatch } from './connections/EscapeHatch'

interface ConnectionsPageProps {
  onNavigateToCustomTools: (toolName: string) => void
}

// All tools from curated categories
const ALL_CURATED_TOOLS = Object.values(TOOL_CATEGORIES).flatMap((c) => c.tools)

// Curated metadata: emoji + short description (requires t for i18n)
function getToolMetaMap(
  t: (key: string) => string
): Record<string, { emoji: string; label: string; description: string }> {
  return {
    'google-calendar': {
      emoji: '📅',
      label: 'Google Calendar',
      description: t('connections.tool.google_calendar')
    },
    'outlook-calendar': {
      emoji: '📆',
      label: 'Outlook Calendar',
      description: t('connections.tool.outlook_calendar')
    },
    gmail: { emoji: '📧', label: 'Gmail', description: t('connections.tool.gmail') },
    'outlook-email': {
      emoji: '📨',
      label: 'Outlook Mail',
      description: t('connections.tool.outlook_mail')
    },
    clickup: { emoji: '✔️', label: 'ClickUp', description: t('connections.tool.clickup') },
    asana: { emoji: '🔔', label: 'Asana', description: t('connections.tool.asana') },
    trello: { emoji: '🧩', label: 'Trello', description: t('connections.tool.trello') },
    notion: { emoji: '📊', label: 'Notion', description: t('connections.tool.notion') },
    activecollab: {
      emoji: '🟠',
      label: 'ActiveCollab',
      description: t('connections.tool.activecollab')
    },
    'google-drive': {
      emoji: '📁',
      label: 'Google Drive',
      description: t('connections.tool.google_drive')
    },
    onedrive: { emoji: '☁️', label: 'OneDrive', description: t('connections.tool.onedrive') },
    dropbox: { emoji: '📦', label: 'Dropbox', description: t('connections.tool.dropbox') },
    slack: { emoji: '💬', label: 'Slack', description: t('connections.tool.slack') },
    teams: { emoji: '🤝', label: 'Microsoft Teams', description: t('connections.tool.teams') },
    telegram: { emoji: '✈️', label: 'Telegram', description: t('connections.tool.telegram') }
  }
}

function getToolMeta(
  toolId: string,
  toolMetaMap: Record<string, { emoji: string; label: string; description: string }>,
  t: (key: string) => string
): { emoji: string; label: string; description: string } {
  return (
    toolMetaMap[toolId] ?? {
      emoji: toolId.charAt(0).toUpperCase(),
      label: toolId,
      description: t('connections.generic_tool')
    }
  )
}

export function ConnectionsPage({
  onNavigateToCustomTools
}: ConnectionsPageProps): React.JSX.Element {
  const { t } = useTranslation()
  const toolMeta = getToolMetaMap(t)
  const { connectedTools, addConnectedTool, removeConnectedTool } = useOnboardingStore()
  const [connecting, setConnecting] = useState<string | null>(null)
  const [disconnecting, setDisconnecting] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // ActiveCollab dialog state
  const [acDialogOpen, setAcDialogOpen] = useState(false)
  const [acTab, setAcTab] = useState<string>('cloud')
  const [acEmail, setAcEmail] = useState('')
  const [acPassword, setAcPassword] = useState('')
  const [acInstanceUrl, setAcInstanceUrl] = useState('')
  const [acConnecting, setAcConnecting] = useState(false)

  // Load persisted connected tools on mount
  useEffect(() => {
    async function loadConnections(): Promise<void> {
      try {
        const relayApps = await window.api.composio.getConnected()
        const normalized = normalizeComposioSlugs(relayApps)
        for (const app of normalized) addConnectedTool(app)
      } catch {
        // Composio may not be configured
      }
    }
    loadConnections()
  }, [addConnectedTool])

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [])

  const handleConnect = async (tool: string): Promise<void> => {
    if (tool === 'activecollab') {
      setAcDialogOpen(true)
      return
    }

    if (tool === 'telegram') {
      setError(t('connections.telegram_error'))
      return
    }

    setConnecting(tool)
    setError(null)
    try {
      const result = await window.api.composio.initiateOAuth(tool)
      if (!result.success) {
        setError(result.error || t('connections.error_start'))
        setConnecting(null)
        return
      }
      if (!result.redirectUrl || !result.connectionId) {
        setError(t('connections.error_no_redirect'))
        setConnecting(null)
        return
      }
      await window.api.app.openExternal(result.redirectUrl)
      const connectionId = result.connectionId
      pollRef.current = setInterval(async () => {
        try {
          const status = await window.api.composio.getStatus(connectionId)
          if (status.status === 'active') {
            if (pollRef.current) clearInterval(pollRef.current)
            pollRef.current = null
            addConnectedTool(tool)
            setConnecting(null)
            window.api.telemetry.emit('tool.connected', { toolId: tool })
            // Restart gateway so SKILL.md is regenerated with the new tool
            console.log(`[connections] Tool connected: ${tool}, restarting gateway...`)
            window.api.gateway.restart().catch((err: unknown) => {
              console.warn('[connections] Gateway restart after connect failed:', err)
            })
          } else if (status.status === 'failed' || status.status === 'expired') {
            if (pollRef.current) clearInterval(pollRef.current)
            pollRef.current = null
            setError(t('connections.error_status', { status: status.status }))
            setConnecting(null)
          }
        } catch {
          // Keep polling on network errors
        }
      }, 2000)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('connections.error_failed'))
      setConnecting(null)
    }
  }

  const handleActiveCollabConnect = async (): Promise<void> => {
    setAcConnecting(true)
    setError(null)
    try {
      const result =
        acTab === 'cloud'
          ? await window.api.activecollab.connectCloud(acEmail, acPassword)
          : await window.api.activecollab.connectSelfHosted(acInstanceUrl, acEmail, acPassword)
      if (result.success) {
        addConnectedTool('activecollab')
        window.api.telemetry.emit('tool.connected', { toolId: 'activecollab' })
        window.api.gateway.restart().catch((err: unknown) => {
          console.warn('[connections] Gateway restart after ActiveCollab connect failed:', err)
        })
        setAcDialogOpen(false)
        setAcEmail('')
        setAcPassword('')
        setAcInstanceUrl('')
      } else {
        setError(result.error || t('connections.error_activecollab'))
      }
    } catch {
      setError(t('connections.error_activecollab'))
    }
    setAcConnecting(false)
  }

  const handleDisconnect = async (tool: string): Promise<void> => {
    setDisconnecting(tool)
    setError(null)
    let disconnected = false
    try {
      if (tool === 'activecollab') {
        const result = await window.api.activecollab.disconnect()
        if (result.success) disconnected = true
        else setError(result.error || t('connections.error_disconnect'))
      } else {
        // Composio-managed tools — remove from local state
        removeConnectedTool(tool)
        disconnected = true
      }
    } catch {
      setError(t('connections.error_disconnect'))
    }
    if (disconnected) {
      removeConnectedTool(tool)
      window.api.telemetry.emit('tool.disconnected', { toolId: tool })
      console.log(`[connections] Tool disconnected: ${tool}, restarting gateway...`)
      window.api.gateway.restart().catch((err: unknown) => {
        console.warn('[connections] Gateway restart after disconnect failed:', err)
      })
    }
    setDisconnecting(null)
  }

  // Build display sets
  const connectedCurated = ALL_CURATED_TOOLS.filter((t) => connectedTools.includes(t))
  const connectedExtras = connectedTools.filter(
    (t) => !(ALL_CURATED_TOOLS as readonly string[]).includes(t)
  )
  const allConnectedForDisplay = [...connectedCurated, ...connectedExtras]
  const availableCurated = ALL_CURATED_TOOLS.filter((t) => !connectedTools.includes(t))

  return (
    <div className="flex flex-1 overflow-hidden bg-[#0e0f11]">
      {/* ── Main panel ── */}
      <div className="flex flex-1 flex-col overflow-hidden border-r border-[#1f2024]">
        {/* Header */}
        <div className="shrink-0 border-b border-[#1f2024] px-8 py-6">
          <div className="mb-[5px] font-mono text-[9px] uppercase tracking-[.12em] text-[#4a4d55]">
            {t('connections.breadcrumb')}
          </div>
          <h1 className="mb-1 text-[20px] font-light tracking-[-0.01em] text-[#e8e9eb]">
            {t('connections.title')}
          </h1>
          <p className="max-w-[480px] text-[12.5px] leading-[1.5] text-[#7a7d85]">
            {t('connections.desc')}
          </p>
        </div>

        {/* Body */}
        <div
          className="flex-1 overflow-y-auto px-8 py-5"
          style={{ scrollbarWidth: 'thin', scrollbarColor: '#2a2b2f transparent' }}
        >
          {error && (
            <div className="mb-4 max-w-[600px] rounded-md border border-[rgba(224,92,92,.3)] bg-[rgba(224,92,92,.1)] px-3 py-2 text-sm text-[#e05c5c]">
              {error}
            </div>
          )}

          {/* Connected tools */}
          {allConnectedForDisplay.length > 0 && (
            <section className="mb-6">
              <SectionLabel>{t('connections.connected')}</SectionLabel>
              <div className="grid max-w-[600px] grid-cols-2 gap-2">
                {allConnectedForDisplay.map((tool) => {
                  const meta = getToolMeta(tool, toolMeta, t)
                  return (
                    <ToolCard
                      key={tool}
                      toolId={tool}
                      label={meta.label}
                      description={meta.description}
                      emoji={meta.emoji}
                      isConnected={true}
                      isConnecting={connecting === tool}
                      isDisconnecting={disconnecting === tool}
                      onConnect={() => handleConnect(tool)}
                      onDisconnect={() => handleDisconnect(tool)}
                    />
                  )
                })}
              </div>
            </section>
          )}

          {/* Available curated tools */}
          {availableCurated.length > 0 && (
            <section className="mb-6">
              <SectionLabel>{t('connections.add_catalog')}</SectionLabel>
              <div className="grid max-w-[600px] grid-cols-2 gap-2">
                {availableCurated.map((tool) => {
                  const meta = getToolMeta(tool, toolMeta, t)
                  return (
                    <ToolCard
                      key={tool}
                      toolId={tool}
                      label={meta.label}
                      description={meta.description}
                      emoji={meta.emoji}
                      isConnected={false}
                      isConnecting={connecting === tool}
                      isDisconnecting={false}
                      onConnect={() => handleConnect(tool)}
                      onDisconnect={() => handleDisconnect(tool)}
                    />
                  )
                })}
              </div>
            </section>
          )}

          {/* Escape hatch */}
          <section>
            <SectionLabel>{t('connections.not_found')}</SectionLabel>
            <EscapeHatch onClick={() => onNavigateToCustomTools('')} />
          </section>
        </div>
      </div>

      {/* ── Catalog panel (right) ── */}
      <CatalogPanel
        connectedTools={connectedTools}
        onConnectTool={handleConnect}
        onNavigateToCustomTools={onNavigateToCustomTools}
      />

      {/* ActiveCollab dialog */}
      <Dialog open={acDialogOpen} onOpenChange={setAcDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('connections.activecollab.title')}</DialogTitle>
            <DialogDescription>{t('connections.activecollab.desc')}</DialogDescription>
          </DialogHeader>
          <Tabs value={acTab} onValueChange={setAcTab}>
            <TabsList className="w-full">
              <TabsTrigger value="cloud" className="flex-1">
                {t('connections.activecollab.cloud')}
              </TabsTrigger>
              <TabsTrigger value="selfhosted" className="flex-1">
                {t('connections.activecollab.selfhosted')}
              </TabsTrigger>
            </TabsList>
            <TabsContent value="cloud" className="mt-4 flex flex-col gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="ac-cloud-email">{t('connections.activecollab.email')}</Label>
                <Input
                  id="ac-cloud-email"
                  type="email"
                  value={acEmail}
                  onChange={(e) => setAcEmail(e.target.value)}
                  placeholder={t('connections.activecollab.email_placeholder')}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="ac-cloud-password">{t('connections.activecollab.password')}</Label>
                <Input
                  id="ac-cloud-password"
                  type="password"
                  value={acPassword}
                  onChange={(e) => setAcPassword(e.target.value)}
                />
              </div>
            </TabsContent>
            <TabsContent value="selfhosted" className="mt-4 flex flex-col gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="ac-sh-url">{t('connections.activecollab.instance_url')}</Label>
                <Input
                  id="ac-sh-url"
                  type="url"
                  value={acInstanceUrl}
                  onChange={(e) => setAcInstanceUrl(e.target.value)}
                  placeholder={t('connections.activecollab.instance_placeholder')}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="ac-sh-email">{t('connections.activecollab.email')}</Label>
                <Input
                  id="ac-sh-email"
                  type="email"
                  value={acEmail}
                  onChange={(e) => setAcEmail(e.target.value)}
                  placeholder={t('connections.activecollab.email_placeholder')}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="ac-sh-password">{t('connections.activecollab.password')}</Label>
                <Input
                  id="ac-sh-password"
                  type="password"
                  value={acPassword}
                  onChange={(e) => setAcPassword(e.target.value)}
                />
              </div>
            </TabsContent>
          </Tabs>
          <DialogFooter>
            <Button
              onClick={handleActiveCollabConnect}
              disabled={
                acConnecting ||
                !acEmail ||
                !acPassword ||
                (acTab === 'selfhosted' && !acInstanceUrl)
              }
            >
              {acConnecting ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : null}
              {t('connections.activecollab.connect')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="mb-[10px] flex items-center gap-2 font-mono text-[9px] uppercase tracking-[.12em] text-[#4a4d55]">
      {children}
      <span className="h-px flex-1 bg-[#1f2024]" />
    </div>
  )
}
