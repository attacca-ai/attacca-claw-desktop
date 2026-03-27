// DEPRECATED: LLM Provider onboarding step removed in v1.1
// LLM is now managed through the relay server (managed mode) or BYOK in Settings.
// This file is kept as a placeholder to prevent import errors during migration.
// Safe to delete once all references are removed.

export function LLMProviderStep({ onComplete: _ }: { onComplete: () => void }): React.JSX.Element {
  return (
    <div className="flex flex-1 items-center justify-center p-8">
      <p className="text-muted-foreground">This step has been removed.</p>
    </div>
  )
}
