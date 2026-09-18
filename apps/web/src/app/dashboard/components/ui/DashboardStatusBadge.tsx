import { classNames } from './classNames'

type DashboardStatusBadgeProps = {
  label: string
  tone?: 'neutral' | 'good' | 'warn' | 'bad'
  className?: string
}

const TONE_CLASSES = {
  neutral: 'border-mm-border bg-mm-subtle text-mm-muted',
  good: 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-200',
  warn: 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200',
  bad: 'border-red-200 bg-red-50 text-red-800 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200'
} as const

export function DashboardStatusBadge({ label, tone = 'neutral', className }: DashboardStatusBadgeProps) {
  return (
    <span className={classNames('inline-flex min-h-7 items-center gap-1.5 rounded-md border px-2 text-[11px] font-medium', TONE_CLASSES[tone], className)}>
      <span aria-hidden="true" className={classNames('h-1.5 w-1.5 rounded-full', tone === 'good' ? 'bg-emerald-500' : tone === 'warn' ? 'bg-amber-500' : tone === 'bad' ? 'bg-red-500' : 'bg-slate-400')} />
      {label}
    </span>
  )
}
