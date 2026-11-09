import type { ArtifactValidationIssue } from '../types/artifact.js'

function formatIssue(issue: ArtifactValidationIssue): string {
  if (issue.path !== undefined && issue.path.length > 0) {
    const formattedPath = issue.path.map(String).join('.')
    return `${issue.artifactKey} (${formattedPath}): ${issue.message}`
  }
  return `${issue.artifactKey}: ${issue.message}`
}

function formatErrorMessage(stepId: string, issues: readonly ArtifactValidationIssue[]): string {
  if (issues.length === 0) {
    return `Step "${stepId}" artifact validation failed.`
  }
  const summary = issues.map(formatIssue).join('; ')
  return `Step "${stepId}" artifact validation failed: ${summary}`
}

export class StepArtifactValidationError extends Error {
  readonly stepId: string
  readonly issues: readonly ArtifactValidationIssue[]

  constructor(stepId: string, issues: readonly ArtifactValidationIssue[]) {
    super(formatErrorMessage(stepId, issues))
    this.name = 'StepArtifactValidationError'
    this.stepId = stepId
    this.issues = issues
  }
}
