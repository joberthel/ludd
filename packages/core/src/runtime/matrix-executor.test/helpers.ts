import type { ArtifactClient, StepContext } from '../../types/context.js'
import type { RunStateSnapshot } from '../../types/state.js'
import { vi } from 'vitest'

export function createFakeArtifactClient(artifacts: Record<string, string | null> = {}): ArtifactClient {
  return {
    get: vi.fn(async (key: string) => artifacts[key] ?? null),
    put: vi.fn(async () => {}),
    getJson: async <T>(key: string): Promise<T | null> => {
      const val = artifacts[key]
      if (val === null || val === undefined) {
        return null
      }
      return JSON.parse(val) as T
    },
    has: vi.fn(async (key: string) => artifacts[key] !== undefined && artifacts[key] !== null),
  }
}

export function createDummyContext(artifacts: Record<string, string | null> = {}): StepContext {
  return {
    runId: 'r-matrix-test',
    environments: {},
    steps: {},
    step: { id: 'step-matrix', output: undefined, attempt: 1 },
    matrix: undefined,
    artifacts: createFakeArtifactClient(artifacts),
  }
}

export function createDummySnapshot(): RunStateSnapshot {
  return {
    schemaVersion: 1,
    runId: 'r-matrix-test',
    harnessName: 'test-harness',
    workflowName: 'test-harness',
    status: 'running',
    activeStepId: 'step-matrix',
    activeSessionId: null,
    activeStepAttempt: 1,
    activeMatrixIndex: null,
    activeMatrixOutputs: [],
    steps: {},
    updatedAt: new Date().toISOString(),
  }
}
