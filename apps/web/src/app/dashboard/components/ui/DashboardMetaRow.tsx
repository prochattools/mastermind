import type { ReactNode } from 'react'
import { classNames } from './classNames'

type DashboardMetaRowProps = {
  label: ReactNode
  value: ReactNode
  className?: string
}

export function DashboardMetaRow({ label, value, className }: DashboardMetaRowProps) {
  return (
    <div className={classNames('flex min-w-0 items-center justify-between gap-3 text-[12px] text-mm-text dark:text-slate-200', className)}>
      <span className="shrink-0 text-mm-muted/95 dark:text-slate-400">{label}</span>
      <span className="min-w-0 truncate text-right">{value}</span>
    </div>
  )
}
