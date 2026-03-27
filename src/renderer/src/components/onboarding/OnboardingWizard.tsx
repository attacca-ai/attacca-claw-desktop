import { useEffect } from 'react'
import { useOnboardingStore } from '@/stores/onboarding-store'
import { Progress } from '@/components/ui/progress'
import { WelcomeStep } from './steps/WelcomeStep'
import { ToolConnectionStep } from './steps/ToolConnectionStep'
import { TelemetryConsentStep } from './steps/TelemetryConsentStep'
import { UseCaseStep } from './steps/UseCaseStep'
import { CompletionStep } from './steps/CompletionStep'

const STEPS = [
  { title: 'Welcome', component: WelcomeStep },
  { title: 'Connect Tools', component: ToolConnectionStep },
  { title: 'Telemetry', component: TelemetryConsentStep },
  { title: 'Use Cases', component: UseCaseStep },
  { title: 'Ready', component: CompletionStep }
]

export function OnboardingWizard({ onComplete }: { onComplete: () => void }): React.JSX.Element {
  const { currentStep, loadState } = useOnboardingStore()

  useEffect(() => {
    loadState()
  }, [loadState])

  const progress = ((currentStep + 1) / STEPS.length) * 100
  const CurrentStepComponent = STEPS[currentStep]?.component ?? WelcomeStep

  return (
    <div className="flex h-screen flex-col bg-background">
      {/* Title bar drag region */}
      <div
        className="flex h-9 shrink-0 items-center border-b border-border px-4"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      >
        <span className="text-sm font-medium text-foreground">Attacca — Setup</span>
      </div>

      {/* Progress bar */}
      <div className="border-b border-border px-8 py-3">
        <div className="flex items-center justify-between pb-2">
          {STEPS.map((step, i) => (
            <span
              key={step.title}
              className={`text-xs ${
                i === currentStep
                  ? 'font-medium text-foreground'
                  : i < currentStep
                    ? 'text-muted-foreground'
                    : 'text-muted-foreground/50'
              }`}
            >
              {step.title}
            </span>
          ))}
        </div>
        <Progress value={progress} className="h-1" />
      </div>

      {/* Step content */}
      <div className="flex flex-1 overflow-auto">
        <CurrentStepComponent onComplete={onComplete} />
      </div>
    </div>
  )
}
