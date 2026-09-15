import { execFileSync } from 'node:child_process'
import path from 'node:path'
import type { CodexDelegationResult } from './external-delegation-adapter'
import type { PersistedDelegationOperation } from './external-delegation-store'
import { runSafeCommand, type SafeCommandRequest, type SafeCommandResult } from './command-runner'
import { verifyExactPathSet } from './workbench-packet-executor'
import type { WorkbenchPacket } from './workbench-packets'
import type { DelegatedWorktreeEvidence } from './workbench-delegated-worktree'

type GoalCommitPolicy = {
  enabled?: boolean
  authorized?: boolean
  message?: string
  body?: string
}

type GoalCommitDispatch = { commit?: GoalCommitPolicy }

export type GovernedCodexCommitOutcome =
  | { ok: true; committed: false }
  | { ok: true; committed: true; commitHash: string; alreadyCommitted: boolean; commitResult?: Pick<SafeCommandResult, 'status' | 'exitCode' | 'stdout' | 'stderr'> }
  | { ok: false; code: string; message: string; commitAttempted: boolean }

function git(root: string, args: string[]): string {
  return execFileSync('/usr/bin/git', ['-c', 'core.hooksPath=/dev/null', '-C', root, ...args], {
    encoding: 'utf8',
    timeout: 10_000,
    stdio: ['ignore', 'pipe', 'pipe']
  }).trim()
}

function normalizedPaths(paths: readonly string[]): string[] {
  return [...new Set(paths.map(item => path.posix.normalize(String(item).replace(/\\/g, '/'))))].sort()
}

function statusPaths(root: string, staged = false): string[] {
  const args = staged
    ? ['diff', '--cached', '--name-only']
    : ['status', '--porcelain=v1', '--untracked-files=all']
  const output = git(root, args)
  return output.split(/\r?\n/).filter(Boolean).map(line => {
    if (staged) return line.trim()
    const value = line.slice(line[2] === ' ' ? 3 : 2).trim()
    const rename = value.lastIndexOf(' -> ')
    return rename >= 0 ? value.slice(rename + 4) : value
  }).map(item => item.replace(/\\/g, '/')).filter(Boolean).sort()
}

function commitMatches(root: string, head: string, expectedHead: string, expectedPaths: string[], runId: string, packetId: string): boolean {
  try {
    if (git(root, ['rev-parse', `${head}^`]) !== expectedHead) return false
    const message = git(root, ['show', '-s', '--format=%B', head])
    if (!message.includes(`Workbench-Run: ${runId}`) || !message.includes(`Workbench-Packet: ${packetId}`)) return false
    verifyExactPathSet(git(root, ['diff-tree', '--no-commit-id', '--name-only', '-r', head]).split(/\r?\n/).filter(Boolean), expectedPaths, 'Committed')
    return true
  } catch {
    return false
  }
}

function failure(code: string, message: string, commitAttempted = false): GovernedCodexCommitOutcome {
  return { ok: false, code, message, commitAttempted }
}

function reconcileExistingCommit(params: {
  worktree: DelegatedWorktreeEvidence
  packet: WorkbenchPacket
  expectedPaths: string[]
}): GovernedCodexCommitOutcome | undefined {
  try {
    const head = git(params.worktree.path, ['rev-parse', 'HEAD'])
    if (head === params.packet.expectedHead) return undefined
    if (commitMatches(params.worktree.path, head, params.packet.expectedHead, params.expectedPaths, params.packet.runId, params.packet.packetId)) {
      return { ok: true, committed: true, commitHash: head, alreadyCommitted: true }
    }
    return failure('CODEX_COMMIT_HEAD_CHANGED', 'The isolated worktree HEAD no longer matches the packet expected HEAD.', false)
  } catch {
    return failure('CODEX_COMMIT_RECONCILIATION_UNAVAILABLE', 'The isolated worktree commit state could not be reconciled.', false)
  }
}

export async function commitGovernedCodexMutation(params: {
  operation: PersistedDelegationOperation
  packet: WorkbenchPacket
  result: CodexDelegationResult
  worktree: DelegatedWorktreeEvidence
  runCommand?: (request: SafeCommandRequest) => Promise<SafeCommandResult>
}): Promise<GovernedCodexCommitOutcome> {
  const commit = (params.packet.goalDispatch as GoalCommitDispatch | undefined)?.commit
  if (!commit?.enabled) return { ok: true, committed: false }
  if (commit.authorized !== true) return failure('CODEX_COMMIT_AUTHORIZATION_MISSING', 'Workbench commit authorization is missing.', false)
  if (params.packet.goalDispatch?.confirmationPolicy === 'single_exact' && params.packet.goalDispatch.confirmedByUser !== true) {
    return failure('CODEX_COMMIT_CONFIRMATION_MISSING', 'The exact Workbench commit confirmation is missing.', false)
  }
  const mutation = params.result.mutation
  const expectedPaths = normalizedPaths(params.packet.steps.flatMap(step => [step.path, step.to].filter((item): item is string => Boolean(item))))
  if (expectedPaths.length !== 1) return failure('CODEX_COMMIT_PATH_SET_MISMATCH', 'Delegated Codex commit requires exactly one admitted path.', false)
  if (params.packet.sourceId !== params.operation.sourceId || params.packet.runId !== params.operation.runId || params.packet.packetId !== params.operation.packetId) {
    return failure('CODEX_COMMIT_IDENTITY_MISMATCH', 'Delegation identity does not match the authoritative Workbench packet.', false)
  }
  if (params.worktree.packetId !== params.packet.packetId || params.worktree.expectedHead !== params.packet.expectedHead || params.worktree.sourceId !== params.packet.sourceId) {
    return failure('CODEX_COMMIT_WORKTREE_MISMATCH', 'The isolated worktree is not bound to the authoritative packet.', false)
  }
  if (!mutation || params.result.lifecycle !== 'completed' || mutation.state !== 'passed' || mutation.validation.status !== 'passed') {
    return failure('CODEX_COMMIT_VALIDATION_REQUIRED', 'Delegated Codex mutation validation did not pass.', false)
  }
  if (mutation.expectedHead !== params.packet.expectedHead || mutation.observedHead !== params.packet.expectedHead || !mutation.baseHeadUnchanged || mutation.commitDetected || mutation.conflicts.length > 0) {
    return failure('CODEX_COMMIT_HEAD_OR_CONFLICT', 'The validated Codex result has a stale HEAD or conflict evidence.', false)
  }
  if (JSON.stringify(normalizedPaths(mutation.expectedPaths)) !== JSON.stringify(expectedPaths)
    || JSON.stringify(normalizedPaths(mutation.changedPaths)) !== JSON.stringify(expectedPaths)
    || JSON.stringify(normalizedPaths(params.worktree.exactPaths)) !== JSON.stringify(expectedPaths)) {
    return failure('CODEX_COMMIT_PATH_SET_MISMATCH', 'The delegated change does not exactly match the packet path set.', false)
  }

  const alreadyCommitted = reconcileExistingCommit({ worktree: params.worktree, packet: params.packet, expectedPaths })
  if (alreadyCommitted) return alreadyCommitted

  let before: string[]
  try {
    if (git(params.worktree.path, ['rev-parse', 'HEAD']) !== params.packet.expectedHead) return failure('CODEX_COMMIT_HEAD_CHANGED', 'The isolated worktree HEAD changed before staging.', false)
    before = statusPaths(params.worktree.path)
    verifyExactPathSet(before, expectedPaths, 'Changed')
    verifyExactPathSet(statusPaths(params.worktree.path, true), [], 'Staged')
  } catch (error) {
    return failure('CODEX_COMMIT_PRECONDITION_FAILED', error instanceof Error ? error.message : 'The isolated worktree was not in the expected exact-path state.', false)
  }

  let staged: SafeCommandResult
  const executeCommand = params.runCommand || runSafeCommand
  try {
    staged = await executeCommand({
      sourceId: params.packet.sourceId,
      sourceRoot: params.worktree.path,
      commandKind: 'git_add_paths',
      paths: expectedPaths,
      confirmedByUser: true,
      networkAccess: false
    })
  } catch (error) {
    return failure('CODEX_COMMIT_STAGE_ERROR', error instanceof Error ? error.message : 'Exact-path staging failed.', false)
  }
  if (staged.status !== 'completed') return failure('CODEX_COMMIT_STAGE_FAILED', staged.stderr || staged.stdout || 'Exact-path staging failed.', false)
  try {
    verifyExactPathSet(statusPaths(params.worktree.path, true), expectedPaths, 'Staged')
    if (git(params.worktree.path, ['rev-parse', 'HEAD']) !== params.packet.expectedHead) return failure('CODEX_COMMIT_HEAD_CHANGED', 'The isolated worktree HEAD changed after staging.', false)
  } catch (error) {
    return failure('CODEX_COMMIT_STAGING_MISMATCH', error instanceof Error ? error.message : 'Staged paths do not match the authorized packet.', false)
  }

  const commitMessage = commit.message?.trim() || `workbench: ${params.packet.goalSummary}`.replace(/\s+/g, ' ').slice(0, 180)
  const existingBody = commit.body?.trim()
  const trailer = `Workbench-Run: ${params.packet.runId}\nWorkbench-Packet: ${params.packet.packetId}`
  const commitBody = existingBody ? `${existingBody}\n\n${trailer}` : trailer
  let committed: SafeCommandResult
  try {
    committed = await executeCommand({
      sourceId: params.packet.sourceId,
      sourceRoot: params.worktree.path,
      commandKind: 'git_commit',
      paths: expectedPaths,
      message: commitMessage,
      body: commitBody,
      confirmedByUser: true,
      networkAccess: false
    })
  } catch (error) {
    const reconciled = reconcileExistingCommit({ worktree: params.worktree, packet: params.packet, expectedPaths })
    return reconciled || failure('CODEX_COMMIT_AMBIGUOUS', error instanceof Error ? error.message : 'The Workbench commit result was ambiguous.', true)
  }
  if (committed.status !== 'completed') {
    const reconciled = reconcileExistingCommit({ worktree: params.worktree, packet: params.packet, expectedPaths })
    return reconciled || failure(committed.status === 'timed_out' ? 'CODEX_COMMIT_AMBIGUOUS' : 'CODEX_COMMIT_FAILED', committed.stderr || committed.stdout || 'The Workbench commit failed.', true)
  }
  try {
    const commitHash = git(params.worktree.path, ['rev-parse', 'HEAD'])
    if (!commitHash || commitHash === params.packet.expectedHead) return failure('CODEX_COMMIT_HASH_MISSING', 'The Workbench commit hash could not be resolved.', true)
    if (!commitMatches(params.worktree.path, commitHash, params.packet.expectedHead, expectedPaths, params.packet.runId, params.packet.packetId)) {
      return failure('CODEX_COMMIT_PROOF_FAILED', 'The committed path set or Workbench trailers did not match the packet.', true)
    }
    return { ok: true, committed: true, commitHash, alreadyCommitted: false, commitResult: { status: committed.status, exitCode: committed.exitCode, stdout: committed.stdout, stderr: committed.stderr } }
  } catch (error) {
    return failure('CODEX_COMMIT_PROOF_FAILED', error instanceof Error ? error.message : 'The Workbench commit could not be proven.', true)
  }
}
