export { defineHarness, validateHarnessConfig } from './define-harness.js'

export { HarnessConfigError } from './errors/harness-config-error.js'

export type {
  ArtifactClient,
  DynamicProperty,
  MatrixCursor,
  ProvisionedEnvironment,
  StepContext,
  StepResult,
  StepStatus,
} from './types/context.js'
export type {
  AgentRunner,
  CleanupPolicy,
  CleanupPolicyAction,
  HarnessConfig,
  StepConfig,
  StepRunFn,
} from './types/harness.js'
export { isAgentRunner } from './types/harness.js'
export { resolveDynamicProperty } from './utils/resolve-dynamic-property.js'
