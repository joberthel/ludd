import type { HostSpawnResult } from '@luddjs/core'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { claudeAcp, codexAcp } from '@luddjs/agents'
import { createHarness, spawn } from '@luddjs/core'
import { agentGuardrail, execGuardrail, fnGuardrail, humanReviewGuardrail, sh } from '@luddjs/guardrails'
import { z } from 'zod'

const RUN_ID_PATTERN = /^[\w.-]+$/
const workspaceRoots = new Map<string, string>()

function validateRunId(runId: string): string {
  if (runId === '.' || runId === '..' || !RUN_ID_PATTERN.test(runId)) {
    throw new Error(`Invalid runId "${runId}" for worktree path.`)
  }
  return runId
}

function getRelativeWorktreePath(runId: string): string {
  return path.join('.harness', 'worktrees', `${validateRunId(runId)}-dev-worktree`)
}

function getWorktreeDir(workspaceRoot: string, runId: string): string {
  const root = path.resolve(workspaceRoot)
  return path.resolve(root, getRelativeWorktreePath(runId))
}

function getWorktreeBranchName(runId: string): string {
  return `ludd/dev/${validateRunId(runId)}-dev-worktree`
}

function getWorkspaceRoot(runId: string): string {
  return workspaceRoots.get(runId) ?? process.cwd()
}

function formatGitError(result: HostSpawnResult): string {
  return result.stderr.trim() || result.stdout.trim() || `exit code ${result.exitCode ?? 'unknown'}`
}

async function runGit(args: readonly string[], cwd: string, signal?: AbortSignal): Promise<HostSpawnResult> {
  return spawn({
    command: 'git',
    args,
    cwd: path.resolve(cwd),
    signal,
  })
}

async function setupDevWorktree(workspaceRoot: string, runId: string, signal?: AbortSignal): Promise<void> {
  const root = path.resolve(workspaceRoot)
  workspaceRoots.set(runId, root)
  const worktreeDir = getWorktreeDir(root, runId)
  const branchName = getWorktreeBranchName(runId)

  if (fs.existsSync(path.join(worktreeDir, '.git'))) {
    const wtCheck = await runGit([
      '-C',
      worktreeDir,
      'rev-parse',
      '--is-inside-work-tree',
    ], root, signal)
    if (wtCheck.exitCode === 0) {
      return
    }
  }

  fs.mkdirSync(path.dirname(worktreeDir), { recursive: true })
  const refCheck = await runGit([
    'show-ref',
    '--verify',
    '--quiet',
    `refs/heads/${branchName}`,
  ], root, signal)
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
  const addResult = await runGit(addArgs, root, signal)
  if (addResult.exitCode !== 0) {
    throw new Error(`Failed to create dev worktree: ${formatGitError(addResult)}`)
  }
}

async function deleteMergedBranchIfExists(root: string, branchName: string, signal?: AbortSignal): Promise<void> {
  const refCheck = await runGit([
    'show-ref',
    '--verify',
    '--quiet',
    `refs/heads/${branchName}`,
  ], root, signal)
  if (refCheck.exitCode === 1) {
    return
  }
  if (refCheck.exitCode !== 0) {
    throw new Error(`Failed to inspect branch "${branchName}": ${formatGitError(refCheck)}`)
  }

  const mergedCheck = await runGit([
    'merge-base',
    '--is-ancestor',
    branchName,
    'HEAD',
  ], root, signal)
  if (mergedCheck.exitCode === 1) {
    return
  }
  if (mergedCheck.exitCode !== 0) {
    throw new Error(`Failed to check merge status for "${branchName}": ${formatGitError(mergedCheck)}`)
  }

  const deleteRes = await runGit(['branch', '-d', branchName], root, signal)
  if (deleteRes.exitCode !== 0) {
    throw new Error(`Failed to delete merged branch "${branchName}": ${formatGitError(deleteRes)}`)
  }
}

async function teardownDevWorktree(workspaceRoot: string, runId: string, signal?: AbortSignal): Promise<void> {
  workspaceRoots.delete(runId)
  const root = path.resolve(workspaceRoot)
  const worktreeDir = getWorktreeDir(root, runId)

  if (fs.existsSync(worktreeDir)) {
    const removeRes = await runGit([
      'worktree',
      'remove',
      '--force',
      worktreeDir,
    ], root, signal)
    if (removeRes.exitCode !== 0) {
      throw new Error(`Failed to remove dev worktree "${worktreeDir}": ${formatGitError(removeRes)}`)
    }
  }
  else {
    const pruneRes = await runGit(['worktree', 'prune'], root, signal)
    if (pruneRes.exitCode !== 0) {
      throw new Error(`Failed to prune git worktrees: ${formatGitError(pruneRes)}`)
    }
  }

  await deleteMergedBranchIfExists(root, getWorktreeBranchName(runId), signal)
}

async function listConflictedFiles(cwd: string): Promise<string[]> {
  const result = await runGit(['diff', '--name-only', '--diff-filter=U'], cwd)
  if (result.exitCode !== 0) {
    return []
  }
  return result.stdout.split('\n').map(file => file.trim()).filter(Boolean)
}

async function mergeWorktreeBranch(workspaceRoot: string, branchName: string, commitMessage: string) {
  const ffResult = await runGit(['merge', '--ff-only', branchName], workspaceRoot)
  if (ffResult.exitCode === 0) {
    return {
      mergedBranch: branchName,
      strategy: 'ff-only' as const,
      hasConflicts: false,
      conflictedFiles: [],
      commitMessage,
    }
  }

  const ancestorCheck = await runGit([
    'merge-base',
    '--is-ancestor',
    'HEAD',
    branchName,
  ], workspaceRoot)
  if (ancestorCheck.exitCode !== 1) {
    throw new Error(`Failed to fast-forward merge ${branchName}: ${formatGitError(ffResult)}`)
  }

  const noFfResult = await runGit([
    'merge',
    '--no-ff',
    '--no-edit',
    branchName,
  ], workspaceRoot)
  if (noFfResult.exitCode === 0) {
    return {
      mergedBranch: branchName,
      strategy: 'no-ff' as const,
      hasConflicts: false,
      conflictedFiles: [],
      commitMessage,
    }
  }

  const conflictedFiles = await listConflictedFiles(workspaceRoot)
  if (conflictedFiles.length === 0) {
    throw new Error(`Failed to merge ${branchName} with --no-ff: ${formatGitError(noFfResult)}`)
  }

  return {
    mergedBranch: branchName,
    strategy: 'no-ff' as const,
    hasConflicts: true,
    conflictedFiles,
    commitMessage,
  }
}

async function verifyMergeCompleted(workspaceRoot: string, mergedBranch?: string) {
  const remainingConflicts = await listConflictedFiles(workspaceRoot)
  if (remainingConflicts.length > 0) {
    return { status: 'fail' as const, body: `Unresolved merge conflicts remain in: ${remainingConflicts.join(', ')}` }
  }
  const mergeHead = await runGit([
    'rev-parse',
    '-q',
    '--verify',
    'MERGE_HEAD',
  ], workspaceRoot)
  if (mergeHead.exitCode === 0) {
    return { status: 'fail' as const, body: 'Merge is still in progress (MERGE_HEAD exists). Stage all resolved files and finish with `git commit --no-edit`.' }
  }
  if (mergedBranch !== undefined && mergedBranch !== '') {
    const mergedCheck = await runGit([
      'merge-base',
      '--is-ancestor',
      mergedBranch,
      'HEAD',
    ], workspaceRoot)
    if (mergedCheck.exitCode !== 0) {
      return { status: 'fail' as const, body: `Branch ${mergedBranch} is not merged into HEAD (was the merge aborted?). Re-run \`git merge --no-ff --no-edit ${mergedBranch}\`, resolve conflicts, and commit.` }
    }
  }
  return { status: 'pass' as const, body: 'Merge conflicts resolved and merge commit completed.' }
}

export default createHarness('ludd-dev', {
  setup: async ({ runId, workspaceRoot, signal }) => setupDevWorktree(workspaceRoot, runId, signal),
  teardown: async ({ runId, workspaceRoot, signal }) => teardownDevWorktree(workspaceRoot, runId, signal),
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
    run: ctx => claudeAcp({
      permissionMode: 'readOnly',
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
    cwd: ctx => getRelativeWorktreePath(ctx.runId),
    beforeStep: [
      execGuardrail({
        name: 'Install Dependencies',
        command: 'pnpm install --frozen-lockfile',
      }),
    ],
    run: ctx => claudeAcp({
      permissionMode: 'acceptEdits',
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
      execGuardrail({ name: 'Build & Typecheck', command: 'pnpm build' }),
      execGuardrail({ name: 'Lint', command: 'pnpm lint' }),
      execGuardrail({ name: 'Test & Coverage', command: 'pnpm test:coverage' }),
      execGuardrail({
        name: 'Commitlint',
        command: sh`printf '%s\n' ${ctx.step.output.commitMessage} | pnpm run commitlint`,
      }),
      execGuardrail({ name: 'Pinact Check', command: 'pinact run --check' }),
      agentGuardrail({
        name: 'Code Review',
        mode: 'read-only',
        agent: codexAcp({ permissionMode: 'readOnly' }),
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
      const branchName = getWorktreeBranchName(ctx.runId)
      const commitMessage = ctx.steps.implement.output?.commitMessage ?? ''
      return mergeWorktreeBranch(getWorkspaceRoot(ctx.runId), branchName, commitMessage)
    },
  })
  .step({
    id: 'resolve-merge-conflicts',
    name: 'Resolve Merge Conflicts',
    if: ctx => ctx.steps.merge.output?.hasConflicts === true,
    run: ctx => claudeAcp({
      permissionMode: 'acceptEdits',
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
        run: async () => verifyMergeCompleted(
          getWorkspaceRoot(stepCtx.runId),
          stepCtx.steps.merge.output?.mergedBranch,
        ),
      }),
      execGuardrail({ name: 'Build & Typecheck', command: 'pnpm build' }),
      execGuardrail({ name: 'Lint', command: 'pnpm lint' }),
      execGuardrail({ name: 'Test & Coverage', command: 'pnpm test:coverage' }),
    ],
  })
  .build()
