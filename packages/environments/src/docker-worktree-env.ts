import type {
  DynamicProperty,
  EnvironmentAdapter,
  EnvironmentExecOptions,
  EnvironmentExecResult,
  ProvisionContext,
  ProvisionedEnvironment,
} from '@ludd/core'
import type { DockerMount } from './security/mount-validator.js'
import path from 'node:path'
import process from 'node:process'
import { execHostEnvCommand } from './host-env.js'
import { resolveEnvironmentVariables } from './isolation/env-resolver.js'
import { buildIsolatedEnvironmentVars } from './security/env-sanitizer.js'
import {
  buildMountFlags,
  validateAllMountPaths,
} from './security/mount-validator.js'
import {
  addGitWorktree,
  pingDockerWorktree,
  removeContainer,
  removeGitWorktree,
} from './worktree-helpers.js'

export type { DockerMount }

export interface DockerWorktreeEnvOptions {
  id: string
  image?: string
  containerWorkdir?: string
  bridgeHost?: string
  baseBranch?: string
  branchPrefix?: string
  whitelistEnv?: readonly string[]
  env?: DynamicProperty<Record<string, string>>
  ephemeralPorts?: readonly string[]
  customMounts?: readonly DockerMount[]
  mounts?: readonly DockerMount[]
}

function validateOptions(options: DockerWorktreeEnvOptions): string {
  if (typeof options?.id !== 'string' || options.id.trim() === '') {
    throw new Error('dockerWorktreeEnv requires a valid non-empty id.')
  }
  return options.id.trim()
}

export function translateMcpServerUrl(url: string, bridgeHost: string = 'host.docker.internal'): string {
  const normalized = url.startsWith('http://') || url.startsWith('https://')
    ? url
    : `http://${url}`
  return normalized.replace(/\b(127\.0\.0\.1|localhost)\b/, bridgeHost)
}

function parseContainerCommand(command: string | readonly string[]): string[] {
  if (Array.isArray(command)) {
    if (command.length === 0) {
      throw new Error('Command array must not be empty.')
    }
    return command.map(String)
  }
  if (typeof command === 'string') {
    if (command.trim() === '') {
      throw new Error('Command string must not be empty.')
    }
    return ['sh', '-c', command]
  }
  throw new TypeError('Command must be a non-empty string or array of strings.')
}

function buildDockerEnvFlags(env: Record<string, string>, bridgeHost: string): string[] {
  const flags: string[] = []
  for (const [key, value] of Object.entries(env)) {
    const finalValue = key === 'MCP_SERVER_URL'
      ? translateMcpServerUrl(value, bridgeHost)
      : value
    flags.push('-e', `${key}=${finalValue}`)
  }
  return flags
}

async function spawnContainer(
  workspaceDir: string,
  worktreePath: string,
  containerName: string,
  options: DockerWorktreeEnvOptions,
  signal?: AbortSignal,
): Promise<string> {
  const containerWorkdir = options.containerWorkdir ?? '/workspace'
  const image = options.image ?? 'node:22-alpine'
  const mountFlags = buildMountFlags(workspaceDir, options.customMounts ?? options.mounts)
  const dockerArgs = [
    'docker',
    'run',
    '-d',
    '--name',
    containerName,
    '--add-host',
    'host.docker.internal:host-gateway',
    '-v',
    `${worktreePath}:${containerWorkdir}`,
    ...mountFlags,
    '-w',
    containerWorkdir,
    image,
    'sleep',
    'infinity',
  ]
  const result = await execHostEnvCommand(workspaceDir, dockerArgs, { signal })
  if (result.exitCode !== 0) {
    await removeGitWorktree(workspaceDir, worktreePath, signal)
    const errorDetails = result.stderr.trim() || result.stdout.trim() || `exit code ${result.exitCode}`
    throw new Error(`Failed to create docker container: ${errorDetails}`)
  }
  return result.stdout.trim()
}

async function execDockerEnv(
  worktreePath: string,
  containerId: string,
  command: string | readonly string[],
  options: DockerWorktreeEnvOptions,
  bridgeHost: string,
  injectedEnv?: Record<string, string>,
  execOptions?: EnvironmentExecOptions,
  defaultSignal?: AbortSignal,
): Promise<EnvironmentExecResult> {
  const cmdArgs = parseContainerCommand(command)
  const isolatedEnv = buildIsolatedEnvironmentVars({
    hostProcessEnv: process.env,
    whitelistEnv: options.whitelistEnv,
    staticEnv: injectedEnv,
    injectedEnv: execOptions?.env,
  })
  const envFlags = buildDockerEnvFlags(isolatedEnv, bridgeHost)
  const userFlags = execOptions?.dangerMode
    ? ['-u', '0:0']
    : []
  const cwdFlags = execOptions?.cwd !== undefined
    ? ['-w', execOptions.cwd]
    : []
  return execHostEnvCommand(
    worktreePath,
    [
      'docker',
      'exec',
      ...userFlags,
      ...cwdFlags,
      ...envFlags,
      containerId,
      ...cmdArgs,
    ],
    {
      timeoutMs: execOptions?.timeoutMs,
      signal: execOptions?.signal ?? defaultSignal,
    },
  )
}

function createProvisionedDockerEnv(
  options: DockerWorktreeEnvOptions,
  containerId: string,
  worktreePath: string,
  branchName: string,
  workspaceDir: string,
  defaultSignal?: AbortSignal,
  ephemeralPorts?: Record<string, number>,
  injectedEnv?: Record<string, string>,
): ProvisionedEnvironment {
  const bridgeHost = options.bridgeHost ?? 'host.docker.internal'
  return {
    __kind: 'environment',
    id: options.id,
    type: 'docker-worktree',
    supportsDangerMode: true,
    workingDir: worktreePath,
    containerWorkingDir: options.containerWorkdir ?? '/workspace',
    containerId,
    branchName,
    ...(ephemeralPorts !== undefined
      ? { ephemeralPorts }
      : {}),
    ...(injectedEnv !== undefined
      ? { injectedEnv }
      : {}),
    exec: async (command, execOptions) => execDockerEnv(
      worktreePath,
      containerId,
      command,
      options,
      bridgeHost,
      injectedEnv,
      execOptions,
      defaultSignal,
    ),
    ping: async (): Promise<boolean> => pingDockerWorktree(worktreePath, containerId, defaultSignal),
    teardown: async (): Promise<void> => {
      await removeContainer(workspaceDir, containerId, defaultSignal)
      await removeGitWorktree(workspaceDir, worktreePath, defaultSignal)
    },
  }
}

export function dockerWorktreeEnv(options: DockerWorktreeEnvOptions): EnvironmentAdapter {
  const id = validateOptions(options)

  return {
    __kind: 'environment-adapter',
    id,
    type: 'docker-worktree',
    supportsDangerMode: true,
    provision: async (context: ProvisionContext) => {
      const { runId, workspaceDir, defaultSignal } = context
      const workspace = path.resolve(workspaceDir)
      const worktreePath = path.resolve(workspace, '.harness', 'worktrees', `${runId}-${id}`)
      validateAllMountPaths(workspace, worktreePath, options.customMounts ?? options.mounts)
      const branchPrefix = options.branchPrefix ?? 'ludd'
      const branchName = `${branchPrefix}/${runId}-${id}`
      const containerName = `ludd-${runId}-${id}`

      await addGitWorktree(workspace, worktreePath, branchName, options.baseBranch, defaultSignal)
      const containerId = await spawnContainer(workspace, worktreePath, containerName, options, defaultSignal)
      const { ephemeralPorts, injectedEnv } = await resolveEnvironmentVariables(options, context)

      return createProvisionedDockerEnv(
        { ...options, id },
        containerId,
        worktreePath,
        branchName,
        workspace,
        defaultSignal,
        ephemeralPorts,
        injectedEnv,
      )
    },
  }
}
