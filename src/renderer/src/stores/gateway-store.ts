import { create } from 'zustand'
import type {
  GatewayConnectionState,
  GatewayProcessState,
  GatewayHealthStatus
} from '@/types/gateway'

interface GatewayStore {
  // WebSocket connection state (renderer → gateway)
  connectionState: GatewayConnectionState

  // Gateway process state (from main process)
  processState: GatewayProcessState | null

  // Last health check
  health: GatewayHealthStatus | null

  // Actions
  setConnectionState: (state: GatewayConnectionState) => void
  setProcessState: (state: GatewayProcessState) => void
  setHealth: (health: GatewayHealthStatus) => void
}

export const useGatewayStore = create<GatewayStore>((set) => ({
  connectionState: 'disconnected',
  processState: null,
  health: null,

  setConnectionState: (connectionState) => set({ connectionState }),
  setProcessState: (processState) => set({ processState }),
  setHealth: (health) => set({ health })
}))
