import assert from 'node:assert/strict'
import test from 'node:test'
import { NextRequest } from 'next/server'
import { GET as getWorkbenchStatus } from '../../app/api/actions/status/route'

const statusUrl = 'http://127.0.0.1:3054/api/actions/status?include=active'

function request() {
  return new NextRequest(statusUrl, {
    headers: { authorization: 'Bearer status-test-token' }
  })
}

async function withStatusEnvironment<T>(fetchImpl: typeof fetch, callback: () => Promise<T>): Promise<T> {
  const originalFetch = globalThis.fetch
  const originalToken = process.env.WORKBENCH_ACTION_TOKEN
  const originalMode = process.env.WORKBENCH_BACKEND_MODE
  try {
    process.env.WORKBENCH_ACTION_TOKEN = 'status-test-token'
    process.env.WORKBENCH_BACKEND_MODE = 'direct-agent'
    globalThis.fetch = fetchImpl
    return await callback()
  } finally {
    globalThis.fetch = originalFetch
    if (originalToken === undefined) delete process.env.WORKBENCH_ACTION_TOKEN
    else process.env.WORKBENCH_ACTION_TOKEN = originalToken
    if (originalMode === undefined) delete process.env.WORKBENCH_BACKEND_MODE
    else process.env.WORKBENCH_BACKEND_MODE = originalMode
  }
}

test('repeated active status requests preserve a valid response', async () => {
  let fetchCalls = 0
  const response = JSON.stringify({
    mode: 'single',
    activeSourceIds: ['brain'],
    focusedWorkspace: { sourceId: 'brain', updatedAt: '2026-09-09T00:00:00.000Z' },
    resume: { status: 'IDLE_READY', workspace: { sourceId: 'brain' } },
    activeRuns: []
  })
  await withStatusEnvironment(async () => {
    fetchCalls += 1
    return new Response(response, { status: 200, headers: { 'content-type': 'application/json' } })
  }, async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const result = await getWorkbenchStatus(request())
      assert.equal(result.status, 200)
      const payload = await result.json()
      assert.equal(payload.ok, true)
      assert.deepEqual(payload.activeSourceIds, ['brain'])
      assert.equal(payload.context_error, undefined)
    }
  })
  assert.equal(fetchCalls, 5)
})

test('active status failures become structured Workbench errors', async () => {
  const cases: Array<{ name: string; fetchImpl: typeof fetch; code: string }> = [
    {
      name: 'unavailable service',
      fetchImpl: (async () => { throw new Error('fetch failed') }) as typeof fetch,
      code: 'LOCAL_STACK_UNAVAILABLE'
    },
    {
      name: 'timeout',
      fetchImpl: (async () => {
        const error = new Error('The operation was aborted')
        error.name = 'AbortError'
        throw error
      }) as typeof fetch,
      code: 'LOCAL_STACK_TIMEOUT'
    },
    {
      name: 'malformed response',
      fetchImpl: (async () => new Response('not-json', { status: 200 })) as typeof fetch,
      code: 'INVALID_RELAY_RESPONSE'
    },
    {
      name: 'backend authentication failure',
      fetchImpl: (async () => new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 })) as typeof fetch,
      code: 'WORKBENCH_AUTH_ERROR'
    },
    {
      name: 'backend internal failure',
      fetchImpl: (async () => new Response(JSON.stringify({ error: 'internal details must not leak' }), { status: 500 })) as typeof fetch,
      code: 'WORKBENCH_STATUS_ERROR'
    }
  ]

  for (const failure of cases) {
    await withStatusEnvironment(failure.fetchImpl, async () => {
      const result = await getWorkbenchStatus(request())
      assert.equal(result.status, failure.code === 'WORKBENCH_AUTH_ERROR' ? 401 : failure.code === 'WORKBENCH_STATUS_ERROR' ? 500 : 200, `${failure.name} should use the appropriate HTTP response`)
      const payload = await result.json()
      assert.equal(payload.ok, false, `${failure.name} should not look successful`)
      assert.equal(payload.error?.code, failure.code, `${failure.name} should preserve its failure class`)
      assert.equal(payload.context_error, undefined)
      if (failure.name === 'backend internal failure') {
        assert.equal(JSON.stringify(payload).includes('internal details must not leak'), false)
      }
    })
  }
})
