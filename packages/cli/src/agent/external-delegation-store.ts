import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { getConfigDir } from '../utils/paths'
import { recordGitLockTelemetry } from './git-lock-telemetry'
import {
  projectDelegationStatus,
  transitionDelegationOperation,
  type DelegationAuthorization,
  type DelegationConfirmation,
  type DelegationEvidenceSummary,
  type DelegationDeliveryEvidence,
  type DelegationPullRequestEvidence,
  type DelegationPullRequestObservation,
  type DelegationLifecycle,
  type ExternalDelegationOperation
} from './external-delegation'

export const EXTERNAL_DELEGATION_STORE_VERSION = 1 as const

export type PersistedDelegationOperation = ExternalDelegationOperation & {
  storeVersion: typeof EXTERNAL_DELEGATION_STORE_VERSION
  revision: number
}

type DelegationStore = {
  version: typeof EXTERNAL_DELEGATION_STORE_VERSION
  updatedAt: string
  operations: PersistedDelegationOperation[]
}

export type DelegationStoreOptions = { rootDir?: string; maxRecords?: number }

export type DelegationStoreFailure = {
  ok: false
  code:
    | 'DELEGATION_STORE_BUSY'
    | 'DELEGATION_NOT_FOUND'
    | 'DELEGATION_DUPLICATE_CONFLICT'
    | 'DELEGATION_REVISION_CONFLICT'
    | 'DELEGATION_INVALID_TRANSITION'
    | 'DELEGATION_IMMUTABLE_MISMATCH'
    | 'DELEGATION_STORE_CORRUPT'
  message: string
}

const DEFAULT_MAX_RECORDS = 300
const TERMINAL = new Set<DelegationLifecycle>(['completed', 'failed', 'cancelled', 'ambiguous', 'reconciliation_required'])

function root(options?: DelegationStoreOptions): string {
  return options?.rootDir ? path.resolve(options.rootDir) : getConfigDir()
}
function filePath(options?: DelegationStoreOptions): string { return path.join(root(options), 'workbench-external-delegations.json') }
function lockPath(options?: DelegationStoreOptions): string { return `${filePath(options)}.lock` }
function emptyStore(): DelegationStore { return { version: EXTERNAL_DELEGATION_STORE_VERSION, updatedAt: new Date(0).toISOString(), operations: [] } }

function isString(value: unknown, max = 240): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max
}

function isDelivery(value: unknown): value is DelegationDeliveryEvidence {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const item = value as Partial<DelegationDeliveryEvidence>
  return ['pushed', 'already_reconciled', 'blocked', 'failed', 'ambiguous'].includes(item.status || '')
    && isString(item.remote, 200)
    && isString(item.branch, 240)
    && isString(item.commitHash, 64)
    && Number.isInteger(item.durationMs)
    && Number(item.durationMs) >= 0
    && (item.previousRemoteHead === undefined || isString(item.previousRemoteHead, 64))
    && (item.resultingRemoteHead === undefined || isString(item.resultingRemoteHead, 64))
    && (item.reasonCode === undefined || isString(item.reasonCode, 120))
}

function isPullRequest(value: unknown): value is DelegationPullRequestEvidence {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const item = value as Partial<DelegationPullRequestEvidence>
  return ['created', 'already_reconciled', 'blocked', 'failed', 'ambiguous'].includes(item.status || '')
    && typeof item.pullRequestCreated === 'boolean'
    && item.provider === 'github'
    && isString(item.repository, 200)
    && (item.number === undefined || (Number.isInteger(item.number) && Number(item.number) > 0))
    && (item.url === undefined || isString(item.url, 500))
    && item.draft === true
    && isString(item.baseBranch, 120)
    && isString(item.headBranch, 240)
    && isString(item.headCommit, 64)
    && isString(item.title, 120)
    && ['absent', 'present'].includes(item.previousMatchingPr || '')
    && ['not_required', 'pending', 'matched', 'mismatched', 'ambiguous', 'draft_changed', 'closed', 'merged', 'head_drift', 'base_mismatch', 'metadata_drift', 'not_found', 'provider_unavailable', 'authentication_unavailable'].includes(item.reconciliation || '')
    && Number.isInteger(item.durationMs)
    && Number(item.durationMs) >= 0
    && (item.createdAt === undefined || isString(item.createdAt, 40))
    && (item.reasonCode === undefined || isString(item.reasonCode, 120))
    && (item.lastObserved === undefined || isPullRequestObservation(item.lastObserved))
}

function isPullRequestObservation(value: unknown): value is DelegationPullRequestObservation {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const item = value as Partial<DelegationPullRequestObservation>
  const readiness = item.readiness
  const readinessValid = readiness === undefined || (
    typeof readiness === 'object' && readiness !== null && !Array.isArray(readiness)
    && ['ready', 'not_ready', 'unknown'].includes(readiness.status || '')
    && Array.isArray(readiness.reasons) && readiness.reasons.every(reason => isString(reason, 120))
    && (readiness.mergeable === null || isString(readiness.mergeable, 40))
    && (readiness.mergeStateStatus === null || isString(readiness.mergeStateStatus, 40))
    && typeof readiness.checks === 'object' && readiness.checks !== null && !Array.isArray(readiness.checks)
    && ['passing', 'failing', 'pending', 'unknown'].includes(readiness.checks.state || '')
    && [readiness.checks.total, readiness.checks.passing, readiness.checks.failing, readiness.checks.pending, readiness.checks.unknown].every(value => Number.isInteger(value) && Number(value) >= 0)
    && (readiness.checks.passing + readiness.checks.failing + readiness.checks.pending + readiness.checks.unknown === readiness.checks.total)
    && (readiness.reviewDecision === null || isString(readiness.reviewDecision, 40))
    && [readiness.approvals, readiness.changesRequested, readiness.reviewRequests].every(value => Number.isInteger(value) && Number(value) >= 0)
    && ['satisfied', 'required', 'blocked', 'unknown'].includes(readiness.requiredReviews || '')
    && ['available', 'unavailable', 'unknown'].includes(readiness.branchProtection || '')
  )
  return ['OPEN', 'CLOSED', 'MERGED'].includes(item.state || '')
    && typeof item.draft === 'boolean'
    && isString(item.headBranch, 240)
    && isString(item.headCommit, 64)
    && isString(item.baseBranch, 120)
    && isString(item.title, 120)
    && isString(item.observedAt, 40)
    && readinessValid
}

function isRecord(value: unknown): value is PersistedDelegationOperation {
  if (!value || typeof value !== 'object') return false
  const item = value as Partial<PersistedDelegationOperation>
  return item.storeVersion === EXTERNAL_DELEGATION_STORE_VERSION
    && item.schemaVersion === 1
    && isString(item.operationId, 200)
    && isString(item.sourceId, 200)
    && isString(item.runId, 200)
    && isString(item.taskId, 200)
    && isString(item.packetId, 200)
    && isString(item.compiledContractHash, 128)
    && isString(item.compiledIdempotencyKey, 320)
    && isString(item.expectedHead, 128)
    && isString(item.createdAt, 40)
    && isString(item.updatedAt, 40)
    && Number.isInteger(item.revision)
    && Number(item.revision) >= 0
    && (item.delivery === undefined || isDelivery(item.delivery))
    && (item.pullRequest === undefined || isPullRequest(item.pullRequest))
}

function readStore(options?: DelegationStoreOptions): DelegationStore | DelegationStoreFailure {
  try {
    const target = filePath(options)
    if (!fs.existsSync(target)) return emptyStore()
    const parsed = JSON.parse(fs.readFileSync(target, 'utf8')) as Partial<DelegationStore>
    const operations = Array.isArray(parsed.operations) ? parsed.operations.filter(isRecord) : []
    return {
      version: EXTERNAL_DELEGATION_STORE_VERSION,
      updatedAt: isString(parsed.updatedAt, 40) ? parsed.updatedAt : new Date(0).toISOString(),
      operations
    }
  } catch {
    return { ok: false, code: 'DELEGATION_STORE_CORRUPT', message: 'Delegation store could not be read safely.' }
  }
}

function persistStore(store: DelegationStore, options?: DelegationStoreOptions): void {
  const target = filePath(options)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  const maxRecords = Math.max(10, Math.min(options?.maxRecords || DEFAULT_MAX_RECORDS, 1000))
  const operations = [...store.operations]
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .slice(-maxRecords)
  const payload: DelegationStore = { version: EXTERNAL_DELEGATION_STORE_VERSION, updatedAt: new Date().toISOString(), operations }
  const temporary = `${target}.${process.pid}.${crypto.randomUUID()}.tmp`
  fs.writeFileSync(temporary, JSON.stringify(payload), { encoding: 'utf8', mode: 0o600 })
  fs.renameSync(temporary, target)
  fs.chmodSync(target, 0o600)
}

function withLock<T>(options: DelegationStoreOptions | undefined, callback: (store: DelegationStore) => T): T | DelegationStoreFailure {
  const target = filePath(options)
  const lock = lockPath(options)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  const startedAt = Date.now()
  let descriptor: number | undefined
  try {
    descriptor = fs.openSync(lock, 'wx', 0o600)
    recordGitLockTelemetry({ storeKind: 'delegation_operations', waitMs: Date.now() - startedAt, contended: false })
    const store = readStore(options)
    if ('ok' in store) return store
    const result = callback(store)
    persistStore(store, options)
    return result
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? String((error as { code?: unknown }).code) : ''
    if (code === 'EEXIST') {
      recordGitLockTelemetry({ storeKind: 'delegation_operations', waitMs: Date.now() - startedAt, contended: true })
      return { ok: false, code: 'DELEGATION_STORE_BUSY', message: 'Delegation store is busy.' }
    }
    return { ok: false, code: 'DELEGATION_STORE_CORRUPT', message: 'Delegation store write failed safely.' }
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor)
    try { if (descriptor !== undefined && fs.existsSync(lock)) fs.unlinkSync(lock) } catch { /* explicit recovery */ }
  }
}

function sameIdentity(a: ExternalDelegationOperation, b: ExternalDelegationOperation): boolean {
  return a.operationId === b.operationId
    && a.sourceId === b.sourceId
    && a.runId === b.runId
    && a.taskId === b.taskId
    && a.packetId === b.packetId
    && a.compiledContractHash === b.compiledContractHash
    && a.compiledIdempotencyKey === b.compiledIdempotencyKey
    && a.expectedHead === b.expectedHead
    && a.policyIdentity === b.policyIdentity
    && a.budgetIdentity === b.budgetIdentity
}

export function preparePersistedDelegation(operation: ExternalDelegationOperation, options?: DelegationStoreOptions): { ok: true; created: boolean; operation: PersistedDelegationOperation } | DelegationStoreFailure {
  return withLock(options, store => {
    const byKey = store.operations.find(item => item.compiledIdempotencyKey === operation.compiledIdempotencyKey)
    if (byKey) {
      if (!sameIdentity(byKey, operation)) return { ok: false, code: 'DELEGATION_DUPLICATE_CONFLICT', message: 'Delegation idempotency key conflicts with another operation.' } as DelegationStoreFailure
      return { ok: true, created: false, operation: byKey }
    }
    const record: PersistedDelegationOperation = { ...operation, storeVersion: EXTERNAL_DELEGATION_STORE_VERSION, revision: 0 }
    store.operations.push(record)
    return { ok: true, created: true, operation: record }
  })
}

export function getPersistedDelegationOperation(operationId: string, options?: DelegationStoreOptions): PersistedDelegationOperation | undefined {
  const store = readStore(options)
  if ('ok' in store) return undefined
  return store.operations.find(item => item.operationId === operationId)
}

export function listPersistedDelegationOperations(query: { sourceId?: string; runId?: string; packetId?: string; idempotencyKey?: string } = {}, options?: DelegationStoreOptions): PersistedDelegationOperation[] {
  const store = readStore(options)
  if ('ok' in store) return []
  return store.operations.filter(item => (!query.sourceId || item.sourceId === query.sourceId)
    && (!query.runId || item.runId === query.runId)
    && (!query.packetId || item.packetId === query.packetId)
    && (!query.idempotencyKey || item.compiledIdempotencyKey === query.idempotencyKey))
}

export function persistDelegationTransition(params: { operationId: string; expectedRevision: number; next: DelegationLifecycle; now: string; options?: DelegationStoreOptions }): { ok: true; operation: PersistedDelegationOperation } | DelegationStoreFailure {
  return withLock(params.options, store => {
    const index = store.operations.findIndex(item => item.operationId === params.operationId)
    if (index < 0) return { ok: false, code: 'DELEGATION_NOT_FOUND', message: 'Delegation operation was not found.' } as DelegationStoreFailure
    const current = store.operations[index]
    if (current.revision !== params.expectedRevision) return { ok: false, code: 'DELEGATION_REVISION_CONFLICT', message: 'Delegation revision is stale.' } as DelegationStoreFailure
    if (TERMINAL.has(current.lifecycle) && (params.next === 'submitted' || params.next === 'running')) return { ok: false, code: 'DELEGATION_INVALID_TRANSITION', message: 'Terminal delegation cannot reopen.' } as DelegationStoreFailure
    const transitioned = transitionDelegationOperation(current, params.next, params.now)
    if (!transitioned.ok) return { ok: false, code: 'DELEGATION_INVALID_TRANSITION', message: 'Delegation lifecycle transition is invalid.' } as DelegationStoreFailure
    const replacement: PersistedDelegationOperation = { ...transitioned.operation, storeVersion: EXTERNAL_DELEGATION_STORE_VERSION, revision: current.revision + 1 }
    if (!sameIdentity(current, replacement)) return { ok: false, code: 'DELEGATION_IMMUTABLE_MISMATCH', message: 'Delegation immutable identity changed.' } as DelegationStoreFailure
    store.operations[index] = replacement
    return { ok: true, operation: replacement }
  })
}

export function persistDelegationControls(params: { operationId: string; expectedRevision: number; authorization?: DelegationAuthorization; confirmation?: DelegationConfirmation; evidence?: DelegationEvidenceSummary; delivery?: DelegationDeliveryEvidence; pullRequest?: DelegationPullRequestEvidence; cancellation?: PersistedDelegationOperation['cancellation']; reconciliation?: PersistedDelegationOperation['reconciliation']; now: string; options?: DelegationStoreOptions }): { ok: true; operation: PersistedDelegationOperation } | DelegationStoreFailure {
  return withLock(params.options, store => {
    const index = store.operations.findIndex(item => item.operationId === params.operationId)
    if (index < 0) return { ok: false, code: 'DELEGATION_NOT_FOUND', message: 'Delegation operation was not found.' } as DelegationStoreFailure
    const current = store.operations[index]
    if (current.revision !== params.expectedRevision) return { ok: false, code: 'DELEGATION_REVISION_CONFLICT', message: 'Delegation revision is stale.' } as DelegationStoreFailure
    const replacement: PersistedDelegationOperation = {
      ...current,
      ...(params.authorization ? { authorization: params.authorization } : {}),
      ...(params.confirmation ? { confirmation: params.confirmation } : {}),
      ...(params.evidence ? { evidence: params.evidence } : {}),
      ...(params.delivery ? { delivery: params.delivery } : {}),
      ...(params.pullRequest ? { pullRequest: params.pullRequest } : {}),
      ...(params.cancellation ? { cancellation: params.cancellation } : {}),
      ...(params.reconciliation ? { reconciliation: params.reconciliation } : {}),
      updatedAt: params.now,
      revision: current.revision + 1
    }
    store.operations[index] = replacement
    return { ok: true, operation: replacement }
  })
}

export function recoverPersistedDelegations(options?: DelegationStoreOptions): PersistedDelegationOperation[] {
  return listPersistedDelegationOperations({}, options).filter(item => ['prepared', 'admitted', 'awaiting_confirmation', 'cancellation_requested', 'ambiguous', 'reconciliation_required'].includes(item.lifecycle))
}

export function projectPersistedDelegationStatus(operation: PersistedDelegationOperation) {
  return {
    sourceId: operation.sourceId,
    runId: operation.runId,
    taskId: operation.taskId,
    packetId: operation.packetId,
    revision: operation.revision,
    ...projectDelegationStatus(operation)
  }
}
