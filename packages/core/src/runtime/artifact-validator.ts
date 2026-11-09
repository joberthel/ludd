import type { ArtifactClient, ArtifactValidationIssue, ArtifactValidationRule } from '../types/artifact.js'
import { StepArtifactValidationError } from '../errors/step-artifact-validation-error.js'

export function formatArtifactRetryPrompt(
  initialPrompt: string,
  issues: readonly ArtifactValidationIssue[],
): string {
  const formatted = issues.map((i) => {
    const p = i.path !== undefined && i.path.length > 0
      ? ` (${i.path.map(String).join('.')})`
      : ''
    return `- [${i.artifactKey}${p}]: ${i.message}`
  }).join('\n')
  return `The step artifacts failed validation:\n${formatted}\n\nPlease create or update the required artifacts with valid content.\n\nOriginal instruction:\n${initialPrompt}`
}

async function validateArtifactSchema(
  artifactKey: string,
  schema: NonNullable<ArtifactValidationRule['schema']>,
  content: string,
  issues: ArtifactValidationIssue[],
): Promise<void> {
  let parsedJson: unknown
  try {
    parsedJson = JSON.parse(content)
  }
  catch (parseErr: unknown) {
    const parseMsg = parseErr instanceof Error
      ? parseErr.message
      : String(parseErr)
    issues.push({
      artifactKey,
      message: `Artifact "${artifactKey}" is not valid JSON: ${parseMsg}`,
    })
    return
  }

  const parsed = await schema.safeParseAsync(parsedJson)
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      issues.push({
        artifactKey,
        path: issue.path,
        message: issue.message,
      })
    }
  }
}

async function validateSingleArtifact(
  artifactKey: string,
  rule: ArtifactValidationRule,
  artifactClient: ArtifactClient,
  issues: ArtifactValidationIssue[],
): Promise<void> {
  const content = await artifactClient.get(artifactKey)
  if (content === null) {
    issues.push({ artifactKey, message: `Artifact "${artifactKey}" was not created.` })
    return
  }

  if (rule.nonEmpty === true && content.trim() === '') {
    issues.push({ artifactKey, message: `Artifact "${artifactKey}" must be non-empty.` })
    return
  }

  if (rule.schema !== undefined) {
    await validateArtifactSchema(artifactKey, rule.schema, content, issues)
  }

  if (rule.validate !== undefined) {
    const isValid = await rule.validate(content)
    if (!isValid) {
      issues.push({ artifactKey, message: `Artifact "${artifactKey}" failed custom validation.` })
    }
  }
}

export async function validateStepArtifacts(
  stepId: string,
  artifactsConfig: Record<string, ArtifactValidationRule> | undefined,
  artifactClient: ArtifactClient,
): Promise<void> {
  if (artifactsConfig === undefined) {
    return
  }

  const issues: ArtifactValidationIssue[] = []
  for (const [artifactKey, rule] of Object.entries(artifactsConfig)) {
    await validateSingleArtifact(artifactKey, rule, artifactClient, issues)
  }

  if (issues.length > 0) {
    throw new StepArtifactValidationError(stepId, issues)
  }
}
