import { StepOutputValidationError } from '@luddjs/core'
import { z } from 'zod'

/** Appends JSON Schema output instructions when a step declares `outputSchema`. */
export function buildPromptWithSchema(prompt: string, outputSchema?: z.ZodType): string {
  if (outputSchema === undefined) {
    return prompt
  }
  const jsonSchema = JSON.stringify(z.toJSONSchema(outputSchema), null, 2)
  return `${prompt}\n\nRespond with valid JSON matching this JSON Schema:\n\`\`\`json\n${jsonSchema}\n\`\`\``
}

function tryParseJson(raw: string): { ok: true, value: unknown } | { ok: false } {
  try {
    return {
      ok: true,
      value: JSON.parse(raw) as unknown,
    }
  }
  catch {
    return { ok: false }
  }
}

interface FencedBlock {
  isJsonTag: boolean
  body: string
}

function collectFencedBlocks(raw: string): FencedBlock[] {
  const blocks: FencedBlock[] = []
  let cursor = 0
  while (cursor < raw.length) {
    const openIndex = raw.indexOf('```', cursor)
    if (openIndex === -1) {
      break
    }
    const afterOpen = raw.slice(openIndex + 3)
    const isJsonTag = /^json(?=\s)/i.test(afterOpen)
    const bodyStartOffset = isJsonTag
      ? 4
      : 0
    const closeIndex = afterOpen.indexOf('```', bodyStartOffset)
    if (closeIndex === -1) {
      break
    }
    blocks.push({
      isJsonTag,
      body: afterOpen.slice(bodyStartOffset, closeIndex).trim(),
    })
    cursor = openIndex + 3 + closeIndex + 3
  }
  return blocks
}

function extractFromFencedBlocks(raw: string): { ok: true, value: unknown } | { ok: false } {
  const blocks = collectFencedBlocks(raw)
  const candidates = [
    ...blocks.filter(b => b.isJsonTag).reverse(),
    ...blocks.filter(b => !b.isJsonTag).reverse(),
  ]
  for (const block of candidates) {
    const parsed = tryParseJson(block.body)
    if (parsed.ok) {
      return parsed
    }
  }
  return { ok: false }
}

function extractJsonValue(rawText: string): { ok: true, value: unknown } | { ok: false } {
  const trimmed = rawText.trim()
  if (trimmed === '') {
    return { ok: false }
  }
  const direct = tryParseJson(trimmed)
  if (direct.ok) {
    return direct
  }
  return extractFromFencedBlocks(trimmed)
}

/** Parses and validates structured JSON output from an ACP turn response against `outputSchema`. */
export function resolveStructuredOutput<TOutput>(
  stepId: string,
  rawText: string,
  outputSchema?: z.ZodType,
  sessionId?: string,
): TOutput {
  if (outputSchema === undefined) {
    return rawText as TOutput
  }
  const extracted = extractJsonValue(rawText)
  if (!extracted.ok) {
    const issue: z.core.$ZodIssue = {
      code: 'custom',
      path: [],
      message: 'Assistant response did not contain valid JSON.',
    }
    throw new StepOutputValidationError(stepId, rawText, [issue], sessionId)
  }
  const parsed = outputSchema.safeParse(extracted.value)
  if (!parsed.success) {
    throw new StepOutputValidationError(stepId, extracted.value, parsed.error.issues, sessionId)
  }
  return parsed.data as TOutput
}
