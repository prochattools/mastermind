import type { KnowledgeSource, WriteMode } from '@mastermind/shared'

export type SystemHealth = 'healthy' | 'degraded' | 'offline'
export type SourceState = 'ready' | 'preparing' | 'unavailable' | 'stale'
export type WorkState = 'idle' | 'preparing' | 'reading' | 'changing' | 'validating' | 'working' | 'waiting' | 'blocked' | 'failed' | 'complete'
export type AuthorityState = 'read-only' | 'artifacts-only' | 'safe-writes'

export type StatusTone = 'neutral' | 'good' | 'warn' | 'bad'

export function getSystemHealth(agentConnected: boolean, hasError: boolean): SystemHealth {
  if (!agentConnected) return 'offline'
  return hasError ? 'degraded' : 'healthy'
}

export function getSystemHealthLabel(health: SystemHealth): string {
  return health === 'healthy' ? 'Local runtime available' : health === 'degraded' ? 'Local runtime needs attention' : 'Local runtime offline'
}

export function getSourceState(source: KnowledgeSource): SourceState {
  if (!source.enabled || source.indexStatus === 'failed' || source.indexStatus === 'disabled') return 'unavailable'
  if (source.indexStatus === 'indexing' || source.indexStatus === 'pending') return 'preparing'
  if (source.indexStatus === 'ready') return 'ready'
  return 'stale'
}

export function getSourceStateLabel(state: SourceState): string {
  return state === 'ready' ? 'Ready' : state === 'preparing' ? 'Preparing' : state === 'stale' ? 'Stale' : 'Unavailable'
}

export function getSourceStateTone(state: SourceState): StatusTone {
  return state === 'ready' ? 'good' : state === 'preparing' || state === 'stale' ? 'warn' : 'bad'
}

export function getAuthorityState(writeMode: WriteMode): AuthorityState {
  return writeMode === 'readOnly' ? 'read-only' : writeMode === 'artifactsOnly' ? 'artifacts-only' : 'safe-writes'
}

export function getAuthorityLabel(writeMode: WriteMode): string {
  return writeMode === 'readOnly' ? 'Read only' : writeMode === 'artifactsOnly' ? 'Artifacts only' : 'Safe writes'
}

export function getWorkStateLabel(state: WorkState): string {
  switch (state) {
    case 'idle': return 'Ready'
    case 'preparing': return 'Preparing'
    case 'reading': return 'Reading'
    case 'changing': return 'Making changes'
    case 'validating': return 'Validating'
    case 'working': return 'Working'
    case 'waiting': return 'Waiting for approval'
    case 'blocked': return 'Blocked'
    case 'failed': return 'Failed'
    case 'complete': return 'Complete'
  }
}

export function getWorkStateTone(state: WorkState): StatusTone {
  return state === 'complete' ? 'good' : state === 'waiting' || state === 'blocked' || state === 'preparing' ? 'warn' : state === 'failed' ? 'bad' : 'neutral'
}

export function getWorkState(status: string, currentPosition = '', activeTaskStatus?: string): WorkState {
  switch (status) {
    case 'queued': return 'preparing'
    case 'needs_confirmation': return 'waiting'
    case 'paused':
    case 'blocked': return 'blocked'
    case 'failed':
    case 'cancelled': return 'failed'
    case 'completed': return 'complete'
  }

  const position = currentPosition.toLowerCase()
  if (position.includes('validat') || position.includes('verify') || position.includes('test')) return 'validating'
  if (position.includes('prepar') || position.includes('index')) return 'preparing'
  if (position.includes('read') || position.includes('inspect') || position.includes('search')) return 'reading'
  if (position.includes('change') || position.includes('write') || position.includes('edit') || position.includes('implement')) return 'changing'
  if (status === 'running' || activeTaskStatus === 'running' || activeTaskStatus === 'pending') return 'working'
  return 'idle'
}
