import { useTranslation } from '@/i18n'

interface EscapeHatchProps {
  onClick: () => void
}

export function EscapeHatch({ onClick }: EscapeHatchProps): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <div
      onClick={onClick}
      className="group relative max-w-[600px] cursor-pointer rounded-[10px] border-[1.5px] border-dashed border-[#2a2b2f] p-[18px_20px] transition-all duration-[150ms] hover:border-[#4a4d55] hover:bg-[#151618]"
    >
      {/* Experimental tag */}
      <span className="absolute right-[14px] top-3 rounded-[3px] bg-[#232428] px-[6px] py-[2px] font-mono text-[8px] uppercase tracking-[.05em] text-[#4a4d55]">
        {t('escapeHatch.tag')}
      </span>

      <div className="flex items-start gap-[14px]">
        {/* Icon */}
        <div className="mt-[2px] flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-[#232428] text-[#4a4d55] transition-all group-hover:bg-[#1c1d20] group-hover:text-[#7a7d85]">
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          >
            <path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71" />
            <path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71" />
          </svg>
        </div>

        {/* Body */}
        <div>
          <div className="mb-[3px] text-[13px] font-medium text-[#7a7d85] transition-colors group-hover:text-[#e8e9eb]">
            {t('escapeHatch.title')}
          </div>
          <div className="text-[11.5px] leading-[1.5] text-[#4a4d55]">{t('escapeHatch.desc')}</div>
        </div>
      </div>
    </div>
  )
}
