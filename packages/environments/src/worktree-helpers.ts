import fs from 'node:fs'
import path from 'node:path'
import { execHostEnvCommand } from './host-env.js'

export async function addGitWorktree(
  workspaceDir: string,
  worktreePath: string,
  branchName: string,
  baseBranch?: string,
  signal?: AbortSignal,
): Promise<void> {
  fs.mkdirSync(path.dirname(worktreePath), { recursive: true })
  const result = await execHostEnvCommand(
    workspaceDir,
    [
      'git',
      'worktree',
      'add',
      '-b',
      branchName,
      worktreePath,
      baseBranch ?? 'HEAD',
    ],
    { signal },
  )
  if (result.exitCode !== 0) {
    const errorDetails = result.stderr.trim() || result.stdout.trim() || `exit code ${result.exitCode}`
    throw new Error(`Failed to create git worktree: ${errorDetails}`)
  }
}

export async function removeGitWorktree(
  workspaceDir: string,
  worktreePath: string,
  signal?: AbortSignal,
): Promise<void> {
  try {
    await execHostEnvCommand(
      workspaceDir,
      [
        'git',
        'worktree',
        'remove',
        '--force',
        worktreePath,
      ],
      { signal },
    )
  }
  catch {
    // Ignore errors if worktree is already detached or removed
  }
  if (fs.existsSync(worktreePath)) {
    fs.rmSync(worktreePath, { recursive: true, force: true })
  }
}
