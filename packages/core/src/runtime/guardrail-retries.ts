import type { RunStateSnapshot } from '../types/state.js'
import { writeRunStateAtomic } from '../persistence/state-store.js'

export function clearActiveGuardrailRetries(runDir: string, snapshot: RunStateSnapshot): void {
  if (snapshot.activeGuardrailRetries !== undefined) {
    snapshot.activeGuardrailRetries = undefined
    snapshot.updatedAt = new Date().toISOString()
    writeRunStateAtomic(runDir, snapshot)
  }
}

export function checkGuardrailRetries(
  snapshot: RunStateSnapshot,
  k: number,
  runDir: string,
): number {
  if (!snapshot.activeGuardrailRetries) {
    snapshot.activeGuardrailRetries = {}
  }
  const key = String(k)
  const count = (snapshot.activeGuardrailRetries[key] ?? 0) + 1
  snapshot.activeGuardrailRetries[key] = count
  snapshot.updatedAt = new Date().toISOString()
  writeRunStateAtomic(runDir, snapshot)
  return count
}
