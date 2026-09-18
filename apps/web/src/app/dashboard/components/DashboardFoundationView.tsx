import type { KnowledgeSource, WriteMode } from '@mastermind/shared'
import type { DashboardSection } from '../types'
import type { OverviewActivity, OverviewJob } from '../overview'
import { buildOverviewModel } from '../overview'
import type { SystemHealth, StatusTone } from '../status'
import { getAuthorityLabel, getSourceState, getSourceStateLabel, getSourceStateTone, getSystemHealthLabel } from '../status'
import { DashboardButton } from './ui/DashboardButton'
import { DashboardMetaRow } from './ui/DashboardMetaRow'
import { DashboardPanel } from './ui/DashboardPanel'
import { DashboardSectionHeader } from './ui/DashboardSectionHeader'
import { DashboardStatusBadge } from './ui/DashboardStatusBadge'
import { DashboardLoadingState } from './DashboardState'
import { DashboardOnboarding } from './DashboardOnboarding'

type DashboardFoundationViewProps = {
  section: DashboardSection
  systemHealth: SystemHealth
  sources: KnowledgeSource[]
  activeSources: KnowledgeSource[]
  writeMode: WriteMode
  activity: OverviewActivity[]
  jobs: OverviewJob[]
  loading: boolean
  agentConnected: boolean
  error: string | null
  onSelectSources: () => void
  onSelectGoal: () => void
  onSelectActivity: () => void
  onSelectSettings: () => void
  onRefresh: () => void
}

const sectionCopy: Record<DashboardSection, { eyebrow: string; title: string; detail: string }> = {
  overview: { eyebrow: 'Overview', title: 'Your local workspace', detail: 'A calm starting point for source context and bounded work.' },
  sources: { eyebrow: 'Sources', title: 'Sources', detail: 'Connect a repository or folder, then choose what Mastermind can use.' },
  'goal-run': { eyebrow: 'Goal / Run', title: 'Goals and runs', detail: 'Goal and run details will be expanded in the next workflow phase.' },
  activity: { eyebrow: 'Activity', title: 'Recent activity', detail: 'Human-readable updates from the local workspace.' },
  settings: { eyebrow: 'Settings', title: 'Workspace settings', detail: 'Review authority and local readiness before starting work.' }
}

const healthTone = (health: SystemHealth): StatusTone => health === 'healthy' ? 'good' : health === 'degraded' ? 'warn' : 'bad'

export function DashboardFoundationView(props: DashboardFoundationViewProps) {
  if (props.section === 'overview') return <OverviewView {...props} />
  return <PlaceholderView {...props} />
}

function OverviewView({
  systemHealth,
  sources,
  activeSources,
  writeMode,
  activity,
  jobs,
  loading,
  agentConnected,
  error,
  onSelectSources,
  onSelectGoal,
  onSelectActivity,
  onSelectSettings,
  onRefresh
}: DashboardFoundationViewProps) {
  const model = buildOverviewModel({ systemHealth, error, sources, activeSources, jobs, activity, writeMode })
  const actionFor = (section: 'sources' | 'goal-run' | 'settings') => section === 'sources' ? onSelectSources : section === 'settings' ? onSelectSettings : onSelectGoal

  if (loading && sources.length === 0 && jobs.length === 0) {
    return <div className="min-w-0 space-y-4 p-4 sm:p-6"><DashboardLoadingState label="Loading workspace" /></div>
  }

  const setupReady = agentConnected && sources.length > 0 && activeSources.some(source => getSourceState(source) === 'ready')
  if (!setupReady) {
    return <DashboardOnboarding agentConnected={agentConnected} sources={sources} activeSources={activeSources} error={error} onOpenSources={onSelectSources} onOpenSettings={onSelectSettings} onOpenGoal={onSelectGoal} onRefresh={onRefresh} />
  }

  return (
    <div className="min-h-full space-y-4 p-4 sm:p-6">
      <DashboardPanel variant="raised" className="p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <DashboardSectionHeader
            eyebrow="Current work"
            title={model.currentWork.title}
            detail={model.currentWork.detail}
          />
          <DashboardStatusBadge label={model.currentWork.stateLabel} tone={model.currentWork.stateTone} />
        </div>
        <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div className="min-w-0 space-y-3">
            <DashboardMetaRow label="Phase" value={model.currentWork.phase} />
            <DashboardMetaRow label="Task" value={model.currentWork.task} />
            {model.currentWork.source ? <DashboardMetaRow label="Source" value={model.currentWork.source.label} /> : null}
          </div>
          <div className="min-w-0 rounded-md bg-mm-subtle/70 px-3 py-3 dark:bg-slate-900/60">
            <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-mm-muted">Progress</p>
            <p className="mt-1 text-[15px] font-semibold text-mm-text" aria-label={model.currentWork.progress.accessibleLabel}>{model.currentWork.progress.text}</p>
            {model.currentWork.nextAction ? <p className="mt-1 break-words text-[12px] leading-5 text-mm-muted">Next: {model.currentWork.nextAction}</p> : null}
          </div>
        </div>
        <div className="mt-5 flex flex-wrap gap-2">
          <DashboardButton type="button" variant="primary" onClick={onSelectGoal}>{model.currentWork.state === 'idle' ? 'Open Goal / Run' : 'View current run'}</DashboardButton>
          {!model.currentWork.source ? <DashboardButton type="button" variant="secondary" onClick={onSelectSources}>Choose a source</DashboardButton> : null}
        </div>
      </DashboardPanel>

      <DashboardPanel variant="flat" className="p-5" aria-labelledby="overview-attention-heading">
        <DashboardSectionHeader
          eyebrow="Attention"
          title={model.attention.length > 0 ? 'Needs your attention' : 'Nothing needs your attention'}
          detail={model.attention.length > 0 ? 'Each item explains whether work is stopped and where to act.' : 'Current source, run, and workspace signals are clear.'}
          action={model.attention.length > 0 ? <DashboardStatusBadge label={`${model.attention.length} item${model.attention.length === 1 ? '' : 's'}`} tone="warn" /> : <DashboardStatusBadge label="Clear" tone="good" />}
        />
        <h2 id="overview-attention-heading" className="sr-only">Overview attention</h2>
        {model.attention.length > 0 ? (
          <div className="mt-4 space-y-2">
            {model.attention.map(item => (
              <div key={item.id} className="flex flex-wrap items-start justify-between gap-3 rounded-md border border-mm-border/70 bg-mm-surface px-3 py-3 dark:border-slate-800/70 dark:bg-slate-950/35">
                <div className="flex min-w-0 items-start gap-3">
                  <DashboardStatusBadge label={item.stopped ? 'Stopped' : 'Review'} tone={item.tone} />
                  <div className="min-w-0">
                    <p className="text-[13px] font-medium text-mm-text">{item.title}</p>
                    <p className="mt-1 break-words text-[12px] leading-5 text-mm-muted">{item.detail}</p>
                  </div>
                </div>
                <DashboardButton type="button" variant="secondary" className="shrink-0" onClick={actionFor(item.actionSection)}>{item.actionLabel}</DashboardButton>
              </div>
            ))}
          </div>
        ) : null}
      </DashboardPanel>

      <div className="grid gap-4 lg:grid-cols-2">
        <DashboardPanel variant="flat" className="p-5">
          <DashboardSectionHeader eyebrow="Context" title="Active source" detail="The source summary for the next piece of work." />
          <div className="mt-4">
            {model.sourceSummary.source ? (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="min-w-0 truncate text-[15px] font-semibold text-mm-text">{model.sourceSummary.source.label}</span>
                  <DashboardStatusBadge label={model.sourceSummary.stateLabel} tone={model.sourceSummary.stateTone} />
                </div>
                <p className="break-words text-[12px] leading-5 text-mm-muted">{model.sourceSummary.detail}</p>
                <DashboardMetaRow label="Authority" value={model.sourceSummary.authorityLabel} />
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-[13px] text-mm-muted">No source is active yet. Add or select one before starting work.</p>
                <DashboardButton type="button" variant="secondary" onClick={onSelectSources}>Open Sources</DashboardButton>
              </div>
            )}
          </div>
        </DashboardPanel>

        <DashboardPanel variant="flat" className="p-5">
          <DashboardSectionHeader
            eyebrow="Recent outcome"
            title="Recently completed"
            detail="Useful outcomes first; technical records remain in Activity."
            action={<DashboardButton type="button" variant="ghost" onClick={onSelectActivity}>View Activity</DashboardButton>}
          />
          <div className="mt-4 space-y-3">
            {model.recent.length > 0 ? model.recent.slice(0, 3).map(item => (
              <div key={item.id} className="flex min-w-0 items-start gap-3">
                <DashboardStatusBadge label={item.tone === 'good' ? 'Complete' : item.tone === 'warn' ? 'Review' : item.tone === 'bad' ? 'Failed' : 'Update'} tone={item.tone} />
                <div className="min-w-0">
                  <p className="truncate text-[13px] font-medium text-mm-text">{item.title}</p>
                  <p className="mt-1 break-words text-[12px] leading-5 text-mm-muted">{item.detail}</p>
                </div>
              </div>
            )) : <p className="text-[13px] text-mm-muted">No completed work yet. This is expected until Mastermind finishes its first Goal or Run.</p>}
          </div>
        </DashboardPanel>
      </div>

      <DashboardPanel variant="flat" className="p-5">
        <DashboardSectionHeader eyebrow="System health" title={model.health.label} detail={model.health.detail} />
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="flex items-center justify-between gap-3 rounded-md bg-mm-subtle/70 px-3 py-2.5"><span className="text-[12px] text-mm-muted">System</span><DashboardStatusBadge label={getSystemHealthLabel(systemHealth)} tone={healthTone(systemHealth)} /></div>
          <div className="rounded-md bg-mm-subtle/70 px-3 py-2.5"><p className="text-[11px] text-mm-muted">Ready sources</p><p className="mt-1 text-[14px] font-semibold text-mm-text">{model.readiness.ready} of {model.readiness.configured}</p></div>
          <div className="rounded-md bg-mm-subtle/70 px-3 py-2.5"><p className="text-[11px] text-mm-muted">Preparing</p><p className="mt-1 text-[14px] font-semibold text-mm-text">{model.readiness.preparing}</p></div>
          <div className="rounded-md bg-mm-subtle/70 px-3 py-2.5"><p className="text-[11px] text-mm-muted">Unavailable</p><p className="mt-1 text-[14px] font-semibold text-mm-text">{model.readiness.unavailable}</p></div>
        </div>
      </DashboardPanel>
    </div>
  )
}

function PlaceholderView({ section, systemHealth, sources, activeSources, writeMode, activity, onSelectSources, onSelectGoal }: DashboardFoundationViewProps) {
  const readyCount = sources.filter(source => getSourceState(source) === 'ready').length
  const preparingCount = sources.filter(source => getSourceState(source) === 'preparing').length
  const unavailableCount = sources.filter(source => getSourceState(source) === 'unavailable').length
  const copy = sectionCopy[section]

  return (
    <div className="min-h-full space-y-4 p-4 sm:p-6">
      <DashboardPanel variant="flat" className="p-5 sm:p-6">
        <DashboardSectionHeader eyebrow={copy.eyebrow} title={copy.title} detail={copy.detail} />
        <div className="mt-5 flex flex-wrap items-center gap-2">
          <DashboardStatusBadge label={getSystemHealthLabel(systemHealth)} tone={healthTone(systemHealth)} />
          <DashboardStatusBadge label={getAuthorityLabel(writeMode)} tone="neutral" />
        </div>
      </DashboardPanel>

      {section === 'activity' ? (
        <DashboardPanel variant="flat" className="p-5">
          <DashboardSectionHeader title="Workspace updates" detail="Technical evidence stays available from the run details." />
          <div className="mt-4 divide-y divide-mm-border/70">
            {activity.length > 0 ? activity.map(item => (
              <div key={item.id} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
                <DashboardStatusBadge label={item.tone === 'good' ? 'Done' : item.tone === 'warn' ? 'Attention' : item.tone === 'bad' ? 'Failed' : 'Update'} tone={item.tone} />
                <div className="min-w-0"><p className="text-[13px] font-medium text-mm-text">{item.label}</p><p className="mt-1 text-[12px] leading-5 text-mm-muted">{item.detail}</p></div>
              </div>
            )) : <p className="text-[13px] text-mm-muted">No activity yet. Updates will appear here as the workspace changes.</p>}
          </div>
        </DashboardPanel>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          <DashboardPanel variant="flat" className="p-5">
            <DashboardSectionHeader title="Readiness" detail="System and source state are shown separately." />
            <div className="mt-4 space-y-3 text-[13px]">
              <DashboardMetaRow label="System" value={<DashboardStatusBadge label={getSystemHealthLabel(systemHealth)} tone={healthTone(systemHealth)} />} />
              <DashboardMetaRow label="Ready sources" value={`${readyCount} of ${sources.length}`} />
              <DashboardMetaRow label="Preparing" value={preparingCount} />
              <DashboardMetaRow label="Unavailable" value={unavailableCount} />
            </div>
          </DashboardPanel>
          <DashboardPanel variant="flat" className="p-5">
            <DashboardSectionHeader title="Current context" detail="The source and authority used for the next goal." />
            <div className="mt-4 space-y-2">
              {activeSources.length > 0 ? activeSources.slice(0, 3).map(source => {
                const state = getSourceState(source)
                return <div key={source.id} className="flex items-center justify-between gap-3 rounded-md bg-mm-subtle px-3 py-2"><span className="truncate text-[13px] font-medium text-mm-text">{source.label}</span><DashboardStatusBadge label={getSourceStateLabel(state)} tone={getSourceStateTone(state)} /></div>
              }) : <p className="text-[13px] text-mm-muted">No active source selected.</p>}
            </div>
          </DashboardPanel>
        </div>
      )}

      <DashboardPanel variant="flat" className="flex flex-wrap items-center justify-between gap-4 p-5">
        <div><p className="text-[13px] font-medium text-mm-text">{sources.length > 0 ? 'Ready to work with your context?' : 'Connect your first source'}</p><p className="mt-1 text-[12px] text-mm-muted">{sources.length > 0 ? 'Choose a source or start a bounded goal when the workflow is ready.' : 'Mastermind keeps the repository as the source of truth.'}</p></div>
        <div className="flex flex-wrap gap-2"><DashboardButton type="button" variant="secondary" onClick={onSelectSources}>View sources</DashboardButton><DashboardButton type="button" variant="primary" onClick={onSelectGoal}>Open Goal / Run</DashboardButton></div>
      </DashboardPanel>
    </div>
  )
}
