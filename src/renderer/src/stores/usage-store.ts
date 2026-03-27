import { create } from 'zustand'

interface UsageStore {
  costUsd: number
  requestCount: number
  models: Record<string, number>
  budgetAlert: number | null
  loading: boolean

  fetchUsage: () => Promise<void>
}

export const useUsageStore = create<UsageStore>((set) => ({
  costUsd: 0,
  requestCount: 0,
  models: {},
  budgetAlert: null,
  loading: false,

  fetchUsage: async () => {
    set({ loading: true })
    try {
      const usage = await window.api.relay.getUsage()
      set({
        costUsd: usage.totalCostUsd ?? 0,
        requestCount: usage.requestCount ?? 0,
        models: (usage as any).models ?? {},
        budgetAlert: (usage as any).budgetAlert ?? null,
        loading: false
      })
    } catch {
      set({ loading: false })
    }
  }
}))
