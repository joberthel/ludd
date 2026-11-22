import type { HarnessConfig, RunStateSnapshot } from '@ludd/core'

export type UiLogPhase = 'beforeStep' | 'interactive' | 'run' | 'afterStep'

export interface UiLogScope {
  stepId?: string
  matrixIndex?: number
  matrixTotal?: number
  phase?: UiLogPhase
  guardrailIndex?: number
  guardrailName?: string
  attempt?: number
}

export interface BlueprintGuardrail {
  index: number
  name?: string
}

export interface BlueprintStep {
  id: string
  name?: string
  hasMatrix: boolean
  beforeStep?: readonly BlueprintGuardrail[]
  afterStep?: readonly BlueprintGuardrail[]
}

export interface HarnessBlueprint {
  harnessName: string
  runId?: string
  steps: readonly BlueprintStep[]
}

export type RunUiEntryPayload
  = | { kind: 'run.started', harnessName: string, runId?: string }
    | { kind: 'run.resumed', harnessName?: string, runId?: string }
    | { kind: 'run.passed' }
    | { kind: 'run.failed', error?: string }
    | { kind: 'step.started', stepId: string }
    | { kind: 'step.passed', stepId: string }
    | { kind: 'step.skipped', stepId: string }
    | { kind: 'step.failed', stepId: string, error?: string }
    | { kind: 'step.retry', stepId: string, attempt?: number }
    | { kind: 'guardrail.started', name?: string }
    | { kind: 'guardrail.passed', name?: string, output?: string, logKey?: string }
    | { kind: 'guardrail.skipped', name?: string, output?: string, logKey?: string }
    | { kind: 'guardrail.failed', name?: string, output?: string, logKey?: string }
    | { kind: 'tool.start', toolName: string, argsSummary?: string }
    | { kind: 'tool.error', toolName: string }
    | { kind: 'agent.thought', text: string, streaming?: boolean }
    | { kind: 'agent.text', text: string }
    | { kind: 'agent.output', output: string }
    | { kind: 'prompt.answered', prompt: string, answer: string }

export type RunUiEntry = RunUiEntryPayload & {
  scope?: UiLogScope
  streamKey?: string
}

export interface RunUiHost {
  pushEntry: (entry: RunUiEntry) => void
  upsertEntry?: (streamKey: string, entry: RunUiEntry) => void
  setActivity: (label: string | undefined) => void
  setBlueprint?: (blueprint: HarnessBlueprint) => void
  hydrateSnapshot?: (snapshot: RunStateSnapshot) => void
  onGuardrailStarted?: (scope: UiLogScope) => void
  setGateWaiting?: (waiting: boolean, scope?: UiLogScope) => void
}

export function toHarnessBlueprint(config: HarnessConfig, runId?: string): HarnessBlueprint {
  return {
    harnessName: config.name,
    ...(runId !== undefined
      ? { runId }
      : {}),
    steps: config.steps.map((step) => {
      let beforeStep: BlueprintGuardrail[] | undefined
      if (Array.isArray(step.beforeStep)) {
        beforeStep = (step.beforeStep as ReadonlyArray<{ name?: string }>).map((guardrail, index) => ({
          index,
          ...(guardrail.name !== undefined
            ? { name: guardrail.name }
            : {}),
        }))
      }
      else if (typeof step.beforeStep === 'object' && step.beforeStep !== null) {
        beforeStep = Object.entries(step.beforeStep as Record<string, { name?: string }>).map(([key, guardrail], index) => ({
          index,
          name: guardrail.name ?? key,
        }))
      }

      const afterStep = Array.isArray(step.afterStep)
        ? (step.afterStep as ReadonlyArray<{ name?: string }>).map((guardrail, index) => ({
            index,
            ...(guardrail.name !== undefined
              ? { name: guardrail.name }
              : {}),
          }))
        : undefined

      return {
        id: step.id,
        ...(step.name !== undefined
          ? { name: step.name }
          : {}),
        hasMatrix: step.matrix !== undefined,
        ...(beforeStep !== undefined
          ? { beforeStep }
          : {}),
        ...(afterStep !== undefined
          ? { afterStep }
          : {}),
      }
    }),
  }
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
