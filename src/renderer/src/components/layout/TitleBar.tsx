import { Globe } from 'lucide-react'
import { useGatewayStore } from '@/stores/gateway-store'
import { useTranslation } from '@/i18n'
import { Badge } from '@/components/ui/badge'

export function TitleBar(): React.JSX.Element {
  const connectionState = useGatewayStore((s) => s.connectionState)
  const processState = useGatewayStore((s) => s.processState)
  const { t, locale, setLocale } = useTranslation()

  const statusColor = {
    connected: 'bg-green-500',
    connecting: 'bg-yellow-500',
    disconnected: 'bg-gray-500',
    error: 'bg-red-500'
  }[connectionState]

  return (
    <div
      className="flex h-9 shrink-0 items-center justify-between border-b border-border bg-background pl-4 pr-[140px]"
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      <span className="text-sm font-medium text-foreground">Attacca</span>
      <div
        className="flex items-center gap-2"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        <button
          onClick={() => setLocale(locale === 'en' ? 'es' : 'en')}
          className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] border border-[#2a2b2f] text-[#7a7d85] transition-colors hover:border-[#5b7cf6] hover:text-[#5b7cf6] cursor-pointer"
        >
          <Globe className="w-2.5 h-2.5" />
          {locale === 'en' ? 'ES' : 'EN'}
        </button>
        <div
          className={`h-2 w-2 rounded-full ${statusColor}`}
          title={`Gateway: ${processState?.state ?? 'unknown'}`}
        />
        <Badge variant="outline" className="text-[10px] px-1.5 py-0">
          {t(`titlebar.${connectionState}`)}
        </Badge>
      </div>
    </div>
  )
}
