import fs from 'fs'
import path from 'path'
import { execFileSync } from 'node:child_process'
import { getConfigDir } from '../utils/paths'
import type { WorkbenchPacketExecutionResult } from './workbench-packet-executor'
import { WorkbenchEvidenceMetadataSchema, type WorkbenchEvidenceMetadata } from '@mastermind/shared'
import type { WorkbenchEvidenceUnavailable } from './workbench-evidence-producers'
import type { WorkbenchExecutorResult } from '../../../mcp/dist/executor-broker.js'

export const WORKBENCH_PACKET_RESULT_STORE_VERSION = 1 as const

export type WorkbenchRepositoryState = {
  branchName?: string
  detached: boolean
  dirty: boolean
  upstreamKnown: boolean
  ahead?: number
  behind?: number
  divergence: 'up_to_date' | 'ahead' | 'behind' | 'diverged' | 'unknown'
}

export type WorkbenchPacketCompactResult = {
  version: typeof WORKBENCH_PACKET_RESULT_STORE_VERSION
  packetId: string
  runId: string
  sourceId: string
  status: 'completed' | 'failed' | 'rejected' | 'paused' | 'cancelled' | 'requeued'
  writesPerformed: boolean
  rolledBack: boolean
  completedSteps: number
  changedPaths: string[]
  failedStep?: number
  planHash?: string
  validation: Array<{
    commandKind: string
    status: string
    exitCode: number | null
    durationMs: number
    evidenceRefs?: WorkbenchEvidenceMetadata[]
    evidenceUnavailable?: WorkbenchEvidenceUnavailable
  }>
  readEvidence: Array<{ mode: string; path: string; matches?: number; lines?: number }>
  commandEvidence: Array<{ commandKind: string; status: string; exitCode: number | null; durationMs: number }>
  commitHash?: string
  repositoryState?: WorkbenchRepositoryState
  executorResult?: WorkbenchExecutorResult
  errors: Array<{ code: string; message: string; path?: string }>
  recordedAt: string
}

type WorkbenchPacketResultStore = {
  version: typeof WORKBENCH_PACKET_RESULT_STORE_VERSION
  updatedAt: string
  results: WorkbenchPacketCompactResult[]
}

const RESULT_STORE_PATH = path.join(getConfigDir(), 'workbench-packet-results.json')
const MAX_PACKET_RESULTS = 500
const MAX_ERRORS = 5
const MAX_ERROR_MESSAGE_LENGTH = 240

function emptyStore(): WorkbenchPacketResultStore {
  return {
    version: WORKBENCH_PACKET_RESULT_STORE_VERSION,
    updatedAt: new Date().toISOString(),
    results: []
  }
}

function compactMessage(value: string): string {
  const cleaned = String(value || '').replace(/\s+/g, ' ').trim()
  return cleaned.length > MAX_ERROR_MESSAGE_LENGTH
    ? `${cleaned.slice(0, MAX_ERROR_MESSAGE_LENGTH - 3)}...`
    : cleaned
}

function repositoryState(sourceRoot?: string): WorkbenchRepositoryState | undefined {
  if (!sourceRoot) return undefined
  try {
    const output = execFileSync('git', ['status', '--porcelain=v1', '--branch'], {
      cwd: sourceRoot,
      encoding: 'utf8',
      timeout: 3_000,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    const lines = output.split(/\r?\n/).filter(Boolean)
    const header = lines.shift() || ''
    const branchMatch = header.match(/^## (.+?)(?:\.\.\.([^\s]+))?(?: \[([^\]]+)\])?$/)
    const branchValue = branchMatch?.[1]?.trim()
    const detached = !branchValue || branchValue === 'HEAD' || branchValue.startsWith('HEAD ')
    const branchName = detached ? undefined : branchValue
    const upstreamKnown = Boolean(branchMatch?.[2])
    const tracking = branchMatch?.[3] || ''
    const ahead = tracking.match(/(?:^|, )ahead (\d+)/)?.[1]
    const behind = tracking.match(/(?:^|, )behind (\d+)/)?.[1]
    const aheadCount = ahead === undefined ? 0 : Number(ahead)
    const behindCount = behind === undefined ? 0 : Number(behind)
    const divergence = !upstreamKnown
      ? 'unknown'
      : aheadCount > 0 && behindCount > 0
        ? 'diverged'
        : aheadCount > 0
          ? 'ahead'
          : behindCount > 0
            ? 'behind'
            : 'up_to_date'
    return {
      ...(branchName ? { branchName } : {}),
      detached,
      dirty: lines.length > 0,
      upstreamKnown,
      ...(ahead !== undefined ? { ahead: aheadCount } : {}),
      ...(behind !== undefined ? { behind: behindCount } : {}),
      divergence
    }
  } catch {
    return {
      detached: true,
      dirty: true,
      upstreamKnown: false,
      divergence: 'unknown'
    }
  }
}

function readStore(): WorkbenchPacketResultStore {
  try {
    if (!fs.existsSync(RESULT_STORE_PATH)) return emptyStore()
    const parsed = JSON.parse(fs.readFileSync(RESULT_STORE_PATH, 'utf8')) as Partial<WorkbenchPacketResultStore>
    return {
      version: WORKBENCH_PACKET_RESULT_STORE_VERSION,
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : new Date().toISOString(),
      results: Array.isArray(parsed.results)
        ? parsed.results.filter(isCompactResult).slice(-MAX_PACKET_RESULTS)
        : []
    }
  } catch {
    return emptyStore()
  }
}

function isCompactResult(value: unknown): value is WorkbenchPacketCompactResult {
  if (!value || typeof value !== 'object') return false
  const item = value as Partial<WorkbenchPacketCompactResult>
  return item.version === WORKBENCH_PACKET_RESULT_STORE_VERSION
    && typeof item.packetId === 'string'
    && typeof item.runId === 'string'
    && typeof item.sourceId === 'string'
    && typeof item.status === 'string'
    && typeof item.recordedAt === 'string'
    && (item.validation === undefined || (Array.isArray(item.validation) && item.validation.every(validation => Array.isArray(validation.evidenceRefs) ? validation.evidenceRefs.every(ref => WorkbenchEvidenceMetadataSchema.safeParse(ref).success) : true)))
}

function persistStore(store: WorkbenchPacketResultStore): void {
  fs.mkdirSync(path.dirname(RESULT_STORE_PATH), { recursive: true })
  const payload: WorkbenchPacketResultStore = {
    version: WORKBENCH_PACKET_RESULT_STORE_VERSION,
    updatedAt: new Date().toISOString(),
    results: store.results
      .sort((a, b) => a.recordedAt.localeCompare(b.recordedAt))
      .slice(-MAX_PACKET_RESULTS)
  }
  const temporaryPath = `${RESULT_STORE_PATH}.tmp`
  fs.writeFileSync(temporaryPath, JSON.stringify(payload), 'utf8')
  fs.renameSync(temporaryPath, RESULT_STORE_PATH)
}

export function recordWorkbenchPacketResult(params: {
  packetId: string
  runId: string
  sourceId: string
  status: WorkbenchPacketCompactResult['status']
  sourceRoot?: string
  execution?: WorkbenchPacketExecutionResult
  executorResult?: WorkbenchExecutorResult
  error?: string
}): WorkbenchPacketCompactResult {
  const execution = params.execution
  const result: WorkbenchPacketCompactResult = {
    version: WORKBENCH_PACKET_RESULT_STORE_VERSION,
    packetId: params.packetId,
    runId: params.runId,
    sourceId: params.sourceId,
    status: params.status,
    writesPerformed: execution?.writesPerformed === true,
    rolledBack: execution?.rolledBack === true,
    completedSteps: Math.max(0, Number(execution?.completedSteps || 0)),
    changedPaths: Array.from(new Set(execution?.changedPaths || [])).slice(0, 32),
    failedStep: execution?.failedStep,
    planHash: execution?.planHash,
    validation: (execution?.validationResults || []).slice(0, 3).map(item => ({
      commandKind: item.commandKind,
      status: item.status,
      exitCode: item.exitCode,
      durationMs: item.durationMs,
      evidenceRefs: item.evidenceRefs,
      evidenceUnavailable: item.evidenceUnavailable
    })),
    readEvidence: (execution?.readEvidence || []).slice(0, 5).map(item => ({ ...item })),
    commandEvidence: (execution?.commandEvidence || []).slice(0, 3).map(item => ({ ...item })),
    commitHash: execution?.commitHash,
    repositoryState: repositoryState(params.sourceRoot),
    ...(params.executorResult ? { executorResult: params.executorResult } : {}),
    errors: [
      ...(execution?.errors || []),
      ...(params.error ? [{ code: 'PACKET_WORKER_ERROR', message: params.error }] : [])
    ].slice(0, MAX_ERRORS).map(item => ({
      code: String(item.code || 'PACKET_ERROR'),
      message: compactMessage(item.message),
      path: item.path
    })),
    recordedAt: new Date().toISOString()
  }

  const store = readStore()
  store.results = store.results.filter(item => item.packetId !== params.packetId)
  store.results.push(result)
  persistStore(store)
  return result
}

export function getWorkbenchPacketResult(packetId: string): WorkbenchPacketCompactResult | undefined {
  return readStore().results.find(item => item.packetId === packetId)
}
