import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { realpathNearest } from './realpath-nearest.js'

describe('realpathNearest', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('resolves an existing path via fs.realpathSync', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'realpath-nearest-'))
    try {
      const expected = fs.realpathSync(tmpDir)
      expect(realpathNearest(tmpDir)).toBe(expected)
    }
    finally {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  it('resolves the nearest existing ancestor and re-appends nonexistent tail segments', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'realpath-nearest-'))
    try {
      const expectedBase = fs.realpathSync(tmpDir)
      const target = path.join(tmpDir, 'missing', 'nested', 'file.txt')
      expect(realpathNearest(target)).toBe(path.join(expectedBase, 'missing', 'nested', 'file.txt'))
    }
    finally {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  it('returns target without looping when fs.realpathSync fails all the way to root', () => {
    const spy = vi.spyOn(fs, 'realpathSync').mockImplementation(() => {
      throw new Error('EACCES: permission denied')
    })

    const target = '/nonexistent/a/b'
    expect(realpathNearest(target)).toBe(target)
    expect(spy).toHaveBeenCalledTimes(4)
  })
})
