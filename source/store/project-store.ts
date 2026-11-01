import type { Store } from './create-store.js'
import { randomUUID } from 'node:crypto'
import { readdir, stat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import zod from 'zod'
import { createStore } from './create-store.js'

export const ProjectSchema = zod.object({
  name: zod.string().min(1).default('project'),
  description: zod.string().default(''),
  cwd: zod.string().min(1).default('/'),
}).strict().prefault({})

export type Project = zod.infer<typeof ProjectSchema>

export interface ProjectRecord extends Project {
  slug: string
}

export function getDefaultProjectsDir(): string {
  return path.join(os.homedir(), '.ludd', 'projects')
}

export function slugifyProjectName(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

  return slug || 'project'
}

export function appendUniqueHash(slug: string, hash = randomUUID().slice(0, 8)): string {
  return `${slug}-${hash}`
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

export async function findProjectByCwd(
  cwd: string,
  projectsDir = getDefaultProjectsDir(),
): Promise<ProjectRecord | undefined> {
  const resolvedCwd = path.resolve(cwd)

  let entries: string[]
  try {
    entries = await readdir(projectsDir)
  }
  catch {
    return undefined
  }

  for (const entry of entries) {
    const projectFilePath = path.join(projectsDir, entry, 'project.json')
    try {
      const fileStat = await stat(projectFilePath)
      if (fileStat.isFile()) {
        const store = createStore(projectFilePath, ProjectSchema)
        const projectData = await store.read()
        if (path.resolve(projectData.cwd) === resolvedCwd) {
          return {
            ...projectData,
            slug: entry,
          }
        }
      }
    }
    catch {
      // Ignore unreadable or non-project directories
    }
  }

  return undefined
}

export interface InitProjectOptions {
  name: string
  description?: string
  cwd: string
}

export interface InitProjectResult {
  slug: string
  project: Project
  filePath: string
  store: Store<typeof ProjectSchema>
}

export async function initProject(
  options: InitProjectOptions,
  projectsDir = getDefaultProjectsDir(),
): Promise<InitProjectResult> {
  const resolvedCwd = path.resolve(options.cwd)

  const existing = await findProjectByCwd(resolvedCwd, projectsDir)
  if (existing) {
    throw new Error(`Directory "${resolvedCwd}" is already initialized as project "${existing.name}"`)
  }

  const baseSlug = slugifyProjectName(options.name)
  let candidateSlug = baseSlug

  while (await pathExists(path.join(projectsDir, candidateSlug))) {
    candidateSlug = appendUniqueHash(baseSlug)
  }

  const targetDir = path.join(projectsDir, candidateSlug)
  const filePath = path.join(targetDir, 'project.json')
  const store = createStore(filePath, ProjectSchema)

  const projectData: Project = {
    name: options.name,
    description: options.description ?? '',
    cwd: resolvedCwd,
  }

  const written = await store.write(projectData)

  return {
    slug: candidateSlug,
    project: written,
    filePath,
    store,
  }
}
