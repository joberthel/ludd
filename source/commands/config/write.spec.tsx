import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import chalk from 'chalk'
import { render } from 'ink-testing-library'
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createConfigStore, readConfigKey } from '../../store/config-store.js'
import ConfigWrite from './write.js'

describe('config write command', () => {
  let tempDir: string
  let testConfigPath: string
  let testStore: ReturnType<typeof createConfigStore>

  beforeEach(async () => {
    process.exitCode = 0
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'ludd-write-cmd-test-'))
    testConfigPath = path.join(tempDir, 'config.json')
    testStore = createConfigStore(testConfigPath)
  })

  afterEach(async () => {
    process.exitCode = 0
    await rm(tempDir, { force: true, recursive: true })
  })

  it('writes coerced boolean value and renders [OK]', async () => {
    const { lastFrame } = render(<ConfigWrite args={['dummyBoolean', 'false']} store={testStore} />)

    await vi.waitFor(() => {
      const frame = lastFrame() ?? ''
      expect(frame).toBe(`${chalk.green('[OK]')} dummyBoolean = false`)
    })

    const readBack = await readConfigKey(testStore, 'dummyBoolean')
    expect(readBack).toBe(false)
  })

  it('writes dot-notated nested string and renders [OK]', async () => {
    const { lastFrame } = render(<ConfigWrite args={['dummyObject.nestedString', 'world']} store={testStore} />)

    await vi.waitFor(() => {
      const frame = lastFrame() ?? ''
      expect(frame).toBe(`${chalk.green('[OK]')} dummyObject.nestedString = world`)
    })

    const readBack = await readConfigKey(testStore, 'dummyObject.nestedString')
    expect(readBack).toBe('world')
  })

  it('renders [ERROR] on invalid type and does not modify disk', async () => {
    await testStore.read() // ensure initialized
    const diskBefore = await readFile(testConfigPath, 'utf8')

    const { lastFrame } = render(<ConfigWrite args={['dummyNumber', 'not-a-number']} store={testStore} />)

    await vi.waitFor(() => {
      const frame = lastFrame() ?? ''
      expect(frame).toContain(chalk.red('[ERROR]'))
      expect(frame).toContain('dummyNumber: Expected number, received string')
      expect(frame).not.toContain('at ')
      expect(process.exitCode).toBe(1)
    })

    const diskAfter = await readFile(testConfigPath, 'utf8')
    expect(diskAfter).toBe(diskBefore)
  })

  it('renders [ERROR] on unknown key and does not modify disk', async () => {
    await testStore.read() // ensure initialized
    const diskBefore = await readFile(testConfigPath, 'utf8')

    const { lastFrame } = render(<ConfigWrite args={['unknownKey', '123']} store={testStore} />)

    await vi.waitFor(() => {
      const frame = lastFrame() ?? ''
      expect(frame).toContain(chalk.red('[ERROR]'))
      expect(frame).toContain('Unknown configuration key "unknownKey"')
      expect(frame).not.toContain('at ')
      expect(process.exitCode).toBe(1)
    })

    const diskAfter = await readFile(testConfigPath, 'utf8')
    expect(diskAfter).toBe(diskBefore)
  })
})
