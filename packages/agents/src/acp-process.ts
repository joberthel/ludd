import type { ClientConnection, McpServer } from '@agentclientprotocol/sdk'
import type { AgentTurnInput, AgentTurnResult } from '@luddjs/core'
import type { AcpMcpBridgeConfig } from './acp-mcp.js'
import type { AcpPermissionMode } from './acp-permissions.js'
import type { AcpChildProcess, ChildProcessMonitor } from './acp-process-monitor.js'
import { spawn } from 'node:child_process'
import process from 'node:process'
import { Readable as NodeReadable, Writable as NodeWritable } from 'node:stream'
import { client, methods, ndJsonStream, PROTOCOL_VERSION } from '@agentclientprotocol/sdk'
import { extractAbortError } from '@luddjs/core'
import { buildMcpBridgeServerConfig } from './acp-mcp.js'
import { buildPromptWithSchema, resolveStructuredOutput } from './acp-output.js'
import { handlePermissionRequest } from './acp-permissions.js'
import { createChildProcessMonitor, endChildStdin, noop, waitWithTimeout } from './acp-process-monitor.js'
import { createSessionUpdateCollector } from './acp-stream.js'

export const DEFAULT_SHUTDOWN_TIMEOUT_MS = 5000

export interface ExecuteAcpTurnParams {
  command: string
  args: readonly string[]
  env: Record<string, string>
  permissionMode: AcpPermissionMode
  shutdownTimeoutMs: number
  mcpBridge?: AcpMcpBridgeConfig
}

async function runAcpSessionTurn(
  connection: ClientConnection,
  params: ExecuteAcpTurnParams,
  input: AgentTurnInput<any>,
  onSessionCreated: (sessionId: string) => void,
): Promise<string> {
  await connection.agent.request(methods.agent.initialize, {
    protocolVersion: PROTOCOL_VERSION,
    clientCapabilities: {},
    clientInfo: { name: 'ludd', version: '0.1.1' },
  })

  const mcpServers: McpServer[] = input.mcp === undefined
    ? []
    : [
        buildMcpBridgeServerConfig(input.mcp, params.mcpBridge),
      ]

  const session = await connection.agent.request(methods.agent.session.new, {
    cwd: input.cwd,
    mcpServers,
  })
  onSessionCreated(session.sessionId)

  const promptText = buildPromptWithSchema(input.prompt, input.outputSchema)
  await connection.agent.request(methods.agent.session.prompt, {
    sessionId: session.sessionId,
    prompt: [
      { type: 'text', text: promptText },
    ],
  })
  return session.sessionId
}

function createAbortCoordinator(options: {
  signal: AbortSignal | undefined
  connection: ClientConnection
  monitor: ChildProcessMonitor
  protocolPromise: Promise<string>
  shutdownTimeoutMs: number
  getActiveSessionId: () => string | undefined
}) {
  let abortDeadline: number | undefined
  let abortPromise: Promise<void> | undefined
  let rejectAbort!: (error: Error) => void
  const cancelSignalPromise = new Promise<never>((_resolve, reject) => {
    rejectAbort = reject
  })

  const onAbort = (): void => {
    options.monitor.markSettled()
    abortDeadline = Date.now() + options.shutdownTimeoutMs
    abortPromise = (async () => {
      const sessionId = options.getActiveSessionId()
      if (sessionId !== undefined) {
        await options.connection.agent.notify(methods.agent.session.cancel, { sessionId }).catch(noop)
        await waitWithTimeout([
          options.protocolPromise.catch(noop),
          options.monitor.closedPromise,
        ], options.shutdownTimeoutMs)
      }
      rejectAbort(extractAbortError(options.signal!))
    })()
  }

  options.signal?.addEventListener('abort', onAbort, { once: true })

  return {
    cancelSignalPromise,
    cleanup: async () => {
      options.signal?.removeEventListener('abort', onAbort)
      if (abortPromise !== undefined) {
        await abortPromise
      }
    },
    getRemainingTimeoutMs: () => abortDeadline === undefined
      ? options.shutdownTimeoutMs
      : Math.max(0, abortDeadline - Date.now()),
  }
}

function connectAcpChild(
  child: AcpChildProcess,
  permissionMode: AcpPermissionMode,
  input: AgentTurnInput<any>,
) {
  const collector = createSessionUpdateCollector(input)
  const connection = client({ name: 'ludd' })
    .onRequest(methods.client.session.requestPermission, ({ params: req }) =>
      handlePermissionRequest(permissionMode, req))
    .onNotification(methods.client.session.update, ({ params: notification }) => {
      collector.onNotification(notification)
    })
    .connect(ndJsonStream(
      NodeWritable.toWeb(child.stdin) as WritableStream<Uint8Array>,
      NodeReadable.toWeb(child.stdout) as ReadableStream<Uint8Array>,
    ))
  return { collector, connection }
}

/** Spawns an ACP CLI subprocess, executes one full ACP turn, and guarantees process cleanup. */
export async function executeAcpTurn<TOutput>(
  params: ExecuteAcpTurnParams,
  input: AgentTurnInput<any>,
): Promise<AgentTurnResult<TOutput>> {
  if (input.signal?.aborted) {
    throw extractAbortError(input.signal)
  }

  const child = spawn(params.command, [...params.args], {
    cwd: input.cwd,
    env: {
      ...process.env,
      ...input.env,
      ...params.env,
    },
    stdio: ['pipe', 'pipe', 'pipe'],
    detached: process.platform !== 'win32',
  })
  const monitor = createChildProcessMonitor(child, params.command)
  const { collector, connection } = connectAcpChild(child, params.permissionMode, input)

  let activeSessionId: string | undefined
  const protocolPromise = runAcpSessionTurn(connection, params, input, (sessionId) => {
    activeSessionId = sessionId
  })
  protocolPromise.catch(noop)

  const abort = createAbortCoordinator({
    signal: input.signal,
    connection,
    monitor,
    protocolPromise,
    shutdownTimeoutMs: params.shutdownTimeoutMs,
    getActiveSessionId: () => activeSessionId,
  })

  let resolvedSessionId: string
  try {
    resolvedSessionId = await Promise.race([
      protocolPromise,
      monitor.failurePromise,
      abort.cancelSignalPromise,
    ])
    monitor.markSettled()
    if (input.signal?.aborted) {
      throw extractAbortError(input.signal)
    }
  }
  catch (err) {
    if (!input.signal?.aborted && connection.signal.aborted) {
      endChildStdin(child)
      await monitor.ensureExited(params.shutdownTimeoutMs)
      throw monitor.getFailureError()
    }
    monitor.markSettled()
    throw err
  }
  finally {
    monitor.markSettled()
    await abort.cleanup()
    connection.close()
    endChildStdin(child)
    await monitor.ensureExited(abort.getRemainingTimeoutMs())
  }

  return {
    output: resolveStructuredOutput<TOutput>(input.stepId, collector.getAssistantText(), input.outputSchema),
    sessionId: resolvedSessionId,
  }
}
