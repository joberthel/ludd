import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { SandboxViolationError } from '@ludd/core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { assertSafeWorkspacePath } from './workspace-path-guard.js'

describe('assertSafeWorkspacePath', () => {
  let root: string
  let outside: string

  beforeEach(() => {
    const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'guard-')))
    root = path.join(tmp, 'ws')
    outside = path.join(tmp, 'outside')
    fs.mkdirSync(path.join(root, '.harness/runs/r1'), { recursive: true })
    fs.mkdirSync(path.join(root, '.git/hooks'), { recursive: true })
    fs.mkdirSync(path.join(root, 'src'))
    fs.mkdirSync(outside)
    fs.writeFileSync(path.join(root, '.harness/runs/r1/state.json'), '{}')
    fs.writeFileSync(path.join(root, 'src/a.ts'), '')
  })

  afterEach(() => {
    fs.rmSync(path.dirname(root), { recursive: true, force: true })
  })

  it('allows regular files and returns the real path', () => {
    expect(assertSafeWorkspacePath('src/a.ts', root)).toBe(path.join(root, 'src/a.ts'))
  })

  it('blocks .harness/runs and .git/hooks', () => {
    expect(() => assertSafeWorkspacePath('.harness/runs/r1/state.json', root)).toThrow(SandboxViolationError)
    expect(() => assertSafeWorkspacePath('.git/hooks/pre-commit', root)).toThrow(SandboxViolationError)
  })

  it('blocks protected paths reached via a symlink', () => {
    fs.symlinkSync(path.join(root, '.harness/runs'), path.join(root, 'src/link'))
    expect(() => assertSafeWorkspacePath('src/link/r1/state.json', root)).toThrow(/protected/)
  })

  it('blocks .. traversal into protected dirs and out of the workspace', () => {
    expect(() => assertSafeWorkspacePath('src/../.harness/runs/r1/state.json', root)).toThrow(/protected/)
    expect(() => assertSafeWorkspacePath('../outside/x', root)).toThrow(/outside the workspace/)
    expect(() => assertSafeWorkspacePath('..', root)).toThrow(SandboxViolationError)
  })

  it('blocks symlinks escaping the workspace', () => {
    fs.symlinkSync(outside, path.join(root, 'src/esc'))
    expect(() => assertSafeWorkspacePath('src/esc/file', root)).toThrow(/outside the workspace/)
  })

  it('resolves nonexistent targets via the nearest existing parent', () => {
    expect(assertSafeWorkspacePath('src/new/deep/file.ts', root)).toBe(path.join(root, 'src/new/deep/file.ts'))
    expect(() => assertSafeWorkspacePath('.harness/runs/new/state.json', root)).toThrow(/protected/)
    expect(() => assertSafeWorkspacePath(path.join(outside, 'nope/x'), root)).toThrow(/outside/)
  })

  it('treats a nonexistent workspace root via its nearest parent', () => {
    expect(assertSafeWorkspacePath('a.ts', path.join(root, 'missing'))).toBe(path.join(root, 'missing/a.ts'))
  })

  it('allows escaping the workspace in dangerMode but still protects harness dirs', () => {
    expect(assertSafeWorkspacePath(path.join(outside, 'x'), root, { dangerMode: true })).toBe(path.join(outside, 'x'))
    expect(() => assertSafeWorkspacePath('.harness/runs/r1/state.json', root, { dangerMode: true })).toThrow(/protected/)
  })

  it('normalizes containerWorkingDir-prefixed paths back to workspaceRoot', () => {
    expect(assertSafeWorkspacePath('/workspace/src/a.ts', root, { containerWorkingDir: '/workspace' }))
      .toBe(path.join(root, 'src/a.ts'))
    expect(assertSafeWorkspacePath('/workspace', root, { containerWorkingDir: '/workspace' }))
      .toBe(root)
    expect(assertSafeWorkspacePath('src/a.ts', root, { containerWorkingDir: '/workspace' }))
      .toBe(path.join(root, 'src/a.ts'))
    expect(() => assertSafeWorkspacePath('/workspace/.harness/runs/r1/state.json', root, { containerWorkingDir: '/workspace' }))
      .toThrow(/protected/)
  })
})
