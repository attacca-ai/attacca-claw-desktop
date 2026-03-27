import { useState, useEffect, useCallback } from 'react'
import { usePermissionStore, type PendingApproval } from '@/stores/permission-store'
import { useNotificationStore } from '@/stores/notification-store'
import { getTierColor, getTierBgColor } from '@/lib/permission-engine'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { ShieldAlert, X } from 'lucide-react'
import { cn } from '@/lib/utils'

const COUNTDOWN_MS = 120_000 // 2 minutes

interface CountdownApprovalProps {
  approval: PendingApproval
}

export function CountdownApproval({ approval }: CountdownApprovalProps): React.JSX.Element {
  const { grantPermission, denyPermission } = usePermissionStore()
  const addNotification = useNotificationStore((s) => s.add)
  const [remainingMs, setRemainingMs] = useState(COUNTDOWN_MS)

  const handleApprove = useCallback(() => {
    grantPermission(approval, false)
    addNotification({
      type: 'action-taken',
      title: 'Action Approved',
      message: `Auto-approved after countdown: ${approval.description}`,
      undoable: true
    })
  }, [approval, grantPermission, addNotification])

  const handleCancel = useCallback(() => {
    denyPermission(approval.id)
    addNotification({
      type: 'info',
      title: 'Action Cancelled',
      message: `Cancelled during countdown: ${approval.description}`
    })
  }, [approval, denyPermission, addNotification])

  useEffect(() => {
    const interval = setInterval(() => {
      setRemainingMs((prev) => {
        const next = prev - 100
        if (next <= 0) {
          clearInterval(interval)
          // Auto-approve when countdown completes
          handleApprove()
          return 0
        }
        return next
      })
    }, 100)

    return () => clearInterval(interval)
  }, [handleApprove])

  const progress = ((COUNTDOWN_MS - remainingMs) / COUNTDOWN_MS) * 100
  const seconds = Math.ceil(remainingMs / 1000)
  const tierColor = getTierColor(approval.tier)
  const tierBg = getTierBgColor(approval.tier)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="mx-4 w-full max-w-md rounded-lg border border-border bg-background shadow-xl">
        <div className="flex items-center gap-3 border-b border-border p-4">
          <div
            className={cn('flex h-8 w-8 items-center justify-center rounded-full border', tierBg)}
          >
            <ShieldAlert className={cn('h-4 w-4', tierColor)} />
          </div>
          <div className="flex-1">
            <h3 className="font-semibold text-foreground">Autonomous Mode — Action Pending</h3>
            <Badge variant="outline" className={cn('mt-0.5 text-[10px]', tierColor)}>
              High Risk — {seconds}s remaining
            </Badge>
          </div>
        </div>

        <div className="p-4">
          <p className="mb-3 text-sm text-foreground">{approval.description}</p>
          <Progress value={progress} className="mb-3 h-2" />
          <p className="text-xs text-muted-foreground">
            This action will proceed automatically in {seconds} seconds. Click cancel to stop it.
          </p>
        </div>

        <div className="flex justify-end gap-2 border-t border-border p-4">
          <Button variant="destructive" onClick={handleCancel}>
            <X className="h-4 w-4" />
            Cancel
          </Button>
        </div>
      </div>
    </div>
  )
}
