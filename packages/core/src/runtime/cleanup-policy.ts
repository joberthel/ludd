import type { ProvisionedEnvironment } from '../types/environment.js'
import type { CleanupPolicy, HarnessRunResult } from '../types/harness.js'
import { appendLedgerEvent } from '../persistence/ledger-writer.js'
import { readRunState, resolveRunDir, writeRunStateAtomic } from '../persistence/state-store.js'

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

  if (!shouldDestroy) {
    return
  }

  const envList = Object.values(environments ?? {})
  await Promise.all(envList.map(async env => env.teardown()))

  const runDir = resolveRunDir(workspaceDir, runId)
  const snapshot = readRunState(runDir)
  appendLedgerEvent(runDir, {
    schemaVersion: 1,
    timestamp: new Date().toISOString(),
    runId,
    stepId: null,
    eventType: 'run.teardown',
    payload: {
      environments: envList.map(env => env.id),
      forced: true,
    },
  })
  snapshot.environments = {}
  snapshot.updatedAt = new Date().toISOString()
  writeRunStateAtomic(runDir, snapshot)
}
