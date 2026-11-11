import type { PiSession, PiSessionEvent, PiSessionFactory, PiSessionFactoryOptions } from '@ludd/agents'
import fs from 'node:fs'
import path from 'node:path'

export interface FakePiRecord {
  mode: string
  cwd: string
  sessionFile: string
  prompt: string
  toolNames: string[]
}

export interface FakePi {
  factory: PiSessionFactory
  records: FakePiRecord[]
}

type Tool = NonNullable<PiSessionFactoryOptions['customTools']>[number]

async function callTool(options: PiSessionFactoryOptions, name: string, params: unknown): Promise<void> {
  const tool: Tool | undefined = options.customTools?.find(t => t.name === name)
  if (tool === undefined) {
    throw new Error(`Fake Pi: tool "${name}" is not available`)
  }
  await (tool.execute as (id: string, params: unknown, signal: undefined) => Promise<unknown>)(`call-${name}`, params, undefined)
}

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

interface ScriptState {
  triageTurns: number
  slice: number
}

const TRIAGE_TURNS = [
  {
    status: 'needs_clarification',
    questions: ['Which greeting language?'],
    summary: 'Greeting feature',
  },
  { status: 'ready', questions: [], summary: 'English greeting and farewell' },
]

async function putArtifact(options: PiSessionFactoryOptions, key: string, content: string): Promise<void> {
  await callTool(options, 'put_artifact', { key, content })
}

async function implementSlice(options: PiSessionFactoryOptions, state: ScriptState): Promise<string> {
  state.slice += 1
  const file = path.join(options.cwd, 'src', 'index.js')
  fs.appendFileSync(file, `exports.slice${state.slice} = () => ${state.slice}\n`)
  await callTool(options, 'submit_step_output', { commitMessage: `feat: implement slice ${state.slice}` })
  return 'slice done'
}

/** Picks the scripted behaviour from the prompt; no LLM involved. */
async function act(options: PiSessionFactoryOptions, prompt: string, state: ScriptState): Promise<string> {
  if (prompt.includes('Feature-Wunsch')) {
    await callTool(options, 'submit_step_output', TRIAGE_TURNS[Math.min(state.triageTurns, 1)])
    state.triageTurns += 1
    return 'triage done'
  }
  if (prompt.includes('spec.md')) {
    await putArtifact(options, 'spec.md', '# Spec\n\nGreeting and farewell.')
    await putArtifact(options, 'todos.json', JSON.stringify(TODOS))
    return 'spec done'
  }
  if (prompt.includes('To-Do-Slice')) {
    return implementSlice(options, state)
  }
  if (prompt.includes('Git-Diff')) {
    await callTool(options, 'submit_step_output', {
      status: 'pass',
      body: { findings: [] },
    })
    return 'review done'
  }
  if (prompt.includes('pr-description.md')) {
    await putArtifact(options, 'pr-description.md', '# PR\n\nAdds greeting and farewell.')
    return 'pr done'
  }
  throw new Error(`Fake Pi: unscripted prompt: ${prompt}`)
}

function recordTurn(records: FakePiRecord[], options: PiSessionFactoryOptions, prompt: string): void {
  records.push({
    mode: options.mode,
    cwd: options.cwd,
    sessionFile: options.sessionFile,
    prompt,
    toolNames: (options.customTools ?? []).map(t => t.name),
  })
  fs.mkdirSync(path.dirname(options.sessionFile), { recursive: true })
  fs.appendFileSync(options.sessionFile, `${JSON.stringify({ prompt })}\n`)
}

function createSession(options: PiSessionFactoryOptions, records: FakePiRecord[], state: ScriptState): PiSession {
  const listeners = new Set<(event: PiSessionEvent) => void>()
  const emit = (event: PiSessionEvent): void => listeners.forEach(l => l(event))
  let lastText: string | undefined
  return {
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    prompt: async (text) => {
      recordTurn(records, options, text)
      lastText = await act(options, text, state)
      emit({
        type: 'message_update',
        assistantMessageEvent: { type: 'text_delta', delta: lastText },
      })
      emit({ type: 'agent_settled' })
    },
    abort: async () => {
      emit({ type: 'agent_settled', aborted: true })
    },
    getLastAssistantText: () => lastText,
  }
}

/** Scripted, deterministic Pi session factory (hermetic CI). */
export function createFakePi(): FakePi {
  const records: FakePiRecord[] = []
  const state: ScriptState = { triageTurns: 0, slice: 0 }
  return {
    factory: async options => createSession(options, records, state),
    records,
  }
}
