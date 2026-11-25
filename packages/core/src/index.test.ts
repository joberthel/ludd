import type {
  AgentStreamEvent,
  AgentStreamEventType,
  CreateHarnessOptions,
  ExecuteWithHarnessLifecycleOptions,
  GcOptions,
  GcResult,
  HarnessExecutionConfig,
  HostSpawnOptions,
  HostSpawnResult,
  JsonRpcRequest,
  JsonRpcResponse,
  LedgerEvent,
  LedgerEventType,
  MatrixArtifactConfig,
  MatrixConfig,
  MatrixItemsConfig,
  ResolvedExecutionContext,
  ResolveExecutionContextOptions,
  ResolveRunExecutionContextOptions,
  ResolveStepExecutionContextOptions,
  RunLifecycleContext,
  SetupResult,
  StepContext,
} from './index.js'
import { describe, expect, it } from 'vitest'
import * as core from './index.js'

describe('@luddjs/core harness and configuration exports', () => {
  it('exports harness configuration factory and utilities', () => {
    expect(typeof core.defineHarness).toBe('function')
    expect(typeof core.validateHarnessConfig).toBe('function')
    expect(typeof core.loadHarnessConfig).toBe('function')
    expect(typeof core.runHarness).toBe('function')
    expect(typeof core.isAgentRunner).toBe('function')
    expect(typeof core.executeAgentStep).toBe('function')
    expect(typeof core.createAgentStepOutput).toBe('function')
    expect(typeof core.validateStepOutput).toBe('function')
    expect(typeof core.createArtifactStore).toBe('function')
    expect(typeof core.startEmbeddedMcpServer).toBe('function')
    expect(typeof core.createDefaultHostEnvironment).toBe('function')
    expect(typeof core.createDockerWorktreeEnvironmentFromDescriptor).toBe('function')
    expect(typeof core.createGitWorktreeEnvironmentFromDescriptor).toBe('function')
    expect(typeof core.createHostEnvironmentFromDescriptor).toBe('function')
    expect(typeof core.recordEnvironment).toBe('function')
    expect(typeof core.rehydrateEnvironmentsAndCheckHealth).toBe('function')
    expect(typeof core.resolveStepEnvironment).toBe('function')
    expect(typeof core.resolveGuardrailEnvironment).toBe('function')
    expect(typeof core.EnvironmentUnreachableError).toBe('function')
    expect(typeof core.ForbiddenMountPathError).toBe('function')
    expect(typeof core.HarnessConfigError).toBe('function')
    expect(typeof core.HarnessConfigLoadError).toBe('function')
    expect(typeof core.RunAlreadyActiveError).toBe('function')
    expect(typeof core.StepOutputValidationError).toBe('function')
    expect(typeof core.StepArtifactValidationError).toBe('function')
    expect(typeof core.StepMatrixResolutionError).toBe('function')
    expect(typeof core.GuardrailMaxRetriesExceededError).toBe('function')
    expect(typeof core.UnsafeDangerModeError).toBe('function')
    expect(typeof core.isEnvironmentAdapter).toBe('function')
    expect(typeof core.isProvisionedEnvironment).toBe('function')
    expect(typeof core.isGuardrail).toBe('function')
    expect(core.DEFAULT_MAX_TOTAL_TURNS).toBe(Number.POSITIVE_INFINITY)
    expect(typeof core.MaxTotalTurnsExceededError).toBe('function')
    expect(typeof core.formatRetryPrompt).toBe('function')
    expect(typeof core.formatArtifactRetryPrompt).toBe('function')
    expect(typeof core.validateStepArtifacts).toBe('function')
    expect(typeof core.determineEscalationPolicy).toBe('function')
    expect(typeof core.formatEscalationPrompt).toBe('function')
    expect(typeof core.handleGuardrailEscalation).toBe('function')
    expect(typeof core.resolveMatrixItems).toBe('function')
    expect(typeof core.executeMatrixStep).toBe('function')
    expect(typeof core.teardownRun).toBe('function')
    expect(typeof core.spawn).toBe('function')
    expect(typeof core.resolveRunExecutionContext).toBe('function')
    expect(typeof core.resolveStepExecutionContext).toBe('function')
    expect(typeof core.resolveExecutionContext).toBe('function')
    expect(typeof core.executeWithHarnessLifecycle).toBe('function')
  })
})

describe('@luddjs/core gc exports', () => {
  it('exports gc function and verifies contracts', () => {
    expect(typeof core.gc).toBe('function')
    const opts: GcOptions = {
      workspaceDir: '/tmp',
      olderThan: '1h',
      status: ['passed'],
      dryRun: true,
    }
    const res: GcResult = {
      cleanedRunIds: ['run-1'],
      skippedActiveRunIds: [],
    }
    expect(opts.workspaceDir).toBe('/tmp')
    expect(res.cleanedRunIds).toHaveLength(1)
  })
})

describe('@luddjs/core dynamic property and legacy exports', () => {
  it('exports resolveDynamicProperty as a function', () => {
    expect(typeof core.resolveDynamicProperty).toBe('function')
  })
  it('does not export deprecated placeholder foo or bar', () => {
    expect((core as Record<string, unknown>).foo).toBeUndefined()
    expect((core as Record<string, unknown>).bar).toBeUndefined()
  })

  it('resolves dynamic property via index export', async () => {
    const ctx = {
      runId: 'r-1',
      environments: {},
      steps: {},
      step: { id: 's-1', output: null, attempt: 1 },
      matrix: undefined,
      artifacts: {} as core.ArtifactClient,
    } satisfies StepContext
    const resolved = await core.resolveDynamicProperty((c: StepContext) => c.runId, ctx)
    expect(resolved).toBe('r-1')
  })
})

describe('@luddjs/core persistence and execution exports', () => {
  it('exports state store, pid lock, ledger, and stream persistence utilities', () => {
    expect(typeof core.resolveRunDir).toBe('function')
    expect(typeof core.writeRunStateAtomic).toBe('function')
    expect(typeof core.readRunState).toBe('function')
    expect(typeof core.appendLedgerEvent).toBe('function')
    expect(typeof core.readLedgerEvents).toBe('function')
    expect(typeof core.appendStreamEvent).toBe('function')
    expect(typeof core.readStreamEvents).toBe('function')
    expect(typeof core.resolveStreamPath).toBe('function')
    expect(typeof core.acquireRunPidLock).toBe('function')
    expect(typeof core.releaseRunPidLock).toBe('function')
    expect(typeof core.isProcessAlive).toBe('function')
    expect(core.RUNNER_PID_FILE).toBe('runner.pid')
    expect(core.SUPPORTED_SCHEMA_VERSION).toBe(1)
    expect(typeof core.SchemaVersionMismatchError).toBe('function')
  })
})

describe('@luddjs/core IPC exports', () => {
  it('exports control client, server, and socket path helpers', () => {
    expect(typeof core.createControlClient).toBe('function')
    expect(typeof core.startControlServer).toBe('function')
    expect(typeof core.createGateResolveHandler).toBe('function')
    expect(typeof core.validateGateResolveParams).toBe('function')
    expect(typeof core.createRunAbortHandler).toBe('function')
    expect(typeof core.createRunTeardownHandler).toBe('function')
    expect(typeof core.validateRunAbortParams).toBe('function')
    expect(typeof core.validateRunTeardownParams).toBe('function')
    expect(typeof core.createGateWaiter).toBe('function')
    expect(typeof core.getControlSocketPath).toBe('function')
    expect(core.CONTROL_SOCKET_NAME).toBe('control.sock')
    expect(typeof core.JsonRpcResponseError).toBe('function')
  })

  it('exports JSON-RPC 2.0 error codes and constants', () => {
    expect(core.JSON_RPC_PARSE_ERROR).toBe(-32700)
    expect(core.JSON_RPC_INVALID_REQUEST).toBe(-32600)
    expect(core.JSON_RPC_METHOD_NOT_FOUND).toBe(-32601)
    expect(core.JSON_RPC_INVALID_PARAMS).toBe(-32602)
    expect(core.JSON_RPC_INTERNAL_ERROR).toBe(-32603)
    expect(core.JSON_RPC_ERRORS.PARSE_ERROR).toBe(-32700)
  })

  it('exports typed JSON-RPC request and response types', () => {
    const req: JsonRpcRequest = { jsonrpc: '2.0', id: 1, method: 'run.status' }
    const res: JsonRpcResponse<string> = { jsonrpc: '2.0', id: 1, result: 'ok' }
    expect(req.method).toBe('run.status')
    expect(res.id).toBe(1)
  })
})

describe('@luddjs/core typed structures and matrix exports', () => {
  it('exports typed stream structures', () => {
    const eventType: AgentStreamEventType = 'turn.started'
    const event: AgentStreamEvent<{ prompt: string }> = {
      schemaVersion: 1,
      timestamp: new Date().toISOString(),
      runId: 'r-1',
      stepId: 's-1',
      sessionId: 'sess-1',
      attempt: 1,
      eventType,
      payload: { prompt: 'hello' },
    }
    expect(event.schemaVersion).toBe(1)
    expect(event.eventType).toBe('turn.started')
    expect(event.payload.prompt).toBe('hello')
  })

  it('exports typed ledger structures', () => {
    const eventType: LedgerEventType = 'run.started'
    const event: LedgerEvent<{ test: boolean }> = {
      schemaVersion: 1,
      timestamp: new Date().toISOString(),
      runId: 'r-1',
      stepId: null,
      eventType,
      payload: { test: true },
    }
    expect(event.schemaVersion).toBe(1)
    expect(event.eventType).toBe('run.started')
    expect(event.payload.test).toBe(true)
  })

  it('exports typed matrix configuration structures', () => {
    const itemsConfig: MatrixItemsConfig<number> = {
      items: [1, 2, 3],
    }
    const artifactConfig: MatrixArtifactConfig = { itemsFromArtifact: 'todos.json' }
    const unionConfig1: MatrixConfig<number> = itemsConfig
    const unionConfig2: MatrixConfig = artifactConfig
    expect(unionConfig1.items).toEqual([1, 2, 3])
    expect(unionConfig2.itemsFromArtifact).toBe('todos.json')
  })

  it('exports explicit host execution config and spawn types', () => {
    const lifecycleCtx: RunLifecycleContext = {
      runId: 'r-1',
      workspaceRoot: '/tmp',
      signal: new AbortController().signal,
    }
    const setupResult: SetupResult = {
      cwd: '/tmp/wt',
      env: { WT: '1' },
    }
    const execCfg: HarnessExecutionConfig = {
      cwd: '/tmp',
      env: { A: '1' },
    }
    const createOpts: CreateHarnessOptions = {
      ...execCfg,
      cleanupPolicy: { onSuccess: 'destroy' },
    }
    const spawnOpts: HostSpawnOptions = {
      command: 'node',
      args: ['-v'],
    }
    const spawnRes: HostSpawnResult = {
      exitCode: 0,
      signal: null,
      stdout: '',
      stderr: '',
      timedOut: false,
    }
    const resolved: ResolvedExecutionContext = { cwd: '/tmp', env: {} }
    const runOpts: ResolveRunExecutionContextOptions = { config: execCfg, lifecycleCtx, setupResult }
    const stepOpts: ResolveStepExecutionContextOptions = {
      step: {},
      stepCtx: {} as StepContext,
      runExecutionContext: resolved,
    }
    const combinedOpts: ResolveExecutionContextOptions = { config: execCfg, lifecycleCtx }
    const lifecycleOpts: ExecuteWithHarnessLifecycleOptions<void> = {
      config: execCfg,
      lifecycleCtx,
      run: () => {},
    }
    expect(createOpts.cwd).toBe('/tmp')
    expect(spawnOpts.command).toBe('node')
    expect(spawnRes.exitCode).toBe(0)
    expect(runOpts.lifecycleCtx.runId).toBe('r-1')
    expect(stepOpts.runExecutionContext.cwd).toBe('/tmp')
    expect(combinedOpts.config.env).toEqual({ A: '1' })
    expect(lifecycleOpts.lifecycleCtx.workspaceRoot).toBe('/tmp')
  })
})
