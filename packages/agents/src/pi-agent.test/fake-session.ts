import type { AgentTurnInput } from '@ludd/core'
import type { PiSession, PiSessionEvent } from '../types/pi-sdk.js'
import { createDefaultHostEnvironment } from '@ludd/core'

export interface FakeSession extends PiSession {
  prompts: string[]
  aborts: number
}

export function fakeSession(script: PiSessionEvent[], text: string | null = 'done'): FakeSession {
  const listeners = new Set<(e: PiSessionEvent) => void>()
  const emit = (e: PiSessionEvent): void => listeners.forEach(l => l(e))
  const session: FakeSession = {
    prompts: [],
    aborts: 0,
    subscribe: (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    prompt: async (p) => {
      session.prompts.push(p)
      script.forEach(emit)
    },
    abort: async () => {
      session.aborts += 1
      emit({ type: 'agent_settled', aborted: true })
    },
    getLastAssistantText: () => text ?? undefined,
  }
  return session
}

export function turnInput(runDir: string, over: Partial<AgentTurnInput<any>> = {}): AgentTurnInput<any> {
  return {
    ctx: { runId: 'run-1' } as never,
    stepId: 'step-1',
    prompt: 'hello',
    sessionId: 'sess-1',
    attempt: 1,
    mode: 'read-only',
    runDir,
    environment: createDefaultHostEnvironment('/work'),
    mcpServerUrl: '',
    mcpAuthToken: '',
    ...over,
  }
}
