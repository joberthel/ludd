import type { ArtifactValidationIssue } from '../types/artifact.js'
import { describe, expect, it } from 'vitest'
import { StepArtifactValidationError } from './step-artifact-validation-error.js'

describe('stepArtifactValidationError instance and properties', () => {
  it('instantiates correctly and preserves stepId, issues, and name', () => {
    const issues: ArtifactValidationIssue[] = [
      {
        artifactKey: 'spec.md',
        message: 'Artifact "spec.md" was not created.',
      },
    ]
    const error = new StepArtifactValidationError('triage-step', issues)

    expect(error).toBeInstanceOf(Error)
    expect(error).toBeInstanceOf(StepArtifactValidationError)
    expect(error.name).toBe('StepArtifactValidationError')
    expect(error.stepId).toBe('triage-step')
    expect(error.issues).toEqual(issues)
    expect(error.message).toBe(
      'Step "triage-step" artifact validation failed: spec.md: Artifact "spec.md" was not created.',
    )
  })

  it('formats empty issues list gracefully', () => {
    const error = new StepArtifactValidationError('empty-step', [])
    expect(error.message).toBe('Step "empty-step" artifact validation failed.')
    expect(error.issues).toEqual([])
  })
})

describe('stepArtifactValidationError issue path formatting', () => {
  it('formats issues with path including numbers and strings', () => {
    const issues: ArtifactValidationIssue[] = [
      {
        artifactKey: 'todos.json',
        path: ['slices', 0, 'title'],
        message: 'Expected string, received number',
      },
      {
        artifactKey: 'todos.json',
        path: [],
        message: 'Expected array',
      },
    ]
    const error = new StepArtifactValidationError('plan-step', issues)

    expect(error.message).toBe(
      'Step "plan-step" artifact validation failed: todos.json (slices.0.title): Expected string, received number; todos.json: Expected array',
    )
  })

  it('formats multiple issues across different artifact keys joined with semicolon', () => {
    const issues: ArtifactValidationIssue[] = [
      {
        artifactKey: 'spec.md',
        message: 'Artifact "spec.md" must be non-empty.',
      },
      {
        artifactKey: 'todos.json',
        message: 'Artifact "todos.json" was not created.',
      },
    ]
    const error = new StepArtifactValidationError('spec-step', issues)

    expect(error.message).toBe(
      'Step "spec-step" artifact validation failed: spec.md: Artifact "spec.md" must be non-empty.; todos.json: Artifact "todos.json" was not created.',
    )
  })
})
