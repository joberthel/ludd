import cp from 'node:child_process'

export function setupGitRepo(cwd: string): void {
  cp.execSync('git init', { cwd })
  cp.execSync('git config user.name "Ludd Test"', { cwd })
  cp.execSync('git config user.email "test@ludd.dev"', { cwd })
  cp.execSync('git commit --allow-empty -m "initial commit"', { cwd })
}
