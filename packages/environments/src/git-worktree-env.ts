import type {
  EnvironmentAdapter,
  EnvironmentExecOptions,
  EnvironmentExecResult,
  ProvisionedEnvironment,
} from '@ludd/core'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { execHostEnvCommand } from './host-env.js'
import { buildIsolatedEnvironmentVars } from './security/env-sanitizer.js'

export interface GitWorktreeEnvOptions {
  id: string
  baseBranch?: string
  branchPrefix?: string
  whitelistEnv?: readonly string[]
  env?: Record<string, string>
}

function validateOptions(options: GitWorktreeEnvOptions): string {
  if (typeof options?.id !== 'string' || options.id.trim() === '') {
    throw new Error('gitWorktreeEnv requires a valid non-empty id.')
  }
  return options.id.trim()
}

function resolveWorktreePaths(workspaceDir: string, runId: string, id: string): {
  workspace: string
  worktreePath: string
} {
  const workspace = path.resolve(workspaceDir)
  const worktreePath = path.resolve(workspace, '.harness', 'worktrees', `${runId}-${id}`)
  return { workspace, worktreePath }
}

async function addGitWorktree(
  workspaceDir: string,
  worktreePath: string,
  branchName: string,
  baseBranch?: string,
  signal?: AbortSignal,
): Promise<void> {
  fs.mkdirSync(path.dirname(worktreePath), { recursive: true })
  const result = await execHostEnvCommand(
    workspaceDir,
    [
      'git',
      'worktree',
      'add',
      '-b',
      branchName,
      worktreePath,
      baseBranch ?? 'HEAD',
    ],
    { signal },
  )
  if (result.exitCode !== 0) {
    const errorDetails = result.stderr.trim() || result.stdout.trim() || `exit code ${result.exitCode}`
    throw new Error(`Failed to create git worktree: ${errorDetails}`)
  }
}

async function removeGitWorktree(
  workspaceDir: string,
  worktreePath: string,
  signal?: AbortSignal,
): Promise<void> {
  try {
    await execHostEnvCommand(
      workspaceDir,
      [
        'git',
        'worktree',
        'remove',
        '--force',
        worktreePath,
      ],
      { signal },
    )
  }
  catch {
    // Ignore errors if worktree is already detached or removed
  }
  if (fs.existsSync(worktreePath)) {
    fs.rmSync(worktreePath, { recursive: true, force: true })
  }
}

async function pingGitWorktree(
  worktreePath: string,
  signal?: AbortSignal,
): Promise<boolean> {
  if (!fs.existsSync(worktreePath)) {
    return false
  }
  try {
    const result = await execHostEnvCommand(
      worktreePath,
      ['git', 'rev-parse', '--is-inside-work-tree'],
      { signal },
    )
    return result.exitCode === 0
  }
  catch {
    return false
  }
}

function createProvisionedWorktree(
  options: GitWorktreeEnvOptions,
  branchName: string,
  worktreePath: string,
  workspaceDir: string,
  defaultSignal?: AbortSignal,
): ProvisionedEnvironment {
  const env: ProvisionedEnvironment = {
    __kind: 'environment',
    id: options.id,
    type: 'git-worktree',
    workingDir: worktreePath,
    branchName,
    exec: async (command: string | readonly string[], execOptions?: EnvironmentExecOptions): Promise<EnvironmentExecResult> => {
      const isolatedEnv = buildIsolatedEnvironmentVars({
        hostProcessEnv: process.env,
        whitelistEnv: options.whitelistEnv,
        staticEnv: options.env,
        injectedEnv: execOptions?.env,
      })
      return execHostEnvCommand(env.workingDir, command, {
        ...execOptions,
        signal: execOptions?.signal ?? defaultSignal,
        env: isolatedEnv,
        inheritEnv: false,
      })
    },
    ping: async (): Promise<boolean> => pingGitWorktree(env.workingDir, defaultSignal),
    teardown: async (): Promise<void> => removeGitWorktree(workspaceDir, env.workingDir, defaultSignal),
  }
  return env
}

export function gitWorktreeEnv(options: GitWorktreeEnvOptions): EnvironmentAdapter {
  const id = validateOptions(options)

  return {
    __kind: 'environment-adapter',
    id,
    type: 'git-worktree',
    provision: async ({ runId, workspaceDir, defaultSignal }) => {
      const { workspace, worktreePath } = resolveWorktreePaths(workspaceDir, runId, id)
      const branchPrefix = options.branchPrefix ?? 'ludd'
      const branchName = `${branchPrefix}/${runId}-${id}`

      await addGitWorktree(workspace, worktreePath, branchName, options.baseBranch, defaultSignal)

      return createProvisionedWorktree({ ...options, id }, branchName, worktreePath, workspace, defaultSignal)
    },
  }
}
