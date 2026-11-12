import type { ControlClient, GateResolveParams, RunStateSnapshot } from '@ludd/core'
import process from 'node:process'
import { createInterface } from 'node:readline/promises'

async function resolveHumanReview(gate: NonNullable<RunStateSnapshot['activeGate']>, rl: ReturnType<typeof createInterface>): Promise<GateResolveParams> {
  const actionInput = (await rl.question('Action [p]ass / [f]ail / [a]bort (pass): ')).trim().toLowerCase()
  const action = actionInput === 'f' || actionInput === 'fail'
    ? 'fail'
    : actionInput === 'a' || actionInput === 'abort'
      ? 'abort'
      : 'pass'
  const feedback = action === 'fail'
    ? await rl.question('Feedback (required on fail): ')
    : ''
  if (action === 'fail' && !feedback.trim())
    throw new Error('Feedback is required when failing a human review gate.')
  return {
    stepId: gate.stepId,
    guardrailIndex: gate.guardrailIndex,
    action,
    ...(feedback
      ? { feedback }
      : {}),
  }
}

async function resolveRetryGate(gate: NonNullable<RunStateSnapshot['activeGate']>, rl: ReturnType<typeof createInterface>): Promise<GateResolveParams> {
  const actionInput = (await rl.question('Action [r]etry / [p]ass / [s]kip / [a]bort (retry): ')).trim().toLowerCase()
  const action = actionInput === 'p' || actionInput === 'pass'
    ? 'pass'
    : actionInput === 's' || actionInput === 'skip'
      ? 'skip'
      : actionInput === 'a' || actionInput === 'abort'
        ? 'abort'
        : 'retry'
  const addRetries = action === 'retry'
    ? Number((await rl.question('Additional retries (1): ')).trim() || '1')
    : undefined
  const feedback = await rl.question('Feedback hint (optional): ')
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

export async function promptForGate(snapshot: RunStateSnapshot, client: ControlClient): Promise<void> {
  const gate = snapshot.activeGate
  if (!gate)
    return
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  try {
    console.log(`\n${gate.prompt}`)
    const resolution = gate.gateType === 'human_review'
      ? await resolveHumanReview(gate, rl)
      : await resolveRetryGate(gate, rl)
    await client.resolveGate(resolution)
  }
  finally {
    rl.close()
  }
}
