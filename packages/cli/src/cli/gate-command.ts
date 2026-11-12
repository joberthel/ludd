import type { GateAction } from '@ludd/core'
import process from 'node:process'
import { gateCommand } from '../commands/gate-command.js'
import { parse, text } from './parse-args.js'

const actions: readonly GateAction[] = [
  'pass',
  'fail',
  'retry',
  'skip',
  'abort',
]

export async function cliGateCommand(args: string[]): Promise<void> {
  const { values, positionals } = parse(args, {
    'workspace': { type: 'string', short: 'w' },
    'action': { type: 'string' },
    'feedback': { type: 'string' },
    'add-retries': { type: 'string' },
  })
  const action = text(values, 'action')
  if (positionals.length !== 1 || (action !== undefined && !actions.includes(action as GateAction)))
    throw new Error('Usage: ludd gate <runId> [--action pass|fail|retry|skip|abort] [--feedback text] [--add-retries number]')
  const retriesValue = text(values, 'add-retries')
  const retries = retriesValue === undefined
    ? undefined
    : Number(retriesValue)
  if (retries !== undefined && (!Number.isInteger(retries) || retries < 1))
    throw new Error('--add-retries must be a positive integer')
  process.exitCode = await gateCommand({
    runId: positionals[0],
    ...(text(values, 'workspace') !== undefined
      ? {
          workspace: text(values, 'workspace'),
        }
      : {}),
    ...(action !== undefined
      ? { action: action as GateAction }
      : {}),
    ...(text(values, 'feedback') !== undefined
      ? {
          feedback: text(values, 'feedback'),
        }
      : {}),
    ...(retries !== undefined
      ? { addRetries: retries }
      : {}),
  })
}
