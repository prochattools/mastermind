import type { KnowledgeSource } from '@mastermind/shared'

import { getSourceState } from './status'

export type DashboardErrorKind = 'connection' | 'source' | 'work' | 'setup' | 'validation' | 'unknown'

export type DashboardErrorCopy = {
  kind: DashboardErrorKind
  title: string
  explanation: string
  consequence: string
  recovery: string
}

export type SetupStepState = 'ready' | 'preparing' | 'needs_attention' | 'pending' | 'informational'

export type SetupStep = {
  id: 'runtime' | 'source' | 'preparation' | 'chatgpt' | 'ready'
  title: string
  detail: string
  state: SetupStepState
  actionLabel?: string
}

export function classifyDashboardError(message: string): DashboardErrorKind {
  const value = message.toLowerCase()
  if (/validation|validate|check failed|test failed/.test(value)) return 'validation'
  if (/approval|blocked|\b(run|goal|task)\b|resume|cancel/.test(value)) return 'work'
  if (/source|repository|folder|index|branch/.test(value)) return 'source'
  if (/setup|configure|configuration|action|openapi|auth|token/.test(value)) return 'setup'
  if (/connect|offline|unreachable|network|fetch|agent|runtime|timeout/.test(value)) return 'connection'
  return 'unknown'
}

export function getDashboardErrorCopy(message: string): DashboardErrorCopy {
  const kind = classifyDashboardError(message)
  const copy: Record<DashboardErrorKind, Omit<DashboardErrorCopy, 'kind'>> = {
    connection: {
      title: 'Local runtime unavailable',
      explanation: 'Mastermind could not reach the local runtime just now.',
      consequence: 'Source and run state may be out of date until the runtime responds.',
      recovery: 'Refresh after checking that Mastermind is running locally.'
    },
    source: {
      title: 'Source needs attention',
      explanation: 'The selected repository or folder could not be prepared or read.',
      consequence: 'New work may lack current context until the Source is ready.',
      recovery: 'Review Sources, then re-index or choose another Source.'
    },
    work: {
      title: 'Work needs attention',
      explanation: 'The current Goal or Run cannot continue in its present state.',
      consequence: 'No further guarded work will advance until the state is resolved.',
      recovery: 'Open Goal / Run to review the blocker and supported next action.'
    },
    setup: {
      title: 'Setup needs attention',
      explanation: 'Mastermind is available, but part of the local or ChatGPT setup is incomplete.',
      consequence: 'Some workflow actions may remain unavailable until setup is finished.',
      recovery: 'Open Settings to review the remaining setup guidance.'
    },
    validation: {
      title: 'Validation needs attention',
      explanation: 'A recorded check did not confirm the expected result.',
      consequence: 'The work is not considered complete until the check is understood.',
      recovery: 'Open Goal / Run to inspect validation evidence before retrying.'
    },
    unknown: {
      title: 'Mastermind needs attention',
      explanation: 'The workspace reported a problem that needs review.',
      consequence: 'The affected state may not be safe to act on yet.',
      recovery: 'Open Settings or the related workflow surface for more detail.'
    }
  }
  return { kind, ...copy[kind] }
}

export function buildSetupSteps({
  agentConnected,
  sources,
  activeSources,
  error
}: {
  agentConnected: boolean
  sources: KnowledgeSource[]
  activeSources: KnowledgeSource[]
  error?: string | null
}): SetupStep[] {
  const readySources = sources.filter(source => getSourceState(source) === 'ready')
  const preparingSources = sources.filter(source => getSourceState(source) === 'preparing')
  const unavailableSources = sources.filter(source => getSourceState(source) === 'unavailable' || getSourceState(source) === 'stale')
  const activeReady = activeSources.some(source => getSourceState(source) === 'ready')
  const runtimeNeedsAttention = !agentConnected || Boolean(error && /connect|runtime|agent|offline|unreachable/i.test(error))

  return [
    {
      id: 'runtime',
      title: 'Local runtime',
      detail: runtimeNeedsAttention ? 'Mastermind is not reachable right now.' : 'Mastermind is running locally and ready to inspect workspace state.',
      state: runtimeNeedsAttention ? 'needs_attention' : 'ready',
      actionLabel: runtimeNeedsAttention ? 'Refresh' : undefined
    },
    {
      id: 'source',
      title: 'Choose a Source',
      detail: sources.length > 0 ? `${sources.length} Source${sources.length === 1 ? '' : 's'} configured. Select the one that should ground work.` : 'A Source is a repository, folder, or workspace Mastermind can work with.',
      state: sources.length > 0 ? 'ready' : 'pending',
      actionLabel: sources.length > 0 ? 'Review Sources' : 'Add a Source'
    },
    {
      id: 'preparation',
      title: 'Prepare the Source',
      detail: readySources.length > 0
        ? `${readySources.length} Source${readySources.length === 1 ? '' : 's'} ready. Reads stay bounded, and the repository remains authoritative.`
        : preparingSources.length > 0
          ? `${preparingSources.length} Source${preparingSources.length === 1 ? ' is' : 's are'} preparing. You can continue once indexing finishes.`
          : unavailableSources.length > 0
            ? 'A Source needs attention before it can ground new work.'
            : 'Add a Source to begin preparation.',
      state: readySources.length > 0 ? 'ready' : preparingSources.length > 0 ? 'preparing' : unavailableSources.length > 0 ? 'needs_attention' : 'pending',
      actionLabel: readySources.length > 0 ? undefined : 'Open Sources'
    },
    {
      id: 'chatgpt',
      title: 'Connect ChatGPT',
      detail: 'The canonical endpoint exposes five guarded Actions. This dashboard confirms the endpoint guidance, not external ChatGPT authentication.',
      state: 'informational'
    },
    {
      id: 'ready',
      title: 'Ready for a Goal',
      detail: agentConnected && activeReady ? 'Choose a Goal or Run. Reads are bounded, writes and commands are governed, and approval may be required.' : 'Select a ready Source before starting durable work.',
      state: agentConnected && activeReady ? 'ready' : 'pending',
      actionLabel: agentConnected && activeReady ? 'Open Goal / Run' : 'Review setup'
    }
  ]
}
