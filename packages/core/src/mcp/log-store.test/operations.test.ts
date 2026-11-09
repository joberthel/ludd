import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createLogStore } from '../log-store.js'

describe('createLogStore text pages', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'ludd-log-store-text-'))
  })

  afterEach(async () => {
    await fs.promises.rm(tempDir, { recursive: true, force: true })
  })

  it('offloads text log and serves paginated pages', async () => {
    const persisted: string[] = []
    const store = createLogStore(tempDir, {
      onLogPersisted: (k) => {
        persisted.push(k)
      },
    })

    const textContent = Array.from({ length: 250 }, (_, i) => `Line ${i + 1}`).join('\n')
    const meta = await store.offload({
      stepId: 'step-a',
      attempt: 1,
      phase: 'afterStep',
      guardrailIndex: 0,
      content: textContent,
    })

    expect(meta.format).toBe('text')
    expect(meta.totalLines).toBe(250)
    expect(persisted).toEqual([
      'step-a-1-afterStep-0',
      'step-a-1',
    ])

    const page1 = await store.readPage('step-a-1', 1, 100)
    if (page1?.format === 'text') {
      expect(page1.lines).toHaveLength(100)
      expect(page1.totalPages).toBe(3)
      expect(page1.totalLines).toBe(250)
      expect(page1.lines[0]).toBe('Line 1')
    }

    const page3 = await store.readPage('step-a-1-afterStep-0.log', 3, 100)
    if (page3?.format === 'text') {
      expect(page3.lines).toHaveLength(50)
    }
  })
})

describe('createLogStore line ranges', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'ludd-log-store-lines-'))
  })

  afterEach(async () => {
    await fs.promises.rm(tempDir, { recursive: true, force: true })
  })

  it('slices bounded lines and clamps invalid bounds', async () => {
    const store = createLogStore(tempDir)
    await store.offload({
      stepId: 'step-lines',
      attempt: 1,
      phase: 'afterStep',
      guardrailIndex: 0,
      content: 'Line 1\nLine 2\nLine 3\nLine 4\nLine 5',
    })

    const slice = await store.readLines('step-lines-1', 2, 4)
    expect(slice?.lines).toEqual(['Line 2', 'Line 3', 'Line 4'])

    const clamped = await store.readLines('step-lines-1', 0, 2)
    expect(clamped?.lines).toHaveLength(2)

    const outOfOrder = await store.readLines('step-lines-1', 5, 2)
    expect(outOfOrder?.lines).toEqual([])
  })
})

describe('createLogStore search operations', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'ludd-log-store-search-'))
  })

  afterEach(async () => {
    await fs.promises.rm(tempDir, { recursive: true, force: true })
  })

  it('searches text log and handles search edge cases', async () => {
    const store = createLogStore(tempDir)
    await store.offload({
      stepId: 'step-search',
      attempt: 1,
      phase: 'afterStep',
      guardrailIndex: 0,
      content: 'Hello World\nLine 2: error found\nLine 3: ERROR critical\nLine 4: fine',
    })

    const searchRes = await store.search('step-search-1', 'error', 1)
    expect(searchRes?.totalMatches).toBe(2)
    expect(searchRes?.matches).toHaveLength(1)

    const searchDefault = await store.search('step-search-1', 'hello')
    expect(searchDefault?.totalMatches).toBe(1)

    const emptyQueryRes = await store.search('step-search-1', '')
    expect(emptyQueryRes?.totalMatches).toBe(0)

    expect(await store.has('step-search-1')).toBe(true)
    expect(await store.has('non-existent')).toBe(false)
  })
})

describe('createLogStore JSON key pagination', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'ludd-log-store-json-'))
  })

  afterEach(async () => {
    await fs.promises.rm(tempDir, { recursive: true, force: true })
  })

  it('offloads JSON log with pagination options', async () => {
    const store = createLogStore(tempDir)
    const jsonData = {
      errors: Array.from({ length: 15 }, (_, i) => ({ id: i + 1, message: `error ${i + 1}` })),
    }

    const meta = await store.offload({
      stepId: 'step-json',
      attempt: 2,
      phase: 'beforeStep',
      guardrailIndex: 1,
      content: JSON.stringify(jsonData),
      pagination: { key: 'errors' },
    })

    expect(meta.format).toBe('json')
    expect(meta.totalItems).toBe(15)

    const page1 = await store.readPage('step-json-2', 1, 10)
    if (page1?.format === 'json') {
      expect(page1.items).toHaveLength(10)
      expect(page1.totalItems).toBe(15)
      expect(page1.totalPages).toBe(2)
    }
  })
})

describe('createLogStore JSON selector pagination', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'ludd-log-store-json-sel-'))
  })

  afterEach(async () => {
    await fs.promises.rm(tempDir, { recursive: true, force: true })
  })

  it('offloads JSON log with string and function pagination', async () => {
    const store = createLogStore(tempDir)
    const strMeta = await store.offload({
      stepId: 'step-str',
      attempt: 1,
      phase: 'afterStep',
      guardrailIndex: 0,
      content: JSON.stringify({
        issues: ['i1'],
      }),
      pagination: 'issues',
    })
    expect(strMeta.propertyKey).toBe('issues')

    const fnMeta = await store.offload({
      stepId: 'step-fn',
      attempt: 1,
      phase: 'afterStep',
      guardrailIndex: 0,
      content: JSON.stringify({
        items: ['a', 'b'],
      }),
      pagination: (d: any) => d.items,
    })
    expect(fnMeta.totalItems).toBe(2)
  })
})

describe('createLogStore disk rehydration', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'ludd-log-store-rehydrate-'))
  })

  afterEach(async () => {
    await fs.promises.rm(tempDir, { recursive: true, force: true })
  })

  it('handles disk rehydration when memory cache is empty', async () => {
    const store1 = createLogStore(tempDir)
    await store1.offload({
      stepId: 'step-rehydrate',
      attempt: 1,
      phase: 'afterStep',
      guardrailIndex: 0,
      content: JSON.stringify(['item1', 'item2', 'item3']),
      format: 'json',
    })
    await store1.offload({
      stepId: 'step-rehydrate-text',
      attempt: 1,
      phase: 'afterStep',
      guardrailIndex: 0,
      content: 'line1\nline2\nline3',
      format: 'text',
    })

    const store2 = createLogStore(tempDir)
    const page = await store2.readPage('step-rehydrate-1', 1, 2)
    if (page?.format === 'json') {
      expect(page.totalItems).toBe(3)
      expect(page.items).toEqual(['item1', 'item2'])
    }

    const metaText = await store2.getMetadata('step-rehydrate-text-1')
    expect(metaText?.format).toBe('text')
    expect(metaText?.totalLines).toBe(3)

    const pageText = await store2.readPage('step-rehydrate-text-1', 1, 2)
    if (pageText?.format === 'text') {
      expect(pageText.totalLines).toBe(3)
    }
  })
})
