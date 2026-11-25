import type { GuardrailExecutionInput, StepContext } from '@luddjs/core'
import os from 'node:os'
import process from 'node:process'
import { describe, expect, it } from 'vitest'
import { execGuardrail } from '../exec-guardrail.js'

function makeMockCtx(): StepContext {
  return {
    runId: 'r-1',
    steps: {},
    step: { id: 's-1', output: undefined, attempt: 1 },
    matrix: undefined,
    artifacts: {} as any,
  }
}

function makeInput(): GuardrailExecutionInput {
  return {
    ctx: makeMockCtx(),
    stepId: 's-1',
    phase: 'afterStep',
    guardrailIndex: 0,
    attempt: 1,
    runDir: '/runs/1',
    cwd: os.tmpdir(),
    env: {},
    mcpServerUrl: '',
    mcpAuthToken: '',
  }
}

const timedOutCommand = [
  process.execPath,
  '-e',
  'process.stdout.write("partial out"); process.stderr.write("partial err"); setInterval(() => {}, 1000);',
] as const

describe('execGuardrail timeout resolution (AC 5.2.2)', () => {
  it('resolves with fail status and Command timed out by default', async () => {
    const rail = execGuardrail({ command: timedOutCommand, timeout: 0.15 })
    const verdict = await rail.execute(makeInput())

    expect(verdict.status).toBe('fail')
    expect(verdict.body).toBe('Command timed out')
    expect(verdict.rawLog).toBe('partial out\npartial err')
  })

  it('respects custom onTimeout status skip or pass', async () => {
    const skipRail = execGuardrail({ command: timedOutCommand, timeout: 0.15, onTimeout: 'skip' })
    const skipVerdict = await skipRail.execute(makeInput())
    expect(skipVerdict.status).toBe('skip')
    expect(skipVerdict.body).toBe('Command timed out')

    const passRail = execGuardrail({ command: timedOutCommand, timeout: 0.15, onTimeout: 'pass' })
    const passVerdict = await passRail.execute(makeInput())
    expect(passVerdict.status).toBe('pass')
  })
})
