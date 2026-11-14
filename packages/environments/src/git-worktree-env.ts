import type {
  DynamicProperty,
  EnvironmentAdapter,
  EnvironmentExecOptions,
  EnvironmentExecResult,
  ProvisionContext,
  ProvisionedEnvironment,
} from '@ludd/core'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { execHostEnvCommand } from './host-env.js'
import { resolveEnvironmentVariables } from './isolation/env-resolver.js'
import { buildIsolatedEnvironmentVars } from './security/env-sanitizer.js'
import { addGitWorktree, removeGitWorktree } from './worktree-helpers.js'

export interface GitWorktreeEnvOptions {
  id: string
  baseBranch?: string
  branchPrefix?: string
  whitelistEnv?: readonly string[]
  env?: DynamicProperty<Record<string, string>>
  ephemeralPorts?: readonly string[]
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
  ephemeralPorts?: Record<string, number>,
  injectedEnv?: Record<string, string>,
): ProvisionedEnvironment {
  const env: ProvisionedEnvironment = {
    __kind: 'environment',
    id: options.id,
    type: 'git-worktree',
    workingDir: worktreePath,
    branchName,
    ...(ephemeralPorts !== undefined
      ? { ephemeralPorts }
      : {}),
    ...(injectedEnv !== undefined
      ? { injectedEnv }
      : {}),
    exec: async (command: string | readonly string[], execOptions?: EnvironmentExecOptions): Promise<EnvironmentExecResult> => {
      const isolatedEnv = buildIsolatedEnvironmentVars({
        hostProcessEnv: process.env,
        whitelistEnv: options.whitelistEnv,
        staticEnv: injectedEnv,
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
    provision: async (context: ProvisionContext) => {
      const { runId, workspaceDir, defaultSignal } = context
      const { workspace, worktreePath } = resolveWorktreePaths(workspaceDir, runId, id)
      const branchPrefix = options.branchPrefix ?? 'ludd'
      const branchName = `${branchPrefix}/${runId}-${id}`

      await addGitWorktree(workspace, worktreePath, branchName, options.baseBranch, defaultSignal)
      const { ephemeralPorts, injectedEnv } = await resolveEnvironmentVariables(options, context)

      return createProvisionedWorktree(
        { ...options, id },
        branchName,
        worktreePath,
        workspace,
        defaultSignal,
        ephemeralPorts,
        injectedEnv,
      )
    },
  }
}
