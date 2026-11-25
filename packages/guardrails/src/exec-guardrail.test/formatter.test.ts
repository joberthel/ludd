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

describe('execGuardrail synchronous formatter', () => {
  it('allows custom sync formatter to override verdict status and body', async () => {
    const payload = JSON.stringify({
      totalErrors: 2,
      messages: ['err1', 'err2'],
    })
    const rail = execGuardrail({
      command: [
        process.execPath,
        '-e',
        `process.stdout.write(${JSON.stringify(payload)}); process.exit(1);`,
      ],
      formatter: (result) => {
        const parsed = JSON.parse(result.stdout)
        const status = parsed.totalErrors === 0
          ? 'pass'
          : 'fail'
        return {
          status,
          body: { errors: parsed.messages },
        }
      },
    })

    const verdict = await rail.execute(makeInput())

    expect(verdict.status).toBe('fail')
    expect(verdict.body).toEqual({
      errors: ['err1', 'err2'],
    })
    expect(verdict.rawLog).toContain('totalErrors')
  })
})

describe('execGuardrail asynchronous formatter', () => {
  it('allows async formatter and respects custom rawLog and pagination', async () => {
    const rail = execGuardrail({
      command: [process.execPath, '-e', 'process.stdout.write("output data")'],
      pagination: 'original-page',
      formatter: async result => ({
        status: 'pass',
        rawLog: `custom log: ${result.stdout}`,
        pagination: 'custom-page',
        logFormat: 'json',
      }),
    })

    const verdict = await rail.execute(makeInput())

    expect(verdict.status).toBe('pass')
    expect(verdict.rawLog).toBe('custom log: output data')
    expect(verdict.pagination).toBe('custom-page')
  })

  it('omits rawLog when formatter returns status pass without rawLog', async () => {
    const rail = execGuardrail({
      command: [process.execPath, '-e', 'process.stdout.write("some output")'],
      formatter: async () => ({
        status: 'pass',
      }),
    })

    const verdict = await rail.execute(makeInput())

    expect(verdict.status).toBe('pass')
    expect(verdict.rawLog).toBeUndefined()
  })
})
