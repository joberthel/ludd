#!/usr/bin/env node
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { cliGateCommand } from './cli/gate-command.js'
import { cliGcCommand } from './cli/gc-command.js'
import { cliAbortCommand, cliTeardownCommand } from './cli/lifecycle-command.js'
import { cliResumeCommand } from './cli/resume-command.js'
import { cliRunCommand } from './cli/run-command.js'
import { cliStatusCommand } from './cli/status-command.js'
import { workerCommand } from './cli/worker-command.js'

const commandHandlers: Record<string, (args: string[]) => Promise<void>> = {
  __worker: workerCommand,
  run: cliRunCommand,
  resume: cliResumeCommand,
  status: cliStatusCommand,
  abort: cliAbortCommand,
  teardown: cliTeardownCommand,
  gc: cliGcCommand,
  gate: cliGateCommand,
}

export async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2)
  const handler = command === undefined
    ? undefined
    : commandHandlers[command]
  if (!handler)
    throw new Error('Usage: ludd run ... | ludd resume <run-id> ... | ludd status [runId] [--json] | ludd abort <runId> ... | ludd teardown <runId> ... | ludd gc [runId ...] ... | ludd gate <runId> ...')
  await handler(args)
}

export async function runCli(): Promise<void> {
  try {
    await main()
  }
  catch (error: unknown) {
    console.error(error instanceof Error
      ? error.message
      : String(error))
    process.exitCode = 1
  }
}

export async function bootstrapCli(entrypoint = process.argv[1]): Promise<void> {
  if (entrypoint && path.resolve(entrypoint) === fileURLToPath(import.meta.url))
    await runCli()
}

void bootstrapCli()
