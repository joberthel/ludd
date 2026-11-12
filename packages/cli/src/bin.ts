#!/usr/bin/env node
import process from 'node:process'
import { parseArgs } from 'node:util'
import { runCommand } from './commands/run-command.js'

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    options: {
      'config': { type: 'string', short: 'c' },
      'run-id': { type: 'string', short: 'r' },
      'workspace': { type: 'string', short: 'w' },
      'stream': { type: 'boolean', short: 's' },
    },
    allowPositionals: true,
    strict: true,
  })
  const command = positionals[0]
  if (command !== 'run') {
    throw new Error('Usage: ludd run [configPath] [-c|--config path] [-r|--run-id id] [-w|--workspace dir] [-s|--stream]')
  }
  const positionalConfig = positionals[1]
  if (positionals.length > 2 || (values.config !== undefined && positionalConfig !== undefined)) {
    throw new Error('Usage: ludd run [configPath] [-c|--config path] [-r|--run-id id] [-w|--workspace dir] [-s|--stream]')
  }
  const configPath = values.config ?? positionalConfig
  const status = await runCommand({
    ...(configPath !== undefined
      ? { configPath }
      : {}),
    ...(values['run-id'] !== undefined
      ? { runId: values['run-id'] }
      : {}),
    ...(values.workspace !== undefined
      ? { workspace: values.workspace }
      : {}),
    ...(values.stream
      ? { stream: true }
      : {}),
  })
  process.exitCode = status
}

main().catch((error: unknown) => {
  console.error(error instanceof Error
    ? error.message
    : String(error))
  process.exitCode = 1
})
