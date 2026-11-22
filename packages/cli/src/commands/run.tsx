import { argument, option } from 'pastel'
import { useCallback } from 'react'
import { z } from 'zod'
import { runCommand } from '../actions/run-command.js'
import { CommandRunner } from '../ui/command-runner.js'

export const description = 'Start a new workflow run'

export const args = z.tuple([
  z.string().optional().describe(argument({
    name: 'config-path',
    description: 'Path to harness config file',
  })),
])

export const options = z.object({
  config: z.string().optional().describe(option({
    alias: 'c',
    description: 'Path to harness config file',
  })),
  runId: z.string().optional().describe(option({
    alias: 'r',
    description: 'Explicit run identifier',
  })),
  workspace: z.string().optional().describe(option({
    alias: 'w',
    description: 'Workspace directory',
  })),
  stream: z.boolean().optional().describe(option({
    alias: 's',
    description: 'Stream raw JSONL agent events',
  })),
  detach: z.boolean().optional().describe(option({
    alias: 'd',
    description: 'Run detached in the background',
  })),
})

export interface RunProps {
  args: z.infer<typeof args>
  options: z.infer<typeof options>
}

export default function Run({ args: [positionalConfig], options: opts }: RunProps) {
  const execute = useCallback(async () => {
    if (opts.config !== undefined && positionalConfig !== undefined) {
      throw new Error('Specify either a positional config path or --config, not both.')
    }
    const configPath = opts.config ?? positionalConfig
    return runCommand({
      ...(configPath !== undefined
        ? { configPath }
        : {}),
      ...(opts.runId !== undefined
        ? { runId: opts.runId }
        : {}),
      ...(opts.workspace !== undefined
        ? { workspace: opts.workspace }
        : {}),
      ...(opts.stream
        ? { stream: true }
        : {}),
      ...(opts.detach
        ? { detach: true }
        : {}),
    })
  }, [
    positionalConfig,
    opts.config,
    opts.detach,
    opts.runId,
    opts.stream,
    opts.workspace,
  ])

  return <CommandRunner execute={execute} dashboard={!opts.stream && !opts.detach} />
}
