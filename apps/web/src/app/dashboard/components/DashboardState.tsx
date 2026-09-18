import type { ReactNode } from 'react'

import type { DashboardErrorCopy } from '../state'
import { DashboardButton } from './ui/DashboardButton'
import { DashboardPanel } from './ui/DashboardPanel'
import { DashboardSectionHeader } from './ui/DashboardSectionHeader'

export function DashboardLoadingState({ label, detail = 'Keeping the workspace structure in place while Mastermind responds.' }: { label: string; detail?: string }) {
  return (
    <DashboardPanel variant="flat" className="p-5" aria-busy="true">
      <DashboardSectionHeader title={label} detail={detail} />
      <div className="mt-5 space-y-2" role="status" aria-live="polite" aria-label={label}>
        <div className="h-2 w-3/4 animate-pulse rounded-full bg-mm-subtle" />
        <div className="h-2 w-1/2 animate-pulse rounded-full bg-mm-subtle" />
        <span className="sr-only">Loading</span>
      </div>
    </DashboardPanel>
  )
}

export function DashboardEmptyState({
  title,
  detail,
  actionLabel,
  onAction,
  secondaryLabel,
  onSecondary
}: {
  title: string
  detail: string
  actionLabel?: string
  onAction?: () => void
  secondaryLabel?: string
  onSecondary?: () => void
}) {
  return (
    <DashboardPanel variant="flat" className="border border-dashed border-mm-border/80 p-6">
      <DashboardSectionHeader title={title} detail={detail} />
      {actionLabel && onAction ? (
        <div className="mt-4 flex flex-wrap gap-2">
          <DashboardButton type="button" variant="primary" onClick={onAction}>{actionLabel}</DashboardButton>
          {secondaryLabel && onSecondary ? <DashboardButton type="button" variant="secondary" onClick={onSecondary}>{secondaryLabel}</DashboardButton> : null}
        </div>
      ) : null}
    </DashboardPanel>
  )
}

export function DashboardProblemState({
  copy,
  onAction,
  technicalDetail,
  children
}: {
  copy: DashboardErrorCopy
  onAction?: () => void
  technicalDetail?: string | null
  children?: ReactNode
}) {
  return (
    <DashboardPanel variant="flat" className="border border-red-200/80 bg-red-50/40 p-5 dark:border-red-900/60 dark:bg-red-950/15" role="alert">
      <DashboardSectionHeader eyebrow={copy.title} title={copy.explanation} detail={copy.consequence} />
      <p className="mt-3 text-xs leading-5 text-mm-muted">{copy.recovery}</p>
      {onAction ? <DashboardButton type="button" variant="secondary" className="mt-4" onClick={onAction}>Review recovery</DashboardButton> : null}
      {children}
      {technicalDetail ? (
        <details className="mt-4 rounded-md border border-red-200/70 px-3 py-2 dark:border-red-900/50">
          <summary className="cursor-pointer text-xs font-medium text-mm-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mm-focus">Technical details</summary>
          <p className="mt-2 break-words font-mono text-[11px] leading-5 text-mm-muted">{technicalDetail}</p>
        </details>
      ) : null}
    </DashboardPanel>
  )
}
