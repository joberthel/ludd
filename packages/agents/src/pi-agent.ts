import type {
  AgentAccessMode,
  AgentRunner,
  AgentStreamEventType,
  AgentTurnInput,
  AgentTurnResult,
  DynamicProperty,
  StepContext,
} from '@luddjs/core'
import type { PiSession, PiSessionEvent, PiSessionFactory, PiSessionFactoryOptions } from './types/pi-sdk.js'
import path from 'node:path'
import { createAgentSession, DefaultResourceLoader, getAgentDir, resolveCliModel, SessionManager } from '@earendil-works/pi-coding-agent'
import { appendStreamEvent, StepOutputValidationError } from '@luddjs/core'
import { createMcpBridgeTools, createSubmitStepOutputTool, MISSING_SUBMISSION_ISSUE } from './mcp/pi-mcp-tools.js'
import { environmentBashTool } from './security/environment-bash.js'
import { READ_ONLY_EXCLUDED_TOOLS, readOnlyExtension } from './security/read-only-extension.js'
import { workspaceWriteExtension } from './security/workspace-write-extension.js'

export interface PiAgentConfig<TContext extends StepContext<any, any, any, any> = StepContext<any, any, any, any>> {
  mode?: AgentAccessMode
  prompt: DynamicProperty<string, TContext>
  sessionId?: DynamicProperty<string | undefined, TContext>
  /** Pi SDK model object or model pattern string (e.g. `"provider/model-id"` or `"model-id"`). */
  model?: unknown
  /** Overrides the real Pi SDK session creation (used by tests). */
  sessionFactory?: PiSessionFactory
}

async function applyStringModel(
  session: Awaited<ReturnType<typeof createAgentSession>>['session'],
  model: string,
): Promise<void> {
  const resolved = resolveCliModel({ cliModel: model, modelRuntime: session.modelRuntime })
  if (resolved.error !== undefined || resolved.model === undefined) {
    session.dispose()
    throw new Error(resolved.error ?? `Unknown Pi model: ${model}`)
  }
  await session.setModel(resolved.model)
  if (resolved.thinkingLevel !== undefined) {
    session.setThinkingLevel(resolved.thinkingLevel)
  }
}

export const defaultPiSessionFactory: PiSessionFactory = async (options: PiSessionFactoryOptions) => {
  const sessionManager = SessionManager.open(options.sessionFile, path.dirname(options.sessionFile), options.cwd)
  const readOnly = options.mode === 'read-only'
  const resourceLoader = new DefaultResourceLoader({
    cwd: options.cwd,
    agentDir: getAgentDir(),
    extensionFactories: [
      readOnly
        ? readOnlyExtension(options.cwd)
        : workspaceWriteExtension(options.cwd),
    ],
  })
  await resourceLoader.reload()
  const bashTool = readOnly
    ? undefined
    : environmentBashTool({
        cwd: options.cwd,
        env: options.env,
        signal: options.signal,
      })
  const customTools = [
    ...(bashTool === undefined
      ? []
      : [bashTool]),
    ...(options.customTools ?? []),
  ]
  const isStringModel = typeof options.model === 'string'
  const { session } = await createAgentSession({
    cwd: options.cwd,
    sessionManager,
    ...(options.model === undefined || isStringModel
      ? {}
      : { model: options.model as never }),
    resourceLoader,
    ...(readOnly
      ? { excludeTools: READ_ONLY_EXCLUDED_TOOLS }
      : {}),
    ...(customTools.length === 0
      ? {}
      : { customTools }),
  })
  await session.bindExtensions({})
  if (isStringModel) {
    await applyStringModel(session, options.model as string)
  }
  return session
}

interface MappedEvent {
  eventType: AgentStreamEventType
  payload: Record<string, unknown>
}

function mapToolEvent(event: PiSessionEvent): MappedEvent {
  const base = { toolCallId: event.toolCallId, toolName: event.toolName }
  if (event.type === 'tool_execution_start') {
    return {
      eventType: 'tool_call',
      payload: { phase: 'start', ...base, args: event.args },
    }
  }
  if (event.type === 'tool_execution_update') {
    return {
      eventType: 'tool_call',
      payload: { phase: 'update', ...base, partialResult: event.partialResult },
    }
  }
  return {
    eventType: 'tool_call',
    payload: {
      phase: 'end',
      ...base,
      result: event.result,
      isError: event.isError,
    },
  }
}

function mapEvent(event: PiSessionEvent): MappedEvent | undefined {
  switch (event.type) {
    case 'message_update': {
      const inner = event.assistantMessageEvent
      if (inner?.type === 'text_delta') {
        return {
          eventType: 'message_chunk',
          payload: { text: inner.delta },
        }
      }
      if (inner?.type === 'thinking_delta') {
        return {
          eventType: 'thought',
          payload: { text: inner.delta },
        }
      }
      return undefined
    }
    case 'tool_execution_start':
    case 'tool_execution_update':
    case 'tool_execution_end':
      return mapToolEvent(event)
    default:
      return undefined
  }
}

function resolveAssistantError(event: PiSessionEvent, previous: string | undefined): string | undefined {
  if (event.type !== 'message_end' || event.message?.role !== 'assistant') {
    return previous
  }
  if (event.message.stopReason !== 'error') {
    return undefined
  }
  const detail = event.message.errorMessage?.trim()
  return detail !== undefined && detail.length > 0
    ? detail
    : 'Pi agent turn failed with an unknown error.'
}

async function runTurn(session: PiSession, input: AgentTurnInput<any>): Promise<void> {
  let settle!: () => void
  let lastAssistantError: string | undefined
  const settled = new Promise<void>((resolve) => {
    settle = resolve
  })
  const unsubscribe = session.subscribe((event) => {
    const mapped = mapEvent(event)
    if (mapped) {
      appendStreamEvent(input.runDir, input.sessionId, {
        schemaVersion: 1,
        timestamp: new Date().toISOString(),
        runId: (input.ctx as StepContext).runId,
        stepId: input.stepId,
        sessionId: input.sessionId,
        attempt: input.attempt,
        ...mapped,
      })
    }
    lastAssistantError = resolveAssistantError(event, lastAssistantError)
    if (event.type === 'agent_settled') {
      settle()
    }
  })
  const onAbort = (): void => {
    void session.abort().then(settle, settle)
  }
  input.signal?.addEventListener('abort', onAbort, { once: true })
  try {
    if (input.signal?.aborted) {
      onAbort()
    }
    else {
      await session.prompt(input.prompt).catch((err: unknown) => {
        if (!input.signal?.aborted) {
          throw err
        }
      })
    }
    await settled
    if (!input.signal?.aborted && lastAssistantError !== undefined) {
      throw new Error(lastAssistantError)
    }
  }
  finally {
    input.signal?.removeEventListener('abort', onAbort)
    unsubscribe()
  }
}

function promptWithOutputSubmission(prompt: string): string {
  return `${prompt}\n\nThe harness requires structured output for this step. Submit the result by calling the available submit_step_output tool with a value matching its parameters. Do not return the result as plain text. If validation reports an issue, correct the value and submit it again.`
}

/**
 * Production agent adapter wrapping the Pi coding-agent SDK. Sessions are
 * persisted at `<runDir>/pi-sessions/<sessionId>.jsonl` and resumed when the
 * harness passes a `sessionId` that already has a file.
 */
export function piAgent<
  TOutput = string,
  TContext extends StepContext<any, any, any, any> = StepContext,
>(config: PiAgentConfig<TContext>): AgentRunner<TOutput, TContext> {
  const factory = config.sessionFactory ?? defaultPiSessionFactory
  return {
    __kind: 'agent',
    mode: config.mode ?? 'read-only',
    prompt: config.prompt,
    sessionId: config.sessionId,
    executeTurn: async input => executePiTurn<TOutput>(config, factory, input),
  }
}

async function executePiTurn<TOutput>(
  config: PiAgentConfig<any>,
  factory: PiSessionFactory,
  input: AgentTurnInput<any>,
): Promise<AgentTurnResult<TOutput>> {
  const submit = input.outputSchema === undefined
    ? undefined
    : createSubmitStepOutputTool(input.outputSchema)
  const customTools = [
    ...(input.mcpServerUrl === ''
      ? []
      : createMcpBridgeTools({
          url: input.mcpServerUrl,
          authToken: input.mcpAuthToken,
          interactive: input.interactive,
        })),
    ...(submit === undefined
      ? []
      : [submit.tool]),
  ]
  const session = await factory({
    cwd: input.cwd,
    env: input.env,
    signal: input.signal,
    sessionFile: path.join(input.runDir, 'pi-sessions', `${input.sessionId}.jsonl`),
    mode: input.mode,
    dangerMode: input.dangerMode,
    model: config.model,
    ...(customTools.length === 0
      ? {}
      : { customTools }),
  })
  try {
    await runTurn(session, submit === undefined
      ? input
      : {
          ...input,
          prompt: promptWithOutputSubmission(input.prompt),
        })
  }
  finally {
    session.dispose?.()
  }
  if (submit === undefined) {
    return {
      output: (session.getLastAssistantText() ?? '') as TOutput,
      sessionId: input.sessionId,
    }
  }
  const submission = submit.getSubmission()
  if (submission === undefined) {
    throw new StepOutputValidationError(input.stepId, session.getLastAssistantText(), [MISSING_SUBMISSION_ISSUE])
  }
  return { output: submission.value as TOutput, sessionId: input.sessionId }
}
