import fs from 'node:fs'
import path from 'node:path'
import type { DiscoveredRepository, KnowledgeSource, SourceDiscoveryTelemetry } from '@mastermind/shared'
import {
  discoverRepositories,
  getSourceDiscoverySettings,
  getSourcesSafe,
  isSourcePathAvailable
} from './config'
import {
  addRepository,
  refreshSourceMetadata,
  setSourceAvailability
} from './source-management'

export type AutomaticDiscoveryRun = {
  repositoriesDiscovered: number
  worktreesDiscovered: number
  sourcesRegistered: number
  metadataRefreshed: number
  sourcesUnavailable: number
  sourcesStale: number
  indexJobsQueued: number
  indexJobsSkipped: number
  errors: string[]
  telemetry: SourceDiscoveryTelemetry
  durationMs: number
}

export type AutomaticDiscoveryOptions = {
  enqueueIndex: (sourceId: string, sourcePath: string, reason: 'auto' | 'add') => boolean
  maxRegistrations?: number
  now?: () => Date
}

function canonicalPath(value: string): string {
  try {
    // Importing fs only for this small normalization keeps discovery decisions
    // independent of source ordering and resistant to symlink aliases.
    return fs.realpathSync(value)
  } catch {
    return path.resolve(value)
  }
}

function withinAnyRoot(sourcePath: string, roots: string[]): boolean {
  const candidate = canonicalPath(sourcePath)
  return roots.some(root => {
    const relative = path.relative(root, candidate)
    return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
  })
}

function metadataDiffers(source: KnowledgeSource, repository: DiscoveredRepository): boolean {
  return source.repoGroupId !== repository.repoGroupId
    || source.repoRoot !== repository.repoRoot
    || source.branchName !== repository.branchName
    || source.isGitWorktree !== repository.isGitWorktree
    || JSON.stringify(source.availableBranches || []) !== JSON.stringify(repository.availableBranches || [])
}

function sourceByPath(sources: KnowledgeSource[], sourcePath: string): KnowledgeSource | undefined {
  const canonical = canonicalPath(sourcePath)
  return sources.find(source => canonicalPath(source.path) === canonical)
}

/**
 * Reconcile the bounded discovery result into the existing source registry.
 * This function never removes a source and never mutates active selection.
 * Registration and index enqueue are idempotent at their respective layers.
 */
export function reconcileAutomaticRepositories(options: AutomaticDiscoveryOptions): AutomaticDiscoveryRun {
  const startedAt = Date.now()
  const errors: string[] = []
  const before = getSourcesSafe({ refreshGitMetadata: false })
  const result = discoverRepositories()
  const discoveredPaths = new Set(result.repositories.map(repository => canonicalPath(repository.path)))
  const settings = getSourceDiscoverySettings()
  const roots = settings.rootPaths ?? (settings.rootPath ? [settings.rootPath] : [])
  let sourcesRegistered = 0
  let metadataRefreshed = 0
  let sourcesUnavailable = 0
  let sourcesStale = 0
  let indexJobsQueued = 0
  let indexJobsSkipped = 0
  let registrationCount = 0

  const queueIfNeeded = (source: KnowledgeSource, force = false): void => {
    if (!source.enabled || !isSourcePathAvailable(source.path)) {
      indexJobsSkipped += 1
      return
    }
    const shouldQueue = force || source.indexStatus === 'pending' || source.indexStatus === 'unknown' || source.availabilityStatus === 'discovered'
    if (!shouldQueue || source.indexStatus === 'failed') {
      indexJobsSkipped += 1
      return
    }
    if (options.enqueueIndex(source.id, source.path, force ? 'add' : 'auto')) indexJobsQueued += 1
    else indexJobsSkipped += 1
  }

  for (const repository of result.repositories) {
    if (registrationCount >= Math.max(1, Math.min(options.maxRegistrations || 32, 200))) break
    let source = repository.sourceId
      ? before.find(candidate => candidate.id === repository.sourceId)
      : sourceByPath(before, repository.path)

    if (!source) {
      try {
        const added = addRepository(repository.path, repository.label, repository.id, { automatic: true })
        source = added.sources.find(candidate => canonicalPath(candidate.path) === canonicalPath(repository.path))
        if (source) {
          sourcesRegistered += 1
          registrationCount += 1
          queueIfNeeded(source, true)
        }
      } catch (error) {
        errors.push(`Could not register ${repository.label}: ${error instanceof Error ? error.message : String(error)}`)
      }
      continue
    }

    if (source.availabilityStatus === 'unavailable' || source.availabilityStatus === 'stale' || source.availabilityStatus === 'removed') {
      try {
        setSourceAvailability(source.id, undefined)
        source = getSourcesSafe({ refreshGitMetadata: false }).find(candidate => candidate.id === source!.id) || source
      } catch (error) {
        errors.push(`Could not clear discovery state for ${source.label}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }

    const changed = metadataDiffers(source, repository)
    if (changed) {
      try {
        const refreshed = refreshSourceMetadata(source.id, { startReindex: false })
        source = refreshed.source
        metadataRefreshed += 1
        if (refreshed.metadataChanged) queueIfNeeded(source, true)
      } catch (error) {
        errors.push(`Could not refresh ${source.label}: ${error instanceof Error ? error.message : String(error)}`)
      }
    } else {
      queueIfNeeded(source)
    }
  }

  // Preserve every registration and its historical identity. Missing paths are
  // unavailable; existing non-repositories are stale. A bounded scan that hit
  // a limit is not authoritative enough to classify absent paths.
  const authoritativeScan = result.telemetry.terminationReason === 'completed'
  for (const source of getSourcesSafe({ refreshGitMetadata: false })) {
    const isRepositorySource = source.type === 'repository' || Boolean(source.repoRoot || source.repoGroupId || source.isGitWorktree)
    if (!source.enabled || !isRepositorySource || !withinAnyRoot(source.path, roots)) continue
    const pathAvailable = isSourcePathAvailable(source.path)
    const discovered = discoveredPaths.has(canonicalPath(source.path))
    if (!pathAvailable) {
      sourcesUnavailable += 1
      try { setSourceAvailability(source.id, 'unavailable', 'Repository or worktree path is unavailable; historical source identity retained.') } catch (error) { errors.push(`Could not mark ${source.label} unavailable: ${error instanceof Error ? error.message : String(error)}`) }
    } else if (authoritativeScan && !discovered) {
      sourcesStale += 1
      try { setSourceAvailability(source.id, 'stale', 'Repository or worktree was not present in the latest bounded discovery scan.') } catch (error) { errors.push(`Could not mark ${source.label} stale: ${error instanceof Error ? error.message : String(error)}`) }
    }
  }

  return {
    repositoriesDiscovered: result.repositories.length,
    worktreesDiscovered: result.telemetry.worktreesDiscovered || result.repositories.filter(repository => repository.isGitWorktree === true).length,
    sourcesRegistered,
    metadataRefreshed,
    sourcesUnavailable,
    sourcesStale,
    indexJobsQueued,
    indexJobsSkipped,
    errors,
    telemetry: result.telemetry,
    durationMs: (options.now?.() || new Date()).getTime() - startedAt
  }
}
