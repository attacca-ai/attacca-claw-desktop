import { useState, useEffect, useRef } from 'react'
import { useOnboardingStore } from '@/stores/onboarding-store'
import { TOOL_CATEGORIES, normalizeComposioSlugs } from '@/lib/constants'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  ArrowLeft,
  ArrowRight,
  Loader2,
  Check,
  Calendar,
  Mail,
  FolderKanban,
  HardDrive,
  MessageSquare
} from 'lucide-react'

const CATEGORY_ICONS: Record<string, React.ReactNode> = {
  calendar: <Calendar className="h-4 w-4" />,
  email: <Mail className="h-4 w-4" />,
  pm: <FolderKanban className="h-4 w-4" />,
  storage: <HardDrive className="h-4 w-4" />,
  communication: <MessageSquare className="h-4 w-4" />
}

const TOOL_NAMES: Record<string, string> = {
  'google-calendar': 'Google Calendar',
  'outlook-calendar': 'Outlook Calendar',
  gmail: 'Gmail',
  'outlook-email': 'Outlook',
  clickup: 'ClickUp',
  asana: 'Asana',
  trello: 'Trello',
  notion: 'Notion',
  'google-drive': 'Google Drive',
  onedrive: 'OneDrive',
  dropbox: 'Dropbox',
  slack: 'Slack',
  teams: 'Microsoft Teams',
  telegram: 'Telegram',
  activecollab: 'ActiveCollab'
}

export function ToolConnectionStep({
  onComplete: _
}: {
  onComplete: () => void
}): React.JSX.Element {
  const { connectedTools, addConnectedTool, nextStep, prevStep } = useOnboardingStore()
  const [connecting, setConnecting] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Load relay-reported Composio connections + local credential connections on mount
  useEffect(() => {
    async function loadConnections(): Promise<void> {
      try {
        // Get Composio connections
        const relayApps = await window.api.composio.getConnected()
        const normalized = normalizeComposioSlugs(relayApps)
        for (const app of normalized) {
          addConnectedTool(app)
        }
      } catch {
        // Relay may not be available yet
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
    // ActiveCollab requires credential input — skip during onboarding
    if (tool === 'activecollab') {
      setError('ActiveCollab requires email and password. Connect it in Settings after onboarding.')
      return
    }

    // Telegram uses bot token flow — connect in Settings
    if (tool === 'telegram') {
      setError('Telegram requires a bot token. Connect it in Settings after onboarding.')
      return
    }

    // All other tools use Composio via relay
    setConnecting(tool)
    setError(null)

    try {
      const result = await window.api.composio.initiateOAuth(tool)
      if (!result.success) {
        setError(result.error || 'Could not start connection')
        setConnecting(null)
        return
      }

      // Open the OAuth URL in the browser
      if (!result.redirectUrl || !result.connectionId) {
        setError('Missing redirect URL or connection ID')
        setConnecting(null)
        return
      }
      await window.api.app.openExternal(result.redirectUrl)

      // Poll for completion
      const connectionId = result.connectionId
      pollRef.current = setInterval(async () => {
        try {
          const status = await window.api.composio.getStatus(connectionId)
          if (status.status === 'active') {
            if (pollRef.current) clearInterval(pollRef.current)
            pollRef.current = null
            addConnectedTool(tool)
            setConnecting(null)
            // Restart gateway so SKILL.md is regenerated with the new tool
            window.api.gateway.restart().catch((err: unknown) => {
              console.warn('[onboarding] Gateway restart after connect failed:', err)
            })
          } else if (status.status === 'failed' || status.status === 'expired') {
            if (pollRef.current) clearInterval(pollRef.current)
            pollRef.current = null
            setError(`Connection ${status.status}. Please try again.`)
            setConnecting(null)
          }
        } catch {
          // Keep polling on network errors
        }
      }, 2000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connection failed')
      setConnecting(null)
    }
  }

  // Check minimum requirement: 2 tools from 2 different categories
  const connectedCategories = new Set<string>()
  for (const [catKey, cat] of Object.entries(TOOL_CATEGORIES)) {
    if (cat.tools.some((t) => connectedTools.includes(t))) {
      connectedCategories.add(catKey)
    }
  }
  const canProceed = connectedTools.length >= 2 && connectedCategories.size >= 2

  return (
    <div className="flex flex-1 flex-col p-8">
      <div className="mx-auto w-full max-w-2xl">
        <h2 className="mb-2 text-2xl font-bold text-foreground">Connect your tools</h2>
        <p className="mb-1 text-muted-foreground">
          Connect at least 2 tools from 2 different categories so your assistant knows where to
          work.
        </p>
        {!canProceed && (
          <p className="mb-6 text-sm text-muted-foreground">
            {connectedTools.length}/2 tools connected, {connectedCategories.size}/2 categories
          </p>
        )}
        {canProceed && (
          <p className="mb-6 text-sm text-green-600 dark:text-green-400">
            Requirements met! You can connect more tools or continue.
          </p>
        )}

        {error && (
          <div className="mb-4 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
            {error}
          </div>
        )}

        <div className="flex flex-col gap-6">
          {(
            Object.entries(TOOL_CATEGORIES) as [
              string,
              { name: string; tools: readonly string[] }
            ][]
          ).map(([catKey, category]) => (
            <div key={catKey}>
              <div className="mb-2 flex items-center gap-2 text-sm font-medium text-foreground">
                {CATEGORY_ICONS[catKey]}
                {category.name}
              </div>
              <div className="grid grid-cols-2 gap-2">
                {category.tools.map((tool) => {
                  const isConnected = connectedTools.includes(tool)
                  const isConnecting = connecting === tool

                  return (
                    <button
                      key={tool}
                      onClick={() => !isConnected && !isConnecting && handleConnect(tool)}
                      disabled={isConnected || isConnecting}
                      className={`flex items-center justify-between rounded-md border p-3 text-left text-sm transition-colors ${
                        isConnected
                          ? 'border-green-500/30 bg-green-500/10'
                          : 'border-border hover:border-muted-foreground/30'
                      }`}
                    >
                      <span className={isConnected ? 'text-foreground' : 'text-muted-foreground'}>
                        {TOOL_NAMES[tool] || tool}
                      </span>
                      {isConnecting ? (
                        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                      ) : isConnected ? (
                        <Badge
                          variant="outline"
                          className="border-green-500/30 text-green-600 dark:text-green-400"
                        >
                          <Check className="mr-1 h-3 w-3" />
                          Connected
                        </Badge>
                      ) : (
                        <Badge variant="outline">Connect</Badge>
                      )}
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Navigation */}
      <div className="mx-auto mt-auto flex w-full max-w-2xl items-center justify-between pt-6">
        <Button variant="ghost" onClick={prevStep}>
          <ArrowLeft className="h-4 w-4" />
          Back
        </Button>
        <Button onClick={nextStep} disabled={!canProceed}>
          Next
          <ArrowRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}
