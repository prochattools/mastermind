import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { classNames } from './classNames'

type DashboardIconButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string
  children: ReactNode
}

export const DashboardIconButton = forwardRef<HTMLButtonElement, DashboardIconButtonProps>(function DashboardIconButton({
  label,
  className,
  children,
  ...props
}, ref) {
  return (
    <button
      {...props}
      ref={ref}
      type={props.type || 'button'}
      aria-label={label}
      className={classNames(
        'inline-flex h-9 w-9 items-center justify-center rounded-md border border-mm-border/80 bg-mm-surface text-mm-muted transition-colors duration-150 hover:bg-mm-subtle hover:text-mm-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mm-focus/50 focus-visible:ring-offset-2 focus-visible:ring-offset-mm-surface active:translate-y-px dark:bg-slate-900/90 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-slate-100 dark:focus-visible:ring-mm-focus/60 dark:focus-visible:ring-offset-mm-canvas',
        className
      )}
    >
      {children}
    </button>
  )
})
