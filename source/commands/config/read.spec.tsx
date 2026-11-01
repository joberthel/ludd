import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import chalk from 'chalk'
import { render } from 'ink-testing-library'
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createConfigStore } from '../../store/config-store.js'
import ConfigRead from './read.js'

describe('config read command', () => {
  let tempDir: string
  let testStore: ReturnType<typeof createConfigStore>

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'ludd-read-cmd-test-'))
    const testConfigPath = path.join(tempDir, 'config.json')
    testStore = createConfigStore(testConfigPath)
  })

  afterEach(async () => {
    await rm(tempDir, { force: true, recursive: true })
  })

  it('renders [OK] and the full config JSON when no key is provided', async () => {
    const { lastFrame } = render(<ConfigRead args={[undefined]} store={testStore} />)

    await vi.waitFor(() => {
      const frame = lastFrame() ?? ''
      expect(frame).toContain(chalk.green('[OK]'))
      expect(frame).toContain('"dummyString": "hello"')
      expect(frame).toContain('"dummyNumber": 42')
      expect(frame).toContain('"dummyBoolean": true')
      expect(frame).toContain('"nestedString": "nested-hello"')
    })
  })

  it('renders [OK] and dummyObject subtree JSON when dummyObject is provided', async () => {
    const { lastFrame } = render(<ConfigRead args={['dummyObject']} store={testStore} />)

    await vi.waitFor(() => {
      const frame = lastFrame() ?? ''
      expect(frame).toContain(chalk.green('[OK]'))
      expect(frame).toContain('"nestedString": "nested-hello"')
      expect(frame).toContain('"nestedBoolean": false')
      expect(frame).not.toContain('"dummyString"')
    })
  })

  it('renders [OK] and leaf value when nested primitive key is provided', async () => {
    const { lastFrame } = render(<ConfigRead args={['dummyObject.nestedString']} store={testStore} />)

    await vi.waitFor(() => {
      const frame = lastFrame() ?? ''
      expect(frame).toBe(`${chalk.green('[OK]')} nested-hello`)
    })
  })

  it('renders [ERROR] with descriptive message and no stack trace for unknown key', async () => {
    const { lastFrame } = render(<ConfigRead args={['unknown.key']} store={testStore} />)

    await vi.waitFor(() => {
      const frame = lastFrame() ?? ''
      expect(frame).toContain(chalk.red('[ERROR]'))
      expect(frame).toContain('Configuration key "unknown.key" not found')
      expect(frame).not.toContain('at ')
      expect(frame).not.toContain('Error:')
    })
  })
})
