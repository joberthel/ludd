import type { PiSessionFactory } from '@ludd/agents'
import type { StepContext } from '../../src/index.js'
import { piAgent } from '@ludd/agents'
import { gitWorktreeEnv, hostEnv } from '@ludd/environments'
import { agentGuardrail, execGuardrail, humanReviewGuardrail } from '@ludd/guardrails'
import { z } from 'zod'
import { defineHarness } from '../../src/index.js'

const TodoSliceSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  acceptanceCriteria: z.array(z.string()),
})

const TodosArtifactSchema = z.array(TodoSliceSchema).min(1)

const TriageOutputSchema = z.object({
  status: z.enum(['needs_clarification', 'ready']),
  questions: z.array(z.string()),
  summary: z.string(),
})

export interface ReferenceHarnessOptions {
  /** Scripted fake Pi session factory keeping the e2e hermetic (no live LLM). */
  sessionFactory: PiSessionFactory
}

/**
 * TDD 9.2 reference configuration. Deviations, all documented:
 * - `gitWorktreeEnv` replaces `dockerWorktreeEnv` (no Docker daemon required in CI).
 * - `phpstan` / `phpunit` are stubbed with `node --check` / `node test.js` from the fixture repo.
 * - `sessionFactory` is injected into every `piAgent` (and the agent guardrail).
 */
function triageStep(sessionFactory: PiSessionFactory) {
  return {
    id: 'triage-and-grilling',
    name: 'Interactive Feature Clarification',
    environment: gitWorktreeEnv({ id: 'feature-env' }),

    outputSchema: TriageOutputSchema,

    beforeStep: [
      humanReviewGuardrail({
        prompt: 'Bitte beschreibe das neue Feature oder den Change-Request:',
      }),
    ],

    run: piAgent({
      mode: 'read-only',
      sessionFactory,
      prompt: 'Lies den initialen Feature-Wunsch aus dem MCP-Kontext und analysiere die Codebase. Wenn Details unklar sind, setze status auf "needs_clarification" und formuliere präzise Fragen. Wenn alles klar ist, setze status auf "ready".',
    }),

    afterStep: [
      humanReviewGuardrail({
        prompt: ctx =>
          TriageOutputSchema.parse(ctx.step.output).status === 'needs_clarification'
            ? `Der Agent hat noch offene Fragen:\n${TriageOutputSchema.parse(ctx.step.output).questions.map(q => `- ${q}`).join('\n')}\n\nBitte antworte (Fail + Feedback) oder gib den Step frei (Pass):`
            : `Zusammenfassung:\n${TriageOutputSchema.parse(ctx.step.output).summary}\n\nPasst der Scope so? (Pass zum Fortfahren, Fail + Feedback für Anpassungen)`,
      }),
    ],
  }
}

function specStep(sessionFactory: PiSessionFactory) {
  return {
    id: 'generate-spec-and-todos',
    name: 'Specification and Todo Decomposition',
    environment: (ctx: StepContext) => ctx.environments['feature-env'],

    artifacts: {
      'spec.md': { nonEmpty: true },
      'todos.json': { schema: TodosArtifactSchema },
    },

    run: piAgent({
      mode: 'read-only',
      sessionFactory,
      sessionId: ctx => (ctx.steps['triage-and-grilling']?.output as { sessionId: string } | undefined)?.sessionId,
      prompt: 'Erstelle basierend auf unserem geklärten Gespräch über den MCP-Server das Artefakt "spec.md" sowie das Artefakt "todos.json" mit isolierten vertikalen Slices.',
    }),

    afterStep: [
      humanReviewGuardrail({
        prompt: 'Bitte überprüfe die im MCP abgelegten Artefakte "spec.md" und "todos.json". (Pass für Freigabe, Fail + Feedback für Korrekturen)',
      }),
    ],
  }
}

function implementGuardrails(sessionFactory: PiSessionFactory) {
  return [
    // Stub for `vendor/bin/phpstan analyse src`.
    execGuardrail({
      command: ['node', '--check', 'src/index.js'],
      maxRetries: 3,
    }),
    // Stub for `vendor/bin/phpunit`.
    execGuardrail({
      command: ['node', 'test.js'],
      maxRetries: 3,
      onMaxRetriesExceeded: 'prompt_user',
    }),
    agentGuardrail({
      mode: 'read-only',
      maxRetries: 2,
      bodySchema: z.object({
        findings: z.array(z.string()),
      }),
      prompt: 'Prüfe den aktuellen Git-Diff dieses Slices auf Architektur-Verstöße oder Sicherheitslücken.',
      agent: piAgent({ mode: 'read-only', prompt: 'review', sessionFactory }),
    }),
    execGuardrail({
      command: () => ['git', 'add', '-A'],
      maxRetries: 1,
    }),
    execGuardrail({
      command: (ctx: StepContext) => [
        'git',
        'commit',
        '-m',
        (ctx.step.output as { commitMessage: string }).commitMessage,
      ],
      maxRetries: 1,
    }),
  ]
}

function implementStep(sessionFactory: PiSessionFactory) {
  return {
    id: 'implement-slices',
    name: 'Sequential Matrix Implementation per Todo Slice',
    environment: (ctx: StepContext) => ctx.environments['feature-env'],

    matrix: {
      itemsFromArtifact: 'todos.json',
    },

    outputSchema: z.object({
      commitMessage: z.string().min(5),
    }),

    run: piAgent({
      mode: 'workspace-write',
      sessionFactory,
      prompt: (ctx: StepContext) => {
        const item = TodoSliceSchema.parse(ctx.matrix?.item)
        return `Implementiere exakt das folgende To-Do-Slice (${(ctx.matrix?.index ?? 0) + 1}/${ctx.matrix?.total}):\n`
          + `Titel: ${item.title}\n`
          + `Beschreibung: ${item.description}\n`
          + `Kriterien:\n${item.acceptanceCriteria.map(c => `- ${c}`).join('\n')}`
      },
    }),

    afterStep: implementGuardrails(sessionFactory),
  }
}

function finalStep(sessionFactory: PiSessionFactory) {
  return {
    id: 'final-review-and-pr',
    name: 'Final Integration and PR Creation',
    if: (ctx: StepContext) => ctx.steps['implement-slices']?.status === 'passed',
    environment: (ctx: StepContext) => ctx.environments['feature-env'],

    artifacts: {
      'pr-description.md': { nonEmpty: true },
    },

    beforeStep: [
      execGuardrail({
        command: ['git', 'status', '--porcelain'],
      }),
      execGuardrail({
        command: ['git', 'log', '--oneline', '-n', '10'],
      }),
    ],

    run: piAgent({
      mode: 'read-only',
      sessionFactory,
      prompt: 'Prüfe die Commit-Historie aus dem MCP-Kontext und erstelle über den MCP-Server das Artefakt "pr-description.md" mit einer präzisen Pull-Request-Beschreibung.',
    }),

    afterStep: [
      humanReviewGuardrail({
        prompt: 'Bitte prüfe die generierte PR-Beschreibung ("pr-description.md"). Bei Freigabe (Pass) wird der Branch gepusht.',
      }),
      execGuardrail({
        // hostEnv rooted at the worktree so the feature branch (HEAD) is pushed from the host.
        environment: ctx => hostEnv({ cwd: ctx.environments['feature-env'].workingDir }),
        command: ['git', 'push', '-u', 'origin', 'HEAD'],
      }),
    ],
  }
}

export function createReferenceHarness(options: ReferenceHarnessOptions) {
  const { sessionFactory } = options
  return defineHarness({
    name: 'interactive-feature-workflow',
    cleanupPolicy: { onSuccess: 'keep', onFailure: 'keep' },
    steps: [
      triageStep(sessionFactory),
      specStep(sessionFactory),
      implementStep(sessionFactory),
      finalStep(sessionFactory),
    ],
  })
}
