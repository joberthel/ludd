import type { AgentTurnInput, StepContext } from '@luddjs/core'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export const FAKE_ACP_SERVER = path.resolve(__dirname, 'fake-acp-server.mjs')
export const CLI_BIN_PATH = path.resolve(__dirname, '../../../cli/dist/bin.js')

export function makeTurnInput(
  dir: string,
  overrides: Partial<AgentTurnInput<StepContext>> = {},
): AgentTurnInput<StepContext> {
  return {
    ctx: {
      runId: 'run-acp-1',
      step: { id: 'step-acp-1', output: undefined, attempt: 1 },
      steps: {},
      matrix: undefined,
      artifacts: {} as StepContext['artifacts'],
    },
    stepId: 'step-acp-1',
    prompt: 'hello acp',
    sessionId: 'core-session-1',
    attempt: 1,
    mode: 'read-only',
    runDir: dir,
    cwd: dir,
    env: {},
    ...overrides,
  }
}

export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  }
  catch {
    return false
  }
}

export function readPidFile(pidFile: string): number {
  return Number(fs.readFileSync(pidFile, 'utf8').trim())
}
