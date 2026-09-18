import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { appendAgentEvent } from './agent-events'
import { createWorkbenchRun, getAgentJob, updateAgentJob, type AgentJob } from './agent-jobs'
import { scheduleWorkbenchPacket } from './workbench-packet-coordinator'
import { getWorkbenchPacketResult, recordWorkbenchPacketResult } from './workbench-packet-results'
import { preflightWorkbenchPacket, type WorkbenchGoalDispatch, type WorkbenchPacket, type WorkbenchPacketCommitPolicy, type WorkbenchPacketStep } from './workbench-packets'
import { claimNextWorkbenchPacket, reserveWorkbenchPacket, updateWorkbenchPacketStatus } from './workbench-packet-store'
import { createFollowUpContext } from './workbench-follow-up-context'
import type { WorkbenchGoalContext } from './agent-jobs'
import { buildResumeProjection } from './resume-projection'
import { compilePromptPacket } from './prompt-packet-compiler'
import { prepareDelegationOperation } from './external-delegation'
import { preparePersistedDelegation, listPersistedDelegationOperations } from './external-delegation-store'
import type { CodexDelegationAdapter } from './external-delegation-adapter'
import { validateGovernedCodexMutationDispatch } from './governed-codex-mutation'
import { createDelegatedWorkbenchWorktreeForPacket } from './workbench-delegated-worktree'

export const WORKBENCH_GOAL_DISPATCH_VERSION = 1 as const

export type WorkbenchGoalDispatchInput = WorkbenchGoalDispatch & {
  steps: WorkbenchPacketStep[]
  validation?: WorkbenchPacket['validation']
  commit?: WorkbenchPacketCommitPolicy & { authorized?: boolean }
  pushIntent?: 'not_requested' | 'explicitly_authorized'
}

export type WorkbenchGoalDispatchResult = {
  status: 'queued' | 'already_queued' | 'blocked'
  verified: boolean
  writesPerformed: false
  run: AgentJob
  packet?: {
    packetId: string
    taskId: string
    status: 'queued' | 'already_queued' | 'blocked'
    exactPaths: string[]
  }
  delegation?: { operationId: string; lifecycle: string }
  terminalResult?: Record<string, unknown>
  warnings?: string[]
  error?: { code: string; message: string }
}

function boundedText(value: unknown, limit: number): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, limit) : ''
}

function boundedList(value: unknown, limit: number, itemLimit = 240): string[] {
  if (!Array.isArray(value)) return []
  return Array.from(new Set(value.filter((item): item is string => typeof item === 'string').map(item => boundedText(item, itemLimit)).filter(Boolean))).slice(0, limit)
}

function stable(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`
  return `{${Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, child]) => `${JSON.stringify(key)}:${stable(child)}`).join(',')}}`
}

function sha(value: unknown): string {
  return crypto.createHash('sha256').update(stable(value), 'utf8').digest('hex')
}

export function humanTerminalSummary(run: AgentJob, status: string): string {
  const goal = boundedText(run.goal, 320) || 'the requested Workbench goal'
  if (status === 'completed') return `Completed: ${goal}`
  if (status === 'failed') return `Could not complete: ${goal}`
  if (status === 'blocked') return `Blocked before completion: ${goal}`
  return `Stopped: ${goal}`
}

function currentHead(sourceRoot: string): string {
  return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: sourceRoot, encoding: 'utf8', timeout: 3_000, stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

function compactTerminalResult(run: AgentJob, packetId: string, sourceId: string, sourceRoot: string): Record<string, unknown> | undefined {
  const result = getWorkbenchPacketResult(packetId)
  if (!result) return undefined
  const changedFiles = result.changedPaths.slice(0, 12)
  const validation = result.validation.slice(0, 5).map(item => ({ commandKind: item.commandKind, status: item.status, exitCode: item.exitCode, durationMs: item.durationMs }))
  const commit = result.commitHash ? { hash: result.commitHash } : undefined
  const warnings = result.errors.map(error => error.message).slice(0, 5)
  const completedAt = Date.parse(run.updatedAt || run.createdAt || '')
  const context = createFollowUpContext({
    sourceId,
    previousGoal: run.goal,
    summary: humanTerminalSummary(run, result.status),
    changedFiles,
    validation,
    explicitPaths: run.goalContext?.scope || run.goalContext?.knownFiles || [],
    taskHistory: run.nextActions || [],
    now: Number.isFinite(completedAt) ? completedAt : Date.now()
  })
  return {
    status: result.status,
    summary: result.executorResult?.evidence?.outputSummary || humanTerminalSummary(run, result.status),
    sourceId,
    changedFiles,
    reads: (result.readEvidence || []).slice(0, 5),
    commands: (result.commandEvidence || []).slice(0, 3),
    validation,
    ...(commit ? { commit } : {}),
    ...(result.executorResult ? { executorResult: result.executorResult } : {}),
    ...(result.repositoryState ? { repositoryState: result.repositoryState } : {}),
    ...(warnings.length > 0 ? { warnings } : {}),
    localExecutionMs: result.validation.reduce((total, item) => total + Math.max(0, item.durationMs || 0), 0),
    followUpContext: context,
    diagnostics: {
      runId: run.id,
      packetId,
      sourceId,
      provider: result.executorResult?.executorId || 'local-goal-dispatch',
      transport: result.executorResult ? 'codex-cli' : 'local',
      errorCodes: result.errors.map(error => error.code).slice(0, 5)
    }
  }
}

function normalizeDispatch(input: WorkbenchGoalDispatchInput): WorkbenchGoalDispatchInput {
  if (!input || input.version !== WORKBENCH_GOAL_DISPATCH_VERSION) throw new Error('goalDispatch.version must be 1')
  const expectedOutcome = boundedText(input.expectedOutcome, 500)
  if (!expectedOutcome) throw new Error('goalDispatch.expectedOutcome is required')
  if (!Array.isArray(input.steps) || input.steps.length > 5) throw new Error('goalDispatch.steps must contain at most 5 bounded steps')
  if (input.commit?.enabled && input.commit.authorized !== true) throw new Error('goalDispatch commit requires explicit authorization')
  if (input.confirmationPolicy === 'single_exact' && input.confirmedByUser !== true) throw new Error('goalDispatch requires the exact confirmation before execution')
  return {
    ...input,
    expectedOutcome,
    scope: boundedList(input.scope, 20, 240),
    knownFiles: boundedList(input.knownFiles, 20, 240),
    knownSymbols: boundedList(input.knownSymbols, 20, 180),
    constraints: boundedList(input.constraints, 12),
    nonGoals: boundedList(input.nonGoals, 12),
    stopConditions: boundedList(input.stopConditions, 8),
    steps: input.steps.slice(0, 5),
    reads: input.reads?.slice(0, 5),
    commands: input.commands?.slice(0, 3),
    terminalResult: {
      style: 'natural_language',
      include: Array.from(new Set(input.terminalResult?.include || ['summary', 'changed_files', 'validation', 'commit', 'warnings', 'blocker'])).slice(0, 6) as WorkbenchGoalDispatch['terminalResult']['include']
    }
  }
}

export function dispatchWorkbenchGoal(params: {
  sourceId: string
  sourceRoot: string
  goal: string
  requestId?: string
  documentationPath?: string
  maxIterations?: number
  dispatch: WorkbenchGoalDispatchInput
  goalContext?: WorkbenchGoalContext
  codex?: { adapter: CodexDelegationAdapter; branch: string; ownerSessionId: string }
}): WorkbenchGoalDispatchResult {
  const dispatch = normalizeDispatch(params.dispatch)
  const goal = boundedText(params.goal, 4_000)
  if (!goal) throw new Error('goal is required')
  const commit = dispatch.commit?.enabled ? dispatch.commit : undefined
  const created = createWorkbenchRun({
    sourceId: params.sourceId,
    goal,
    requestId: params.requestId,
    documentationPath: params.documentationPath,
    maxIterations: params.maxIterations,
    autoCommit: Boolean(commit?.enabled),
    autoPush: false,
    autonomyLevel: 'hands_off_safe',
    goalContext: params.goalContext
  })
  const run = created.run
  const taskId = run.activeTaskId || `task-${sha({ runId: run.id, goal }).slice(0, 24)}`
  const head = currentHead(params.sourceRoot)
  const packetId = `goal-${sha({ runId: run.id, goal, dispatch, head }).slice(0, 32)}`
  const packet: WorkbenchPacket = {
    version: 1,
    runId: run.id,
    packetId,
    idempotencyKey: `${run.id}:${packetId}`,
    sourceId: params.sourceId,
    taskId,
    ...(params.codex?.branch ? { sourceBranch: params.codex.branch } : {}),
    goalSummary: dispatch.expectedOutcome,
    expectedHead: head,
    goalDispatch: dispatch,
    steps: dispatch.steps,
    ...(dispatch.validation && dispatch.validation.length > 0 ? { validation: dispatch.validation } : {}),
    ...(commit ? { commit } : {}),
    createdAt: new Date().toISOString()
  }
  const preflight = preflightWorkbenchPacket({ packet, sourceRoot: params.sourceRoot })
  if (!preflight.accepted) {
    const blocked = updateAgentJob(run.id, {
      status: 'blocked',
      blockedDisposition: 'historical',
      blockedReason: preflight.errors[0]?.message || 'Goal dispatch packet was rejected during preflight.',
      summary: 'Workbench rejected the durable goal packet before any local write.'
    })
    return {
      status: 'blocked',
      verified: false,
      writesPerformed: false,
      run: blocked,
      packet: { packetId, taskId, status: 'blocked', exactPaths: preflight.exactPaths || [] },
      error: { code: preflight.errors[0]?.code || 'GOAL_PACKET_PREFLIGHT_FAILED', message: preflight.errors[0]?.message || 'Goal packet preflight failed.' }
    }
  }
  const reservation = reserveWorkbenchPacket({ packet, exactPaths: preflight.exactPaths || [] })
  if (reservation.ok === false) {
    const blocked = updateAgentJob(run.id, { status: 'blocked', blockedDisposition: 'historical', blockedReason: reservation.message, summary: 'Workbench could not reserve the durable goal packet.' })
    return {
      status: 'blocked', verified: false, writesPerformed: false, run: blocked,
      packet: { packetId, taskId, status: 'blocked', exactPaths: preflight.exactPaths || [] },
      error: { code: reservation.code, message: reservation.message }
    }
  }
  const bound = updateAgentJob(run.id, {
    activePacketId: packetId,
    summary: 'Workbench dispatched the bounded goal locally; no further Action is required for internal execution.',
    nextActions: ['Wait for the durable packet to reach a terminal result.', 'Retrieve the compact terminal result once if needed.']
  })
  if (params.codex) {
    const mutation = dispatch.readOnly === true ? undefined : validateGovernedCodexMutationDispatch(dispatch, { preflight })
    if (dispatch.readOnly !== true && (!mutation || mutation.ok === false)) {
      const failure = mutation && mutation.ok === false ? mutation : { code: 'CODEX_MUTATION_SCOPE_REQUIRED', message: 'Automatic Codex mutation requires one exact path admitted by Workbench policy.' }
      const blocked = updateAgentJob(run.id, { status: 'blocked', blockedDisposition: 'historical', blockedReason: failure.message, summary: 'Workbench refused the Codex mutation before execution.' })
      return { status: 'blocked', verified: false, writesPerformed: false, run: blocked, packet: { packetId, taskId, status: 'blocked', exactPaths: preflight.exactPaths || [] }, error: { code: failure.code, message: failure.message } }
    }
    if (dispatch.readOnly === true && ((dispatch.reads?.length || 0) + (dispatch.commands?.length || 0) === 0)) {
      const blocked = updateAgentJob(run.id, { status: 'blocked', blockedDisposition: 'historical', blockedReason: 'Automatic Codex delegation is limited to bounded read-only goal packets.', summary: 'Workbench refused to delegate a packet with mutation authority or no bounded read.' })
      return { status: 'blocked', verified: false, writesPerformed: false, run: blocked, packet: { packetId, taskId, status: 'blocked', exactPaths: preflight.exactPaths || [] }, error: { code: 'CODEX_READ_ONLY_SCOPE_REQUIRED', message: 'Automatic Codex delegation is limited to bounded read-only goal packets.' } }
    }
    const existing = listPersistedDelegationOperations({ packetId })[0]
    if (existing) {
      return {
        status: 'already_queued', verified: true, writesPerformed: false, run: bound,
        packet: { packetId, taskId, status: 'queued', exactPaths: preflight.exactPaths || [] },
        delegation: { operationId: existing.operationId, lifecycle: existing.lifecycle }
      }
    }
    const projection = buildResumeProjection({ run: bound, packet: reservation.record, policyIdentity: 'policy-v1' })
    const compiled = compilePromptPacket({ run: bound, projection, packet, execution: { engine: 'codex', profile: 'balanced', outcome: 'selected' }, policyIdentity: 'policy-v1' })
    if (compiled.status !== 'external' || !compiled.contract) {
      const blocked = updateAgentJob(run.id, { status: 'blocked', blockedDisposition: 'historical', blockedReason: compiled.nextAction, summary: 'Workbench could not compile the governed Codex delegation packet.' })
      updateWorkbenchPacketStatus({ packetId, status: 'failed', failureReason: compiled.nextAction })
      return { status: 'blocked', verified: false, writesPerformed: false, run: blocked, packet: { packetId, taskId, status: 'blocked', exactPaths: preflight.exactPaths || [] }, error: { code: compiled.reasonCode.toUpperCase(), message: compiled.nextAction } }
    }
    const preparedDelegation = prepareDelegationOperation({ run: bound, projection, contract: compiled.contract, authorization: 'satisfied', confirmation: 'not_required', now: new Date().toISOString() })
    if (!preparedDelegation.allowed || !preparedDelegation.operation) {
      const blocked = updateAgentJob(run.id, { status: 'blocked', blockedDisposition: 'historical', blockedReason: preparedDelegation.nextAction, summary: 'Workbench could not admit the governed Codex delegation packet.' })
      updateWorkbenchPacketStatus({ packetId, status: 'failed', failureReason: preparedDelegation.nextAction })
      return { status: 'blocked', verified: false, writesPerformed: false, run: blocked, packet: { packetId, taskId, status: 'blocked', exactPaths: preflight.exactPaths || [] }, error: { code: preparedDelegation.reasonCode.toUpperCase(), message: preparedDelegation.nextAction } }
    }
    const persisted = preparePersistedDelegation(preparedDelegation.operation)
    if (persisted.ok === false) {
      const blocked = updateAgentJob(run.id, { status: 'blocked', blockedDisposition: 'historical', blockedReason: persisted.message, summary: 'Workbench could not persist the Codex delegation operation.' })
      updateWorkbenchPacketStatus({ packetId, status: 'failed', failureReason: persisted.message })
      return { status: 'blocked', verified: false, writesPerformed: false, run: blocked, packet: { packetId, taskId, status: 'blocked', exactPaths: preflight.exactPaths || [] }, error: { code: persisted.code, message: persisted.message } }
    }
    let delegatedSourceRoot = params.sourceRoot
    let mutationWorktree: ReturnType<typeof createDelegatedWorkbenchWorktreeForPacket> | undefined
    if (mutation && mutation.ok) {
      const workerId = `codex-goal:${params.codex.ownerSessionId.slice(0, 96)}`
      const claimed = claimNextWorkbenchPacket({ packetId, workerId, leaseMs: 120_000 })
      if (!claimed.ok) {
        const reason = 'message' in claimed ? claimed.message : 'Workbench could not lease the governed Codex mutation packet.'
        const code = 'code' in claimed ? claimed.code : 'PACKET_LEASE_FAILED'
        const blocked = updateAgentJob(run.id, { status: 'blocked', blockedDisposition: 'historical', blockedReason: reason, summary: 'Workbench could not lease the governed Codex mutation packet.' })
        updateWorkbenchPacketStatus({ packetId, status: 'failed', failureReason: reason })
        return { status: 'blocked', verified: false, writesPerformed: false, run: blocked, packet: { packetId, taskId, status: 'blocked', exactPaths: preflight.exactPaths || [] }, error: { code, message: reason } }
      }
      const lease = { owner: claimed.record.leaseOwner!, token: claimed.record.leaseToken!, expiresAt: claimed.record.leaseExpiresAt! }
      mutationWorktree = createDelegatedWorkbenchWorktreeForPacket({ packet, sessionId: bound.compiledPlan?.run.sessionId || params.codex.ownerSessionId, lease })
      if (!mutationWorktree.ok) {
        const reason = 'message' in mutationWorktree ? mutationWorktree.message : 'Workbench could not create the isolated Codex mutation worktree.'
        const code = 'code' in mutationWorktree ? mutationWorktree.code : 'WORKTREE_CREATE_FAILED'
        const blocked = updateAgentJob(run.id, { status: 'blocked', blockedDisposition: 'historical', blockedReason: reason, summary: 'Workbench could not create the isolated Codex mutation worktree.' })
        updateWorkbenchPacketStatus({ packetId, status: 'failed', failureReason: reason })
        return { status: 'blocked', verified: false, writesPerformed: false, run: blocked, packet: { packetId, taskId, status: 'blocked', exactPaths: preflight.exactPaths || [] }, error: { code, message: reason } }
      }
      delegatedSourceRoot = mutationWorktree.evidence.path
    } else updateWorkbenchPacketStatus({ packetId, status: 'running' })
    appendAgentEvent({ jobId: run.id, sourceId: params.sourceId, type: 'command_started', activityKind: 'executor_started', packetId, taskId, status: 'submitted', message: mutation ? 'Governed Codex mutation accepted in an isolated Workbench worktree.' : 'Governed read-only goal accepted by the Codex CLI adapter.' })
    const mutationExactPath = mutation && mutation.ok ? mutation.exactPath : undefined
    void params.codex.adapter.submit({ operation: persisted.operation, contract: compiled.contract, sourceRoot: delegatedSourceRoot, branch: params.codex.branch, ownerSessionId: params.codex.ownerSessionId, isolation: mutation ? 'worktree' : 'read_only', ...(mutationExactPath && mutationWorktree?.ok ? { mcpRepositoryRoot: params.sourceRoot, governedMutation: { worktreeId: mutationWorktree.evidence.worktreeId, exactPaths: [mutationExactPath] } } : {}) }).then(result => {
      if (result.ok !== false) return
      updateWorkbenchPacketStatus({ packetId, status: 'failed', failureReason: result.reason })
      const failed = getAgentJob(run.id)
      if (failed) updateAgentJob(failed.id, { status: 'blocked', blockedDisposition: 'historical', activePacketId: undefined, blockedReason: result.reason, summary: 'Codex delegation was not accepted; no automatic retry was attempted.' })
      recordWorkbenchPacketResult({ packetId, runId: run.id, sourceId: params.sourceId, status: 'failed', sourceRoot: params.sourceRoot, error: result.reason })
    }).catch(error => {
      const reason = error instanceof Error ? error.message : String(error)
      updateWorkbenchPacketStatus({ packetId, status: 'failed', failureReason: reason })
      const failed = getAgentJob(run.id)
      if (failed) updateAgentJob(failed.id, { status: 'blocked', blockedDisposition: 'historical', activePacketId: undefined, blockedReason: reason, summary: 'Codex delegation failed before a verified terminal result; no automatic retry was attempted.' })
      recordWorkbenchPacketResult({ packetId, runId: run.id, sourceId: params.sourceId, status: 'failed', sourceRoot: params.sourceRoot, error: reason })
    })
    return { status: 'queued', verified: true, writesPerformed: false, run: bound, packet: { packetId, taskId, status: 'queued', exactPaths: preflight.exactPaths || [] }, delegation: { operationId: persisted.operation.operationId, lifecycle: 'submitted' } }
  }
  const scheduled = scheduleWorkbenchPacket({
    packetId,
    sourceId: params.sourceId,
    sourceRootFor: sourceId => sourceId === params.sourceId ? params.sourceRoot : undefined
  })
  appendAgentEvent({
    jobId: run.id,
    sourceId: params.sourceId,
    type: 'preflight_started',
    activityKind: 'run_progress',
    requestId: params.requestId,
    status: 'queued',
    message: 'One durable Workbench goal dispatch was accepted for local execution.'
  })
  const terminalResult = compactTerminalResult(bound, packetId, params.sourceId, params.sourceRoot)
  return {
    status: scheduled.status === 'already_scheduled' ? 'already_queued' : 'queued',
    verified: true,
    writesPerformed: false,
    run: bound,
    packet: { packetId, taskId, status: scheduled.status === 'already_scheduled' ? 'already_queued' : 'queued', exactPaths: preflight.exactPaths || [] },
    ...(terminalResult ? { terminalResult } : {}),
    warnings: dispatch.pushIntent === 'explicitly_authorized' ? ['Push intent was recorded but is not executed by the goal packet. Use the separate Workbench governed push controller after the terminal commit result is verified.'] : undefined
  }
}

export function getWorkbenchGoalTerminalResult(params: { runId: string; sourceId: string; sourceRoot?: string }): Record<string, unknown> | undefined {
  const run = getAgentJob(params.runId)
  if (!run || run.sourceId !== params.sourceId) return undefined
  const packetIds = [
    ...(run.activePacketId ? [run.activePacketId] : []),
    ...[...run.completedPacketIds].reverse()
  ]
  for (const packetId of packetIds) {
    const result = getWorkbenchPacketResult(packetId)
    if (result?.runId !== run.id || result.sourceId !== params.sourceId) continue
    return compactTerminalResult(run, packetId, params.sourceId, params.sourceRoot || '')
  }
  return undefined
}
