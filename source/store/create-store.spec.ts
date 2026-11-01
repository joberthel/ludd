import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import zod, { ZodError } from 'zod'
import { createStore } from './create-store.js'

describe('createStore', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'ludd-store-test-'))
  })

  afterEach(async () => {
    await rm(tempDir, { force: true, recursive: true })
  })

  const testSchema = zod.object({
    name: zod.string().default('default-name'),
    count: zod.number().default(0),
  }).default({})

  it('initializes file with schema defaults when file does not exist', async () => {
    const filePath = path.join(tempDir, 'nested', 'dir', 'store.json')
    const store = createStore(filePath, testSchema)

    const data = await store.read()

    expect(data).toEqual({
      name: 'default-name',
      count: 0,
    })

    const raw = await readFile(filePath, 'utf8')
    expect(JSON.parse(raw)).toEqual({
      name: 'default-name',
      count: 0,
    })
  })

  it('reads existing valid data correctly', async () => {
    const filePath = path.join(tempDir, 'store.json')
    await writeFile(filePath, JSON.stringify({ name: 'custom', count: 42 }))

    const store = createStore(filePath, testSchema)
    const data = await store.read()

    expect(data).toEqual({
      name: 'custom',
      count: 42,
    })
  })

  it('writes valid data and persists to disk', async () => {
    const filePath = path.join(tempDir, 'store.json')
    const store = createStore(filePath, testSchema)

    const written = await store.write({ name: 'updated', count: 10 })
    expect(written).toEqual({ name: 'updated', count: 10 })

    const readBack = await store.read()
    expect(readBack).toEqual({ name: 'updated', count: 10 })

    const raw = await readFile(filePath, 'utf8')
    expect(JSON.parse(raw)).toEqual({ name: 'updated', count: 10 })
  })

  it('updates data immutably with updater function', async () => {
    const filePath = path.join(tempDir, 'store.json')
    const store = createStore(filePath, testSchema)

    await store.write({ name: 'initial', count: 5 })

    const updated = await store.update(current => ({
      ...current,
      count: current.count + 1,
    }))

    expect(updated).toEqual({ name: 'initial', count: 6 })

    const readBack = await store.read()
    expect(readBack).toEqual({ name: 'initial', count: 6 })
  })

  it('throws descriptive error on corrupted JSON and leaves file untouched', async () => {
    const filePath = path.join(tempDir, 'store.json')
    const corruptedContent = '{"name": "broken", invalid'
    await writeFile(filePath, corruptedContent)

    const store = createStore(filePath, testSchema)

    await expect(store.read()).rejects.toThrow()

    const rawAfter = await readFile(filePath, 'utf8')
    expect(rawAfter).toBe(corruptedContent)
  })

  it('throws ZodError on schema violation from disk and leaves file untouched', async () => {
    const filePath = path.join(tempDir, 'store.json')
    const invalidSchemaContent = JSON.stringify({ name: 123, count: 'not-a-number' })
    await writeFile(filePath, invalidSchemaContent)

    const store = createStore(filePath, testSchema)

    await expect(store.read()).rejects.toThrow(ZodError)

    const rawAfter = await readFile(filePath, 'utf8')
    expect(rawAfter).toBe(invalidSchemaContent)
  })

  it('throws ZodError on invalid write payload without modifying disk', async () => {
    const filePath = path.join(tempDir, 'store.json')
    await writeFile(filePath, JSON.stringify({ name: 'original', count: 1 }))

    const store = createStore(filePath, testSchema)

    // @ts-expect-error Intentionally invalid payload for test
    await expect(store.write({ name: 12345, count: 'bad' })).rejects.toThrow(ZodError)

    const rawAfter = await readFile(filePath, 'utf8')
    expect(JSON.parse(rawAfter)).toEqual({ name: 'original', count: 1 })
  })
})
