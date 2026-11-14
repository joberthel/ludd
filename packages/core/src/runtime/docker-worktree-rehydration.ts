import type {
  EnvironmentExecOptions,
  EnvironmentExecResult,
  ProvisionedEnvironment,
} from '../types/environment.js'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { buildIsolatedEnvironmentVars } from './env-sanitizer.js'
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

function translateMcpServerUrl(url: string, bridgeHost = 'host.docker.internal'): string {
  const normalized = url.startsWith('http://') || url.startsWith('https://')
    ? url
    : `http://${url}`
  return normalized.replace(/\b(127\.0\.0\.1|localhost)\b/, bridgeHost)
}

async function execDockerWorktree(
  workingDir: string,
  containerId: string | undefined,
  command: string | readonly string[],
  options?: EnvironmentExecOptions,
  defaultSignal?: AbortSignal,
  bridgeHost?: string,
  whitelistEnv?: readonly string[],
  injectedEnv?: Record<string, string>,
): Promise<EnvironmentExecResult> {
  const signal = options?.signal ?? defaultSignal
  const isolatedEnv = buildIsolatedEnvironmentVars({
    hostProcessEnv: process.env,
    whitelistEnv,
    staticEnv: injectedEnv,
    injectedEnv: options?.env,
  })
  if (containerId === undefined || containerId === '') {
    return execHostCommand(workingDir, command, {
      ...options,
      signal,
      env: isolatedEnv,
      inheritEnv: false,
    })
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
  const cwdArgs = options?.cwd !== undefined
    ? ['-w', options.cwd]
    : []
  const envArgs: string[] = []
  for (const [key, value] of Object.entries(isolatedEnv)) {
    const finalValue = key === 'MCP_SERVER_URL'
      ? translateMcpServerUrl(value, bridgeHost)
      : value
    envArgs.push('-e', `${key}=${finalValue}`)
  }
  return execHostCommand(workingDir, [
    'docker',
    'exec',
    ...userArgs,
    ...cwdArgs,
    ...envArgs,
    containerId,
    ...cmdArgs,
  ], {
    timeoutMs: options?.timeoutMs,
    signal,
  })
}

export function createDockerWorktreeEnvironmentFromDescriptor(
  descriptor: {
    id: string
    type?: string
    workingDir: string
    containerId?: string
    containerWorkingDir?: string
    bridgeHost?: string
    whitelistEnv?: readonly string[]
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
    ...(descriptor.containerWorkingDir !== undefined
      ? { containerWorkingDir: descriptor.containerWorkingDir }
      : {}),
    ...(descriptor.bridgeHost !== undefined
      ? { bridgeHost: descriptor.bridgeHost }
      : {}),
    ...(descriptor.whitelistEnv !== undefined
      ? { whitelistEnv: descriptor.whitelistEnv }
      : {}),
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
    exec: async (command, options) => execDockerWorktree(
      workingDir,
      descriptor.containerId,
      command,
      options,
      defaultSignal,
      descriptor.bridgeHost,
      descriptor.whitelistEnv,
      descriptor.injectedEnv,
    ),
    ping: async () => pingDockerWorktree(workingDir, descriptor.containerId, defaultSignal),
    teardown: async () => teardownDockerWorktree(workingDir, descriptor.containerId, workspaceDir, defaultSignal),
  }
}
