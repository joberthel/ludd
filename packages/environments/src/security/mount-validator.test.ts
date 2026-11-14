import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { ForbiddenMountPathError } from '@ludd/core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildMountFlags,
  validateAllMountPaths,
  validateHostMountPath,
} from './mount-validator.js'

let tmpDir: string

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mount-val-test-'))
})

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

describe('mount-validator path validation', () => {
  it('allows mounting valid workspace paths and outside paths', () => {
    const validSubdir = path.join(tmpDir, 'valid-dir')
    fs.mkdirSync(validSubdir)
    expect(() => validateHostMountPath(tmpDir, validSubdir)).not.toThrow()
    expect(() => validateHostMountPath(tmpDir, 'valid-dir')).not.toThrow()
    expect(() => validateHostMountPath(tmpDir, path.join(tmpDir, '.harness', 'worktrees', 'run-1'))).not.toThrow()
  })

  it('throws ForbiddenMountPathError when mounting .harness/runs directly or subpath', () => {
    const runsDir = path.join(tmpDir, '.harness', 'runs')
    fs.mkdirSync(runsDir, { recursive: true })
    const runSubdir = path.join(runsDir, 'run-123')
    fs.mkdirSync(runSubdir)

    expect(() => validateHostMountPath(tmpDir, runsDir)).toThrow(ForbiddenMountPathError)
    expect(() => validateHostMountPath(tmpDir, '.harness/runs')).toThrow(ForbiddenMountPathError)
    expect(() => validateHostMountPath(tmpDir, runSubdir)).toThrow(ForbiddenMountPathError)
    expect(() => validateHostMountPath(tmpDir, '.harness/runs/run-123')).toThrow(ForbiddenMountPathError)
  })

  it('throws ForbiddenMountPathError when mounting .git/hooks directly or subpath', () => {
    const hooksDir = path.join(tmpDir, '.git', 'hooks')
    fs.mkdirSync(hooksDir, { recursive: true })
    const preCommit = path.join(hooksDir, 'pre-commit')
    fs.writeFileSync(preCommit, '#!/bin/sh\nexit 0')

    expect(() => validateHostMountPath(tmpDir, hooksDir)).toThrow(ForbiddenMountPathError)
    expect(() => validateHostMountPath(tmpDir, '.git/hooks')).toThrow(ForbiddenMountPathError)
    expect(() => validateHostMountPath(tmpDir, preCommit)).toThrow(ForbiddenMountPathError)
    expect(() => validateHostMountPath(tmpDir, '.git/hooks/pre-commit')).toThrow(ForbiddenMountPathError)
  })

  it('detects forbidden mount paths through symlinks', () => {
    const runsDir = path.join(tmpDir, '.harness', 'runs')
    fs.mkdirSync(runsDir, { recursive: true })
    const symlinkToRuns = path.join(tmpDir, 'symlink-runs')
    fs.symlinkSync(runsDir, symlinkToRuns)

    expect(() => validateHostMountPath(tmpDir, symlinkToRuns)).toThrow(ForbiddenMountPathError)
  })

  it('throws ForbiddenMountPathError when mounting an ancestor of forbidden paths', () => {
    expect(() => validateHostMountPath(tmpDir, '.')).toThrow(ForbiddenMountPathError)
    expect(() => validateHostMountPath(tmpDir, tmpDir)).toThrow(ForbiddenMountPathError)
    expect(() => validateHostMountPath(tmpDir, '.harness')).toThrow(ForbiddenMountPathError)
    expect(() => validateHostMountPath(tmpDir, '.git')).toThrow(ForbiddenMountPathError)

    const harnessDir = path.join(tmpDir, '.harness')
    fs.mkdirSync(harnessDir, { recursive: true })
    const symlinkToHarness = path.join(tmpDir, 'symlink-harness')
    fs.symlinkSync(harnessDir, symlinkToHarness)
    expect(() => validateHostMountPath(tmpDir, symlinkToHarness)).toThrow(ForbiddenMountPathError)
  })

  it('detects forbidden mount paths through symlinks when leaf path does not exist yet', () => {
    const runsDir = path.join(tmpDir, '.harness', 'runs')
    fs.mkdirSync(runsDir, { recursive: true })
    const symlinkToRuns = path.join(tmpDir, 'symlink-runs')
    fs.symlinkSync(runsDir, symlinkToRuns)

    expect(() => validateHostMountPath(tmpDir, path.join(symlinkToRuns, 'nonexistent-run'))).toThrow(
      ForbiddenMountPathError,
    )
    expect(() => validateHostMountPath(tmpDir, 'symlink-runs/nested/nonexistent')).toThrow(
      ForbiddenMountPathError,
    )
  })

  it('falls back to target path when realpathSync fails up to filesystem root', () => {
    const spy = vi.spyOn(fs, 'realpathSync').mockImplementation(() => {
      throw new Error('ENOENT')
    })
    try {
      const validSubdir = path.join(tmpDir, 'valid-dir')
      expect(() => validateHostMountPath(tmpDir, validSubdir)).not.toThrow()
    }
    finally {
      spy.mockRestore()
    }
  })
})

describe('mount-validator aggregate mounts and flag builder', () => {
  it('validateAllMountPaths checks worktreePath and all custom mounts', () => {
    const worktreePath = path.join(tmpDir, '.harness', 'worktrees', 'wt-1')
    expect(() => validateAllMountPaths(tmpDir, worktreePath)).not.toThrow()

    expect(() => validateAllMountPaths(tmpDir, worktreePath, [
      { hostPath: '.harness/runs/escape', containerPath: '/data' },
    ])).toThrow(ForbiddenMountPathError)

    const worktreeInRuns = path.join(tmpDir, '.harness', 'runs', 'bad-wt')
    expect(() => validateAllMountPaths(tmpDir, worktreeInRuns)).toThrow(ForbiddenMountPathError)
  })

  it('buildMountFlags produces formatted docker -v flags', () => {
    expect(buildMountFlags(tmpDir)).toEqual([])
    expect(buildMountFlags(tmpDir, [])).toEqual([])

    const customMounts = [
      { hostPath: 'cache', containerPath: '/root/.cache' },
      { hostPath: 'config', containerPath: '/etc/app/config', readonly: true },
    ]
    const flags = buildMountFlags(tmpDir, customMounts)
    expect(flags).toEqual([
      '-v',
      `${path.resolve(tmpDir, 'cache')}:/root/.cache`,
      '-v',
      `${path.resolve(tmpDir, 'config')}:/etc/app/config:ro`,
    ])
  })
})
