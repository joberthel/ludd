import type { ControlClient, GateResolveParams, RunStateSnapshot } from '@ludd/core'
import process from 'node:process'
import { createInterface } from 'node:readline/promises'

async function resolveHumanReview(
  gate: NonNullable<RunStateSnapshot['activeGate']>,
  rl: ReturnType<typeof createInterface>,
  signal?: AbortSignal,
): Promise<GateResolveParams> {
  const actionInput = (await rl.question('Action [p]ass / [f]ail / [a]bort (pass): ', { signal })).trim().toLowerCase()
  const action = actionInput === 'f' || actionInput === 'fail'
    ? 'fail'
    : actionInput === 'a' || actionInput === 'abort'
      ? 'abort'
      : 'pass'
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
  const actionInput = (await rl.question('Action [r]etry / [p]ass / [s]kip / [a]bort (retry): ', { signal })).trim().toLowerCase()
  const action = actionInput === 'p' || actionInput === 'pass'
    ? 'pass'
    : actionInput === 's' || actionInput === 'skip'
      ? 'skip'
      : actionInput === 'a' || actionInput === 'abort'
        ? 'abort'
        : 'retry'
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

export async function promptForGate(snapshot: RunStateSnapshot, client: ControlClient, signal?: AbortSignal): Promise<void> {
  const gate = snapshot.activeGate
  if (!gate || signal?.aborted)
    return
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  try {
    console.log(`\n${gate.prompt}`)
    const resolution = gate.gateType === 'human_review'
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
