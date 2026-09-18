import type { KnowledgeSource } from '@mastermind/shared'
import type { DashboardJob, DashboardPacket, DashboardRuntimeEvent } from './types'
import { getSourceState, getWorkState, type SourceState, type WorkState } from './status'

export type ValidationState = 'validating' | 'passed' | 'failed' | 'unavailable' | 'cancelled'

export function sourceWorkflowState(source: KnowledgeSource): SourceState {
  return getSourceState(source)
}

export function runWorkflowState(job: DashboardJob): WorkState {
  return getWorkState(job.status, job.compactStatus.currentPosition, job.activeTask?.status)
}

export function validationWorkflowState(job: DashboardJob): ValidationState {
  const results = (job.packets || []).flatMap(packet => packet.validation)
  if (runWorkflowState(job) === 'validating') return 'validating'
  if (results.length === 0) return job.status === 'cancelled' ? 'cancelled' : 'unavailable'
  return results.every(result => result.status === 'completed' || result.exitCode === 0) ? 'passed' : 'failed'
}

export function latestPacketForJob(job: DashboardJob): DashboardPacket | undefined {
  return [...(job.packets || [])].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]
}

export function humanizeRuntimeEvent(event: DashboardRuntimeEvent) {
  const type = event.type.toLowerCase()
  const failed = type.includes('failed') || type.includes('error')
  const blocked = type.includes('blocked')
  const approval = type.includes('confirm') || type.includes('approval')
  const completed = type.includes('complete') || type.includes('finish')
  const paused = type.includes('pause')
  const containsTechnicalIdentity = /(?:sourceId|packetId|runId|taskId)=|\b[0-9a-f]{16,}\b/i.test(event.message)
  return {
    id: event.id,
    label: failed ? 'Run failed' : blocked ? 'Run blocked' : approval ? 'Waiting for approval' : completed ? 'Run complete' : paused ? 'Run paused' : 'Run updated',
    detail: containsTechnicalIdentity ? 'Technical run evidence was updated. Open Goal / Run for the related details.' : event.message,
    tone: failed ? 'bad' as const : blocked || approval || paused ? 'warn' as const : completed ? 'good' as const : 'neutral' as const,
    timestamp: event.createdAt
  }
}
