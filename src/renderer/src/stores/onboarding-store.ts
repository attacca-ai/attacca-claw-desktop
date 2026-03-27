import { create } from 'zustand'

export interface OnboardingState {
  currentStep: number
  connectedTools: string[]
  selectedUseCases: string[]
  telemetryOptIn: boolean
  completed: boolean
}

interface OnboardingStore extends OnboardingState {
  setStep: (step: number) => void
  nextStep: () => void
  prevStep: () => void
  addConnectedTool: (tool: string) => void
  removeConnectedTool: (tool: string) => void
  setSelectedUseCases: (useCases: string[]) => void
  setTelemetryOptIn: (optIn: boolean) => void
  complete: () => void
  loadState: () => Promise<void>
  persist: () => Promise<void>
}

const TOTAL_STEPS = 5

export const useOnboardingStore = create<OnboardingStore>((set, get) => ({
  currentStep: 0,
  connectedTools: [],
  selectedUseCases: [],
  telemetryOptIn: false,
  completed: false,

  setStep: (step) => {
    set({ currentStep: Math.max(0, Math.min(step, TOTAL_STEPS - 1)) })
    get().persist()
  },

  nextStep: () => {
    const { currentStep } = get()
    if (currentStep < TOTAL_STEPS - 1) {
      set({ currentStep: currentStep + 1 })
      get().persist()
    }
  },

  prevStep: () => {
    const { currentStep } = get()
    if (currentStep > 0) {
      set({ currentStep: currentStep - 1 })
      get().persist()
    }
  },

  addConnectedTool: (tool) => {
    const { connectedTools } = get()
    if (!connectedTools.includes(tool)) {
      set({ connectedTools: [...connectedTools, tool] })
      get().persist()
    }
  },

  removeConnectedTool: (tool) => {
    set({ connectedTools: get().connectedTools.filter((t) => t !== tool) })
    get().persist()
  },

  setSelectedUseCases: (useCases) => {
    set({ selectedUseCases: useCases })
    get().persist()
  },

  setTelemetryOptIn: (optIn) => {
    set({ telemetryOptIn: optIn })
    get().persist()
  },

  complete: async () => {
    set({ completed: true })
    // Persist telemetry consent to the main process
    const { telemetryOptIn } = get()
    await window.api.telemetry.setOptIn(telemetryOptIn)
    await window.api.onboarding.complete()
  },

  loadState: async () => {
    const state = await window.api.onboarding.getState()
    if (state) {
      set({
        currentStep: state.currentStep ?? 0,
        connectedTools: state.connectedTools ?? [],
        selectedUseCases: state.selectedUseCases ?? [],
        telemetryOptIn: state.telemetryOptIn ?? false,
        completed: state.completed ?? false
      })
    }
  },

  persist: async () => {
    const { currentStep, connectedTools, selectedUseCases, telemetryOptIn, completed } = get()

    await window.api.onboarding.saveState({
      currentStep,
      connectedTools,
      selectedUseCases,
      telemetryOptIn,
      completed
    })
  }
}))
