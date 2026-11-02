import type { ProjectRecord } from './project-store.js'
import { mkdir, open, readdir, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import zod from 'zod'
import { createStore } from './create-store.js'
import { isValidBranchName, pathExists, slugify, validateSlug } from './fs-utils.js'
import { getDefaultProjectsDir, ProjectSchema } from './project-store.js'

export const TaskStatusSchema = zod.enum([
  'refinement',
  'todo',
  'in_progress',
  'done',
])

export type TaskStatus = zod.infer<typeof TaskStatusSchema>

export const TaskSchema = zod.object({
  id: zod.number().int().positive(),
  name: zod.string().trim().min(1),
  branch: zod.string().trim().min(1).refine(isValidBranchName, {
    message: 'Invalid branch name',
  }),
  status: TaskStatusSchema.default('refinement'),
}).strict()

export type Task = zod.infer<typeof TaskSchema>

export function slugifyBranchName(name: string): string {
  return slugify(name, 'task')
}

export function parseTaskId(raw: number | string): number {
  const text = String(raw).trim()
  const normalized = text.startsWith('#')
    ? text.slice(1)
    : text
  if (!/^[1-9]\d*$/.test(normalized)) {
    throw new Error(`Invalid task ID "${raw}"`)
  }
  return Number.parseInt(normalized, 10)
}

export interface CreateTaskOptions {
  projectSlug: string
  name: string
  branch?: string
  status?: TaskStatus
}

export interface CreateTaskResult {
  task: Task
  filePath: string
  project: ProjectRecord
}

async function withProjectLock<T>(projectDir: string, fn: () => Promise<T>): Promise<T> {
  const lockPath = path.join(projectDir, '.project.lock')
  const maxRetries = 200
  const retryDelay = 25

  for (let i = 0; i < maxRetries; i++) {
    let handle
    try {
      handle = await open(lockPath, 'wx')
      break
    }
    catch (err: unknown) {
      const isExist = typeof err === 'object'
        && err !== null
        && 'code' in err
        && (err as { code: string }).code === 'EEXIST'
      if (!isExist) {
        throw err
      }
      await new Promise(resolve => setTimeout(resolve, retryDelay + Math.random() * 15))
    }
    finally {
      if (handle) {
        await handle.close()
      }
    }
    if (i === maxRetries - 1) {
      throw new Error(`Timeout acquiring lock on project "${path.basename(projectDir)}"`)
    }
  }

  try {
    return await fn()
  }
  finally {
    await rm(lockPath, { force: true })
  }
}

export async function createTask(
  options: CreateTaskOptions,
  projectsDir = getDefaultProjectsDir(),
): Promise<CreateTaskResult> {
  validateSlug(options.projectSlug, 'project slug')
  const projectDir = path.join(projectsDir, options.projectSlug)
  const projectFilePath = path.join(projectDir, 'project.json')

  const exists = await pathExists(projectFilePath)
  if (!exists) {
    throw new Error(`Project "${options.projectSlug}" does not exist`)
  }

  const trimmedName = options.name.trim()
  if (trimmedName === '') {
    throw new Error('Task name cannot be empty')
  }

  const branch = (options.branch !== undefined && options.branch.trim() !== '')
    ? options.branch.trim()
    : slugifyBranchName(trimmedName)

  return withProjectLock(projectDir, async () => {
    const projectStore = createStore(projectFilePath, ProjectSchema)
    const projectData = await projectStore.read()

    const tasksBaseDir = path.join(projectDir, 'tasks')
    await mkdir(tasksBaseDir, { recursive: true })

    let candidateId = projectData.taskCounter + 1
    let acquiredDir = false

    while (!acquiredDir) {
      const candidateDir = path.join(tasksBaseDir, String(candidateId))
      try {
        await mkdir(candidateDir)
        acquiredDir = true
      }
      catch (err: unknown) {
        const isExist = typeof err === 'object'
          && err !== null
          && 'code' in err
          && (err as { code: string }).code === 'EEXIST'
        if (isExist) {
          candidateId++
        }
        else {
          throw err
        }
      }
    }

    const taskData: Task = {
      id: candidateId,
      name: trimmedName,
      branch,
      status: options.status ?? 'refinement',
    }

    const taskFilePath = path.join(tasksBaseDir, String(candidateId), 'task.json')
    const serialized = JSON.stringify(TaskSchema.parse(taskData), null, 2)
    await writeFile(taskFilePath, serialized, { flag: 'wx' })

    const updatedProject = await projectStore.write({
      ...projectData,
      taskCounter: candidateId,
    })

    return {
      task: taskData,
      filePath: taskFilePath,
      project: {
        ...updatedProject,
        slug: options.projectSlug,
      },
    }
  })
}

export async function listTasks(
  projectSlug: string,
  projectsDir = getDefaultProjectsDir(),
): Promise<Task[]> {
  validateSlug(projectSlug, 'project slug')
  const tasksDir = path.join(projectsDir, projectSlug, 'tasks')

  let entries: string[]
  try {
    entries = await readdir(tasksDir)
  }
  catch {
    return []
  }

  const tasks: Task[] = []

  for (const entry of entries) {
    const taskFilePath = path.join(tasksDir, entry, 'task.json')
    try {
      const fileStat = await stat(taskFilePath)
      if (fileStat.isFile()) {
        const store = createStore(taskFilePath, TaskSchema)
        const taskData = await store.read()
        tasks.push(taskData)
      }
    }
    catch {
      // Ignore invalid, corrupt, or non-task files
    }
  }

  return tasks.sort((a, b) => a.id - b.id)
}

async function readTaskOrThrow(
  projectDir: string,
  projectSlug: string,
  id: number | string,
): Promise<Task> {
  const taskId = parseTaskId(id)
  const taskDir = path.join(projectDir, 'tasks', String(taskId))
  const taskDirExists = await pathExists(taskDir)
  if (!taskDirExists) {
    throw new Error(`Task #${taskId} does not exist in project "${projectSlug}"`)
  }

  const taskFilePath = path.join(taskDir, 'task.json')
  const fileExists = await pathExists(taskFilePath)
  if (!fileExists) {
    throw new Error(`Task #${taskId} in project "${projectSlug}" is corrupt (missing task.json)`)
  }

  try {
    const store = createStore(taskFilePath, TaskSchema)
    return await store.read()
  }
  catch (err: unknown) {
    const detail = err instanceof Error
      ? err.message
      : String(err)
    throw new Error(`Task #${taskId} in project "${projectSlug}" is corrupt (${detail})`)
  }
}

export async function getTask(
  projectSlug: string,
  id: number | string,
  projectsDir = getDefaultProjectsDir(),
): Promise<Task> {
  validateSlug(projectSlug, 'project slug')
  const projectDir = path.join(projectsDir, projectSlug)
  const projectFilePath = path.join(projectDir, 'project.json')

  const exists = await pathExists(projectFilePath)
  if (!exists) {
    throw new Error(`Project "${projectSlug}" does not exist`)
  }

  return readTaskOrThrow(projectDir, projectSlug, id)
}

export async function resolveTaskIds(
  projectSlug: string,
  ids: (number | string)[],
  projectsDir = getDefaultProjectsDir(),
): Promise<number[]> {
  validateSlug(projectSlug, 'project slug')
  const projectDir = path.join(projectsDir, projectSlug)
  const projectFilePath = path.join(projectDir, 'project.json')

  const exists = await pathExists(projectFilePath)
  if (!exists) {
    throw new Error(`Project "${projectSlug}" does not exist`)
  }

  if (ids.length === 0) {
    return []
  }

  const uniqueIds = [
    ...new Set(ids.map(id => parseTaskId(id))),
  ]

  for (const id of uniqueIds) {
    await readTaskOrThrow(projectDir, projectSlug, id)
  }

  return uniqueIds
}

export class RemoveTasksError extends Error {
  constructor(
    message: string,
    public readonly removedIds: number[],
  ) {
    super(message)
    this.name = 'RemoveTasksError'
  }
}

export async function removeTasks(
  projectSlug: string,
  ids: (number | string)[],
  projectsDir = getDefaultProjectsDir(),
  rmFn: (target: string, options: { force: boolean, recursive: boolean }) => Promise<void> = rm,
): Promise<number[]> {
  const uniqueIds = await resolveTaskIds(projectSlug, ids, projectsDir)
  const projectDir = path.join(projectsDir, projectSlug)

  const removedIds: number[] = []
  for (const id of uniqueIds) {
    const taskDir = path.join(projectDir, 'tasks', String(id))
    try {
      await rmFn(taskDir, { force: false, recursive: true })
      removedIds.push(id)
    }
    catch (err) {
      const detail = err instanceof Error
        ? err.message
        : String(err)
      const partialInfo = removedIds.length > 0
        ? ` (partially removed: #${removedIds.join(', #')})`
        : ''
      throw new RemoveTasksError(
        `Failed to remove task #${id} in project "${projectSlug}"${partialInfo}: ${detail}`,
        removedIds,
      )
    }
  }

  return removedIds
}
