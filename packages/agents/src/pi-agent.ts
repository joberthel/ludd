import type {
  AgentAccessMode,
  AgentRunner,
  AgentStreamEventType,
  AgentTurnInput,
  AgentTurnResult,
  DynamicProperty,
  StepContext,
} from '@ludd/core'
import type { PiSession, PiSessionEvent, PiSessionFactory, PiSessionFactoryOptions } from './types/pi-sdk.js'
import path from 'node:path'
import { createAgentSession, DefaultResourceLoader, getAgentDir, SessionManager } from '@earendil-works/pi-coding-agent'
import { appendStreamEvent } from '@ludd/core'
import { READ_ONLY_EXCLUDED_TOOLS, readOnlyExtension } from './security/read-only-extension.js'

export interface PiAgentConfig<TContext extends StepContext<any, any, any, any> = StepContext<any, any, any, any>> {
  mode?: AgentAccessMode
  prompt: DynamicProperty<string, TContext>
  sessionId?: DynamicProperty<string | undefined, TContext>
  /** Pi SDK model object forwarded to `createAgentSession`. */
  model?: unknown
  /** Overrides the real Pi SDK session creation (used by tests). */
  sessionFactory?: PiSessionFactory
}

export const defaultPiSessionFactory: PiSessionFactory = async (options: PiSessionFactoryOptions) => {
  const sessionManager = SessionManager.open(options.sessionFile, path.dirname(options.sessionFile), options.cwd)
  const readOnly = options.mode === 'read-only'
  let resourceLoader: DefaultResourceLoader | undefined
  if (readOnly) {
    resourceLoader = new DefaultResourceLoader({
      cwd: options.cwd,
      agentDir: getAgentDir(),
      extensionFactories: [
        readOnlyExtension(options.cwd),
      ],
    })
    await resourceLoader.reload()
  }
  const { session } = await createAgentSession({
    cwd: options.cwd,
    sessionManager,
    ...(options.model === undefined
      ? {}
      : { model: options.model as never }),
    ...(resourceLoader === undefined
      ? {}
      : { resourceLoader, excludeTools: READ_ONLY_EXCLUDED_TOOLS }),
  })
  if (readOnly) {
    await session.bindExtensions({})
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

async function runTurn(session: PiSession, input: AgentTurnInput<any>): Promise<void> {
  let settle!: () => void
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
  }
  finally {
    input.signal?.removeEventListener('abort', onAbort)
    unsubscribe()
  }
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
    executeTurn: async (input: AgentTurnInput<any>): Promise<AgentTurnResult<TOutput>> => {
      const session = await factory({
        cwd: input.environment.workingDir,
        sessionFile: path.join(input.runDir, 'pi-sessions', `${input.sessionId}.jsonl`),
        mode: input.mode,
        model: config.model,
      })
      await runTurn(session, input)
      return {
        output: (session.getLastAssistantText() ?? '') as TOutput,
        sessionId: input.sessionId,
      }
    },
  }
}
