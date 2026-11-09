import type { ArtifactClient } from '../types/artifact.js'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { StepArtifactValidationError } from '../errors/step-artifact-validation-error.js'
import { formatArtifactRetryPrompt, validateStepArtifacts } from './artifact-validator.js'

function createMockArtifactClient(store: Record<string, string | null> = {}): ArtifactClient {
  return {
    put: async (key: string, content: string) => {
      store[key] = content
    },
    get: async (key: string) => store[key] ?? null,
    getJson: async <T>(key: string) => {
      const val = store[key]
      if (val === null || val === undefined) {
        return null
      }
      return JSON.parse(val) as T
    },
    has: async (key: string) => key in store && store[key] !== null,
  }
}

describe('validateStepArtifacts undefined or empty config', () => {
  it('returns immediately when artifactsConfig is undefined', async () => {
    const client = createMockArtifactClient()
    await expect(validateStepArtifacts('step-1', undefined, client)).resolves.toBeUndefined()
  })

  it('passes when artifactsConfig is empty object', async () => {
    const client = createMockArtifactClient()
    await expect(validateStepArtifacts('step-1', {}, client)).resolves.toBeUndefined()
  })
})

describe('validateStepArtifacts existence and nonEmpty checks', () => {
  it('throws StepArtifactValidationError when artifact is missing', async () => {
    const client = createMockArtifactClient()
    await expect(
      validateStepArtifacts('step-1', { 'spec.md': {} }, client),
    ).rejects.toThrow(StepArtifactValidationError)

    try {
      await validateStepArtifacts('step-1', { 'spec.md': {} }, client)
    }
    catch (err: unknown) {
      const error = err as StepArtifactValidationError
      expect(error.issues).toHaveLength(1)
      expect(error.issues[0]).toEqual({
        artifactKey: 'spec.md',
        message: 'Artifact "spec.md" was not created.',
      })
    }
  })

  it('throws when nonEmpty is true and artifact content is whitespace or empty', async () => {
    const client = createMockArtifactClient({ 'spec.md': '   \n  ' })
    await expect(
      validateStepArtifacts('step-1', {
        'spec.md': { nonEmpty: true },
      }, client),
    ).rejects.toThrow(StepArtifactValidationError)

    try {
      await validateStepArtifacts('step-1', {
        'spec.md': { nonEmpty: true },
      }, client)
    }
    catch (err: unknown) {
      const error = err as StepArtifactValidationError
      expect(error.issues[0].message).toBe('Artifact "spec.md" must be non-empty.')
    }
  })

  it('passes when nonEmpty is false and content is empty', async () => {
    const client = createMockArtifactClient({ 'empty.txt': '' })
    await expect(
      validateStepArtifacts('step-1', {
        'empty.txt': { nonEmpty: false },
      }, client),
    ).resolves.toBeUndefined()
  })
})

describe('validateStepArtifacts JSON parsing checks', () => {
  const schema = z.object({
    title: z.string().min(3),
    count: z.number(),
  })

  it('throws when artifact content is not valid JSON', async () => {
    const client = createMockArtifactClient({ 'data.json': 'not-valid-json' })
    try {
      await validateStepArtifacts('step-1', {
        'data.json': { schema },
      }, client)
      expect.unreachable('Should have thrown')
    }
    catch (err: unknown) {
      const error = err as StepArtifactValidationError
      expect(error.issues[0].message).toContain('Artifact "data.json" is not valid JSON:')
    }
  })

  it('formats non-Error exception from JSON parse', async () => {
    const originalParse = JSON.parse
    try {
      JSON.parse = () => {
        // eslint-disable-next-line no-throw-literal
        throw 'raw string error'
      }
      const client = createMockArtifactClient({ 'data.json': 'any' })
      await expect(validateStepArtifacts('step-1', {
        'data.json': { schema },
      }, client)).rejects.toThrow('raw string error')
    }
    finally {
      JSON.parse = originalParse
    }
  })
})

describe('validateStepArtifacts Zod schema validation checks', () => {
  const schema = z.object({
    title: z.string().min(3),
    count: z.number(),
  })

  it('throws when parsed JSON fails Zod schema validation', async () => {
    const client = createMockArtifactClient({
      'data.json': JSON.stringify({ title: 'ab', count: 'invalid' }),
    })
    try {
      await validateStepArtifacts('step-1', {
        'data.json': { schema },
      }, client)
      expect.unreachable('Should have thrown')
    }
    catch (err: unknown) {
      const error = err as StepArtifactValidationError
      expect(error.issues).toHaveLength(2)
      expect(error.issues[0].artifactKey).toBe('data.json')
      expect(error.issues[0].path).toEqual(['title'])
      expect(error.issues[1].path).toEqual(['count'])
    }
  })

  it('passes when JSON satisfies Zod schema', async () => {
    const client = createMockArtifactClient({
      'data.json': JSON.stringify({ title: 'valid title', count: 42 }),
    })
    await expect(
      validateStepArtifacts('step-1', {
        'data.json': { schema },
      }, client),
    ).resolves.toBeUndefined()
  })
})

describe('validateStepArtifacts custom validate function', () => {
  it('throws when custom validate returns false or Promise<false>', async () => {
    const client = createMockArtifactClient({ 'notes.txt': 'draft' })
    const syncRule = {
      validate: (c: string) => c.startsWith('FINAL:'),
    }
    const asyncRule = {
      validate: async (c: string) => c.includes('APPROVED'),
    }

    await expect(
      validateStepArtifacts('step-1', { 'notes.txt': syncRule }, client),
    ).rejects.toThrow(StepArtifactValidationError)

    await expect(
      validateStepArtifacts('step-1', { 'notes.txt': asyncRule }, client),
    ).rejects.toThrow(StepArtifactValidationError)
  })

  it('passes when custom validate returns true or Promise<true>', async () => {
    const client = createMockArtifactClient({ 'notes.txt': 'FINAL: APPROVED' })
    const rule = {
      validate: async (c: string) => c.startsWith('FINAL:') && c.includes('APPROVED'),
    }
    await expect(
      validateStepArtifacts('step-1', { 'notes.txt': rule }, client),
    ).resolves.toBeUndefined()
  })
})

describe('formatArtifactRetryPrompt helper', () => {
  it('formats issues without path and with path into retry prompt', () => {
    const prompt = formatArtifactRetryPrompt('Generate spec and todos', [
      {
        artifactKey: 'spec.md',
        message: 'Artifact "spec.md" must be non-empty.',
      },
      {
        artifactKey: 'todos.json',
        path: ['items', 0, 'title'],
        message: 'Expected string, received number',
      },
    ])

    expect(prompt).toContain('The step artifacts failed validation:')
    expect(prompt).toContain('- [spec.md]: Artifact "spec.md" must be non-empty.')
    expect(prompt).toContain('- [todos.json (items.0.title)]: Expected string, received number')
    expect(prompt).toContain('Generate spec and todos')
  })
})
