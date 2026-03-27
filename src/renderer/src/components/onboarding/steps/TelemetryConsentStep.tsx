import { useOnboardingStore } from '@/stores/onboarding-store'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { ArrowLeft, ArrowRight, BarChart3, ShieldCheck } from 'lucide-react'

export function TelemetryConsentStep({
  onComplete: _
}: {
  onComplete: () => void
}): React.JSX.Element {
  const { telemetryOptIn, setTelemetryOptIn, nextStep, prevStep } = useOnboardingStore()

  return (
    <div className="flex flex-1 flex-col p-8">
      <div className="mx-auto w-full max-w-lg">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
            <BarChart3 className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h2 className="text-2xl font-bold text-foreground">Help improve Attacca</h2>
            <p className="text-muted-foreground">Opt in to anonymous research telemetry</p>
          </div>
        </div>

        <div className="mb-6 rounded-lg border border-border p-4">
          <div className="mb-4 flex items-center justify-between">
            <Label htmlFor="telemetry-toggle" className="text-base font-medium">
              Share anonymous usage data
            </Label>
            <Switch
              id="telemetry-toggle"
              checked={telemetryOptIn}
              onCheckedChange={setTelemetryOptIn}
            />
          </div>

          <div className="space-y-4 text-sm text-muted-foreground">
            <div>
              <div className="mb-1 flex items-center gap-1.5 font-medium text-foreground">
                <ShieldCheck className="h-4 w-4 text-green-500" />
                What we collect
              </div>
              <ul className="ml-5.5 list-disc space-y-1 pl-1">
                <li>Which permission tiers are approved or denied</li>
                <li>Trust profile changes</li>
                <li>Task completion and failure rates</li>
                <li>Feature usage patterns (e.g., Take Over mode, Activity Feed)</li>
              </ul>
            </div>

            <div>
              <div className="mb-1 flex items-center gap-1.5 font-medium text-foreground">
                <ShieldCheck className="h-4 w-4 text-green-500" />
                What we never collect
              </div>
              <ul className="ml-5.5 list-disc space-y-1 pl-1">
                <li>Email content, calendar events, or task details</li>
                <li>File contents or names</li>
                <li>Messages or conversation content</li>
                <li>Personal identifiers, IP addresses, or device IDs</li>
              </ul>
            </div>

            <p className="text-xs">
              Your identity is anonymized using a one-way hash. You can change this setting or
              delete your data at any time in Settings.
            </p>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <div className="mx-auto mt-auto flex w-full max-w-lg items-center justify-between pt-6">
        <Button variant="ghost" onClick={prevStep}>
          <ArrowLeft className="h-4 w-4" />
          Back
        </Button>
        <Button onClick={nextStep}>
          Next
          <ArrowRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}
