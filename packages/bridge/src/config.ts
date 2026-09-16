import path from 'path'
import os from 'os'

export interface RuntimeConfig {
  bridgePort: number
  dataDir: string
  relayAdminToken: string | null
  relayProxyToken: string | null
  enableDefaultTokens: boolean
  nodeEnv: string
}

export function loadConfig(): RuntimeConfig {
  const bridgePort = parseInt(process.env.BRIDGE_PORT || '3053', 10)
  const relayDataDir = process.env.RELAY_DATA_DIR || process.env.MASTERMIND_PROVIDER_STATE_DIR || process.env.WORKBENCH_PROVIDER_STATE_DIR
  const dataDir = relayDataDir ? path.resolve(relayDataDir) : path.join(os.homedir(), '.mastermind')
  const relayAdminToken = process.env.RELAY_ADMIN_TOKEN || null
  const relayProxyToken = process.env.RELAY_PROXY_TOKEN || null
  const enableDefaultTokens = process.env.RELAY_ENABLE_DEFAULT_TOKENS !== 'false'
  const nodeEnv = process.env.NODE_ENV || 'development'

  return {
    bridgePort,
    dataDir,
    relayAdminToken,
    relayProxyToken,
    enableDefaultTokens,
    nodeEnv
  }
}

export function validateConfig(config: RuntimeConfig): string[] {
  const errors: string[] = []

  if (isNaN(config.bridgePort) || config.bridgePort < 1 || config.bridgePort > 65535) {
    errors.push(`Invalid BRIDGE_PORT: ${process.env.BRIDGE_PORT} (must be 1–65535)`)
  }

  if (config.dataDir.length === 0) {
    errors.push('Data directory path is empty')
  }

  if (config.dataDir.includes('..')) {
    errors.push(`Data directory contains path traversal: ${config.dataDir}`)
  }

  return errors
}

export function redactedConfig(config: RuntimeConfig): Record<string, unknown> {
  return {
    bridgePort: config.bridgePort,
    dataDir: config.dataDir,
    relayAdminToken: config.relayAdminToken ? '[REDACTED]' : 'not set',
    relayProxyToken: config.relayProxyToken ? '[REDACTED]' : 'not set',
    enableDefaultTokens: config.enableDefaultTokens,
    nodeEnv: config.nodeEnv
  }
}
