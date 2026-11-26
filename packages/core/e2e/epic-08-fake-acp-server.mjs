import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import readline from 'node:readline'

const stateFile = process.env.EPIC08_ACP_STATE_FILE
const recordsFile = process.env.EPIC08_ACP_RECORDS_FILE

const TODOS = [
  {
    id: 'slice-1',
    title: 'Greeting',
    description: 'Add greet()',
    acceptanceCriteria: ['greet exists'],
  },
  {
    id: 'slice-2',
    title: 'Farewell',
    description: 'Add bye()',
    acceptanceCriteria: ['bye exists'],
  },
]

const TRIAGE_TURNS = [
  {
    status: 'needs_clarification',
    questions: ['Which greeting language?'],
    summary: 'Greeting feature',
  },
  {
    status: 'ready',
    questions: [],
    summary: 'English greeting and farewell',
  },
]

function loadState() {
  if (stateFile && fs.existsSync(stateFile)) {
    return JSON.parse(fs.readFileSync(stateFile, 'utf8'))
  }
  return {
    sessionCounter: 0,
    triageTurns: 0,
    slice: 0,
    sessions: {},
  }
}

function saveState(state) {
  if (stateFile) {
    fs.mkdirSync(path.dirname(stateFile), { recursive: true })
    fs.writeFileSync(stateFile, JSON.stringify(state), 'utf8')
  }
}

function appendRecord(record) {
  if (recordsFile) {
    fs.mkdirSync(path.dirname(recordsFile), { recursive: true })
    fs.appendFileSync(recordsFile, `${JSON.stringify(record)}\n`, 'utf8')
  }
}

const state = loadState()
const sessionState = new Map(Object.entries(state.sessions))
const activeChildren = new Set()
let nextClientRequestId = 1
const pendingClientRequests = new Map()

function writeJsonRpc(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`)
}

function sendClientRequest(method, params) {
  const id = nextClientRequestId
  nextClientRequestId += 1
  return new Promise((resolve, reject) => {
    pendingClientRequests.set(id, { resolve, reject })
    writeJsonRpc({ jsonrpc: '2.0', id, method, params })
  })
}

function sendSessionUpdate(sessionId, update) {
  writeJsonRpc({
    jsonrpc: '2.0',
    method: 'session/update',
    params: { sessionId, update },
  })
}

async function requestPermission(sessionId, toolCallId, title, kind) {
  const result = await sendClientRequest('session/request_permission', {
    sessionId,
    toolCall: { toolCallId, title, kind },
    options: [
      { optionId: 'allow-once', name: 'Allow once', kind: 'allow_once' },
      { optionId: 'reject-once', name: 'Reject once', kind: 'reject_once' },
    ],
  })
  const outcome = result?.outcome
  return {
    kind,
    optionId: outcome?.outcome === 'selected'
      ? outcome.optionId
      : (outcome?.outcome ?? 'unknown'),
  }
}

async function runMcpBridgeCalls(mcpServer, toolCalls) {
  const { NODE_V8_COVERAGE: _, ...baseEnv } = process.env
  const childEnv = { ...baseEnv }
  for (const entry of mcpServer.env ?? []) {
    childEnv[entry.name] = entry.value
  }
  const child = spawn(mcpServer.command, mcpServer.args ?? [], {
    env: childEnv,
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  activeChildren.add(child)
  child.stdin.on('error', () => {})

  let stderr = ''
  child.stderr.setEncoding('utf8').on('data', (chunk) => {
    stderr += chunk
  })

  const pending = new Map()
  const failPending = (err) => {
    for (const handler of pending.values()) {
      handler.reject(err)
    }
    pending.clear()
  }

  let buffer = ''
  child.stdout.setEncoding('utf8').on('data', (chunk) => {
    buffer += chunk
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const raw of lines) {
      const line = raw.trim()
      if (!line) {
        continue
      }
      const msg = JSON.parse(line)
      const handler = pending.get(msg.id)
      if (handler) {
        pending.delete(msg.id)
        if (msg.error) {
          handler.reject(new Error(msg.error.message ?? 'MCP error'))
        }
        else {
          handler.resolve(msg.result)
        }
      }
    }
  })

  const closePromise = new Promise((resolve, reject) => {
    child.once('error', (err) => {
      failPending(err)
      reject(err)
    })
    child.once('close', (code) => {
      activeChildren.delete(child)
      if (code !== 0) {
        const err = new Error(`ludd mcp-bridge exited with ${String(code)}: ${stderr}`)
        failPending(err)
        reject(err)
      }
      else {
        failPending(new Error('ludd mcp-bridge closed before completing pending RPC calls'))
        resolve()
      }
    })
  })
  closePromise.catch(() => {})

  let msgId = 1
  const rpcCall = (method, params) => {
    const id = msgId
    msgId += 1
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject })
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`)
    })
  }

  try {
    await rpcCall('initialize', {
      protocolVersion: '2025-03-26',
      capabilities: {},
      clientInfo: { name: 'epic-08-fake-acp', version: '1.0.0' },
    })
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`)

    const listResult = await rpcCall('tools/list', {})
    const listedTools = (listResult?.tools ?? []).map(t => t.name)

    const results = []
    for (const call of toolCalls) {
      const res = await rpcCall('tools/call', {
        name: call.name,
        arguments: call.arguments,
      })
      results.push({
        name: call.name,
        isError: Boolean(res?.isError),
        text: res?.content?.[0]?.text ?? '',
        listedTools,
      })
    }
    child.stdin.end()
    await closePromise
    return results
  }
  catch (err) {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL')
    }
    await closePromise.catch(() => {})
    throw err
  }
}

function getStdioMcpServer(session) {
  const server = (session.mcpServers ?? []).find(s => 'command' in s)
  if (!server) {
    throw new Error('Fake ACP: no stdio MCP server attached to session')
  }
  return server
}

async function handleTriageTurn(sessionId, permissionChecks) {
  permissionChecks.push(await requestPermission(sessionId, 'tc-triage-read', 'Read codebase', 'read'))
  permissionChecks.push(await requestPermission(sessionId, 'tc-triage-edit', 'Edit blocked', 'edit'))
  sendSessionUpdate(sessionId, {
    sessionUpdate: 'agent_thought_chunk',
    content: { type: 'text', text: 'Analyzing feature request' },
  })
  sendSessionUpdate(sessionId, {
    sessionUpdate: 'tool_call',
    toolCallId: 'tc-triage-1',
    title: 'Inspect repository',
    name: 'read_file',
    kind: 'read',
    status: 'pending',
    rawInput: { path: 'src/index.js' },
  })
  sendSessionUpdate(sessionId, {
    sessionUpdate: 'tool_call_update',
    toolCallId: 'tc-triage-1',
    status: 'completed',
    rawOutput: { ok: true },
  })
  const output = TRIAGE_TURNS[Math.min(state.triageTurns, 1)]
  state.triageTurns += 1
  saveState(state)
  return JSON.stringify(output)
}

async function handleSpecTurn(sessionId, session, permissionChecks, mcpToolCalls) {
  permissionChecks.push(await requestPermission(sessionId, 'tc-spec-read', 'Read context', 'read'))
  const stdioServer = getStdioMcpServer(session)
  const calls = await runMcpBridgeCalls(stdioServer, [
    {
      name: 'put_artifact',
      arguments: { key: 'spec.md', content: '# Spec\n\nGreeting and farewell.' },
    },
    {
      name: 'put_artifact',
      arguments: {
        key: 'todos.json',
        content: JSON.stringify(TODOS),
      },
    },
    {
      name: 'get_artifact',
      arguments: { key: 'spec.md' },
    },
  ])
  mcpToolCalls.push(...calls)
  sendSessionUpdate(sessionId, {
    sessionUpdate: 'agent_thought_chunk',
    content: { type: 'text', text: 'Generated spec.md and todos.json via MCP' },
  })
  return 'spec done'
}

async function handleSliceTurn(sessionId, session, permissionChecks) {
  permissionChecks.push(await requestPermission(sessionId, 'tc-slice-edit', 'Edit src/index.js', 'edit'))
  state.slice += 1
  saveState(state)
  const targetFile = path.join(session.cwd, 'src', 'index.js')
  fs.appendFileSync(targetFile, `exports.slice${state.slice} = () => ${state.slice}\n`)
  sendSessionUpdate(sessionId, {
    sessionUpdate: 'tool_call',
    toolCallId: `tc-slice-${state.slice}`,
    title: 'Write slice implementation',
    name: 'edit_file',
    kind: 'edit',
    status: 'pending',
    rawInput: { path: 'src/index.js' },
  })
  sendSessionUpdate(sessionId, {
    sessionUpdate: 'tool_call_update',
    toolCallId: `tc-slice-${state.slice}`,
    status: 'completed',
    rawOutput: { updated: true },
  })
  return JSON.stringify({ commitMessage: `feat: implement slice ${state.slice}` })
}

async function handleReviewTurn(sessionId, permissionChecks) {
  permissionChecks.push(await requestPermission(sessionId, 'tc-review-read', 'Inspect git diff', 'read'))
  sendSessionUpdate(sessionId, {
    sessionUpdate: 'agent_thought_chunk',
    content: { type: 'text', text: 'Reviewing slice diff' },
  })
  return JSON.stringify({
    status: 'pass',
    body: { findings: [] },
  })
}

async function handleFinalPrTurn(sessionId, session, permissionChecks, mcpToolCalls) {
  permissionChecks.push(await requestPermission(sessionId, 'tc-pr-read', 'Read logs and artifacts', 'read'))
  const stdioServer = getStdioMcpServer(session)
  const calls = await runMcpBridgeCalls(stdioServer, [
    {
      name: 'read_log_page',
      arguments: { logKey: 'final-review-and-pr-1-beforeStep-1', page: 1, pageSize: 10 },
    },
    {
      name: 'get_artifact',
      arguments: { key: 'spec.md' },
    },
    {
      name: 'put_artifact',
      arguments: { key: 'pr-description.md', content: '# PR\n\nAdds greeting and farewell.' },
    },
  ])
  mcpToolCalls.push(...calls)
  return 'pr done'
}

async function executePrompt(sessionId, promptText) {
  const session = sessionState.get(sessionId)
  if (!session) {
    throw new Error(`Unknown ACP session: ${sessionId}`)
  }
  const permissionChecks = []
  const mcpToolCalls = []

  let responseText
  if (promptText.includes('Feature-Wunsch')) {
    responseText = await handleTriageTurn(sessionId, permissionChecks)
  }
  else if (promptText.includes('spec.md')) {
    responseText = await handleSpecTurn(sessionId, session, permissionChecks, mcpToolCalls)
  }
  else if (promptText.includes('To-Do-Slice')) {
    responseText = await handleSliceTurn(sessionId, session, permissionChecks)
  }
  else if (promptText.includes('Git-Diff')) {
    responseText = await handleReviewTurn(sessionId, permissionChecks)
  }
  else if (promptText.includes('pr-description.md')) {
    responseText = await handleFinalPrTurn(sessionId, session, permissionChecks, mcpToolCalls)
  }
  else {
    throw new Error(`Fake ACP: unscripted prompt: ${promptText}`)
  }

  sendSessionUpdate(sessionId, {
    sessionUpdate: 'agent_message_chunk',
    content: { type: 'text', text: responseText },
  })

  appendRecord({
    sessionMethod: session.sessionMethod,
    sessionId,
    cwd: session.cwd,
    prompt: promptText,
    mcpServerNames: (session.mcpServers ?? []).map(s => s.name),
    permissionChecks,
    mcpToolCalls,
  })

  return { stopReason: 'end_turn' }
}

async function handleIncomingRequest(msg) {
  const { id, method, params } = msg
  try {
    if (method === 'initialize') {
      writeJsonRpc({
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: params?.protocolVersion ?? 1,
          agentCapabilities: { loadSession: true },
          agentInfo: { name: 'epic-08-fake-acp', version: '1.0.0' },
        },
      })
      return
    }
    if (method === 'session/new') {
      state.sessionCounter += 1
      const sessionId = `acp-session-${state.sessionCounter}`
      const info = {
        cwd: params.cwd,
        mcpServers: params.mcpServers ?? [],
        sessionMethod: 'session/new',
      }
      sessionState.set(sessionId, info)
      state.sessions[sessionId] = { cwd: params.cwd }
      saveState(state)
      writeJsonRpc({
        jsonrpc: '2.0',
        id,
        result: { sessionId },
      })
      return
    }
    if (method === 'session/load') {
      if (!sessionState.has(params.sessionId)) {
        writeJsonRpc({
          jsonrpc: '2.0',
          id,
          error: { code: -32002, message: `Session not found: ${params.sessionId}` },
        })
        return
      }
      sessionState.set(params.sessionId, {
        cwd: params.cwd,
        mcpServers: params.mcpServers ?? [],
        sessionMethod: 'session/load',
      })
      state.sessions[params.sessionId] = { cwd: params.cwd }
      saveState(state)
      writeJsonRpc({ jsonrpc: '2.0', id, result: {} })
      return
    }
    if (method === 'session/prompt') {
      const promptText = (params.prompt ?? [])
        .filter(block => block.type === 'text')
        .map(block => block.text)
        .join('\n')
      const result = await executePrompt(params.sessionId, promptText)
      writeJsonRpc({ jsonrpc: '2.0', id, result })
      return
    }
    writeJsonRpc({
      jsonrpc: '2.0',
      id,
      error: { code: -32601, message: `Method not found: ${String(method)}` },
    })
  }
  catch (err) {
    writeJsonRpc({
      jsonrpc: '2.0',
      id,
      error: {
        code: -32603,
        message: err instanceof Error
          ? err.message
          : String(err),
      },
    })
  }
}

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity })
rl.on('line', (line) => {
  const trimmed = line.trim()
  if (!trimmed) {
    return
  }
  const msg = JSON.parse(trimmed)
  if (msg.id !== undefined && msg.method === undefined) {
    const pending = pendingClientRequests.get(msg.id)
    if (pending) {
      pendingClientRequests.delete(msg.id)
      if (msg.error) {
        pending.reject(new Error(msg.error.message ?? 'Client error'))
      }
      else {
        pending.resolve(msg.result)
      }
    }
    return
  }
  if (msg.id !== undefined && msg.method !== undefined) {
    void handleIncomingRequest(msg)
  }
})

function shutdown(code) {
  for (const child of activeChildren) {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL')
    }
  }
  process.exit(code)
}

rl.on('close', () => shutdown(0))
process.on('SIGTERM', () => shutdown(0))
process.on('SIGINT', () => shutdown(0))
