import type { ProvisionedEnvironment } from '../types/environment.js'
import fs from 'node:fs'
import path from 'node:path'
import { execHostCommand } from './environment-exec.js'

async function pingGitWorktreeDir(workingDir: string, signal?: AbortSignal): Promise<boolean> {
  if (!fs.existsSync(workingDir)) {
    return false
  }
  try {
    const result = await execHostCommand(workingDir, ['git', 'rev-parse', '--is-inside-work-tree'], { signal })
    return result.exitCode === 0
  }
  catch {
    return false
  }
}

async function teardownGitWorktreeDir(
  workingDir: string,
  workspaceDir?: string,
  signal?: AbortSignal,
): Promise<void> {
  const gitCwd = workspaceDir ?? path.dirname(path.dirname(path.dirname(workingDir)))
  try {
    await execHostCommand(gitCwd, [
      'git',
      'worktree',
      'remove',
      '--force',
      workingDir,
    ], { signal })
  }
  catch {
    // Ignored if already removed
  }
  if (fs.existsSync(workingDir)) {
    fs.rmSync(workingDir, { recursive: true, force: true })
  }
}

export function createGitWorktreeEnvironmentFromDescriptor(
  descriptor: {
    id: string
    type?: string
    workingDir: string
    branchName?: string
    ephemeralPorts?: Record<string, number>
    injectedEnv?: Record<string, string>
  },
  defaultSignal?: AbortSignal,
  workspaceDir?: string,
): ProvisionedEnvironment {
  const workingDir = path.resolve(descriptor.workingDir)
  return {
    __kind: 'environment',
    id: descriptor.id,
    type: 'git-worktree',
    workingDir,
    ...(descriptor.branchName !== undefined
      ? { branchName: descriptor.branchName }
      : {}),
    ...(descriptor.ephemeralPorts !== undefined
      ? { ephemeralPorts: descriptor.ephemeralPorts }
      : {}),
    ...(descriptor.injectedEnv !== undefined
      ? { injectedEnv: descriptor.injectedEnv }
      : {}),
    exec: async (command, options) => {
      const mergedEnv = descriptor.injectedEnv !== undefined
        ? {
            ...descriptor.injectedEnv,
            ...(options?.env ?? {}),
          }
        : options?.env
      return execHostCommand(workingDir, command, {
        signal: options?.signal ?? defaultSignal,
        ...options,
        env: mergedEnv,
      })
    },
    ping: async () => pingGitWorktreeDir(workingDir, defaultSignal),
    teardown: async () => teardownGitWorktreeDir(workingDir, workspaceDir, defaultSignal),
  }
}
