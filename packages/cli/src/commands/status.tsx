import { argument, option } from 'pastel'
import { useCallback } from 'react'
import { z } from 'zod'
import { statusCommand } from '../actions/status-command.js'
import { CommandRunner } from '../ui/command-runner.js'

export const description = 'Show workflow runs or detailed status for a run'

export const args = z.tuple([
  z.string().optional().describe(argument({
    name: 'run-id',
    description: 'Optional run identifier for detailed view',
  })),
])

export const options = z.object({
  workspace: z.string().optional().describe(option({
    alias: 'w',
    description: 'Workspace directory',
  })),
  json: z.boolean().optional().describe(option({
    description: 'Output machine-readable JSON',
  })),
})

export interface StatusProps {
  args: z.infer<typeof args>
  options: z.infer<typeof options>
}

export default function Status({ args: [runId], options: opts }: StatusProps) {
  const execute = useCallback(async () => statusCommand({
    ...(runId !== undefined
      ? { runId }
      : {}),
    ...(opts.workspace !== undefined
      ? { workspace: opts.workspace }
      : {}),
    ...(opts.json
      ? { json: true }
      : {}),
  }), [runId, opts.json, opts.workspace])

  return <CommandRunner execute={execute} />
}
