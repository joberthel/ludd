import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createArtifactStore, sanitizeArtifactPath } from './artifact-store.js'

describe('artifact-store path validation', () => {
  const dummyRunDir = '/tmp/dummy-run'

  it('rejects non-string or whitespace-only keys', () => {
    expect(() => sanitizeArtifactPath(dummyRunDir, null as unknown as string)).toThrow(
      'Artifact key must be a non-empty string.',
    )
    expect(() => sanitizeArtifactPath(dummyRunDir, '')).toThrow(
      'Artifact key must be a non-empty string.',
    )
    expect(() => sanitizeArtifactPath(dummyRunDir, '   \t\n  ')).toThrow(
      'Artifact key must be a non-empty string.',
    )
  })

  it('rejects null bytes', () => {
    expect(() => sanitizeArtifactPath(dummyRunDir, 'doc\0.md')).toThrow(
      'Artifact key cannot contain null bytes.',
    )
  })

  it('rejects leading slashes', () => {
    expect(() => sanitizeArtifactPath(dummyRunDir, '/root.md')).toThrow(
      'Artifact key cannot start with a slash.',
    )
  })

  it('rejects backslashes', () => {
    expect(() => sanitizeArtifactPath(dummyRunDir, 'sub\\doc.md')).toThrow(
      'Artifact key cannot contain backslashes.',
    )
  })
})

describe('artifact-store segment validation and resolution', () => {
  const dummyRunDir = '/tmp/dummy-run'

  it('rejects relative path segments and empty segments', () => {
    expect(() => sanitizeArtifactPath(dummyRunDir, '.')).toThrow(
      'Artifact key contains invalid path segment: "."',
    )
    expect(() => sanitizeArtifactPath(dummyRunDir, '..')).toThrow(
      'Artifact key contains invalid path segment: ".."',
    )
    expect(() => sanitizeArtifactPath(dummyRunDir, 'sub/./doc.md')).toThrow(
      'Artifact key contains invalid path segment: "."',
    )
    expect(() => sanitizeArtifactPath(dummyRunDir, 'sub/../doc.md')).toThrow(
      'Artifact key contains invalid path segment: ".."',
    )
    expect(() => sanitizeArtifactPath(dummyRunDir, 'sub//doc.md')).toThrow(
      'Artifact key contains invalid path segment: ""',
    )
    expect(() => sanitizeArtifactPath(dummyRunDir, 'sub/doc.md/')).toThrow(
      'Artifact key contains invalid path segment: ""',
    )
  })

  it('resolves valid keys inside <runDir>/artifacts', () => {
    const resolved = sanitizeArtifactPath(dummyRunDir, 'notes/summary.txt')
    expect(resolved).toBe(path.resolve(dummyRunDir, 'artifacts', 'notes/summary.txt'))
  })

  it('rejects resolved paths that escape artifacts directory', () => {
    const mockRelative = vi.spyOn(path, 'relative').mockReturnValueOnce('../outside')
    expect(() => sanitizeArtifactPath(dummyRunDir, 'escaped.txt')).toThrow(
      'Artifact path escapes artifacts directory: "escaped.txt".',
    )
    mockRelative.mockRestore()
  })
})

describe('artifact-store put and get operations', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'ludd-artifact-test-'))
  })

  afterEach(async () => {
    await fs.promises.rm(tempDir, { recursive: true, force: true })
  })

  it('puts and gets artifact content atomically with directory creation', async () => {
    const store = createArtifactStore(tempDir)
    await store.put('deeply/nested/output.txt', 'artifact content')

    expect(await store.has('deeply/nested/output.txt')).toBe(true)
    const content = await store.get('deeply/nested/output.txt')
    expect(content).toBe('artifact content')
  })

  it('rejects non-string content on put', async () => {
    const store = createArtifactStore(tempDir)
    await expect(store.put('test.txt', 123 as unknown as string)).rejects.toThrow(
      TypeError,
    )
  })

  it('returns null on get and false on has when artifact does not exist', async () => {
    const store = createArtifactStore(tempDir)
    expect(await store.get('missing.txt')).toBeNull()
    expect(await store.has('missing.txt')).toBe(false)
  })

  it('returns null on get and false on has when target path is a directory', async () => {
    const store = createArtifactStore(tempDir)
    const dirPath = path.join(tempDir, 'artifacts', 'some-dir')
    await fs.promises.mkdir(dirPath, { recursive: true })

    expect(await store.get('some-dir')).toBeNull()
    expect(await store.has('some-dir')).toBe(false)
  })

  it('overwrites existing artifact atomically on subsequent put', async () => {
    const store = createArtifactStore(tempDir)
    await store.put('state.txt', 'version-1')
    expect(await store.get('state.txt')).toBe('version-1')

    await store.put('state.txt', 'version-2')
    expect(await store.get('state.txt')).toBe('version-2')
  })
})

describe('artifact-store JSON parsing', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'ludd-artifact-test-'))
  })

  afterEach(async () => {
    await fs.promises.rm(tempDir, { recursive: true, force: true })
  })

  it('reads and parses JSON artifacts with getJson', async () => {
    const store = createArtifactStore(tempDir)
    await store.put('data.json', JSON.stringify({ count: 42, active: true }))

    const parsed = await store.getJson<{ count: number, active: boolean }>('data.json')
    expect(parsed).toEqual({ count: 42, active: true })
  })

  it('returns null with getJson when artifact does not exist', async () => {
    const store = createArtifactStore(tempDir)
    const result = await store.getJson('not-found.json')
    expect(result).toBeNull()
  })

  it('throws SyntaxError with getJson when content is invalid JSON', async () => {
    const store = createArtifactStore(tempDir)
    await store.put('invalid.json', 'not-valid-json{')
    await expect(store.getJson('invalid.json')).rejects.toThrow(SyntaxError)
  })
})

describe('artifact-store error handling and list callback', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'ludd-artifact-test-'))
  })

  afterEach(async () => {
    await fs.promises.rm(tempDir, { recursive: true, force: true })
  })

  it('propagates unexpected filesystem errors on get and has', async () => {
    const store = createArtifactStore(tempDir)
    const mockStat = vi.spyOn(fs.promises, 'stat').mockRejectedValueOnce(new Error('EACCES: permission denied'))
    await expect(store.get('error.txt')).rejects.toThrow('EACCES: permission denied')
    mockStat.mockRestore()

    const mockStat2 = vi.spyOn(fs.promises, 'stat').mockRejectedValueOnce(new Error('EACCES: permission denied'))
    await expect(store.has('error.txt')).rejects.toThrow('EACCES: permission denied')
    mockStat2.mockRestore()
  })

  it('lists stored artifact keys and invokes onArtifactPut callback', async () => {
    const putKeys: string[] = []
    const store = createArtifactStore(tempDir, {
      onArtifactPut: (key) => {
        putKeys.push(key)
      },
    })

    expect(await store.list?.()).toEqual([])

    await store.put('todos.json', '[]')
    await store.put('nested/spec.md', '# Spec')

    expect(putKeys).toEqual(['todos.json', 'nested/spec.md'])
    const listed = await store.list?.()
    expect(listed).toEqual(['nested/spec.md', 'todos.json'])
  })

  it('propagates readdir error in list when not ENOENT', async () => {
    const store = createArtifactStore(tempDir)
    const mockReaddir = vi.spyOn(fs.promises, 'readdir').mockRejectedValueOnce(new Error('EACCES'))
    await expect(store.list?.()).rejects.toThrow('EACCES')
    mockReaddir.mockRestore()
  })
})
