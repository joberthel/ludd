import { argument, option } from 'pastel'
import { useCallback } from 'react'
import { z } from 'zod'
import { abortCommand } from '../actions/abort-command.js'
import { CommandRunner } from '../ui/command-runner.js'

export const description = 'Abort an active workflow run'

export const args = z.tuple([
  z.string().describe(argument({
    name: 'run-id',
    description: 'Run identifier to abort',
  })),
])

export const options = z.object({
  workspace: z.string().optional().describe(option({
    alias: 'w',
    description: 'Workspace directory',
  })),
  reason: z.string().optional().describe(option({
    description: 'Reason for aborting the run',
  })),
  teardown: z.boolean().optional().describe(option({
    description: 'Also tear down provisioned environments',
  })),
})

export interface AbortProps {
  args: z.infer<typeof args>
  options: z.infer<typeof options>
}

export default function Abort({ args: [runId], options: opts }: AbortProps) {
  const execute = useCallback(async () => abortCommand({
    runId,
    ...(opts.workspace !== undefined
      ? { workspace: opts.workspace }
      : {}),
    ...(opts.reason !== undefined
      ? { reason: opts.reason }
      : {}),
    ...(opts.teardown
      ? { teardown: true }
      : {}),
  }), [
    runId,
    opts.reason,
    opts.teardown,
    opts.workspace,
  ])

  return <CommandRunner execute={execute} spinnerLabel={`Aborting run ${runId}...`} />
}
