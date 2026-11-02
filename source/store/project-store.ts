import type { Store } from './create-store.js'
import { randomUUID } from 'node:crypto'
import { readdir, rm, stat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import zod from 'zod'
import { createStore } from './create-store.js'

export const ProjectSchema = zod.object({
  name: zod.string().trim().min(1).default('project'),
  description: zod.string().default(''),
  path: zod.string().min(1).default('/'),
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

export async function listProjects(
  projectsDir = getDefaultProjectsDir(),
): Promise<ProjectRecord[]> {
  let entries: string[]
  try {
    entries = await readdir(projectsDir)
  }
  catch {
    return []
  }

  const projects: ProjectRecord[] = []

  for (const entry of entries) {
    const projectFilePath = path.join(projectsDir, entry, 'project.json')
    try {
      const fileStat = await stat(projectFilePath)
      if (fileStat.isFile()) {
        const store = createStore(projectFilePath, ProjectSchema)
        const projectData = await store.read()
        projects.push({
          ...projectData,
          slug: entry,
        })
      }
    }
    catch {
      // Ignore unreadable or non-project directories
    }
  }

  return projects.sort((a, b) => a.slug.localeCompare(b.slug))
}

export async function findProjectByPath(
  projectPath: string,
  projectsDir = getDefaultProjectsDir(),
): Promise<ProjectRecord | undefined> {
  const resolvedPath = path.resolve(projectPath)
  return (await listProjects(projectsDir)).find(p => path.resolve(p.path) === resolvedPath)
}

export class RemoveProjectsError extends Error {
  constructor(
    message: string,
    public readonly removedSlugs: string[],
  ) {
    super(message)
    this.name = 'RemoveProjectsError'
  }
}

export async function removeProjects(
  slugs: string[],
  projectsDir = getDefaultProjectsDir(),
  rmFn: (target: string, options: { force: boolean, recursive: boolean }) => Promise<void> = rm,
): Promise<string[]> {
  for (const slug of slugs) {
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
    const targetDir = path.join(projectsDir, slug)
    const exists = await pathExists(targetDir)
    if (!exists) {
      throw new Error(`Project "${slug}" does not exist`)
    }
  }

  const removed: string[] = []
  for (const slug of slugs) {
    const targetDir = path.join(projectsDir, slug)
    try {
      await rmFn(targetDir, { force: false, recursive: true })
      removed.push(slug)
    }
    catch (err) {
      const detail = err instanceof Error
        ? err.message
        : String(err)
      const partialInfo = removed.length > 0
        ? ` (partially removed: ${removed.join(', ')})`
        : ''
      throw new RemoveProjectsError(
        `Failed to remove project "${slug}"${partialInfo}: ${detail}`,
        removed,
      )
    }
  }

  return slugs
}

export interface InitProjectOptions {
  name: string
  description?: string
  path: string
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
  const resolvedPath = path.resolve(options.path)

  const existing = await findProjectByPath(resolvedPath, projectsDir)
  if (existing) {
    throw new Error(`Directory "${resolvedPath}" is already initialized as project "${existing.name}"`)
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
    name: options.name.trim(),
    description: options.description ?? '',
    path: resolvedPath,
  }

  const written = await store.write(projectData)

  return {
    slug: candidateSlug,
    project: written,
    filePath,
    store,
  }
}
