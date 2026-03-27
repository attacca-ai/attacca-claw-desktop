import { ExternalLink } from 'lucide-react'

const GUIDES: Record<string, { steps: string[]; url: string }> = {
  anthropic: {
    steps: [
      'Go to console.anthropic.com',
      'Navigate to Settings > API Keys',
      'Click "Create Key"',
      'Copy the key and paste it below'
    ],
    url: 'https://console.anthropic.com/settings/keys'
  },
  openai: {
    steps: [
      'Go to platform.openai.com',
      'Navigate to API Keys',
      'Click "Create new secret key"',
      'Copy the key and paste it below'
    ],
    url: 'https://platform.openai.com/api-keys'
  },
  google: {
    steps: [
      'Go to Google AI Studio',
      'Click "Get API key"',
      'Create a key for your project',
      'Copy the key and paste it below'
    ],
    url: 'https://aistudio.google.com/apikey'
  }
}

export function BYOKGuide({ provider }: { provider: string }): React.JSX.Element | null {
  const guide = GUIDES[provider]
  if (!guide) return null

  return (
    <div className="rounded-md border border-border bg-muted/30 p-3">
      <div className="mb-2 flex items-center justify-between">
        <h4 className="text-sm font-medium text-foreground">Setup instructions</h4>
        <button
          onClick={() => window.api.app.openExternal(guide.url)}
          className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
        >
          <ExternalLink className="h-3 w-3" />
          Open
        </button>
      </div>
      <ol className="space-y-1 text-sm text-muted-foreground">
        {guide.steps.map((step, i) => (
          <li key={i} className="flex gap-2">
            <span className="shrink-0 font-mono text-xs text-muted-foreground/70">{i + 1}.</span>
            {step}
          </li>
        ))}
      </ol>
    </div>
  )
}
