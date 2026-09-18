import fs from 'node:fs'
import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import type { KnowledgeSource } from '@mastermind/shared'
import { getSourceIndexBinding } from './config'
import { getIndexRecord, type SourceIndexRecord } from './index-state'
import { INDEX_SCAN_EXCLUSION_VERSION, INDEX_SCAN_POLICY_ID, INDEX_SCAN_POLICY_VERSION, INDEX_SCHEMA_VERSION } from './index-scan-policy'
import { getSourceIndexPath } from '../utils/paths'

const GIT_TIMEOUT_MS = 2_000
const MAX_GIT_OUTPUT_BYTES = 1_024 * 1_024
const NOISE_DIRECTORIES = new Set(['.git', '.obsidian', 'node_modules', '.next', '.build', 'dist', 'build', 'coverage', '.cache', '.turbo', 'vendor', 'generated', '.pnpm-store', 'DerivedData'])

export type FreshnessRefreshRequest = {
  sourceId: string
  sourcePath: string
  observedRevision?: string
  observedBranchName?: string
  observedWorktreeIdentity?: string
  indexedRevision?: string
  operation: 'incremental' | 'full'
  changedPaths: string[]
  reasons: string[]
  fingerprint: string
}

export type SourceFreshnessInspection = {
  sourceId: string
  sourcePath: string
  fresh: boolean
  unavailable: boolean
  retryable: boolean
  request?: FreshnessRefreshRequest
}

function runGit(sourcePath: string, args: string[]): string | undefined {
  try {
    return execFileSync('/usr/bin/git', ['-C', sourcePath, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: GIT_TIMEOUT_MS,
      maxBuffer: MAX_GIT_OUTPUT_BYTES,
      shell: false,
      env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C' }
    })
  } catch {
    return undefined
  }
}

function meaningfulPath(value: string): boolean {
  const normalized = value.replace(/\\/g, '/').replace(/^\"|\"$/g, '').trim()
  if (!normalized || normalized === '.') return false
  if (normalized.split('/').some(part => NOISE_DIRECTORIES.has(part))) return false
  if (normalized.endsWith('.lock') || normalized.endsWith('~')) return false
  return true
}

function pathsFromGitOutput(output: string | undefined): string[] {
  if (!output) return []
  return Array.from(new Set(output.split('\0').map(item => item.trim()).filter(meaningfulPath)))
}

function statusPaths(sourcePath: string): string[] | undefined {
  const output = runGit(sourcePath, ['status', '--porcelain=v1', '-z', '--untracked-files=all'])
  if (output === undefined) return undefined
  const paths: string[] = []
  for (const record of output.split('\0')) {
    if (!record || record.startsWith('#')) continue
    const candidates = [record.slice(3), ...(record.includes(' -> ') ? record.split(' -> ').slice(1) : [])]
    for (const candidate of candidates) if (meaningfulPath(candidate)) paths.push(candidate)
  }
  return Array.from(new Set(paths)).sort()
}

function committedDelta(sourcePath: string, indexedRevision: string | undefined, observedRevision: string | undefined): string[] | undefined {
  if (!indexedRevision || !observedRevision || indexedRevision === observedRevision) return []
  const output = runGit(sourcePath, ['diff', '--name-only', '-z', '--diff-filter=ACDMRTUXB', `${indexedRevision}..${observedRevision}`])
  return output === undefined ? undefined : pathsFromGitOutput(output)
}

function canonicalSourcePath(sourcePath: string): string {
  try { return fs.realpathSync(sourcePath) } catch { return path.resolve(sourcePath) }
}

function sourcePathHash(sourcePath: string): string {
  const canonical = canonicalSourcePath(sourcePath)
  return crypto.createHash('sha256').update(canonical, 'utf8').digest('hex').slice(0, 32)
}

function hasPolicyDrift(record: SourceIndexRecord): boolean {
  return record.indexPolicyVersion !== INDEX_SCAN_POLICY_VERSION
    || record.indexExclusionVersion !== INDEX_SCAN_EXCLUSION_VERSION
    || record.indexPolicyIdentity !== INDEX_SCAN_POLICY_ID
    || record.indexSchemaVersion !== INDEX_SCHEMA_VERSION
    || !record.sourcePathIdentity
}

function indexArtifactIsUsable(sourceId: string): boolean {
  let handle: number | undefined
  try {
    const target = getSourceIndexPath(sourceId)
    const stat = fs.statSync(target)
    if (!stat.isFile() || stat.size < 2) return false
    handle = fs.openSync(target, 'r')
    const first = Buffer.alloc(1)
    const last = Buffer.alloc(1)
    fs.readSync(handle, first, 0, 1, 0)
    fs.readSync(handle, last, 0, 1, stat.size - 1)
    return first.toString('utf8') === '[' && last.toString('utf8') === ']'
  } catch {
    return false
  } finally {
    if (handle !== undefined) fs.closeSync(handle)
  }
}

export function inspectSourceFreshness(source: KnowledgeSource, record: SourceIndexRecord | undefined = getIndexRecord(source.id)): SourceFreshnessInspection {
  const sourcePath = canonicalSourcePath(source.path)
  if (!source.enabled || !fs.existsSync(sourcePath)) return { sourceId: source.id, sourcePath, fresh: false, unavailable: true, retryable: false }

  const binding = getSourceIndexBinding(source.id)
  if (!binding) return { sourceId: source.id, sourcePath, fresh: false, unavailable: true, retryable: false }
  if (!record || record.indexStatus === 'unknown' || record.indexStatus === 'disabled') {
    return {
      sourceId: source.id,
      sourcePath,
      fresh: false,
      unavailable: false,
      retryable: true,
      request: {
        sourceId: source.id,
        sourcePath,
        observedRevision: binding.sourceRevision,
        observedBranchName: binding.sourceBranchName,
        observedWorktreeIdentity: binding.sourceWorktreeIdentity,
        operation: 'full',
        changedPaths: [],
        reasons: ['initial_index'],
        fingerprint: `${binding.sourceRevision || 'unknown'}:${binding.sourceBranchName || 'unknown'}:full`
      }
    }
  }

  const changedPaths = new Set<string>()
  const reasons: string[] = []
  let deltaSupported = true
  if (record.sourceRevision !== binding.sourceRevision) {
    reasons.push('head_changed')
    const delta = committedDelta(source.path, record.sourceRevision, binding.sourceRevision)
    if (delta === undefined) deltaSupported = false
    else delta.forEach(item => changedPaths.add(item))
  }
  if (record.sourceBranchName !== binding.sourceBranchName) reasons.push('branch_changed')
  if (record.sourcePathIdentity !== sourcePathHash(source.path)) reasons.push('source_path_changed')
  if (record.sourceWorktreeIdentity !== binding.sourceWorktreeIdentity) {
    reasons.push('worktree_changed')
    const worktree = statusPaths(source.path)
    if (worktree === undefined) deltaSupported = false
    else worktree.forEach(item => changedPaths.add(item))
  }
  if (hasPolicyDrift(record)) reasons.push('index_policy_changed')
  if (source.availabilityStatus === 'stale') reasons.push('source_availability_changed')
  if (record.indexStatus === 'failed') reasons.push('previous_refresh_failed')
  if (record.indexStatus === 'ready' && !indexArtifactIsUsable(source.id)) reasons.push('index_artifact_corrupt')

  if (reasons.length === 0 && record.indexStatus === 'ready' && record.indexed === true) {
    return { sourceId: source.id, sourcePath, fresh: true, unavailable: false, retryable: false }
  }

  const forceFull = reasons.includes('source_path_changed') || reasons.includes('branch_changed') || reasons.includes('index_policy_changed') || reasons.includes('index_artifact_corrupt') || !record.sourceRevision || !binding.sourceRevision || !deltaSupported || changedPaths.size === 0
  const operation = forceFull ? 'full' : 'incremental'
  const sortedPaths = Array.from(changedPaths).sort()
  const fingerprint = [binding.sourceRevision || 'unknown', binding.sourceBranchName || 'unknown', binding.sourceWorktreeIdentity || 'unknown', operation, ...sortedPaths].join('|')
  return {
    sourceId: source.id,
    sourcePath,
    fresh: false,
    unavailable: false,
    retryable: record.indexStatus !== 'failed' || !record.retryAfterAt || Date.parse(record.retryAfterAt) <= Date.now(),
    request: {
      sourceId: source.id,
      sourcePath,
      observedRevision: binding.sourceRevision,
      observedBranchName: binding.sourceBranchName,
      observedWorktreeIdentity: binding.sourceWorktreeIdentity,
      indexedRevision: record.sourceRevision,
      operation,
      changedPaths: sortedPaths,
      reasons,
      fingerprint
    }
  }
}
