import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'
import { fetchAgentJson } from '../lib/agentProxy'

const originalFetch = globalThis.fetch
const originalLocalAgentUrl = process.env.LOCAL_AGENT_URL

afterEach(() => {
  globalThis.fetch = originalFetch
  if (originalLocalAgentUrl === undefined) delete process.env.LOCAL_AGENT_URL
  else process.env.LOCAL_AGENT_URL = originalLocalAgentUrl
})

describe('Mastermind agent proxy presentation copy', () => {
  it('keeps stable unavailable code while returning Mastermind-facing error copy', async () => {
    process.env.LOCAL_AGENT_URL = 'http://127.0.0.1:3052'
    globalThis.fetch = async () => {
      throw new TypeError('connection refused')
    }

    const result = await fetchAgentJson('/health')

    assert.equal(result.response, null)
    assert.equal(result.data.code, 'AGENT_UNAVAILABLE')
    assert.equal(result.data.error, 'Mastermind agent is unavailable')
    assert.equal(result.data.message, 'Mastermind agent is unavailable')
    assert.match(result.data.userMessage, /^Mastermind could not reach the local agent\./)
    assert.match(result.data.userMessage, /legacy buildflow serve command/)
  })
})
