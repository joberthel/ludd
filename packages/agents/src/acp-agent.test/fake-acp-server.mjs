import { spawn } from 'node:child_process'
import fs from 'node:fs'
import process from 'node:process'
import { Readable, Writable } from 'node:stream'
import { agent, methods, ndJsonStream, PROTOCOL_VERSION, RequestError } from '@agentclientprotocol/sdk'

const pidFile = process.env.FAKE_ACP_PID_FILE
if (pidFile) {
  fs.writeFileSync(pidFile, String(process.pid), 'utf8')
}

const scenario = process.env.FAKE_ACP_SCENARIO ?? 'plain'

if (process.env.FAKE_ACP_IGNORE_SIGTERM === '1') {
  process.on('SIGTERM', () => {})
}

function callStdioMcpTool(mcpServer) {
  return new Promise((resolve, reject) => {
    const childEnv = { ...process.env }
    for (const entry of mcpServer.env ?? []) {
      childEnv[entry.name] = entry.value
    }
    const mcpChild = spawn(mcpServer.command, mcpServer.args ?? [], {
      env: childEnv,
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    let stdoutBuffer = ''
    let stderrBuffer = ''
    let done = false

    const finish = (err, result) => {
      if (done) {
        return
      }
      done = true
      if (!mcpChild.stdin.destroyed && !mcpChild.stdin.writableEnded) {
        mcpChild.stdin.end()
      }
      if (err) {
        mcpChild.kill('SIGKILL')
        reject(err)
      }
      else {
        resolve(result)
      }
    }

    mcpChild.on('error', err => finish(err))
    mcpChild.stderr.setEncoding('utf8')
    mcpChild.stderr.on('data', (chunk) => {
      stderrBuffer += chunk
    })
    mcpChild.stdout.setEncoding('utf8')
    mcpChild.stdout.on('data', (chunk) => {
      stdoutBuffer += chunk
      const lines = stdoutBuffer.split('\n')
      stdoutBuffer = lines.pop() ?? ''
      for (const rawLine of lines) {
        const line = rawLine.trim()
        if (!line) {
          continue
        }
        const msg = JSON.parse(line)
        if (msg.id === 1) {
          mcpChild.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`)
          mcpChild.stdin.write(`${JSON.stringify({
            jsonrpc: '2.0',
            id: 2,
            method: 'tools/call',
            params: {
              name: 'put_artifact',
              arguments: { key: 'acp-note', content: 'hello-from-mcp' },
            },
          })}\n`)
        }
        else if (msg.id === 2) {
          if (msg.error) {
            finish(new Error(msg.error.message ?? 'MCP tool call failed'))
          }
          else {
            finish(null, msg.result)
          }
        }
      }
    })
    mcpChild.once('close', (code) => {
      if (!done) {
        finish(new Error(`MCP bridge exited prematurely with code ${String(code)}: ${stderrBuffer}`))
      }
    })

    mcpChild.stdin.write(`${JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: { name: 'fake-acp-server', version: '1.0.0' },
      },
    })}\n`)
  })
}

const sessions = new Map()
const activeCancels = new Map()
let sessionCounter = 0

const app = agent({ name: 'fake-acp-server' })
  .onRequest(methods.agent.initialize, () => {
    if (scenario === 'init-error') {
      throw RequestError.internalError(undefined, 'init boom')
    }
    return {
      protocolVersion: PROTOCOL_VERSION,
      agentCapabilities: { loadSession: true },
      agentInfo: { name: 'fake-acp-server', version: '1.0.0' },
    }
  })
  .onRequest(methods.agent.session.new, ({ params }) => {
    sessionCounter += 1
    const sessionId = `fake-session-${sessionCounter}`
    sessions.set(sessionId, { cwd: params.cwd, mcpServers: params.mcpServers })
    return { sessionId }
  })
  .onRequest(methods.agent.session.load, ({ params }) => {
    sessions.set(params.sessionId, { cwd: params.cwd, mcpServers: params.mcpServers })
    return {}
  })
  .onNotification(methods.agent.session.cancel, ({ params }) => {
    if (process.env.FAKE_ACP_CANCEL_FILE) {
      fs.writeFileSync(process.env.FAKE_ACP_CANCEL_FILE, params.sessionId, 'utf8')
    }
    if (scenario === 'cancel-hang') {
      return
    }
    const cancelHandler = activeCancels.get(params.sessionId)
    cancelHandler?.()
  })
  .onRequest(methods.agent.session.prompt, async ({ params, client }) => {
    const session = sessions.get(params.sessionId)
    if (!session) {
      throw RequestError.resourceNotFound(params.sessionId)
    }

    const sendUpdate = async update =>
      client.notify(methods.client.session.update, {
        sessionId: params.sessionId,
        update,
      })

    if (scenario === 'crash') {
      process.stderr.write('fatal fake crash\n')
      process.exit(42)
    }

    if (scenario === 'cancel-clean' || scenario === 'cancel-hang') {
      await sendUpdate({
        sessionUpdate: 'agent_thought_chunk',
        content: { type: 'text', text: 'working...' },
      })
      await new Promise((resolve) => {
        activeCancels.set(params.sessionId, resolve)
        if (process.env.FAKE_ACP_PROMPT_READY_FILE) {
          fs.writeFileSync(process.env.FAKE_ACP_PROMPT_READY_FILE, params.sessionId, 'utf8')
        }
      })
      activeCancels.delete(params.sessionId)
      return { stopReason: 'cancelled' }
    }

    if (scenario === 'permission') {
      const kind = process.env.FAKE_ACP_PERMISSION_KIND || undefined
      const options = process.env.FAKE_ACP_PERMISSION_NO_OPTIONS === '1'
        ? []
        : process.env.FAKE_ACP_PERMISSION_ALWAYS_ONLY === '1'
          ? [
              { optionId: 'allow-always', name: 'Allow always', kind: 'allow_always' },
              { optionId: 'reject-always', name: 'Reject always', kind: 'reject_always' },
            ]
          : [
              { optionId: 'allow-once', name: 'Allow once', kind: 'allow_once' },
              { optionId: 'allow-always', name: 'Allow always', kind: 'allow_always' },
              { optionId: 'reject-once', name: 'Reject once', kind: 'reject_once' },
              { optionId: 'reject-always', name: 'Reject always', kind: 'reject_always' },
            ]
      const permResponse = await client.request(methods.client.session.requestPermission, {
        sessionId: params.sessionId,
        toolCall: {
          toolCallId: 'perm-tc-1',
          title: 'Test permission request',
          ...(kind
            ? { kind }
            : {}),
        },
        options,
      })
      await sendUpdate({
        sessionUpdate: 'agent_message_chunk',
        content: {
          type: 'text',
          text: JSON.stringify(permResponse.outcome),
        },
      })
      return { stopReason: 'end_turn' }
    }

    if (scenario === 'mcp-tool') {
      const stdioServer = session.mcpServers.find(s => 'command' in s)
      if (!stdioServer) {
        throw new Error('No stdio MCP server attached to session/new')
      }
      const toolResult = await callStdioMcpTool(stdioServer)
      await sendUpdate({
        sessionUpdate: 'agent_message_chunk',
        content: {
          type: 'text',
          text: JSON.stringify(toolResult),
        },
      })
      return { stopReason: 'end_turn' }
    }

    if (scenario === 'echo-prompt') {
      const firstBlock = params.prompt[0]
      const text = firstBlock?.type === 'text'
        ? firstBlock.text
        : ''
      await sendUpdate({
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text },
      })
      return { stopReason: 'end_turn' }
    }

    if (scenario === 'echo-env') {
      await sendUpdate({
        sessionUpdate: 'agent_message_chunk',
        content: {
          type: 'text',
          text: JSON.stringify({
            cwd: fs.realpathSync(process.cwd()),
            sessionCwd: fs.realpathSync(session.cwd),
            configEnv: process.env.FAKE_CONFIG_ENV,
            inputEnv: process.env.FAKE_INPUT_ENV,
          }),
        },
      })
      return { stopReason: 'end_turn' }
    }

    if (scenario === 'response') {
      await sendUpdate({
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text: process.env.FAKE_ACP_RESPONSE ?? '' },
      })
      return { stopReason: 'end_turn' }
    }

    await sendUpdate({
      sessionUpdate: 'agent_thought_chunk',
      content: { type: 'text', text: 'thinking step' },
    })
    await sendUpdate({
      sessionUpdate: 'tool_call',
      toolCallId: 'tc-1',
      title: 'Read file',
      name: 'read_file',
      kind: 'read',
      status: 'pending',
      rawInput: { path: 'README.md' },
    })
    await sendUpdate({
      sessionUpdate: 'tool_call_update',
      toolCallId: 'tc-1',
      status: 'in_progress',
    })
    await sendUpdate({
      sessionUpdate: 'tool_call_update',
      toolCallId: 'tc-1',
      status: 'completed',
      rawOutput: { bytes: 42 },
    })
    if (process.env.FAKE_ACP_INCLUDE_NON_TEXT === '1') {
      await sendUpdate({
        sessionUpdate: 'agent_thought_chunk',
        content: { type: 'resource_link', uri: 'file:///tmp/x', name: 'x' },
      })
      await sendUpdate({
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'resource_link', uri: 'file:///tmp/x', name: 'x' },
      })
      await sendUpdate({
        sessionUpdate: 'current_mode_update',
        currentModeId: 'default',
      })
    }
    await sendUpdate({
      sessionUpdate: 'agent_message_chunk',
      content: { type: 'text', text: 'Hello ' },
    })
    await sendUpdate({
      sessionUpdate: 'agent_message_chunk',
      content: { type: 'text', text: 'world!' },
    })
    return { stopReason: 'end_turn' }
  })

const stream = ndJsonStream(
  Writable.toWeb(process.stdout),
  Readable.toWeb(process.stdin),
)
const connection = app.connect(stream)

if (scenario !== 'cancel-hang' && scenario !== 'hang-after-prompt') {
  process.stdin.on('end', () => {
    connection.close()
    process.exit(0)
  })
}
