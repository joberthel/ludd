export { defineHarness, validateHarnessConfig } from './define-harness.js'
export { EnvironmentUnreachableError } from './errors/environment-unreachable-error.js'
export { ForbiddenMountPathError } from './errors/forbidden-mount-path-error.js'
export { GuardrailMaxRetriesExceededError } from './errors/guardrail-max-retries-exceeded-error.js'
export { HarnessConfigError } from './errors/harness-config-error.js'
export { HarnessConfigLoadError, type HarnessConfigLoadErrorOptions } from './errors/harness-config-load-error.js'
export { JsonRpcResponseError } from './errors/json-rpc-response-error.js'
export {
  DEFAULT_MAX_TOTAL_TURNS,
  MaxTotalTurnsExceededError,
} from './errors/max-total-turns-exceeded-error.js'
export { RunAlreadyActiveError } from './errors/run-already-active-error.js'
export { SchemaVersionMismatchError } from './errors/schema-version-mismatch-error.js'
export { StepArtifactValidationError } from './errors/step-artifact-validation-error.js'
export { StepMatrixResolutionError } from './errors/step-matrix-resolution-error.js'
export { StepOutputValidationError } from './errors/step-output-validation-error.js'
export { UnsafeDangerModeError } from './errors/unsafe-danger-mode-error.js'
export { createControlClient } from './ipc/control-client.js'
export { startControlServer } from './ipc/control-server.js'
export {
  createGateResolveHandler,
  type GateResolveHandlerContext,
  validateGateResolveParams,
} from './ipc/gate-resolve-handler.js'
export {
  createRunAbortHandler,
  createRunTeardownHandler,
  type RunControlHandlerContext,
  validateRunAbortParams,
  validateRunTeardownParams,
} from './ipc/run-control-handlers.js'
export { CONTROL_SOCKET_NAME, getControlSocketPath } from './ipc/socket-path.js'
export { loadHarnessConfig } from './loader/load-harness-config.js'
export {
  createArtifactStore,
} from './mcp/artifact-store.js'
export {
  createLogStore,
  offloadGuardrailLog,
  sanitizeLogKey,
} from './mcp/log-store.js'
export { startEmbeddedMcpServer } from './mcp/mcp-server.js'
export { appendLedgerEvent, readLedgerEvents } from './persistence/ledger-writer.js'
export {
  acquireRunPidLock,
  isProcessAlive,
  releaseRunPidLock,
  RUNNER_PID_FILE,
} from './persistence/pid-lock.js'
export {
  readRunState,
  resolveRunDir,
  SUPPORTED_SCHEMA_VERSION,
  writeRunStateAtomic,
} from './persistence/state-store.js'
export {
  appendStreamEvent,
  readStreamEvents,
  resolveStreamPath,
} from './persistence/stream-writer.js'
export {
  createAgentStepOutput,
  executeAgentStep,
  formatRetryPrompt,
  type RehydratedAgentState,
  validateStepOutput,
} from './runtime/agent-executor.js'
export {
  formatArtifactRetryPrompt,
  validateStepArtifacts,
} from './runtime/artifact-validator.js'
export {
  type BeforeStepExecutionResult,
  formatBeforeStepNotification,
  runBeforeStepGuardrails,
  type RunBeforeStepGuardrailsParams,
} from './runtime/before-step-executor.js'
export {
  createDefaultHostEnvironment,
  createDockerWorktreeEnvironmentFromDescriptor,
  createGitWorktreeEnvironmentFromDescriptor,
  createHostEnvironmentFromDescriptor,
  recordEnvironment,
  rehydrateEnvironmentsAndCheckHealth,
  type RehydrateEnvironmentsParams,
  resolveGuardrailEnvironment,
  resolveStepEnvironment,
} from './runtime/environment-manager.js'
export {
  determineEscalationPolicy,
  type EscalationReason,
  formatEscalationPrompt,
  handleGuardrailEscalation,
} from './runtime/escalation-manager.js'
export {
  createGateWaiter,
  type GateWaiter,
} from './runtime/gate-waiter.js'
export {
  gc,
  type GcOptions,
  type GcResult,
} from './runtime/gc-runs.js'
export {
  formatGuardrailRetryPrompt,
  GuardrailRetrySignal,
  runAfterStepGuardrails,
} from './runtime/guardrail-executor.js'
export {
  executeMatrixStep,
  resolveMatrixItems,
} from './runtime/matrix-executor.js'
export { type HarnessRunResult, runHarness, type RunHarnessOptions } from './runtime/run-harness.js'
export {
  teardownRun,
  type TeardownRunOptions,
  type TeardownRunResult,
} from './runtime/teardown-run.js'
export type {
  AgentAccessMode,
  AgentRunner,
  AgentStepOutput,
  AgentTurnInput,
  AgentTurnResult,
} from './types/agent.js'
export type {
  ArtifactClient,
  ArtifactValidationIssue,
  ArtifactValidationRule,
  EmbeddedMcpServer,
} from './types/artifact.js'
export type {
  DynamicProperty,
  MatrixCursor,
  StepContext,
  StepResult,
  StepStatus,
} from './types/context.js'
export {
  type EnvironmentAdapter,
  type EnvironmentExecOptions,
  type EnvironmentExecResult,
  isEnvironmentAdapter,
  isProvisionedEnvironment,
  type ProvisionContext,
  type ProvisionedEnvironment,
} from './types/environment.js'

export {
  type ExecLogPaginationConfig,
  type ExecLogPaginationSelector,
  type Guardrail,
  type GuardrailExecutionInput,
  type GuardrailPhase,
  type GuardrailStatus,
  type GuardrailVerdict,
  isGuardrail,
  type OnMaxRetriesExceededAction,
} from './types/guardrail.js'
export {
  type AccumulateArtifactItemMap,
  type AccumulatePriorSteps,
  type ArtifactMatrixStepDef,
  type CleanupPolicy,
  type CleanupPolicyAction,
  type DerivedStepContext,
  type HarnessConfig,
  type InferArrayItem,
  type InferMatrixItem,
  type InferSingleStepOutput,
  type InferStepOutput,
  isAgentRunner,
  type ItemsMatrixStepDef,
  type MatrixArtifactConfig,
  type MatrixConfig,
  type MatrixItemsConfig,
  type PlainStepDef,
  type PriorStepContext,
  type StepArtifactItemMap,
  type StepConfig,
  type StepHasMatrix,
  type StepRunFn,
  type StepTupleEntry,
  type TypedStep,
} from './types/harness.js'
export {
  type ControlClient,
  type ControlRpcHandlers,
  type ControlServer,
  type GateAction,
  type GateResolveParams,
  type GateResolveResult,
  JSON_RPC_ERRORS,
  JSON_RPC_INTERNAL_ERROR,
  JSON_RPC_INVALID_PARAMS,
  JSON_RPC_INVALID_REQUEST,
  JSON_RPC_METHOD_NOT_FOUND,
  JSON_RPC_PARSE_ERROR,
  type JsonRpcError,
  type JsonRpcErrorResponse,
  type JsonRpcId,
  type JsonRpcRequest,
  type JsonRpcResponse,
  type JsonRpcSuccessResponse,
  type RunAbortParams,
  type RunAbortResult,
  type RunTeardownParams,
  type RunTeardownResult,
} from './types/ipc.js'
export type { LedgerEvent, LedgerEventType } from './types/ledger.js'
export type {
  LogFormat,
  LogMetadata,
  LogStore,
  OffloadLogOptions,
  ReadLogLinesResult,
  ReadLogPageJsonResult,
  ReadLogPageResult,
  ReadLogPageTextResult,
  SearchLogMatch,
  SearchLogResult,
} from './types/log.js'
export type { ActiveGateState, EnvironmentDescriptor, RunStateSnapshot, RunStatus } from './types/state.js'
export type { AgentStreamEvent, AgentStreamEventType } from './types/stream.js'
export { resolveDynamicProperty } from './utils/resolve-dynamic-property.js'
