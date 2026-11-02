import type { ProjectRecord } from './project-store.js'
import { readdir, rm, stat } from 'node:fs/promises'
import path from 'node:path'
import zod from 'zod'
import { createStore } from './create-store.js'
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
  branch: zod.string().trim().min(1),
  status: TaskStatusSchema.default('refinement'),
}).strict()

export type Task = zod.infer<typeof TaskSchema>

export function slugifyBranchName(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

  return slug || 'task'
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

function validateProjectSlug(slug: string): void {
  if (
    !slug
    || path.isAbsolute(slug)
    || path.basename(slug) !== slug
    || slug === '.'
    || slug === '..'
    || slug.includes('/')
    || slug.includes('\\')
  ) {
    throw new Error(`Invalid project slug "${slug}"`)
  }
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath)
    return true
  }
  catch {
    return false
  }
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

export async function createTask(
  options: CreateTaskOptions,
  projectsDir = getDefaultProjectsDir(),
): Promise<CreateTaskResult> {
  validateProjectSlug(options.projectSlug)
  const projectDir = path.join(projectsDir, options.projectSlug)
  const projectFilePath = path.join(projectDir, 'project.json')

  const exists = await pathExists(projectFilePath)
  if (!exists) {
    throw new Error(`Project "${options.projectSlug}" does not exist`)
  }

  const trimmedName = options.name?.trim()
  if (!trimmedName) {
    throw new Error('Task name cannot be empty')
  }

  const projectStore = createStore(projectFilePath, ProjectSchema)
  const updatedProject = await projectStore.update((current) => {
    return {
      ...current,
      taskCounter: (current.taskCounter ?? 0) + 1,
    }
  })

  const newTaskId = updatedProject.taskCounter
  const customBranch = options.branch?.trim()
  const branch = (customBranch !== undefined && customBranch !== '')
    ? customBranch
    : slugifyBranchName(trimmedName)

  const taskData: Task = {
    id: newTaskId,
    name: trimmedName,
    branch,
    status: options.status ?? 'refinement',
  }

  const taskFilePath = path.join(projectDir, 'tasks', String(newTaskId), 'task.json')
  const taskStore = createStore(taskFilePath, TaskSchema)
  const writtenTask = await taskStore.write(taskData)

  return {
    task: writtenTask,
    filePath: taskFilePath,
    project: {
      ...updatedProject,
      slug: options.projectSlug,
    },
  }
}

export async function listTasks(
  projectSlug: string,
  projectsDir = getDefaultProjectsDir(),
): Promise<Task[]> {
  validateProjectSlug(projectSlug)
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
  validateProjectSlug(projectSlug)
  const projectDir = path.join(projectsDir, projectSlug)
  const projectFilePath = path.join(projectDir, 'project.json')

  const projectExists = await pathExists(projectFilePath)
  if (!projectExists) {
    throw new Error(`Project "${projectSlug}" does not exist`)
  }

  if (ids.length === 0) {
    return []
  }

  const uniqueIds = [
    ...new Set(ids.map(id => parseTaskId(id))),
  ]

  for (const id of uniqueIds) {
    const taskFilePath = path.join(projectDir, 'tasks', String(id), 'task.json')
    const exists = await pathExists(taskFilePath)
    if (!exists) {
      throw new Error(`Task #${id} does not exist in project "${projectSlug}"`)
    }
  }

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
