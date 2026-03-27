import { useState, useEffect } from 'react'
import { useOnboardingStore } from '@/stores/onboarding-store'
import { gatewayClient } from '@/lib/gateway-client'
import { useGatewayStore } from '@/stores/gateway-store'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ArrowLeft, ArrowRight, Loader2, RefreshCw, MessageSquare } from 'lucide-react'

interface UseCase {
  title: string
  description: string
}

export function UseCaseStep({ onComplete: _ }: { onComplete: () => void }): React.JSX.Element {
  const { connectedTools, setSelectedUseCases, nextStep, prevStep } = useOnboardingStore()
  const connectionState = useGatewayStore((s) => s.connectionState)

  const [useCases, setUseCases] = useState<UseCase[]>([])
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)
  const [showCustomInput, setShowCustomInput] = useState(false)
  const [customDescription, setCustomDescription] = useState('')
  const [error, setError] = useState<string | null>(null)

  const generateUseCases = async (): Promise<void> => {
    setLoading(true)
    setError(null)
    setUseCases([])
    setSelectedIndex(null)

    try {
      if (connectionState === 'connected') {
        const result = await gatewayClient.rpc<{ useCases: UseCase[] }>('agent.request', {
          prompt: `Based on these connected productivity tools: ${connectedTools.join(', ')}, generate exactly 3 concrete use case proposals. Each should describe what the agent will do, which tools it will use, and give a specific example scenario. Return as JSON: { "useCases": [{ "title": string, "description": string }] }`
        })
        if (result.useCases?.length) {
          setUseCases(result.useCases)
          return
        }
      }

      // Fallback: generate locally based on connected tools
      setUseCases(generateFallbackUseCases(connectedTools))
    } catch {
      // Use fallback use cases if gateway is not available
      setUseCases(generateFallbackUseCases(connectedTools))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    generateUseCases()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const handleCustomSubmit = async (): Promise<void> => {
    if (!customDescription.trim()) return

    setLoading(true)
    setError(null)

    try {
      if (connectionState === 'connected') {
        const result = await gatewayClient.rpc<{ useCases: UseCase[] }>('agent.request', {
          prompt: `The user described their workflow: "${customDescription}". Connected tools: ${connectedTools.join(', ')}. Generate 1 custom use case proposal that matches their description. Return as JSON: { "useCases": [{ "title": string, "description": string }] }`
        })
        if (result.useCases?.length) {
          setUseCases(result.useCases)
          setShowCustomInput(false)
          setSelectedIndex(0)
          setLoading(false)
          return
        }
      }

      // Fallback
      setUseCases([
        {
          title: 'Custom Workflow',
          description: `Based on your description: "${customDescription}". I'll use your connected tools (${connectedTools.join(', ')}) to automate this workflow, handling tasks, communications, and scheduling under your supervision.`
        }
      ])
      setShowCustomInput(false)
      setSelectedIndex(0)
    } catch {
      setError('Could not generate custom use case. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const handleSelect = (index: number): void => {
    setSelectedIndex(index)
    setSelectedUseCases([useCases[index].title])
  }

  const canProceed = selectedIndex !== null

  return (
    <div className="flex flex-1 flex-col p-8">
      <div className="mx-auto w-full max-w-2xl">
        <h2 className="mb-2 text-2xl font-bold text-foreground">How can your assistant help?</h2>
        <p className="mb-6 text-muted-foreground">
          Based on your connected tools, here are some workflows your assistant can handle. Pick one
          to get started — you can always add more later.
        </p>

        {error && (
          <div className="mb-4 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
            {error}
          </div>
        )}

        {loading ? (
          <div className="flex flex-col items-center gap-4 py-12">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              Analyzing your tools and generating suggestions...
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {useCases.map((uc, i) => (
              <Card
                key={i}
                className={`cursor-pointer transition-colors ${
                  selectedIndex === i
                    ? 'border-primary bg-primary/5'
                    : 'hover:border-muted-foreground/30'
                }`}
                onClick={() => handleSelect(i)}
              >
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">{uc.title}</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground">{uc.description}</p>
                </CardContent>
              </Card>
            ))}

            {/* Custom workflow option */}
            {!showCustomInput ? (
              <button
                onClick={() => setShowCustomInput(true)}
                className="flex items-center gap-2 rounded-md border border-dashed border-border p-4 text-left text-sm text-muted-foreground transition-colors hover:border-muted-foreground/30 hover:text-foreground"
              >
                <MessageSquare className="h-4 w-4 shrink-0" />
                <span>Describe what you do — I'll create a custom workflow for you</span>
              </button>
            ) : (
              <div className="flex flex-col gap-3 rounded-md border border-border p-4">
                <p className="text-sm font-medium text-foreground">Describe your daily workflow</p>
                <textarea
                  value={customDescription}
                  onChange={(e) => setCustomDescription(e.target.value)}
                  placeholder="I spend most of my day..."
                  className="min-h-[100px] w-full resize-none rounded-md border border-input bg-background p-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                />
                <div className="flex justify-end gap-2">
                  <Button variant="ghost" size="sm" onClick={() => setShowCustomInput(false)}>
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    onClick={handleCustomSubmit}
                    disabled={!customDescription.trim()}
                  >
                    Generate Workflow
                  </Button>
                </div>
              </div>
            )}

            {useCases.length > 0 && (
              <button
                onClick={generateUseCases}
                className="flex items-center justify-center gap-1 text-xs text-muted-foreground hover:text-foreground"
              >
                <RefreshCw className="h-3 w-3" />
                Regenerate suggestions
              </button>
            )}
          </div>
        )}
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

function generateFallbackUseCases(tools: string[]): UseCase[] {
  const cases: UseCase[] = []

  const hasCalendar = tools.some((t) => t.includes('calendar'))
  const hasEmail = tools.some((t) => t.includes('mail') || t.includes('outlook-email'))
  const hasPM = tools.some((t) => ['clickup', 'asana', 'trello', 'notion'].includes(t))
  const hasStorage = tools.some((t) => ['google-drive', 'onedrive', 'dropbox'].includes(t))

  if (hasEmail && hasCalendar) {
    cases.push({
      title: 'Meeting Prep & Follow-Up',
      description:
        "I'll review your upcoming meetings, pull relevant emails and context, prepare briefing notes, and after each meeting, process any transcripts to extract action items and draft follow-up emails. For example, before your Monday team sync, you'll see a summary of what each team member has been working on."
    })
  }

  if (hasEmail && hasPM) {
    cases.push({
      title: 'Email Triage & Task Creation',
      description:
        "I'll monitor your inbox, identify emails that need action, draft responses for your review, and create tasks in your project board for any action items. For example, when a client emails requesting a proposal, I'll create the task with the deadline and draft an acknowledgment email."
    })
  }

  if (hasCalendar && hasPM) {
    cases.push({
      title: 'Schedule & Task Synchronization',
      description:
        "I'll keep your calendar and project board in sync, flag scheduling conflicts, suggest time blocks for deep work on high-priority tasks, and send you a daily briefing of what's ahead. For example, if a task is due Friday but you have no time blocked for it, I'll suggest rearranging your schedule."
    })
  }

  if (hasStorage && hasEmail) {
    cases.push({
      title: 'Document Processing & Distribution',
      description:
        "I'll monitor your file storage for new documents, process meeting transcripts and reports, create deliverables from your notes, and distribute them via email. For example, after you upload meeting notes, I'll create a formatted summary and email it to all attendees."
    })
  }

  // Ensure at least 3 use cases
  while (cases.length < 3) {
    cases.push({
      title: 'Daily Productivity Assistant',
      description: `Using your connected tools (${tools.join(', ')}), I'll manage your daily workflow: morning briefing with priorities, real-time task management, email drafting, and an end-of-day summary. Everything happens under your supervision with full visibility.`
    })
  }

  return cases.slice(0, 3)
}
