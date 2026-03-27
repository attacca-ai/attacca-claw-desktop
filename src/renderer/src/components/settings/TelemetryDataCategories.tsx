import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { BarChart3 } from 'lucide-react'

const DATA_CATEGORIES = [
  {
    title: 'Permission Events',
    items: [
      'When a high-risk approval is shown to you',
      'Whether you approved or denied it',
      'Whether you granted a 30-day standing approval',
      'How long it took you to decide',
      'When medium-risk notifications are shown',
      'When you use the Undo button on a notification'
    ]
  },
  {
    title: 'Trust & Autonomy Events',
    items: [
      'When you change your trust profile (Cautious/Balanced/Autonomous)',
      'When you expand or collapse the Activity Feed',
      'When you use the Emergency Stop button',
      'When you activate or deactivate Take Over mode'
    ]
  },
  {
    title: 'Agent Performance Events',
    items: [
      'When a task is completed (duration only, no content)',
      'When a task fails (error category only, no details)',
      'When a fallback task is created',
      'When workflows are added or removed'
    ]
  },
  {
    title: 'Parity Indicators',
    items: [
      'When you approve or modify a draft (modification level, not content)',
      'When a completed task is reopened',
      'Daily task fallback rates'
    ]
  }
]

export function TelemetryDataCategories(): React.JSX.Element {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <BarChart3 className="mr-1 h-3 w-3" />
          View Collected Data Categories
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Collected Data Categories</DialogTitle>
          <DialogDescription>
            When telemetry is enabled, we collect the following anonymous events. No personal
            information, content, or identifiers are ever collected.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4 py-2">
          {DATA_CATEGORIES.map((category) => (
            <div key={category.title}>
              <h4 className="mb-1.5 text-sm font-medium text-foreground">{category.title}</h4>
              <ul className="space-y-1 text-sm text-muted-foreground">
                {category.items.map((item, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-muted-foreground/50" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}
