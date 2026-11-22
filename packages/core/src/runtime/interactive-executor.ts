import type { AskUserHandler } from '../types/artifact.js'
import type { StepContext } from '../types/context.js'
import type { StepConfig } from '../types/harness.js'
import type { InteractiveQuestion, InteractiveStepOptions } from '../types/interactive.js'
import type { ActiveGateState, RunStateSnapshot } from '../types/state.js'
import type { GateWaiter } from './gate-waiter.js'
import { appendLedgerEvent } from '../persistence/ledger-writer.js'
import { writeRunStateAtomic } from '../persistence/state-store.js'
import { normalizeSelectOptions } from '../types/interactive.js'

export function resolveInteractiveOptions(
  interactive: StepConfig['interactive'],
): InteractiveStepOptions | undefined {
  if (interactive === undefined || interactive === false) {
    return undefined
  }
  return interactive === true
    ? {}
    : interactive
}

export function validateInteractiveAnswer(question: InteractiveQuestion, raw: unknown): unknown {
  if (question.type === 'text') {
    if (typeof raw !== 'string') {
      throw new TypeError('Expected a text answer.')
    }
    return raw
  }
  if (question.type === 'number') {
    const num = typeof raw === 'number'
      ? raw
      : typeof raw === 'string' && raw.trim() !== ''
        ? Number(raw)
        : Number.NaN
    if (!Number.isFinite(num)) {
      throw new TypeError('Expected a valid number.')
    }
    if (question.min !== undefined && num < question.min) {
      throw new Error(`Value must be at least ${question.min}.`)
    }
    if (question.max !== undefined && num > question.max) {
      throw new Error(`Value must be at most ${question.max}.`)
    }
    return num
  }
  if (question.type === 'confirm') {
    if (typeof raw !== 'boolean') {
      throw new TypeError('Expected a boolean answer.')
    }
    return raw
  }
  const allowed = new Set(normalizeSelectOptions(question.options).map(opt => opt.value))
  if (question.type === 'select') {
    if (question.allowOther === true) {
      if (typeof raw !== 'string' || (!allowed.has(raw) && raw.trim() === '')) {
        throw new Error('Expected a non-empty answer.')
      }
      return raw
    }
    if (typeof raw !== 'string' || !allowed.has(raw)) {
      throw new Error(`Expected one of: ${[...allowed].join(', ')}.`)
    }
    return raw
  }
  if (!Array.isArray(raw) || raw.some(item => typeof item !== 'string' || !allowed.has(item))) {
    throw new Error(`Expected an array of values from: ${[...allowed].join(', ')}.`)
  }
  return raw
}

export interface AskInteractiveQuestionParams {
  runDir: string
  snapshot: RunStateSnapshot
  stepId: string
  matrixIndex?: number
  phase: 'interactive' | 'run'
  questionIndex: number
  questionKey?: string
  question: InteractiveQuestion
  gateWaiter: GateWaiter
}

export async function askInteractiveQuestion(params: AskInteractiveQuestionParams): Promise<unknown> {
  const existingGate = params.gateWaiter.getActiveGate()
  if (existingGate !== null) {
    throw new Error(
      `A gate is already waiting for resolution: ${existingGate.stepId} (index ${existingGate.guardrailIndex})`,
    )
  }
  const gate: ActiveGateState = {
    stepId: params.stepId,
    ...(params.matrixIndex !== undefined
      ? { matrixIndex: params.matrixIndex }
      : {}),
    phase: params.phase,
    guardrailIndex: params.questionIndex,
    gateType: 'user_question',
    prompt: params.question.prompt,
    question: params.question,
    ...(params.questionKey !== undefined
      ? { questionKey: params.questionKey }
      : {}),
    createdAt: new Date().toISOString(),
  }
  if (params.gateWaiter.signal?.aborted) {
    await params.gateWaiter.waitForResolution(gate)
  }
  params.snapshot.status = 'waiting_for_gate'
  params.snapshot.activeGate = gate
  params.snapshot.updatedAt = gate.createdAt
  writeRunStateAtomic(params.runDir, params.snapshot)
  appendLedgerEvent(params.runDir, {
    schemaVersion: 1,
    timestamp: gate.createdAt,
    runId: params.snapshot.runId,
    stepId: params.stepId,
    matrixIndex: params.matrixIndex,
    eventType: 'gate.waiting',
    payload: {
      phase: params.phase,
      guardrailIndex: params.questionIndex,
      gateType: 'user_question',
      prompt: params.question.prompt,
      question: params.question,
      ...(params.questionKey !== undefined
        ? { questionKey: params.questionKey }
        : {}),
    },
  })

  const resolution = await params.gateWaiter.waitForResolution(gate)
  if (resolution.action === 'abort') {
    throw new Error(`Interactive question aborted by user for step "${params.stepId}".`)
  }
  return validateInteractiveAnswer(params.question, resolution.answer)
}

export interface RunInitialQuestionsParams {
  step: StepConfig
  ctx: StepContext
  snapshot: RunStateSnapshot
  runDir: string
  gateWaiter?: GateWaiter
}

export async function runInitialInteractiveQuestions(params: RunInitialQuestionsParams): Promise<void> {
  const answers: Record<string, unknown> = {
    ...(params.snapshot.activeInteractiveAnswers ?? {}),
  }
  const attach = (): void => {
    ;(params.ctx as StepContext & { interactive: Record<string, unknown> }).interactive = answers
  }
  attach()
  const config = resolveInteractiveOptions(params.step.interactive)
  if (!config?.initialQuestions) {
    return
  }
  const questionMap = typeof config.initialQuestions === 'function'
    ? await config.initialQuestions(params.ctx)
    : config.initialQuestions
  const entries = Object.entries(questionMap)
  for (let i = 0; i < entries.length; i++) {
    const [key, question] = entries[i]
    if (Object.hasOwn(answers, key)) {
      continue
    }
    if (!params.gateWaiter) {
      throw new Error(`Step "${params.step.id}" requires interactive input for "${key}" without an active gate waiter.`)
    }
    answers[key] = await askInteractiveQuestion({
      runDir: params.runDir,
      snapshot: params.snapshot,
      stepId: params.step.id,
      matrixIndex: params.ctx.matrix?.index,
      phase: 'interactive',
      questionIndex: i,
      questionKey: key,
      question,
      gateWaiter: params.gateWaiter,
    })
    params.snapshot.activeInteractiveAnswers = { ...answers }
    params.snapshot.updatedAt = new Date().toISOString()
    writeRunStateAtomic(params.runDir, params.snapshot)
  }
}

export function createInteractiveQuestionHandler(params: {
  step: StepConfig
  snapshot: RunStateSnapshot
  runDir: string
  matrixIndex?: number
  gateWaiter?: GateWaiter
}): AskUserHandler | undefined {
  const config = resolveInteractiveOptions(params.step.interactive)
  if (!config) {
    return undefined
  }
  let askedCount = 0
  let queue: Promise<void> = Promise.resolve()
  return async (question: InteractiveQuestion): Promise<unknown> => {
    const run = queue.then(async () => {
      if (config.maxQuestions !== undefined && askedCount >= config.maxQuestions) {
        throw new Error(
          `Question budget exhausted (${config.maxQuestions}). Proceed using your best judgment without asking further questions.`,
        )
      }
      if (!params.gateWaiter) {
        throw new Error(`Step "${params.step.id}" cannot ask user questions without an active gate waiter.`)
      }
      const index = askedCount
      askedCount += 1
      return askInteractiveQuestion({
        runDir: params.runDir,
        snapshot: params.snapshot,
        stepId: params.step.id,
        matrixIndex: params.matrixIndex,
        phase: 'run',
        questionIndex: index,
        question,
        gateWaiter: params.gateWaiter,
      })
    })
    queue = run.then(() => undefined, () => undefined)
    return run
  }
}
