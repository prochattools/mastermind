import { execFileSync } from 'node:child_process'
import path from 'node:path'
import type { CodexDelegationResult } from './external-delegation-adapter'
import type { DelegationDeliveryEvidence } from './external-delegation'
import {
  getPersistedDelegationOperation,
  persistDelegationControls,
  type DelegationStoreOptions,
  type PersistedDelegationOperation
} from './external-delegation-store'
import { runSafeCommand, type SafeCommandResult } from './command-runner'
import type { GovernedCodexCommitOutcome } from './governed-codex-commit'
import { verifyExactPathSet } from './workbench-packet-executor'
import type { WorkbenchPacket } from './workbench-packets'
import type { DelegatedWorktreeEvidence } from './workbench-delegated-worktree'

const SAFE_REMOTE = /^[A-Za-z0-9._-]+$/
const SAFE_BRANCH = /^[A-Za-z0-9._/-]+$/
const FULL_COMMIT = /^[0-9a-f]{40}$/

export type GovernedPushAuthorization = {
  pushIntent: 'explicitly_authorized'
  confirmedByUser: true
  remote: string
  remoteUrl: string
  branch: string
  expectedRemoteHead: string | null
}

export type GovernedCodexPushOutcome =
  | {
      ok: true
      pushed: boolean
      alreadyReconciled: boolean
      delivery: DelegationDeliveryEvidence
      operation: PersistedDelegationOperation
    }
  | {
      ok: false
      pushed: false
      code: string
      message: string
      delivery?: DelegationDeliveryEvidence
      operation?: PersistedDelegationOperation
    }

type PushDependencies = {
  runCommand?: (request: {
    sourceId: string
    sourceRoot: string
    commandKind: 'git_push'
    remote: string
    branch: string
    timeoutMs?: number
    governedPush: true
  }) => Promise<SafeCommandResult>
  git?: (sourceRoot: string, args: string[]) => string
  now?: () => number
}

function gitDefault(sourceRoot: string, args: string[]): string {
  return execFileSync('/usr/bin/git', ['-c', 'core.hooksPath=/dev/null', '-C', sourceRoot, ...args], {
    encoding: 'utf8',
    timeout: 10_000,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_LITERAL_PATHSPECS: '1' }
  }).trim()
}

function normalizedPaths(paths: readonly string[]): string[] {
  return [...new Set(paths.map(item => path.posix.normalize(String(item).replace(/\\/g, '/'))))].sort()
}

function statusPaths(git: (sourceRoot: string, args: string[]) => string, sourceRoot: string): string[] {
  const output = git(sourceRoot, ['status', '--porcelain=v1', '--untracked-files=all'])
  return output.split(/\r?\n/).filter(Boolean).map(line => {
    const value = line.slice(line[2] === ' ' ? 3 : 2).trim()
    const rename = value.lastIndexOf(' -> ')
    return (rename >= 0 ? value.slice(rename + 4) : value).replace(/\\/g, '/')
  }).filter(Boolean).sort()
}

function remoteHead(git: (sourceRoot: string, args: string[]) => string, sourceRoot: string, remote: string, branch: string): string | null {
  const output = git(sourceRoot, ['ls-remote', '--refs', remote, `refs/heads/${branch}`])
  const line = output.split(/\r?\n/).find(Boolean)
  if (!line) return null
  const hash = line.split(/\s+/)[0]
  return FULL_COMMIT.test(hash) ? hash : null
}

function remoteRefs(git: (sourceRoot: string, args: string[]) => string, sourceRoot: string, remote: string): Map<string, string> {
  const refs = new Map<string, string>()
  const output = git(sourceRoot, ['ls-remote', '--refs', remote])
  for (const line of output.split(/\r?\n/).filter(Boolean)) {
    const [hash, ref] = line.split(/\s+/)
    if (FULL_COMMIT.test(hash) && ref) refs.set(ref, hash)
  }
  return refs
}

function changedRefs(before: Map<string, string>, after: Map<string, string>): string[] {
  return [...new Set([...before.keys(), ...after.keys()])]
    .filter(ref => before.get(ref) !== after.get(ref))
    .sort()
}

function packetPaths(packet: WorkbenchPacket): string[] {
  return normalizedPaths(packet.steps.flatMap(step => [step.path, step.to].filter((item): item is string => Boolean(item))))
}

function commitMatches(git: (sourceRoot: string, args: string[]) => string, worktree: DelegatedWorktreeEvidence, packet: WorkbenchPacket, commitHash: string, expectedPaths: string[]): boolean {
  if (git(worktree.path, ['rev-parse', `${commitHash}^`]) !== packet.expectedHead) return false
  const message = git(worktree.path, ['show', '-s', '--format=%B', commitHash])
  if (!message.includes(`Workbench-Run: ${packet.runId}`) || !message.includes(`Workbench-Packet: ${packet.packetId}`)) return false
  verifyExactPathSet(git(worktree.path, ['diff-tree', '--no-commit-id', '--name-only', '-r', commitHash]).split(/\r?\n/).filter(Boolean), expectedPaths, 'Committed')
  return true
}

function deliveryEvidence(params: {
  status: DelegationDeliveryEvidence['status']
  remote: string
  branch: string
  commitHash: string
  previousRemoteHead: string | null
  resultingRemoteHead?: string | null
  durationMs: number
  reasonCode?: string
}): DelegationDeliveryEvidence {
  return {
    status: params.status,
    remote: params.remote,
    branch: params.branch,
    commitHash: params.commitHash,
    ...(params.previousRemoteHead ? { previousRemoteHead: params.previousRemoteHead } : {}),
    ...(params.resultingRemoteHead ? { resultingRemoteHead: params.resultingRemoteHead } : {}),
    durationMs: Math.max(0, Math.floor(params.durationMs)),
    ...(params.reasonCode ? { reasonCode: params.reasonCode } : {})
  }
}

function persistDelivery(operation: PersistedDelegationOperation, delivery: DelegationDeliveryEvidence, options?: DelegationStoreOptions): PersistedDelegationOperation | undefined {
  const current = getPersistedDelegationOperation(operation.operationId, options)
  if (!current) return undefined
  const result = persistDelegationControls({
    operationId: current.operationId,
    expectedRevision: current.revision,
    delivery,
    now: new Date().toISOString(),
    options
  })
  return result.ok ? result.operation : undefined
}

function blocked(params: {
  operation: PersistedDelegationOperation
  authorization: GovernedPushAuthorization
  commitHash: string
  startedAt: number
  code: string
  message: string
  previousRemoteHead?: string | null
  resultingRemoteHead?: string | null
  options?: DelegationStoreOptions
}): GovernedCodexPushOutcome {
  const delivery = deliveryEvidence({
    status: params.code === 'PUSH_RESULT_AMBIGUOUS' ? 'ambiguous' : 'blocked',
    remote: params.authorization.remote,
    branch: params.authorization.branch,
    commitHash: params.commitHash,
    previousRemoteHead: params.previousRemoteHead ?? null,
    resultingRemoteHead: params.resultingRemoteHead,
    durationMs: Date.now() - params.startedAt,
    reasonCode: params.code
  })
  return {
    ok: false,
    pushed: false,
    code: params.code,
    message: params.message,
    delivery,
    operation: persistDelivery(params.operation, delivery, params.options) || params.operation
  }
}

export async function pushGovernedCodexCommit(params: {
  operation: PersistedDelegationOperation
  packet: WorkbenchPacket
  result: CodexDelegationResult
  worktree: DelegatedWorktreeEvidence
  commitOutcome: GovernedCodexCommitOutcome
  authorization: GovernedPushAuthorization
  storeOptions?: DelegationStoreOptions
  dependencies?: PushDependencies
}): Promise<GovernedCodexPushOutcome> {
  const startedAt = (params.dependencies?.now || Date.now)()
  const git = params.dependencies?.git || gitDefault
  const commitHash = params.commitOutcome.ok && params.commitOutcome.committed ? params.commitOutcome.commitHash : ''
  const authorization = params.authorization
  const operation = getPersistedDelegationOperation(params.operation.operationId, params.storeOptions) || params.operation
  const fail = (code: string, message: string, previousRemoteHead?: string | null, resultingRemoteHead?: string | null) => blocked({ operation, authorization, commitHash: commitHash || 'unknown', startedAt, code, message, previousRemoteHead, resultingRemoteHead, options: params.storeOptions })

  if (authorization.pushIntent !== 'explicitly_authorized') return fail('PUSH_INTENT_NOT_AUTHORIZED', 'Push intent was not explicitly authorized.')
  if (authorization.confirmedByUser !== true) return fail('PUSH_CONFIRMATION_MISSING', 'Explicit Workbench push confirmation is required.')
  if (!SAFE_REMOTE.test(authorization.remote)) return fail('PUSH_REMOTE_INVALID', 'The push remote is not a safe exact remote name.')
  if (!SAFE_BRANCH.test(authorization.branch) || authorization.branch.startsWith('-') || authorization.branch.includes('..')) return fail('PUSH_BRANCH_INVALID', 'The push destination is not a safe exact branch name.')
  if (!authorization.remoteUrl.trim()) return fail('PUSH_REMOTE_URL_MISSING', 'The authorized remote identity is missing.')
  if (authorization.expectedRemoteHead !== null && !FULL_COMMIT.test(authorization.expectedRemoteHead)) return fail('PUSH_EXPECTED_REMOTE_HEAD_INVALID', 'The expected remote head is invalid.')
  if (params.packet.sourceId !== operation.sourceId || params.packet.runId !== operation.runId || params.packet.packetId !== operation.packetId) return fail('PUSH_IDENTITY_MISMATCH', 'The packet and delegation operation identities do not match.')
  if (params.packet.expectedHead !== operation.expectedHead) return fail('PUSH_EXPECTED_HEAD_MISMATCH', 'The packet expected HEAD does not match the delegation operation.')
  if (operation.lifecycle !== 'completed' || operation.authorization !== 'satisfied') return fail('PUSH_GOVERNED_COMMIT_NOT_COMPLETED', 'The governed delegation is not in a completed, authorized state.')
  if (!params.packet.sourceBranch || params.packet.sourceBranch !== authorization.branch) return fail('PUSH_BRANCH_MISMATCH', 'The push destination branch does not match the authoritative packet branch.')
  if (params.packet.goalDispatch?.pushIntent !== 'explicitly_authorized') return fail('PUSH_PACKET_INTENT_MISSING', 'The authoritative packet does not contain explicit push intent.')
  if (params.packet.goalDispatch?.commit?.enabled !== true || params.packet.goalDispatch.commit.authorized !== true) return fail('PUSH_COMMIT_AUTHORIZATION_MISSING', 'A Workbench-authorized governed commit is required before push.')
  if (params.packet.goalDispatch.confirmationPolicy === 'single_exact' && params.packet.goalDispatch.confirmedByUser !== true) return fail('PUSH_COMMIT_CONFIRMATION_MISSING', 'The exact governed commit confirmation is missing.')
  if (!params.commitOutcome.ok || !params.commitOutcome.committed || !FULL_COMMIT.test(commitHash)) return fail('PUSH_COMMIT_PROOF_MISSING', 'The authorized governed commit was not completed and proven.')
  if (params.result.lifecycle !== 'completed' || params.result.mutation?.state !== 'passed' || params.result.mutation.validation.status !== 'passed') return fail('PUSH_VALIDATION_REQUIRED', 'Targeted governed mutation validation did not pass.')
  if (params.worktree.packetId !== params.packet.packetId || params.worktree.sourceId !== params.packet.sourceId || params.worktree.expectedHead !== params.packet.expectedHead) return fail('PUSH_WORKTREE_MISMATCH', 'The isolated worktree is not bound to the authoritative packet.')

  const expectedPaths = packetPaths(params.packet)
  if (expectedPaths.length !== 1 || JSON.stringify(normalizedPaths(params.worktree.exactPaths)) !== JSON.stringify(expectedPaths) || JSON.stringify(normalizedPaths(params.result.mutation.expectedPaths)) !== JSON.stringify(expectedPaths) || JSON.stringify(normalizedPaths(params.result.mutation.changedPaths)) !== JSON.stringify(expectedPaths)) return fail('PUSH_PATH_SET_MISMATCH', 'The committed path set does not exactly match the authorized packet.')
  const recordedDelivery = operation.delivery
  if (recordedDelivery && ['pushed', 'already_reconciled'].includes(recordedDelivery.status)
    && recordedDelivery.remote === authorization.remote
    && recordedDelivery.branch === authorization.branch
    && recordedDelivery.commitHash === commitHash) {
    return { ok: true, pushed: false, alreadyReconciled: true, delivery: recordedDelivery, operation }
  }
  if (recordedDelivery?.status === 'ambiguous'
    && recordedDelivery.remote === authorization.remote
    && recordedDelivery.branch === authorization.branch
    && recordedDelivery.commitHash === commitHash) {
    try {
      const reconciledHead = remoteHead(git, params.worktree.path, authorization.remote, authorization.branch)
      if (reconciledHead === commitHash) {
        const delivery = deliveryEvidence({ status: 'already_reconciled', remote: authorization.remote, branch: authorization.branch, commitHash, previousRemoteHead: recordedDelivery.previousRemoteHead || null, resultingRemoteHead: reconciledHead, durationMs: Date.now() - startedAt })
        return { ok: true, pushed: false, alreadyReconciled: true, delivery, operation: persistDelivery(operation, delivery, params.storeOptions) || operation }
      }
      return { ok: false, pushed: false, code: 'PUSH_RECONCILIATION_REQUIRED', message: 'The prior push result is ambiguous; the remote does not prove delivery, so no push was replayed.', delivery: recordedDelivery, operation }
    } catch {
      return { ok: false, pushed: false, code: 'PUSH_RECONCILIATION_UNAVAILABLE', message: 'The prior push result is ambiguous and the remote could not be reconciled; no push was replayed.', delivery: recordedDelivery, operation }
    }
  }
  try {
    if (git(params.worktree.path, ['rev-parse', 'HEAD']) !== commitHash) return fail('PUSH_LOCAL_HEAD_MISMATCH', 'The isolated worktree HEAD is not the authorized commit.')
    if (statusPaths(git, params.worktree.path).length > 0) return fail('PUSH_UNEXPECTED_CHANGED_PATH', 'Unexpected changed or staged paths are present before push.')
    if (!commitMatches(git, params.worktree, params.packet, commitHash, expectedPaths)) return fail('PUSH_COMMIT_PROOF_FAILED', 'The commit parent, Workbench trailers, or exact paths do not match the packet.')
    let configuredRemoteUrl: string
    try { configuredRemoteUrl = git(params.worktree.path, ['remote', 'get-url', authorization.remote]) } catch { return fail('PUSH_REMOTE_UNAUTHORIZED', 'The authorized remote is not configured in the isolated worktree.') }
    if (configuredRemoteUrl !== authorization.remoteUrl) return fail('PUSH_REMOTE_UNAUTHORIZED', 'The configured remote does not match the exact Workbench-authorized remote identity.')
  } catch {
    return fail('PUSH_PRECONDITION_UNAVAILABLE', 'The Workbench push preconditions could not be verified.')
  }

  let beforeHead: string | null
  let beforeRefs: Map<string, string>
  try {
    beforeHead = remoteHead(git, params.worktree.path, authorization.remote, authorization.branch)
    beforeRefs = remoteRefs(git, params.worktree.path, authorization.remote)
  } catch {
    return fail('PUSH_REMOTE_UNAVAILABLE', 'The authorized remote state could not be read safely.')
  }
  if (beforeHead === commitHash) return { ok: true, pushed: false, alreadyReconciled: true, delivery: deliveryEvidence({ status: 'already_reconciled', remote: authorization.remote, branch: authorization.branch, commitHash, previousRemoteHead: beforeHead, resultingRemoteHead: beforeHead, durationMs: Date.now() - startedAt }), operation: persistDelivery(operation, deliveryEvidence({ status: 'already_reconciled', remote: authorization.remote, branch: authorization.branch, commitHash, previousRemoteHead: beforeHead, resultingRemoteHead: beforeHead, durationMs: Date.now() - startedAt }), params.storeOptions) || operation }
  if (beforeHead !== authorization.expectedRemoteHead) return fail('PUSH_REMOTE_RACE', 'The remote branch advanced or differs from the expected base; no push was attempted.', beforeHead)
  if (beforeHead && beforeHead !== commitHash) {
    try { git(params.worktree.path, ['merge-base', '--is-ancestor', beforeHead, commitHash]) } catch { return fail('PUSH_REMOTE_DIVERGED', 'The intended commit is not a fast-forward of the expected remote base.', beforeHead) }
  }

  const runCommand = params.dependencies?.runCommand || (request => runSafeCommand(request))
  let pushResult: SafeCommandResult
  try {
    pushResult = await runCommand({ sourceId: operation.sourceId, sourceRoot: params.worktree.path, commandKind: 'git_push', remote: authorization.remote, branch: authorization.branch, governedPush: true })
  } catch {
    pushResult = { status: 'timed_out', commandKind: 'git_push', command: ['git', 'push', authorization.remote, `HEAD:refs/heads/${authorization.branch}`], cwd: params.worktree.path, exitCode: null, signal: null, stdout: '', stderr: '', outputTruncated: false, durationMs: Date.now() - startedAt }
  }

  let afterHead: string | null = null
  let afterRefs: Map<string, string> | undefined
  try {
    afterHead = remoteHead(git, params.worktree.path, authorization.remote, authorization.branch)
    afterRefs = remoteRefs(git, params.worktree.path, authorization.remote)
  } catch {
    return fail('PUSH_RESULT_AMBIGUOUS', 'The push result could not be reconciled with the authorized remote.', beforeHead)
  }
  if (afterHead === commitHash) {
    const unexpectedRefs = changedRefs(beforeRefs, afterRefs)
      .filter(ref => ref !== `refs/heads/${authorization.branch}`)
    if (unexpectedRefs.length > 0) return fail('PUSH_REMOTE_UNEXPECTED_REFS', 'The remote changed outside the exact destination branch; manual reconciliation is required.', beforeHead, afterHead)
    const status: DelegationDeliveryEvidence['status'] = pushResult.status === 'completed' ? 'pushed' : 'already_reconciled'
    const delivery = deliveryEvidence({ status, remote: authorization.remote, branch: authorization.branch, commitHash, previousRemoteHead: beforeHead, resultingRemoteHead: afterHead, durationMs: Date.now() - startedAt })
    return { ok: true, pushed: status === 'pushed', alreadyReconciled: status === 'already_reconciled', delivery, operation: persistDelivery(operation, delivery, params.storeOptions) || operation }
  }
  if (pushResult.status === 'timed_out') return fail('PUSH_RESULT_AMBIGUOUS', 'The push result was ambiguous and the remote does not contain the authorized commit.', beforeHead, afterHead)
  return fail('PUSH_FAILED', 'The governed push failed and the authorized commit was not delivered.', beforeHead, afterHead)
}
