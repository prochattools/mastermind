type RecordLike = Record<string, unknown>

function record(value: unknown): RecordLike | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as RecordLike : undefined
}

function bounded(value: unknown, limit: number): string | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value.replace(/\s+/g, ' ').trim()
  return normalized ? normalized.slice(0, limit) : undefined
}

function boundedObject(value: unknown, fields: string[]): RecordLike | undefined {
  const source = record(value)
  if (!source) return undefined
  const result: RecordLike = {}
  for (const field of fields) {
    const item = bounded(source[field], field === 'id' ? 160 : 180)
    if (item) result[field] = item
  }
  return Object.keys(result).length > 0 ? result : undefined
}

export type ActiveRunContinuity = {
  workspace: string
  sourceId: string
  runId: string
  status: string
  phase?: RecordLike
  task?: RecordLike
  lastAcceptedTransition?: string
  currentPosition: string
  completedThisTurn?: string
  progress?: {
    overall: OversightProgressMetric
    phase: OversightProgressMetric
    task: OversightProgressMetric
  }
  oversightFrame?: string
  blocker?: string
  nextAction?: string
  recommendedReasoning: 'HIGH' | 'MEDIUM' | 'INSTANT'
  recommendedExecutor: 'Workbench' | 'Codex MCP'
}

export type OversightProgressMetric = {
  completed: number
  total: number
  percent?: number
}

export type AdaptiveOversightFrameInput = {
  repository: string
  status: string
  phase?: string
  task?: string
  branch?: string
  progress?: {
    overall?: OversightProgressMetric
    phase?: OversightProgressMetric
    task?: OversightProgressMetric
  }
  current: string
  done?: string
  blocker?: string
  next?: string
  priority?: 'P0' | 'P1' | 'P2'
  reasoning: 'INSTANT' | 'MEDIUM' | 'HIGH'
  executor?: string
}

function frameText(value: unknown, limit: number): string | undefined {
  return bounded(value, limit)
}

function frameProgress(metric: OversightProgressMetric | undefined): string {
  if (!metric || !Number.isFinite(metric.total) || metric.total <= 0) return '—'
  const percent = metricPercent(metric)
  const filled = Math.min(10, Math.max(0, Math.round(percent / 10)))
  return `${'●'.repeat(filled)}${'○'.repeat(10 - filled)} ${percent}%`
}

function metricPercent(metric: OversightProgressMetric): number {
  return Math.min(100, Math.max(0, Math.round(
    Number.isFinite(metric.percent) ? metric.percent! : (Math.max(0, metric.completed) / metric.total) * 100
  )))
}

function frameStatus(status: string): string {
  const normalized = String(status || '').trim().toLowerCase()
  if (normalized === 'running') return 'in progress'
  if (normalized === 'needs_confirmation') return 'confirmation required'
  if (normalized === 'blocked') return 'blocked'
  if (normalized === 'completed') return 'done'
  if (normalized === 'failed') return 'failed'
  if (normalized === 'paused') return 'paused'
  if (normalized === 'queued') return 'queued'
  if (normalized === 'cancelled') return 'cancelled'
  return normalized || 'unknown'
}

function progressMetric(value: unknown): OversightProgressMetric | undefined {
  const source = record(value)
  if (!source || typeof source.completed !== 'number' || typeof source.total !== 'number') return undefined
  const completed = Math.max(0, Math.floor(source.completed))
  const total = Math.max(0, Math.floor(source.total))
  const percent = typeof source.percent === 'number' && Number.isFinite(source.percent)
    ? Math.min(100, Math.max(0, Math.round(source.percent)))
    : undefined
  return { completed: Math.min(completed, total), total, ...(percent === undefined ? {} : { percent }) }
}

/** Render a bounded human-facing frame from already-returned authoritative state. */
export function formatAdaptiveOversightFrame(input: AdaptiveOversightFrameInput): string {
  const repository = frameText(input.repository, 120) || 'Workbench'
  const location = [frameText(input.phase, 100), frameText(input.task, 120)].filter(Boolean).join(' / ')
  const lines = [
    `WORKBENCH · ${repository}${location ? ` · ${location}` : ''}`,
    `Status  ${frameStatus(input.status)}`,
    'Roadmap bounded Workbench run · product-wide % unavailable',
    `Run overall ${frameProgress(input.progress?.overall)}`,
    `Run phase   ${frameProgress(input.progress?.phase)}`,
    `Task    ${frameProgress(input.progress?.task)}`,
    `Current ${frameText(input.current, 180) || 'No current position'}`,
    input.done ? `Done    ${frameText(input.done, 180)}` : undefined,
    input.blocker ? `Blocker ${frameText(input.blocker, 180)}` : undefined,
    input.next ? `Next    ${frameText(input.next, 180)}` : undefined,
    input.branch ? `Branch  ${frameText(input.branch, 140)}` : undefined,
    input.priority ? `Priority ${input.priority}` : undefined,
    `Reasoning ${input.reasoning}${input.executor ? ` · ${frameText(input.executor, 80)}` : ''}`
  ].filter((line): line is string => Boolean(line))
  return lines.join('\n').slice(0, 1_600)
}

/** Project only the authoritative bounded resume capsule; never include raw activity or packet data. */
export function projectActiveRunContinuity(value: unknown): ActiveRunContinuity | undefined {
  const payload = record(value)
  const activeRun = record(payload?.activeRun) || payload
  const projection = record(activeRun?.resumeProjection)
  if (!projection) return undefined

  const workspace = bounded(projection.repository, 180)
  const sourceId = bounded(projection.sourceId, 160)
  const runId = bounded(projection.runId, 160)
  const status = bounded(projection.runStatus, 40)
  const currentPosition = bounded(projection.currentPosition, 240)
  if (!workspace || !sourceId || !runId || !status || !currentPosition) return undefined

  const confirmation = record(projection.confirmation)
  const budget = record(projection.budget)
  const handoff = record(activeRun?.handoffProjection)
  const requiredConfirmation = confirmation?.required === true || status === 'needs_confirmation'
  const blocked = typeof projection.blocker === 'string' || status === 'blocked'
  const recommendedReasoning = requiredConfirmation || blocked
    ? 'HIGH'
    : projection.packet && typeof projection.packet === 'object'
      ? 'INSTANT'
      : 'MEDIUM'
  const recommendedExecutor = record(projection.execution)?.engine === 'codex' ? 'Codex MCP' : 'Workbench'
  const phase = boundedObject(projection.phase, ['id', 'title'])
  const task = boundedObject(projection.task, ['id', 'title', 'status'])
  const transition = bounded(handoff?.transition, 60)
  const budgetReason = bounded(budget?.reasonCode, 80)
  const blocker = budget?.exhausted === true && budgetReason
    ? `Budget exhausted: ${budgetReason}`
    : bounded(projection.blocker, 240)
  const nextAction = bounded(projection.nextAction, 240)
  const projectionProgress = record(projection.progress)
  const progressOverall = progressMetric(projectionProgress?.overall)
  const progressPhase = progressMetric(projectionProgress?.phase)
  const progressTask = progressMetric(projectionProgress?.task)
  const progress = progressOverall && progressPhase && progressTask
    ? {
        overall: progressOverall,
        phase: progressPhase,
        task: progressTask
      }
    : undefined
  const completedThisTurn = bounded(projection.completedThisTurn, 180)
  const oversightFrame = progress
    ? formatAdaptiveOversightFrame({
        repository: workspace,
        status,
        phase: typeof phase?.title === 'string' ? phase.title : undefined,
        task: typeof task?.title === 'string' ? task.title : undefined,
        progress,
        current: currentPosition,
        ...(completedThisTurn ? { done: completedThisTurn } : {}),
        ...(blocker ? { blocker } : {}),
        ...(nextAction ? { next: nextAction } : {}),
        reasoning: recommendedReasoning,
        executor: recommendedExecutor
      })
    : undefined

  return {
    workspace,
    sourceId,
    runId,
    status,
    ...(phase ? { phase } : {}),
    ...(task ? { task } : {}),
    ...(transition ? { lastAcceptedTransition: transition } : {}),
    currentPosition,
    ...(completedThisTurn ? { completedThisTurn } : {}),
    ...(progress ? { progress } : {}),
    ...(oversightFrame ? { oversightFrame } : {}),
    ...(blocker ? { blocker } : {}),
    ...(nextAction ? { nextAction } : {}),
    recommendedReasoning,
    recommendedExecutor
  }
}
