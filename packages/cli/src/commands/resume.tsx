import { argument, option } from 'pastel'
import { useCallback } from 'react'
import { z } from 'zod'
import { resumeCommand } from '../actions/resume-command.js'
import { CommandRunner } from '../ui/command-runner.js'

export const description = 'Resume a previously interrupted or gated run'

export const args = z.tuple([
  z.string().describe(argument({
    name: 'run-id',
    description: 'Run identifier to resume',
  })),
])

export const options = z.object({
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
    description: 'Resume detached in the background',
  })),
  autoExit: z.boolean().optional().describe(option({
    description: 'Exit the dashboard automatically when the run finishes or fails',
  })),
})

export interface ResumeProps {
  args: z.infer<typeof args>
  options: z.infer<typeof options>
}

export default function Resume({ args: [runId], options: opts }: ResumeProps) {
  const execute = useCallback(async () => resumeCommand({
    runId,
    ...(opts.workspace !== undefined
      ? { workspace: opts.workspace }
      : {}),
    ...(opts.stream
      ? { stream: true }
      : {}),
    ...(opts.detach
      ? { detach: true }
      : {}),
  }), [
    runId,
    opts.detach,
    opts.stream,
    opts.workspace,
  ])

  return (
    <CommandRunner
      execute={execute}
      dashboard={!opts.stream && !opts.detach}
      keepOpen={!opts.autoExit}
    />
  )
}
