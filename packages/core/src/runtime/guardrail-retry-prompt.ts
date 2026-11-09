import type { GuardrailVerdict } from '../types/guardrail.js'

export function formatGuardrailRetryPrompt(
  initialPrompt: string,
  guardrailIndex: number,
  verdict: GuardrailVerdict<unknown>,
  mcpServerUrl?: string,
): string {
  if (verdict.logKey !== undefined) {
    const summary = typeof verdict.body === 'string' && verdict.body.length > 0
      ? `\nSummary: ${verdict.body}`
      : ''
    const serverNotice = typeof mcpServerUrl === 'string' && mcpServerUrl.length > 0
      ? ` at ${mcpServerUrl}`
      : ''
    return [
      `The step failed afterStep guardrail #${guardrailIndex}.${summary}`,
      `Detailed failure log has been offloaded to MCP logKey "${verdict.logKey}"${serverNotice}.`,
      `Use the MCP log tools (read_log_page, read_log_lines, search_log) to inspect the logs without loading the full output into context.`,
      `Please fix the issues and try again.`,
      `Original instruction:\n${initialPrompt}`,
    ].join('\n\n')
  }

  const rawLog = verdict.rawLog
  const hasLog = typeof rawLog === 'string' && rawLog.length > 0
  const details = hasLog
    ? `\nLog output:\n${rawLog}`
    : verdict.body !== undefined
      ? `\nDetails: ${typeof verdict.body === 'string'
        ? verdict.body
        : JSON.stringify(verdict.body)}`
      : ''
  return `The step failed afterStep guardrail #${guardrailIndex}.${details}\n\nPlease fix the issues and try again.\n\nOriginal instruction:\n${initialPrompt}`
}
