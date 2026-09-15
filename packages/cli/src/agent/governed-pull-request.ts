import { execFileSync } from 'node:child_process'
import type { DelegationPullRequestEvidence } from './external-delegation'
import {
  getPersistedDelegationOperation,
  persistDelegationControls,
  type DelegationStoreOptions,
  type PersistedDelegationOperation
} from './external-delegation-store'
import { runSafeCommand, type SafeCommandResult } from './command-runner'

const EXPECTED_REPOSITORY = 'prochattools/workbench'
const EXPECTED_REMOTE = 'origin'
const EXPECTED_BASE_BRANCH = 'main'
const FULL_COMMIT = /^[0-9a-f]{40}$/
const SAFE_BRANCH = /^[A-Za-z0-9._/-]+$/
const SAFE_REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/
const HTTPS_REMOTE = /^https:\/\/github\.com\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+?)(?:\.git)?$/
const SSH_REMOTE = /^git@github\.com:([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+?)(?:\.git)?$/

export type GovernedPullRequestAuthorization = {
  prIntent: 'explicitly_authorized'
  confirmedByUser: true
  repository: typeof EXPECTED_REPOSITORY
  remote: typeof EXPECTED_REMOTE
  remoteUrl: string
  headBranch: string
  headCommit: string
  baseBranch: typeof EXPECTED_BASE_BRANCH
  baseHead: string
  title: string
  body: string
  draft: true
  action?: 'create_draft'
  merge?: false
  autoMerge?: false
}

export type GovernedPullRequest = {
  number: number
  url: string
  isDraft: true
  headRefName: string
  baseRefName: string
  headRefOid: string
}

export type GovernedPullRequestStatus = {
  number: number
  url: string
  state: 'OPEN' | 'CLOSED' | 'MERGED'
  isDraft: boolean
  headRefName: string
  baseRefName: string
  headRefOid: string
  title: string
  readinessSignals?: GovernedPullRequestReadinessSignals
}

export type GovernedPullRequestReadinessSignals = {
  mergeable: 'MERGEABLE' | 'CONFLICTING' | 'UNKNOWN' | null
  mergeStateStatus: 'CLEAN' | 'BLOCKED' | 'DIRTY' | 'UNSTABLE' | 'UNKNOWN' | 'BEHIND' | 'DRAFT' | null
  checks: {
    state: 'passing' | 'failing' | 'pending' | 'unknown'
    total: number
    passing: number
    failing: number
    pending: number
    unknown: number
  }
  reviewDecision: 'APPROVED' | 'CHANGES_REQUESTED' | 'REVIEW_REQUIRED' | null
  approvals: number
  changesRequested: number
  reviewRequests: number
  requiredReviews: 'satisfied' | 'required' | 'blocked' | 'unknown'
  branchProtection: 'available' | 'unavailable' | 'unknown'
}

type ProviderFailure = {
  ok: false
  kind: 'provider_unavailable' | 'authentication_unavailable' | 'ambiguous'
  message: string
}

type ProviderResult = { ok: true; pullRequest?: GovernedPullRequest } | ProviderFailure

export type StatusProviderResult = { ok: true; pullRequest?: GovernedPullRequestStatus } | ProviderFailure

export type GovernedPullRequestStatusProvider = {
  readStatus: (input: { repository: string; number: number; url: string; headBranch: string }) => Promise<StatusProviderResult>
}

export type GovernedPullRequestProvider = {
  findExact: (input: { repository: string; headBranch: string; baseBranch: string; headCommit: string }) => Promise<ProviderResult>
  createDraft: (input: { repository: string; headBranch: string; baseBranch: string; title: string; body: string }) => Promise<ProviderResult>
  readStatus?: GovernedPullRequestStatusProvider['readStatus']
}

export type GovernedPullRequestStatusAuthorization = {
  repository: typeof EXPECTED_REPOSITORY
  remote: typeof EXPECTED_REMOTE
  remoteUrl: string
  prNumber: number
  prUrl: string
  headBranch: string
  headCommit: string
  baseBranch: typeof EXPECTED_BASE_BRANCH
  title: string
  draft: true
}

export type GovernedPullRequestStatusResult = {
  provider: 'github'
  repository: string
  number: number
  url: string
  state: 'OPEN' | 'CLOSED' | 'MERGED' | 'UNKNOWN'
  draft: boolean | null
  headBranch: string
  headCommit: string
  baseBranch: string
  title: string
  matchesDurableEvidence: boolean
  reconciliation: DelegationPullRequestEvidence['reconciliation']
  drift: string[]
  observedAt: string
  durationMs: number
  readinessSignals?: GovernedPullRequestReadinessSignals
  reasonCode?: string
}

export type GovernedPullRequestReadinessResult = GovernedPullRequestStatusResult & {
  readiness: 'ready' | 'not_ready' | 'unknown'
  readinessReasons: string[]
}

export type GovernedPullRequestStatusOutcome =
  | { ok: true; status: GovernedPullRequestStatusResult; operation: PersistedDelegationOperation }
  | { ok: false; code: string; message: string; status: GovernedPullRequestStatusResult; operation: PersistedDelegationOperation }

export type GovernedPullRequestReadinessOutcome =
  | { ok: true; readiness: GovernedPullRequestReadinessResult; operation: PersistedDelegationOperation }
  | { ok: false; code: string; message: string; readiness: GovernedPullRequestReadinessResult; operation: PersistedDelegationOperation }

type GitAuthority = {
  remoteUrl: (sourceRoot: string, remote: string) => string
  remoteHead: (sourceRoot: string, remote: string, branch: string) => string | null
}

type PullRequestDependencies = {
  provider?: GovernedPullRequestProvider
  git?: GitAuthority
  now?: () => number
}

type PullRequestStatusDependencies = {
  provider?: GovernedPullRequestStatusProvider
  git?: GitAuthority
  now?: () => number
}

export type GovernedPullRequestOutcome =
  | {
      ok: true
      created: boolean
      alreadyReconciled: boolean
      pullRequest: DelegationPullRequestEvidence
      operation: PersistedDelegationOperation
    }
  | {
      ok: false
      created: false
      code: string
      message: string
      pullRequest: DelegationPullRequestEvidence
      operation: PersistedDelegationOperation
    }

function gitDefault(sourceRoot: string, args: string[]): string {
  return execFileSync('/usr/bin/git', ['-c', 'core.hooksPath=/dev/null', '-C', sourceRoot, ...args], {
    encoding: 'utf8',
    timeout: 10_000,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_LITERAL_PATHSPECS: '1' }
  }).trim()
}

const defaultGit: GitAuthority = {
  remoteUrl: (sourceRoot, remote) => gitDefault(sourceRoot, ['remote', 'get-url', remote]),
  remoteHead: (sourceRoot, remote, branch) => {
    const output = gitDefault(sourceRoot, ['ls-remote', '--refs', remote, `refs/heads/${branch}`])
    const hash = output.split(/\s+/)[0]
    return FULL_COMMIT.test(hash) ? hash : null
  }
}

function repositoryFromRemote(remoteUrl: string): string | undefined {
  return remoteUrl.match(HTTPS_REMOTE)?.[1] || remoteUrl.match(SSH_REMOTE)?.[1]
}

function validTitle(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length >= 1 && value.trim().length <= 120 && !/[\r\n]/.test(value) && !/[<>]/.test(value)
}

function validBody(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 4000 && !/[\r\n]{4}/.test(value)
}

function validPr(value: GovernedPullRequest | undefined, input: { repository: string; headBranch: string; baseBranch: string; headCommit: string }): value is GovernedPullRequest {
  return !!value
    && Number.isInteger(value.number)
    && value.number > 0
    && /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/pull\/\d+$/.test(value.url)
    && value.isDraft === true
    && value.headRefName === input.headBranch
    && value.baseRefName === input.baseBranch
    && value.headRefOid === input.headCommit
    && value.url.startsWith(`https://github.com/${input.repository}/pull/`)
}

function parsePullRequests(result: SafeCommandResult, input: { repository: string; headBranch: string; baseBranch: string; headCommit: string }): ProviderResult {
  if (result.status !== 'completed') {
    const text = `${result.stderr}\n${result.stdout}`.toLowerCase()
    return { ok: false, kind: text.includes('auth') || text.includes('logged in') ? 'authentication_unavailable' : 'provider_unavailable', message: 'GitHub pull-request lookup was unavailable.' }
  }
  try {
    const parsed = JSON.parse(result.stdout) as unknown
    if (!Array.isArray(parsed)) return { ok: false, kind: 'provider_unavailable', message: 'GitHub pull-request lookup returned an invalid response.' }
    const match = parsed.find(item => validPr(item as GovernedPullRequest, input)) as GovernedPullRequest | undefined
    return { ok: true, ...(match ? { pullRequest: match } : {}) }
  } catch {
    return { ok: false, kind: 'provider_unavailable', message: 'GitHub pull-request lookup returned invalid JSON.' }
  }
}

function parseReadinessSignals(item: Record<string, unknown>): GovernedPullRequestReadinessSignals {
  const mergeableValue = typeof item.mergeable === 'string' ? item.mergeable.toUpperCase() : null
  const mergeStateValue = typeof item.mergeStateStatus === 'string' ? item.mergeStateStatus.toUpperCase() : null
  const mergeable = mergeableValue === 'MERGEABLE' || mergeableValue === 'CONFLICTING' || mergeableValue === 'UNKNOWN' ? mergeableValue : null
  const mergeStateStatus = mergeStateValue === 'CLEAN' || mergeStateValue === 'BLOCKED' || mergeStateValue === 'DIRTY' || mergeStateValue === 'UNSTABLE' || mergeStateValue === 'UNKNOWN' || mergeStateValue === 'BEHIND' || mergeStateValue === 'DRAFT' ? mergeStateValue : null
  const checks = Array.isArray(item.statusCheckRollup) ? item.statusCheckRollup : []
  let passing = 0
  let failing = 0
  let pending = 0
  let unknown = 0
  for (const check of checks) {
    if (!check || typeof check !== 'object' || Array.isArray(check)) { unknown += 1; continue }
    const value = check as Record<string, unknown>
    const status = typeof value.status === 'string' ? value.status.toUpperCase() : ''
    const state = typeof value.state === 'string' ? value.state.toUpperCase() : ''
    const conclusion = typeof value.conclusion === 'string' ? value.conclusion.toUpperCase() : ''
    if (status !== 'COMPLETED' && (status || state) && !['SUCCESS', 'FAILURE', 'ERROR'].includes(state)) { pending += 1; continue }
    if (['SUCCESS', 'NEUTRAL', 'SKIPPED'].includes(conclusion || state)) passing += 1
    else if (['FAILURE', 'ERROR', 'CANCELLED', 'TIMED_OUT', 'ACTION_REQUIRED'].includes(conclusion || state)) failing += 1
    else if (['PENDING', 'IN_PROGRESS', 'QUEUED', 'REQUESTED'].includes(conclusion || state)) pending += 1
    else unknown += 1
  }
  const total = checks.length
  const checkState = failing > 0 ? 'failing' : pending > 0 ? 'pending' : total > 0 && unknown === 0 ? 'passing' : 'unknown'
  const reviewValue = typeof item.reviewDecision === 'string' ? item.reviewDecision.toUpperCase() : ''
  const reviewDecision = reviewValue === 'APPROVED' || reviewValue === 'CHANGES_REQUESTED' || reviewValue === 'REVIEW_REQUIRED' ? reviewValue : null
  const reviews = Array.isArray(item.latestReviews) ? item.latestReviews : []
  const approvals = reviews.filter(review => review && typeof review === 'object' && (review as Record<string, unknown>).state === 'APPROVED').length
  const changesRequested = reviews.filter(review => review && typeof review === 'object' && (review as Record<string, unknown>).state === 'CHANGES_REQUESTED').length
  const reviewRequests = Array.isArray(item.reviewRequests) ? item.reviewRequests.length : 0
  return {
    mergeable,
    mergeStateStatus,
    checks: { state: checkState, total, passing, failing, pending, unknown },
    reviewDecision,
    approvals,
    changesRequested,
    reviewRequests,
    requiredReviews: reviewDecision === 'APPROVED' ? 'satisfied' : reviewDecision === 'CHANGES_REQUESTED' ? 'blocked' : reviewDecision === 'REVIEW_REQUIRED' ? 'required' : 'unknown',
    branchProtection: 'unknown'
  }
}

function parsePullRequestStatuses(result: SafeCommandResult, input: { repository: string; number: number; url: string }): StatusProviderResult {
  if (result.status !== 'completed') {
    const text = `${result.stderr}\n${result.stdout}`.toLowerCase()
    return { ok: false, kind: text.includes('auth') || text.includes('logged in') ? 'authentication_unavailable' : 'provider_unavailable', message: 'GitHub pull-request status lookup was unavailable.' }
  }
  try {
    const parsed = JSON.parse(result.stdout) as unknown
    if (!Array.isArray(parsed)) return { ok: false, kind: 'provider_unavailable', message: 'GitHub pull-request status lookup returned an invalid response.' }
    const candidate = parsed.find(item => Number((item as GovernedPullRequestStatus)?.number) === input.number)
    if (!candidate) return { ok: true }
    const item = candidate as Partial<GovernedPullRequestStatus> & { mergedAt?: string | null; [key: string]: unknown }
    const state = item.mergedAt ? 'MERGED' : item.state === 'CLOSED' ? 'CLOSED' : item.state === 'OPEN' ? 'OPEN' : null
    const status = {
      number: item.number,
      url: item.url,
      state,
      isDraft: item.isDraft,
      headRefName: item.headRefName,
      baseRefName: item.baseRefName,
      headRefOid: item.headRefOid,
      title: item.title,
      readinessSignals: parseReadinessSignals(item)
    } as GovernedPullRequestStatus
    if (!Number.isInteger(status.number) || status.number <= 0 || status.url !== input.url || !/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/pull\/\d+$/.test(status.url) || !status.state || typeof status.isDraft !== 'boolean' || typeof status.headRefName !== 'string' || !status.headRefName || typeof status.baseRefName !== 'string' || !status.baseRefName || typeof status.headRefOid !== 'string' || !FULL_COMMIT.test(status.headRefOid) || !validTitle(status.title)) {
      return { ok: false, kind: 'provider_unavailable', message: 'GitHub pull-request status lookup returned invalid identity data.' }
    }
    if (!status.url.startsWith(`https://github.com/${input.repository}/pull/`)) return { ok: false, kind: 'provider_unavailable', message: 'GitHub pull-request status lookup returned the wrong repository.' }
    return { ok: true, pullRequest: status }
  } catch {
    return { ok: false, kind: 'provider_unavailable', message: 'GitHub pull-request status lookup returned invalid JSON.' }
  }
}

async function ghCommand(params: {
  sourceId: string
  sourceRoot: string
  action: 'list' | 'create'
  args: string[]
}): Promise<SafeCommandResult> {
  const auth = await runSafeCommand({
    commandKind: 'local_cli_github_auth_status',
    sourceId: params.sourceId,
    sourceRoot: params.sourceRoot,
    networkAccess: true
  })
  if (auth.status !== 'completed') return auth
  return runSafeCommand({
    commandKind: params.action === 'list' ? 'local_cli_github_pr_list' : 'local_cli_github_pr_create',
    sourceId: params.sourceId,
    sourceRoot: params.sourceRoot,
    args: params.args,
    networkAccess: true,
    governedPullRequest: true
  })
}

function createGithubProvider(sourceId: string, sourceRoot: string): GovernedPullRequestProvider {
  const listInput = (input: { repository: string; headBranch: string; baseBranch: string; headCommit: string }) => ghCommand({
    sourceId,
    sourceRoot,
    action: 'list',
    args: ['list', '--repo', input.repository, '--head', input.headBranch, '--base', input.baseBranch, '--state', 'open', '--json', 'number,url,isDraft,headRefName,baseRefName,headRefOid', '--limit', '10']
  })
  return {
    async findExact(input) {
      return parsePullRequests(await listInput(input), input)
    },
    async createDraft(input) {
      const result = await ghCommand({
        sourceId,
        sourceRoot,
        action: 'create',
        args: ['create', '--repo', input.repository, '--head', input.headBranch, '--base', input.baseBranch, '--title', input.title, '--body', input.body, '--draft']
      })
      if (result.status !== 'completed') {
        const text = `${result.stderr}\n${result.stdout}`.toLowerCase()
        return { ok: false, kind: text.includes('auth') || text.includes('logged in') ? 'authentication_unavailable' : 'provider_unavailable', message: 'GitHub draft pull-request creation was unavailable.' }
      }
      return { ok: true }
    },
    async readStatus(input) {
      const result = await ghCommand({
        sourceId,
        sourceRoot,
        action: 'list',
        args: ['list', '--repo', input.repository, '--head', input.headBranch, '--state', 'all', '--json', 'number,url,state,isDraft,headRefName,baseRefName,headRefOid,title,mergedAt,mergeable,mergeStateStatus,statusCheckRollup,reviewDecision,latestReviews,reviewRequests', '--limit', '20']
      })
      return parsePullRequestStatuses(result, input)
    }
  }
}

function evidence(params: {
  status: DelegationPullRequestEvidence['status']
  authorization: Partial<GovernedPullRequestAuthorization>
  previousMatchingPr: DelegationPullRequestEvidence['previousMatchingPr']
  reconciliation: DelegationPullRequestEvidence['reconciliation']
  durationMs: number
  reasonCode?: string
  pullRequest?: GovernedPullRequest
  createdAt?: string
}): DelegationPullRequestEvidence {
  const pullRequest = params.pullRequest
  return {
    status: params.status,
    pullRequestCreated: params.status === 'created' || params.status === 'already_reconciled',
    provider: 'github',
    repository: typeof params.authorization.repository === 'string' ? params.authorization.repository : EXPECTED_REPOSITORY,
    ...(pullRequest ? { number: pullRequest.number, url: pullRequest.url } : {}),
    draft: true,
    baseBranch: typeof params.authorization.baseBranch === 'string' ? params.authorization.baseBranch : EXPECTED_BASE_BRANCH,
    headBranch: typeof params.authorization.headBranch === 'string' ? params.authorization.headBranch : 'unknown',
    headCommit: typeof params.authorization.headCommit === 'string' ? params.authorization.headCommit : 'unknown',
    title: typeof params.authorization.title === 'string' && params.authorization.title.trim() ? params.authorization.title.trim().slice(0, 120) : 'blocked',
    previousMatchingPr: params.previousMatchingPr,
    reconciliation: params.reconciliation,
    ...(params.createdAt ? { createdAt: params.createdAt } : {}),
    durationMs: Math.max(0, Math.floor(params.durationMs)),
    ...(params.reasonCode ? { reasonCode: params.reasonCode } : {})
  }
}

function persistPullRequest(operation: PersistedDelegationOperation, pullRequest: DelegationPullRequestEvidence, options?: DelegationStoreOptions): PersistedDelegationOperation {
  const current = getPersistedDelegationOperation(operation.operationId, options) || operation
  const result = persistDelegationControls({
    operationId: current.operationId,
    expectedRevision: current.revision,
    pullRequest,
    now: new Date().toISOString(),
    options
  })
  return result.ok ? result.operation : current
}

function statusResult(params: {
  authorization: GovernedPullRequestStatusAuthorization
  state: GovernedPullRequestStatusResult['state']
  draft: boolean | null
  headBranch?: string
  headCommit?: string
  baseBranch?: string
  title?: string
  matchesDurableEvidence: boolean
  reconciliation: GovernedPullRequestStatusResult['reconciliation']
  drift?: string[]
  observedAt: string
  durationMs: number
  readinessSignals?: GovernedPullRequestReadinessSignals
  reasonCode?: string
}): GovernedPullRequestStatusResult {
  return {
    provider: 'github',
    repository: params.authorization.repository,
    number: params.authorization.prNumber,
    url: params.authorization.prUrl,
    state: params.state,
    draft: params.draft,
    headBranch: params.headBranch ?? params.authorization.headBranch,
    headCommit: params.headCommit ?? params.authorization.headCommit,
    baseBranch: params.baseBranch ?? params.authorization.baseBranch,
    title: params.title ?? params.authorization.title,
    matchesDurableEvidence: params.matchesDurableEvidence,
    reconciliation: params.reconciliation,
    drift: params.drift || [],
    observedAt: params.observedAt,
    durationMs: Math.max(0, Math.floor(params.durationMs)),
    ...(params.readinessSignals ? { readinessSignals: params.readinessSignals } : {}),
    ...(params.reasonCode ? { reasonCode: params.reasonCode } : {})
  }
}

function statusAuthorizationValid(authorization: GovernedPullRequestStatusAuthorization): string | undefined {
  if (authorization.repository !== EXPECTED_REPOSITORY || !SAFE_REPOSITORY.test(authorization.repository)) return 'PR_STATUS_REPOSITORY_UNAUTHORIZED'
  if (authorization.remote !== EXPECTED_REMOTE) return 'PR_STATUS_REMOTE_UNAUTHORIZED'
  if (typeof authorization.remoteUrl !== 'string' || !authorization.remoteUrl.trim()) return 'PR_STATUS_REMOTE_URL_MISSING'
  if (typeof authorization.prNumber !== 'number' || !Number.isInteger(authorization.prNumber) || authorization.prNumber <= 0) return 'PR_STATUS_NUMBER_INVALID'
  if (authorization.prUrl !== `https://github.com/${EXPECTED_REPOSITORY}/pull/${authorization.prNumber}`) return 'PR_STATUS_URL_MISMATCH'
  if (typeof authorization.headBranch !== 'string' || !SAFE_BRANCH.test(authorization.headBranch) || authorization.headBranch.startsWith('-') || authorization.headBranch.includes('..')) return 'PR_STATUS_HEAD_BRANCH_INVALID'
  if (typeof authorization.headCommit !== 'string' || !FULL_COMMIT.test(authorization.headCommit)) return 'PR_STATUS_HEAD_COMMIT_INVALID'
  if (authorization.baseBranch !== EXPECTED_BASE_BRANCH) return 'PR_STATUS_BASE_BRANCH_UNAUTHORIZED'
  if (!validTitle(authorization.title)) return 'PR_STATUS_TITLE_INVALID'
  if (authorization.draft !== true) return 'PR_STATUS_DRAFT_REQUIRED'
  return undefined
}

function observedReconciliation(status: GovernedPullRequestStatus, authorization: GovernedPullRequestStatusAuthorization): { reconciliation: GovernedPullRequestStatusResult['reconciliation']; drift: string[] } {
  const drift: string[] = []
  if (status.headRefName !== authorization.headBranch || status.headRefOid !== authorization.headCommit) drift.push('head_drift')
  if (status.baseRefName !== authorization.baseBranch) drift.push('base_mismatch')
  if (status.title !== authorization.title) drift.push('metadata_drift')
  if (status.isDraft !== authorization.draft) drift.push('draft_changed')
  if (status.state === 'MERGED') return { reconciliation: 'merged', drift }
  if (status.state === 'CLOSED') return { reconciliation: 'closed', drift }
  if (drift.includes('head_drift')) return { reconciliation: 'head_drift', drift }
  if (drift.includes('base_mismatch')) return { reconciliation: 'base_mismatch', drift }
  if (drift.includes('metadata_drift')) return { reconciliation: 'metadata_drift', drift }
  if (drift.includes('draft_changed')) return { reconciliation: 'draft_changed', drift }
  return { reconciliation: 'matched', drift }
}

function withStatusObservation(evidenceValue: DelegationPullRequestEvidence, status: GovernedPullRequestStatusResult): DelegationPullRequestEvidence {
  return {
    ...evidenceValue,
    reconciliation: status.reconciliation,
    durationMs: status.durationMs,
    ...(status.state === 'UNKNOWN' ? {} : {
      lastObserved: {
        state: status.state,
        draft: status.draft === true,
        headBranch: status.headBranch,
        headCommit: status.headCommit,
        baseBranch: status.baseBranch,
        title: status.title,
        observedAt: status.observedAt,
        ...(status.readinessSignals ? {
          readiness: {
            status: readinessStatus(status),
            reasons: readinessReasons(status),
            ...status.readinessSignals
          }
        } : {})
      }
    })
  }
}

function readinessReasons(status: GovernedPullRequestStatusResult): string[] {
  const reasons: string[] = []
  if (status.state === 'MERGED') reasons.push('already_merged')
  else if (status.state === 'CLOSED') reasons.push('closed')
  if (status.draft === true) reasons.push('draft')
  for (const drift of status.drift) if (!reasons.includes(drift)) reasons.push(drift)
  const signals = status.readinessSignals
  if (signals) {
    if (signals.mergeable === 'CONFLICTING') reasons.push('merge_conflict')
    if (signals.mergeStateStatus === 'BLOCKED') reasons.push('merge_blocked')
    if (signals.mergeStateStatus === 'DIRTY') reasons.push('branch_not_up_to_date')
    if (signals.mergeStateStatus === 'UNSTABLE') reasons.push('checks_unstable')
    if (signals.mergeStateStatus === 'BEHIND') reasons.push('branch_behind')
    if (signals.checks.state === 'failing') reasons.push('checks_failing')
    if (signals.checks.state === 'pending') reasons.push('checks_pending')
    if (signals.reviewDecision === 'CHANGES_REQUESTED') reasons.push('changes_requested')
    if (signals.reviewDecision === 'REVIEW_REQUIRED') reasons.push('review_required')
    if (signals.mergeable === null || signals.mergeStateStatus === null || signals.checks.state === 'unknown' || signals.branchProtection === 'unknown') reasons.push('readiness_signal_unknown')
  }
  return [...new Set(reasons)]
}

function readinessStatus(status: GovernedPullRequestStatusResult): GovernedPullRequestReadinessResult['readiness'] {
  if (status.state === 'UNKNOWN' || !status.readinessSignals) return 'unknown'
  const reasons = readinessReasons(status)
  const informational = new Set(['draft_changed', 'metadata_drift', 'readiness_signal_unknown'])
  if (reasons.some(reason => !informational.has(reason))) return 'not_ready'
  return reasons.includes('readiness_signal_unknown') ? 'unknown' : 'ready'
}

function readinessResult(status: GovernedPullRequestStatusResult): GovernedPullRequestReadinessResult {
  const reasons = readinessReasons(status)
  return { ...status, readiness: readinessStatus(status), readinessReasons: reasons }
}

export async function readGovernedPullRequestStatus(params: {
  operation: PersistedDelegationOperation
  sourceRoot: string
  authorization: GovernedPullRequestStatusAuthorization
  storeOptions?: DelegationStoreOptions
  dependencies?: PullRequestStatusDependencies
}): Promise<GovernedPullRequestStatusOutcome> {
  const clock = params.dependencies?.now || Date.now
  const startedAt = clock()
  const authorization = params.authorization
  const operation = getPersistedDelegationOperation(params.operation.operationId, params.storeOptions) || params.operation
  const stored = operation.pullRequest
  const unknown = (code: string, message: string, reconciliation: GovernedPullRequestStatusResult['reconciliation'] = 'not_required'): GovernedPullRequestStatusOutcome => {
    const observedAt = new Date(clock()).toISOString()
    const status = statusResult({ authorization, state: 'UNKNOWN', draft: null, matchesDurableEvidence: false, reconciliation, observedAt, durationMs: clock() - startedAt, reasonCode: code })
    return { ok: false, code, message, status, operation }
  }

  const invalidAuthorization = statusAuthorizationValid(authorization)
  if (invalidAuthorization) return unknown(invalidAuthorization, 'The exact pull-request status identity is not authorized.')
  if (operation.lifecycle !== 'completed' || operation.authorization !== 'satisfied') return unknown('PR_STATUS_GOVERNED_OPERATION_NOT_COMPLETED', 'The governed operation is not completed and authorized.')
  if (!operation.sourceId) return unknown('PR_STATUS_SOURCE_LOCK_MISSING', 'The source repository lock is missing.')
  if (!stored || stored.pullRequestCreated !== true || stored.repository !== authorization.repository || stored.number !== authorization.prNumber || stored.url !== authorization.prUrl || stored.headBranch !== authorization.headBranch || stored.headCommit !== authorization.headCommit || stored.baseBranch !== authorization.baseBranch) return unknown('PR_STATUS_NOT_PROVEN', 'Durable Workbench evidence does not prove this exact pull request.')

  const git = params.dependencies?.git || defaultGit
  let configuredRemoteUrl: string
  try { configuredRemoteUrl = git.remoteUrl(params.sourceRoot, EXPECTED_REMOTE) } catch { return unknown('PR_STATUS_REMOTE_UNAVAILABLE', 'The exact authorized remote could not be read.') }
  if (configuredRemoteUrl !== authorization.remoteUrl) return unknown('PR_STATUS_REMOTE_IDENTITY_MISMATCH', 'The configured remote does not match the exact authorized remote identity.')
  if (repositoryFromRemote(configuredRemoteUrl) !== EXPECTED_REPOSITORY) return unknown('PR_STATUS_REPOSITORY_IDENTITY_MISMATCH', 'The configured remote does not identify the exact Workbench repository.')

  const provider = params.dependencies?.provider || createGithubProvider(operation.sourceId, params.sourceRoot)
  if (!provider.readStatus) return unknown('PR_STATUS_UNSUPPORTED', 'The governed provider does not expose a read-only pull-request status operation.')
  const providerResult = await provider.readStatus({ repository: authorization.repository, number: authorization.prNumber, url: authorization.prUrl, headBranch: authorization.headBranch })
  const durationMs = clock() - startedAt
  if (providerResult.ok === false) {
    const code = providerResult.kind === 'authentication_unavailable' ? 'PR_STATUS_AUTHENTICATION_UNAVAILABLE' : providerResult.kind === 'ambiguous' ? 'PR_STATUS_AMBIGUOUS' : 'PR_STATUS_PROVIDER_UNAVAILABLE'
    const reconciliation = providerResult.kind === 'authentication_unavailable' ? 'authentication_unavailable' : providerResult.kind === 'ambiguous' ? 'ambiguous' : 'provider_unavailable'
    return unknown(code, providerResult.message, reconciliation)
  }
  const current = providerResult.pullRequest
  if (!current) {
    const status = statusResult({ authorization, state: 'UNKNOWN', draft: null, matchesDurableEvidence: false, reconciliation: 'not_found', observedAt: new Date(clock()).toISOString(), durationMs, reasonCode: 'PR_STATUS_NOT_FOUND' })
    const nextOperation = persistPullRequest(operation, withStatusObservation(stored, status), params.storeOptions)
    return { ok: false, code: 'PR_STATUS_NOT_FOUND', message: 'The exact pull request was not found by the provider.', status, operation: nextOperation }
  }
  const comparison = observedReconciliation(current, authorization)
  const status = statusResult({
    authorization,
    state: current.state,
    draft: current.isDraft,
    headBranch: current.headRefName,
    headCommit: current.headRefOid,
    baseBranch: current.baseRefName,
    title: current.title,
    readinessSignals: current.readinessSignals,
    matchesDurableEvidence: comparison.reconciliation === 'matched',
    reconciliation: comparison.reconciliation,
    drift: comparison.drift,
    observedAt: new Date(clock()).toISOString(),
    durationMs
  })
  const nextOperation = persistPullRequest(operation, withStatusObservation(stored, status), params.storeOptions)
  return { ok: true, status, operation: nextOperation }
}

export async function readGovernedPullRequestReadiness(params: {
  operation: PersistedDelegationOperation
  sourceRoot: string
  authorization: GovernedPullRequestStatusAuthorization
  storeOptions?: DelegationStoreOptions
  dependencies?: PullRequestStatusDependencies
}): Promise<GovernedPullRequestReadinessOutcome> {
  const result = await readGovernedPullRequestStatus(params)
  const readiness = readinessResult(result.status)
  if (result.ok === false) return { ok: false, code: result.code, message: result.message, readiness, operation: result.operation }
  return { ok: true, readiness, operation: result.operation }
}

export async function createGovernedDraftPullRequest(params: {
  operation: PersistedDelegationOperation
  sourceRoot: string
  authorization: GovernedPullRequestAuthorization
  storeOptions?: DelegationStoreOptions
  dependencies?: PullRequestDependencies
}): Promise<GovernedPullRequestOutcome> {
  const startedAt = (params.dependencies?.now || Date.now)()
  const authorization = params.authorization as unknown as Record<string, any>
  const git = params.dependencies?.git || defaultGit
  const provider = params.dependencies?.provider || createGithubProvider(params.operation.sourceId, params.sourceRoot)
  const operation = getPersistedDelegationOperation(params.operation.operationId, params.storeOptions) || params.operation
  const fail = (code: string, message: string, status: DelegationPullRequestEvidence['status'] = 'blocked', previousMatchingPr: DelegationPullRequestEvidence['previousMatchingPr'] = 'absent', reconciliation: DelegationPullRequestEvidence['reconciliation'] = 'not_required'): GovernedPullRequestOutcome => {
    const pr = evidence({ status, authorization, previousMatchingPr, reconciliation, durationMs: Date.now() - startedAt, reasonCode: code })
    return { ok: false, created: false, code, message, pullRequest: pr, operation: persistPullRequest(operation, pr, params.storeOptions) }
  }

  if (authorization.prIntent !== 'explicitly_authorized') return fail('PR_INTENT_NOT_AUTHORIZED', 'Explicit draft pull-request intent is required.')
  if (authorization.confirmedByUser !== true) return fail('PR_CONFIRMATION_MISSING', 'Explicit Workbench pull-request confirmation is required.')
  if (authorization.action && authorization.action !== 'create_draft') return fail('PR_ACTION_UNSUPPORTED', 'Only draft pull-request creation is supported.')
  if (authorization.merge === true || authorization.autoMerge === true) return fail('PR_MERGE_UNSUPPORTED', 'Merge and auto-merge are not supported by this capability.')
  if (authorization.repository !== EXPECTED_REPOSITORY || !SAFE_REPOSITORY.test(String(authorization.repository))) return fail('PR_REPOSITORY_UNAUTHORIZED', 'The pull-request repository is outside the exact Workbench target.')
  if (authorization.remote !== EXPECTED_REMOTE) return fail('PR_REMOTE_UNAUTHORIZED', 'The pull-request remote must be origin.')
  if (typeof authorization.remoteUrl !== 'string' || !authorization.remoteUrl.trim()) return fail('PR_REMOTE_URL_MISSING', 'The authorized remote identity is missing.')
  if (typeof authorization.headBranch !== 'string' || !SAFE_BRANCH.test(authorization.headBranch) || authorization.headBranch.startsWith('-') || authorization.headBranch.includes('..')) return fail('PR_HEAD_BRANCH_INVALID', 'The source branch is not a safe exact branch name.')
  if (typeof authorization.baseBranch !== 'string' || authorization.baseBranch !== EXPECTED_BASE_BRANCH) return fail('PR_BASE_BRANCH_UNAUTHORIZED', 'The pull-request base must be main.')
  if (typeof authorization.headCommit !== 'string' || !FULL_COMMIT.test(authorization.headCommit)) return fail('PR_HEAD_COMMIT_INVALID', 'The source head commit is not an exact commit.')
  if (typeof authorization.baseHead !== 'string' || !FULL_COMMIT.test(authorization.baseHead)) return fail('PR_BASE_HEAD_INVALID', 'The target branch state is not known exactly.')
  if (!validTitle(authorization.title)) return fail('PR_TITLE_INVALID', 'A bounded single-line pull-request title is required.')
  if (!validBody(authorization.body)) return fail('PR_BODY_INVALID', 'The pull-request body is outside the bounded policy.')
  if (authorization.draft !== true) return fail('PR_DRAFT_REQUIRED', 'Only draft pull-requests are supported.')
  if (operation.lifecycle !== 'completed' || operation.authorization !== 'satisfied') return fail('PR_GOVERNED_COMMIT_NOT_COMPLETED', 'The governed delegation is not completed and authorized.')
  if (!operation.sourceId) return fail('PR_SOURCE_LOCK_MISSING', 'The source repository lock is missing.')
  const delivery = operation.delivery
  if (!delivery || !['pushed', 'already_reconciled'].includes(delivery.status)) return fail('PR_PUSH_NOT_PROVEN', 'A successful governed push is required before pull-request creation.')
  if (delivery.remote !== EXPECTED_REMOTE || delivery.branch !== authorization.headBranch || delivery.commitHash !== authorization.headCommit || delivery.resultingRemoteHead && delivery.resultingRemoteHead !== authorization.headCommit) return fail('PR_PUSH_HEAD_MISMATCH', 'The pushed source branch/head does not match the authorized pull-request head.')

  let configuredRemoteUrl: string
  try { configuredRemoteUrl = git.remoteUrl(params.sourceRoot, EXPECTED_REMOTE) } catch { return fail('PR_REMOTE_UNAVAILABLE', 'The exact authorized remote could not be read.') }
  if (configuredRemoteUrl !== authorization.remoteUrl) return fail('PR_REMOTE_IDENTITY_MISMATCH', 'The configured remote does not match the exact authorized remote identity.')
  if (repositoryFromRemote(configuredRemoteUrl) !== EXPECTED_REPOSITORY) return fail('PR_REPOSITORY_IDENTITY_MISMATCH', 'The configured remote does not identify the exact Workbench repository.')
  let sourceHead: string | null
  let baseHead: string | null
  try {
    sourceHead = git.remoteHead(params.sourceRoot, EXPECTED_REMOTE, authorization.headBranch)
    baseHead = git.remoteHead(params.sourceRoot, EXPECTED_REMOTE, EXPECTED_BASE_BRANCH)
  } catch { return fail('PR_REMOTE_STATE_UNAVAILABLE', 'The exact remote branch state could not be read.') }
  if (sourceHead !== authorization.headCommit) return fail('PR_SOURCE_BRANCH_MOVED', 'The pushed source branch moved or does not contain the authorized head.')
  if (baseHead !== authorization.baseHead) return fail('PR_BASE_BRANCH_MOVED', 'The target branch moved or does not match the authorized base head.')

  const stored = operation.pullRequest
  const exactInput = { repository: EXPECTED_REPOSITORY, headBranch: authorization.headBranch, baseBranch: EXPECTED_BASE_BRANCH, headCommit: authorization.headCommit }
  if (stored && ['created', 'already_reconciled', 'ambiguous'].includes(stored.status) && stored.repository === exactInput.repository && stored.headBranch === exactInput.headBranch && stored.baseBranch === exactInput.baseBranch && stored.headCommit === exactInput.headCommit) {
    const reconciled = await provider.findExact(exactInput)
    if (reconciled.ok === false) return fail('PR_RECONCILIATION_REQUIRED', reconciled.message, reconciled.kind === 'ambiguous' ? 'ambiguous' : 'failed', 'present', reconciled.kind === 'ambiguous' ? 'ambiguous' : 'pending')
    if (!reconciled.pullRequest) return fail('PR_RECONCILIATION_REQUIRED', 'The persisted pull-request result is not proven by provider state.', 'ambiguous', 'present', 'ambiguous')
    const pr = evidence({ status: 'already_reconciled', authorization, previousMatchingPr: 'present', reconciliation: 'matched', durationMs: Date.now() - startedAt, pullRequest: reconciled.pullRequest })
    return { ok: true, created: false, alreadyReconciled: true, pullRequest: pr, operation: persistPullRequest(operation, pr, params.storeOptions) }
  }

  const existing = await provider.findExact(exactInput)
  if (existing.ok === false) return fail(existing.kind === 'authentication_unavailable' ? 'PR_AUTHENTICATION_UNAVAILABLE' : 'PR_PROVIDER_UNAVAILABLE', existing.message, existing.kind === 'ambiguous' ? 'ambiguous' : 'failed', 'absent', existing.kind === 'ambiguous' ? 'ambiguous' : 'not_required')
  if (existing.pullRequest) {
    const pr = evidence({ status: 'already_reconciled', authorization, previousMatchingPr: 'present', reconciliation: 'matched', durationMs: Date.now() - startedAt, pullRequest: existing.pullRequest })
    return { ok: true, created: false, alreadyReconciled: true, pullRequest: pr, operation: persistPullRequest(operation, pr, params.storeOptions) }
  }

  const created = await provider.createDraft({ repository: EXPECTED_REPOSITORY, headBranch: authorization.headBranch, baseBranch: EXPECTED_BASE_BRANCH, title: authorization.title, body: authorization.body })
  if (created.ok === false) {
    if (created.kind === 'authentication_unavailable') return fail('PR_AUTHENTICATION_UNAVAILABLE', created.message, 'failed')
    if (created.kind === 'provider_unavailable') return fail('PR_PROVIDER_UNAVAILABLE', created.message, 'failed')
    const reconciled = await provider.findExact(exactInput)
    if (reconciled.ok && reconciled.pullRequest) {
      const pr = evidence({ status: 'already_reconciled', authorization, previousMatchingPr: 'present', reconciliation: 'matched', durationMs: Date.now() - startedAt, pullRequest: reconciled.pullRequest })
      return { ok: true, created: false, alreadyReconciled: true, pullRequest: pr, operation: persistPullRequest(operation, pr, params.storeOptions) }
    }
    return fail('PR_CREATION_AMBIGUOUS', 'The provider result was ambiguous; state was reconciled without replaying creation.', 'ambiguous', 'absent', 'ambiguous')
  }
  const reconciled = await provider.findExact(exactInput)
  if (!reconciled.ok || !reconciled.pullRequest) return fail('PR_CREATION_AMBIGUOUS', 'The pull-request creation result could not be reconciled; creation will not be replayed.', 'ambiguous', 'absent', 'ambiguous')
  const pr = evidence({ status: 'created', authorization, previousMatchingPr: 'absent', reconciliation: 'matched', durationMs: Date.now() - startedAt, pullRequest: reconciled.pullRequest, createdAt: new Date().toISOString() })
  return { ok: true, created: true, alreadyReconciled: false, pullRequest: pr, operation: persistPullRequest(operation, pr, params.storeOptions) }
}

export const governedPullRequestConstants = {
  repository: EXPECTED_REPOSITORY,
  remote: EXPECTED_REMOTE,
  baseBranch: EXPECTED_BASE_BRANCH
} as const
