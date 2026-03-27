import { useAppStore } from '@/stores/app-store'
import { WifiOff } from 'lucide-react'
import { useTranslation } from '@/i18n'

export function OfflineBanner(): React.JSX.Element | null {
  const { t } = useTranslation()
  const isOnline = useAppStore((s) => s.isOnline)

  if (isOnline) return null

  return (
    <div className="flex shrink-0 items-center justify-center gap-2 bg-yellow-500/10 px-4 py-2 text-sm text-yellow-700 dark:text-yellow-400">
      <WifiOff className="h-4 w-4" />
      <span>{t('offline.message')}</span>
    </div>
  )
}
