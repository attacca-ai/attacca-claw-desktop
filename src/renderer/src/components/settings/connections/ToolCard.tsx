import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useTranslation } from '@/i18n'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger
} from '@/components/ui/alert-dialog'

interface ToolCardProps {
  toolId: string
  label: string
  description: string
  emoji: string
  isConnected: boolean
  isConnecting: boolean
  isDisconnecting: boolean
  onConnect: () => void
  onDisconnect: () => void
}

export function ToolCard({
  toolId: _toolId,
  label,
  description,
  emoji,
  isConnected,
  isConnecting,
  isDisconnecting,
  onConnect,
  onDisconnect
}: ToolCardProps): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <div
      className={cn(
        'flex cursor-pointer items-center gap-[10px] rounded-lg border p-3 transition-all duration-[120ms]',
        isConnected
          ? 'border-[rgba(76,175,130,.25)] bg-[#151618] hover:bg-[#1c1d20]'
          : 'border-[#1f2024] bg-[#151618] hover:border-[#2a2b2f] hover:bg-[#1c1d20]'
      )}
      onClick={() => {
        if (!isConnected && !isConnecting) onConnect()
      }}
    >
      {/* Logo */}
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-[#1c1d20] text-sm">
        {emoji}
      </div>

      {/* Info */}
      <div className="min-w-0 flex-1">
        <div className="text-[12.5px] font-medium text-[#e8e9eb]">{label}</div>
        <div className="overflow-hidden text-ellipsis whitespace-nowrap text-[10.5px] text-[#4a4d55]">
          {description}
        </div>
      </div>

      {/* Status badge / action */}
      {isConnecting ? (
        <span className="flex shrink-0 items-center gap-1 rounded-[10px] bg-[rgba(91,124,246,.12)] px-[6px] py-[2px] font-mono text-[8px] text-[#5b7cf6]">
          <Loader2 className="h-2.5 w-2.5 animate-spin" />
          {t('toolCard.connecting')}
        </span>
      ) : isConnected ? (
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <span
              onClick={(e) => e.stopPropagation()}
              className="shrink-0 cursor-pointer rounded-[10px] bg-[rgba(76,175,130,.1)] px-[6px] py-[2px] font-mono text-[8px] text-[#4caf82] transition-colors hover:bg-[rgba(224,92,92,.1)] hover:text-[#e05c5c]"
            >
              {isDisconnecting ? (
                <span className="flex items-center gap-1">
                  <Loader2 className="h-2.5 w-2.5 animate-spin" /> {t('toolCard.disconnecting')}
                </span>
              ) : (
                t('toolCard.active')
              )}
            </span>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t('toolCard.disconnect_title', { label })}</AlertDialogTitle>
              <AlertDialogDescription>{t('toolCard.disconnect_desc')}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t('toolCard.cancel')}</AlertDialogCancel>
              <AlertDialogAction variant="destructive" onClick={onDisconnect}>
                {t('toolCard.disconnect')}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      ) : (
        <span className="shrink-0 rounded-[10px] bg-[rgba(91,124,246,.12)] px-[6px] py-[2px] font-mono text-[8px] text-[#5b7cf6]">
          {t('toolCard.connect')}
        </span>
      )}
    </div>
  )
}
