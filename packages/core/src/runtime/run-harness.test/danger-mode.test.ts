import type { AgentRunner, AgentTurnInput, ProvisionedEnvironment } from '../../index.js'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { UnsafeDangerModeError } from '../../errors/unsafe-danger-mode-error.js'
import { runHarness } from '../run-harness.js'

let tempDir: string

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), 'ludd-danger-mode-test-'))
})

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true })
  vi.restoreAllMocks()
})

function createMockEnv(type: string, supportsDangerMode?: boolean): ProvisionedEnvironment {
  return {
    __kind: 'environment',
    id: `${type}-env`,
    type,
    workingDir: tempDir,
    supportsDangerMode,
    exec: vi.fn().mockResolvedValue({
      exitCode: 0,
      stdout: 'ok',
      stderr: '',
      timedOut: false,
    }),
    ping: vi.fn().mockResolvedValue(true),
    teardown: vi.fn().mockResolvedValue(undefined),
  }
}

describe('runHarness dangerMode host rejection (ADR-0009)', () => {
  it('fails with UnsafeDangerModeError when dangerMode: true on default host environment', async () => {
    const result = await runHarness({
      name: 'default-host-danger',
      steps: [
        {
          id: 'step-danger-default',
          dangerMode: true,
          run: async () => 'not-reached',
        },
      ],
    }, { workspaceDir: tempDir })

    expect(result.status).toBe('failed')
    expect(result.failedStepId).toBe('step-danger-default')
    expect(result.error).toBeInstanceOf(UnsafeDangerModeError)
    const err = result.error as UnsafeDangerModeError
    expect(err.stepId).toBe('step-danger-default')
    expect(err.environmentType).toBe('host')
  })

  it('fails with UnsafeDangerModeError when dangerMode: true on explicit host environment', async () => {
    const hostEnv = createMockEnv('host', false)
    const result = await runHarness({
      name: 'explicit-host-danger',
      steps: [
        {
          id: 'step-danger-host',
          environment: hostEnv,
          dangerMode: true,
          run: async () => 'not-reached',
        },
      ],
    }, { workspaceDir: tempDir })

    expect(result.status).toBe('failed')
    expect(result.failedStepId).toBe('step-danger-host')
    expect(result.error).toBeInstanceOf(UnsafeDangerModeError)
    const err = result.error as UnsafeDangerModeError
    expect(err.stepId).toBe('step-danger-host')
    expect(err.environmentType).toBe('host')
  })
})

describe('runHarness dangerMode gitWorktree rejection (ADR-0009)', () => {
  it('fails with UnsafeDangerModeError when dangerMode: true on gitWorktree environment', async () => {
    const gitEnv = createMockEnv('git-worktree')
    const result = await runHarness({
      name: 'git-worktree-danger',
      steps: [
        {
          id: 'step-danger-git',
          environment: gitEnv,
          dangerMode: true,
          run: async () => 'not-reached',
        },
      ],
    }, { workspaceDir: tempDir })

    expect(result.status).toBe('failed')
    expect(result.failedStepId).toBe('step-danger-git')
    expect(result.error).toBeInstanceOf(UnsafeDangerModeError)
    const err = result.error as UnsafeDangerModeError
    expect(err.stepId).toBe('step-danger-git')
    expect(err.environmentType).toBe('git-worktree')
  })
})

describe('runHarness dangerMode safe steps (ADR-0009)', () => {
  it('succeeds when dangerMode: false or omitted on host environment', async () => {
    const result = await runHarness({
      name: 'safe-host',
      steps: [
        {
          id: 'step-explicit-false',
          dangerMode: false,
          run: async () => 'ok-1',
        },
        {
          id: 'step-omitted',
          run: async () => 'ok-2',
        },
      ],
    }, { workspaceDir: tempDir })

    expect(result.status).toBe('passed')
    expect(result.steps['step-explicit-false']?.output).toBe('ok-1')
    expect(result.steps['step-omitted']?.output).toBe('ok-2')
  })
})

describe('runHarness dangerMode forwarding to agent (ADR-0009)', () => {
  it('succeeds and forwards dangerMode to env.exec and agent execution', async () => {
    const dockerEnv = createMockEnv('docker-worktree', true)
    let capturedTurnInput: AgentTurnInput | undefined

    const agent: AgentRunner<string> = {
      __kind: 'agent',
      mode: 'workspace-write',
      prompt: 'do privileged work',
      executeTurn: async (input) => {
        capturedTurnInput = input
        await input.environment.exec([
          'apt-get',
          'install',
          '-y',
          'build-essential',
        ])
        return { output: 'installed', sessionId: input.sessionId }
      },
    }

    const result = await runHarness({
      name: 'docker-danger-success',
      steps: [
        {
          id: 'step-docker-danger',
          environment: dockerEnv,
          dangerMode: true,
          run: agent,
        },
      ],
    }, { workspaceDir: tempDir })

    expect(result.status).toBe('passed')
    expect(capturedTurnInput?.dangerMode).toBe(true)
    expect(dockerEnv.exec).toHaveBeenCalledWith(
      [
        'apt-get',
        'install',
        '-y',
        'build-essential',
      ],
      expect.objectContaining({ dangerMode: true }),
    )

    await capturedTurnInput?.environment.exec(['ls'], { dangerMode: false })
    expect(dockerEnv.exec).toHaveBeenLastCalledWith(
      ['ls'],
      expect.objectContaining({ dangerMode: false }),
    )
  })
})

describe('runHarness dangerMode forwarding false to agent (ADR-0009)', () => {
  it('forwards dangerMode: false to agent and env.exec when step has dangerMode: false', async () => {
    const dockerEnv = createMockEnv('docker-worktree', true)
    let capturedTurnInput: AgentTurnInput | undefined

    const agent: AgentRunner<string> = {
      __kind: 'agent',
      mode: 'read-only',
      prompt: 'safe agent',
      executeTurn: async (input) => {
        capturedTurnInput = input
        await input.environment.exec(['echo', 'safe'])
        return { output: 'safe-done', sessionId: input.sessionId }
      },
    }

    const result = await runHarness({
      name: 'docker-danger-false',
      steps: [
        {
          id: 'step-docker-safe',
          environment: dockerEnv,
          dangerMode: false,
          run: agent,
        },
      ],
    }, { workspaceDir: tempDir })

    expect(result.status).toBe('passed')
    expect(capturedTurnInput?.dangerMode).toBe(false)
    expect(dockerEnv.exec).toHaveBeenCalledWith(
      ['echo', 'safe'],
      expect.objectContaining({ dangerMode: false }),
    )
  })
})
