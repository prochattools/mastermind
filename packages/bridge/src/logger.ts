import fs from 'fs'
import path from 'path'
import os from 'os'

interface LogEntry {
  timestamp: string
  tool: string
  status: 'success' | 'error' | 'ready' | 'ok'
  [key: string]: unknown
}

function getAuditLogPath(): string {
  const bridgeDir = process.env.MASTERMIND_PROVIDER_STATE_DIR || process.env.WORKBENCH_PROVIDER_STATE_DIR || path.join(os.homedir(), '.mastermind')
  return path.join(bridgeDir, 'relay.audit.log')
}

export function logToFile(entry: LogEntry): void {
  try {
    const auditPath = getAuditLogPath()
    const dir = path.dirname(auditPath)

    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }

    const line = JSON.stringify(entry) + '\n'
    fs.appendFileSync(auditPath, line)
  } catch (err) {
    console.error('Failed to write relay audit log:', err)
  }
}
