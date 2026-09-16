import { DashboardPanel } from './ui/DashboardPanel'
import { DashboardSectionHeader } from './ui/DashboardSectionHeader'
import { DashboardStatusDot } from './ui/DashboardStatusDot'

type DashboardActivityEntry = {
  id: string
  type: string
  title: string
  detail: string
  timestamp: string
  tone?: 'neutral' | 'good' | 'warn' | 'bad'
}

type DashboardActivityFeedProps = {
  entries: DashboardActivityEntry[]
  emptyMessage: string
}

const TONE_CLASSES: Record<NonNullable<DashboardActivityEntry['tone']>, string> = {
  neutral: 'text-slate-700 dark:text-slate-300',
  good: 'text-emerald-700 dark:text-emerald-300',
  warn: 'text-amber-700 dark:text-amber-300',
  bad: 'text-red-700 dark:text-red-300'
}

const formatTimestamp = (timestamp: string) => {
  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

export function DashboardActivityFeed({ entries, emptyMessage }: DashboardActivityFeedProps) {
  return (
    <DashboardPanel variant="flat" className="h-full min-h-0 overflow-hidden">
      <div className="border-b border-bf-border/70 px-4 py-3 dark:border-slate-800/70">
        <DashboardSectionHeader eyebrow="Activity" title="Recent Mastermind events" />
      </div>
      <div className="max-h-[calc(100vh-16rem)] overflow-y-auto">
        {entries.length === 0 ? (
          <div className="px-4 py-4">
            <div className="rounded-lg border border-dashed border-bf-border/70 bg-bf-subtle/40 px-4 py-6 text-[13px] text-bf-muted dark:border-slate-800/70 dark:bg-slate-950/30 dark:text-slate-300">
              {emptyMessage}
            </div>
          </div>
        ) : (
          <div className="divide-y divide-bf-border/60 dark:divide-slate-800/60">
            {entries.map((entry, index) => (
              <div key={entry.id || `${entry.title}-${index}`} className="flex items-start gap-3 px-4 py-2.5 hover:bg-bf-subtle/40 dark:hover:bg-slate-900/30">
                <DashboardStatusDot tone={entry.tone || 'neutral'} className="mt-1" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-3">
                    <div className="truncate text-[12px] font-medium text-bf-text dark:text-slate-50">{entry.title}</div>
                    {entry.timestamp ? (
                      <div className="shrink-0 font-mono-ui text-[10px] text-bf-muted dark:text-slate-500">{formatTimestamp(entry.timestamp)}</div>
                    ) : null}
                  </div>
                  <div className={`mt-0.5 truncate text-[12px] leading-5 ${TONE_CLASSES[entry.tone || 'neutral']}`}>{entry.detail}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </DashboardPanel>
  )
}
