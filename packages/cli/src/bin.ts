#!/usr/bin/env node
import type { ParseArgsConfig } from 'node:util'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { parseArgs } from 'node:util'
import { abortCommand } from './commands/abort-command.js'
import { gateCommand } from './commands/gate-command.js'
import { gcCommand } from './commands/gc-command.js'
import { resumeCommand } from './commands/resume-command.js'
import { runCommand } from './commands/run-command.js'
import { statusCommand } from './commands/status-command.js'
import { teardownCommand } from './commands/teardown-command.js'

function parse(args: string[], options: ParseArgsConfig['options']): { values: Record<string, string | boolean | undefined>, positionals: string[] } {
  return parseArgs({
    args,
    options,
    allowPositionals: true,
    strict: true,
  })
}
function text(values: Record<string, string | boolean | undefined>, name: string): string | undefined {
  const value = values[name]
  return typeof value === 'string'
    ? value
    : undefined
}
function flag(values: Record<string, string | boolean | undefined>, name: string): boolean {
  return values[name] === true
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2)
  if (command === '__worker') {
    const { values, positionals } = parse(args, {
      'config': { type: 'string' },
      'run-id': { type: 'string' },
      'workspace': { type: 'string' },
    })
    const configPath = text(values, 'config')
    const runId = text(values, 'run-id')
    const rawWorkspace = text(values, 'workspace')
    if (positionals.length > 0 || configPath === undefined || runId === undefined || rawWorkspace === undefined)
      throw new Error('Invalid internal worker arguments.')
    const workspace = path.resolve(rawWorkspace)
    const stateFile = path.join(workspace, '.harness', 'runs', runId, 'state.json')
    process.exitCode = fs.existsSync(stateFile)
      ? await resumeCommand({ runId, workspace, worker: true })
      : await runCommand({
          runId,
          workspace,
          configPath,
          worker: true,
        })
    return
  }
  if (command === 'run') {
    const { values, positionals } = parse(args, {
      'config': { type: 'string', short: 'c' },
      'run-id': { type: 'string', short: 'r' },
      'workspace': { type: 'string', short: 'w' },
      'stream': { type: 'boolean', short: 's' },
      'detach': { type: 'boolean', short: 'd' },
    })
    const config = text(values, 'config')
    if (positionals.length > 1 || (config !== undefined && positionals.length))
      throw new Error('Usage: ludd run [configPath] [-c|--config path] [-r|--run-id id] [-w|--workspace dir] [-s|--stream] [-d|--detach]')
    process.exitCode = await runCommand({
      ...((config ?? positionals[0]) !== undefined
        ? { configPath: config ?? positionals[0] }
        : {}),
      ...(text(values, 'run-id') !== undefined
        ? {
            runId: text(values, 'run-id'),
          }
        : {}),
      ...(text(values, 'workspace') !== undefined
        ? {
            workspace: text(values, 'workspace'),
          }
        : {}),
      ...(flag(values, 'stream')
        ? { stream: true }
        : {}),
      ...(flag(values, 'detach')
        ? { detach: true }
        : {}),
    })
    return
  }
  if (command === 'resume') {
    const { values, positionals } = parse(args, {
      workspace: { type: 'string', short: 'w' },
      stream: { type: 'boolean', short: 's' },
      detach: { type: 'boolean', short: 'd' },
    })
    if (positionals.length !== 1)
      throw new Error('Usage: ludd resume <run-id> [-w|--workspace dir] [-s|--stream] [-d|--detach]')
    process.exitCode = await resumeCommand({
      runId: positionals[0],
      ...(text(values, 'workspace') !== undefined
        ? {
            workspace: text(values, 'workspace'),
          }
        : {}),
      ...(flag(values, 'stream')
        ? { stream: true }
        : {}),
      ...(flag(values, 'detach')
        ? { detach: true }
        : {}),
    })
    return
  }
  if (command === 'status') {
    const { values, positionals } = parse(args, {
      workspace: { type: 'string', short: 'w' },
      json: { type: 'boolean' },
    })
    if (positionals.length > 1)
      throw new Error('Usage: ludd status [runId] [--json] [-w|--workspace dir]')
    process.exitCode = await statusCommand({
      ...(positionals[0] !== undefined
        ? { runId: positionals[0] }
        : {}),
      ...(text(values, 'workspace') !== undefined
        ? {
            workspace: text(values, 'workspace'),
          }
        : {}),
      ...(flag(values, 'json')
        ? { json: true }
        : {}),
    })
    return
  }
  if (command === 'abort') {
    const { values, positionals } = parse(args, {
      workspace: { type: 'string', short: 'w' },
      reason: { type: 'string' },
      teardown: { type: 'boolean' },
    })
    if (positionals.length !== 1)
      throw new Error('Usage: ludd abort <runId> [--reason text] [--teardown] [-w|--workspace dir]')
    process.exitCode = await abortCommand({
      runId: positionals[0],
      ...(text(values, 'workspace') !== undefined
        ? {
            workspace: text(values, 'workspace'),
          }
        : {}),
      ...(text(values, 'reason') !== undefined
        ? {
            reason: text(values, 'reason'),
          }
        : {}),
      ...(flag(values, 'teardown')
        ? { teardown: true }
        : {}),
    })
    return
  }
  if (command === 'teardown') {
    const { values, positionals } = parse(args, {
      workspace: { type: 'string', short: 'w' },
      force: { type: 'boolean' },
    })
    if (positionals.length !== 1)
      throw new Error('Usage: ludd teardown <runId> [--force] [-w|--workspace dir]')
    process.exitCode = await teardownCommand({
      runId: positionals[0],
      ...(text(values, 'workspace') !== undefined
        ? {
            workspace: text(values, 'workspace'),
          }
        : {}),
      ...(flag(values, 'force')
        ? { force: true }
        : {}),
    })
    return
  }
  if (command === 'gc') {
    const { values, positionals } = parse(args, {
      'workspace': { type: 'string', short: 'w' },
      'run-id': { type: 'string', multiple: true },
      'older-than': { type: 'string' },
      'status': { type: 'string', multiple: true },
      'dry-run': { type: 'boolean' },
    })
    const ids = values['run-id']
    const runIds = [
      ...(positionals),
      ...(Array.isArray(ids)
        ? ids
        : (typeof ids === 'string'
            ? [ids]
            : [])),
    ]
    process.exitCode = await gcCommand({
      ...(runIds.length
        ? { runId: runIds }
        : {}),
      ...(text(values, 'workspace') !== undefined
        ? {
            workspace: text(values, 'workspace'),
          }
        : {}),
      ...(text(values, 'older-than') !== undefined
        ? {
            olderThan: text(values, 'older-than'),
          }
        : {}),
      ...(Array.isArray(values.status)
        ? { status: values.status }
        : (typeof values.status === 'string'
            ? {
                status: [values.status],
              }
            : {})),
      ...(flag(values, 'dry-run')
        ? { dryRun: true }
        : {}),
    })
    return
  }
  if (command === 'gate') {
    const { values, positionals } = parse(args, {
      'workspace': { type: 'string', short: 'w' },
      'action': { type: 'string' },
      'feedback': { type: 'string' },
      'add-retries': { type: 'string' },
    })
    const action = text(values, 'action')
    const actions = [
      'pass',
      'fail',
      'retry',
      'skip',
      'abort',
    ]
    if (positionals.length !== 1 || (action !== undefined && !actions.includes(action)))
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
        ? { action: action as 'pass' | 'fail' | 'retry' | 'skip' | 'abort' }
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
    return
  }
  throw new Error('Usage: ludd run ... | ludd resume <run-id> ... | ludd status [runId] [--json] | ludd abort <runId> ... | ludd teardown <runId> ... | ludd gc [runId ...] ... | ludd gate <runId> ...')
}

main().catch((error: unknown) => {
  console.error(error instanceof Error
    ? error.message
    : String(error))
  process.exitCode = 1
})
