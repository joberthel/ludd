import { piAgent } from '@ludd/agents'
import { createHarness } from '@ludd/core'
import { gitWorktreeEnv } from '@ludd/environments'
import { agentGuardrail, execGuardrail, humanReviewGuardrail, sh } from '@ludd/guardrails'
import { z } from 'zod'

const MODEL = 'gemini-4-hydrogen'

const devWorktree = gitWorktreeEnv({
  id: 'dev-worktree',
  branchPrefix: 'ludd/dev',
})

export default createHarness('ludd-dev', {
  cleanupPolicy: {
    onSuccess: 'destroy',
    onFailure: 'keep',
  },
})
  .step({
    id: 'plan',
    name: 'Plan & Scope',
    interactive: {
      initialQuestions: {
        task: {
          type: 'text',
          prompt: 'What would you like to build or fix?',
          placeholder: 'Brief description of the feature, bug, or refactor',
        },
      },
    },
    run: ctx => piAgent({
      mode: 'read-only',
      model: MODEL,
      prompt: [
        `Task: ${ctx.interactive.task}`,
        '',
        'Inspect the relevant codebase along with `AGENTS.md`, `docs/technical-design-document.md`, and `docs/adr/`.',
        'Use `ask_user` if any requirements or edge cases are ambiguous.',
        'Save a concrete implementation and testing plan as the `plan.md` artifact (via `put_artifact`).',
      ].join('\n'),
    }),
    artifacts: {
      'plan.md': { nonEmpty: true },
    },
    outputSchema: z.object({
      summary: z.string().describe('A brief summary of the plan'),
      filesToTouch: z.array(z.string()).describe('List of files that will be modified as part of the plan'),
    }),
    afterStep: ctx => [
      humanReviewGuardrail({
        name: 'Plan Review',
        prompt: [
          `Plan summary: ${ctx.step.output.summary}`,
          `Files: ${ctx.step.output.filesToTouch.join(', ') || '(none)'}`,
          'Approve this plan and start implementation?',
        ].join('\n'),
      }),
    ],
  })
  .step({
    id: 'implement',
    name: 'Implement, Verify & Review',
    environment: devWorktree,
    beforeStep: [
      execGuardrail({
        name: 'Install Dependencies',
        command: 'pnpm install --frozen-lockfile',
      }),
    ],
    run: ctx => piAgent({
      mode: 'workspace-write',
      model: MODEL,
      prompt: [
        `Implement the approved plan for: ${ctx.steps.plan.output?.summary ?? ''}`,
        'First read the `plan.md` artifact via `get_artifact`.',
      ].join('\n'),
    }),
    outputSchema: z.object({
      summary: z.string().describe('A brief summary of the implementation'),
      commitMessage: z.string().describe('The commit message for the changes'),
    }),
    afterStep: ctx => [
      execGuardrail({
        name: 'Build & Typecheck',
        command: 'pnpm build',
      }),
      execGuardrail({
        name: 'Lint',
        command: 'pnpm lint',
      }),
      execGuardrail({
        name: 'Test & Coverage',
        command: 'pnpm test:coverage',
      }),
      execGuardrail({
        name: 'Commitlint',
        command: sh`printf '%s\n' ${ctx.step.output.commitMessage} | pnpm run commitlint`,
      }),
      execGuardrail({
        name: 'Pinact Check',
        command: 'pinact run --check',
      }),
      agentGuardrail({
        name: 'Code Review',
        mode: 'read-only',
        agent: piAgent({
          mode: 'read-only',
          model: MODEL,
          prompt: '',
        }),
        prompt: [
          'Perform a thorough code review of the changes in the current worktree (`git diff`).',
          `Implementation summary: ${ctx.step.output.summary}`,
          'Check correctness, readability, architecture, security, edge cases, and adherence to `AGENTS.md`.',
          'Return status "pass" if ready for human sign-off, or "fail" with actionable findings in body.',
        ].join('\n'),
      }),
      humanReviewGuardrail({
        name: 'Human Sign-off',
        prompt: [
          `Implementation summary: ${ctx.step.output.summary}`,
          `Worktree: ${ctx.environments['dev-worktree']?.workingDir ?? 'n/a'}`,
          `Commit message: ${ctx.step.output.commitMessage}`,
          'Approve changes for final sign-off and commit?',
        ].join('\n'),
      }),
      execGuardrail({
        name: 'Commit Changes',
        command: sh`git add -A && git commit -m ${ctx.step.output.commitMessage}`,
        maxRetries: 0,
      }),
    ],
  })
  .step({
    id: 'merge',
    name: 'Merge to Main Worktree',
    run: async (ctx) => {
      const branchName = ctx.environments['dev-worktree']?.branchName
      if (branchName === undefined || branchName === '') {
        throw new Error('Missing dev-worktree branch to merge.')
      }
      const mergeResult = await ctx.environments.host.exec([
        'git',
        'merge',
        '--ff-only',
        branchName,
      ])
      if (mergeResult.exitCode !== 0) {
        throw new Error(`Failed to fast-forward merge ${branchName}: ${mergeResult.stderr.trim() || mergeResult.stdout.trim()}`)
      }
      return {
        mergedBranch: branchName,
        commitMessage: ctx.steps.implement.output?.commitMessage ?? '',
      }
    },
  })
  .build()
