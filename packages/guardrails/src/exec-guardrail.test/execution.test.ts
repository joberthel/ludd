import type {
  EnvironmentExecOptions,
  EnvironmentExecResult,
  GuardrailExecutionInput,
  ProvisionedEnvironment,
  StepContext,
} from '@ludd/core'
import { describe, expect, it } from 'vitest'
import { execGuardrail } from '../exec-guardrail.js'

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

function makeMockEnv(
  execMock: (cmd: any, opts?: any) => Promise<EnvironmentExecResult>,
): ProvisionedEnvironment {
  return {
    __kind: 'environment',
    id: 'mock-env',
    type: 'mock',
    workingDir: '/workspace',
    exec: execMock,
    ping: async () => true,
    teardown: async () => {},
  }
}

function makeExecutionInput(
  environment: ProvisionedEnvironment,
  mcpServerUrl = 'http://localhost:3000',
  mcpAuthToken = 'token-abc',
): GuardrailExecutionInput {
  return {
    ctx: makeMockCtx(),
    stepId: 's-1',
    phase: 'afterStep',
    guardrailIndex: 0,
    attempt: 1,
    runDir: '/runs/1',
    environment,
    mcpServerUrl,
    mcpAuthToken,
  }
}

describe('execGuardrail basic execution', () => {
  it('executes command, maps exitCode 0 to pass, and forwards pagination', async () => {
    let capturedCmd: any
    let capturedOpts: EnvironmentExecOptions | undefined
    const env = makeMockEnv(async (cmd, opts) => {
      capturedCmd = cmd
      capturedOpts = opts
      return {
        exitCode: 0,
        stdout: 'success',
        stderr: '',
        timedOut: false,
      }
    })
    const rail = execGuardrail({
      command: ['git', 'status'],
      pagination: 'errors',
    })

    const input = makeExecutionInput(env)
    const verdict = await rail.execute(input)

    expect(capturedCmd).toEqual(['git', 'status'])
    expect(capturedOpts?.env?.MCP_SERVER_URL).toBe('http://localhost:3000')
    expect(capturedOpts?.env?.MCP_AUTH_TOKEN).toBe('token-abc')
    expect(verdict.status).toBe('pass')
    expect(verdict.pagination).toBe('errors')
  })
})

describe('execGuardrail dynamic resolution and failure mapping', () => {
  it('resolves dynamic command function and converts timeout in seconds to timeoutMs', async () => {
    let capturedTimeout: number | undefined
    let capturedCmd: any
    const env = makeMockEnv(async (cmd, opts) => {
      capturedCmd = cmd
      capturedTimeout = opts?.timeoutMs
      return {
        exitCode: 0,
        stdout: '',
        stderr: '',
        timedOut: false,
      }
    })
    const rail = execGuardrail({
      command: (ctx: StepContext<any>) => `git checkout ${ctx.step.output.branch}`,
      timeout: 5,
    })

    const input = makeExecutionInput(env, '', '')
    const verdict = await rail.execute(input)

    expect(capturedCmd).toBe('git checkout feat')
    expect(capturedTimeout).toBe(5000)
    expect(verdict.status).toBe('pass')
  })

  it('maps non-zero exit code to fail and combines stdout and stderr into rawLog', async () => {
    const env = makeMockEnv(async () => ({
      exitCode: 1,
      stdout: 'some info',
      stderr: 'fatal error',
      timedOut: false,
    }))
    const rail = execGuardrail({ command: 'test' })
    const input = makeExecutionInput(env, '', '')
    const verdict = await rail.execute(input)

    expect(verdict.status).toBe('fail')
    expect(verdict.rawLog).toBe('some info\nfatal error')
  })
})
