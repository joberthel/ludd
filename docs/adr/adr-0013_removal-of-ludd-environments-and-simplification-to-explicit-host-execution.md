# **ADR-0013: Removal of @luddjs/environments and Simplification to Explicit Host Execution**

| Property | Value |
| :---- | :---- |
| **Status** | Accepted |
| **Date** | 2026-11-23 |
| **Supersedes** | ADR-0009 (Two-Layer Sandbox Model and Cross-Step Environment Reuse) |
| **Amends** | ADR-0005 (Horizontal Parallelism Across Runs), ADR-0007 (Explicit Secret Whitelisting and Host Override Guardrails) |
| **Related** | ADR-0008 (Declarative Workflow Hygiene Over Implicit Framework Magic), [ADR-0012: ACP Protocol Standardization and Pi SDK Removal](https://docs.google.com/document/d/1PRQvLTw4ibsY2Hs9dHQTsTmvvwWsB0lgOmiNsKvMpRw/edit) |
| **Affected Packages** | `@luddjs/environments` (removed), `@luddjs/core`, `@luddjs/agents`, `@luddjs/guardrails`, `@luddjs/cli` |

## **1\. Context and Motivation**

Previously, Ludd maintained an entire environment abstraction layer (`@luddjs/environments`) supporting `host`, `git-worktree`, and `docker-worktree` adapters, alongside dynamic port allocation, Docker mount validation, and privilege-separation checks (ADR-0009).

This abstraction introduced disproportionate complexity that spilled far beyond `packages/environments` into `@luddjs/core`:

* Dedicated environment lifecycle orchestration and crash-recovery state machines (`environment-manager.ts`, `docker-worktree-rehydration.ts`, `git-worktree-rehydration.ts`, `host-rehydration.ts`, `cleanup-policy.ts`),  
* Environment-specific persistence schemas and state validation (`environments-validation.test.ts`),  
* Four dedicated sandbox/environment error hierarchies (`environment-unreachable-error.ts`, `forbidden-mount-path-error.ts`, `sandbox-violation-error.ts`, `unsafe-danger-mode-error.ts`), and  
* Cross-package coupling across `@luddjs/core`, `@luddjs/agents`, `@luddjs/guardrails`, and `@luddjs/cli`.

Following **ADR-0012**, Ludd is standardizing on the **Agent Client Protocol (ACP)** where external coding agents run as host subprocesses and handle their own tool execution and permission boundaries. With in-process agent sandboxing and Docker-routed agent shells removed, the primary architectural justification for `@luddjs/environments` no longer exists.

Furthermore, tasks such as spinning up a Git worktree or isolating directories per run can be expressed far more transparently in a few lines of user-authored TypeScript inside harness.config.ts—which aligns directly with ADR-0008 (declarative workflow hygiene over implicit framework magic).

## **2\. Architectural Decisions**

### **2.1 Complete Removal of `@luddjs/environments`**

* The `packages/environments/` workspace package is deleted in its entirety (`docker-worktree-env.ts`, `git-worktree-env.ts`, `host-env.ts`, `worktree-helpers.ts`, `isolation/port-allocator.ts`, `isolation/env-resolver.ts`, `security/mount-validator.ts`, `security/env-sanitizer.ts`, and all associated tests).  
* All environment adapter definitions, schemas, and validations are removed from `@luddjs/core` (`src/types/environment.ts`, `src/define-harness-validators.ts`, `src/persistence/state-store.ts`).  
* Environment rehydration and lifecycle modules are deleted from `@luddjs/core`:  
  * `src/runtime/environment-manager.ts` (and `environment-manager.test/`)  
  * `src/runtime/docker-worktree-rehydration.ts`  
  * `src/runtime/git-worktree-rehydration.ts`  
  * `src/runtime/host-rehydration.ts`  
  * `src/runtime/cleanup-policy.ts`  
* Environment- and sandbox-specific error classes are deleted from `@luddjs/core`:  
  * `src/errors/environment-unreachable-error.ts` (+ test)  
  * `src/errors/forbidden-mount-path-error.ts` (+ test)  
  * `src/errors/sandbox-violation-error.ts` (+ test)  
  * `src/errors/unsafe-danger-mode-error.ts` (+ test)

### **2.2 Replacement with Explicit `cwd`, `env`, and Optional Run Lifecycle Hooks**

* Instead of configuring abstract environment adapters, harnesses and steps accept plain execution parameters:  
  * `cwd`: static `string` or dynamic `(ctx) => string | Promise<string>` resolving the working directory on the host (defaulting to `process.cwd()`).  
  * `env`: static `Record<string, string>` or dynamic `(ctx) => Record<string, string> | Promise<Record<string, string>>` for environment variables.  
* To preserve safe cleanup on step failure or `ludd abort` without reintroducing an environment framework, `defineHarness` provides optional run-level `setup` and `teardown` hooks:  
  * `setup(ctx)` runs once before the first step (e.g., to create a Git worktree at `.worktrees/${ctx.runId}`) and may return a resolved `cwd` and/or `env` inherited by steps.  
  * `teardown(ctx)` is guaranteed by `@luddjs/core` to run on run completion, failure, abort, or explicit `ludd teardown` invocation (e.g., to remove the Git worktree).  
* Horizontal parallelism across runs (ADR-0005) remains fully supported: users isolate concurrent runs explicitly using `ctx.runId` (for worktree paths, temp directories, or dynamic ports) rather than relying on framework-managed port allocators or worktree adapters.

### **2.3 Thin Host Command Execution & Simplified Secret Handling (Amendment to ADR-0007)**

* `packages/core/src/runtime/environment-exec.ts` is collapsed into a minimal host `spawn` helper accepting `{ command, args, cwd, env, signal }`, used uniformly by `before-step-executor.ts` and `packages/guardrails/src/exec-guardrail.ts`.  
* Host override danger-mode flags and Docker mount restrictions (`unsafe-danger-mode-error.ts`, `forbidden-mount-path-error.ts`, `danger-mode.test.ts`) are removed, as host execution is now the explicit default model.  
* `packages/core/src/runtime/env-sanitizer.ts` may remain as a lightweight, opt-in utility for explicit secret whitelisting when desired, without forcing every agent or shell subprocess through container/adapter boundaries.

### **2.4 Simplified CLI Maintenance (`ludd gc` & `ludd teardown`)**

* `packages/core/src/runtime/gc-runs.ts` and `packages/cli/src/actions/gc-command.ts` are simplified to filesystem-only cleanup of stale run directories (no Docker container pruning or Git worktree inspection).  
* `packages/core/src/runtime/teardown-run.ts` and `packages/cli/src/actions/teardown-command.ts` invoke the harness's optional user-defined `teardown` hook (if configured) and clean up run state, without maintaining persisted environment handles.

### **2.5 Clean Handoff to `AcpAgent` (Synergy with ADR-0012)**

* Removing `@luddjs/environments` eliminates the need to thread `EnvironmentAdapter` interfaces through `AgentRunner` or `AcpAgent`.  
* Every agent invocation simply receives `{ cwd, env, signal, mcp }` directly from `@luddjs/core`.

## **3\. Interface Design and Target API**

### **3.1 Minimal Harness & Step Execution Config (`@luddjs/core`)**

```
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
  cwd?: string | ((ctx: RunLifecycleContext) => string | Promise<string>)
  /** Additional environment variables passed to commands and agents. */
  env?: Record<string, string> | ((ctx: RunLifecycleContext) => Record<string, string> | Promise<Record<string, string>>)
  /** Optional one-time run setup hook (e.g., create a git worktree). */
  setup?: (ctx: RunLifecycleContext) => void | SetupResult | Promise<void | SetupResult>
  /** Optional run cleanup hook guaranteed to execute on completion, failure, or abort. */
  teardown?: (ctx: RunLifecycleContext) => void | Promise<void>
}
```

### **3.2 Example: DIY Git Worktree Isolation in `harness.config.ts`**

```
import { execFile } from 'node:child_process'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { claudeAcp } from '@luddjs/agents'
import { defineHarness } from '@luddjs/core'

const execFileAsync = promisify(execFile)

export default defineHarness({
  name: 'feature-workflow',

  async setup({ runId, workspaceRoot }) {
    const worktreeDir = join(workspaceRoot, '.worktrees', runId)
    await execFileAsync('git', ['worktree', 'add', '-b', `ludd/${runId}`, worktreeDir, 'HEAD'], {
      cwd: workspaceRoot,
    })
    return { cwd: worktreeDir }
  },

  async teardown({ runId, workspaceRoot }) {
    const worktreeDir = join(workspaceRoot, '.worktrees', runId)
    await execFileAsync('git', ['worktree', 'remove', '--force', worktreeDir], {
      cwd: workspaceRoot,
    })
  },

  steps: [
    {
      id: 'implement',
      agent: claudeAcp({ permissionMode: 'acceptEdits' }),
      prompt: 'Implement the requested feature.',
    },
  ],
})
```

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

* **Remove:** Delete the entire `packages/environments/` directory and remove workspace references from root `package.json`, `pnpm-workspace.yaml`, `.release-please-manifest.json`, and `tsconfig` project references.

### **`packages/core`**

* **Remove:** `src/types/environment.ts` (+ test), `src/runtime/environment-manager.ts` (+ `environment-manager.test/`), `src/runtime/docker-worktree-rehydration.ts`, `src/runtime/git-worktree-rehydration.ts`, `src/runtime/host-rehydration.ts`, `src/runtime/cleanup-policy.ts`, `src/errors/environment-unreachable-error.ts` (+ test), `src/errors/forbidden-mount-path-error.ts` (+ test), `src/errors/sandbox-violation-error.ts` (+ test), `src/errors/unsafe-danger-mode-error.ts` (+ test), `src/define-harness.test/environment-validation.test.ts`, `src/persistence/state-store.test/environments-validation.test.ts`, `src/runtime/run-harness.test/environment-rehydration.test.ts`, `src/runtime/run-harness.test/cleanup-policy.test.ts`, `src/runtime/run-harness.test/danger-mode.test.ts`, and `e2e/epic-07-environments-isolation-gc.e2e.test.ts`.  
* **Update:** `define-harness.ts` & `define-harness-validators.ts` (support `cwd`, `env`, `setup`, `teardown`), `environment-exec.ts` (collapse to thin host `spawn` helper), `state-store.ts` (remove `environments` state field), `run-harness-lifecycle.ts`, `teardown-run.ts`, `gc-runs.ts`, `before-step-executor.ts`, `agent-executor.ts`, and `src/index.ts`.

### **`packages/agents` & `packages/guardrails`**

* **Update:** Replace `EnvironmentAdapter` references with plain `{ cwd, env, signal }` execution context in `AgentRunner`, `AcpAgent`, `MockAgent`, and `exec-guardrail.ts`.

### **`packages/cli`**

* **Update:** Simplify `gc-command.ts`, `teardown-command.ts`, `status-command.ts`, and `run-harness` UI bindings to drop environment-specific fields and status displays.

### **`docs/adr` & Configuration**

* Commit this document as `docs/adr/adr-0013_removal-of-environments-package-and-explicit-host-execution.md` and mark `adr-0009` as superseded.  
* Update `harness.config.ts`, `packages/core/e2e/fixtures/reference-harness.config.ts`, `docs/technical-design-document.md`, and `README.md`.

### **Recommended Sequencing with ADR-0012 (Epic 10\)**

* Execute this removal **before Slice 3 (`AcpAgent` Runtime) of Epic 10** (or as an independent preparatory epic) so `AcpAgent` is built directly against the simplified `{ cwd, env, signal }` contract without temporary environment-adapter plumbing.

