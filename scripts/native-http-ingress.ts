import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import canonicalOpenApiSchema from '../apps/web/src/lib/openapi-chatgpt.json'
import { dispatchPortableOperation, WORKBENCH_OPERATION_IDS } from '../apps/web/src/lib/actions/portable-operation-dispatcher'
import { WORKBENCH_OPERATION_MUTATION_CLASS, type WorkbenchOperationId, type WorkbenchOperationRequest } from '../apps/web/src/lib/actions/portable-operation-contract'
import type { PortableOperationHandlers, PortableExecutionContext } from '../apps/web/src/lib/actions/portable-operation-dispatcher'
import { GPT_ACTION_RESPONSE_BYTE_LIMIT } from '../apps/web/src/lib/actions/payload-budget'
import { beginNativeRequest, buildNativeRequestFingerprint, completeNativeRequest, NativeRequestLedgerError } from '../packages/cli/src/agent/native-request-ledger'

export const NATIVE_INGRESS_PROTOCOL_VERSION = 1
export const NATIVE_INGRESS_MAX_REQUEST_BYTES = 262_144
export const NATIVE_INGRESS_MAX_RESPONSE_BYTES = GPT_ACTION_RESPONSE_BYTE_LIMIT
export const NATIVE_INGRESS_REQUEST_ID_MAX_LENGTH = 200
export const NATIVE_INGRESS_DEFAULT_MAX_ACTIVE_REQUESTS = 8
const NATIVE_INGRESS_DEFAULT_DEADLINE_MS = 12_000
const NATIVE_INGRESS_OWNER_CONFIG_DIR = path.join(process.env.HOME || process.env.USERPROFILE || '/tmp', '.config', 'workbench')

type NativeIngressRoute = {
  method: 'GET' | 'POST'
  path: string
  operationId: WorkbenchOperationId | null
}

const ROUTES: NativeIngressRoute[] = [
  { method: 'GET', path: '/api/actions/status', operationId: 'getWorkbenchStatus' },
  { method: 'POST', path: '/api/actions/read-context', operationId: 'readWorkbenchContext' },
  { method: 'POST', path: '/api/actions/apply-file-change', operationId: 'applyWorkbenchFileChange' },
  { method: 'POST', path: '/api/actions/commit-changes', operationId: 'commitWorkbenchChanges' },
  { method: 'POST', path: '/api/actions/run-command', operationId: 'runWorkbenchCommand' },
  { method: 'GET', path: '/api/diagnostics/local', operationId: null },
  { method: 'GET', path: '/api/openapi', operationId: null },
  { method: 'GET', path: '/health', operationId: null }
]

export type NativeIngressConfig = {
  host: string
  port: number
  handlers: PortableOperationHandlers
  configDir?: string
  logFilePath?: string
  serverUrl?: string
  /** Test seam for proving terminal response deadlines without a 12-second test. */
  deadlineMs?: number
  /** Keep status responsive while bounding concurrent public operations. */
  maxActiveRequests?: number
  localDiagnostics?: (context: { activeRequests: number; peakActiveRequests: number; sourceId?: string }) => unknown | Promise<unknown>
}

type NativeIngressLogEntry = {
  event: string
  requestId?: string
  operationId?: WorkbenchOperationId
  method?: string
  path?: string
  phase?: string
  status?: number
  elapsedMs?: number
  activeRequests?: number
  sourceId?: string
  sessionId?: string
  errorCode?: string
  errorMessage?: string
  responseBytes?: number
  responseSha256?: string
  responseEnded?: boolean
  responseFinished?: boolean
  responseDestroyed?: boolean
}

type NativeResponseMetadata = {
  status: number
  responseBytes: number
  responseSha256: string
}

function appendIngressLog(logFilePath: string, entry: NativeIngressLogEntry): void {
  try {
    fs.mkdirSync(path.dirname(logFilePath), { recursive: true, mode: 0o700 })
    if (!fs.existsSync(logFilePath)) fs.writeFileSync(logFilePath, '', { mode: 0o600 })
    fs.appendFileSync(logFilePath, `${JSON.stringify({ time: new Date().toISOString(), ...entry })}\n`, { encoding: 'utf8' })
    fs.chmodSync(logFilePath, 0o600)
  } catch {
    // Diagnostics must never make the action path fail.
  }
}

export type NativeIngressStatus = {
  nativeHttpIngressSupported: true
  nativeHttpIngressEnabled: boolean
  nativeHttpIngressHealthy: boolean
  nativeHttpIngressHost: string
  nativeHttpIngressPort: number
  nativeHttpIngressProtocolVersion: number
  supportedHttpOperationIds: string[]
}

function loadOwnerToken(configDir: string): string | null {
  const runtimeEnvPath = path.join(configDir, 'runtime.env')
  let stat: fs.Stats
  try { stat = fs.lstatSync(runtimeEnvPath) } catch { return null }
  if (!stat.isFile() || stat.isSymbolicLink()) return null
  if ((stat.mode & 0o077) !== 0) return null
  const expectedUid = typeof process.getuid === 'function' ? process.getuid() : undefined
  if (expectedUid !== undefined && stat.uid !== expectedUid) return null
  let content: string
  try { content = fs.readFileSync(runtimeEnvPath, 'utf8') } catch { return null }
  const lines = content.split('\n').filter(l => l.trim() && !l.startsWith('#'))
  const tokenLines = lines.filter(l => l.startsWith('WORKBENCH_ACTION_TOKEN='))
  if (tokenLines.length !== 1) return null
  const token = tokenLines[0].slice('WORKBENCH_ACTION_TOKEN='.length).trim()
  if (token.length < 16 || token.length > 4096 || /[\r\n\0]/.test(token)) return null
  return token
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    crypto.timingSafeEqual(Buffer.from(a), Buffer.from(a))
    return false
  }
  return crypto.timingSafeEqual(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'))
}

function authenticateRequest(req: http.IncomingMessage, configDir: string): { valid: boolean; status?: number; body?: unknown } {
  const token = loadOwnerToken(configDir)
  if (!token) return { valid: false, status: 500, body: { error: 'Server configuration error: WORKBENCH_ACTION_TOKEN not set' } }
  const authHeader = req.headers['authorization']
  if (!authHeader || typeof authHeader !== 'string' || !authHeader.startsWith('Bearer ')) {
    return { valid: false, status: 401, body: { error: 'Unauthorized' } }
  }
  const candidate = authHeader.slice(7)
  if (!timingSafeEqual(candidate, token)) {
    return { valid: false, status: 401, body: { error: 'Unauthorized' } }
  }
  return { valid: true }
}

function readBody(req: http.IncomingMessage, maxBytes: number, timeoutMs: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    let settled = false
    const timer = setTimeout(() => {
      settled = true
      req.pause()
      reject(new Error('request_body_timeout'))
    }, timeoutMs)
    const finish = (callback: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      callback()
    }
    req.on('data', chunk => {
      if (settled) return
      size += chunk.length
      if (size > maxBytes) finish(() => { req.destroy(); reject(new Error('request_body_too_large')) })
      else chunks.push(chunk)
    })
    req.on('end', () => finish(() => resolve(Buffer.concat(chunks))))
    req.on('error', error => finish(() => reject(error)))
  })
}

function matchRoute(method: string, pathname: string): NativeIngressRoute | null {
  return ROUTES.find(r => r.method === method && r.path === pathname) || null
}

export function normalizeIncomingRequestId(value: string | string[] | undefined): string | undefined {
  if (typeof value !== 'string') return undefined
  const candidate = value.trim()
  if (!candidate || candidate.length > NATIVE_INGRESS_REQUEST_ID_MAX_LENGTH) return undefined
  return /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(candidate) ? candidate : undefined
}

function generateRequestId(): string {
  return `native-http-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`
}

function compactStatusPayload(payload: Record<string, unknown>): Record<string, unknown> {
  if (!Array.isArray(payload.sources)) return payload
  const sourceCount = payload.sources.length
  const sources = payload.sources
    .filter((source): source is Record<string, unknown> => Boolean(source) && typeof source === 'object' && !Array.isArray(source))
    .slice(0, 20)
    .map(source => ({
      id: typeof source.id === 'string' ? source.id.slice(0, 200) : '',
      label: typeof source.label === 'string' ? source.label.slice(0, 200) : '',
      ...(typeof source.enabled === 'boolean' ? { enabled: source.enabled } : {}),
      ...(typeof source.active === 'boolean' ? { active: source.active } : {})
    }))
  return {
    ...payload,
    sources,
    ...(sources.length < sourceCount ? { sourcesTruncated: true } : {})
  }
}

function jsonResponse(res: http.ServerResponse, status: number, body: unknown, requestId?: string): NativeResponseMetadata {
  const payload = JSON.stringify(body)
  const bytes = Buffer.byteLength(payload, 'utf8')
  const responsePayload = bytes > NATIVE_INGRESS_MAX_RESPONSE_BYTES
    ? JSON.stringify({ ok: false, requestId, error: { code: 'RESPONSE_SIZE_EXCEEDED', message: 'Native ingress response exceeded public action size limit.' } })
    : payload
  const responseStatus = bytes > NATIVE_INGRESS_MAX_RESPONSE_BYTES ? 200 : status
  const responseBytes = Buffer.byteLength(responsePayload, 'utf8')
  const responseSha256 = crypto.createHash('sha256').update(responsePayload, 'utf8').digest('hex')
  res.writeHead(responseStatus, { 'Content-Type': 'application/json', 'Content-Length': responseBytes.toString(), 'Cache-Control': 'no-store' })
  res.end(responsePayload)
  return { status: responseStatus, responseBytes, responseSha256 }
}

function buildOpenApiSchema() {
  return structuredClone(canonicalOpenApiSchema)
}

async function handleOperation(operationId: WorkbenchOperationId, payload: unknown, sourceId: string | undefined, sessionId: string | undefined, handlers: PortableOperationHandlers, signal: AbortSignal, requestId: string, deadlineMs: number): Promise<{ status: number; body: unknown }> {
  const deadlineAt = new Date(Date.now() + deadlineMs).toISOString()
  const request: WorkbenchOperationRequest = { protocolVersion: 1, requestId, operationId, deadlineAt, sourceId, sessionId, payload, caller: { ingress: 'native', client: 'native-http-ingress' } }
  const context: PortableExecutionContext = { signal, requestId, sourceId, sessionId }
  const result = await dispatchPortableOperation(request, handlers, context)
  if (!result.ok) {
    const httpStatus = result.error?.requiresConfirmation ? 200 : 400
    return { status: httpStatus, body: { ok: false, requestId, ...result.error ? { status: 'blocked', error: result.error } : {} } }
  }
  if (result.payload && typeof result.payload === 'object' && !Array.isArray(result.payload)) {
    const body = operationId === 'getWorkbenchStatus'
      ? compactStatusPayload(result.payload as Record<string, unknown>)
      : result.payload as Record<string, unknown>
    return { status: 200, body: body.requestId === undefined ? { ...body, requestId } : body }
  }
  return { status: 200, body: result.payload !== undefined ? { ok: true, requestId, payload: result.payload } : { ok: true, requestId } }
}

export function createNativeIngress(config: NativeIngressConfig): { server: http.Server; start: () => Promise<{ host: string; port: number }>; stop: () => Promise<void>; status: () => NativeIngressStatus } {
  if (config.host !== '127.0.0.1' && config.host !== 'localhost') {
    throw new Error('Native HTTP ingress must bind to loopback only')
  }
  const configDir = config.configDir || NATIVE_INGRESS_OWNER_CONFIG_DIR
  const deadlineMs = config.deadlineMs ?? NATIVE_INGRESS_DEFAULT_DEADLINE_MS
  if (!Number.isSafeInteger(deadlineMs) || deadlineMs < 1 || deadlineMs > NATIVE_INGRESS_DEFAULT_DEADLINE_MS) {
    throw new Error(`Native HTTP ingress deadline must be between 1 and ${NATIVE_INGRESS_DEFAULT_DEADLINE_MS}ms`)
  }
  const maxActiveRequests = config.maxActiveRequests ?? NATIVE_INGRESS_DEFAULT_MAX_ACTIVE_REQUESTS
  if (!Number.isSafeInteger(maxActiveRequests) || maxActiveRequests < 1 || maxActiveRequests > 64) {
    throw new Error('Native HTTP ingress maxActiveRequests must be between 1 and 64')
  }
  let healthy = false
  let boundPort = config.port
  let boundHost = config.host
  const logFilePath = config.logFilePath || path.join(configDir, 'runtime-state', 'native-ingress.log')
  let activeRequests = 0
  let peakActiveRequests = 0

  const server = http.createServer(async (req, res) => {
    const requestStartedAt = Date.now()
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`)
    const pathname = url.pathname
    const method = (req.method || 'GET').toUpperCase()
    const route = matchRoute(method, pathname)
    const suppliedRequestId = normalizeIncomingRequestId(req.headers['x-workbench-request-id'])
      || normalizeIncomingRequestId(req.headers['idempotency-key'])
    let requestId = suppliedRequestId || generateRequestId()
    let sourceId: string | undefined
    let sessionId: string | undefined
    const operationId = route?.operationId || undefined
    let responseMetadata: NativeResponseMetadata | undefined

    const sendJson = (status: number, body: unknown, responseRequestId?: string): void => {
      responseMetadata = jsonResponse(res, status, body, responseRequestId)
      appendIngressLog(logFilePath, {
        event: 'response_write',
        requestId,
        operationId,
        method,
        path: pathname,
        phase: 'response_write',
        status: responseMetadata.status,
        elapsedMs: Date.now() - requestStartedAt,
        activeRequests,
        sourceId,
        sessionId,
        responseBytes: responseMetadata.responseBytes,
        responseSha256: responseMetadata.responseSha256,
        responseEnded: res.writableEnded,
        responseFinished: res.writableFinished,
        responseDestroyed: res.destroyed
      })
    }

    const appendResponseLifecycle = (event: 'response_finish' | 'response_close', phase: string): void => {
      appendIngressLog(logFilePath, {
        event,
        requestId,
        operationId,
        method,
        path: pathname,
        phase,
        status: responseMetadata?.status,
        elapsedMs: Date.now() - requestStartedAt,
        activeRequests,
        sourceId,
        sessionId,
        ...(responseMetadata ? {
          responseBytes: responseMetadata.responseBytes,
          responseSha256: responseMetadata.responseSha256
        } : {}),
        responseEnded: res.writableEnded,
        responseFinished: res.writableFinished,
        responseDestroyed: res.destroyed
      })
    }

    res.once('finish', () => appendResponseLifecycle('response_finish', 'response_finish'))
    res.once('close', () => appendResponseLifecycle('response_close', 'response_close'))

    if (!route) {
      sendJson(404, { error: 'Not found' })
      return
    }

    if (pathname === '/health') {
      sendJson(200, { ok: true, ingress: 'native-http', protocolVersion: NATIVE_INGRESS_PROTOCOL_VERSION })
      return
    }

    if (pathname === '/api/openapi') {
      sendJson(200, buildOpenApiSchema())
      return
    }

    const auth = authenticateRequest(req, configDir)
    if (!auth.valid) {
      appendIngressLog(logFilePath, { event: 'request_rejected', requestId, method, path: pathname, phase: 'authentication', status: auth.status, elapsedMs: Date.now() - requestStartedAt, activeRequests })
      res.setHeader('X-Workbench-Request-Id', requestId)
      const authBody = auth.body && typeof auth.body === 'object' && !Array.isArray(auth.body)
        ? { ...(auth.body as Record<string, unknown>), requestId }
        : { error: auth.body, requestId }
      sendJson(auth.status!, authBody)
      return
    }

    if (pathname === '/api/diagnostics/local') {
      if (!config.localDiagnostics) {
        res.setHeader('X-Workbench-Request-Id', requestId)
        sendJson(404, { ok: false, requestId, error: { code: 'local_diagnostics_unavailable', message: 'Local diagnostics are not enabled for this host.' } }, requestId)
        return
      }
      try {
        const requestedSourceId = url.searchParams.get('sourceId')?.trim()
        const diagnostics = await config.localDiagnostics({
          activeRequests,
          peakActiveRequests,
          ...(requestedSourceId ? { sourceId: requestedSourceId.slice(0, 160) } : {})
        })
        const body = diagnostics && typeof diagnostics === 'object' && !Array.isArray(diagnostics)
          ? { ...(diagnostics as Record<string, unknown>), requestId }
          : { ok: true, requestId, diagnostics }
        appendIngressLog(logFilePath, { event: 'local_diagnostics', requestId, method, path: pathname, phase: 'response_ready', status: 200, elapsedMs: Date.now() - requestStartedAt, activeRequests })
        res.setHeader('X-Workbench-Request-Id', requestId)
        sendJson(200, body, requestId)
      } catch (error) {
        appendIngressLog(logFilePath, { event: 'request_error', requestId, method, path: pathname, phase: 'local_diagnostics', status: 500, elapsedMs: Date.now() - requestStartedAt, activeRequests, errorMessage: error instanceof Error ? error.message : String(error) })
        res.setHeader('X-Workbench-Request-Id', requestId)
        sendJson(500, { ok: false, requestId, error: { code: 'local_diagnostics_failed', message: 'Local diagnostics could not be collected.' } }, requestId)
      }
      return
    }

    const actionOperationId = route.operationId
    if (!actionOperationId) {
      sendJson(404, { error: 'Not found' })
      return
    }

    let payload: unknown = {}
    if (method === 'POST') {
      try {
        const raw = await readBody(req, NATIVE_INGRESS_MAX_REQUEST_BYTES, deadlineMs)
        payload = JSON.parse(raw.toString('utf8'))
        if (!suppliedRequestId && payload && typeof payload === 'object' && !Array.isArray(payload)) {
          requestId = normalizeIncomingRequestId((payload as Record<string, unknown>).requestId as string | undefined) || requestId
        }
      } catch (err) {
        if (err instanceof Error && err.message === 'request_body_too_large') {
          appendIngressLog(logFilePath, { event: 'request_rejected', requestId, operationId, method, path: pathname, phase: 'request_body_too_large', status: 413, elapsedMs: Date.now() - requestStartedAt, activeRequests })
          res.setHeader('X-Workbench-Request-Id', requestId)
          sendJson(413, { error: 'Request body too large', requestId }, requestId)
        } else if (err instanceof Error && err.message === 'request_body_timeout') {
          appendIngressLog(logFilePath, { event: 'deadline_exceeded', requestId, operationId, method, path: pathname, phase: 'request_body', status: 200, elapsedMs: Date.now() - requestStartedAt, activeRequests })
          res.setHeader('X-Workbench-Request-Id', requestId)
          res.setHeader('X-Workbench-Deadline-Phase', 'request_body')
          sendJson(200, { ok: false, status: 'timeout', requestId, error: { code: 'deadline_exceeded', message: `Workbench request body exceeded its ${deadlineMs}ms response deadline.`, retryable: false } })
        } else {
          appendIngressLog(logFilePath, { event: 'request_rejected', requestId, operationId, method, path: pathname, phase: 'invalid_json', status: 400, elapsedMs: Date.now() - requestStartedAt, activeRequests })
          res.setHeader('X-Workbench-Request-Id', requestId)
          sendJson(400, { error: 'Invalid JSON body', requestId }, requestId)
        }
        return
      }
    } else if (method === 'GET' && operationId === 'getWorkbenchStatus') {
      const include = url.searchParams.get('include')
      if (include) payload = { include }
    }

    sourceId = typeof (payload as Record<string, unknown>)?.sourceId === 'string' ? (payload as Record<string, unknown>).sourceId as string : undefined
    sessionId = typeof (payload as Record<string, unknown>)?.sessionId === 'string' ? (payload as Record<string, unknown>).sessionId as string : undefined
    if (activeRequests >= maxActiveRequests && operationId !== 'getWorkbenchStatus') {
      appendIngressLog(logFilePath, { event: 'request_rejected', requestId, operationId, method, path: pathname, phase: 'backpressure', status: 429, elapsedMs: Date.now() - requestStartedAt, activeRequests, sourceId, sessionId })
      res.setHeader('X-Workbench-Request-Id', requestId)
      res.setHeader('Retry-After', '1')
      sendJson(429, { ok: false, status: 'blocked', requestId, error: { code: 'backpressure_overloaded', message: 'Workbench is busy with bounded operations. Retry this request after the active work drains.', retryable: true, retryAfterMs: 1_000 } }, requestId)
      return
    }
    const mutation = WORKBENCH_OPERATION_MUTATION_CLASS[actionOperationId] === 'mutation_capable'
    if (mutation) {
      const fingerprint = buildNativeRequestFingerprint({ operationId: actionOperationId, sourceId, sessionId, payload })
      let admission
      try {
        admission = beginNativeRequest({ configDir, requestId, fingerprint, operationId: actionOperationId, sourceId, sessionId })
      } catch (error) {
        const message = error instanceof NativeRequestLedgerError ? error.message : 'Native mutation request ledger is unavailable; retry after recovery.'
        appendIngressLog(logFilePath, { event: 'request_rejected', requestId, operationId, method, path: pathname, phase: 'request_ledger', status: 503, elapsedMs: Date.now() - requestStartedAt, activeRequests, sourceId, sessionId, errorMessage: message })
        res.setHeader('X-Workbench-Request-Id', requestId)
        sendJson(503, { ok: false, status: 'blocked', requestId, error: { code: 'request_ledger_unavailable', message, retryable: false } }, requestId)
        return
      }
      if (admission.decision === 'conflict') {
        appendIngressLog(logFilePath, { event: 'request_rejected', requestId, operationId, method, path: pathname, phase: 'request_id_conflict', status: 409, elapsedMs: Date.now() - requestStartedAt, activeRequests, sourceId, sessionId })
        res.setHeader('X-Workbench-Request-Id', requestId)
        sendJson(409, { ok: false, status: 'blocked', requestId, error: { code: 'request_id_conflict', message: 'The request ID was already used for a different mutation.', retryable: false } }, requestId)
        return
      }
      if (admission.decision === 'in_flight') {
        appendIngressLog(logFilePath, { event: 'request_rejected', requestId, operationId, method, path: pathname, phase: 'request_in_flight', status: 200, elapsedMs: Date.now() - requestStartedAt, activeRequests, sourceId, sessionId })
        res.setHeader('X-Workbench-Request-Id', requestId)
        sendJson(200, { ok: false, status: 'blocked', requestId, error: { code: 'request_in_flight', message: 'This mutation is still in flight or its outcome is ambiguous. Reconcile the original request before retrying.', retryable: false } }, requestId)
        return
      }
      if (admission.decision === 'replay') {
        appendIngressLog(logFilePath, { event: 'request_replay', requestId, operationId, method, path: pathname, phase: 'terminal_outcome_replayed', status: admission.record.httpStatus, elapsedMs: Date.now() - requestStartedAt, activeRequests, sourceId, sessionId })
        res.setHeader('X-Workbench-Request-Id', requestId)
        res.setHeader('X-Workbench-Deadline-Phase', 'replayed')
        sendJson(admission.record.httpStatus || 200, admission.record.responseBody, requestId)
        return
      }
      if (admission.decision === 'recorded_without_body') {
        appendIngressLog(logFilePath, { event: 'request_replay', requestId, operationId, method, path: pathname, phase: 'terminal_outcome_without_body', status: 200, elapsedMs: Date.now() - requestStartedAt, activeRequests, sourceId, sessionId })
        res.setHeader('X-Workbench-Request-Id', requestId)
        res.setHeader('X-Workbench-Deadline-Phase', 'reconciled')
        sendJson(200, { ok: false, status: 'blocked', requestId, error: { code: 'request_outcome_recorded', message: 'The mutation already reached a terminal outcome, but its response was too large to replay. Do not retry it; reconcile the durable run or packet result.', retryable: false } }, requestId)
        return
      }
    }
    activeRequests += 1
    peakActiveRequests = Math.max(peakActiveRequests, activeRequests)
    appendIngressLog(logFilePath, { event: 'request_start', requestId, operationId, method, path: pathname, phase: 'dispatch_pending', activeRequests, sourceId, sessionId })
    const controller = new AbortController()
    let timeout: NodeJS.Timeout | undefined
    try {
      const operationPromise = handleOperation(actionOperationId, payload, sourceId, sessionId, config.handlers, controller.signal, requestId, deadlineMs)
      operationPromise.then(result => {
        if (mutation) {
          try {
            completeNativeRequest({
              configDir,
              requestId,
              status: result.status >= 400 ? 'failed' : 'completed',
              httpStatus: result.status,
              responseBody: result.body
            })
          } catch (error) {
            appendIngressLog(logFilePath, { event: 'request_error', requestId, operationId, method, path: pathname, phase: 'request_ledger_complete', status: 500, elapsedMs: Date.now() - requestStartedAt, activeRequests, sourceId, sessionId, errorMessage: error instanceof Error ? error.message : String(error) })
          }
        }
        if (controller.signal.aborted) {
          appendIngressLog(logFilePath, { event: 'late_completion', requestId, operationId, method, path: pathname, phase: 'completed_after_timeout', status: result.status, elapsedMs: Date.now() - requestStartedAt, activeRequests, sourceId, sessionId })
        }
      }).catch(error => {
        if (mutation) {
          try {
            completeNativeRequest({
              configDir,
              requestId,
              status: 'failed',
              httpStatus: 500,
              responseBody: { ok: false, status: 'error', requestId, error: { code: 'NATIVE_INGRESS_INTERNAL', message: error instanceof Error ? error.message : 'Internal error' } }
            })
          } catch (ledgerError) {
            appendIngressLog(logFilePath, { event: 'request_error', requestId, operationId, method, path: pathname, phase: 'request_ledger_complete', status: 500, elapsedMs: Date.now() - requestStartedAt, activeRequests, sourceId, sessionId, errorMessage: ledgerError instanceof Error ? ledgerError.message : String(ledgerError) })
          }
        }
        if (controller.signal.aborted) {
          appendIngressLog(logFilePath, { event: 'late_failure', requestId, operationId, method, path: pathname, phase: 'failed_after_timeout', elapsedMs: Date.now() - requestStartedAt, activeRequests, sourceId, sessionId, errorMessage: error instanceof Error ? error.message : String(error) })
        }
      })
      const timeoutResult = new Promise<{ status: number; body: unknown }>(resolve => {
        timeout = setTimeout(() => {
          controller.abort()
          appendIngressLog(logFilePath, { event: 'deadline_exceeded', requestId, operationId, method, path: pathname, phase: 'deadline_exceeded', status: 200, elapsedMs: Date.now() - requestStartedAt, activeRequests, sourceId, sessionId })
          resolve({
            status: 200,
            body: {
              ok: false,
              status: 'blocked',
              requestId,
              error: {
                code: 'deadline_exceeded',
                message: `Workbench operation exceeded its ${deadlineMs}ms response deadline. Its outcome must be reconciled before retrying.`,
                retryable: false
              }
            }
          })
        }, deadlineMs)
      })
      const result = await Promise.race([
        operationPromise,
        timeoutResult
      ])
      if (mutation && !controller.signal.aborted) {
        try {
          completeNativeRequest({
            configDir,
            requestId,
            status: result.status >= 400 ? 'failed' : 'completed',
            httpStatus: result.status,
            responseBody: result.body
          })
        } catch (error) {
          appendIngressLog(logFilePath, { event: 'request_error', requestId, operationId, method, path: pathname, phase: 'request_ledger_complete', status: 500, elapsedMs: Date.now() - requestStartedAt, activeRequests, sourceId, sessionId, errorMessage: error instanceof Error ? error.message : String(error) })
        }
      }
      appendIngressLog(logFilePath, { event: 'request_finish', requestId, operationId, method, path: pathname, phase: controller.signal.aborted ? 'timeout_response' : 'response_ready', status: result.status, elapsedMs: Date.now() - requestStartedAt, activeRequests, sourceId, sessionId })
      res.setHeader('X-Workbench-Request-Id', requestId)
      res.setHeader('X-Workbench-Deadline-Phase', controller.signal.aborted ? 'deadline_exceeded' : 'response_ready')
      sendJson(result.status, result.body, requestId)
    } catch (err) {
      appendIngressLog(logFilePath, { event: 'request_error', requestId, operationId, method, path: pathname, phase: 'internal_error', status: 500, elapsedMs: Date.now() - requestStartedAt, activeRequests, sourceId, sessionId, errorMessage: err instanceof Error ? err.message : String(err) })
      res.setHeader('X-Workbench-Request-Id', requestId)
      sendJson(500, { ok: false, requestId, error: { code: 'NATIVE_INGRESS_INTERNAL', message: err instanceof Error ? err.message : 'Internal error' } }, requestId)
    } finally {
      if (timeout) clearTimeout(timeout)
      activeRequests = Math.max(0, activeRequests - 1)
    }
  })

  server.on('error', (err) => {
    process.stderr.write(JSON.stringify({ event: 'native_ingress_error', message: err.message }) + '\n')
    healthy = false
  })

  function start(): Promise<{ host: string; port: number }> {
    return new Promise((resolve, reject) => {
      server.listen(config.port, config.host, () => {
        const addr = server.address()
        if (addr && typeof addr === 'object') {
          boundPort = addr.port
          boundHost = addr.address
        }
        healthy = true
        resolve({ host: boundHost, port: boundPort })
      })
      server.once('error', reject)
    })
  }

  function stop(): Promise<void> {
    healthy = false
    return new Promise(resolve => {
      server.close(() => resolve())
      setTimeout(resolve, 2000)
    })
  }

  function status(): NativeIngressStatus {
    return {
      nativeHttpIngressSupported: true,
      nativeHttpIngressEnabled: healthy,
      nativeHttpIngressHealthy: healthy,
      nativeHttpIngressHost: boundHost,
      nativeHttpIngressPort: boundPort,
      nativeHttpIngressProtocolVersion: NATIVE_INGRESS_PROTOCOL_VERSION,
      supportedHttpOperationIds: ROUTES.flatMap(route => route.operationId ? [route.operationId] : [])
    }
  }

  return { server, start, stop, status }
}
