export interface OnboardingState {
  currentStep: number
  connectedTools: string[]
  selectedUseCases: string[]
  telemetryOptIn: boolean
  completed: boolean
}

export type OnboardingStep =
  | 'welcome'
  | 'tool-connection'
  | 'telemetry-consent'
  | 'use-case'
  | 'completion'
