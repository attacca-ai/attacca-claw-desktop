import { cn } from '@/lib/utils'
import { Loader2 } from 'lucide-react'

interface LoadingSpinnerProps {
  size?: 'sm' | 'md' | 'lg'
  message?: string
  className?: string
}

const SIZES = {
  sm: 'h-4 w-4',
  md: 'h-6 w-6',
  lg: 'h-8 w-8'
}

export function LoadingSpinner({
  size = 'md',
  message,
  className
}: LoadingSpinnerProps): React.JSX.Element {
  return (
    <div className={cn('flex flex-col items-center gap-2', className)}>
      <Loader2 className={cn('animate-spin text-muted-foreground', SIZES[size])} />
      {message && <p className="text-sm text-muted-foreground">{message}</p>}
    </div>
  )
}
