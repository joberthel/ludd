import { argument, option } from 'pastel'
import { useCallback } from 'react'
import { z } from 'zod'
import { gateCommand } from '../actions/gate-command.js'
import { CommandRunner } from '../ui/command-runner.js'

export const description = 'Resolve an active gate for a running workflow'

export const args = z.tuple([
  z.string().describe(argument({
    name: 'run-id',
    description: 'Run identifier waiting at a gate',
  })),
])

export const options = z.object({
  workspace: z.string().optional().describe(option({
    alias: 'w',
    description: 'Workspace directory',
  })),
  action: z.enum([
    'pass',
    'fail',
    'retry',
    'skip',
    'abort',
    'answer',
  ]).optional().describe(option({
    description: 'Gate resolution action',
  })),
  feedback: z.string().optional().describe(option({
    description: 'Feedback message for the gate',
  })),
  addRetries: z.number().int().positive().optional().describe(option({
    description: 'Additional retries to grant',
  })),
  answer: z.string().optional().describe(option({
    description: 'Answer value for a waiting interactive user question',
  })),
})

export interface GateProps {
  args: z.infer<typeof args>
  options: z.infer<typeof options>
}

export default function Gate({ args: [runId], options: opts }: GateProps) {
  const execute = useCallback(async () => gateCommand({
    runId,
    ...(opts.workspace !== undefined
      ? { workspace: opts.workspace }
      : {}),
    ...(opts.action !== undefined
      ? { action: opts.action }
      : {}),
    ...(opts.feedback !== undefined
      ? { feedback: opts.feedback }
      : {}),
    ...(opts.addRetries !== undefined
      ? { addRetries: opts.addRetries }
      : {}),
    ...(opts.answer !== undefined
      ? { answer: opts.answer }
      : {}),
  }), [
    runId,
    opts.action,
    opts.addRetries,
    opts.answer,
    opts.feedback,
    opts.workspace,
  ])

  return <CommandRunner execute={execute} />
}
