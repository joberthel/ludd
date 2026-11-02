import type { Buffer } from 'node:buffer'
import type { ChildProcess, SpawnOptions } from 'node:child_process'
import type { ProjectRecord } from '../store/project-store.js'
import type { Task } from '../store/task-store.js'
import type { RefineMcpServerInstance } from './refine-mcp-server.js'
import { spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { getDefaultLuddHome } from './ensure-refine-skill.js'

export interface AgySettings {
  allowNonWorkspaceAccess: boolean
  toolPermission: string
  permissions: {
    allow: string[]
    deny: string[]
  }
}

export function buildAgySettings(): AgySettings {
  return {
    allowNonWorkspaceAccess: true,
    toolPermission: 'proceed-in-sandbox',
    permissions: {
      allow: ['mcp(ludd-refine/*)', 'read_file(*)'],
      deny: ['write_file(*)'],
    },
  }
}

export interface CreateAgySessionFilesOptions {
  mcpUrl: string
  luddHomeDir?: string
}

export async function createAgySessionFiles(
  sessionTempDir: string,
  options: CreateAgySessionFilesOptions,
): Promise<{ mcpConfigPath: string, skillsConfigPath: string }> {
  const agentsDir = path.join(sessionTempDir, '.agents')
  await fs.mkdir(agentsDir, { recursive: true })

  const mcpConfigPath = path.join(agentsDir, 'mcp_config.json')
  const mcpConfig = {
    mcpServers: {
      'ludd-refine': {
        serverUrl: options.mcpUrl,
        timeoutSeconds: -1,
      },
    },
  }
  await fs.writeFile(mcpConfigPath, JSON.stringify(mcpConfig, null, 2), 'utf8')

  const luddHome = options.luddHomeDir ?? getDefaultLuddHome()
  const skillsConfigPath = path.join(agentsDir, 'skills.json')
  const skillsConfig = {
    entries: [
      {
        path: path.join(luddHome, 'skills'),
      },
    ],
  }
  await fs.writeFile(skillsConfigPath, JSON.stringify(skillsConfig, null, 2), 'utf8')

  return { mcpConfigPath, skillsConfigPath }
}

export interface BuildAgyArgsOptions {
  model: string
  effort: string
  sessionDir: string
  taskId: number
  taskName: string
  settings?: AgySettings
}

export function buildAgyArgs(options: BuildAgyArgsOptions): string[] {
  const settings = options.settings ?? buildAgySettings()
  return [
    '--sandbox',
    '--model',
    options.model,
    '--effort',
    options.effort,
    '--add-dir',
    options.sessionDir,
    '--settings',
    JSON.stringify(settings),
    '-p',
    `/refine Task #${options.taskId}: ${options.taskName}`,
  ]
}

export type SpawnFunction = (
  command: string,
  args: readonly string[],
  options: SpawnOptions,
) => ChildProcess

export interface RunAgyRefineSessionOptions {
  task: Task
  project: ProjectRecord
  model: string
  effort: string
  mcpServer: Pick<RefineMcpServerInstance, 'url'>
  luddHomeDir?: string
  signal?: AbortSignal
  spawnFn?: SpawnFunction
  env?: NodeJS.ProcessEnv
}

export async function runAgyRefineSession(
  options: RunAgyRefineSessionOptions,
): Promise<void> {
  const sessionTempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ludd-agy-session-'))

  try {
    await createAgySessionFiles(sessionTempDir, {
      mcpUrl: options.mcpServer.url,
      luddHomeDir: options.luddHomeDir,
    })

    const args = buildAgyArgs({
      model: options.model,
      effort: options.effort,
      sessionDir: sessionTempDir,
      taskId: options.task.id,
      taskName: options.task.name,
    })

    const spawnImpl = options.spawnFn ?? spawn

    await new Promise<void>((resolve, reject) => {
      if (options.signal?.aborted) {
        reject(new Error('Refinement session aborted'))
        return
      }

      let child: ChildProcess
      let abortHandler: (() => void) | undefined

      try {
        child = spawnImpl('agy', args, {
          cwd: options.project.path,
          env: options.env ?? process.env,
          stdio: ['ignore', 'ignore', 'pipe'],
        })
      }
      catch (err) {
        reject(err)
        return
      }

      let stderrOutput = ''
      if (child.stderr) {
        child.stderr.on('data', (chunk: Buffer | string) => {
          stderrOutput += chunk.toString()
        })
      }

      const cleanupSignal = () => {
        if (abortHandler && options.signal) {
          options.signal.removeEventListener('abort', abortHandler)
        }
      }

      abortHandler = () => {
        cleanupSignal()
        if (child.exitCode === null && !child.killed) {
          try {
            child.kill('SIGTERM')
          }
          catch {
            // Ignore kill errors if already terminated
          }
        }
        reject(new Error('Refinement session aborted'))
      }

      if (options.signal) {
        options.signal.addEventListener('abort', abortHandler, { once: true })
      }

      child.on('error', (err) => {
        cleanupSignal()
        reject(err)
      })

      child.on('close', (code, sig) => {
        cleanupSignal()
        if (code === 0) {
          resolve()
        }
        else if (sig) {
          reject(new Error(`agy process terminated by signal ${sig}`))
        }
        else {
          const suffix = stderrOutput.trim()
            ? `: ${stderrOutput.trim()}`
            : ''
          reject(new Error(`agy exited with code ${code}${suffix}`))
        }
      })
    })
  }
  finally {
    await fs.rm(sessionTempDir, { force: true, recursive: true })
  }
}
