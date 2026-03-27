import { useState } from 'react'
import { usePermissionStore } from '@/stores/permission-store'
import { useNotificationStore } from '@/stores/notification-store'
import { useTrustStore } from '@/stores/trust-store'
import {
  getTierColor,
  getTierBgColor,
  getTierLabel,
  getActionBehavior
} from '@/lib/permission-engine'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ShieldAlert, Check, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useTranslation } from '@/i18n'
import { CountdownApproval } from './CountdownApproval'

export function ApprovalDialog(): React.JSX.Element | null {
  const { t } = useTranslation()
  const { pendingApprovals, grantPermission, denyPermission } = usePermissionStore()
  const addNotification = useNotificationStore((s) => s.add)
  const profile = useTrustStore((s) => s.profile)
  const [standingApproval, setStandingApproval] = useState(false)

  const current = pendingApprovals.find((a) => a.tier === 'high')
  if (!current) return null

  const behavior = getActionBehavior(current.tier, profile)

  // Autonomous high-risk: show countdown instead of blocking dialog
  if (behavior.delayMs) {
    return <CountdownApproval approval={current} />
  }

  // Blocking approval (Cautious/Balanced high-risk)
  const tierColor = getTierColor(current.tier)
  const tierBg = getTierBgColor(current.tier)

  const handleApprove = (): void => {
    grantPermission(current, standingApproval)
    addNotification({
      type: 'action-taken',
      title: t('approval.approved_title'),
      message: `${t('approval.approved_msg', { desc: current.description })}${standingApproval ? ` ${t('approval.standing_note')}` : ''}`
    })
    setStandingApproval(false)
  }

  const handleDeny = (): void => {
    denyPermission(current.id)
    addNotification({
      type: 'info',
      title: t('approval.denied_title'),
      message: t('approval.denied_msg', { desc: current.description })
    })
    setStandingApproval(false)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="mx-4 w-full max-w-md rounded-lg border border-border bg-background shadow-xl">
        {/* Header */}
        <div className="flex items-center gap-3 border-b border-border p-4">
          <div
            className={cn('flex h-8 w-8 items-center justify-center rounded-full border', tierBg)}
          >
            <ShieldAlert className={cn('h-4 w-4', tierColor)} />
          </div>
          <div>
            <h3 className="font-semibold text-foreground">{t('approval.title')}</h3>
            <Badge variant="outline" className={cn('mt-0.5 text-[10px]', tierColor)}>
              {getTierLabel(current.tier)}
            </Badge>
          </div>
        </div>

        {/* Body */}
        <div className="p-4">
          <p className="mb-3 text-sm text-foreground">{current.description}</p>

          {current.toolId && (
            <div className="mb-3 text-xs text-muted-foreground">
              {t('approval.tool_label', { toolId: current.toolId })}
            </div>
          )}

          {current.params && Object.keys(current.params).length > 0 && (
            <pre className="mb-3 max-h-32 overflow-auto rounded-md bg-muted p-2 text-xs text-muted-foreground">
              {JSON.stringify(current.params, null, 2)}
            </pre>
          )}

          {/* Standing approval checkbox for HIGH tier */}
          {current.tier === 'high' && (
            <label className="flex cursor-pointer items-center gap-2 rounded-md border border-border p-2 text-xs">
              <input
                type="checkbox"
                checked={standingApproval}
                onChange={(e) => setStandingApproval(e.target.checked)}
                className="rounded"
              />
              <span className="text-muted-foreground">{t('approval.standing_label')}</span>
            </label>
          )}
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-2 border-t border-border p-4">
          <Button variant="outline" onClick={handleDeny}>
            <X className="h-4 w-4" />
            {t('approval.deny_btn')}
          </Button>
          <Button onClick={handleApprove}>
            <Check className="h-4 w-4" />
            {t('approval.approve_btn')}
          </Button>
        </div>

        {/* Queue indicator */}
        {pendingApprovals.filter((a) => a.tier === 'high').length > 1 && (
          <div className="border-t border-border px-4 py-2 text-center text-xs text-muted-foreground">
            {t('approval.pending', {
              count: pendingApprovals.filter((a) => a.tier === 'high').length - 1
            })}
          </div>
        )}
      </div>
    </div>
  )
}
