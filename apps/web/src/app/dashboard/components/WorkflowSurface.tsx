import type { ReactNode } from 'react'
import type { ActiveSourcesMode, KnowledgeSource, WriteMode } from '@mastermind/shared'
import type { DashboardActivityLine, DashboardJob, DashboardSection } from '../types'
import { runWorkflowState, validationWorkflowState } from '../workflow'
import {
  getAuthorityLabel,
  getSourceState,
  getSourceStateLabel,
  getSourceStateTone,
  getSystemHealthLabel,
  getWorkStateLabel,
  getWorkStateTone,
  type StatusTone,
  type SystemHealth
} from '../status'
import { DashboardButton } from './ui/DashboardButton'
import { DashboardMetaRow } from './ui/DashboardMetaRow'
import { DashboardPanel } from './ui/DashboardPanel'
import { DashboardSectionHeader } from './ui/DashboardSectionHeader'
import { DashboardStatusBadge } from './ui/DashboardStatusBadge'
import { DashboardEmptyState, DashboardLoadingState, DashboardProblemState } from './DashboardState'
import { getDashboardErrorCopy } from '../state'

type WorkflowSurfaceProps = {
  section: Exclude<DashboardSection, 'overview'>
  systemHealth: SystemHealth
  activeMode: ActiveSourcesMode
  sources: KnowledgeSource[]
  activeSources: KnowledgeSource[]
  writeMode: WriteMode
  activity: DashboardActivityLine[]
  jobs: DashboardJob[]
  loading: boolean
  agentConnected: boolean
  error: string | null
  selectedSourceId: string | null
  busySourceId: string | null
  busyJobId: string | null
  onOpenAddSource: () => void
  onSelectSources: () => void
  onSelectGoal: () => void
  onSelectActivity: () => void
  onSelectSettings: () => void
  onToggleActive: (source: KnowledgeSource) => void
  onToggleEnabled: (source: KnowledgeSource) => void
  onReindex: (source: KnowledgeSource) => void
  onRemove: (source: KnowledgeSource) => void
  onControlJob: (job: DashboardJob, action: 'pause' | 'resume' | 'cancel') => void
  onSetContextMode: (mode: ActiveSourcesMode) => void
  onSetWriteMode: (mode: WriteMode) => void
  onRefresh: () => void
}

const activeStatuses = new Set(['queued', 'running', 'needs_confirmation', 'paused', 'blocked'])
const terminalStatuses = new Set(['completed', 'failed', 'cancelled'])

const toneForSource = (source: KnowledgeSource): StatusTone => getSourceStateTone(getSourceState(source))

const sourceIsActive = (source: KnowledgeSource, activeSources: KnowledgeSource[]) => activeSources.some(item => item.id === source.id)

const formatDate = (value?: string) => {
  if (!value) return 'Not available'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? 'Not available' : date.toLocaleString()
}

const progressText = (progress: DashboardJob['compactStatus']['overall']) => {
  if (progress.confidence === 'exact' && progress.denominator > 0) return `${progress.numerator} of ${progress.denominator} tasks`
  return 'Progress is being measured'
}

export function WorkflowSurface(props: WorkflowSurfaceProps) {
  if (props.section === 'sources') return <SourcesView {...props} />
  if (props.section === 'goal-run') return <GoalRunView {...props} />
  if (props.section === 'activity') return <ActivityView {...props} />
  return <SettingsView {...props} />
}

function SurfaceFrame({
  eyebrow,
  title,
  detail,
  children,
  action
}: {
  eyebrow: string
  title: string
  detail: string
  children: ReactNode
  action?: React.ReactNode
}) {
  return (
    <div className="min-h-full min-w-0 space-y-4 overflow-x-hidden p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <DashboardSectionHeader eyebrow={eyebrow} title={title} detail={detail} />
        {action}
      </div>
      {children}
    </div>
  )
}

function SourcesView(props: WorkflowSurfaceProps) {
  const ready = props.sources.filter(source => getSourceState(source) === 'ready').length
  const preparing = props.sources.filter(source => getSourceState(source) === 'preparing').length
  const unavailable = props.sources.filter(source => getSourceState(source) === 'unavailable').length

  return (
    <SurfaceFrame
      eyebrow="Sources"
      title="Choose the context for work"
      detail="Sources are connected workspace context. The active marker shows what the next conversation or run can use."
      action={<DashboardButton type="button" variant="primary" onClick={props.onOpenAddSource}>Add source</DashboardButton>}
    >
      <DashboardPanel variant="flat" className="p-4" aria-label="Source readiness summary">
        <div className="grid gap-3 sm:grid-cols-3">
          <SummaryMetric label="Ready" value={`${ready}`} detail="Available for work" tone="good" />
          <SummaryMetric label="Preparing" value={`${preparing}`} detail="Indexing or becoming ready" tone="warn" />
          <SummaryMetric label="Unavailable" value={`${unavailable}`} detail="Needs attention" tone="bad" />
        </div>
      </DashboardPanel>

      {props.loading && props.sources.length === 0 ? <DashboardLoadingState label="Loading Sources" detail="Checking configured repositories and folders." /> : props.error && props.sources.length === 0 ? <DashboardProblemState copy={getDashboardErrorCopy(props.error)} onAction={props.onRefresh} technicalDetail={props.error} /> : props.sources.length === 0 ? (
        <DashboardEmptyState title="No Sources connected" detail="This is expected on a first visit. Add a repository or folder so Mastermind can prepare bounded context for work." actionLabel="Add a Source" onAction={props.onOpenAddSource} secondaryLabel="Review Settings" onSecondary={props.onSelectSettings} />
      ) : (
        <DashboardPanel variant="flat" className="p-4">
          <DashboardSectionHeader title={`${props.sources.length} connected source${props.sources.length === 1 ? '' : 's'}`} detail="Open advanced details only when you need the technical identity or path." />
          <ul className="mt-4 space-y-3" aria-label="Connected sources">
            {props.sources.map(source => (
              <SourceRow key={source.id} source={source} active={sourceIsActive(source, props.activeSources)} selected={source.id === props.selectedSourceId} busy={props.busySourceId === source.id} onToggleActive={props.onToggleActive} onToggleEnabled={props.onToggleEnabled} onReindex={props.onReindex} onRemove={props.onRemove} />
            ))}
          </ul>
        </DashboardPanel>
      )}

      <DashboardPanel variant="flat" className="p-5">
        <DashboardSectionHeader title="Current source scope" detail="This is the context used for the next goal or run." />
        <div className="mt-4 space-y-2">
          {props.activeSources.length > 0 ? props.activeSources.map(source => (
            <div key={source.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-mm-subtle/70 px-3 py-2.5">
              <span className="min-w-0 truncate text-sm font-medium text-mm-text">{source.label}</span>
              <DashboardStatusBadge label="Active" tone="good" />
            </div>
          )) : <DashboardEmptyState title="No active Source" detail="Your connected Sources are still available above. Activate one to establish the context for the next Goal or Run." actionLabel="View Sources" onAction={props.onSelectSources} />}
        </div>
      </DashboardPanel>
    </SurfaceFrame>
  )
}

function SourceRow({
  source,
  active,
  selected,
  busy,
  onToggleActive,
  onToggleEnabled,
  onReindex,
  onRemove
}: {
  source: KnowledgeSource
  active: boolean
  selected: boolean
  busy: boolean
  onToggleActive: (source: KnowledgeSource) => void
  onToggleEnabled: (source: KnowledgeSource) => void
  onReindex: (source: KnowledgeSource) => void
  onRemove: (source: KnowledgeSource) => void
}) {
  const state = getSourceState(source)
  return (
    <li className={`rounded-lg border p-4 ${selected ? 'border-mm-focus bg-mm-subtle/50' : 'border-mm-border/80 bg-mm-surface'} ${active ? 'ring-1 ring-emerald-500/30' : ''}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${state === 'ready' ? 'bg-emerald-500' : state === 'preparing' ? 'bg-amber-500' : 'bg-red-500'}`} aria-hidden="true" />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="break-words text-sm font-semibold text-mm-text">{source.label}</h3>
              <DashboardStatusBadge label={getSourceStateLabel(state)} tone={toneForSource(source)} />
              {active ? <DashboardStatusBadge label="Active context" tone="good" /> : null}
            </div>
            <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-mm-muted">
              <span>{source.type || 'Repository'}</span>
              {source.branchName ? <span>Branch: {source.branchName}</span> : null}
              {source.isGitWorktree ? <span>{source.isManagedWorktree ? 'Managed worktree' : 'Worktree'}</span> : null}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <DashboardButton type="button" variant={active ? 'secondary' : 'primary'} onClick={() => onToggleActive(source)} disabled={busy || (!source.enabled && !active)}>{busy ? 'Updating…' : active ? 'Deactivate' : 'Activate'}</DashboardButton>
          <DashboardButton type="button" variant="ghost" onClick={() => onToggleEnabled(source)} disabled={busy}>{source.enabled ? 'Disable' : 'Enable'}</DashboardButton>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-mm-border/60 pt-3">
        <p className="text-xs text-mm-muted">{source.indexedFileCount !== undefined ? `${source.indexedFileCount.toLocaleString()} indexed files` : 'Index status is available above.'}{source.lastIndexedAt ? ` · Updated ${formatDate(source.lastIndexedAt)}` : ''}</p>
        <div className="flex flex-wrap gap-2">
          <DashboardButton type="button" variant="ghost" onClick={() => onReindex(source)} disabled={busy || state === 'preparing' || !source.enabled}>Re-index</DashboardButton>
          <DashboardButton type="button" variant="ghost" onClick={() => onRemove(source)} disabled={busy}>Remove</DashboardButton>
        </div>
      </div>
      {state !== 'ready' && source.indexError ? (
        <div className="mt-3 rounded-md border border-red-200/70 bg-red-50/60 px-3 py-2 dark:border-red-900/50 dark:bg-red-950/20" role="status">
          <p className="text-xs font-medium text-red-800 dark:text-red-200">This Source needs attention before it can ground work.</p>
          <details className="mt-1.5">
            <summary className="cursor-pointer text-[11px] text-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mm-focus dark:text-red-300">Show diagnostic detail</summary>
            <p className="mt-1 break-words font-mono text-[11px] leading-5 text-red-700 dark:text-red-300">{source.indexError}</p>
          </details>
        </div>
      ) : null}
      <details className="mt-3 rounded-md border border-mm-border/60 px-3 py-2">
        <summary className="cursor-pointer text-xs font-medium text-mm-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mm-focus">Advanced source details</summary>
        <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
          <DashboardMetaRow label="Path" value={<code className="break-all text-[11px]">{source.path}</code>} />
          <DashboardMetaRow label="Source ID" value={<code className="break-all text-[11px]">{source.id}</code>} />
          {source.repoRoot ? <DashboardMetaRow label="Repository root" value={<code className="break-all text-[11px]">{source.repoRoot}</code>} /> : null}
          {source.availableBranches?.length ? <DashboardMetaRow label="Branches" value={source.availableBranches.join(', ')} /> : null}
        </dl>
      </details>
    </li>
  )
}

function GoalRunView(props: WorkflowSurfaceProps) {
  const current = props.jobs.find(job => activeStatuses.has(job.status)) || props.jobs[0]
  const history = props.jobs.filter(job => !current || job.id !== current.id)
  const source = current ? props.sources.find(item => item.id === current.sourceId) : undefined
  const state = current ? runWorkflowState(current) : 'idle'

  if (props.loading && props.jobs.length === 0) {
    return <SurfaceFrame eyebrow="Goal / Run" title="Durable goals and runs" detail="Follow the current goal, its bounded progress, and the evidence that explains what happens next."><DashboardLoadingState label="Loading Goals and Runs" detail="Checking durable work and its current evidence." /></SurfaceFrame>
  }

  return (
    <SurfaceFrame eyebrow="Goal / Run" title="Durable goals and runs" detail="Follow the current goal, its bounded progress, and the evidence that explains what happens next.">
      {!current ? (
        <DashboardEmptyState title="No Goals or Runs yet" detail="This is expected until you start durable Goal work. Choose a ready Source first, then return here to follow progress and evidence." actionLabel="Choose a Source" onAction={props.onSelectSources} secondaryLabel="Review Safety" onSecondary={props.onSelectSettings} />
      ) : (
        <>
          <DashboardPanel variant="raised" className="p-5 sm:p-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-mm-muted">Current work</p>
                <h2 className="mt-1 break-words text-xl font-semibold tracking-tight text-mm-text">{current.goal || current.summary || 'Current run'}</h2>
                <p className="mt-2 break-words text-sm leading-6 text-mm-muted">{current.summary || current.compactStatus.currentPosition}</p>
              </div>
              <DashboardStatusBadge label={getWorkStateLabel(state)} tone={getWorkStateTone(state)} />
            </div>
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <div className="space-y-3">
                <DashboardMetaRow label="Source" value={source?.label || 'Source unavailable'} />
                <DashboardMetaRow label="Phase" value={current.compactStatus.phaseTitle || current.activeTask?.phaseTitle || 'Current run'} />
                <DashboardMetaRow label="Task" value={current.compactStatus.taskTitle || current.activeTask?.title || 'No active task'} />
                <DashboardMetaRow label="Authority" value={getAuthorityLabel(props.writeMode)} />
              </div>
              <div className="rounded-md bg-mm-subtle/70 px-3 py-3">
                <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-mm-muted">Progress</p>
                <p className="mt-1 text-base font-semibold text-mm-text" aria-label={current.compactStatus.overall.accessibleLabel}>{progressText(current.compactStatus.overall)}</p>
                <p className="mt-1 break-words text-xs leading-5 text-mm-muted">{current.compactStatus.currentPosition}</p>
                {current.compactStatus.nextAction ? <p className="mt-2 break-words text-xs leading-5 text-mm-muted">Next: {current.compactStatus.nextAction}</p> : null}
              </div>
            </div>
            <div className="mt-5 flex flex-wrap gap-2"><RunControls job={current} busyJobId={props.busyJobId} onControl={props.onControlJob} /></div>
          </DashboardPanel>

          {state === 'waiting' ? <WorkflowNotice tone="warn" title="Waiting for approval" detail={current.confirmationReason || 'This operation requires your confirmation before the run can continue.'} implication="No further work is advanced until the approval decision is recorded." /> : null}
          {state === 'blocked' ? <WorkflowNotice tone="warn" title="Run is blocked" detail={current.blockedReason || current.compactStatus.blocker || 'The run cannot safely continue yet.'} implication="Resolve the blocker or use the supported resume path before continuing." /> : null}
          {state === 'failed' ? <WorkflowNotice tone="bad" title="Run failed" detail={current.summary || current.compactStatus.blocker || 'The run stopped with an error.'} implication="Review the failure evidence below before retrying or changing scope." /> : null}
          {state === 'validating' ? <WorkflowNotice tone="neutral" title="Validating" detail={current.compactStatus.currentPosition} implication="The result is not complete until validation reports its outcome." /> : null}
          {state === 'complete' ? <CompletionPanel job={current} /> : null}
          <ValidationPanel job={current} />
          <HandoffContext job={current} source={source} />
        </>
      )}

      {history.length > 0 ? <RunHistory jobs={history} sources={props.sources} /> : null}
      {props.error ? <DashboardProblemState copy={getDashboardErrorCopy(props.error)} onAction={props.onRefresh} technicalDetail={props.error} /> : null}
    </SurfaceFrame>
  )
}

function RunControls({ job, busyJobId, onControl }: { job: DashboardJob; busyJobId: string | null; onControl: WorkflowSurfaceProps['onControlJob'] }) {
  return <>
    <DashboardButton type="button" variant="secondary" onClick={() => onControl(job, 'pause')} disabled={busyJobId === job.id || !['queued', 'running'].includes(job.status)}>Pause</DashboardButton>
    <DashboardButton type="button" variant="secondary" onClick={() => onControl(job, 'resume')} disabled={busyJobId === job.id || job.status !== 'paused'}>Resume</DashboardButton>
    <DashboardButton type="button" variant="ghost" onClick={() => onControl(job, 'cancel')} disabled={busyJobId === job.id || terminalStatuses.has(job.status)}>Cancel</DashboardButton>
  </>
}

function WorkflowNotice({ tone, title, detail, implication }: { tone: StatusTone; title: string; detail: string; implication: string }) {
  return <DashboardPanel variant="flat" className="border border-mm-border/70 p-5"><div className="flex flex-wrap items-start gap-3"><DashboardStatusBadge label={title} tone={tone} /><div className="min-w-0"><h3 className="text-sm font-semibold text-mm-text">{title}</h3><p className="mt-1 break-words text-sm leading-6 text-mm-muted">{detail}</p><p className="mt-2 break-words text-xs leading-5 text-mm-muted">{implication}</p></div></div></DashboardPanel>
}

function ValidationPanel({ job }: { job: DashboardJob }) {
  const packets = job.packets || []
  const validations = packets.flatMap(packet => packet.validation.map(result => ({ ...result, packet })))
  if (validations.length === 0) return null
  const state = validationWorkflowState(job)
  const detail = state === 'passed' ? 'Validation passed for the recorded checks.' : state === 'failed' ? 'At least one recorded check failed.' : 'Validation results are available for the current run.'
  return <DashboardPanel variant="flat" className="p-5"><DashboardSectionHeader title="Validation evidence" detail={detail} /><ul className="mt-4 space-y-2" aria-label="Validation results">{validations.map((result, index) => <li key={`${result.packet.packetId}-${result.commandKind}-${index}`} className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-mm-subtle/70 px-3 py-2.5 text-xs"><span className="min-w-0 break-words text-mm-text">{result.commandKind}</span><span className={result.status === 'completed' || result.exitCode === 0 ? 'text-emerald-700 dark:text-emerald-300' : 'text-red-700 dark:text-red-300'}>{result.status}{result.exitCode === null ? '' : ` · exit ${result.exitCode}`}</span></li>)}</ul><details className="mt-3"><summary className="cursor-pointer text-xs font-medium text-mm-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mm-focus">Technical validation details</summary><div className="mt-2 space-y-1 text-xs text-mm-muted">{validations.map((result, index) => <p key={`${result.packet.packetId}-detail-${index}`}>{result.commandKind}: {result.durationMs}ms · packet {result.packet.packetId}</p>)}</div></details></DashboardPanel>
}

function CompletionPanel({ job }: { job: DashboardJob }) {
  const packets = job.packets || []
  const paths = Array.from(new Set(packets.flatMap(packet => packet.exactPaths)))
  const commit = packets.find(packet => packet.commitHash)?.commitHash
  const warnings = packets.flatMap(packet => packet.errorCodes)
  return <DashboardPanel variant="flat" className="p-5"><DashboardSectionHeader eyebrow="Completion" title="Run complete" detail="The durable outcome and available evidence are summarized here." /><div className="mt-4 grid gap-3 sm:grid-cols-2"><DashboardMetaRow label="Summary" value={job.summary || 'Completed without a summary.'} /><DashboardMetaRow label="Validation" value={packets.some(packet => packet.validation.length > 0) ? 'Recorded in validation evidence' : 'No validation record returned'} /><DashboardMetaRow label="Changed files" value={paths.length > 0 ? `${paths.length} file${paths.length === 1 ? '' : 's'}` : 'No file paths returned'} /><DashboardMetaRow label="Commit" value={commit ? <code className="text-[11px]">{commit}</code> : 'No commit recorded'} /></div>{paths.length > 0 ? <details className="mt-4"><summary className="cursor-pointer text-xs font-medium text-mm-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mm-focus">Changed file details</summary><ul className="mt-2 space-y-1 text-xs text-mm-muted">{paths.map(path => <li key={path} className="break-all font-mono">{path}</li>)}</ul></details> : null}{warnings.length > 0 ? <p className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950/30 dark:text-amber-200">Warnings: {warnings.join(', ')}</p> : null}</DashboardPanel>
}

function HandoffContext({ job, source }: { job: DashboardJob; source?: KnowledgeSource }) {
  const next = job.compactStatus.nextAction || job.nextActions?.[0]
  if (!job.handoffPath && !next) return null
  return <DashboardPanel variant="flat" className="p-5"><DashboardSectionHeader eyebrow="Handoff" title="Continue with the available context" detail="This handoff is shown only because the current run provides durable continuation data." /><div className="mt-4 grid gap-3 sm:grid-cols-2"><DashboardMetaRow label="Source" value={source?.label || 'Source unavailable'} /><DashboardMetaRow label="Current state" value={getWorkStateLabel(runWorkflowState(job))} />{next ? <DashboardMetaRow label="Next action" value={next} /> : null}{job.handoffPath ? <DashboardMetaRow label="Handoff record" value="Available" /> : null}</div><details className="mt-4"><summary className="cursor-pointer text-xs font-medium text-mm-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mm-focus">Technical continuation details</summary>{job.handoffPath ? <p className="mt-2 break-all font-mono text-xs text-mm-muted">{job.handoffPath}</p> : null}<p className="mt-2 break-all font-mono text-xs text-mm-muted">Run {job.id}</p></details></DashboardPanel>
}

function RunHistory({ jobs, sources }: { jobs: DashboardJob[]; sources: KnowledgeSource[] }) {
  return <DashboardPanel variant="flat" className="p-5"><DashboardSectionHeader title="Run history" detail="Completed, failed, and cancelled runs remain available for review." /><ul className="mt-4 space-y-2" aria-label="Run history">{jobs.map(job => { const state = runWorkflowState(job); return <li key={job.id} className="rounded-md border border-mm-border/70 px-3 py-3"><div className="flex flex-wrap items-start justify-between gap-2"><div className="min-w-0"><p className="break-words text-sm font-medium text-mm-text">{job.goal || job.summary || 'Run'}</p><p className="mt-1 text-xs text-mm-muted">{sources.find(source => source.id === job.sourceId)?.label || 'Source unavailable'} · {formatDate(job.updatedAt)}</p></div><DashboardStatusBadge label={getWorkStateLabel(state)} tone={getWorkStateTone(state)} /></div></li> })}</ul></DashboardPanel>
}

function ActivityView(props: WorkflowSurfaceProps) {
  if (props.loading && props.activity.length === 0) {
    return <SurfaceFrame eyebrow="Activity" title="What changed and why" detail="Human-readable updates are grouped here; technical evidence remains available from the related run."><DashboardLoadingState label="Loading Activity" detail="Checking recent reads, changes, validation, and completed work." /></SurfaceFrame>
  }

  return <SurfaceFrame eyebrow="Activity" title="What changed and why" detail="Human-readable updates are grouped here; technical evidence remains available from the related run." action={<DashboardButton type="button" variant="secondary" onClick={props.onSelectGoal}>Open Goal / Run</DashboardButton>}>
    <DashboardPanel variant="flat" className="p-5"><DashboardSectionHeader title="Workspace timeline" detail={`${props.activity.length} recent update${props.activity.length === 1 ? '' : 's'}.`} />{props.activity.length > 0 ? <ol className="mt-4 space-y-3" aria-label="Workspace activity timeline">{props.activity.map(item => <li key={item.id} className="flex gap-3 border-l border-mm-border/80 pl-3"><DashboardStatusBadge label={item.tone === 'good' ? 'Complete' : item.tone === 'warn' ? 'Attention' : item.tone === 'bad' ? 'Failed' : 'Update'} tone={item.tone} /><div className="min-w-0"><p className="break-words text-sm font-medium text-mm-text">{item.label}</p><p className="mt-1 break-words text-xs leading-5 text-mm-muted">{item.detail}</p>{item.timestamp ? <time className="mt-1 block text-[11px] text-mm-muted" dateTime={item.timestamp}>{formatDate(item.timestamp)}</time> : null}</div></li>)}</ol> : <div className="mt-4"><DashboardEmptyState title="No Activity yet" detail="This is expected before Mastermind begins working. Reads, changes, validation, and completed work will appear here." actionLabel="Open Goal / Run" onAction={props.onSelectGoal} /></div>}</DashboardPanel>
    <DashboardPanel variant="flat" className="p-5"><DashboardSectionHeader title="Activity vocabulary" detail="Primary labels describe the user-visible state; technical records stay behind disclosure." /><div className="mt-4 flex flex-wrap gap-2">{['Validating', 'Waiting for approval', 'Blocked', 'Failed', 'Complete', 'Read only'].map(label => <DashboardStatusBadge key={label} label={label} tone={label === 'Complete' ? 'good' : label === 'Failed' ? 'bad' : label === 'Blocked' || label === 'Waiting for approval' ? 'warn' : 'neutral'} />)}</div></DashboardPanel>
  </SurfaceFrame>
}

function SettingsView(props: WorkflowSurfaceProps) {
  const ready = props.sources.filter(source => getSourceState(source) === 'ready').length
  if (props.loading && props.sources.length === 0) {
    return <SurfaceFrame eyebrow="Settings" title="Settings" detail="Understand what Mastermind can use, what it can change, and what still needs attention."><DashboardLoadingState label="Loading Settings" detail="Checking local runtime, Sources, and safety preferences." /></SurfaceFrame>
  }

  return <SurfaceFrame eyebrow="Settings" title="Settings" detail="Understand what Mastermind can use, what it can change, and what still needs attention.">
    {props.error && !props.agentConnected ? <DashboardProblemState copy={getDashboardErrorCopy(props.error)} onAction={props.onRefresh} technicalDetail={props.error} /> : null}
    <div className="grid gap-4 xl:grid-cols-2">
      <DashboardPanel variant="flat" className="p-5">
        <DashboardSectionHeader eyebrow="General" title="Local workspace" detail="Mastermind runs locally. Your repository remains authoritative." />
        <div className="mt-4 space-y-3"><DashboardMetaRow label="Runtime" value={<DashboardStatusBadge label={getSystemHealthLabel(props.systemHealth)} tone={props.systemHealth === 'healthy' ? 'good' : props.systemHealth === 'degraded' ? 'warn' : 'bad'} />} /><DashboardMetaRow label="Current context" value={props.activeSources.length > 0 ? props.activeSources.map(source => source.label).join(', ') : 'No active Source'} /><DashboardMetaRow label="Ready Sources" value={`${ready} of ${props.sources.length}`} /></div>
      </DashboardPanel>
      <DashboardPanel variant="flat" className="p-5">
        <DashboardSectionHeader eyebrow="Sources" title="Source defaults" detail="Choose the workspace context used by the next Goal or Run." />
        <div className="mt-4 flex flex-wrap gap-2"><DashboardButton type="button" variant="secondary" onClick={props.onSelectSources}>Manage Sources</DashboardButton>{props.activeSources.length === 0 ? <DashboardStatusBadge label="Action required" tone="warn" /> : <DashboardStatusBadge label="Source selected" tone="good" />}</div>
        <div className="mt-4"><p className="text-xs font-medium text-mm-text">Context scope</p><div className="mt-2 grid grid-cols-3 gap-2">{(['single', 'multi', 'all'] as ActiveSourcesMode[]).map(mode => <DashboardButton key={mode} type="button" variant={mode === props.activeMode ? 'primary' : 'secondary'} className="justify-center text-xs capitalize" onClick={() => props.onSetContextMode(mode)}>{mode}</DashboardButton>)}</div></div>
      </DashboardPanel>
      <DashboardPanel variant="flat" className="p-5">
        <DashboardSectionHeader eyebrow="ChatGPT connection" title="Guarded Action integration" detail="The canonical endpoint and five guarded Actions are available for the Custom GPT setup." />
        <div className="mt-4 space-y-3"><DashboardMetaRow label="Endpoint" value={<code className="break-all text-[11px]">https://mastermind.prochat.tools</code>} /><DashboardMetaRow label="Status" value={<DashboardStatusBadge label="Endpoint guidance available" tone="neutral" />} /></div>
        <p className="mt-3 text-xs leading-5 text-mm-muted">The dashboard does not verify external ChatGPT authentication from local runtime health alone. Use the documented setup path when the integration needs attention.</p>
        <details className="mt-3 rounded-md border border-mm-border/60 px-3 py-2"><summary className="cursor-pointer text-xs font-medium text-mm-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mm-focus">Show the five Actions</summary><ul className="mt-2 grid gap-1 text-xs text-mm-muted sm:grid-cols-2"><li>getMastermindStatus</li><li>readMastermindContext</li><li>applyMastermindFileChange</li><li>commitMastermindChanges</li><li>runMastermindCommand</li></ul></details>
      </DashboardPanel>
      <DashboardPanel variant="flat" className="p-5">
        <DashboardSectionHeader eyebrow="Authority / safety" title="Choose how much Mastermind may change" detail="Reads stay read only. Guarded writes and commands follow the selected authority and may require approval." />
        <div className="mt-4 grid gap-2 sm:grid-cols-3">{(['readOnly', 'artifactsOnly', 'safeWrites'] as WriteMode[]).map(mode => <DashboardButton key={mode} type="button" variant={props.writeMode === mode ? 'primary' : 'secondary'} className="justify-center" onClick={() => props.onSetWriteMode(mode)}>{getAuthorityLabel(mode)}</DashboardButton>)}</div>
      </DashboardPanel>
    </div>
    <DashboardPanel variant="flat" className="p-5">
      <DashboardSectionHeader eyebrow="Runtime" title="Diagnostics" detail="Human-readable state stays visible first. Technical evidence is available when recovery needs it." />
      <div className="mt-4 flex flex-wrap gap-2"><DashboardStatusBadge label={props.agentConnected ? 'Local runtime available' : 'Action required'} tone={props.agentConnected ? 'good' : 'bad'} /><DashboardButton type="button" variant="secondary" onClick={props.onRefresh}>Refresh diagnostics</DashboardButton></div>
      <details className="mt-4 rounded-md border border-mm-border/60 px-3 py-2"><summary className="cursor-pointer text-xs font-medium text-mm-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mm-focus">Advanced diagnostics</summary><div className="mt-3 space-y-3 text-xs text-mm-muted"><p>Technical source IDs and local paths are intentionally hidden until requested.</p>{props.sources.length > 0 ? <ul className="space-y-1">{props.sources.map(source => <li key={source.id} className="break-all"><span className="font-medium text-mm-text">{source.label}</span><span className="ml-2 font-mono">{source.id}</span></li>)}</ul> : <p>No Source diagnostics are available yet.</p>}{props.error ? <p className="break-words rounded-md bg-mm-subtle px-3 py-2 font-mono">{props.error}</p> : null}</div></details>
    </DashboardPanel>
    <DashboardPanel variant="flat" className="flex flex-wrap items-center justify-between gap-4 p-5"><div><p className="text-sm font-medium text-mm-text">Next useful action</p><p className="mt-1 text-xs text-mm-muted">Manage Sources, open Goal / Run, or review the Activity record.</p></div><div className="flex flex-wrap gap-2"><DashboardButton type="button" variant="secondary" onClick={props.onSelectSources}>Manage Sources</DashboardButton><DashboardButton type="button" variant="primary" onClick={props.onSelectGoal}>Open Goal / Run</DashboardButton><DashboardButton type="button" variant="ghost" onClick={props.onSelectActivity}>View Activity</DashboardButton></div></DashboardPanel>
  </SurfaceFrame>
}

function SummaryMetric({ label, value, detail, tone }: { label: string; value: string; detail: string; tone: StatusTone }) {
  return <div className="rounded-md bg-mm-subtle/70 px-3 py-3"><div className="flex items-center justify-between gap-2"><span className="text-xs text-mm-muted">{label}</span><DashboardStatusBadge label={value} tone={tone} /></div><p className="mt-1 text-xs text-mm-muted">{detail}</p></div>
}
