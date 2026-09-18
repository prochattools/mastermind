import type { ReactNode } from 'react'
import { classNames } from './classNames'

type DashboardListRowProps = {
  children: ReactNode
  className?: string
  selected?: boolean
  onClick?: () => void
}

export function DashboardListRow({ children, className, selected, onClick }: DashboardListRowProps) {
  const interactive = typeof onClick === 'function'
  return (
    <div
      onClick={onClick}
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
      onKeyDown={interactive
        ? (event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault()
              onClick?.()
            }
          }
        : undefined}
      className={classNames(
        'flex min-h-9 items-center gap-2 rounded-md px-3 py-1.5 text-left text-[12px] transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mm-focus/50 focus-visible:ring-offset-2 focus-visible:ring-offset-mm-surface dark:focus-visible:ring-mm-focus/60 dark:focus-visible:ring-offset-mm-canvas',
        interactive ? 'cursor-pointer hover:bg-mm-subtle/70 dark:hover:bg-slate-900/45' : '',
        selected ? 'bg-mm-subtle/80 text-mm-text dark:bg-slate-900/65' : '',
        className
      )}
    >
      {children}
    </div>
  )
}
