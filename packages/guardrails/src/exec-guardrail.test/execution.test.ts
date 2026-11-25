import type { GuardrailExecutionInput, StepContext } from '@luddjs/core'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { afterAll, describe, expect, it } from 'vitest'
import { execGuardrail } from '../exec-guardrail.js'

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ludd-exec-guardrail-'))
const subDir = path.join(tempDir, 'sub')
fs.mkdirSync(subDir, { recursive: true })

afterAll(() => {
  fs.rmSync(tempDir, { recursive: true, force: true })
})

function makeMockCtx(): StepContext {
  return {
    runId: 'r-1',
    environments: {},
    steps: {},
    step: {
      id: 's-1',
      output: { branch: 'feat' },
      attempt: 1,
    },
    matrix: undefined,
    artifacts: {} as any,
  }
}

function makeExecutionInput(
  overrides: Partial<GuardrailExecutionInput> = {},
): GuardrailExecutionInput {
  return {
    ctx: makeMockCtx(),
    stepId: 's-1',
    phase: 'afterStep',
    guardrailIndex: 0,
    attempt: 1,
    runDir: '/runs/1',
    cwd: tempDir,
    env: { BASE_VAR: 'base' },
    mcpServerUrl: 'http://localhost:3000',
    mcpAuthToken: 'token-abc',
    ...overrides,
  }
}

describe('execGuardrail host execution', () => {
  it('executes argv command in cwd with merged env + MCP vars and forwards pagination', async () => {
    const rail = execGuardrail({
      command: [
        process.execPath,
        '-e',
        'process.stdout.write(JSON.stringify({ cwd: process.cwd(), base: process.env.BASE_VAR, rail: process.env.RAIL_VAR, mcpUrl: process.env.MCP_SERVER_URL, mcpTok: process.env.MCP_AUTH_TOKEN, arg: process.argv[1] }))',
        '$HOME && literal',
      ],
      cwd: 'sub',
      env: { RAIL_VAR: 'override' },
      pagination: 'errors',
    })

    const verdict = await rail.execute(makeExecutionInput())

    expect(verdict.status).toBe('pass')
    expect(verdict.pagination).toBe('errors')
    expect(verdict.logFormat).toBe('json')
    expect(JSON.parse(verdict.rawLog!)).toEqual({
      cwd: fs.realpathSync(subDir),
      base: 'base',
      rail: 'override',
      mcpUrl: 'http://localhost:3000',
      mcpTok: 'token-abc',
      arg: '$HOME && literal',
    })
  })

  it('executes string shell commands and dynamic command functions', async () => {
    const rail = execGuardrail({
      command: (ctx: StepContext<any>) => `${JSON.stringify(process.execPath)} -e 'process.stdout.write(${JSON.stringify(ctx.step.output.branch)})'`,
    })

    const verdict = await rail.execute(makeExecutionInput({ mcpServerUrl: '', mcpAuthToken: '' }))

    expect(verdict.status).toBe('pass')
    expect(verdict.rawLog).toBe('feat')

    const silentRail = execGuardrail({
      command: [process.execPath, '-e', ''],
    })
    const silentVerdict = await silentRail.execute(makeExecutionInput())
    expect(silentVerdict.status).toBe('pass')
    expect(silentVerdict.rawLog).toBeUndefined()
  })

  it('maps non-zero exit code to fail and combines stdout and stderr into rawLog', async () => {
    const rail = execGuardrail({
      command: [
        process.execPath,
        '-e',
        'process.stdout.write("some info"); process.stderr.write("fatal error"); process.exit(1);',
      ],
    })
    const verdict = await rail.execute(makeExecutionInput())

    expect(verdict.status).toBe('fail')
    expect(verdict.rawLog).toBe('some info\nfatal error')
  })
})

describe('execGuardrail dynamic validation and signal cancellation', () => {
  it('rejects invalid dynamically resolved command values', async () => {
    for (const badCmd of [
      '',
      '   ',
      [],
      ['   ', 'arg'],
      [123],
      42,
    ]) {
      const rail = execGuardrail({
        command: (() => badCmd) as never,
      })
      await expect(rail.execute(makeExecutionInput())).rejects.toThrow(TypeError)
    }
  })

  it('terminates spawned command when input.signal aborts', async () => {
    const controller = new AbortController()
    setTimeout(() => controller.abort(new Error('guardrail-aborted')), 60)

    const rail = execGuardrail({
      command: [process.execPath, '-e', 'setInterval(() => {}, 1000)'],
    })

    await expect(rail.execute(makeExecutionInput({ signal: controller.signal }))).rejects.toThrow('guardrail-aborted')
  })
})
