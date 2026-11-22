export type RunUiEntry
  = | { kind: 'run.started', harnessName: string }
    | { kind: 'run.resumed', harnessName?: string }
    | { kind: 'run.passed' }
    | { kind: 'run.failed', error?: string }
    | { kind: 'step.started', stepId: string }
    | { kind: 'step.passed', stepId: string }
    | { kind: 'step.skipped', stepId: string }
    | { kind: 'step.failed', stepId: string, error?: string }
    | { kind: 'step.retry', stepId: string, attempt?: number }
    | { kind: 'guardrail.passed', name?: string }
    | { kind: 'guardrail.skipped', name?: string }
    | { kind: 'guardrail.failed', name?: string }
    | { kind: 'tool.start', toolName: string, argsSummary?: string }
    | { kind: 'tool.error', toolName: string }
    | { kind: 'agent.text', text: string }
    | { kind: 'agent.output', output: string }
    | { kind: 'prompt.answered', prompt: string, answer: string }

export interface RunUiHost {
  pushEntry: (entry: RunUiEntry) => void
  setActivity: (label: string | undefined) => void
}

let activeRunUiHost: RunUiHost | undefined

export function registerRunUiHost(host: RunUiHost): () => void {
  activeRunUiHost = host
  return () => {
    if (activeRunUiHost === host) {
      activeRunUiHost = undefined
    }
  }
}

export function getRunUiHost(): RunUiHost | undefined {
  return activeRunUiHost
}

function truncateValue(value: string, maxLength = 60): string {
  const singleLine = value.replace(/\s+/g, ' ').trim()
  return singleLine.length > maxLength
    ? `${singleLine.slice(0, maxLength - 1)}…`
    : singleLine
}

export function formatToolArgsSummary(args: unknown): string | undefined {
  if (args === undefined || args === null) {
    return undefined
  }
  if (typeof args !== 'object' || Array.isArray(args)) {
    return truncateValue(JSON.stringify(args))
  }
  const entries = Object.entries(args as Record<string, unknown>)
  if (entries.length === 0) {
    return undefined
  }
  return entries
    .map(([key, value]) => {
      const rendered = typeof value === 'string'
        ? value
        : JSON.stringify(value)
      return `${key}=${truncateValue(rendered)}`
    })
    .join(' ')
}
