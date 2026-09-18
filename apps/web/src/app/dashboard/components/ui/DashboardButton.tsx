import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { classNames } from './classNames'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'

type DashboardButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant
  children: ReactNode
}

const VARIANT_CLASSES: Record<Variant, string> = {
  primary: 'border-mm-accent bg-mm-accent text-mm-surface shadow-sm hover:bg-slate-800 hover:text-mm-surface dark:bg-slate-100 dark:text-slate-900 dark:border-slate-100 dark:hover:bg-slate-200 dark:hover:text-slate-900',
  secondary: 'border-mm-border/80 bg-mm-surface text-mm-text hover:bg-mm-subtle dark:bg-slate-900/90 dark:text-slate-200 dark:hover:bg-slate-800',
  ghost: 'border-transparent bg-transparent text-mm-text hover:bg-mm-subtle dark:text-slate-200 dark:hover:bg-slate-900',
  danger: 'border-red-200 bg-red-50 text-red-700 hover:bg-red-100 dark:border-red-900/40 dark:bg-red-950/20 dark:text-red-200 dark:hover:bg-red-950/30'
}

export function DashboardButton({
  variant = 'secondary',
  className,
  children,
  ...props
}: DashboardButtonProps) {
  return (
    <button
      {...props}
      className={classNames(
        'inline-flex min-h-9 items-center justify-center rounded-md border px-3 text-[12px] font-medium leading-none transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mm-focus/50 focus-visible:ring-offset-2 focus-visible:ring-offset-mm-surface active:translate-y-px dark:focus-visible:ring-mm-focus/60 dark:focus-visible:ring-offset-mm-canvas',
        VARIANT_CLASSES[variant],
        className
      )}
    >
      {children}
    </button>
  )
}
