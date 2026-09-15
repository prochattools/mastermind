import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { dispatchPortableOperation } from '../../../../apps/web/src/lib/actions/portable-operation-dispatcher'
import { createNativeIngress } from '../../../../scripts/native-http-ingress'
import type { CodexDelegationAdapter } from './external-delegation-adapter'

test('production host preserves read-to-command session authority across runtimes and recovery', async () => {
  const priorConfigDir = process.env.WORKBENCH_CONFIG_DIR
  const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'workbench-session-regression-config-'))
  const sourceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'workbench-session-regression-source-'))
  const explicitSourceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'workbench-session-regression-explicit-source-'))
  const focusedWorkspacePath = path.join(configDir, 'focused-workspace.json')
  const sourceId = 'fixture-source'
  const explicitSourceId = 'fixture-explicit-source'
  const priorFocusedWorkspacePath = process.env.WORKBENCH_FOCUSED_WORKSPACE_PATH
  process.env.WORKBENCH_CONFIG_DIR = configDir
  process.env.WORKBENCH_FOCUSED_WORKSPACE_PATH = focusedWorkspacePath

  try {
    execFileSync('git', ['init', '-q'], { cwd: sourceRoot })
    execFileSync('git', ['config', 'user.email', 'session-regression@example.invalid'], { cwd: sourceRoot })
    execFileSync('git', ['config', 'user.name', 'Session Regression'], { cwd: sourceRoot })
    fs.writeFileSync(path.join(sourceRoot, 'README.md'), '# session regression\n', 'utf8')
    execFileSync('git', ['add', 'README.md'], { cwd: sourceRoot })
    execFileSync('git', ['commit', '-qm', 'fixture: session regression'], { cwd: sourceRoot })
    execFileSync('git', ['init', '-q'], { cwd: explicitSourceRoot })
    execFileSync('git', ['config', 'user.email', 'session-regression@example.invalid'], { cwd: explicitSourceRoot })
    execFileSync('git', ['config', 'user.name', 'Session Regression'], { cwd: explicitSourceRoot })
    fs.writeFileSync(path.join(explicitSourceRoot, 'README.md'), '# explicit source regression\n', 'utf8')
    execFileSync('git', ['add', 'README.md'], { cwd: explicitSourceRoot })
    execFileSync('git', ['commit', '-qm', 'fixture: explicit source regression'], { cwd: explicitSourceRoot })
    fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({
      userId: 'session-regression',
      deviceId: 'session-regression-device',
      deviceToken: 'session-regression-token',
      apiBaseUrl: 'http://127.0.0.1:1',
      mode: 'read_create_append',
      allowedExtensions: [],
      ignorePatterns: [],
      activeSourcesMode: 'single',
      activeSourceIds: [sourceId],
      sources: [
        { id: sourceId, label: 'Focused fixture', path: sourceRoot, enabled: true },
        { id: explicitSourceId, label: 'Explicit fixture', path: explicitSourceRoot, enabled: true }
      ]
    }), 'utf8')
    fs.writeFileSync(focusedWorkspacePath, JSON.stringify({
      version: 1,
      sourceId,
      sourcePath: sourceRoot,
      updatedAt: new Date().toISOString()
    }), 'utf8')

    const { createPortableHostHandlers } = await import('../../../../scripts/portable-host-handlers')
    const sessionOptions = { rootDir: configDir }
    const productionHandlers = createPortableHostHandlers()
    const readHandler = productionHandlers.readWorkbenchContext
    const commandHandler = productionHandlers.runWorkbenchCommand
    assert.ok(readHandler, 'readWorkbenchContext handler must be available')
    assert.ok(commandHandler, 'runWorkbenchCommand handler must be available')

    const read = await readHandler!({ mode: 'list_files', sourceId, limit: 1 }, { sourceId, requestId: 'session-regression-read' }) as Record<string, unknown>
    const workbenchRun = read.workbenchRun as { sessionId?: unknown }
    assert.equal(typeof workbenchRun.sessionId, 'string')
    const sessionId = workbenchRun.sessionId as string
    assert.equal((read.workbenchRun as { sourceId?: unknown }).sourceId, sourceId)

    const command = (commandKind: string, requestId: string) => commandHandler!({
      version: 2,
      sessionId,
      command: { sourceId, commandKind }
    }, { sourceId, sessionId, requestId })
    const first = await command('git_status_short', 'session-regression-command-1') as Record<string, unknown>
    const second = await command('git_branch_current', 'session-regression-command-2') as Record<string, unknown>
    const third = await command('git_log_latest', 'session-regression-command-3') as Record<string, unknown>

    assert.deepEqual({
      first: { status: first.status },
      second: { status: second.status },
      third: { status: third.status }
    }, {
      first: { status: 'completed' },
      second: { status: 'completed' },
      third: { status: 'completed' }
    })

    const { getWorkbenchSession } = await import('./workbench-session-store')
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const repeated = await command('git_status_short', `session-regression-repeat-${attempt}`) as Record<string, unknown>
      assert.equal(repeated.status, 'completed')
      const session = getWorkbenchSession(sessionId, sessionOptions)
      assert.ok(session && !('ok' in session))
      assert.equal(session.status, 'active')
      assert.equal(session.activeRunId, (read.workbenchRun as { runId?: unknown }).runId)
      assert.deepEqual(session.lockedSourceIds, [sourceId])
    }

    const explicitRead = await readHandler!({ mode: 'list_files', sourceId: explicitSourceId, limit: 1 }, { sourceId: explicitSourceId, requestId: 'session-regression-explicit-read' }) as Record<string, unknown>
    const explicitRun = explicitRead.workbenchRun as { sessionId?: unknown; sourceId?: unknown }
    assert.equal(explicitRun.sourceId, explicitSourceId)
    assert.equal(typeof explicitRun.sessionId, 'string')
    const explicitCommand = await commandHandler!({
      version: 2,
      sessionId: explicitRun.sessionId,
      command: { sourceId: explicitSourceId, commandKind: 'git_status_short' }
    }, { sourceId: explicitSourceId, sessionId: explicitRun.sessionId as string, requestId: 'session-regression-explicit-command' }) as Record<string, unknown>
    assert.equal(explicitCommand.status, 'completed')

    const dispatchCommand = (requestId: string, requestSourceId: string | undefined, requestSessionId: string | undefined, payload: Record<string, unknown>) => dispatchPortableOperation({
      protocolVersion: 1,
      requestId,
      operationId: 'runWorkbenchCommand',
      deadlineAt: new Date(Date.now() + 10_000).toISOString(),
      ...(requestSourceId ? { sourceId: requestSourceId } : {}),
      ...(requestSessionId ? { sessionId: requestSessionId } : {}),
      payload
    }, productionHandlers)

    const wrongSource = await dispatchCommand('session-regression-wrong-source', sourceId, sessionId, {
      version: 2,
      sessionId,
      command: { sourceId: explicitSourceId, commandKind: 'git_status_short' }
    })
    assert.equal(wrongSource.ok, false)
    assert.equal(wrongSource.error?.code, 'source_mismatch')

    const wrongSession = await dispatchCommand('session-regression-wrong-session', sourceId, sessionId, {
      version: 2,
      sessionId: 'session-does-not-exist',
      command: { sourceId, commandKind: 'git_status_short' }
    })
    assert.equal(wrongSession.ok, false)
    assert.equal(wrongSession.error?.code, 'session_invalid')

    const missingSession = await dispatchCommand('session-regression-missing-session', sourceId, undefined, {
      version: 2,
      command: { sourceId, commandKind: 'git_status_short' }
    })
    assert.equal(missingSession.ok, false)
    assert.equal(missingSession.error?.code, 'session_invalid')

    const invalidSession = await dispatchCommand('session-regression-invalid-session', sourceId, 'session-does-not-exist', {
      version: 2,
      sessionId: 'session-does-not-exist',
      command: { sourceId, commandKind: 'git_status_short' }
    })
    assert.equal(invalidSession.ok, false)
    assert.equal(invalidSession.error?.code, 'session_invalid')

    const { updateAgentJob } = await import('./agent-jobs')
    updateAgentJob((read.workbenchRun as { runId: string }).runId, { status: 'paused' })
    const recoveredRead = await readHandler!({ mode: 'list_files', sourceId, limit: 1 }, { sourceId, requestId: 'session-regression-recovery-read' }) as Record<string, unknown>
    const recoveredRun = recoveredRead.workbenchRun as { sessionId?: unknown; runId?: unknown }
    assert.equal(typeof recoveredRun.sessionId, 'string')
    assert.notEqual(recoveredRun.sessionId, sessionId)
    assert.notEqual(recoveredRun.runId, (read.workbenchRun as { runId?: unknown }).runId)
    const recoveredCommand = await commandHandler!({
      version: 2,
      sessionId: recoveredRun.sessionId,
      command: { sourceId, commandKind: 'git_status_short' }
    }, { sourceId, sessionId: recoveredRun.sessionId as string, requestId: 'session-regression-recovery-command' }) as Record<string, unknown>
    assert.equal(recoveredCommand.status, 'completed')
    const oldSession = getWorkbenchSession(sessionId, sessionOptions)
    assert.ok(oldSession && !('ok' in oldSession))
    assert.equal(oldSession.status, 'paused')

    const childScript = `
      import { createPortableHostHandlers } from './scripts/portable-host-handlers.ts'
      void (async () => {
        const sourceId = process.env.WORKBENCH_SESSION_SOURCE_ID
        const sessionId = process.env.WORKBENCH_SESSION_ID
        const handlers = createPortableHostHandlers()
        const result = await handlers.runWorkbenchCommand({
          version: 2,
          sessionId,
          command: { sourceId, commandKind: 'git_branch_current' }
        }, { sourceId, sessionId, requestId: 'session-regression-reconstructed-command' })
        console.log(JSON.stringify(result))
      })()
    `
    const childOutput = execFileSync(path.join(process.cwd(), 'packages/cli/node_modules/.bin/tsx'), ['-e', childScript], {
      cwd: process.cwd(),
      env: { ...process.env, WORKBENCH_CONFIG_DIR: configDir, WORKBENCH_FOCUSED_WORKSPACE_PATH: focusedWorkspacePath, WORKBENCH_SESSION_SOURCE_ID: sourceId, WORKBENCH_SESSION_ID: recoveredRun.sessionId as string },
      encoding: 'utf8'
    }).trim()
    const reconstructed = JSON.parse(childOutput) as Record<string, unknown>
    assert.equal(reconstructed.status, 'completed')
  } finally {
    if (priorConfigDir === undefined) delete process.env.WORKBENCH_CONFIG_DIR
    else process.env.WORKBENCH_CONFIG_DIR = priorConfigDir
    if (priorFocusedWorkspacePath === undefined) delete process.env.WORKBENCH_FOCUSED_WORKSPACE_PATH
    else process.env.WORKBENCH_FOCUSED_WORKSPACE_PATH = priorFocusedWorkspacePath
    fs.rmSync(configDir, { recursive: true, force: true })
    fs.rmSync(sourceRoot, { recursive: true, force: true })
    fs.rmSync(explicitSourceRoot, { recursive: true, force: true })
  }
})

test('native ingress preserves the public v2 command contract and error classes', async () => {
  const priorConfigDir = process.env.WORKBENCH_CONFIG_DIR
  const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'workbench-native-contract-config-'))
  const sourceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'workbench-native-contract-source-'))
  const sourceId = 'fixture-native-contract'
  let ingress: ReturnType<typeof createNativeIngress> | undefined
  process.env.WORKBENCH_CONFIG_DIR = configDir

  try {
    execFileSync('git', ['init', '-q'], { cwd: sourceRoot })
    execFileSync('git', ['config', 'user.email', 'native-contract@example.invalid'], { cwd: sourceRoot })
    execFileSync('git', ['config', 'user.name', 'Native Contract Regression'], { cwd: sourceRoot })
    fs.writeFileSync(path.join(sourceRoot, 'README.md'), '# native contract regression\n', 'utf8')
    execFileSync('git', ['add', 'README.md'], { cwd: sourceRoot })
    execFileSync('git', ['commit', '-qm', 'fixture: native contract regression'], { cwd: sourceRoot })
    fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({
      userId: 'native-contract',
      deviceId: 'native-contract-device',
      deviceToken: 'native-contract-token',
      apiBaseUrl: 'http://127.0.0.1:1',
      mode: 'read_create_append',
      allowedExtensions: [],
      ignorePatterns: [],
      activeSourcesMode: 'single',
      activeSourceIds: [sourceId],
      sources: [{ id: sourceId, label: 'Native contract fixture', path: sourceRoot, enabled: true }]
    }), 'utf8')
    fs.writeFileSync(path.join(configDir, 'runtime.env'), 'WORKBENCH_ACTION_TOKEN=native-contract-test-token-123456\n', { mode: 0o600 })

    const { createPortableHostHandlers } = await import('../../../../scripts/portable-host-handlers')
    ingress = createNativeIngress({
      host: '127.0.0.1',
      port: 0,
      handlers: createPortableHostHandlers(),
      configDir,
      logFilePath: path.join(configDir, 'native-ingress.log')
    })
    const bound = await ingress.start()
    const baseUrl = `http://${bound.host}:${bound.port}`
    const token = 'native-contract-test-token-123456'
    let sequence = 0

    const request = async (pathName: string, body: Record<string, unknown>) => {
      sequence += 1
      const requestId = `native-contract-regression-${sequence}`
      const response = await fetch(`${baseUrl}${pathName}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'X-Workbench-Request-Id': requestId
        },
        body: JSON.stringify(body)
      })
      const json = await response.json() as Record<string, unknown>
      return { status: response.status, json }
    }

    const read = await request('/api/actions/read-context', { mode: 'list_files', sourceId, limit: 1 })
    assert.equal(read.status, 200)
    const workbenchRun = read.json.workbenchRun as { sessionId?: unknown }
    assert.equal(typeof workbenchRun.sessionId, 'string')
    const sessionId = workbenchRun.sessionId as string

    const commandBody = (commandKind: string): Record<string, unknown> => ({
      version: 2,
      sessionId,
      command: { sourceId, commandKind }
    })
    const first = await request('/api/actions/run-command', commandBody('git_status_short'))
    const second = await request('/api/actions/run-command', commandBody('git_branch_current'))
    assert.equal(first.status, 200)
    assert.equal(first.json.status, 'completed')
    assert.equal(second.status, 200)
    assert.equal(second.json.status, 'completed')

    const malformed = await request('/api/actions/run-command', {
      version: 2,
      sessionId,
      sourceId,
      commandKind: 'git_status_short'
    })
    assert.equal(malformed.status, 400)
    assert.equal((malformed.json.error as Record<string, unknown>)?.code, 'invalid_request')

    const missingSession = await request('/api/actions/run-command', {
      version: 2,
      sessionId: 'session-does-not-exist',
      command: { sourceId, commandKind: 'git_status_short' }
    })
    assert.equal(missingSession.status, 400)
    assert.equal((missingSession.json.error as Record<string, unknown>)?.code, 'session_invalid')
  } finally {
    if (ingress) await ingress.stop()
    if (priorConfigDir === undefined) delete process.env.WORKBENCH_CONFIG_DIR
    else process.env.WORKBENCH_CONFIG_DIR = priorConfigDir
    fs.rmSync(configDir, { recursive: true, force: true })
    fs.rmSync(sourceRoot, { recursive: true, force: true })
  }
})

test('fresh create_run creates a new governed goal instead of resuming historical state', async () => {
  const priorConfigDir = process.env.WORKBENCH_CONFIG_DIR
  const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'workbench-fresh-goal-config-'))
  const sourceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'workbench-fresh-goal-source-'))
  const sourceId = 'fixture-fresh-goal'
  process.env.WORKBENCH_CONFIG_DIR = configDir

  try {
    execFileSync('git', ['init', '-q'], { cwd: sourceRoot })
    execFileSync('git', ['config', 'user.email', 'fresh-goal@example.invalid'], { cwd: sourceRoot })
    execFileSync('git', ['config', 'user.name', 'Fresh Goal Regression'], { cwd: sourceRoot })
    fs.writeFileSync(path.join(sourceRoot, 'README.md'), '# fresh goal regression\n', 'utf8')
    execFileSync('git', ['add', 'README.md'], { cwd: sourceRoot })
    execFileSync('git', ['commit', '-qm', 'fixture: fresh goal regression'], { cwd: sourceRoot })
    fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify({
      userId: 'fresh-goal',
      deviceId: 'fresh-goal-device',
      deviceToken: 'fresh-goal-token',
      apiBaseUrl: 'http://127.0.0.1:1',
      mode: 'read_create_append',
      allowedExtensions: [],
      ignorePatterns: [],
      activeSourcesMode: 'single',
      activeSourceIds: [sourceId],
      sources: [{ id: sourceId, label: 'Fresh goal fixture', path: sourceRoot, enabled: true }]
    }), 'utf8')

    const submissions: string[] = []
    const fakeCodex = {
      capability: () => ({
        supported: true,
        adapterIdentity: 'codex-cli' as const,
        command: 'codex-fixture',
        supportsIsolation: true as const,
        supportsWorkbenchMcp: true as const,
        supportsCancellation: true as const,
        supportsStatusReadback: true as const,
        supportsReconciliation: true as const,
        manualFallback: true as const,
        reasonCode: 'ready' as const,
        nextAction: 'fixture submission'
      }),
      submit: async (input: { operation: { operationId: string } }) => {
        submissions.push(input.operation.operationId)
        return { ok: true as const, operation: input.operation, providerOperationIdentity: `fixture:${input.operation.operationId}` }
      }
    } as unknown as CodexDelegationAdapter
    const { createPortableMutationHandlers } = await import('./portable-mutation-handlers')
    const { updateAgentJob, getAgentJob } = await import('./agent-jobs')
    const handlers = createPortableMutationHandlers({ codexAvailable: () => true, codex: fakeCodex })
    const goalDispatch = {
      version: 1 as const,
      expectedOutcome: 'Produce a bounded read-only repository summary.',
      scope: ['README.md'],
      knownFiles: ['README.md'],
      constraints: ['Do not modify files.'],
      nonGoals: ['No commits or pushes.'],
      stopConditions: ['Stop if the read-only boundary cannot be preserved.'],
      confirmationPolicy: 'none' as const,
      terminalResult: { style: 'natural_language' as const, include: ['summary', 'changed_files', 'validation', 'warnings', 'blocker'] as const },
      steps: [],
      commands: [{ commandKind: 'git_status_short' as const }],
      readOnly: true
    }

    const first = await handlers.applyWorkbenchFileChange!({
      sourceId,
      changeType: 'create_run',
      executionMode: 'codex',
      goal: 'Fresh governed goal one.',
      goalDispatch
    }, { sourceId, requestId: 'fresh-goal-one' }) as Record<string, unknown>
    const firstRun = first.run as { id: string }
    assert.equal(first.status, 'queued')
    assert.equal(typeof firstRun.id, 'string')
    assert.equal(submissions.length, 1)
    updateAgentJob(firstRun.id, { status: 'paused' })

    const second = await handlers.applyWorkbenchFileChange!({
      sourceId,
      changeType: 'create_run',
      executionMode: 'codex',
      runId: firstRun.id,
      goal: 'Fresh governed goal two.',
      goalDispatch: { ...goalDispatch, expectedOutcome: 'Produce a second bounded read-only repository summary.' }
    }, { sourceId, requestId: 'fresh-goal-two' }) as Record<string, unknown>
    const secondRun = second.run as { id: string }
    assert.equal(second.status, 'queued')
    assert.equal(typeof secondRun.id, 'string')
    assert.notEqual(secondRun.id, firstRun.id)
    assert.equal(submissions.length, 2)
    assert.equal(getAgentJob(firstRun.id)?.status, 'paused')
  } finally {
    if (priorConfigDir === undefined) delete process.env.WORKBENCH_CONFIG_DIR
    else process.env.WORKBENCH_CONFIG_DIR = priorConfigDir
    fs.rmSync(configDir, { recursive: true, force: true })
    fs.rmSync(sourceRoot, { recursive: true, force: true })
  }
})
