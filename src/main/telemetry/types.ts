// Telemetry event type definitions

export interface TelemetryEvent {
  eventType: string
  payload: Record<string, unknown>
  timestamp: string // ISO 8601
  anonymousId: string
}

// ── Phase 1: Base events ──

export interface BaseEvent {
  eventType: string
  payload: Record<string, unknown>
}

// ── Phase 2: Permission events ──

export interface PermissionHighRiskPresented extends BaseEvent {
  eventType: 'permission.high_risk.presented'
  payload: {
    actionType: string
    toolId: string
    trustProfile: string
  }
}

export interface PermissionHighRiskResolved extends BaseEvent {
  eventType: 'permission.high_risk.resolved'
  payload: {
    actionType: string
    toolId: string
    resolution: 'approved' | 'denied'
    standingApproval: boolean
    durationMs: number
    trustProfile: string
  }
}

export interface PermissionMidRiskPresented extends BaseEvent {
  eventType: 'permission.mid_risk.presented'
  payload: {
    actionType: string
    toolId: string
    trustProfile: string
  }
}

export interface PermissionMidRiskViewed extends BaseEvent {
  eventType: 'permission.mid_risk.viewed'
  payload: {
    actionType: string
    toolId: string
    trustProfile: string
  }
}

export interface PermissionMidRiskUndoUsed extends BaseEvent {
  eventType: 'permission.mid_risk.undo_used'
  payload: {
    actionType: string
    toolId: string
    timeSinceActionMs: number
  }
}

export interface PermissionStandingApprovalGranted extends BaseEvent {
  eventType: 'permission.standing_approval.granted'
  payload: {
    actionType: string
    toolId: string
    trustProfile: string
  }
}

export interface PermissionStandingApprovalExpired extends BaseEvent {
  eventType: 'permission.standing_approval.expired'
  payload: {
    actionType: string
    toolId: string
    durationDays: number
  }
}

// ── Phase 2: Trust events ──

export interface TrustProfileChanged extends BaseEvent {
  eventType: 'trust.profile_changed'
  payload: {
    from: string
    to: string
  }
}

export interface TrustActivityFeedToggled extends BaseEvent {
  eventType: 'trust.activity_feed.toggled'
  payload: {
    expanded: boolean
  }
}

export interface TrustKillSwitchActivated extends BaseEvent {
  eventType: 'trust.kill_switch.activated'
  payload: Record<string, never>
}

export interface TrustKillSwitchResumed extends BaseEvent {
  eventType: 'trust.kill_switch.resumed'
  payload: {
    pauseDurationMs: number
  }
}

export interface TrustTakeoverActivated extends BaseEvent {
  eventType: 'trust.takeover.activated'
  payload: Record<string, never>
}

export interface TrustTakeoverDeactivated extends BaseEvent {
  eventType: 'trust.takeover.deactivated'
  payload: {
    durationMs: number
    trigger: 'manual' | 'timeout'
  }
}

export interface TrustFirstStandingApproval extends BaseEvent {
  eventType: 'trust.first_standing_approval'
  payload: {
    actionType: string
    trustProfile: string
  }
}

// ── Phase 2: Agent events ──

export interface AgentTaskCompleted extends BaseEvent {
  eventType: 'agent.task.completed'
  payload: {
    durationMs: number
    hadFallback: boolean
  }
}

export interface AgentTaskFailed extends BaseEvent {
  eventType: 'agent.task.failed'
  payload: {
    durationMs: number
    errorCategory: string
  }
}

export interface AgentTaskFallbackCreated extends BaseEvent {
  eventType: 'agent.task.fallback_created'
  payload: {
    originalTaskType: string
  }
}

export interface AgentWorkflowAdded extends BaseEvent {
  eventType: 'agent.workflow.added'
  payload: {
    workflowType: string
  }
}

export interface AgentWorkflowRemoved extends BaseEvent {
  eventType: 'agent.workflow.removed'
  payload: {
    workflowType: string
  }
}

export interface AgentToolCallSucceeded extends BaseEvent {
  eventType: 'agent.tool_call.succeeded'
  payload: {
    actionName: string
    toolkit: string
    method: 'sdk' | 'rest'
  }
}

export interface AgentToolCallFailed extends BaseEvent {
  eventType: 'agent.tool_call.failed'
  payload: {
    actionName: string
    toolkit: string
    errorCategory: string
  }
}

// ── App lifecycle events ──

export interface AppSessionStarted extends BaseEvent {
  eventType: 'app.session_started'
  payload: {
    platform: string
    appVersion: string
    isPackaged: boolean
  }
}

// ── Onboarding events ──

export interface OnboardingCompleted extends BaseEvent {
  eventType: 'onboarding.completed'
  payload: {
    llmProvider: string
    connectedTools: number
    telemetryOptIn: boolean
  }
}

export interface OnboardingStepCompleted extends BaseEvent {
  eventType: 'onboarding.step_completed'
  payload: {
    step: number
    stepName: string
  }
}

// ── Feature usage events ──

export interface FeatureViewed extends BaseEvent {
  eventType: 'feature.viewed'
  payload: {
    view: string
    previousView: string
  }
}

// ── Capture events ──

export interface CaptureStarted extends BaseEvent {
  eventType: 'capture.started'
  payload: {
    sourceType: string
  }
}

export interface CaptureSaved extends BaseEvent {
  eventType: 'capture.saved'
  payload: {
    sourceType: string
    hasActionItems: boolean
    actionItemCount: number
  }
}

export interface CaptureDiscarded extends BaseEvent {
  eventType: 'capture.discarded'
  payload: {
    sourceType: string
  }
}

// ── Workflow events ──

export interface WorkflowCreated extends BaseEvent {
  eventType: 'workflow.created'
  payload: {
    workflowName: string
  }
}

export interface WorkflowRun extends BaseEvent {
  eventType: 'workflow.run'
  payload: {
    workflowName: string
  }
}

// ── Gateway lifecycle events ──

export interface GatewayStarted extends BaseEvent {
  eventType: 'gateway.started'
  payload: {
    startupMs: number
  }
}

export interface GatewayError extends BaseEvent {
  eventType: 'gateway.error'
  payload: {
    error: string
  }
}

export interface GatewayRestarted extends BaseEvent {
  eventType: 'gateway.restarted'
  payload: {
    restartCount: number
    reason: string
  }
}

// ── Tool connection events ──

export interface ToolConnected extends BaseEvent {
  eventType: 'tool.connected'
  payload: {
    toolId: string
  }
}

export interface ToolDisconnected extends BaseEvent {
  eventType: 'tool.disconnected'
  payload: {
    toolId: string
  }
}

// ── Agent chat events ──

export interface AgentChatSent extends BaseEvent {
  eventType: 'agent.chat.sent'
  payload: {
    source: string
  }
}

// ── Phase 3: Parity events ──

export interface ParityDraftApproved extends BaseEvent {
  eventType: 'parity.draft.approved'
  payload: {
    category: string // 'email' | 'document' | 'task'
    modified: boolean
    modificationMagnitude: number // 0-1 scale
  }
}

export interface ParityTaskReopened extends BaseEvent {
  eventType: 'parity.task.reopened'
  payload: {
    category: string
    timeSinceCompletionMs: number
  }
}

export interface ParityFallbackRate extends BaseEvent {
  eventType: 'parity.fallback_rate'
  payload: {
    date: string
    totalTasks: number
    fallbackCount: number
    rate: number
  }
}

// Union of all telemetry event types
export type TelemetryEventType =
  | AppSessionStarted
  | OnboardingCompleted
  | OnboardingStepCompleted
  | FeatureViewed
  | CaptureStarted
  | CaptureSaved
  | CaptureDiscarded
  | WorkflowCreated
  | WorkflowRun
  | GatewayStarted
  | GatewayError
  | GatewayRestarted
  | ToolConnected
  | ToolDisconnected
  | AgentChatSent
  | PermissionHighRiskPresented
  | PermissionHighRiskResolved
  | PermissionMidRiskPresented
  | PermissionMidRiskViewed
  | PermissionMidRiskUndoUsed
  | PermissionStandingApprovalGranted
  | PermissionStandingApprovalExpired
  | TrustProfileChanged
  | TrustActivityFeedToggled
  | TrustKillSwitchActivated
  | TrustKillSwitchResumed
  | TrustTakeoverActivated
  | TrustTakeoverDeactivated
  | TrustFirstStandingApproval
  | AgentTaskCompleted
  | AgentTaskFailed
  | AgentTaskFallbackCreated
  | AgentWorkflowAdded
  | AgentWorkflowRemoved
  | AgentToolCallSucceeded
  | AgentToolCallFailed
  | ParityDraftApproved
  | ParityTaskReopened
  | ParityFallbackRate
