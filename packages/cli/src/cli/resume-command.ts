import process from 'node:process'
import { resumeCommand } from '../commands/resume-command.js'
import { flag, parse, text } from './parse-args.js'

export async function cliResumeCommand(args: string[]): Promise<void> {
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
}
