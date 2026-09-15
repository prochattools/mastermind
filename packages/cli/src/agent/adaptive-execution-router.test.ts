import assert from 'node:assert/strict'
import test from 'node:test'
import { executeAdaptiveExecution, routeAdaptiveExecution } from './adaptive-execution-router'

test('native bounded work chooses Instant', () => {
  const decision = routeAdaptiveExecution({
    goal: 'Review README.md',
    sourceId: 'brain',
    codexAvailable: true
  })

  assert.equal(decision.selectedMode, 'direct')
  assert.equal(decision.selection.outcome, 'selected')
  assert.equal(decision.selection.profile, 'economy')
  assert.equal(decision.choice.title, 'Choose execution mode')
  assert.equal(decision.choice.options[0].label, '⚡ Instant')
})

test('complex multi-file work chooses Codex when available', () => {
  const decision = routeAdaptiveExecution({
    goal: 'Design the architecture for a large multi-file refactor across the repository',
    sourceId: 'brain',
    codexAvailable: true
  })

  assert.equal(decision.selectedMode, 'codex')
  assert.equal(decision.selection.outcome, 'selected')
  assert.equal(decision.selection.profile, 'frontier')
  assert.equal(decision.choice.recommended, 'codex')
  assert.equal(decision.choice.options[1].label, '🧠 Codex')
})

test('Codex unavailability falls back to Instant before execution', () => {
  const decision = routeAdaptiveExecution({
    goal: 'Design the architecture for a large multi-file refactor across the repository',
    sourceId: 'brain',
    codexAvailable: false
  })

  assert.equal(decision.selectedMode, 'direct')
  assert.equal(decision.selection.outcome, 'fallback')
  assert.equal(decision.selection.fallback.applied, true)
  assert.equal(decision.selection.fallback.from, 'codex')
  assert.equal(decision.selection.fallback.to, 'direct')
})

test('explicit Codex mode also falls back without launching a second executor', () => {
  const decision = routeAdaptiveExecution({
    goal: 'Review the repository architecture',
    sourceId: 'brain',
    requestedMode: 'codex',
    codexAvailable: false
  })

  assert.equal(decision.selectedMode, 'direct')
  assert.equal(decision.selection.outcome, 'fallback')
  assert.equal(decision.selection.fallback.from, 'codex')
  assert.equal(decision.selection.fallback.to, 'direct')
})

test('Instant requests do not pay the Codex capability probe cost', () => {
  let probes = 0
  const decision = routeAdaptiveExecution({
    goal: 'Run a quick repository status check',
    sourceId: 'brain',
    codexAvailable: () => {
      probes += 1
      return true
    }
  })

  assert.equal(decision.selectedMode, 'direct')
  assert.equal(probes, 0)
})

test('generic goal text still avoids the Codex probe when it selects Instant', () => {
  let probes = 0
  const decision = routeAdaptiveExecution({
    goal: 'Continue the roadmap with the next bounded implementation task',
    sourceId: 'brain',
    codexAvailable: () => {
      probes += 1
      return true
    }
  })

  assert.equal(decision.selectedMode, 'direct')
  assert.equal(probes, 0)
})

test('explicit Instant mode never probes or selects Codex', () => {
  let probes = 0
  const decision = routeAdaptiveExecution({
    goal: 'Design the architecture for a large multi-file refactor across the repository',
    sourceId: 'brain',
    requestedMode: 'direct',
    codexAvailable: () => {
      probes += 1
      return true
    }
  })

  assert.equal(decision.selectedMode, 'direct')
  assert.equal(probes, 0)
})

test('pre-acceptance Codex failure falls back once without replaying accepted work', async () => {
  const decision = routeAdaptiveExecution({
    goal: 'Design the architecture for a large multi-file refactor across the repository',
    sourceId: 'brain',
    codexAvailable: true
  })
  let codexAttempts = 0
  let directAttempts = 0
  const fallback = await executeAdaptiveExecution(decision, {
    codex: async () => {
      codexAttempts += 1
      return { status: 'failed', error: 'rate limited before submission', providerAccepted: false }
    },
    direct: async () => {
      directAttempts += 1
      return { status: 'completed', result: 'instant-result' }
    }
  })
  assert.deepEqual(fallback, { mode: 'direct', result: 'instant-result', fallbackApplied: true, attempts: ['codex', 'direct'] })
  assert.equal(codexAttempts, 1)
  assert.equal(directAttempts, 1)

  directAttempts = 0
  await assert.rejects(() => executeAdaptiveExecution(decision, {
    codex: async () => ({ status: 'failed', error: 'provider state is unknown', providerAccepted: true }),
    direct: async () => {
      directAttempts += 1
      return { status: 'completed', result: 'must-not-run' }
    }
  }), /without safe pre-acceptance fallback/)
  assert.equal(directAttempts, 0)
})
