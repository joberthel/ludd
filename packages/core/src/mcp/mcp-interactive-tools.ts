import type { AskUserHandler } from '../types/artifact.js'
import type { InteractiveQuestion, InteractiveSelectOption } from '../types/interactive.js'
import type { McpToolResult } from './mcp-tools.js'

export const ASK_USER_TOOL_NAME = 'ask_user'

export const MCP_INTERACTIVE_TOOLS_LIST = [
  {
    name: ASK_USER_TOOL_NAME,
    description: 'Ask the human user a structured question and wait for their answer.',
    inputSchema: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          enum: [
            'text',
            'number',
            'select',
            'multi-select',
            'confirm',
          ],
          description: 'Input control type to render for the user.',
        },
        prompt: {
          type: 'string',
          description: 'The question to display to the user.',
        },
        options: {
          type: 'array',
          description: 'Selectable choices (required for "select" and "multi-select").',
          items: {
            oneOf: [
              { type: 'string' },
              {
                type: 'object',
                properties: {
                  label: { type: 'string' },
                  value: { type: 'string' },
                },
                required: ['label', 'value'],
              },
            ],
          },
        },
        min: { type: 'number', description: 'Optional minimum value (for "number").' },
        max: { type: 'number', description: 'Optional maximum value (for "number").' },
        placeholder: { type: 'string', description: 'Optional placeholder text (for "text").' },
        default: { description: 'Optional default value matching the question type.' },
      },
      required: ['type', 'prompt'],
    },
  },
]

function errorResult(text: string): McpToolResult {
  return {
    content: [
      { type: 'text', text },
    ],
    isError: true,
  }
}

function parseSelectOptions(raw: unknown): InteractiveSelectOption[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) {
    return undefined
  }
  const parsed: InteractiveSelectOption[] = []
  for (const item of raw) {
    if (typeof item === 'string' && item.trim() !== '') {
      parsed.push(item)
      continue
    }
    if (
      typeof item === 'object'
      && item !== null
      && typeof (item as Record<string, unknown>).label === 'string'
      && typeof (item as Record<string, unknown>).value === 'string'
    ) {
      parsed.push({
        label: (item as Record<string, string>).label,
        value: (item as Record<string, string>).value,
      })
      continue
    }
    return undefined
  }
  return parsed
}

function parseAskUserQuestion(args: Record<string, unknown> | undefined): InteractiveQuestion | string {
  const type = args?.type
  const prompt = args?.prompt
  if (typeof prompt !== 'string' || prompt.trim() === '') {
    return 'Invalid arguments: "prompt" must be a non-empty string.'
  }
  if (type === 'text') {
    return {
      type: 'text',
      prompt,
      ...(typeof args?.default === 'string'
        ? { default: args.default }
        : {}),
      ...(typeof args?.placeholder === 'string'
        ? { placeholder: args.placeholder }
        : {}),
    }
  }
  if (type === 'number') {
    return {
      type: 'number',
      prompt,
      ...(typeof args?.min === 'number'
        ? { min: args.min }
        : {}),
      ...(typeof args?.max === 'number'
        ? { max: args.max }
        : {}),
      ...(typeof args?.default === 'number'
        ? { default: args.default }
        : {}),
    }
  }
  if (type === 'confirm') {
    return {
      type: 'confirm',
      prompt,
      ...(typeof args?.default === 'boolean'
        ? { default: args.default }
        : {}),
    }
  }
  if (type === 'select' || type === 'multi-select') {
    const options = parseSelectOptions(args?.options)
    if (options === undefined) {
      return `Invalid arguments: "${type}" requires a non-empty "options" array.`
    }
    if (type === 'select') {
      return {
        type: 'select',
        prompt,
        options,
        ...(typeof args?.default === 'string'
          ? { default: args.default }
          : {}),
      }
    }
    const defaultValues = Array.isArray(args?.default) && args.default.every(item => typeof item === 'string')
      ? args.default
      : undefined
    return {
      type: 'multi-select',
      prompt,
      options,
      ...(defaultValues !== undefined
        ? { default: defaultValues }
        : {}),
    }
  }
  return 'Invalid arguments: "type" must be one of "text", "number", "select", "multi-select", or "confirm".'
}

export async function executeAskUserToolCall(
  args: Record<string, unknown> | undefined,
  handler: AskUserHandler | undefined,
): Promise<McpToolResult> {
  if (!handler) {
    return errorResult('Interactive mode is not enabled for this step.')
  }
  const question = parseAskUserQuestion(args)
  if (typeof question === 'string') {
    return errorResult(question)
  }
  try {
    const answer = await handler(question)
    const text = typeof answer === 'string'
      ? answer
      : JSON.stringify(answer)
    return {
      content: [
        { type: 'text', text },
      ],
    }
  }
  catch (error: unknown) {
    return errorResult(error instanceof Error
      ? error.message
      : String(error))
  }
}
