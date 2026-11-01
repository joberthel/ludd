import type { Store } from './create-store.js'
import os from 'node:os'
import path from 'node:path'
import zod from 'zod'
import { createStore } from './create-store.js'

export const ConfigSchema = zod.object({
  dummyString: zod.string().default('hello'),
  dummyNumber: zod.number().int().default(42),
  dummyBoolean: zod.boolean().default(true),
  dummyEnum: zod.enum(['alpha', 'beta', 'gamma']).default('alpha'),
  dummyObject: zod.object({
    nestedString: zod.string().default('nested-hello'),
    nestedBoolean: zod.boolean().default(false),
  }).strict().default({}),
}).strict().default({})

export type Config = zod.infer<typeof ConfigSchema>

export function getDefaultConfigPath(): string {
  return path.join(os.homedir(), '.ludd', 'config.json')
}

export function createConfigStore(filePath = getDefaultConfigPath()): Store<typeof ConfigSchema> {
  return createStore(filePath, ConfigSchema)
}

export const configStore: Store<typeof ConfigSchema> = createConfigStore()

export function parseCliValue(raw: string): unknown {
  try {
    return JSON.parse(raw)
  }
  catch {
    return raw
  }
}

export async function readConfigKey(
  store: Store<typeof ConfigSchema>,
  key?: string,
): Promise<unknown> {
  const config = await store.read()
  if (!key || !key.trim()) {
    return config
  }

  const segments = key.trim().split('.')
  let current: unknown = config

  for (const segment of segments) {
    if (current !== null && typeof current === 'object' && segment in (current as Record<string, unknown>)) {
      current = (current as Record<string, unknown>)[segment]
    }
    else {
      throw new Error(`Configuration key "${key}" not found`)
    }
  }

  return current
}

function updateNestedKey(
  obj: Record<string, unknown>,
  segments: string[],
  value: unknown,
  fullKey: string,
): Record<string, unknown> {
  const [head, ...rest] = segments
  if (!head || !(head in obj)) {
    throw new Error(`Unknown configuration key "${fullKey}"`)
  }

  if (rest.length === 0) {
    return {
      ...obj,
      [head]: value,
    }
  }

  const child = obj[head]
  if (child === null || typeof child !== 'object' || Array.isArray(child)) {
    throw new Error(`Configuration key "${fullKey}" is invalid: "${head}" is not an object`)
  }

  return {
    ...obj,
    [head]: updateNestedKey(child as Record<string, unknown>, rest, value, fullKey),
  }
}

export async function writeConfigKey(
  store: Store<typeof ConfigSchema>,
  key: string,
  rawValue: string,
): Promise<unknown> {
  if (!key || !key.trim()) {
    throw new Error('Configuration key cannot be empty')
  }

  const trimmedKey = key.trim()
  const segments = trimmedKey.split('.')
  const current = await store.read()
  const parsedValue = parseCliValue(rawValue)

  const updated = updateNestedKey(
    current as unknown as Record<string, unknown>,
    segments,
    parsedValue,
    trimmedKey,
  )

  const validated = ConfigSchema.parse(updated)
  await store.write(validated)
  return readConfigKey(store, trimmedKey)
}
