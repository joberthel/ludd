import { stat } from 'node:fs/promises'
import path from 'node:path'

export function slugify(text: string, fallback: string): string {
  const normalized = text
    .normalize('NFKD')
    .replace(/[\u0300-\u036F]/g, '')
    .replace(/ß/g, 'ss')
    .replace(/ẞ/g, 'ss')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

  return normalized || fallback
}

export function validateSlug(slug: string, entity = 'slug'): void {
  if (
    !slug
    || path.isAbsolute(slug)
    || path.basename(slug) !== slug
    || slug === '.'
    || slug === '..'
    || slug.includes('/')
    || slug.includes('\\')
  ) {
    throw new Error(`Invalid ${entity} "${slug}"`)
  }
}

export async function pathExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath)
    return true
  }
  catch {
    return false
  }
}

export function isValidBranchName(branch: string): boolean {
  if (!branch || branch.trim() !== branch) {
    return false
  }
  if (
    branch.startsWith('.')
    || branch.endsWith('.')
    || branch.endsWith('.lock')
    || branch.endsWith('/')
  ) {
    return false
  }
  for (let i = 0; i < branch.length; i++) {
    const code = branch.charCodeAt(i)
    if (code <= 32 || code === 127) {
      return false
    }
  }
  if (/[~^:?*[\\\]]|\.\.|@\{/.test(branch)) {
    return false
  }
  if (branch.split('/').some(segment => segment === '' || segment.startsWith('.'))) {
    return false
  }
  return true
}
