import type { PiSessionFactory } from '@luddjs/agents'
import type { HostSpawnResult, StepContext } from '../../src/index.js'
import fs from 'node:fs'
import path from 'node:path'
import { piAgent } from '@luddjs/agents'
import { agentGuardrail, execGuardrail, humanReviewGuardrail } from '@luddjs/guardrails'
import { z } from 'zod'
import { defineHarness, spawn } from '../../src/index.js'

const RUN_ID_PATTERN = /^[\w.-]+$/

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

function validateRunId(runId: string): string {
  if (runId === '.' || runId === '..' || !RUN_ID_PATTERN.test(runId)) {
    throw new Error(`Invalid runId "${runId}" for worktree path.`)
  }
  return runId
}

function resolveWorktreeDir(workspaceRoot: string, runId: string): string {
  const root = path.resolve(workspaceRoot)
  return path.resolve(root, '.harness', 'worktrees', `${validateRunId(runId)}-feature-env`)
}

function resolveBranchName(runId: string): string {
  return `ludd/${validateRunId(runId)}-feature-env`
}

function formatGitError(result: HostSpawnResult): string {
  return result.stderr.trim() || result.stdout.trim() || `exit code ${result.exitCode ?? 'unknown'}`
}

async function setupFeatureWorktree(
  workspaceRoot: string,
  runId: string,
  signal?: AbortSignal,
): Promise<{ cwd: string }> {
  const root = path.resolve(workspaceRoot)
  const worktreeDir = resolveWorktreeDir(root, runId)
  const branchName = resolveBranchName(runId)

  if (fs.existsSync(path.join(worktreeDir, '.git'))) {
    const wtCheck = await spawn({
      command: 'git',
      args: [
        '-C',
        worktreeDir,
        'rev-parse',
        '--is-inside-work-tree',
      ],
      cwd: root,
      signal,
    })
    if (wtCheck.exitCode === 0) {
      return { cwd: worktreeDir }
    }
  }

  fs.mkdirSync(path.dirname(worktreeDir), { recursive: true })
  const refCheck = await spawn({
    command: 'git',
    args: [
      'show-ref',
      '--verify',
      '--quiet',
      `refs/heads/${branchName}`,
    ],
    cwd: root,
    signal,
  })
  if (refCheck.exitCode !== 0 && refCheck.exitCode !== 1) {
    throw new Error(`Failed to inspect branch "${branchName}": ${formatGitError(refCheck)}`)
  }

  const addArgs = refCheck.exitCode === 0
    ? [
        'worktree',
        'add',
        worktreeDir,
        branchName,
      ]
    : [
        'worktree',
        'add',
        '-b',
        branchName,
        worktreeDir,
        'HEAD',
      ]
  const addResult = await spawn({
    command: 'git',
    args: addArgs,
    cwd: root,
    signal,
  })
  if (addResult.exitCode !== 0) {
    throw new Error(`Failed to create git worktree: ${formatGitError(addResult)}`)
  }
  return { cwd: worktreeDir }
}

async function teardownFeatureWorktree(
  workspaceRoot: string,
  runId: string,
  signal?: AbortSignal,
): Promise<void> {
  const root = path.resolve(workspaceRoot)
  const worktreeDir = resolveWorktreeDir(root, runId)
  if (fs.existsSync(worktreeDir)) {
    const removeRes = await spawn({
      command: 'git',
      args: [
        'worktree',
        'remove',
        '--force',
        worktreeDir,
      ],
      cwd: root,
      signal,
    })
    if (removeRes.exitCode !== 0) {
      throw new Error(`Failed to remove git worktree "${worktreeDir}": ${formatGitError(removeRes)}`)
    }
    return
  }

  const pruneRes = await spawn({
    command: 'git',
    args: ['worktree', 'prune'],
    cwd: root,
    signal,
  })
  if (pruneRes.exitCode !== 0) {
    throw new Error(`Failed to prune git worktrees: ${formatGitError(pruneRes)}`)
  }
}

/**
 * TDD 9.2 reference configuration. Deviations, all documented:
 * - `phpstan` / `phpunit` are stubbed with `node --check` / `node test.js` from the fixture repo.
 * - `sessionFactory` is injected into every `piAgent` (and the agent guardrail).
 */
function triageStep(sessionFactory: PiSessionFactory) {
  return {
    id: 'triage-and-grilling',
    name: 'Interactive Feature Clarification',

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
        // Runs in the worktree cwd resolved by setup() so the feature branch (HEAD) is pushed from the host.
        command: ['git', 'push', '-u', 'origin', 'HEAD'],
      }),
    ],
  }
}

export function createReferenceHarness(options: ReferenceHarnessOptions) {
  const { sessionFactory } = options
  return defineHarness({
    name: 'interactive-feature-workflow',
    setup: async ({ runId, workspaceRoot, signal }) => setupFeatureWorktree(workspaceRoot, runId, signal),
    teardown: async ({ runId, workspaceRoot, signal }) => teardownFeatureWorktree(workspaceRoot, runId, signal),
    steps: [
      triageStep(sessionFactory),
      specStep(sessionFactory),
      implementStep(sessionFactory),
      finalStep(sessionFactory),
    ],
  })
}
