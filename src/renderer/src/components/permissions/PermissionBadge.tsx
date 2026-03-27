import type { RiskTier } from '@/lib/permission-engine'
import { getTierColor, getTierLabel } from '@/lib/permission-engine'
import { Badge } from '@/components/ui/badge'
import { Shield, ShieldAlert, ShieldCheck } from 'lucide-react'
import { cn } from '@/lib/utils'

interface PermissionBadgeProps {
  tier: RiskTier
  className?: string
}

const TIER_ICONS: Record<RiskTier, React.ReactNode> = {
  low: <ShieldCheck className="h-3 w-3" />,
  medium: <Shield className="h-3 w-3" />,
  high: <ShieldAlert className="h-3 w-3" />
}

export function PermissionBadge({ tier, className }: PermissionBadgeProps): React.JSX.Element {
  return (
    <Badge variant="outline" className={cn('text-[10px]', getTierColor(tier), className)}>
      {TIER_ICONS[tier]}
      {getTierLabel(tier)}
    </Badge>
  )
}
