# **ADR-0013: Removal of @luddjs/environments and Simplification to Explicit Host Execution**

| Property | Value |
| :---- | :---- |
| **Status** | Accepted |
| **Date** | 2026-11-23 |
| **Supersedes** | [ADR-0009 (Two-Layer Sandbox Model and Cross-Step Environment Reuse)](./adr-0009_two-layer-sandbox-model-and-cross-step-environment-reuse.md) |
| **Amends** | [ADR-0005 (Horizontal Parallelism Across Runs)](./adr-0005_sequential-matrix-execution-per-run-vs-horizontal-parallelism-across-runs.md), [ADR-0007 (Explicit Secret Whitelisting and Host Override Guardrails)](./adr-0007_explicit-secret-whitelisting-and-host-override-guardrails.md) |
| **Related** | [ADR-0008 (Declarative Workflow Hygiene Over Implicit Framework Magic)](./adr-0008_declarative-workflow-hygiene-over-implicit-framework-magic.md), [ADR-0012: ACP Protocol Standardization and Pi SDK Removal](./adr-0012_acp-protocol-standardization-and-pi-sdk-removal.md) |
| **Affected Packages** | `@luddjs/environments` (removed), `@luddjs/core`, `@luddjs/agents`, `@luddjs/guardrails`, `@luddjs/cli` |

## **1\. Context and Motivation**

Previously, Ludd maintained an entire environment abstraction layer (`@luddjs/environments`) supporting `host`, `git-worktree`, and `docker-worktree` adapters, alongside dynamic port allocation, Docker mount validation, and privilege-separation checks (ADR-0009).

This abstraction introduced disproportionate complexity that spilled far beyond `packages/environments` into `@luddjs/core`:

* Dedicated environment lifecycle orchestration and crash-recovery state machines (`environment-manager.ts`, `docker-worktree-rehydration.ts`, `git-worktree-rehydration.ts`, `host-rehydration.ts`, `cleanup-policy.ts`),
* Environment-specific persistence schemas and state validation (`environments-validation.test.ts`),
* Dedicated sandbox/environment error hierarchies in `@luddjs/core` (`environment-unreachable-error.ts`, `forbidden-mount-path-error.ts`, `unsafe-danger-mode-error.ts`, plus `sandbox-violation-error.ts`), and
* Cross-package coupling across `@luddjs/core`, `@luddjs/agents`, `@luddjs/guardrails`, and `@luddjs/cli`.

Following **ADR-0012**, Ludd is standardizing on the **Agent Client Protocol (ACP)** where external coding agents run as host subprocesses and handle their own tool execution and permission boundaries. With in-process agent sandboxing and Docker-routed agent shells removed, the primary architectural justification for `@luddjs/environments` no longer exists.

Furthermore, tasks such as spinning up a Git worktree or isolating directories per run can be expressed far more transparently in a few lines of user-authored TypeScript inside `harness.config.ts`—which aligns directly with ADR-0008 (declarative workflow hygiene over implicit framework magic).

## **2\. Architectural Decisions**

### **2.1 Complete Removal of `@luddjs/environments`**

* The `packages/environments/` workspace package is deleted in its entirety (`docker-worktree-env.ts`, `git-worktree-env.ts`, `host-env.ts`, `worktree-helpers.ts`, `isolation/port-allocator.ts`, `isolation/env-resolver.ts`, `security/mount-validator.ts`, `security/env-sanitizer.ts`, and all associated tests).
* All environment adapter definitions, schemas, and validations are removed from `@luddjs/core` (`src/types/environment.ts`, `src/define-harness-validators.ts`, `src/persistence/state-store.ts`, `src/types/state.ts`, `src/types/step-definition.ts`, `src/types/context.ts`, `src/types/harness.ts`).
* Environment rehydration and lifecycle modules are deleted from `@luddjs/core`:
  * `src/runtime/environment-manager.ts` (and `environment-manager.test/`)
  * `src/runtime/docker-worktree-rehydration.ts`
  * `src/runtime/git-worktree-rehydration.ts`
  * `src/runtime/host-rehydration.ts`
  * `src/runtime/cleanup-policy.ts`
  * `src/runtime/environment-exec.ts`
* Environment- and sandbox-specific error classes are deleted from `@luddjs/core`:
  * `src/errors/environment-unreachable-error.ts` (+ test)
  * `src/errors/forbidden-mount-path-error.ts` (+ test)
  * `src/errors/unsafe-danger-mode-error.ts` (+ test)
  * `src/errors/sandbox-violation-error.ts` (+ test) moved out of `@luddjs/core` into `packages/agents/src/security/` (until Pi SDK removal under ADR-0012).

### **2.2 Replacement with Explicit `cwd`, `env`, and Optional Run Lifecycle Hooks**

* Instead of configuring abstract environment adapters, harnesses, steps, and guardrails accept plain execution parameters (`execution-context.ts`, `utils/execution-overrides.ts`):
  * `cwd`: static `string` or dynamic `(ctx) => string | Promise<string>` resolving the working directory on the host (defaulting to `workspaceRoot` / `process.cwd()` at the run level, and resolving relative to parent `cwd` at step and guardrail levels).
  * `env`: static `Record<string, string>` or dynamic `(ctx) => Record<string, string> | Promise<Record<string, string>>` merged sequentially from harness defaults, `setup` result, step overrides, and guardrail overrides.
* To preserve safe cleanup on step failure or `ludd abort` without reintroducing an environment framework, `defineHarness` and `createHarness` provide optional run-level `setup` and `teardown` hooks:
  * `setup(ctx)` runs once before the first step (e.g., to create a Git worktree at `.harness/worktrees/${ctx.runId}-wt`) and may return a resolved `cwd` and/or `env` inherited by steps (overriding harness-level `cwd` and merging into harness-level `env`).
  * `teardown(ctx)` is guaranteed by `@luddjs/core` (`executeWithHarnessLifecycle`) to run on run completion, failure, `AbortSignal` / `run.abort` cancellation, or explicit `ludd teardown` / `teardownRun` invocation (e.g., to remove the Git worktree). When a run is aborted, `teardown(ctx)` receives a fresh non-aborted `AbortSignal` so host cleanup commands (such as `git worktree remove`) complete reliably.
* Horizontal parallelism across runs (ADR-0005) remains fully supported: users isolate concurrent runs explicitly using `ctx.runId` (for worktree paths, temp directories, or dynamic ports) rather than relying on framework-managed port allocators or worktree adapters.

### **2.3 Thin Host Command Execution & Simplified Secret Handling (Amendment to ADR-0007)**

* `packages/core/src/runtime/environment-exec.ts` is replaced by `packages/core/src/runtime/host-exec.ts`, providing a minimal host `spawn` helper (`HostSpawnOptions`, `HostSpawnResult`, `killProcessTree`, `extractAbortError`), used directly by `packages/guardrails/src/exec-guardrail.ts` (while `before-step-executor.ts` and `guardrail-executor.ts` forward resolved `cwd`, `env`, and `signal`).
* Host override danger-mode flags and Docker mount restrictions (`unsafe-danger-mode-error.ts`, `forbidden-mount-path-error.ts`, `danger-mode.test.ts`) are removed from `@luddjs/core`, as host execution is now the explicit default model.
* `packages/core/src/runtime/env-sanitizer.ts` (`buildIsolatedEnvironmentVars`, `SAFE_BASELINE_KEYS`) remains as an opt-in utility (wired into `host-exec.ts` via `sanitizeEnv` / `allowedEnvKeys`, alongside `inheritEnv: false`) for explicit secret whitelisting when desired, without forcing every agent or shell subprocess through container/adapter boundaries.

### **2.4 Simplified CLI Maintenance (`ludd gc` & `ludd teardown`)**

* `packages/core/src/runtime/gc-runs.ts` (`gc`) and `packages/cli/src/actions/gc-command.ts` (`gcCommand`) are simplified to filesystem-only cleanup of stale `.harness/runs/<runId>/` directories (no Docker container pruning or external worktree inspection).
* `packages/core/src/runtime/teardown-run.ts` (`teardownRun`) and `packages/cli/src/actions/teardown-command.ts` (`teardownCommand`) invoke the harness's optional user-defined `teardown` hook (if configured) and finalize run state (`run.teardown` ledger event), without maintaining persisted environment handles.

### **2.5 Clean Handoff to `AcpAgent` (Synergy with ADR-0012)**

* Removing `@luddjs/environments` eliminates the need to thread `EnvironmentAdapter` interfaces through `AgentRunner` or `AcpAgent`.
* Every agent invocation receives `{ cwd, env, signal, mcpServerUrl, mcpAuthToken }` directly from `@luddjs/core` via `AgentTurnInput`.

## **3\. Interface Design and Target API**

### **3.1 Minimal Harness & Step Execution Config (`@luddjs/core`)**

<!-- eslint-skip -->
```ts
export interface RunLifecycleContext {
  runId: string
  workspaceRoot: string
  signal: AbortSignal
}

export interface SetupResult {
  cwd?: string
  env?: Record<string, string>
}

export interface HarnessExecutionConfig {
  /** Working directory for steps, guardrails, and agents. Defaults to process.cwd(). */
  cwd?: DynamicProperty<string, RunLifecycleContext>
  /** Additional environment variables passed to commands and agents. */
  env?: DynamicProperty<Record<string, string>, RunLifecycleContext>
  /** Optional one-time run setup hook (e.g., create a git worktree). */
  setup?: (ctx: RunLifecycleContext) => void | SetupResult | Promise<void | SetupResult>
  /** Optional run cleanup hook guaranteed to execute on completion, failure, or abort. */
  teardown?: (ctx: RunLifecycleContext) => void | Promise<void>
}
```

### **3.2 Example: DIY Git Worktree Isolation in `harness.config.ts`**

<!-- eslint-skip -->
```ts
import { join } from 'node:path'
import { claudeAcp } from '@luddjs/agents'
import { defineHarness, spawn } from '@luddjs/core'

export default defineHarness({
  name: 'feature-workflow',

  async setup({ runId, workspaceRoot, signal }) {
    const worktreeDir = join(workspaceRoot, '.harness', 'worktrees', runId)
    const res = await spawn({
      command: 'git',
      args: ['worktree', 'add', '-b', `ludd/${runId}`, worktreeDir, 'HEAD'],
      cwd: workspaceRoot,
      signal,
    })
    if (res.exitCode !== 0) {
      throw new Error(`Failed to create worktree: ${res.stderr}`)
    }
    return { cwd: worktreeDir }
  },

  async teardown({ runId, workspaceRoot, signal }) {
    const worktreeDir = join(workspaceRoot, '.harness', 'worktrees', runId)
    await spawn({
      command: 'git',
      args: ['worktree', 'remove', '--force', worktreeDir],
      cwd: workspaceRoot,
      signal,
    })
  },

  steps: [
    {
      id: 'implement',
      run: claudeAcp({
        permissionMode: 'acceptEdits',
        prompt: 'Implement the requested feature.',
      }),
    },
  ],
})
```

*(Note: `claudeAcp` illustrates the target ADR-0012 agent preset; prior to ADR-0012 Slice 3, existing harnesses use `piAgent`.)*

## **4\. Consequences**

### **Positive Consequences**

* **Massive reduction in codebase surface area:** Deletes an entire workspace package plus complex rehydration, mount-validation, port-allocation, and cleanup-policy state machines in `@luddjs/core`.
* **Simpler `AgentRunner` & `AcpAgent` contract:** Agents receive plain `cwd` and `env` rather than environment adapter abstractions.
* **Full user transparency and flexibility:** Worktrees, temporary directories, custom containers, or branch strategies are plain TypeScript in `harness.config.ts`—no fighting framework conventions or waiting on adapter features.
* **Faster test suite and simpler persistence:** Run state (`state-store.ts`) no longer persists and validates complex environment handles across crashes.

### **Deliberate Trade-offs and Risks**

* **No built-in Docker sandboxing:** Projects requiring hard container isolation must handle containerization externally (e.g., running `ludd` itself inside a devcontainer/VM or wrapping commands explicitly in `harness.config.ts`).
* **User responsibility for worktree/port hygiene:** Users who run parallel workflows must ensure their `setup`/`teardown` hooks isolate paths (via `runId`) and ports appropriately.
* **Breaking configuration change:** Existing `harness.config.ts` files referencing `hostEnv`, `gitWorktreeEnv`, or `dockerWorktreeEnv` must migrate to `cwd`/`env` and optional `setup`/`teardown` hooks.

## **5\. Migration Plan by Package**

### **`packages/environments`**

* **Remove:** Delete the entire `packages/environments/` directory and remove package references from root `package.json`, `.release-please-manifest.json`, `release-please-config.json`, `packages/core/package.json`, `packages/cli/package.json`, and `pnpm-lock.yaml`.

### **`packages/core`**

* **Remove:** `src/types/environment.ts` (+ test), `src/runtime/environment-manager.ts` (+ `environment-manager.test/`), `src/runtime/docker-worktree-rehydration.ts`, `src/runtime/git-worktree-rehydration.ts`, `src/runtime/host-rehydration.ts`, `src/runtime/cleanup-policy.ts`, `src/runtime/environment-exec.ts`, `src/errors/environment-unreachable-error.ts` (+ test), `src/errors/forbidden-mount-path-error.ts` (+ test), `src/errors/unsafe-danger-mode-error.ts` (+ test), `src/define-harness.test/environment-validation.test.ts`, `src/persistence/state-store.test/environments-validation.test.ts`, `src/runtime/run-harness.test/environment-rehydration.test.ts`, `src/runtime/run-harness.test/cleanup-policy.test.ts`, `src/runtime/run-harness.test/danger-mode.test.ts`, and `e2e/epic-07-environments-isolation-gc.e2e.test.ts`.
* **Move:** `src/errors/sandbox-violation-error.ts` (+ test) to `packages/agents/src/security/` (pending ADR-0012 Pi SDK removal).
* **Add:** `src/runtime/host-exec.ts` (+ `host-exec.test/`), `src/runtime/execution-context.ts` (+ `execution-context.test/`), and `e2e/epic-07-host-execution-gc.e2e.test.ts` (+ `e2e/epic-07-helpers.ts`, `e2e/epic-07-env-helpers.ts`).
* **Update:** `define-harness.ts`, `define-harness-validators.ts`, `state-store.ts`, `run-harness.ts`, `run-harness-lifecycle.ts`, `run-harness-steps.ts`, `matrix-executor.ts`, `step-run-executor.ts`, `before-step-executor.ts`, `agent-executor.ts`, `guardrail-executor.ts`, `teardown-run.ts`, `gc-runs.ts`, `ipc/run-control-handlers.ts`, `types/*.ts`, and `src/index.ts`.

### **`packages/agents` & `packages/guardrails`**

* **Update:** Replace environment adapter references with plain `{ cwd, env, signal }` execution context in `AgentRunner`, `piAgent`, `mockAgent`, `security/environment-bash.ts`, `exec-guardrail.ts`, `agent-guardrail.ts`, `fn-guardrail.ts`, and `utils/execution-overrides.ts` (and build `AcpAgent` directly on `{ cwd, env, signal }` in ADR-0012).

### **`packages/cli`**

* **Update:** Simplify `gc-command.ts`, `teardown-command.ts`, `status-command.ts`, `commands/teardown.tsx`, `commands/abort.tsx`, and `e2e/epic-09-cli.e2e.test.ts` to drop environment-specific fields and status displays.

### **`docs/adr` & Configuration**

* Finalize this document as `docs/adr/adr-0013_removal-of-ludd-environments-and-simplification-to-explicit-host-execution.md`, mark `adr-0009` as superseded, and note amendments in `adr-0005` and `adr-0007`.
* Update `harness.config.ts`, `packages/core/e2e/fixtures/reference-harness.config.ts`, `packages/core/e2e/epic-08-reference-workflow.e2e.test.ts`, `docs/technical-design-document.md`, and `README.md`.

### **Recommended Sequencing with ADR-0012 (Epic 10\)**

* Execute this removal **before Slice 3 (`AcpAgent` Runtime) of Epic 10** so `AcpAgent` is built directly against the simplified `{ cwd, env, signal }` contract without temporary environment-adapter plumbing.
