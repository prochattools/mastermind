import { normalizeNaturalLanguageRequest, type NormalizationContext, type NormalizedRequestIntent } from './request-normalization'
import { selectExecutionPlan, type ExecutionSelectionCapability, type ExecutionSelectionResult } from './execution-selection'

export type AdaptiveExecutionMode = 'auto' | 'direct' | 'codex'

export type AdaptiveExecutionChoice = {
  title: 'Choose execution mode'
  recommended: 'direct' | 'codex'
  options: [
    { id: 'direct'; label: '⚡ Instant'; description: 'Fast local execution' },
    { id: 'codex'; label: '🧠 Codex'; description: 'Deep reasoning' }
  ]
}

export type AdaptiveExecutionDecision = {
  requestedMode: AdaptiveExecutionMode
  selectedMode: 'direct' | 'codex'
  selection: ExecutionSelectionResult
  request: NormalizedRequestIntent
  codexAvailable: boolean
  choice: AdaptiveExecutionChoice
}

export type AdaptiveExecutionRouterInput = {
  goal: string
  requestedMode?: AdaptiveExecutionMode
  sourceId?: string
  context?: NormalizationContext
  codexAvailable?: boolean | (() => boolean)
}

export type AdaptiveExecutionAttempt<T> =
  | { status: 'completed'; result: T }
  | { status: 'failed'; error: string; providerAccepted: boolean }

export type AdaptiveExecutionRunners<T> = {
  direct: () => Promise<AdaptiveExecutionAttempt<T>> | AdaptiveExecutionAttempt<T>
  codex: () => Promise<AdaptiveExecutionAttempt<T>> | AdaptiveExecutionAttempt<T>
}

export type AdaptiveExecutionResult<T> = {
  mode: 'direct' | 'codex'
  result: T
  fallbackApplied: boolean
  attempts: Array<'direct' | 'codex'>
}

function capabilities(codexAvailable: boolean): ExecutionSelectionCapability[] {
  return [
    {
      engine: 'direct',
      available: true,
      supportedProfiles: ['economy', 'balanced', 'frontier'],
      supportsBoundedPackets: true,
      supportsLargePackets: true,
      supportsMultiStep: true,
      supportsProtectedPaths: true
    },
    {
      engine: 'codex',
      available: codexAvailable,
      supportedProfiles: ['economy', 'balanced', 'frontier'],
      supportsBoundedPackets: true,
      supportsLargePackets: true,
      supportsMultiStep: true,
      supportsProtectedPaths: true
    },
    {
      engine: 'future_adapter',
      available: false,
      placeholder: true,
      supportedProfiles: ['frontier'],
      supportsBoundedPackets: true,
      supportsLargePackets: true,
      supportsMultiStep: true,
      supportsProtectedPaths: true
    },
    {
      engine: 'human',
      available: true,
      supportedProfiles: ['frontier'],
      supportsBoundedPackets: true,
      supportsLargePackets: true,
      supportsMultiStep: true,
      supportsProtectedPaths: true
    }
  ]
}

function selectedMode(selection: ExecutionSelectionResult): 'direct' | 'codex' {
  return selection.engine === 'codex' ? 'codex' : 'direct'
}

export function routeAdaptiveExecution(input: AdaptiveExecutionRouterInput): AdaptiveExecutionDecision {
  const requestedMode = input.requestedMode || 'auto'
  const request = normalizeNaturalLanguageRequest({
    text: input.goal,
    context: {
      ...input.context,
      ...(input.sourceId && !input.context?.activeSourceId ? { activeSourceId: input.sourceId } : {}),
      ...(input.sourceId && !input.context?.availableSources ? { availableSources: [{ id: input.sourceId, active: true }] } : {})
    }
  })
  const shouldProbeCodex = requestedMode !== 'direct' && (
    requestedMode === 'codex'
      || request.execution.engine === 'codex'
  )
  const codexAvailable = shouldProbeCodex
    ? typeof input.codexAvailable === 'function' ? input.codexAvailable() : input.codexAvailable === true
    : false
  const preferredEngine = requestedMode === 'auto'
    ? request.execution.engine === 'codex' ? 'codex' as const : undefined
    : requestedMode
  const selection = selectExecutionPlan({
    request,
    capabilities: capabilities(codexAvailable),
    ...(preferredEngine ? { preferredEngine } : {}),
    fallbackMode: requestedMode === 'direct' ? 'reject' : 'fallback'
  })
  const recommended = selectedMode(selection)
  return {
    requestedMode,
    selectedMode: recommended,
    selection,
    request,
    codexAvailable,
    choice: {
      title: 'Choose execution mode',
      recommended,
      options: [
        { id: 'direct', label: '⚡ Instant', description: 'Fast local execution' },
        { id: 'codex', label: '🧠 Codex', description: 'Deep reasoning' }
      ]
    }
  }
}

function canAutoFallbackToInstant(decision: AdaptiveExecutionDecision): boolean {
  return !decision.selection.requirements.requiresHuman
    && !decision.selection.requirements.requiresProtectedPaths
}

/**
 * Execute exactly one selected path. A Codex fallback is legal only when the
 * provider failed before accepting the packet; an accepted or unknown state is
 * terminal for automatic routing so the same work is never replayed locally.
 */
export async function executeAdaptiveExecution<T>(
  decision: AdaptiveExecutionDecision,
  runners: AdaptiveExecutionRunners<T>
): Promise<AdaptiveExecutionResult<T>> {
  if (decision.selectedMode === 'direct') {
    const direct = await runners.direct()
    if (direct.status === 'completed') return { mode: 'direct', result: direct.result, fallbackApplied: false, attempts: ['direct'] }
    throw new Error(`Instant execution failed: ${direct.error}`)
  }

  const codex = await runners.codex()
  if (codex.status === 'completed') return { mode: 'codex', result: codex.result, fallbackApplied: false, attempts: ['codex'] }
  if (codex.providerAccepted || !canAutoFallbackToInstant(decision)) {
    throw new Error(`Codex execution failed without safe pre-acceptance fallback: ${codex.error}`)
  }

  const direct = await runners.direct()
  if (direct.status === 'completed') return { mode: 'direct', result: direct.result, fallbackApplied: true, attempts: ['codex', 'direct'] }
  throw new Error(`Codex execution failed and Instant fallback failed: ${direct.error}`)
}
