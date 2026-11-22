import type { ControlClient, GateResolveParams, InteractiveQuestion, RunStateSnapshot } from '@luddjs/core'
import process from 'node:process'
import { createInterface } from 'node:readline/promises'
import { normalizeSelectOptions } from '@luddjs/core'
import { promptInteractiveQuestionInTty } from '../ui/interactive-question-prompt.js'
import { parseStringAnswer } from './parse-answer.js'

async function promptAction<T extends string>(
  prompt: string,
  options: Record<string, T>,
  defaultAction: T,
  rl: ReturnType<typeof createInterface>,
  signal?: AbortSignal,
): Promise<T> {
  while (true) {
    const input = (await rl.question(prompt, { signal })).trim().toLowerCase()
    if (!input)
      return defaultAction
    if (Object.hasOwn(options, input))
      return options[input]
    console.log('Invalid option. Please try again.')
  }
}

async function resolveHumanReview(
  gate: NonNullable<RunStateSnapshot['activeGate']>,
  rl: ReturnType<typeof createInterface>,
  signal?: AbortSignal,
): Promise<GateResolveParams> {
  const action = await promptAction<'pass' | 'fail'>(
    'Action [p]ass / [f]ail (pass): ',
    {
      p: 'pass',
      pass: 'pass',
      f: 'fail',
      fail: 'fail',
    },
    'pass',
    rl,
    signal,
  )
  let feedback = ''
  if (action === 'fail') {
    while (!feedback.trim()) {
      feedback = await rl.question('Feedback (required on fail): ', { signal })
    }
  }
  return {
    stepId: gate.stepId,
    guardrailIndex: gate.guardrailIndex,
    action,
    ...(feedback
      ? { feedback }
      : {}),
  }
}

async function resolveRetryGate(
  gate: NonNullable<RunStateSnapshot['activeGate']>,
  rl: ReturnType<typeof createInterface>,
  signal?: AbortSignal,
): Promise<GateResolveParams> {
  const action = await promptAction<'retry' | 'pass' | 'skip' | 'abort'>(
    'Action [r]etry / [p]ass / [s]kip / [a]bort (retry): ',
    {
      r: 'retry',
      retry: 'retry',
      p: 'pass',
      pass: 'pass',
      s: 'skip',
      skip: 'skip',
      a: 'abort',
      abort: 'abort',
    },
    'retry',
    rl,
    signal,
  )
  let addRetries: number | undefined
  if (action === 'retry') {
    while (true) {
      const raw = (await rl.question('Additional retries (1): ', { signal })).trim()
      if (!raw) {
        addRetries = 1
        break
      }
      const parsed = Number(raw)
      if (Number.isInteger(parsed) && parsed > 0) {
        addRetries = parsed
        break
      }
      console.log('Please enter a positive integer.')
    }
  }
  const feedback = await rl.question('Feedback hint (optional): ', { signal })
  return {
    stepId: gate.stepId,
    guardrailIndex: gate.guardrailIndex,
    action,
    ...(addRetries !== undefined
      ? { addRetries }
      : {}),
    ...(feedback
      ? { feedback }
      : {}),
  }
}

async function resolveUserQuestionReadline(
  gate: NonNullable<RunStateSnapshot['activeGate']>,
  question: InteractiveQuestion,
  rl: ReturnType<typeof createInterface>,
  signal?: AbortSignal,
): Promise<GateResolveParams> {
  if (question.type === 'select' || question.type === 'multi-select') {
    const opts = normalizeSelectOptions(question.options).map(opt => opt.value).join(', ')
    const suffix = question.type === 'select' && question.allowOther === true
      ? ' (or enter a custom answer)'
      : ''
    console.log(`Options: ${opts}${suffix}`)
  }
  while (true) {
    const raw = await rl.question('Answer: ', { signal })
    try {
      const answer = parseStringAnswer(question, raw)
      return {
        stepId: gate.stepId,
        guardrailIndex: gate.guardrailIndex,
        action: 'answer',
        answer,
      }
    }
    catch (error: unknown) {
      console.log((error as Error).message)
    }
  }
}

async function resolveHumanReviewTty(
  gate: NonNullable<RunStateSnapshot['activeGate']>,
  signal?: AbortSignal,
): Promise<GateResolveParams> {
  const action = await promptInteractiveQuestionInTty({
    type: 'select',
    prompt: gate.prompt,
    options: [
      { label: 'Pass', value: 'pass' },
      { label: 'Fail (requires feedback)', value: 'fail' },
    ],
  }, signal) as 'pass' | 'fail'
  let feedback = ''
  if (action === 'fail') {
    while (!feedback.trim()) {
      feedback = String(await promptInteractiveQuestionInTty({
        type: 'text',
        prompt: 'Feedback (required on fail):',
        placeholder: 'Describe what needs to be fixed',
      }, signal))
    }
  }
  return {
    stepId: gate.stepId,
    guardrailIndex: gate.guardrailIndex,
    action,
    ...(feedback
      ? { feedback }
      : {}),
  }
}

async function resolveRetryGateTty(
  gate: NonNullable<RunStateSnapshot['activeGate']>,
  signal?: AbortSignal,
): Promise<GateResolveParams> {
  const action = await promptInteractiveQuestionInTty({
    type: 'select',
    prompt: gate.prompt,
    options: [
      { label: 'Retry', value: 'retry' },
      { label: 'Pass', value: 'pass' },
      { label: 'Skip', value: 'skip' },
      { label: 'Abort', value: 'abort' },
    ],
  }, signal) as 'retry' | 'pass' | 'skip' | 'abort'
  let addRetries: number | undefined
  if (action === 'retry') {
    while (true) {
      const value = await promptInteractiveQuestionInTty({
        type: 'number',
        prompt: 'Additional retries:',
        min: 1,
        default: 1,
      }, signal) as number
      if (Number.isInteger(value) && value > 0) {
        addRetries = value
        break
      }
    }
  }
  const feedback = String(await promptInteractiveQuestionInTty({
    type: 'text',
    prompt: 'Feedback hint (optional):',
    placeholder: 'Press Enter to skip',
  }, signal))
  return {
    stepId: gate.stepId,
    guardrailIndex: gate.guardrailIndex,
    action,
    ...(addRetries !== undefined
      ? { addRetries }
      : {}),
    ...(feedback
      ? { feedback }
      : {}),
  }
}

async function resolveGateInTty(
  gate: NonNullable<RunStateSnapshot['activeGate']>,
  signal?: AbortSignal,
): Promise<GateResolveParams> {
  if (gate.gateType === 'user_question' && gate.question !== undefined) {
    const answer = await promptInteractiveQuestionInTty(gate.question, signal)
    return {
      stepId: gate.stepId,
      guardrailIndex: gate.guardrailIndex,
      action: 'answer',
      answer,
    }
  }
  if (gate.gateType === 'human_review') {
    return resolveHumanReviewTty(gate, signal)
  }
  return resolveRetryGateTty(gate, signal)
}

export async function promptForGate(snapshot: RunStateSnapshot, client: ControlClient, signal?: AbortSignal): Promise<void> {
  const gate = snapshot.activeGate
  if (!gate || signal?.aborted)
    return
  if (process.stdin.isTTY) {
    try {
      const resolution = await resolveGateInTty(gate, signal)
      await client.resolveGate(resolution)
    }
    catch (error) {
      if (signal?.aborted && error instanceof Error && error.name === 'AbortError')
        return
      throw error
    }
    return
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  try {
    console.log(`\n${gate.prompt}`)
    const resolution = gate.gateType === 'user_question' && gate.question !== undefined
      ? await resolveUserQuestionReadline(gate, gate.question, rl, signal)
      : gate.gateType === 'human_review'
        ? await resolveHumanReview(gate, rl, signal)
        : await resolveRetryGate(gate, rl, signal)
    await client.resolveGate(resolution)
  }
  catch (error) {
    if (signal?.aborted && error instanceof Error && error.name === 'AbortError')
      return
    throw error
  }
  finally {
    rl.close()
  }
}
