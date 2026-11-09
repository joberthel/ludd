import type { AgentTurnInput, AgentTurnResult, StepConfig, StepContext } from '../src/index.js'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { execGuardrail, humanReviewGuardrail } from '@ludd/guardrails'
import { z } from 'zod'

export interface Epic6TestState {
  triageSessions: string[]
  triagePrompts: string[]
  specCallCount: number
  implementSessions: string[]
  implementPrompts: string[]
}

interface TriageOutput {
  status: 'needs_clarification' | 'ready'
  questions: string[]
  summary: string
}

const todoItemSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
})

export function createInitialEpic6State(): Epic6TestState {
  return {
    triageSessions: [],
    triagePrompts: [],
    specCallCount: 0,
    implementSessions: [],
    implementPrompts: [],
  }
}

function createTriageTurnExecutor(
  state: Epic6TestState,
): (input: AgentTurnInput) => Promise<AgentTurnResult<TriageOutput>> {
  return async (input: AgentTurnInput) => {
    state.triageSessions.push(input.sessionId)
    state.triagePrompts.push(input.prompt)
    if (input.attempt === 1) {
      return {
        output: {
          status: 'needs_clarification',
          questions: ['Which JWT library should be used?', 'What token expiry?'],
          summary: 'Implement user authentication with JWT',
        },
        sessionId: input.sessionId,
      }
    }
    return {
      output: {
        status: 'ready',
        questions: [],
        summary: 'Implement user auth using jose library with 15m expiration',
      },
      sessionId: input.sessionId,
    }
  }
}

function formatTriagePrompt(ctx: StepContext<TriageOutput>): string {
  const output = ctx.step.output
  if (output.status === 'needs_clarification') {
    const list = output.questions.map(q => `- ${q}`).join('\n')
    return `Agent has questions:\n${list}\nReply or Pass:`
  }
  return `Summary:\n${output.summary}\nApprove scope?`
}

export function buildTriageStep(state: Epic6TestState): StepConfig {
  return {
    id: 'triage-and-grilling',
    name: 'Interactive Feature Clarification',
    outputSchema: z.object({
      status: z.enum(['needs_clarification', 'ready']),
      questions: z.array(z.string()),
      summary: z.string(),
    }),
    beforeStep: [
      humanReviewGuardrail({
        prompt: 'Please describe the feature or change request:',
      }),
    ],
    run: {
      __kind: 'agent',
      mode: 'read-only',
      prompt: 'Clarify user feature requirements',
      executeTurn: createTriageTurnExecutor(state),
    },
    afterStep: [
      humanReviewGuardrail({
        prompt: (ctx: StepContext) =>
          formatTriagePrompt(ctx as unknown as StepContext<TriageOutput>),
      }),
    ],
  }
}

export function buildSpecStep(state: Epic6TestState): StepConfig {
  return {
    id: 'generate-spec-and-todos',
    name: 'Specification and Todo Decomposition',
    artifacts: {
      'spec.md': { nonEmpty: true },
      'todos.json': {
        schema: z.array(todoItemSchema),
      },
    },
    run: {
      __kind: 'agent',
      mode: 'read-only',
      prompt: 'Generate spec and todos',
      executeTurn: async (input: AgentTurnInput) => {
        state.specCallCount += 1
        const artifacts = input.ctx.artifacts
        await artifacts.put('spec.md', '# Auth Specification\n\nUse jose library with 15m token expiration.')
        await artifacts.put(
          'todos.json',
          JSON.stringify([
            { id: 'slice-1', title: 'JWT Sign & Verify', description: 'Implement token generation and validation' },
          ]),
        )
        return {
          output: { specGenerated: true, totalSlices: 1 },
          sessionId: input.sessionId,
        }
      },
    },
    afterStep: [
      humanReviewGuardrail({
        prompt: 'Please review artifacts spec.md and todos.json',
      }),
    ],
  }
}

export function buildImplementStep(workspaceDir: string, state: Epic6TestState): StepConfig {
  const resultFile = path.join(workspaceDir, 'test-result.txt')
  return {
    id: 'implement-slices',
    name: 'Sequential Matrix Implementation per Todo Slice',
    matrix: {
      itemsFromArtifact: 'todos.json',
    },
    outputSchema: z.object({
      commitMessage: z.string().min(5),
    }),
    run: {
      __kind: 'agent',
      mode: 'workspace-write',
      prompt: 'Implement todo slice',
      executeTurn: async (input: AgentTurnInput) => {
        state.implementSessions.push(input.sessionId)
        state.implementPrompts.push(input.prompt)
        if (input.attempt === 1) {
          fs.writeFileSync(resultFile, 'FAIL: assertion error in token expiry', 'utf-8')
          return {
            output: { commitMessage: 'feat(auth): initial JWT slice' },
            sessionId: input.sessionId,
          }
        }
        fs.writeFileSync(resultFile, 'PASS: all token expiry tests passed', 'utf-8')
        return {
          output: { commitMessage: 'fix(auth): fix token expiry assertion' },
          sessionId: input.sessionId,
        }
      },
    },
    afterStep: [
      execGuardrail({
        command: () => [
          process.execPath,
          '-e',
          `const fs = require('fs'); const content = fs.readFileSync(${JSON.stringify(resultFile)}, 'utf8'); if (!content.includes('PASS')) process.exit(1);`,
        ],
        maxRetries: 0,
        onMaxRetriesExceeded: 'prompt_user',
      }),
    ],
  }
}
