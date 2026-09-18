import type { KnowledgeSource, WriteMode } from '@mastermind/shared'
import {
  getAuthorityLabel,
  getSourceState,
  getSourceStateLabel,
  getSourceStateTone,
  getSystemHealthLabel,
  getWorkState,
  getWorkStateLabel,
  getWorkStateTone,
  type SourceState,
  type StatusTone,
  type SystemHealth,
  type WorkState
} from './status'

export type OverviewProgressInput = {
  numerator?: number
  denominator?: number
  confidence?: 'exact' | 'unknown'
}

export type OverviewJob = {
  id: string
  sourceId: string
  status: string
  summary?: string
  updatedAt?: string
  confirmationReason?: string
  blockedReason?: string
  activeTask?: {
    title: string
    phaseTitle: string
    status: string
  }
  compactStatus: {
    phaseTitle?: string
    taskTitle?: string
    currentPosition: string
    blocker?: string
    nextAction?: string
    overall: OverviewProgressInput
  }
}

export type OverviewActivity = {
  id: string
  label: string
  detail: string
  tone: StatusTone
  timestamp?: string
}

export type OverviewProgress = {
  kind: 'bounded' | 'semantic' | 'none'
  text: string
  accessibleLabel: string
}

export type OverviewCurrentWork = {
  title: string
  state: WorkState
  stateLabel: string
  stateTone: StatusTone
  phase: string
  task: string
  detail: string
  progress: OverviewProgress
  nextAction?: string
  source?: KnowledgeSource
}

export type OverviewAttentionItem = {
  id: string
  tone: Extract<StatusTone, 'warn' | 'bad'>
  title: string
  detail: string
  stopped: boolean
  actionLabel: string
  actionSection: 'sources' | 'goal-run' | 'settings'
}

export type OverviewRecentItem = {
  id: string
  title: string
  detail: string
  tone: StatusTone
  timestamp?: string
}

export type OverviewSourceSummary = {
  source?: KnowledgeSource
  state: SourceState | 'none'
  stateLabel: string
  stateTone: StatusTone
  detail: string
  authorityLabel: string
}

export type OverviewModel = {
  currentWork: OverviewCurrentWork
  attention: OverviewAttentionItem[]
  recent: OverviewRecentItem[]
  sourceSummary: OverviewSourceSummary
  health: {
    label: string
    tone: StatusTone
    detail: string
  }
  readiness: {
    configured: number
    ready: number
    preparing: number
    unavailable: number
  }
}

const ACTIVE_JOB_STATUSES = new Set(['queued', 'running', 'needs_confirmation', 'paused', 'blocked'])

function toneForHealth(health: SystemHealth): StatusTone {
  return health === 'healthy' ? 'good' : health === 'degraded' ? 'warn' : 'bad'
}

function sourceForJob(job: OverviewJob | undefined, sources: readonly KnowledgeSource[], activeSources: readonly KnowledgeSource[]): KnowledgeSource | undefined {
  if (job) return sources.find(source => source.id === job.sourceId) || activeSources[0]
  return activeSources[0]
}

export function selectCurrentJob(jobs: readonly OverviewJob[]): OverviewJob | undefined {
  return jobs.find(job => ACTIVE_JOB_STATUSES.has(job.status))
}

export function formatOverviewProgress(progress: OverviewProgressInput, state: WorkState, currentPosition = ''): OverviewProgress {
  const numerator = progress.numerator
  const denominator = progress.denominator
  const hasAuthoritativeDenominator = progress.confidence === 'exact'
    && typeof numerator === 'number'
    && typeof denominator === 'number'
    && Number.isFinite(numerator)
    && Number.isFinite(denominator)
    && denominator > 0

  if (hasAuthoritativeDenominator) {
    const boundedNumerator = Math.max(0, Math.min(Math.floor(numerator), Math.floor(denominator)))
    const text = `${boundedNumerator} of ${Math.floor(denominator)} tasks`
    return { kind: 'bounded', text, accessibleLabel: `Progress: ${text}` }
  }

  if (state !== 'idle') {
    const text = getWorkStateLabel(state)
    return { kind: 'semantic', text, accessibleLabel: `Progress: ${text}${currentPosition ? ` · ${currentPosition}` : ''}` }
  }

  return { kind: 'none', text: 'Not started', accessibleLabel: 'Progress: not started' }
}

export function buildCurrentWork(
  jobs: readonly OverviewJob[],
  sources: readonly KnowledgeSource[],
  activeSources: readonly KnowledgeSource[]
): OverviewCurrentWork {
  const job = selectCurrentJob(jobs)
  const source = sourceForJob(job, sources, activeSources)

  if (!job) {
    const sourceState = source ? getSourceState(source) : undefined
    const ready = sourceState === 'ready'
    return {
      title: ready ? 'Mastermind is ready' : 'Set up your workspace',
      state: 'idle',
      stateLabel: getWorkStateLabel('idle'),
      stateTone: getWorkStateTone('idle'),
      phase: 'Idle',
      task: ready ? 'Start a bounded goal when you are ready.' : 'Add or prepare a source before starting work.',
      detail: source
        ? `${source.label} is the active context. ${ready ? 'Your local workspace is ready for the next goal.' : 'Context is not ready for work yet.'}`
        : 'Choose a local source to give the next goal a clear context.',
      progress: formatOverviewProgress({}, 'idle'),
      nextAction: ready ? 'Open Goal / Run' : 'Open Sources',
      source
    }
  }

  const state = getWorkState(job.status, job.compactStatus.currentPosition, job.activeTask?.status)
  const phase = job.compactStatus.phaseTitle || job.activeTask?.phaseTitle || 'Current phase'
  const task = job.compactStatus.taskTitle || job.activeTask?.title || job.compactStatus.currentPosition || 'Current task'
  const detail = state === 'waiting'
    ? job.confirmationReason || job.compactStatus.blocker || 'Mastermind is waiting for your approval before continuing.'
    : state === 'blocked'
      ? job.blockedReason || job.compactStatus.blocker || 'Work is stopped until the blocker is resolved.'
      : humanizeActivityDetail(job.summary || `Mastermind is ${getWorkStateLabel(state).toLowerCase()} in ${source?.label || 'the active workspace'}.`)

  return {
    title: source ? `Work in ${source.label}` : 'Current work',
    state,
    stateLabel: getWorkStateLabel(state),
    stateTone: getWorkStateTone(state),
    phase,
    task,
    detail,
    progress: formatOverviewProgress(job.compactStatus.overall, state, job.compactStatus.currentPosition),
    nextAction: job.compactStatus.nextAction ? humanizeActivityDetail(job.compactStatus.nextAction) : undefined,
    source
  }
}

export function buildAttentionItems(input: {
  systemHealth: SystemHealth
  error?: string | null
  sources: readonly KnowledgeSource[]
  activeSources: readonly KnowledgeSource[]
  jobs: readonly OverviewJob[]
}): OverviewAttentionItem[] {
  const items: OverviewAttentionItem[] = []
  const currentJob = selectCurrentJob(input.jobs)
  const failedJob = input.jobs.find(job => job.status === 'failed')

  if (input.systemHealth !== 'healthy') {
    items.push({
      id: 'system-health',
      tone: input.systemHealth === 'offline' ? 'bad' : 'warn',
      title: input.systemHealth === 'offline' ? 'Local workspace is offline' : 'Local workspace needs attention',
      detail: input.error || (input.systemHealth === 'offline' ? 'Mastermind cannot reach the local workspace right now.' : 'Mastermind can reach the workspace, but a recent operation needs review.'),
      stopped: input.systemHealth === 'offline',
      actionLabel: 'Open Settings',
      actionSection: 'settings'
    })
  }

  if (currentJob?.status === 'needs_confirmation') {
    items.push({
      id: `approval-${currentJob.id}`,
      tone: 'warn',
      title: 'Approval required to continue',
      detail: currentJob.confirmationReason || currentJob.compactStatus.blocker || 'The current run is stopped until you review and approve the next action.',
      stopped: true,
      actionLabel: 'Open Goal / Run',
      actionSection: 'goal-run'
    })
  } else if (currentJob?.status === 'blocked' || currentJob?.status === 'paused') {
    items.push({
      id: `blocked-${currentJob.id}`,
      tone: 'bad',
      title: 'Current work is blocked',
      detail: currentJob.blockedReason || currentJob.compactStatus.blocker || 'The run is stopped. Review the current task before resuming.',
      stopped: true,
      actionLabel: 'Open Goal / Run',
      actionSection: 'goal-run'
    })
  } else if (failedJob) {
    items.push({
      id: `failed-${failedJob.id}`,
      tone: 'bad',
      title: 'Current work failed',
      detail: failedJob.summary || 'The run stopped after an error. Review the run details before trying again.',
      stopped: true,
      actionLabel: 'Open Goal / Run',
      actionSection: 'goal-run'
    })
  }

  const sourceIssues = input.sources.filter(source => source.enabled && getSourceState(source) !== 'ready')
  for (const source of sourceIssues.slice(0, 2)) {
    const state = getSourceState(source)
    items.push({
      id: `source-${source.id}`,
      tone: state === 'unavailable' ? 'bad' : 'warn',
      title: state === 'preparing' ? `${source.label} is preparing` : state === 'stale' ? `${source.label} may be stale` : `${source.label} is unavailable`,
      detail: state === 'preparing'
        ? 'Context may be incomplete until source preparation finishes.'
        : state === 'stale'
          ? 'This source may need a refresh before it can provide current context.'
          : 'This source cannot provide reliable context. Review or re-index it in Sources.',
      stopped: state === 'unavailable' && input.activeSources.some(active => active.id === source.id),
      actionLabel: 'Open Sources',
      actionSection: 'sources'
    })
  }

  if (input.sources.length > 0 && input.activeSources.length === 0 && !sourceIssues.some(source => source.indexStatus === 'failed')) {
    items.push({
      id: 'no-active-source',
      tone: 'warn',
      title: 'Choose a source context',
      detail: 'No source is active for the next goal. Select one in Sources or Active Context.',
      stopped: false,
      actionLabel: 'Open Sources',
      actionSection: 'sources'
    })
  }

  return items
}

function humanizeActivityDetail(detail: string): string {
  return /(?:source|packet|run|job)[-_](?:id[-_])?[a-z0-9-]{8,}/i.test(detail)
    ? 'Workspace activity was updated. Open Activity for the full record.'
    : detail
}

export function buildRecentItems(
  jobs: readonly OverviewJob[],
  activity: readonly OverviewActivity[],
  sources: readonly KnowledgeSource[]
): OverviewRecentItem[] {
  const completed = jobs
    .filter(job => job.status === 'completed')
    .slice(0, 3)
    .map(job => ({
      id: `completed-${job.id}`,
      title: 'Goal completed',
      detail: humanizeActivityDetail(`${sources.find(source => source.id === job.sourceId)?.label || 'Local workspace'} · ${job.summary || 'The bounded run completed successfully.'}`),
      tone: 'good' as const,
      timestamp: job.updatedAt
    }))
  const updates = activity.slice(0, 4).map(item => ({
    id: item.id,
    title: item.label,
    detail: humanizeActivityDetail(item.detail),
    tone: item.tone,
    timestamp: item.timestamp
  }))
  return [...completed, ...updates].slice(0, 5)
}

export function buildOverviewModel(input: {
  systemHealth: SystemHealth
  error?: string | null
  sources: readonly KnowledgeSource[]
  activeSources: readonly KnowledgeSource[]
  jobs: readonly OverviewJob[]
  activity: readonly OverviewActivity[]
  writeMode: WriteMode
}): OverviewModel {
  const source = sourceForJob(selectCurrentJob(input.jobs), input.sources, input.activeSources)
  const sourceState = source ? getSourceState(source) : undefined
  const readiness = input.sources.reduce((counts, item) => {
    const state = getSourceState(item)
    if (state === 'ready') counts.ready += 1
    if (state === 'preparing') counts.preparing += 1
    if (state === 'unavailable') counts.unavailable += 1
    return counts
  }, { configured: input.sources.length, ready: 0, preparing: 0, unavailable: 0 })
  const sourceDetail = source
    ? `${source.branchName ? `${source.branchName} · ` : ''}${source.path}`
    : 'No active source selected.'

  return {
    currentWork: buildCurrentWork(input.jobs, input.sources, input.activeSources),
    attention: buildAttentionItems(input),
    recent: buildRecentItems(input.jobs, input.activity, input.sources),
    sourceSummary: {
      source,
      state: sourceState || 'none',
      stateLabel: sourceState ? getSourceStateLabel(sourceState) : 'No source',
      stateTone: sourceState ? getSourceStateTone(sourceState) : 'neutral',
      detail: sourceDetail,
      authorityLabel: getAuthorityLabel(input.writeMode)
    },
    health: {
      label: getSystemHealthLabel(input.systemHealth),
      tone: toneForHealth(input.systemHealth),
      detail: input.systemHealth === 'healthy' ? 'The local workspace is reachable.' : input.error || 'Review Settings for local workspace recovery.'
    },
    readiness
  }
}
