import type { ControlClient, GateResolveParams, InteractiveQuestion, RunStateSnapshot } from '@ludd/core'
import process from 'node:process'
import { createInterface } from 'node:readline/promises'
import { normalizeSelectOptions } from '@ludd/core'
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
  const action = await promptAction<'pass' | 'fail' | 'skip' | 'abort'>(
    'Action [p]ass / [f]ail / [s]kip / [a]bort (pass): ',
    {
      p: 'pass',
      pass: 'pass',
      f: 'fail',
      fail: 'fail',
      s: 'skip',
      skip: 'skip',
      a: 'abort',
      abort: 'abort',
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
    console.log(`Options: ${opts}`)
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

export async function promptForGate(snapshot: RunStateSnapshot, client: ControlClient, signal?: AbortSignal): Promise<void> {
  const gate = snapshot.activeGate
  if (!gate || signal?.aborted)
    return
  if (gate.gateType === 'user_question' && gate.question !== undefined && process.stdin.isTTY) {
    try {
      const answer = await promptInteractiveQuestionInTty(gate.question, signal)
      await client.resolveGate({
        stepId: gate.stepId,
        guardrailIndex: gate.guardrailIndex,
        action: 'answer',
        answer,
      })
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
