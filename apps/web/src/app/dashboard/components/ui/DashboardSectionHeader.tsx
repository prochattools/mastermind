import type { ReactNode } from 'react'
import { classNames } from './classNames'

type DashboardSectionHeaderProps = {
  eyebrow?: string
  title: string
  detail?: string
  action?: ReactNode
  className?: string
}

export function DashboardSectionHeader({
  eyebrow,
  title,
  detail,
  action,
  className
}: DashboardSectionHeaderProps) {
  return (
    <div className={classNames('flex items-center justify-between gap-3', className)}>
      <div className="min-w-0">
        {eyebrow ? <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-mm-muted/90">{eyebrow}</div> : null}
        <h2 className="text-[13px] font-semibold leading-5 text-mm-text dark:text-slate-50">{title}</h2>
        {detail ? <p className="mt-0.5 line-clamp-2 text-[12px] leading-5 text-mm-muted/95 dark:text-slate-300">{detail}</p> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  )
}
