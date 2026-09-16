import path from 'path'
import os from 'os'

export function getDataDir(): string {
  const relayDataDir = process.env.RELAY_DATA_DIR || process.env.MASTERMIND_PROVIDER_STATE_DIR || process.env.WORKBENCH_PROVIDER_STATE_DIR
  return relayDataDir ? path.resolve(relayDataDir) : path.join(os.homedir(), '.mastermind')
}

export function getDataPath(filename: string): string {
  return path.join(getDataDir(), filename)
}
