import { useOnboardingStore } from '@/stores/onboarding-store'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Check, Rocket } from 'lucide-react'

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
  telegram: 'Telegram'
}

export function CompletionStep({ onComplete }: { onComplete: () => void }): React.JSX.Element {
  const { connectedTools, selectedUseCases, telemetryOptIn, complete } = useOnboardingStore()

  const handleStart = async (): Promise<void> => {
    await complete()
    onComplete()
  }

  return (
    <div className="flex flex-1 flex-col items-center justify-center p-8">
      <div className="mx-auto w-full max-w-md">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-green-500/10">
            <Rocket className="h-8 w-8 text-green-500" />
          </div>
          <h2 className="mb-2 text-2xl font-bold text-foreground">You're all set!</h2>
          <p className="text-muted-foreground">
            Here's a summary of your setup. You can change any of these in Settings later.
          </p>
        </div>

        <div className="mb-8 flex flex-col gap-4">
          {/* Connected Tools */}
          <div className="rounded-md border border-border p-3">
            <div className="mb-2 flex items-center gap-2 text-sm">
              <Check className="h-4 w-4 text-green-500" />
              <span className="text-muted-foreground">
                Connected Tools ({connectedTools.length})
              </span>
            </div>
            <div className="flex flex-wrap gap-1">
              {connectedTools.map((tool) => (
                <Badge key={tool} variant="outline" className="text-xs">
                  {TOOL_NAMES[tool] || tool}
                </Badge>
              ))}
            </div>
          </div>

          {/* Telemetry Status */}
          <div className="flex items-center justify-between rounded-md border border-border p-3">
            <div className="flex items-center gap-2 text-sm">
              <Check className="h-4 w-4 text-green-500" />
              <span className="text-muted-foreground">Research Telemetry</span>
            </div>
            <Badge variant="secondary">{telemetryOptIn ? 'Opted in' : 'Opted out'}</Badge>
          </div>

          {/* Selected Workflow */}
          {selectedUseCases.length > 0 && (
            <div className="rounded-md border border-border p-3">
              <div className="mb-2 flex items-center gap-2 text-sm">
                <Check className="h-4 w-4 text-green-500" />
                <span className="text-muted-foreground">Active Workflow</span>
              </div>
              <p className="text-sm text-foreground">{selectedUseCases[0]}</p>
            </div>
          )}
        </div>

        <Button size="lg" onClick={handleStart} className="w-full">
          Start Using Attacca
        </Button>
      </div>
    </div>
  )
}
