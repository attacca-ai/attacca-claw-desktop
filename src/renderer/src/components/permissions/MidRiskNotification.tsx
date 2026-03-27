import { useEffect } from 'react'
import { usePermissionStore, type PendingApproval } from '@/stores/permission-store'
import { useNotificationStore } from '@/stores/notification-store'
import { useTrustStore } from '@/stores/trust-store'
import { Button } from '@/components/ui/button'
import { Check, X, Undo2 } from 'lucide-react'

interface MidRiskNotificationProps {
  approval: PendingApproval
}

export function MidRiskNotification({ approval }: MidRiskNotificationProps): React.JSX.Element {
  const { grantPermission, denyPermission } = usePermissionStore()
  const addNotification = useNotificationStore((s) => s.add)
  const profile = useTrustStore((s) => s.profile)

  // Emit when notification becomes visible to the user
  useEffect(() => {
    window.api.telemetry.emit('permission.mid_risk.viewed', {
      actionType: approval.actionType,
      toolId: approval.toolId,
      trustProfile: profile,
      timeToViewMs: Date.now() - approval.requestedAt
    })
  }, [approval.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleConfirm = (): void => {
    grantPermission(approval)
    addNotification({
      type: 'action-taken',
      title: 'Action Approved',
      message: approval.description,
      undoable: profile === 'balanced'
    })
  }

  const handleDeny = (): void => {
    denyPermission(approval.id)
  }

  if (profile === 'cautious') {
    // Cautious: inline confirmation required
    return (
      <div className="flex items-center gap-2 rounded-md border border-yellow-500/30 bg-yellow-500/10 p-2 text-xs">
        <span className="flex-1 text-foreground">{approval.description}</span>
        <Button variant="ghost" size="xs" onClick={handleDeny}>
          <X className="h-3 w-3" />
        </Button>
        <Button variant="ghost" size="xs" onClick={handleConfirm}>
          <Check className="h-3 w-3" />
          Confirm
        </Button>
      </div>
    )
  }

  if (profile === 'balanced') {
    // Balanced: notification with undo
    return (
      <div className="flex items-center gap-2 rounded-md border border-blue-500/30 bg-blue-500/10 p-2 text-xs">
        <span className="flex-1 text-foreground">{approval.description}</span>
        <Button
          variant="ghost"
          size="xs"
          onClick={() => {
            denyPermission(approval.id)
            window.api.telemetry.emit('permission.mid_risk.undo_used', {
              actionType: approval.actionType,
              toolId: approval.toolId,
              timeSinceActionMs: Date.now() - approval.requestedAt
            })
          }}
        >
          <Undo2 className="h-3 w-3" />
          Undo
        </Button>
      </div>
    )
  }

  // Autonomous: not rendered (silently logged)
  return <></>
}
