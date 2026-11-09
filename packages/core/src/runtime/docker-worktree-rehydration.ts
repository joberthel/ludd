import type {
  EnvironmentExecOptions,
  EnvironmentExecResult,
  ProvisionedEnvironment,
} from '../types/environment.js'
import fs from 'node:fs'
import path from 'node:path'
import { execHostCommand } from './environment-exec.js'

async function pingDockerWorktree(
  workingDir: string,
  containerId?: string,
  signal?: AbortSignal,
): Promise<boolean> {
  if (!fs.existsSync(workingDir) || containerId === undefined || containerId === '') {
    return false
  }
  try {
    const result = await execHostCommand(
      workingDir,
      [
        'docker',
        'inspect',
        '-f',
        '{{.State.Running}}',
        containerId,
      ],
      { signal },
    )
    return result.exitCode === 0 && result.stdout.trim() === 'true'
  }
  catch {
    return false
  }
}

async function removeContainer(
  targetDir: string,
  containerId?: string,
  signal?: AbortSignal,
): Promise<void> {
  if (containerId === undefined || containerId === '') {
    return
  }
  try {
    await execHostCommand(targetDir, ['docker', 'rm', '-f', containerId], { signal })
  }
  catch {
    // Ignored if container is already removed
  }
}

async function teardownDockerWorktree(
  workingDir: string,
  containerId?: string,
  workspaceDir?: string,
  signal?: AbortSignal,
): Promise<void> {
  const gitCwd = workspaceDir ?? path.dirname(path.dirname(path.dirname(workingDir)))
  await removeContainer(gitCwd, containerId, signal)
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

async function execDockerWorktree(
  workingDir: string,
  containerId: string | undefined,
  command: string | readonly string[],
  options?: EnvironmentExecOptions,
  defaultSignal?: AbortSignal,
): Promise<EnvironmentExecResult> {
  const signal = options?.signal ?? defaultSignal
  if (containerId === undefined || containerId === '') {
    return execHostCommand(workingDir, command, { signal, ...options })
  }
  const cmdArgs = Array.isArray(command)
    ? command.map(String)
    : [
        'sh',
        '-c',
        String(command),
      ]
  const userArgs = options?.dangerMode
    ? ['-u', '0:0']
    : []
  const envArgs: string[] = []
  if (options?.env) {
    for (const [key, value] of Object.entries(options.env)) {
      envArgs.push('-e', `${key}=${value}`)
    }
  }
  return execHostCommand(workingDir, [
    'docker',
    'exec',
    ...userArgs,
    ...envArgs,
    containerId,
    ...cmdArgs,
  ], {
    signal,
    ...options,
  })
}

async function execRehydratedDocker(
  workingDir: string,
  containerId: string | undefined,
  injectedEnv: Record<string, string> | undefined,
  command: string | readonly string[],
  options?: EnvironmentExecOptions,
  defaultSignal?: AbortSignal,
): Promise<EnvironmentExecResult> {
  const mergedEnv = injectedEnv !== undefined
    ? {
        ...injectedEnv,
        ...(options?.env ?? {}),
      }
    : options?.env
  return execDockerWorktree(
    workingDir,
    containerId,
    command,
    {
      ...options,
      env: mergedEnv,
    },
    defaultSignal,
  )
}

export function createDockerWorktreeEnvironmentFromDescriptor(
  descriptor: {
    id: string
    type?: string
    workingDir: string
    containerId?: string
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
    type: 'docker-worktree',
    supportsDangerMode: true,
    workingDir,
    ...(descriptor.containerId !== undefined
      ? { containerId: descriptor.containerId }
      : {}),
    ...(descriptor.branchName !== undefined
      ? { branchName: descriptor.branchName }
      : {}),
    ...(descriptor.ephemeralPorts !== undefined
      ? { ephemeralPorts: descriptor.ephemeralPorts }
      : {}),
    ...(descriptor.injectedEnv !== undefined
      ? { injectedEnv: descriptor.injectedEnv }
      : {}),
    exec: async (command, options) => execRehydratedDocker(
      workingDir,
      descriptor.containerId,
      descriptor.injectedEnv,
      command,
      options,
      defaultSignal,
    ),
    ping: async () => pingDockerWorktree(workingDir, descriptor.containerId, defaultSignal),
    teardown: async () => teardownDockerWorktree(workingDir, descriptor.containerId, workspaceDir, defaultSignal),
  }
}
