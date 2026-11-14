import type { ProvisionedEnvironment } from '../types/environment.js'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { buildIsolatedEnvironmentVars } from './env-sanitizer.js'
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
    whitelistEnv?: readonly string[]
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
    ...(descriptor.whitelistEnv !== undefined
      ? { whitelistEnv: descriptor.whitelistEnv }
      : {}),
    exec: async (command, options) => {
      const isolatedEnv = buildIsolatedEnvironmentVars({
        hostProcessEnv: process.env,
        whitelistEnv: descriptor.whitelistEnv,
        staticEnv: descriptor.injectedEnv,
        injectedEnv: options?.env,
      })
      return execHostCommand(workingDir, command, {
        ...options,
        signal: options?.signal ?? defaultSignal,
        env: isolatedEnv,
        inheritEnv: false,
      })
    },
    ping: async () => pingGitWorktreeDir(workingDir, defaultSignal),
    teardown: async () => teardownGitWorktreeDir(workingDir, workspaceDir, defaultSignal),
  }
}
