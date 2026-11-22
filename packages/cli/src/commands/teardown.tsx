import { argument, option } from 'pastel'
import { useCallback } from 'react'
import { z } from 'zod'
import { teardownCommand } from '../actions/teardown-command.js'
import { CommandRunner } from '../ui/command-runner.js'

export const description = 'Tear down provisioned environments for a run'

export const args = z.tuple([
  z.string().describe(argument({
    name: 'run-id',
    description: 'Run identifier to tear down',
  })),
])

export const options = z.object({
  workspace: z.string().optional().describe(option({
    alias: 'w',
    description: 'Workspace directory',
  })),
  force: z.boolean().optional().describe(option({
    description: 'Force teardown even if environments are busy',
  })),
})

export interface TeardownProps {
  args: z.infer<typeof args>
  options: z.infer<typeof options>
}

export default function Teardown({ args: [runId], options: opts }: TeardownProps) {
  const execute = useCallback(async () => teardownCommand({
    runId,
    ...(opts.workspace !== undefined
      ? { workspace: opts.workspace }
      : {}),
    ...(opts.force
      ? { force: true }
      : {}),
  }), [runId, opts.force, opts.workspace])

  return <CommandRunner execute={execute} spinnerLabel={`Tearing down run ${runId}...`} />
}
