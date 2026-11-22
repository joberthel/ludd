import type { ProvisionedEnvironment } from '@ludd/core'
import { piAgent } from '@ludd/agents'
import { createHarness } from '@ludd/core'
import { gitWorktreeEnv } from '@ludd/environments'
import { agentGuardrail, execGuardrail, fnGuardrail, humanReviewGuardrail, sh } from '@ludd/guardrails'
import { z } from 'zod'

const devWorktree = gitWorktreeEnv({
  id: 'dev-worktree',
  branchPrefix: 'ludd/dev',
})

async function listConflictedFiles(host: ProvisionedEnvironment): Promise<string[]> {
  const result = await host.exec([
    'git',
    'diff',
    '--name-only',
    '--diff-filter=U',
  ])
  if (result.exitCode !== 0) {
    return []
  }
  return result.stdout.split('\n').map(file => file.trim()).filter(Boolean)
}

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
      model: 'gemini-4-neon',
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
    }),
    afterStep: ctx => [
      humanReviewGuardrail({
        name: 'Plan Review',
        prompt: [
          `Plan summary: ${ctx.step.output.summary}`,
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
      model: 'gemini-4-hydrogen',
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
          model: 'gemini-4-neon',
          prompt: '',
        }),
        prompt: [
          'Perform a thorough code review of the changes in the current worktree (`git diff`).',
          `Implementation summary: ${ctx.step.output.summary}`,
          'Check correctness, readability, architecture, security, edge cases, and adherence to `AGENTS.md`.',
          'Return status "pass" if ready for human sign-off, or "fail" with actionable findings in body.',
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
    outputSchema: z.object({
      mergedBranch: z.string(),
      strategy: z.enum(['ff-only', 'no-ff']),
      hasConflicts: z.boolean(),
      conflictedFiles: z.array(z.string()),
      commitMessage: z.string(),
    }),
    run: async (ctx) => {
      const branchName = ctx.environments['dev-worktree']?.branchName
      if (branchName === undefined || branchName === '') {
        throw new Error('Missing dev-worktree branch to merge.')
      }
      const commitMessage = ctx.steps.implement.output?.commitMessage ?? ''
      const host = ctx.environments.host

      const ffResult = await host.exec([
        'git',
        'merge',
        '--ff-only',
        branchName,
      ])
      if (ffResult.exitCode === 0) {
        return {
          mergedBranch: branchName,
          strategy: 'ff-only' as const,
          hasConflicts: false,
          conflictedFiles: [],
          commitMessage,
        }
      }

      const ancestorCheck = await host.exec([
        'git',
        'merge-base',
        '--is-ancestor',
        'HEAD',
        branchName,
      ])
      if (ancestorCheck.exitCode !== 1) {
        throw new Error(`Failed to fast-forward merge ${branchName}: ${ffResult.stderr.trim() || ffResult.stdout.trim()}`)
      }

      const noFfResult = await host.exec([
        'git',
        'merge',
        '--no-ff',
        '--no-edit',
        branchName,
      ])
      if (noFfResult.exitCode === 0) {
        return {
          mergedBranch: branchName,
          strategy: 'no-ff' as const,
          hasConflicts: false,
          conflictedFiles: [],
          commitMessage,
        }
      }

      const conflictedFiles = await listConflictedFiles(host)
      if (conflictedFiles.length === 0) {
        throw new Error(`Failed to merge ${branchName} with --no-ff: ${noFfResult.stderr.trim() || noFfResult.stdout.trim()}`)
      }

      return {
        mergedBranch: branchName,
        strategy: 'no-ff' as const,
        hasConflicts: true,
        conflictedFiles,
        commitMessage,
      }
    },
  })
  .step({
    id: 'resolve-merge-conflicts',
    name: 'Resolve Merge Conflicts',
    if: ctx => ctx.steps.merge.output?.hasConflicts === true,
    run: ctx => piAgent({
      mode: 'workspace-write',
      model: 'gemini-4-hydrogen',
      prompt: [
        `Merging branch \`${ctx.steps.merge.output?.mergedBranch ?? ''}\` into the main worktree resulted in merge conflicts.`,
        `Implementation summary: ${ctx.steps.implement.output?.summary ?? ''}`,
        `Conflicted files:\n${(ctx.steps.merge.output?.conflictedFiles ?? []).map(file => `- ${file}`).join('\n')}`,
        '',
        'Resolve all merge conflicts carefully, preserving both the main branch changes and the intent of the implemented feature (read the `plan.md` artifact via `get_artifact` if helpful).',
        'Do not abort the merge (`git merge --abort`).',
        'After resolving every conflict and removing all conflict markers, stage the resolved files (`git add`) and complete the merge commit (`git commit --no-edit`).',
      ].join('\n'),
    }),
    outputSchema: z.object({
      summary: z.string().describe('A brief summary of how the merge conflicts were resolved'),
    }),
    afterStep: stepCtx => [
      fnGuardrail({
        name: 'Verify Merge Completed',
        run: async () => {
          const host = stepCtx.environments.host
          const remainingConflicts = await listConflictedFiles(host)
          if (remainingConflicts.length > 0) {
            return { status: 'fail', body: `Unresolved merge conflicts remain in: ${remainingConflicts.join(', ')}` }
          }
          const mergeHead = await host.exec([
            'git',
            'rev-parse',
            '-q',
            '--verify',
            'MERGE_HEAD',
          ])
          if (mergeHead.exitCode === 0) {
            return { status: 'fail', body: 'Merge is still in progress (MERGE_HEAD exists). Stage all resolved files and finish with `git commit --no-edit`.' }
          }
          const branchName = stepCtx.steps.merge.output?.mergedBranch
          if (branchName !== undefined && branchName !== '') {
            const mergedCheck = await host.exec([
              'git',
              'merge-base',
              '--is-ancestor',
              branchName,
              'HEAD',
            ])
            if (mergedCheck.exitCode !== 0) {
              return { status: 'fail', body: `Branch ${branchName} is not merged into HEAD (was the merge aborted?). Re-run \`git merge --no-ff --no-edit ${branchName}\`, resolve conflicts, and commit.` }
            }
          }
          return { status: 'pass', body: 'Merge conflicts resolved and merge commit completed.' }
        },
      }),
      execGuardrail({ name: 'Build & Typecheck', command: 'pnpm build' }),
      execGuardrail({ name: 'Lint', command: 'pnpm lint' }),
      execGuardrail({ name: 'Test & Coverage', command: 'pnpm test:coverage' }),
    ],
  })
  .build()
