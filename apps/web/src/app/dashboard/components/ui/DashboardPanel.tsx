import type { HTMLAttributes, ReactNode } from 'react'
import { classNames } from './classNames'

type DashboardPanelProps = HTMLAttributes<HTMLElement> & {
  className?: string
  children: ReactNode
  variant?: 'default' | 'flat' | 'raised'
}

const VARIANT_CLASSES: Record<NonNullable<DashboardPanelProps['variant']>, string> = {
  default: 'border border-mm-border/45 bg-mm-surface/88 text-mm-text dark:border-slate-800/45 dark:bg-slate-950/28',
  flat: 'bg-mm-surface/64 text-mm-text dark:bg-slate-950/18',
  raised: 'border border-mm-border/45 bg-mm-surface/96 text-mm-text shadow-[0_10px_24px_-22px_rgba(15,23,42,0.16)] dark:border-slate-800/50 dark:bg-slate-900/84 dark:shadow-[0_10px_24px_-22px_rgba(15,23,42,0.32)]'
}

export function DashboardPanel({ className, children, variant = 'default', ...props }: DashboardPanelProps) {
  return (
    <section {...props} className={classNames('rounded-lg', VARIANT_CLASSES[variant], className)}>
      {children}
    </section>
  )
}
