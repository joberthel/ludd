import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createLogStore } from '../log-store.js'

describe('createLogStore missing and bad input', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'ludd-log-store-bad-'))
  })

  afterEach(async () => {
    await fs.promises.rm(tempDir, { recursive: true, force: true })
  })

  it('handles missing files and bad json gracefully', async () => {
    const store = createLogStore(tempDir)
    expect(await store.readPage('missing')).toBeNull()
    expect(await store.readLines('missing', 1, 10)).toBeNull()
    expect(await store.search('missing', 'query')).toBeNull()
    expect(await store.getMetadata('missing')).toBeNull()

    const meta = await store.offload({
      stepId: 'step-bad-json',
      attempt: 1,
      phase: 'afterStep',
      guardrailIndex: 0,
      content: 'invalid-json{',
      format: 'json',
    })
    expect(meta.totalItems).toBe(0)
    const badJsonPage = await store.readPage('step-bad-json-1')
    if (badJsonPage?.format === 'json') {
      expect(badJsonPage.totalItems).toBe(0)
      expect(badJsonPage.totalPages).toBe(0)
    }

    await store.offload({
      stepId: 'step-empty-text',
      attempt: 1,
      phase: 'afterStep',
      guardrailIndex: 0,
      content: '',
      format: 'text',
    })
    const emptyPage = await store.readPage('step-empty-text-1')
    if (emptyPage?.format === 'text') {
      expect(emptyPage.totalLines).toBe(0)
      expect(emptyPage.totalPages).toBe(0)
    }
  })
})
