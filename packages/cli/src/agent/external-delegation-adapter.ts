import { execFileSync, spawn, spawnSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import type { ChildProcess, SpawnOptionsWithoutStdio } from 'node:child_process'
import type { DelegationEvidenceSummary, ExternalDelegationOperation } from './external-delegation'
import { manualDelegationFallback, projectDelegationStatus, validateDelegationEvidence } from './external-delegation'
import {
  createSubmissionIntent,
  evaluateProviderAdmission,
  reconcileProviderState,
  type ProviderStatusRecord,
  type SubmissionAcknowledgement,
  type SubmissionIntent,
  validateSubmissionAcknowledgement
} from './external-delegation-protocol'
import {
  getPersistedDelegationOperation,
  persistDelegationControls,
  persistDelegationTransition,
  type DelegationStoreOptions,
  type PersistedDelegationOperation
} from './external-delegation-store'
import { renderCodexPrompt, type PromptPacketTransportContract } from './prompt-packet-compiler'
import { validateWriteTarget, type WriteChangeType } from './safe-access'

export type DelegationAdapterCapability = {
  supported: boolean
  reasonCode: 'preview_only' | 'unsupported_executor' | 'network_transport_unavailable' | 'authorization_unavailable'
  manualFallback: true
  nextAction: string
}

export type DelegationAdapterPreview<T> = {
  performed: false
  capability: DelegationAdapterCapability
  preview?: T
}

export interface ExternalDelegationAdapter {
  capability(operation: ExternalDelegationOperation): DelegationAdapterCapability
  prepare(operation: ExternalDelegationOperation): DelegationAdapterPreview<ReturnType<typeof projectDelegationStatus>>
  submitPreview(operation: ExternalDelegationOperation): DelegationAdapterPreview<{ operationId: string; lifecycle: string; idempotencyKey: string }>
  statusReadback(operation: ExternalDelegationOperation): DelegationAdapterPreview<ReturnType<typeof projectDelegationStatus>>
  cancelPreview(operation: ExternalDelegationOperation): DelegationAdapterPreview<{ operationId: string; cancellation: 'requested' }>
  evidencePreview(operation: ExternalDelegationOperation, evidence: DelegationEvidenceSummary): DelegationAdapterPreview<DelegationEvidenceSummary>
  reconcilePreview(operation: ExternalDelegationOperation): DelegationAdapterPreview<{ operationId: string; reconciliation: string }>
}

function capability(reasonCode: DelegationAdapterCapability['reasonCode'] = 'preview_only'): DelegationAdapterCapability {
  const fallback = manualDelegationFallback('manual_fallback_required')
  return {
    supported: false,
    reasonCode,
    manualFallback: true,
    nextAction: fallback.nextAction
  }
}

export function createPreviewOnlyDelegationAdapter(): ExternalDelegationAdapter {
  return {
    capability: operation => capability(operation.executor.engine === 'codex' || operation.executor.engine === 'future_adapter' || operation.executor.engine === 'human' ? 'preview_only' : 'unsupported_executor'),
    prepare: operation => ({ performed: false, capability: capability(), preview: projectDelegationStatus(operation) }),
    submitPreview: operation => ({ performed: false, capability: capability('network_transport_unavailable'), preview: { operationId: operation.operationId, lifecycle: operation.lifecycle, idempotencyKey: operation.compiledIdempotencyKey } }),
    statusReadback: operation => ({ performed: false, capability: capability('network_transport_unavailable'), preview: projectDelegationStatus(operation) }),
    cancelPreview: operation => ({ performed: false, capability: capability('network_transport_unavailable'), preview: { operationId: operation.operationId, cancellation: 'requested' } }),
    evidencePreview: (operation, evidence) => {
      const validated = validateDelegationEvidence(operation, evidence)
      return validated.ok
        ? { performed: false, capability: capability('network_transport_unavailable'), preview: validated.evidence }
        : { performed: false, capability: capability('network_transport_unavailable') }
    },
    reconcilePreview: operation => ({ performed: false, capability: capability('network_transport_unavailable'), preview: { operationId: operation.operationId, reconciliation: operation.reconciliation } })
  }
}

export type CodexDelegationIsolation = 'read_only' | 'worktree'

export type CodexDelegationInput = {
  operation: PersistedDelegationOperation
  contract: PromptPacketTransportContract
  sourceRoot: string
  branch: string
  ownerSessionId: string
  isolation: CodexDelegationIsolation
  /** Internal governed mutation binding. Generic worktree execution remains unavailable. */
  mcpRepositoryRoot?: string
  governedMutation?: {
    worktreeId: string
    exactPaths: readonly string[]
  }
}

export type CodexDelegationCapability = {
  supported: boolean
  adapterIdentity: 'codex-cli'
  command: string
  version?: string
  supportsIsolation: true
  supportsWorkbenchMcp: true
  supportsCancellation: true
  supportsStatusReadback: true
  supportsReconciliation: true
  manualFallback: true
  reasonCode: 'ready' | 'unsupported_executor' | 'network_transport_unavailable'
  nextAction: string
}

export type CodexDelegationBinding = {
  sourceId: string
  repositoryRoot: string
  branch: string
  expectedHead: string
  runId: string
  taskId: string
  packetId: string
  ownerSessionId: string
  isolation: CodexDelegationIsolation
}

export type CodexDelegationResult = {
  operationId: string
  providerOperationIdentity: string
  lifecycle: 'completed' | 'failed' | 'cancelled' | 'ambiguous'
  exitCode?: number
  signal?: string
  changedPaths: string[]
  validationEvidence: string[]
  mcpToolCalls: string[]
  commitIdentity?: string
  warnings: string[]
  errors: string[]
  summary?: string
  durationMs: number
  auditReferences: string[]
  provenanceReferences: string[]
  mutation?: {
    state: 'passed' | 'failed' | 'unavailable' | 'executor_failed'
    worktreeId: string
    expectedPaths: string[]
    changedPaths: string[]
    conflicts: string[]
    diffDigest?: string
    expectedHead: string
    observedHead?: string
    baseHeadUnchanged: boolean
    commitDetected: boolean
    validation: { commandKind: 'git_diff_check'; status: 'passed' | 'failed' | 'unavailable'; exitCode: number | null; durationMs: number }
  }
}

export type CodexDelegationActivity = {
  operationId: string
  lifecycle: 'submitted' | 'running' | 'cancellation_requested' | 'completed' | 'failed' | 'cancelled' | 'ambiguous'
  sourceId: string
  runId: string
  taskId: string
  packetId: string
  changedPaths?: string[]
  commitIdentity?: string
}

export type CodexDelegationStatus = {
  operation: PersistedDelegationOperation
  providerStatus?: ProviderStatusRecord
  result?: CodexDelegationResult
}

type SpawnedProcess = Pick<ChildProcess, 'stdin' | 'stdout' | 'stderr' | 'once' | 'on' | 'kill'>

type CodexAdapterOptions = {
  command?: string
  timeoutMs?: number
  maxOutputBytes?: number
  storeOptions?: DelegationStoreOptions
  now?: () => Date
  probeCommand?: (command: string) => { available: boolean; version?: string }
  gitProbe?: (sourceRoot: string, args: string[]) => string
  spawnProcess?: (command: string, args: string[], options: SpawnOptionsWithoutStdio & { stdio: ['pipe', 'pipe', 'pipe'] }) => SpawnedProcess
  onLifecycle?: (activity: CodexDelegationActivity) => void | Promise<void>
  requireProjectMcp?: boolean
}

type ActiveCodexExecution = {
  input: CodexDelegationInput
  operation: PersistedDelegationOperation
  intent: SubmissionIntent
  acknowledgement: SubmissionAcknowledgement
  child: SpawnedProcess
  providerOperationIdentity: string
  startedAt: number
  stdout: string
  stdoutRemainder: string
  stderr: string
  changedPaths: string[]
  validationEvidence: string[]
  mcpToolCalls: string[]
  sawAgentMessage: boolean
  summary?: string
  commitIdentity?: string
  threadId?: string
  cancellationRequested: boolean
  settled: boolean
  result?: CodexDelegationResult
  mutation?: CodexDelegationResult['mutation']
}

const CODEX_ADAPTER_ID = 'codex-cli'
const DEFAULT_TIMEOUT_MS = 10 * 60_000
const MAX_PROMPT_BYTES = 8_000
const MAX_OUTPUT_BYTES = 128 * 1024
const MAX_RESULT_TEXT = 240

function sha256(value: string): string {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex')
}

function bounded(value: unknown, max = MAX_RESULT_TEXT): string | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value.replace(/\s+/g, ' ').trim()
  return normalized ? normalized.slice(0, max) : undefined
}

function safeList(values: string[], maxItems = 24, maxLength = 512): string[] {
  return [...new Set(values.map(value => value.trim()).filter(Boolean))].slice(0, maxItems).map(value => value.slice(0, maxLength))
}

function boundedSequence(values: string[], maxItems = 12, maxLength = 120): string[] {
  return values.map(value => value.trim()).filter(Boolean).slice(0, maxItems).map(value => value.slice(0, maxLength))
}

function appendBounded(current: string, chunk: string, maxBytes: number): string {
  const next = `${current}${chunk}`
  if (Buffer.byteLength(next, 'utf8') <= maxBytes) return next
  return Buffer.from(next, 'utf8').subarray(0, maxBytes).toString('utf8')
}

function realCodexProbe(command: string): { available: boolean; version?: string } {
  const result = spawnSync(command, ['--version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], shell: false, timeout: 2_000 })
  if (result.status !== 0) return { available: false }
  const help = spawnSync(command, ['exec', '--help'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], shell: false, timeout: 2_000 })
  if (help.status !== 0 || !['--json', '--ephemeral', '--sandbox', '-C'].every(flag => String(help.stdout || '').includes(flag))) return { available: false }
  return { available: true, version: bounded(result.stdout) }
}

function realGitProbe(sourceRoot: string, args: string[]): string {
  return execFileSync('git', args, { cwd: sourceRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], shell: false, timeout: 3_000 }).trim()
}

function realSpawnProcess(command: string, args: string[], options: SpawnOptionsWithoutStdio & { stdio: ['pipe', 'pipe', 'pipe'] }): SpawnedProcess {
  return spawn(command, args, options)
}

function codexCapability(options: CodexAdapterOptions): CodexDelegationCapability {
  const command = options.command || process.env.CODEX_CLI_PATH || 'codex'
  const probe = (options.probeCommand || realCodexProbe)(command)
  if (!probe.available) {
    return {
      supported: false,
      adapterIdentity: CODEX_ADAPTER_ID,
      command,
      supportsIsolation: true,
      supportsWorkbenchMcp: true,
      supportsCancellation: true,
      supportsStatusReadback: true,
      supportsReconciliation: true,
      manualFallback: true,
      reasonCode: 'network_transport_unavailable',
      nextAction: 'Use the manual bounded packet fallback until the local Codex CLI is available.'
    }
  }
  return {
    supported: true,
    adapterIdentity: CODEX_ADAPTER_ID,
    command,
    ...(probe.version ? { version: probe.version } : {}),
    supportsIsolation: true,
    supportsWorkbenchMcp: true,
    supportsCancellation: true,
    supportsStatusReadback: true,
    supportsReconciliation: true,
    manualFallback: true,
    reasonCode: 'ready',
    nextAction: 'Submit the admitted bounded packet through Codex CLI.'
  }
}

function transition(options: CodexAdapterOptions, operation: PersistedDelegationOperation, next: Parameters<typeof persistDelegationTransition>[0]['next']): PersistedDelegationOperation {
  const result = persistDelegationTransition({
    operationId: operation.operationId,
    expectedRevision: operation.revision,
    next,
    now: (options.now || (() => new Date()))().toISOString(),
    options: options.storeOptions
  })
  if (result.ok !== true) throw new Error(result.message)
  return result.operation
}

function updateControls(options: CodexAdapterOptions, operation: PersistedDelegationOperation, controls: Parameters<typeof persistDelegationControls>[0]): PersistedDelegationOperation {
  const result = persistDelegationControls({ ...controls, operationId: operation.operationId, expectedRevision: operation.revision, now: (options.now || (() => new Date()))().toISOString(), options: options.storeOptions })
  if (result.ok !== true) throw new Error(result.message)
  return result.operation
}

function parseCodexEvent(execution: ActiveCodexExecution, line: string): void {
  let event: unknown
  try { event = JSON.parse(line) } catch { return }
  if (!event || typeof event !== 'object' || Array.isArray(event)) return
  const record = event as Record<string, unknown>
  if (record.type === 'thread.started' && typeof record.thread_id === 'string') execution.threadId = record.thread_id.slice(0, 160)
  const item = record.item && typeof record.item === 'object' ? record.item as Record<string, unknown> : undefined
  if (item) {
    const itemType = typeof item.type === 'string' ? item.type : 'unknown_item'
    const itemStatus = typeof item.status === 'string' ? item.status : undefined
    if (itemType === 'agent_message') execution.sawAgentMessage = true
    execution.validationEvidence = safeList([...execution.validationEvidence, `${itemType}:${itemStatus || 'observed'}`], 24, 160)
    const toolName = typeof item.name === 'string' ? item.name : typeof item.tool_name === 'string' ? item.tool_name : typeof item.tool === 'string' ? item.tool : undefined
    if (toolName && itemType.toLowerCase().includes('mcp') && (itemStatus === undefined || itemStatus === 'in_progress')) {
      execution.mcpToolCalls = boundedSequence([...execution.mcpToolCalls, toolName])
    }
    const summary = bounded(item.text) || bounded(item.message) || bounded(item.summary)
    if (summary) execution.summary = summary
    if (typeof item.commit === 'string') execution.commitIdentity = item.commit.slice(0, 128)
    if (typeof item.commitIdentity === 'string') execution.commitIdentity = item.commitIdentity.slice(0, 128)
    const paths: string[] = []
    if (typeof item.path === 'string') paths.push(item.path)
    if (Array.isArray(item.changes)) {
      for (const change of item.changes) {
        if (change && typeof change === 'object' && typeof (change as Record<string, unknown>).path === 'string') paths.push((change as Record<string, unknown>).path as string)
      }
    }
    execution.changedPaths = safeList([...execution.changedPaths, ...paths])
  }
  const error = bounded(record.error) || bounded(record.message)
  if (record.type === 'error' && error) execution.stderr = appendBounded(execution.stderr, error, MAX_OUTPUT_BYTES)
}

function mutationStatusPaths(repositoryRoot: string): string[] {
  const output = execFileSync('git', ['status', '--porcelain=v1', '--untracked-files=all'], { cwd: repositoryRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 3_000 })
  return output.split(/\r?\n/).filter(Boolean).map(line => {
    const value = line.slice(3).trim()
    const rename = value.lastIndexOf(' -> ')
    return (rename >= 0 ? value.slice(rename + 4) : value).replace(/\\/g, '/')
  }).filter(Boolean).sort()
}

function verifyGovernedMutation(execution: ActiveCodexExecution, executorLifecycle: CodexDelegationResult['lifecycle']): CodexDelegationResult['mutation'] {
  const governed = execution.input.governedMutation!
  const expectedPaths = [...governed.exactPaths].map(item => item.replace(/\\/g, '/')).sort()
  const startedAt = Date.now()
  let changedPaths: string[] = []
  let observedHead: string | undefined
  let diffDigest: string | undefined
  const conflicts: string[] = []
  let commitDetected = false
  try {
    observedHead = realGitProbe(execution.input.sourceRoot, ['rev-parse', 'HEAD'])
    commitDetected = observedHead !== execution.operation.expectedHead
    if (commitDetected) conflicts.push('HEAD changed; governed mutation cannot commit')
    changedPaths = mutationStatusPaths(execution.input.sourceRoot)
    if (JSON.stringify(changedPaths) !== JSON.stringify(expectedPaths)) conflicts.push('changed paths do not exactly match the admitted path set')
    const staged = realGitProbe(execution.input.sourceRoot, ['diff', '--cached', '--name-only']).split(/\r?\n/).filter(Boolean)
    if (staged.length > 0) conflicts.push('staged changes detected; governed mutation cannot commit')
    const diff = realGitProbe(execution.input.sourceRoot, ['diff', '--', ...expectedPaths])
    diffDigest = sha256(diff)
    if (!execution.mcpToolCalls.includes('readWorkbenchContext')) conflicts.push('Workbench MCP context proof is missing')
    if ((execution.input.contract.goalDispatch?.commands?.length || 0) > 0 && !execution.mcpToolCalls.includes('runWorkbenchCommand')) conflicts.push('Workbench MCP command proof is missing')
  } catch {
    return {
      state: executorLifecycle === 'completed' ? 'unavailable' : 'executor_failed',
      worktreeId: governed.worktreeId,
      expectedPaths,
      changedPaths,
      conflicts: ['isolated worktree state could not be read'],
      expectedHead: execution.operation.expectedHead,
      ...(observedHead ? { observedHead } : {}),
      baseHeadUnchanged: observedHead === execution.operation.expectedHead,
      commitDetected,
      validation: { commandKind: 'git_diff_check', status: 'unavailable', exitCode: null, durationMs: Date.now() - startedAt }
    }
  }
  let validation: NonNullable<CodexDelegationResult['mutation']>['validation']
  const validationStartedAt = Date.now()
  try {
    execFileSync('git', ['diff', '--check', '--', ...expectedPaths], { cwd: execution.input.sourceRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 10_000 })
    validation = { commandKind: 'git_diff_check', status: 'passed', exitCode: 0, durationMs: Date.now() - validationStartedAt }
  } catch (error) {
    const exitCode = error && typeof error === 'object' && 'status' in error && typeof error.status === 'number' ? error.status : null
    validation = { commandKind: 'git_diff_check', status: exitCode === null ? 'unavailable' : 'failed', exitCode, durationMs: Date.now() - validationStartedAt }
  }
  if (validation.status !== 'passed') conflicts.push(validation.status === 'failed' ? 'exact-path git diff check failed' : 'exact-path validation was unavailable')
  if (executorLifecycle !== 'completed') conflicts.push('Codex executor did not complete successfully')
  const state = validation.status === 'unavailable' && conflicts.length === 1 ? 'unavailable' : executorLifecycle === 'completed' && conflicts.length === 0 ? 'passed' : executorLifecycle === 'completed' ? 'failed' : 'executor_failed'
  return { state, worktreeId: governed.worktreeId, expectedPaths, changedPaths, conflicts, ...(diffDigest ? { diffDigest } : {}), expectedHead: execution.operation.expectedHead, ...(observedHead ? { observedHead } : {}), baseHeadUnchanged: observedHead === execution.operation.expectedHead, commitDetected, validation }
}

function bindingFor(input: CodexDelegationInput, gitProbe: (sourceRoot: string, args: string[]) => string): CodexDelegationBinding {
  if (!input.operation || input.operation.executor.engine !== 'codex') throw new Error('Codex delegation requires the codex executor.')
  if (input.operation.lifecycle !== 'admitted') throw new Error(`Codex delegation requires an admitted operation, found ${input.operation.lifecycle}.`)
  if (!input.ownerSessionId.trim()) throw new Error('Codex delegation owner session is required.')
  const prompt = renderCodexPrompt(input.contract)
  if (Buffer.byteLength(prompt, 'utf8') > MAX_PROMPT_BYTES) throw new Error('Codex delegation prompt exceeds the bounded packet limit.')
  if (input.operation.sourceId !== input.contract.sourceId || input.operation.runId !== input.contract.runId || input.operation.taskId !== input.contract.taskId || input.operation.packetId !== input.contract.packetId || input.operation.expectedHead !== input.contract.expectedHead || input.operation.compiledContractHash !== input.contract.contentHash || input.operation.compiledIdempotencyKey !== input.contract.idempotencyKey) {
    throw new Error('Codex delegation contract identity does not match the persisted operation.')
  }
  const candidateRoot = path.resolve(input.sourceRoot)
  if (!fs.existsSync(candidateRoot) || !fs.statSync(candidateRoot).isDirectory()) throw new Error('Codex delegation source root is unavailable.')
  const repositoryRoot = fs.realpathSync(candidateRoot)
  const actualRoot = fs.realpathSync(path.resolve(gitProbe(repositoryRoot, ['rev-parse', '--show-toplevel'])))
  const actualBranch = gitProbe(repositoryRoot, ['branch', '--show-current'])
  const actualHead = gitProbe(repositoryRoot, ['rev-parse', 'HEAD'])
  if (actualRoot !== repositoryRoot) throw new Error('Codex delegation source root is not the repository root.')
  const governedMutation = input.governedMutation
  if (input.isolation === 'worktree' && !governedMutation) throw new Error('Worktree Codex delegation requires a governed mutation admission.')
  if (governedMutation && (governedMutation.exactPaths.length !== 1 || !governedMutation.worktreeId)) throw new Error('Governed mutation binding must contain one exact path and worktree identity.')
  if (governedMutation) {
    const normalizedPath = path.posix.normalize(governedMutation.exactPaths[0].replace(/\\/g, '/'))
    const contractPaths = input.contract.exactPaths.map(item => path.posix.normalize(item.replace(/\\/g, '/'))).sort()
    if (contractPaths.length !== 1 || contractPaths[0] !== normalizedPath || normalizedPath === '.' || normalizedPath.startsWith('../') || normalizedPath.includes('/../')) throw new Error('Governed mutation path does not match the exact packet scope.')
    const step = input.contract.steps.find(item => path.posix.normalize(item.path.replace(/\\/g, '/')) === normalizedPath)
    if (!step || !['overwrite', 'patch'].includes(step.type)) throw new Error('Governed mutation operation is outside the admitted write policy.')
    const policy = validateWriteTarget({ sourceId: input.operation.sourceId, sourceRoot: repositoryRoot, requestedPath: normalizedPath, changeType: step.type as WriteChangeType })
    if (policy.ok === false) throw new Error(`Governed mutation path rejected by Workbench policy: ${policy.error.message}`)
  }
  if (!governedMutation && (!input.branch || actualBranch !== input.branch)) throw new Error('Codex delegation branch binding does not match the current branch.')
  if (!input.operation.expectedHead || actualHead !== input.operation.expectedHead) throw new Error('Codex delegation HEAD binding does not match the current HEAD.')
  if (input.isolation === 'worktree') {
    const gitDir = path.resolve(repositoryRoot, gitProbe(repositoryRoot, ['rev-parse', '--git-dir']))
    const commonDir = path.resolve(repositoryRoot, gitProbe(repositoryRoot, ['rev-parse', '--git-common-dir']))
    if (gitDir === commonDir) throw new Error('Mutation-capable Codex delegation requires an explicitly isolated worktree root.')
  }
  return {
    sourceId: input.operation.sourceId,
    repositoryRoot,
    branch: actualBranch || input.branch,
    expectedHead: actualHead,
    runId: input.operation.runId,
    taskId: input.operation.taskId,
    packetId: input.operation.packetId,
    ownerSessionId: input.ownerSessionId.slice(0, 160),
    isolation: input.isolation
  }
}

function tomlSection(text: string, heading: string): string | undefined {
  const lines = text.split(/\r?\n/)
  const start = lines.findIndex(line => line.trim() === heading)
  if (start < 0) return undefined
  const body: string[] = []
  for (const line of lines.slice(start + 1)) {
    if (/^\s*\[[^\]]+\]\s*$/.test(line)) break
    body.push(line)
  }
  return body.join('\n')
}

function tomlString(section: string, key: string): string | undefined {
  return section.match(new RegExp(`^\\s*${key.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}\\s*=\\s*"([^"\\r\\n]*)"\\s*$`, 'm'))?.[1]
}

function sectionCount(text: string, heading: string): number {
  return text.split(/\r?\n/).filter(line => line.trim() === heading).length
}

function assertProjectMcpRegistration(repositoryRoot: string, registrationRoot = repositoryRoot): void {
  const home = process.env.HOME || ''
  const projectConfigPath = path.join(registrationRoot, '.codex', 'config.toml')
  const globalConfigPath = path.join(process.env.CODEX_HOME || path.join(home, '.codex'), 'config.toml')
  const projectText = fs.readFileSync(projectConfigPath, 'utf8')
  const globalText = fs.existsSync(globalConfigPath) ? fs.readFileSync(globalConfigPath, 'utf8') : ''
  const heading = '[mcp_servers.workbench]'
  const project = tomlSection(projectText, heading)
  const credentialFile = path.join(home, '.buildflow', 'codex-workbench-mcp.token')
  const expectedEntrypoint = path.join(registrationRoot, 'packages/mcp/dist/server.js')
  const command = project ? tomlString(project, 'command') : undefined
  const argsContainEntrypoint = project?.includes(expectedEntrypoint) === true
  const cwd = project ? tomlString(project, 'cwd') : undefined
  const credentialMode = (() => {
    try { return (fs.statSync(credentialFile).mode & 0o777).toString(8).padStart(4, '0') } catch { return undefined }
  })()
  const commandIsSupported = (() => {
    if (!command || !path.isAbsolute(command)) return false
    try {
      const version = execFileSync(command, ['--version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], shell: false, timeout: 2_000 }).trim()
      const match = version.match(/^v?(\d+)\.(\d+)\.(\d+)$/)
      if (!match) return false
      const [, major, minor, patch] = match.map(Number)
      return major === 20 && (minor > 20 || (minor === 20 && patch >= 2))
    } catch { return false }
  })()
  const valid = sectionCount(projectText, heading) === 1 && sectionCount(globalText, heading) === 0 &&
    commandIsSupported && argsContainEntrypoint && cwd === registrationRoot &&
    /^\s*enabled\s*=\s*true\s*$/m.test(project!) && /^\s*required\s*=\s*true\s*$/m.test(project!) &&
    projectText.includes('[mcp_servers.workbench.env]') && projectText.includes(`WORKBENCH_MCP_CREDENTIAL_FILE = "${credentialFile}"`) &&
    credentialMode === '0600'
  if (!valid) throw new Error('Project-scoped Workbench MCP registration is unavailable or ambiguous.')
}

function providerStatus(execution: ActiveCodexExecution, lifecycle: ProviderStatusRecord['lifecycle'], now: string): ProviderStatusRecord {
  return {
    providerOperationIdentity: execution.providerOperationIdentity,
    lifecycle,
    adapterIdentity: CODEX_ADAPTER_ID,
    observedAt: now,
    reasonCode: lifecycle,
    durationMs: Math.max(0, Date.now() - execution.startedAt),
    validationState: lifecycle === 'completed' ? 'passed' : lifecycle === 'failed' ? 'failed' : 'unknown'
  }
}

function resultFor(execution: ActiveCodexExecution, lifecycle: CodexDelegationResult['lifecycle'], exitCode?: number, signal?: string): CodexDelegationResult {
  return {
    operationId: execution.operation.operationId,
    providerOperationIdentity: execution.providerOperationIdentity,
    lifecycle,
    ...(exitCode === undefined ? {} : { exitCode }),
    ...(signal ? { signal } : {}),
    changedPaths: safeList(execution.changedPaths),
    validationEvidence: safeList(execution.validationEvidence, 24, 160),
    mcpToolCalls: boundedSequence(execution.mcpToolCalls),
    warnings: safeList(execution.stderr ? ['Codex emitted bounded diagnostic output.'] : [], 8, 160),
    errors: safeList(lifecycle === 'failed' || lifecycle === 'ambiguous' ? ['Codex execution did not produce a verified successful terminal result.'] : [], 8, 160),
    ...(execution.summary ? { summary: execution.summary } : {}),
    ...(execution.commitIdentity ? { commitIdentity: execution.commitIdentity } : {}),
    ...(execution.mutation ? { mutation: execution.mutation } : {}),
    durationMs: Math.max(0, Date.now() - execution.startedAt),
    auditReferences: [`delegation:${execution.operation.operationId}`, `packet:${execution.operation.packetId}`],
    provenanceReferences: [`source:${execution.operation.sourceId}`, `head:${execution.operation.expectedHead}`]
  }
}

function emitLifecycle(options: CodexAdapterOptions, execution: ActiveCodexExecution, lifecycle: CodexDelegationActivity['lifecycle'], result?: CodexDelegationResult): void {
  try {
    const notification = options.onLifecycle?.({
      operationId: execution.operation.operationId,
      lifecycle,
      sourceId: execution.operation.sourceId,
      runId: execution.operation.runId,
      taskId: execution.operation.taskId,
      packetId: execution.operation.packetId,
      ...(result?.changedPaths.length ? { changedPaths: result.changedPaths } : {}),
      ...(result?.commitIdentity ? { commitIdentity: result.commitIdentity } : {})
    })
    if (notification && typeof (notification as Promise<void>).catch === 'function') void (notification as Promise<void>).catch(() => {})
  } catch {
    // Activity projection is best-effort and must never alter executor state.
  }
}

export type CodexDelegationAdapter = {
  capability(): CodexDelegationCapability
  prepare(input: CodexDelegationInput): { ok: true; binding: CodexDelegationBinding } | { ok: false; reason: string }
  submit(input: CodexDelegationInput): Promise<{ ok: true; operation: PersistedDelegationOperation; providerOperationIdentity: string } | { ok: false; reason: string }>
  statusReadback(operationId: string): CodexDelegationStatus | undefined
  cancel(operationId: string): { ok: true; operation: PersistedDelegationOperation } | { ok: false; reason: string }
  reconcile(operationId: string): CodexDelegationStatus | undefined
  evidence(operationId: string): CodexDelegationResult | undefined
}

export function createCodexDelegationAdapter(options: CodexAdapterOptions = {}): CodexDelegationAdapter {
  const active = new Map<string, ActiveCodexExecution>()
  const results = new Map<string, CodexDelegationResult>()
  const command = options.command || process.env.CODEX_CLI_PATH || 'codex'
  const timeoutMs = Math.max(5_000, Math.min(options.timeoutMs || DEFAULT_TIMEOUT_MS, 3_600_000))
  const maxOutputBytes = Math.max(8_192, Math.min(options.maxOutputBytes || MAX_OUTPUT_BYTES, MAX_OUTPUT_BYTES))
  const gitProbe = options.gitProbe || realGitProbe
  const spawnProcess = options.spawnProcess || realSpawnProcess

  const finalize = async (execution: ActiveCodexExecution, lifecycle: CodexDelegationResult['lifecycle'], exitCode?: number, signal?: string): Promise<void> => {
    if (execution.settled) return
    execution.settled = true
    active.delete(execution.operation.operationId)
    if (execution.input.governedMutation) {
      execution.mutation = verifyGovernedMutation(execution, lifecycle)
      execution.changedPaths = [...execution.mutation.changedPaths]
      execution.commitIdentity = undefined
      if (lifecycle === 'completed' && execution.mutation.state !== 'passed') lifecycle = 'failed'
    }
    const now = (options.now || (() => new Date()))().toISOString()
    const provider = providerStatus(execution, lifecycle, now)
    const result = resultFor(execution, lifecycle, exitCode, signal)
    const reconciliation = reconcileProviderState({
      operation: execution.operation,
      intent: execution.intent,
      acknowledgement: execution.acknowledgement,
      status: provider,
      evidence: {
        operationId: result.operationId,
        packetId: execution.operation.packetId,
        resultStatus: result.lifecycle,
        validationState: lifecycle === 'completed' ? 'passed' : lifecycle === 'failed' ? 'failed' : 'unknown',
        ...(result.commitIdentity ? { commitIdentity: result.commitIdentity } : {}),
        durationMs: result.durationMs,
        reasonCode: provider.reasonCode
      }
    })
    const effectiveLifecycle = reconciliation.outcome === 'matched' ? lifecycle : 'ambiguous'
    const effectiveResult = effectiveLifecycle === lifecycle ? result : resultFor(execution, 'ambiguous', exitCode, signal)
    results.set(execution.operation.operationId, effectiveResult)
    try {
      const nextOperation = execution.operation.lifecycle === 'cancellation_requested'
        ? effectiveLifecycle === 'cancelled' ? transition(options, execution.operation, 'cancelled') : transition(options, execution.operation, 'ambiguous')
        : transition(options, execution.operation, effectiveLifecycle)
      execution.operation = updateControls(options, nextOperation, {
        operationId: nextOperation.operationId,
        expectedRevision: nextOperation.revision,
        evidence: {
          operationId: nextOperation.operationId,
          packetId: nextOperation.packetId,
          resultStatus: effectiveLifecycle,
          validationState: effectiveLifecycle === 'completed' ? 'passed' : effectiveLifecycle === 'failed' ? 'failed' : 'unknown',
          ...(effectiveResult.commitIdentity ? { commitIdentity: effectiveResult.commitIdentity } : {}),
          ...(effectiveResult.durationMs ? { durationMs: effectiveResult.durationMs } : {}),
          reasonCode: reconciliation.reasonCode
        },
        reconciliation: effectiveLifecycle === 'ambiguous' ? 'ambiguous' : 'matched',
        now
      })
    } catch {
      // A lost store write must never be presented as a verified terminal result.
      const current = getPersistedDelegationOperation(execution.operation.operationId, options.storeOptions)
      if (current && !['completed', 'failed', 'cancelled', 'ambiguous'].includes(current.lifecycle)) {
        try {
          const ambiguous = transition(options, current, 'ambiguous')
          execution.operation = updateControls(options, ambiguous, { operationId: ambiguous.operationId, expectedRevision: ambiguous.revision, reconciliation: 'ambiguous', now })
        } catch { /* caller must reconcile the persisted operation */ }
      }
    }
    emitLifecycle(options, execution, effectiveLifecycle, effectiveResult)
  }

  const start = (execution: ActiveCodexExecution): void => {
    execution.child.once('error', () => { void finalize(execution, 'failed') })
    execution.child.once('spawn', () => {
      if (execution.settled) return
      execution.operation = transition(options, execution.operation, 'running')
      emitLifecycle(options, execution, 'running')
    })
    execution.child.stdout?.on('data', (chunk: Buffer | string) => {
      const text = String(chunk)
      execution.stdout = appendBounded(execution.stdout, text, maxOutputBytes)
      if (Buffer.byteLength(execution.stdout, 'utf8') >= maxOutputBytes && !execution.settled) {
        execution.child.kill('SIGTERM')
        void finalize(execution, 'ambiguous', undefined, 'SIGTERM')
        return
      }
      const combined = `${execution.stdoutRemainder}${text}`
      const lines = combined.split('\n')
      execution.stdoutRemainder = lines.pop() || ''
      for (const line of lines) parseCodexEvent(execution, line)
    })
    execution.child.stderr?.on('data', (chunk: Buffer | string) => { execution.stderr = appendBounded(execution.stderr, String(chunk), maxOutputBytes) })
    execution.child.once('close', (code: number | null, signal: NodeJS.Signals | null) => {
      if (execution.settled) return
      if (execution.stdoutRemainder) parseCodexEvent(execution, execution.stdoutRemainder)
      const lifecycle: CodexDelegationResult['lifecycle'] = execution.cancellationRequested
        ? 'cancelled'
        : code === 0 && execution.sawAgentMessage && (execution.input.isolation !== 'read_only' || execution.mcpToolCalls.includes('readWorkbenchContext'))
          ? 'completed'
          : 'failed'
      void finalize(execution, lifecycle, code === null ? undefined : code, signal || undefined)
    })
    const timer = setTimeout(() => {
      if (execution.settled) return
      execution.child.kill('SIGTERM')
      void finalize(execution, 'ambiguous', undefined, 'SIGTERM')
    }, timeoutMs)
    timer.unref?.()
    execution.child.once('close', () => clearTimeout(timer))
  }

  return {
    capability: () => codexCapability(options),
    prepare: input => {
      try { return { ok: true, binding: bindingFor(input, gitProbe) } } catch (error) { return { ok: false, reason: error instanceof Error ? error.message : 'Codex delegation preparation failed.' } }
    },
    submit: async input => {
      const available = codexCapability(options)
      if (!available.supported) return { ok: false, reason: available.nextAction }
      const prepared = input.operation.lifecycle === 'admitted' ? { ok: true as const, binding: bindingFor(input, gitProbe) } : { ok: false as const, reason: 'Codex delegation operation is not admitted.' }
      if (!prepared.ok) return { ok: false, reason: prepared.reason }
      if (options.requireProjectMcp === true) {
        try { assertProjectMcpRegistration(prepared.binding.repositoryRoot, path.resolve(input.mcpRepositoryRoot || prepared.binding.repositoryRoot)) } catch (error) { return { ok: false, reason: error instanceof Error ? error.message : 'Project-scoped Workbench MCP registration is unavailable.' } }
      }
      const admission = evaluateProviderAdmission({ operation: input.operation, contract: input.contract, adapterIdentity: CODEX_ADAPTER_ID, adapterSupported: true, expectedRevision: input.operation.revision })
      if (!admission.allowed) return { ok: false, reason: admission.nextAction }
      let submitted: PersistedDelegationOperation
      try { submitted = transition(options, input.operation, 'submitted') } catch (error) { return { ok: false, reason: error instanceof Error ? error.message : 'Could not persist submission state.' } }
      const intent = createSubmissionIntent({ operation: submitted, adapterIdentity: CODEX_ADAPTER_ID, now: (options.now || (() => new Date()))().toISOString() })
      const providerOperationIdentity = `codex:${submitted.operationId}`
      const acknowledgement: SubmissionAcknowledgement = {
        schemaVersion: 1,
        operationId: submitted.operationId,
        packetId: submitted.packetId,
        adapterIdentity: CODEX_ADAPTER_ID,
        providerOperationIdentity,
        compiledContractHash: submitted.compiledContractHash,
        idempotencyKey: submitted.compiledIdempotencyKey,
        acceptedAt: (options.now || (() => new Date()))().toISOString(),
        status: 'accepted',
        reasonCode: 'local_process_spawn_pending'
      }
      const acknowledgementCheck = validateSubmissionAcknowledgement({ operation: submitted, intent, acknowledgement })
      if (!acknowledgementCheck.ok) return { ok: false, reason: 'Codex submission acknowledgement failed identity validation.' }
      let child: SpawnedProcess
      try {
        const mcpRoot = path.resolve(input.mcpRepositoryRoot || prepared.binding.repositoryRoot)
        const mutationMcpArgs = input.governedMutation
          ? [
              '--ignore-user-config',
              '-c', `mcp_servers.workbench.command=${process.execPath}`,
              '-c', `mcp_servers.workbench.args=${JSON.stringify([path.join(mcpRoot, 'packages/mcp/dist/server.js')])}`,
              '-c', `mcp_servers.workbench.cwd=${mcpRoot}`,
              '-c', 'mcp_servers.workbench.enabled=true',
              '-c', 'mcp_servers.workbench.required=true',
              '-c', 'mcp_servers.workbench.startup_timeout_sec=10',
              '-c', 'mcp_servers.workbench.tool_timeout_sec=30',
              '-c', 'mcp_servers.workbench.default_tools_approval_mode=approve',
              '-c', `mcp_servers.workbench.env.WORKBENCH_MCP_CREDENTIAL_FILE=${path.join(process.env.HOME || '', '.buildflow', 'codex-workbench-mcp.token')}`,
              '-c', 'mcp_servers.workbench.env.WORKBENCH_MCP_ALLOWED_TOOLS="getWorkbenchStatus,readWorkbenchContext,runWorkbenchCommand"',
              '-c', `mcp_servers.workbench.env.WORKBENCH_MCP_ALLOWED_COMMAND_KINDS=${JSON.stringify(Array.from(new Set((input.contract.goalDispatch?.commands || []).map(item => item.commandKind))).join(','))}`
            ]
          : []
        const args = input.isolation === 'read_only'
          ? [
              'exec', '--ignore-user-config', '--approve-for-me',
              '-c', `mcp_servers.workbench.command=${process.execPath}`,
              '-c', `mcp_servers.workbench.args=${JSON.stringify([path.join(mcpRoot, 'packages/mcp/dist/server.js')])}`,
              '-c', `mcp_servers.workbench.cwd=${mcpRoot}`,
              '-c', 'mcp_servers.workbench.enabled=true',
              '-c', 'mcp_servers.workbench.required=true',
              '-c', 'mcp_servers.workbench.startup_timeout_sec=10',
              '-c', 'mcp_servers.workbench.tool_timeout_sec=30',
              '-c', 'mcp_servers.workbench.default_tools_approval_mode=writes',
              '-c', `mcp_servers.workbench.env.WORKBENCH_MCP_CREDENTIAL_FILE=${path.join(process.env.HOME || '', '.buildflow', 'codex-workbench-mcp.token')}`,
              '--json', '--ephemeral', '-C', prepared.binding.repositoryRoot
            ]
          : ['exec', ...mutationMcpArgs, '--json', '--ephemeral', '--sandbox', 'workspace-write', '-C', prepared.binding.repositoryRoot]
        child = spawnProcess(command, args, { cwd: prepared.binding.repositoryRoot, shell: false, stdio: ['pipe', 'pipe', 'pipe'] })
      } catch (error) {
        const failed = transition(options, submitted, 'failed')
        updateControls(options, failed, { operationId: failed.operationId, expectedRevision: failed.revision, reconciliation: 'matched', evidence: { operationId: failed.operationId, packetId: failed.packetId, resultStatus: 'failed', validationState: 'failed', reasonCode: 'spawn_failed' }, now: (options.now || (() => new Date()))().toISOString() })
        return { ok: false, reason: error instanceof Error ? error.message : 'Codex CLI could not be started.' }
      }
      const execution: ActiveCodexExecution = { input, operation: submitted, intent, acknowledgement, child, providerOperationIdentity, startedAt: Date.now(), stdout: '', stdoutRemainder: '', stderr: '', changedPaths: [], validationEvidence: [], mcpToolCalls: [], sawAgentMessage: false, cancellationRequested: false, settled: false }
      active.set(submitted.operationId, execution)
      emitLifecycle(options, execution, 'submitted')
      start(execution)
      try { child.stdin?.end(renderCodexPrompt(input.contract)) } catch { void finalize(execution, 'ambiguous') }
      return { ok: true, operation: submitted, providerOperationIdentity }
    },
    statusReadback: operationId => {
      const running = active.get(operationId)
      if (running) {
        const lifecycle = running.operation.lifecycle === 'submitted' ? 'submitted' : 'running'
        return { operation: running.operation, providerStatus: providerStatus(running, lifecycle, (options.now || (() => new Date()))().toISOString()), ...(running.result ? { result: running.result } : {}) }
      }
      const operation = getPersistedDelegationOperation(operationId, options.storeOptions)
      if (!operation) return undefined
      return { operation, ...(results.has(operationId) ? { result: results.get(operationId) } : {}) }
    },
    cancel: operationId => {
      const execution = active.get(operationId)
      if (!execution) return { ok: false, reason: 'No active Codex process is available; reconcile the persisted operation.' }
      if (execution.operation.lifecycle !== 'submitted' && execution.operation.lifecycle !== 'running') return { ok: false, reason: `Codex operation is ${execution.operation.lifecycle}.` }
      try {
        execution.operation = transition(options, execution.operation, 'cancellation_requested')
        execution.cancellationRequested = true
        emitLifecycle(options, execution, 'cancellation_requested')
        execution.child.kill('SIGTERM')
        return { ok: true, operation: execution.operation }
      } catch (error) { return { ok: false, reason: error instanceof Error ? error.message : 'Codex cancellation failed.' } }
    },
    reconcile: operationId => {
      const activeExecution = active.get(operationId)
      if (activeExecution) return { operation: activeExecution.operation, ...(activeExecution.result ? { result: activeExecution.result } : {}) }
      const operation = getPersistedDelegationOperation(operationId, options.storeOptions)
      if (!operation) return undefined
      if (operation.lifecycle === 'submitted' || operation.lifecycle === 'running') {
        try {
          const ambiguous = transition(options, operation, 'ambiguous')
          const reconciled = updateControls(options, ambiguous, { operationId: ambiguous.operationId, expectedRevision: ambiguous.revision, reconciliation: 'ambiguous', now: (options.now || (() => new Date()))().toISOString() })
          return { operation: reconciled }
        } catch { return { operation } }
      }
      return { operation, ...(results.has(operationId) ? { result: results.get(operationId) } : {}) }
    },
    evidence: operationId => results.get(operationId)
  }
}
