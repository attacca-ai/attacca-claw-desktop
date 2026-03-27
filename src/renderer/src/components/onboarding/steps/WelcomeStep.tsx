import { useOnboardingStore } from '@/stores/onboarding-store'
import { Button } from '@/components/ui/button'
import { Sparkles } from 'lucide-react'

export function WelcomeStep({ onComplete: _ }: { onComplete: () => void }): React.JSX.Element {
  const nextStep = useOnboardingStore((s) => s.nextStep)

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-8 p-8">
      <div className="flex h-20 w-20 items-center justify-center rounded-2xl bg-primary/10">
        <Sparkles className="h-10 w-10 text-primary" />
      </div>

      <div className="max-w-lg text-center">
        <h1 className="mb-4 text-3xl font-bold tracking-tight text-foreground">
          Welcome to Attacca
        </h1>
        <p className="mb-2 text-lg text-muted-foreground">
          Your AI work assistant that helps you focus on what matters.
        </p>
        <p className="text-muted-foreground">
          Attacca connects your calendar, email, and project tools into one place, then works
          through your tasks under your supervision — so you can focus on the work that truly needs
          you.
        </p>
      </div>

      <div className="flex max-w-md flex-col gap-3 text-sm text-muted-foreground">
        <div className="flex items-start gap-3">
          <div className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
          <span>Processes meeting transcripts into action items and deliverables</span>
        </div>
        <div className="flex items-start gap-3">
          <div className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
          <span>Triages your email and drafts responses for your review</span>
        </div>
        <div className="flex items-start gap-3">
          <div className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
          <span>Keeps your project boards and calendar in sync</span>
        </div>
      </div>

      <Button size="lg" onClick={nextStep} className="mt-4">
        Get Started
      </Button>
    </div>
  )
}
