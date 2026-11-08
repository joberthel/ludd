import type { z } from 'zod'

function getIssuePath(issue: z.core.$ZodIssue): string {
  if (issue.path.length === 0) {
    return '<root>'
  }
  return issue.path.join('.')
}

function formatErrorMessage(stepId: string, issues: readonly z.core.$ZodIssue[]): string {
  if (issues.length === 0) {
    return `Step "${stepId}" output validation failed.`
  }
  const summary = issues
    .map((issue) => {
      const path = getIssuePath(issue)
      return `${path}: ${issue.message}`
    })
    .join('; ')
  return `Step "${stepId}" output validation failed: ${summary}`
}

export class StepOutputValidationError extends Error {
  readonly stepId: string
  readonly rawOutput: unknown
  readonly issues: z.core.$ZodIssue[]

  constructor(stepId: string, rawOutput: unknown, issues: z.core.$ZodIssue[]) {
    super(formatErrorMessage(stepId, issues))
    this.name = 'StepOutputValidationError'
    this.stepId = stepId
    this.rawOutput = rawOutput
    this.issues = issues
  }
}
