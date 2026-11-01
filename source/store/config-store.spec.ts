import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ZodError } from 'zod'
import {
  ConfigSchema,
  createConfigStore,
  getDefaultConfigPath,
  parseCliValue,
  readConfigKey,
  writeConfigKey,
} from './config-store.js'

describe('configStore', () => {
  let tempDir: string
  let testConfigPath: string

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'ludd-config-test-'))
    testConfigPath = path.join(tempDir, 'config.json')
  })

  afterEach(async () => {
    await rm(tempDir, { force: true, recursive: true })
  })

  describe('configSchema', () => {
    it('provides sensible defaults for all dummy keys', () => {
      const parsed = ConfigSchema.parse({})
      expect(parsed).toEqual({
        dummyString: 'hello',
        dummyNumber: 42,
        dummyBoolean: true,
        dummyEnum: 'alpha',
        dummyObject: {
          nestedString: 'nested-hello',
          nestedBoolean: false,
        },
      })
    })

    it('rejects unknown root keys due to .strict()', () => {
      expect(() => ConfigSchema.parse({ unknownField: 'test' })).toThrow(ZodError)
    })

    it('rejects unknown nested keys inside dummyObject due to .strict()', () => {
      expect(() => ConfigSchema.parse({
        dummyObject: {
          nestedString: 'hi',
          nestedBoolean: true,
          extra: 'bad',
        },
      })).toThrow(ZodError)
    })

    it('rejects invalid enum values', () => {
      expect(() => ConfigSchema.parse({ dummyEnum: 'invalid' })).toThrow(ZodError)
    })
  })

  describe('getDefaultConfigPath', () => {
    it('returns path in ~/.ludd/config.json', () => {
      const configPath = getDefaultConfigPath()
      expect(configPath).toBe(path.join(os.homedir(), '.ludd', 'config.json'))
    })
  })

  describe('parseCliValue', () => {
    it('parses booleans and numbers from JSON literals', () => {
      expect(parseCliValue('true')).toBe(true)
      expect(parseCliValue('false')).toBe(false)
      expect(parseCliValue('42')).toBe(42)
      expect(parseCliValue('-3.14')).toBe(-3.14)
    })

    it('falls back to string for non-JSON strings', () => {
      expect(parseCliValue('alpha')).toBe('alpha')
      expect(parseCliValue('hello world')).toBe('hello world')
      expect(parseCliValue('something:else')).toBe('something:else')
    })
  })

  describe('readConfigKey', () => {
    it('returns entire config when key is omitted or empty', async () => {
      const store = createConfigStore(testConfigPath)
      const all = await readConfigKey(store)

      expect(all).toEqual({
        dummyString: 'hello',
        dummyNumber: 42,
        dummyBoolean: true,
        dummyEnum: 'alpha',
        dummyObject: {
          nestedString: 'nested-hello',
          nestedBoolean: false,
        },
      })

      const withEmpty = await readConfigKey(store, '   ')
      expect(withEmpty).toEqual(all)
    })

    it('returns subtree when key points to dummyObject', async () => {
      const store = createConfigStore(testConfigPath)
      const subtree = await readConfigKey(store, 'dummyObject')

      expect(subtree).toEqual({
        nestedString: 'nested-hello',
        nestedBoolean: false,
      })
    })

    it('returns leaf primitive values', async () => {
      const store = createConfigStore(testConfigPath)
      expect(await readConfigKey(store, 'dummyString')).toBe('hello')
      expect(await readConfigKey(store, 'dummyNumber')).toBe(42)
      expect(await readConfigKey(store, 'dummyBoolean')).toBe(true)
      expect(await readConfigKey(store, 'dummyObject.nestedString')).toBe('nested-hello')
      expect(await readConfigKey(store, 'dummyObject.nestedBoolean')).toBe(false)
    })

    it('throws when key does not exist', async () => {
      const store = createConfigStore(testConfigPath)
      await expect(readConfigKey(store, 'unknownKey')).rejects.toThrow('Configuration key "unknownKey" not found')
      await expect(readConfigKey(store, 'dummyObject.unknownNested')).rejects.toThrow(
        'Configuration key "dummyObject.unknownNested" not found',
      )
    })

    it('rejects Object.prototype properties such as toString, constructor, and __proto__', async () => {
      const store = createConfigStore(testConfigPath)
      await expect(readConfigKey(store, 'toString')).rejects.toThrow('Configuration key "toString" not found')
      await expect(readConfigKey(store, 'constructor')).rejects.toThrow('Configuration key "constructor" not found')
      await expect(readConfigKey(store, '__proto__')).rejects.toThrow('Configuration key "__proto__" not found')
      await expect(readConfigKey(store, 'dummyObject.toString')).rejects.toThrow(
        'Configuration key "dummyObject.toString" not found',
      )
    })
  })

  describe('writeConfigKey', () => {
    it('writes coerced primitive values and persists to disk', async () => {
      const store = createConfigStore(testConfigPath)

      const result = await writeConfigKey(store, 'dummyBoolean', 'false')
      expect(result).toBe(false)

      const disk = JSON.parse(await readFile(testConfigPath, 'utf8'))
      expect(disk.dummyBoolean).toBe(false)

      const readBack = await readConfigKey(store, 'dummyBoolean')
      expect(readBack).toBe(false)
    })

    it('writes dot-notated nested key and persists to disk', async () => {
      const store = createConfigStore(testConfigPath)

      const result = await writeConfigKey(store, 'dummyObject.nestedString', 'custom-nested')
      expect(result).toBe('custom-nested')

      const disk = JSON.parse(await readFile(testConfigPath, 'utf8'))
      expect(disk.dummyObject.nestedString).toBe('custom-nested')
      expect(disk.dummyObject.nestedBoolean).toBe(false)
    })

    it('coerces numbers properly', async () => {
      const store = createConfigStore(testConfigPath)

      const result = await writeConfigKey(store, 'dummyNumber', '99')
      expect(result).toBe(99)

      const disk = JSON.parse(await readFile(testConfigPath, 'utf8'))
      expect(disk.dummyNumber).toBe(99)
    })

    it('writes numeric-like and boolean-like strings to string fields', async () => {
      const store = createConfigStore(testConfigPath)

      expect(await writeConfigKey(store, 'dummyString', '123')).toBe('123')
      expect(await writeConfigKey(store, 'dummyObject.nestedString', 'true')).toBe('true')

      const disk = JSON.parse(await readFile(testConfigPath, 'utf8'))
      expect(disk.dummyString).toBe('123')
      expect(disk.dummyObject.nestedString).toBe('true')
    })

    it('rejects Object.prototype keys without modifying disk or polluting prototype', async () => {
      const store = createConfigStore(testConfigPath)
      await store.read()
      const diskBefore = await readFile(testConfigPath, 'utf8')

      await expect(writeConfigKey(store, 'toString', 'hacked')).rejects.toThrow(
        'Unknown configuration key "toString"',
      )
      await expect(writeConfigKey(store, '__proto__.polluted', 'true')).rejects.toThrow(
        'Unknown configuration key "__proto__.polluted"',
      )
      await expect(writeConfigKey(store, 'constructor.prototype.polluted', 'true')).rejects.toThrow(
        'Unknown configuration key "constructor.prototype.polluted"',
      )

      expect(({} as Record<string, unknown>).polluted).toBeUndefined()
      const diskAfter = await readFile(testConfigPath, 'utf8')
      expect(diskAfter).toBe(diskBefore)
    })

    it('throws error and does not persist on unknown key', async () => {
      const store = createConfigStore(testConfigPath)
      await store.read() // ensure initialized

      const diskBefore = await readFile(testConfigPath, 'utf8')

      await expect(writeConfigKey(store, 'unknownKey', 'val')).rejects.toThrow(
        'Unknown configuration key "unknownKey"',
      )

      const diskAfter = await readFile(testConfigPath, 'utf8')
      expect(diskAfter).toBe(diskBefore)
    })

    it('throws error and does not persist on unknown nested key', async () => {
      const store = createConfigStore(testConfigPath)
      await store.read()

      const diskBefore = await readFile(testConfigPath, 'utf8')

      await expect(writeConfigKey(store, 'dummyObject.unknownNested', 'val')).rejects.toThrow(
        'Unknown configuration key "dummyObject.unknownNested"',
      )

      const diskAfter = await readFile(testConfigPath, 'utf8')
      expect(diskAfter).toBe(diskBefore)
    })

    it('throws ZodError on type mismatch and leaves disk untouched', async () => {
      const store = createConfigStore(testConfigPath)
      await store.read()

      const diskBefore = await readFile(testConfigPath, 'utf8')

      await expect(writeConfigKey(store, 'dummyNumber', 'not-a-number')).rejects.toThrow(ZodError)
      await expect(writeConfigKey(store, 'dummyEnum', 'invalid-enum')).rejects.toThrow(ZodError)

      const diskAfter = await readFile(testConfigPath, 'utf8')
      expect(diskAfter).toBe(diskBefore)
    })
  })
})
