import type { ProvisionedEnvironment } from '../types/environment.js'
import type { CleanupPolicy, HarnessRunResult } from '../types/harness.js'
import { teardownRun } from './teardown-run.js'

export async function applyCleanupPolicy(
  policy: CleanupPolicy | undefined,
  result: HarnessRunResult,
  runId: string,
  workspaceDir: string,
  environments?: Record<string, ProvisionedEnvironment>,
): Promise<void> {
  const onSuccess = policy?.onSuccess ?? 'keep'
  const onFailure = policy?.onFailure ?? 'keep'

  const shouldDestroy = (result.status === 'passed' && onSuccess === 'destroy')
    || (result.status === 'failed' && onFailure === 'destroy')

  if (shouldDestroy) {
    await teardownRun(runId, { workspaceDir, force: true, environments })
  }
}
