import path from 'node:path'
import { ForbiddenMountPathError, realpathNearest } from '@luddjs/core'

export interface DockerMount {
  readonly hostPath: string
  readonly containerPath: string
  readonly readonly?: boolean
}

function isPathInsideOrEqual(parentDir: string, targetPath: string): boolean {
  const rel = path.relative(parentDir, targetPath)
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
}

function checkPathAgainstForbidden(
  hostPath: string,
  targetPath: string,
  forbiddenDir: string,
  label: string,
): void {
  if (isPathInsideOrEqual(forbiddenDir, targetPath)) {
    throw new ForbiddenMountPathError(hostPath, `Mount path resolves inside ${label}`)
  }
  if (isPathInsideOrEqual(targetPath, forbiddenDir)) {
    throw new ForbiddenMountPathError(hostPath, `Mount path is an ancestor of ${label}`)
  }
}

export function validateHostMountPath(workspaceDir: string, hostPath: string): void {
  const resolvedWorkspace = path.resolve(workspaceDir)
  const resolvedHostPath = path.resolve(resolvedWorkspace, hostPath)
  const runsDir = path.resolve(resolvedWorkspace, '.harness', 'runs')
  const hooksDir = path.resolve(resolvedWorkspace, '.git', 'hooks')

  checkPathAgainstForbidden(hostPath, resolvedHostPath, runsDir, '.harness/runs')
  checkPathAgainstForbidden(hostPath, resolvedHostPath, hooksDir, '.git/hooks')

  const realWorkspace = realpathNearest(resolvedWorkspace)
  const realRunsDir = path.resolve(realWorkspace, '.harness', 'runs')
  const realHooksDir = path.resolve(realWorkspace, '.git', 'hooks')
  const realHostPath = realpathNearest(resolvedHostPath)

  checkPathAgainstForbidden(hostPath, realHostPath, realRunsDir, '.harness/runs')
  checkPathAgainstForbidden(hostPath, realHostPath, realHooksDir, '.git/hooks')
}

export function validateAllMountPaths(
  workspaceDir: string,
  worktreePath: string,
  customMounts?: readonly DockerMount[],
): void {
  validateHostMountPath(workspaceDir, worktreePath)
  if (customMounts) {
    for (const mount of customMounts) {
      validateHostMountPath(workspaceDir, mount.hostPath)
    }
  }
}

export function buildMountFlags(
  workspaceDir: string,
  customMounts?: readonly DockerMount[],
): string[] {
  if (!customMounts || customMounts.length === 0) {
    return []
  }
  const flags: string[] = []
  for (const mount of customMounts) {
    const resolved = path.resolve(workspaceDir, mount.hostPath)
    const mode = mount.readonly ? ':ro' : ''
    flags.push('-v', `${resolved}:${mount.containerPath}${mode}`)
  }
  return flags
}
