import type { Store } from './create-store.js'
import os from 'node:os'
import path from 'node:path'
import zod from 'zod'
import { createStore } from './create-store.js'

export const RefineEffortSchema = zod.enum([
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
])

export type RefineEffort = zod.infer<typeof RefineEffortSchema>

export const RefineConfigSchema = zod.object({
  model: zod.string().trim().min(1).default('Gemini 4 Argon'),
  effort: RefineEffortSchema.default('medium'),
}).strict().prefault({})

export const ConfigSchema = zod.object({
  dummyString: zod.string().default('hello'),
  dummyNumber: zod.number().int().default(42),
  dummyBoolean: zod.boolean().default(true),
  dummyEnum: zod.enum(['alpha', 'beta', 'gamma']).default('alpha'),
  dummyObject: zod.object({
    nestedString: zod.string().default('nested-hello'),
    nestedBoolean: zod.boolean().default(false),
  }).strict().prefault({}),
  refine: RefineConfigSchema,
}).strict().prefault({})

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

function getNestedValue(
  config: unknown,
  segments: string[],
  fullKey: string,
): unknown {
  let current: unknown = config

  for (const segment of segments) {
    if (current !== null && typeof current === 'object' && Object.hasOwn(current, segment)) {
      current = (current as Record<string, unknown>)[segment]
    }
    else {
      throw new Error(`Configuration key "${fullKey}" not found`)
    }
  }

  return current
}

export async function readConfigKey(
  store: Store<typeof ConfigSchema>,
  key?: string,
): Promise<unknown> {
  const config = await store.read()
  if (key === undefined || key.trim() === '') {
    return config
  }

  const trimmedKey = key.trim()
  const segments = trimmedKey.split('.')
  return getNestedValue(config, segments, key)
}

function updateNestedKey(
  obj: Record<string, unknown>,
  segments: string[],
  value: unknown,
  fullKey: string,
): Record<string, unknown> {
  const [head, ...rest] = segments
  if (head === undefined || head === '' || !Object.hasOwn(obj, head)) {
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
  const parsedValue = parseCliValue(rawValue)

  const validated = await store.update((current) => {
    const currentRecord = current as unknown as Record<string, unknown>
    const candidate = updateNestedKey(
      currentRecord,
      segments,
      parsedValue,
      trimmedKey,
    )

    if (typeof parsedValue !== 'string') {
      const check = ConfigSchema.safeParse(candidate)
      if (!check.success && check.error.issues.some(issue => issue.code === 'invalid_type' && issue.expected === 'string')) {
        return updateNestedKey(
          currentRecord,
          segments,
          rawValue,
          trimmedKey,
        )
      }
    }

    return candidate
  })

  return getNestedValue(validated, segments, trimmedKey)
}
