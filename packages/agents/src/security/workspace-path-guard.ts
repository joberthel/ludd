import fs from 'node:fs'
import path from 'node:path'
import { SandboxViolationError } from '@ludd/core'

export interface WorkspacePathGuardOptions {
  /** Permits paths outside the workspace root (only valid inside an isolated container). */
  dangerMode?: boolean
  /** Container mount point (e.g. `/workspace`) mapped back to `workspaceRoot`. */
  containerWorkingDir?: string
}

/**
 * Strips `containerWorkingDir` prefix from container-absolute paths so they
 * resolve relative to `workspaceRoot` on the host.
 */
export function normalizeContainerPath(target: string, containerWorkingDir?: string): string {
  if (containerWorkingDir === undefined || containerWorkingDir === '') {
    return target
  }
  const normalizedRoot = containerWorkingDir.replace(/\/+$/, '')
  if (target === normalizedRoot) {
    return '.'
  }
  if (target.startsWith(`${normalizedRoot}/`)) {
    return target.slice(normalizedRoot.length + 1)
  }
  return target
}

const PROTECTED_PREFIXES: string[][] = [
  ['.harness', 'runs'],
  ['.git', 'hooks'],
]

/** Resolves symlinks for the nearest existing ancestor and re-appends the nonexistent tail. */
function realpathNearest(target: string): string {
  const tail: string[] = []
  let current = target
  for (;;) {
    try {
      return path.join(fs.realpathSync(current), ...tail.reverse())
    }
    catch {
      tail.push(path.basename(current))
      current = path.dirname(current)
    }
  }
}

function isProtected(segments: string[]): boolean {
  return PROTECTED_PREFIXES.some(prefix => prefix.every((part, i) => segments[i] === part))
}

/**
 * Rejects access to `.harness/runs` and `.git/hooks` (also via symlinks or `..`)
 * and, unless `dangerMode` is set, any path escaping the workspace root.
 * Returns the resolved real path.
 */
export function assertSafeWorkspacePath(
  target: string,
  workspaceRoot: string,
  options: WorkspacePathGuardOptions = {},
): string {
  const normalizedTarget = normalizeContainerPath(target, options.containerWorkingDir)
  const realRoot = realpathNearest(path.resolve(workspaceRoot))
  const realTarget = realpathNearest(path.resolve(realRoot, normalizedTarget))
  const relative = path.relative(realRoot, realTarget)
  const escapes = relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)
  if (!escapes && isProtected(relative.split(path.sep))) {
    throw new SandboxViolationError(target, 'access to protected directory (.harness/runs, .git/hooks) is forbidden')
  }
  if (escapes && !options.dangerMode) {
    throw new SandboxViolationError(target, 'path resolves outside the workspace')
  }
  return realTarget
}
