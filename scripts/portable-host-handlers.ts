import fs from 'node:fs'
import { createPortableReadHandlers } from '../packages/cli/src/agent/portable-read-handlers'
import { createPortableMutationHandlers } from '../packages/cli/src/agent/portable-mutation-handlers'
import { createSourceManagementHandlers } from '../packages/cli/src/agent/source-management-handlers'
import { createPortableApprovalHandlers } from '../packages/cli/src/agent/portable-approval-handlers'
import { getIndexedDocumentCountFromDisk } from '../packages/cli/src/agent/indexer'
import { createCodexDelegationAdapter } from '../packages/cli/src/agent/external-delegation-adapter'
import { getPersistedDelegationOperation } from '../packages/cli/src/agent/external-delegation-store'
import { getSourcesSafe } from '../packages/cli/src/agent/config'
import { appendAgentEvent } from '../packages/cli/src/agent/agent-events'
import { getAgentJob, updateAgentJob } from '../packages/cli/src/agent/agent-jobs'
import { recordWorkbenchPacketResult } from '../packages/cli/src/agent/workbench-packet-results'
import { getWorkbenchPacketRecord, updateWorkbenchPacketStatus } from '../packages/cli/src/agent/workbench-packet-store'
import type { WorkbenchExecutorResult } from '../packages/mcp/dist/executor-broker.js'
import { getConfigDir } from '../packages/cli/src/utils/paths'
import { commitGovernedCodexMutation } from '../packages/cli/src/agent/governed-codex-commit'
import { disposeDelegatedWorkbenchWorktree, getDelegatedWorkbenchWorktree } from '../packages/cli/src/agent/workbench-delegated-worktree'

const codexCommand = process.env.CODEX_CLI_PATH
  || ['/opt/homebrew/bin/codex', '/usr/local/bin/codex'].find(candidate => fs.existsSync(candidate))
  || 'codex'
const codexDelegationAdapter = createCodexDelegationAdapter({
  command: codexCommand,
  requireProjectMcp: true,
  onLifecycle: async activity => {
    const terminal = activity.lifecycle === 'completed' || activity.lifecycle === 'failed' || activity.lifecycle === 'cancelled' || activity.lifecycle === 'ambiguous'
    const control = activity.lifecycle === 'cancellation_requested'
    const eventType = control ? 'control_requested' : terminal ? activity.lifecycle === 'completed' ? 'command_completed' : 'command_failed' : 'command_started'
    const activityKind = control ? 'run_progress' : terminal ? activity.lifecycle === 'completed' ? 'executor_completed' : 'executor_failed' : 'executor_started'
    const message = control
      ? 'Codex cancellation requested.'
      : activity.lifecycle === 'submitted'
        ? 'Codex submission accepted.'
        : activity.lifecycle === 'running'
          ? 'Codex executor is running.'
          : activity.lifecycle === 'completed'
            ? 'Codex executor completed.'
            : `Codex executor ended with ${activity.lifecycle}.`
    appendAgentEvent({
      jobId: activity.runId,
      sourceId: activity.sourceId,
      type: eventType,
      activityKind,
      message,
      status: activity.lifecycle,
      taskId: activity.taskId,
      packetId: activity.packetId,
      paths: activity.changedPaths,
      evidenceRefs: [{ kind: 'packet', ref: activity.packetId }, { kind: 'event', ref: activity.operationId }]
    })
    if (!terminal) return
    const operation = getPersistedDelegationOperation(activity.operationId)
    const result = codexDelegationAdapter.evidence(activity.operationId)
    const packet = getWorkbenchPacketRecord(activity.packetId)
    if (!operation || !result || !packet || ['completed', 'failed', 'cancelled'].includes(packet.status)) return
    const wantsCommit = packet.packet.commit?.enabled === true
    const worktree = result.mutation?.worktreeId ? getDelegatedWorkbenchWorktree(result.mutation.worktreeId) : undefined
    const commitOutcome = wantsCommit
      ? worktree
        ? await commitGovernedCodexMutation({ operation, packet: packet.packet, result, worktree })
        : { ok: false as const, code: 'CODEX_COMMIT_WORKTREE_MISSING', message: 'The isolated worktree record is missing.', commitAttempted: false }
      : { ok: true as const, committed: false as const }
    const commitError = commitOutcome.ok === false ? `${commitOutcome.code}: ${commitOutcome.message}` : undefined
    const commitAmbiguous = commitOutcome.ok === false && commitOutcome.code === 'CODEX_COMMIT_AMBIGUOUS'
    const packetStatus = commitError ? 'failed' : result.lifecycle === 'completed' ? 'completed' : result.lifecycle === 'cancelled' ? 'cancelled' : 'failed'
    const commitHash = commitOutcome.ok && commitOutcome.committed ? commitOutcome.commitHash : undefined
    const executorResult: WorkbenchExecutorResult = {
      submissionId: operation.operationId,
      executorId: 'codex-cli',
      state: packetStatus === 'completed' ? 'completed' : result.lifecycle === 'ambiguous' || commitAmbiguous ? 'timeout' : packetStatus === 'cancelled' ? 'cancelled' : 'failed',
      evidence: {
        filesChanged: result.changedPaths,
        validationPassed: packetStatus === 'completed',
        ...(commitHash ? { commitHash } : result.commitIdentity ? { commitHash: result.commitIdentity } : {}),
        outputSummary: commitError || result.summary || `Codex delegation ended with ${result.lifecycle}.`,
        ...(result.mutation ? { mutation: result.mutation } : {})
      },
      completedAt: new Date().toISOString(),
      durationMs: result.durationMs
    }
    updateWorkbenchPacketStatus({ packetId: activity.packetId, status: packetStatus, commitHash, failureReason: commitError || result.errors[0] || (result.lifecycle === 'ambiguous' ? 'Codex delegation requires reconciliation.' : undefined) })
    recordWorkbenchPacketResult({
      packetId: activity.packetId,
      runId: activity.runId,
      sourceId: activity.sourceId,
      status: packetStatus,
      sourceRoot: getSourcesSafe().find(source => source.id === activity.sourceId)?.path,
      executorResult,
      error: packetStatus === 'completed' ? undefined : commitError || result.errors[0] || `Codex delegation ended with ${result.lifecycle}.`
    })
    if (worktree) disposeDelegatedWorkbenchWorktree({ worktreeId: worktree.worktreeId, terminalState: packetStatus === 'completed' ? 'complete' : packetStatus === 'cancelled' ? 'cancelled' : 'failed' })
    const run = getAgentJob(activity.runId)
    if (!run) return
    const ambiguous = result.lifecycle === 'ambiguous' || commitAmbiguous
    updateAgentJob(run.id, {
      status: packetStatus === 'completed' ? 'completed' : ambiguous ? 'blocked' : packetStatus === 'cancelled' ? 'cancelled' : 'failed',
      activePacketId: undefined,
      activeTaskId: undefined,
      completedPacketIds: packetStatus === 'completed' ? Array.from(new Set([...run.completedPacketIds, activity.packetId])) : run.completedPacketIds,
      currentCommit: commitHash || run.currentCommit,
      summary: commitError || result.summary || (ambiguous ? 'Codex delegation ended ambiguously; reconcile the persisted provider state before retrying.' : `Codex delegated goal ${result.lifecycle}.`),
      ...(ambiguous ? { blockedReason: 'Codex delegation requires provider reconciliation; no duplicate submission was attempted.' } : {})
    })
  }
})

export function createPortableHostHandlers() {
  const session = { rootDir: getConfigDir() }
  return {
    ...createPortableReadHandlers({ indexedFiles: getIndexedDocumentCountFromDisk, session }),
    ...createPortableMutationHandlers({
      codex: codexDelegationAdapter,
      codexAvailable: () => codexDelegationAdapter.capability().supported,
      session
    }),
    ...createSourceManagementHandlers(),
    ...createPortableApprovalHandlers()
  }
}

export const portableHostHandlers = createPortableHostHandlers()
