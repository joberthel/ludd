import type { ToolDefinition } from '@earendil-works/pi-coding-agent'
import { MCP_TOOLS_LIST } from '@ludd/core'
import { z } from 'zod'

/** Name of the in-turn structured-output tool exposed when a step declares an `outputSchema`. */
export const SUBMIT_STEP_OUTPUT_TOOL = 'submit_step_output'

/** Names of every bridge tool (MCP-forwarding tools plus `submit_step_output`). */
export const BRIDGE_TOOL_NAMES: readonly string[] = [
  ...MCP_TOOLS_LIST.map(tool => tool.name),
  SUBMIT_STEP_OUTPUT_TOOL,
]

export interface McpBridgeOptions {
  url: string
  authToken: string
}

interface McpToolCallResponse {
  result?: { content?: Array<{ type: string, text?: string }>, isError?: boolean }
  error?: { message?: string }
}

function textResult(text: string): { content: Array<{ type: 'text', text: string }>, details: undefined } {
  return {
    content: [
      { type: 'text', text },
    ],
    details: undefined,
  }
}

async function callMcpTool(
  options: McpBridgeOptions,
  name: string,
  args: unknown,
  signal: AbortSignal | undefined,
): Promise<string> {
  const response = await fetch(options.url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${options.authToken}`,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name, arguments: args },
    }),
    ...(signal === undefined
      ? {}
      : { signal }),
  })
  if (!response.ok) {
    throw new Error(`MCP request failed with HTTP ${response.status}`)
  }
  const body = (await response.json()) as McpToolCallResponse
  if (body.error !== undefined) {
    throw new Error(body.error.message ?? 'MCP request failed')
  }
  const text = (body.result?.content ?? []).map(part => part.text ?? '').join('\n')
  if (body.result?.isError === true) {
    throw new Error(text)
  }
  return text
}

/**
 * Pi `customTools` forwarding the run's MCP tools (artifacts + paginated logs) to the embedded
 * MCP server with `Authorization: Bearer <token>`. Definitions come from the server's own tool
 * list, so names and schemas never drift. Server-side tool errors are thrown so Pi marks the call
 * as failed and the model can react.
 */
export function createMcpBridgeTools(options: McpBridgeOptions): ToolDefinition[] {
  return MCP_TOOLS_LIST.map(tool => ({
    name: tool.name,
    label: tool.name,
    description: tool.description,
    parameters: tool.inputSchema as never,
    execute: async (_id: string, params: unknown, signal: AbortSignal | undefined) =>
      textResult(await callMcpTool(options, tool.name, params, signal)),
  }))
}

/** Wrapper key used when the step schema is not an object (tool parameters must be objects). */
export const SUBMIT_VALUE_KEY = 'value'

export interface StepOutputSubmission {
  tool: ToolDefinition
  /** Last payload that passed `outputSchema.safeParse`, as submitted (pre-transform). */
  getSubmission: () => { value: unknown } | undefined
}

function describeIssues(issues: readonly z.core.$ZodIssue[]): string {
  return issues
    .map(issue => `${issue.path.length === 0
      ? '<root>'
      : issue.path.join('.')}: ${issue.message}`)
    .join('\n')
}

/**
 * Builds `submit_step_output`: parameters come from `z.toJSONSchema(schema)`; every call is
 * `safeParse`d. Invalid payloads throw (Zod issues as the tool error) so the model can correct
 * itself in the same turn; valid payloads are captured as the turn output.
 */
export function createSubmitStepOutputTool(schema: z.ZodType): StepOutputSubmission {
  const json = z.toJSONSchema(schema, { io: 'input' }) as Record<string, unknown>
  delete json.$schema
  const wrapped = json.type !== 'object'
  const parameters = wrapped
    ? {
        type: 'object',
        properties: { [SUBMIT_VALUE_KEY]: json },
        required: [SUBMIT_VALUE_KEY],
      }
    : json
  let submission: { value: unknown } | undefined
  const tool = {
    name: SUBMIT_STEP_OUTPUT_TOOL,
    label: SUBMIT_STEP_OUTPUT_TOOL,
    description: 'Submit the final structured output of this step. Call it exactly once when done; '
      + 'if validation fails, fix the reported issues and call it again.',
    parameters: parameters as never,
    execute: async (_id: string, params: unknown) => {
      const candidate = wrapped ? (params as Record<string, unknown>)[SUBMIT_VALUE_KEY] : params
      const parsed = await schema.safeParseAsync(candidate)
      if (!parsed.success) {
        throw new Error(`Output validation failed:\n${describeIssues(parsed.error.issues)}`)
      }
      submission = { value: candidate }
      return textResult('Step output accepted.')
    },
  } as unknown as ToolDefinition
  return {
    tool,
    getSubmission: () => submission,
  }
}

/** Issue reported when a turn settles without a valid `submit_step_output` call. */
export const MISSING_SUBMISSION_ISSUE: z.core.$ZodIssue = {
  code: 'custom',
  path: [],
  input: undefined,
  message: `No valid output was submitted. Call the ${SUBMIT_STEP_OUTPUT_TOOL} tool with the final output.`,
}
