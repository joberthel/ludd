import { argument, option } from 'pastel'
import { useCallback } from 'react'
import { z } from 'zod'
import { gcCommand } from '../actions/gc-command.js'
import { CommandRunner } from '../ui/command-runner.js'

export const description = 'Garbage-collect completed or stale workflow runs'

export const args = z.array(z.string()).optional().describe(argument({
  name: 'run-id',
  description: 'Run identifiers to garbage-collect',
}))

export const options = z.object({
  workspace: z.string().optional().describe(option({
    alias: 'w',
    description: 'Workspace directory',
  })),
  runId: z.array(z.string()).optional().describe(option({
    description: 'Run identifiers to garbage-collect',
  })),
  olderThan: z.string().optional().describe(option({
    description: 'Clean runs older than duration (e.g. 24h)',
  })),
  status: z.array(z.string()).optional().describe(option({
    description: 'Filter runs by status',
  })),
  dryRun: z.boolean().optional().describe(option({
    description: 'Preview runs to clean without deleting',
  })),
})

export interface GcProps {
  args: z.infer<typeof args>
  options: z.infer<typeof options>
}

export default function Gc({ args: positionalRunIds, options: opts }: GcProps) {
  const execute = useCallback(async () => {
    const runIds = [
      ...(positionalRunIds ?? []),
      ...(opts.runId ?? []),
    ]
    return gcCommand({
      ...(runIds.length > 0
        ? { runId: runIds }
        : {}),
      ...(opts.workspace !== undefined
        ? { workspace: opts.workspace }
        : {}),
      ...(opts.olderThan !== undefined
        ? { olderThan: opts.olderThan }
        : {}),
      ...(opts.status !== undefined
        ? { status: opts.status }
        : {}),
      ...(opts.dryRun
        ? { dryRun: true }
        : {}),
    })
  }, [
    positionalRunIds,
    opts.dryRun,
    opts.olderThan,
    opts.runId,
    opts.status,
    opts.workspace,
  ])

  return <CommandRunner execute={execute} spinnerLabel="Running garbage collection..." />
}
