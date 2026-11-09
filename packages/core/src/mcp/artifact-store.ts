import type { ArtifactClient } from '../types/artifact.js'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

export function sanitizeArtifactPath(runDir: string, key: string): string {
  if (typeof key !== 'string' || key.trim() === '') {
    throw new Error('Artifact key must be a non-empty string.')
  }
  if (key.includes('\0')) {
    throw new Error('Artifact key cannot contain null bytes.')
  }
  if (key.startsWith('/')) {
    throw new Error('Artifact key cannot start with a slash.')
  }
  if (key.includes('\\')) {
    throw new Error('Artifact key cannot contain backslashes.')
  }

  const segments = key.split('/')
  for (const segment of segments) {
    if (segment === '.' || segment === '..' || segment === '') {
      throw new Error(`Artifact key contains invalid path segment: "${segment}".`)
    }
  }

  const artifactsDir = path.resolve(runDir, 'artifacts')
  const resolvedPath = path.resolve(artifactsDir, key)
  const relative = path.relative(artifactsDir, resolvedPath)

  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Artifact path escapes artifacts directory: "${key}".`)
  }

  return resolvedPath
}

async function readArtifactFile(targetPath: string): Promise<string | null> {
  try {
    const stat = await fs.promises.stat(targetPath)
    if (!stat.isFile()) {
      return null
    }
    return await fs.promises.readFile(targetPath, 'utf8')
  }
  catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null
    }
    throw error
  }
}

async function checkArtifactFile(targetPath: string): Promise<boolean> {
  try {
    const stat = await fs.promises.stat(targetPath)
    return stat.isFile()
  }
  catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return false
    }
    throw error
  }
}

export function createArtifactStore(runDir: string): ArtifactClient {
  const store: ArtifactClient = {
    put: async (key: string, content: string): Promise<void> => {
      if (typeof content !== 'string') {
        throw new TypeError('Artifact content must be a string.')
      }
      const targetPath = sanitizeArtifactPath(runDir, key)
      const parentDir = path.dirname(targetPath)
      await fs.promises.mkdir(parentDir, { recursive: true })
      const tmpPath = `${targetPath}.${randomUUID()}.tmp`
      await fs.promises.writeFile(tmpPath, content, 'utf8')
      await fs.promises.rename(tmpPath, targetPath)
    },

    get: async (key: string): Promise<string | null> => readArtifactFile(sanitizeArtifactPath(runDir, key)),

    getJson: async <T = unknown>(key: string): Promise<T | null> => {
      const raw = await store.get(key)
      if (raw === null) {
        return null
      }
      return JSON.parse(raw) as T
    },

    has: async (key: string): Promise<boolean> => checkArtifactFile(sanitizeArtifactPath(runDir, key)),
  }

  return store
}
