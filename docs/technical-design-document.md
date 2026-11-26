# ludd — Technical Design Document: Deterministic Code-First Agent Orchestration Harness with Headless IPC and Scoped MCP State

*A deterministic code harness that orchestrates AI-driven agents within bounded, verifiable workflow stages.*

---

## 0\. Document Metadata & Decision Governance

| Field | Value / Specification |
| :---- | :---- |
| **Architectural Choice Title** | Adopt a headless, code-first TypeScript state machine (`@luddjs/*`) with per-run filesystem isolation, JSON-RPC 2.0 Unix socket IPC, and an embedded HTTP/SSE MCP server to deterministically orchestrate AI coding agents. |
| **Status** | `Approved — Ready for Implementation` |
| **Decision Owner** | Johannes Berthel (Final sign-off & veto authority) |
| **Decision Needed By** | N/A (Approved) |
| **Cost of Delay** | Continued reliance on non-deterministic interactive agent sessions; inability to safely parallelize multi-slice feature development; potential API churn across `@luddjs/core`, `@luddjs/agents`, and `@luddjs/guardrails`. |
| **Pays For It (Build / Maintenance / On-Call)** | Core Maintainer(s) of `@luddjs/*` (Engine, ACP agent adapter, host execution runtime, IPC protocol maintenance). |
| **Executes** | Core Maintainer(s) & Early Adopter Workflow Authors. |
| **Reviewers per System Boundary** | 1\. Core State Machine & IPC (`@luddjs/core`) — Core Maintainer 2\. Host Execution & Isolation (`@luddjs/core`) — Infrastructure Lead 3\. Frontend / TUI / CLI Consumers — TUI Maintainer |
| **Related Artifacts** | Original Draft (`ludd — Technical Design Document`); Target ADRs (see Section 10.3). |

### Epistemic Legend Used in This Document

To separate established design facts from unproven assumptions and open architectural questions, key statements in this TDD are tagged as follows:

* **\[FACT\]**: Verified technical behavior or existing constraint from the current system context.  
* **\[DECISION\]**: Explicit architectural choice already made in the `ludd` design.  
* **\[ASSUMPTION\]**: Underlying premise that requires empirical validation (e.g., via spike or benchmark).

---

## 1\. Problem Statement, Context, and "Why Now?"

### 1.1 Problem Statement (Strictly Separated from the Proposed Solution)

* **\[FACT\]** Direct, interactive sessions with modern AI coding agents (such as Codex, Copilot, or Antigravity) exhibit high output variance and non-determinism: submitting the exact same prompt on two different days frequently produces structurally different implementations, skipped verification steps, or unrequested refactorings.  
* **\[FACT\]** Like onboarding a software engineer into a complex codebase without engineering guidelines or CI gates, dropping an autonomous agent into a repository without hard structural boundaries leads to silent regressions, ignored static analysis rules, and context window pollution when large test logs are dumped into the conversation thread.  
* **\[FACT\]** Interactive agent workflows scale poorly: developers must manually "babysit" a single active terminal session, resolve prompts inline, and manually run verification tools (`phpstan`, `phpunit`, linters) because agents inconsistently decide when or whether to execute tests.  
* **\[FACT\]** Running multiple coding agents concurrently against a single local repository causes immediate state collisions (overlapping file edits, Git index locks, database schema conflicts, and local TCP port collisions).

### 1.2 Why Solve This Now & Cost of Doing Nothing

* **\[FACT\] Paradigm Shift from Implicit Intuition to Explicit Workflow Engineering:** Historically, experienced software engineers could rely on tacit knowledge, gut feeling, and personal habits while writing code directly. However, because AI coding agents generate code and solve localized tasks orders of magnitude faster than humans, relying on implicit developer intuition during ad-hoc coding sessions no longer scales.  
* **\[FACT\] Codifying Engineering Best Practices:** To leverage the speed of AI agents without sacrificing architectural integrity, software engineers must formalize the engineering best practices learned over decades—such as structured requirement triage, specification before implementation, vertical slicing, static analysis, and automated testing—into an explicit, documented, and machine-enforceable workflow.  
* **\[DECISION\] Shifting Leverage to Workflow Optimization:** The core responsibility of the software engineer shifts from manually authoring every line of implementation code to **designing, documenting, and continuously optimizing the development workflow itself**. Once a deterministic pipeline is defined in code (`harness.config.ts`), every improvement to a guardrail, prompt contract, or verification step immediately compounds across all future agent runs.  
* **\[FACT\] Cost of Doing Nothing:** Engineering teams that continue to work ad-hoc—relying on uncodified gut feeling and manual interactive babysitting—cannot systematically improve or scale their agent-assisted output. Without a codified workflow harness, engineering standards remain trapped in individual developers' heads, every session repeats the same preventable mistakes, and developers remain the manual verification bottleneck.

---

## 2\. Verifiable Goals & Explicit Non-Goals

### 2.1 Verifiable Goals (Observable System Outcomes)

1. **100% Deterministic Verification Enforcement \[DECISION\]:** No workflow step can transition to a passed state unless all declared output schemas (`zod`), MCP artifacts, and sequential `afterStep` guardrails return `pass` or `skip`—completely removing test execution from the agent's discretion.  
2. **Zero-Collision Concurrent Execution \[DECISION\]:** Multiple `ludd` workflow instances (`<runId>`) can execute in parallel on the same host machine without shared lock files, filesystem overwrites, database schema collisions, or host TCP port conflicts.  
3. **Lossless Crash Recovery & Rehydration \[DECISION\]:** Any interrupted workflow run (`SIGINT`, crash, or system reboot) can resume from `.harness/runs/<runId>/state.json` at the exact `stepId`, `matrixIndex`, and agent `sessionId` with 0% CPU consumption while paused at human gates.  
4. **Context Window Protection via MCP Offloading \[DECISION\]:** Large CLI outputs from failing guardrails (10,000+ lines) are never injected raw into the agent prompt; they are stored in the embedded MCP server and referenced via lightweight URIs/keys.

### 2.2 Explicit Non-Goals (Scope Boundaries)

To prevent scope creep and the Second-System Effect, `ludd` explicitly does not aim to do the following:

1. **Not an LLM or Coding Agent Implementation \[DECISION\]:** `ludd` does not implement its own foundational coding agent loop or LLM prompt routing; it orchestrates external ACP-compatible coding agents via the open **Agent Client Protocol (ACP)** in `@luddjs/agents` (`acpAgent`, `claudeAcp`, `codexAcp`, `agyAcp`).  
2. **Not a Proprietary DSL or YAML Workflow Engine \[DECISION\]:** `ludd` will not invent a YAML syntax, expression parser, or proprietary sub-workflow templating language. Composition is handled via native TypeScript (`harness.config.ts`).  
3. **Not a Distributed Cloud Cluster Scheduler \[DECISION\]:** `ludd` is designed as a single-host (local workstation or dedicated CI VM) orchestrator executing directly on the host with optional user-defined `setup`/`teardown` isolation hooks (such as DIY Git worktrees)—not a multi-node Kubernetes cluster orchestrator.  
4. **No Implicit Git Magic \[DECISION\]:** `ludd` will never perform hidden automatic Git commits, branch rebases, or destructive working tree resets behind the workflow author's back.

---

## 3\. Ranked Architectural Constraints (Tie-Breakers)

When evaluating design alternatives or resolving implementation ambiguities, constraints are prioritized in the following strict order (Constraint \#1 overrides Constraint \#2 in any tie-breaker):

1. **Rank 1 — Deterministic Host Authority over Agent Autonomy (`MUST`):** The host orchestrator—never the AI agent—owns state transitions, guardrail execution, and verification verdicts. An agent `CANNOT` bypass an `afterStep` guardrail or self-certify completion without passing host-validated schemas.  
2. **Rank 2 — Strict Per-Run Isolation & No Shared Mutable State (`MUST`):** Every run `MUST` be fully isolated under `.harness/runs/<runId>/` and use explicit `runId`-scoped `cwd`/`env` (or `setup`/`teardown` worktree hooks) when isolating workspaces. Concurrent runs `CANNOT` rely on a global lock registry or static host ports.  
3. **Rank 3 — Explicit Execution & Opt-In Secret Sanitization (`SHOULD`):** Host execution is the explicit default (`ADR-0013`, amending `ADR-0007`); steps, guardrails, and `host-exec.ts` `spawn` calls can declare explicit `env` overrides or opt into `env-sanitizer.ts` (`sanitizeEnv` / `allowedEnvKeys`) to restrict inherited host secrets.  
4. **Rank 4 — Strictly Headless Core Runtime (`MUST`):** `@luddjs/core` `MUST` remain 100% decoupled from terminal UI (Ink/React), CLI rendering, or desktop GUI dependencies, communicating exclusively via `.harness/runs/<runId>/` files and `control.sock` (JSON-RPC 2.0).  
5. **Rank 5 — Code-First TypeScript & Zod Ergonomics (`SHOULD`):** Workflows `SHOULD` be authored in strictly typed TypeScript (`defineHarness()`) using standard Node.js APIs and `zod` schemas rather than external configuration DSLs.

---

## 4\. Alternatives Considered & Trade-Off Analysis

| Option | Description | Pros | Cons & Why Rejected / Accepted |
| :---- | :---- | :---- | :---- |
| **Option A: Baseline ("Do Nothing")** | Run interactive coding agents (Codex, Claude Code, Agy) directly in terminals using static markdown instructions (`AGENTS.md` / `CLAUDE.md`). | Zero framework build cost; immediate start; no orchestrator maintenance. | **Rejected:** Markdown instructions are advisory, not enforced. Agents skip `phpstan`/`phpunit`, flood context windows with logs, require constant developer babysitting, and cannot run in parallel without Git/DB collisions. |
| **Option B: Pure Agentic Multi-Agent Graph** *(e.g., LangGraph / CrewAI / AutoGen style)* | Model the pipeline as a conversational graph where a "Supervisor Agent" decides when to call a "Coder Agent" and a "QA Agent". | Flexible, dynamic routing for unstructured exploratory tasks. | **Rejected:** Violates **Constraint \#1**. Using an LLM supervisor to decide whether deterministic tools (`phpstan`, `phpunit`) should run—or whether their output passes—wastes tokens, adds latency, and reintroduces non-determinism into verification gates. |
| **Option C: Local CI/CD YAML Runners** *(e.g., `act` / GitHub Actions locally)* | Express workflows as YAML DAGs executed inside local Docker containers. | Familiar CI syntax; existing ecosystem of reusable steps. | **Rejected:** CI runners are stateless and non-interactive. They lack native concepts for resuming stateful LLM `sessionId` threads, self-healing retry loops that restart guardrail chains from index 0, interactive `humanReviewGuardrail` sockets, and context-friendly MCP log offloading. |
| **Option D: `ludd` Deterministic TypeScript Harness** *(Recommended)* | Headless Node.js state machine configured via TypeScript (`harness.config.ts`), combining polymorphic steps (`acpAgent`/`claudeAcp`/`codexAcp`/`agyAcp` or TS callbacks), an embedded HTTP/SSE MCP server (bridged via `ludd mcp-bridge`), and `control.sock` JSON-RPC IPC. | Enforces hard verification gates (Constraint \#1), isolates parallel runs (Constraint \#2), keeps logs out of prompts via MCP, and allows TUI/GUI/CLI clients to attach/detach at will (Constraint \#4). | **Accepted.** **Accepted Trade-Offs:** 1\. Higher initial engineering complexity (maintaining custom IPC and MCP server). 2\. Requires workflow authors to write TypeScript configurations, author any DIY `setup`/`teardown` worktree hooks, and explicitly declare Git checkpoints rather than relying on zero-config defaults. |

---

## 5\. System Architecture & Technical Design

### 5.1 System Context & Container View (C4 Level 1 & Level 2\)

```
+-----------------------------------------------------------------------------------+
|External Clients (Presentation Layer - Decoupled)                                  |
|  [ CLI Runner ]       [ Interactive TUI (Ink/React) ]       [ Desktop GUI ]       |
+--------+-----------------------------+-----------------------------+--------------+
         | Tail JSONL                  | JSON-RPC 2.0                | Tail JSONL
         v                             v                             v
+-----------------------------------------------------------------------------------+
| Host Machine: ludd Headless Runner Process (@luddjs/core) [Scoped per <runId>]      |
|                                                                                   |
|  +-----------------------------+     +-----------------------------------------+  |
|  | Deterministic State Machine |<--->| .harness/runs/<runId>/                  |  |
|  | - Step Lifecycle (run / if) |     | - state.json (Rehydration Snapshot)     |  |
|  | - Sequential Matrix Engine  |     | - ledger.jsonl (High-Level Event Log)   |  |
|  | - Guardrail Engine (0..N)   |     | - streams/<sessionId>.jsonl (Updates)   |  |
|  +--------------+--------------+     | - control.sock (Unix Socket / Pipe)     |  |
|                 |                    +-----------------------------------------+  |
|                 v                                                                 |
|  +-----------------------------------------------------------------------------+  |
|  | Embedded HTTP/SSE MCP Server (Bound to Free Ephemeral Host Port)            |  |
|  | - Scoped Artifact Store (put_artifact / get_artifact + Zod Validation)      |  |
|  | - Context-Friendly Offloading (beforeStep outputs & failing CLI logs)       |  |
|  +-----------------------------------+-----------------------------------------+  |
+--------------------------------------|--------------------------------------------+
                                       | HTTP (127.0.0.1) <-> ludd mcp-bridge (stdio)
                                       v
+-----------------------------------------------------------------------------------+
| Host Execution Context (Explicit cwd / env + Optional setup / teardown Worktree)  |
|  +--------------------------------------+  +--------------------------------------+  |
|  | AI Worker (@luddjs/agents: ACP)      |  | Guardrails (@luddjs/guardrails)      |  |
|  | - readOnly | acceptEdits | bypass    |  | - execGuardrail (host-exec spawn)    |  |
|  | - Scoped cwd / env                   |  | - agentGuardrail (explicit agent)    |  |
|  |                                      |  | - fnGuardrail / humanReview          |  |
|  +--------------------------------------+  +--------------------------------------+  |
+-----------------------------------------------------------------------------------+
```

### 5.2 State and Authority Matrix (Single Source of Truth)

To eliminate ambiguity during crash recovery and concurrent execution, every data entity has exactly one authoritative owner:

| Data Entity | Single Source of Truth (Owner) | Storage Location | Mutability & Access Rules |
| :---- | :---- | :---- | :---- |
| **Workflow Definition** | Host Orchestrator (`@luddjs/core`) | `harness.config.ts` | Read-only at run initialization; evaluated dynamically via `StepContext` callbacks. |
| **Active Execution Pointer** | Host State Machine | `.harness/runs/<runId>/state.json` | Mutated atomically by the host orchestrator after every state transition. Authoritative for crash rehydration. |
| **Audit & Lifecycle History** | Host State Machine | `.harness/runs/<runId>/ledger.jsonl` | Strictly append-only JSON Lines written by the host orchestrator. |
| **Agent Session Stream Events** | Agent Adapter (`@luddjs/agents`) | `.harness/runs/<runId>/streams/<sessionId>.jsonl` | Strictly append-only per-session stream of normalized ACP `session/update` events (`thought`, `tool_call`, `message_chunk`); token/cost telemetry is omitted per ADR-0012. |
| **Step Artifacts (`spec.md`, `todos.json`) & Offloaded Guardrail Logs** | Embedded Host MCP Server | `.harness/runs/<runId>/artifacts/` & `.harness/runs/<runId>/logs/` | Written/read via MCP tool calls (`put_artifact`, `get_artifact`, bridged via `ludd mcp-bridge` for ACP agents) and host guardrail offloader; validated against Zod schemas. |
| **Source Code & Git History** | Explicit Host Workspace (or DIY `setup` Worktree) | Host Filesystem / Worktree (`cwd`) | Modified by agents when ACP `permissionMode` permits (`'acceptEdits'` / `'bypassPermissions'`) or explicit `execGuardrail` commands; agent filesystem enforcement is delegated to the external ACP CLI. |

### 5.3 System Purpose and Core Principles

#### 5.3.1 System Overview and Scope

* **\[DECISION\]** Rather than replacing coding agents, `ludd` acts as a deterministic workflow orchestrator—conceptually similar to a local GitHub Actions pipeline—that spawns and directs agents within bounded tasks. Standard verification checks are stripped from the agent's discretion and enforced deterministically by the host process: for example, whenever a `.php` file changes, the harness automatically triggers static analysis (`phpstan`) and runs `phpunit` rather than relying on the agent to decide whether to run tests.  
* **\[DECISION\]** Combining strict process enforcement with explicit host execution (`cwd`/`env`) and optional run-level `setup`/`teardown` isolation hooks (such as DIY Git worktrees scoped by `ctx.runId`) enables safe horizontal parallelization across independent runs. Instead of babysitting a single interactive session, developers can run multiple isolated workflow runners concurrently in the background, scaling development throughput while guaranteeing that every worker adheres to the same engineering standards.

#### 5.3.2 Deterministic Control vs. Agent Autonomy

Each workflow is structured into sequential steps governed by a strict Input and Output contract:

* **Polymorphic Execution (`run`) \[DECISION\]:** Execution within a step is handled via a unified `run` property that accepts either an AI agent instance (e.g., `claudeAcp(...)`, `codexAcp(...)`, `agyAcp(...)`, `acpAgent(...)`) or a purely deterministic TypeScript callback function (`async (ctx) => { ... }`).  
* **Bounded Agent Autonomy \[DECISION\]:** When an AI agent is invoked, its autonomy is strictly bounded to that specific step: it receives the defined input context and works solely toward producing the required output (structured return schemas and/or validated MCP artifacts) so the step turns "green" and the state machine can advance to the next stage.  
* **Conditional Step Execution (`if`) \[DECISION\]:** Steps support an optional `if: (ctx) => boolean | Promise<boolean>` predicate (which can execute simple logic or even invoke a lightweight decision agent). If the condition evaluates to `false`, the state machine marks the step as `skipped` in the ledger and sets its output to `undefined` for downstream steps.  
* **Code-First Workflow Composition \[DECISION\]:** Because workflows are authored in standard TypeScript (`harness.config.ts`), reusable step sequences (such as triage flows or PR creation steps) are composed natively using standard TypeScript array helper functions and spread operators without requiring proprietary sub-workflow engines. Similarly, global workflow inputs (CLI arguments, environment variables, or external files) can be read directly via standard Node.js APIs inside the configuration callbacks.

### 5.4 Control Plane, IPC, and Execution Architecture

#### 5.4.1 Headless Host Orchestrator and State Machine

* **\[DECISION\]** Each workflow is defined in a dedicated TypeScript configuration file (`harness.config.ts`). Using `defineHarness()` or `createHarness()` from `@luddjs/core`, this file exports a strictly typed configuration object containing workflow parameters, optional host execution settings (`cwd`, `env`, `setup`, `teardown`), and the sequential `steps` array. A Node.js binary loads this configuration, initializes the state machine, and executes the pipeline deterministically.  
* **\[DECISION\]** The core execution engine is built on a strictly headless architecture. Because the orchestrator process is completely decoupled from the presentation layer, different frontends—ranging from a standard CLI environment or interactive TUI to a full desktop GUI—can seamlessly plug into and control the same underlying runtime.

#### 5.4.2 State Persistence, Event Ledger, and Stream Splitting (`.harness/runs/<runId>/`)

* **\[DECISION\]** To allow multiple harness runners to execute concurrently within the same workspace without state collisions, every workflow execution is assigned a unique `runId` (such as a UUID or a scoped slug like `issue-124-9f8a`). All runtime state, sockets, event logs, and intermediate artifacts are strictly namespaced inside `.harness/runs/<runId>/`, guaranteeing that parallel runners never overwrite each other's files or lock shared state.

Within each isolated run directory, the runner maintains:

1. **`state.json` (Scoped Run Snapshot) \[DECISION\]:** Captures the exact state of that specific runner instance after every transition. This includes the `runId`, the active workflow `stepId`, the current `matrixIndex`, self-healing retry counters, and active agent `sessionIds`. To prevent corrupted state files on abrupt process termination (`SIGKILL`, OOM, or power loss), `state.json` is always mutated via an atomic write-and-rename operation (`state.json.tmp` \-\> `fs.renameSync('state.json')`).  
2. **`ledger.jsonl` (Per-Run Append-Only Event Stream) \[DECISION\]:** Records high-level state transitions, guardrail verdicts, human gate prompts, and teardown events (`run.teardown`) as an immutable JSON Lines stream. Every entry follows a standardized envelope schema:  
   `{ schemaVersion, timestamp, runId, stepId, matrixIndex?, eventType, payload }`  
3. **`streams/<sessionId>.jsonl` (Dedicated Agent Session Streams) \[DECISION\]:** To prevent high-frequency agent stream updates from bloating `ledger.jsonl`, normalized ACP `session/update` notifications (`thought`, `tool_call`, `message_chunk`) are written to dedicated per-session stream files via `acp-stream.ts`. Token usage and cost telemetry are intentionally omitted (ADR-0012).  
4. **`control.sock` & `runner.pid` (Bidirectional Headless IPC & Process Liveness) \[DECISION\]:** When a runner starts, it writes its OS process ID to a dedicated `.harness/runs/<runId>/runner.pid` file. When a workflow pauses at a Human-in-the-Loop gate or a max-retry escalation prompt, the headless Node.js runner process stays alive in the background (waiting on an unresolved `Promise` at 0% CPU) and listens on a local Unix Domain Socket (`.harness/runs/<runId>/control.sock`, or a Named Pipe on Windows). External frontends (TUI, GUI, CLI) connect to this socket via JSON-RPC 2.0 to resolve gates (`gate.resolve`), inject user feedback, or abort runs. If a runner crashes without unlinking `control.sock`, subsequent runs or frontends check `runner.pid` against active OS processes (e.g., via `process.kill(pid, 0)`): if the PID is no longer alive, stale `control.sock` and `runner.pid` files are safely removed so the run can be restarted/rehydrated without `EADDRINUSE` collisions.  
5. **Crash Recovery & Rehydration \[DECISION\]:** If the runner process is interrupted (`SIGINT`, system reboot, or crash) while mid-step or waiting at a gate, resuming the run rehydrates the state machine directly from `state.json`. The orchestrator invokes any configured `setup(ctx)` hook (authored idempotently when reusing an existing worktree) and resolves the host `cwd` and `env`, then resumes at the exact `stepId` and `matrixIndex` and passes the existing agent `sessionId` (`previousSessionId`) back to the ACP adapter without destructively resetting the workspace. When the ACP agent advertises `agentCapabilities?.loadSession === true`, `acpAgent` resumes via `session/load`; otherwise it starts a fresh `session/new` without synthetic fallback.

#### 5.4.3 Internal HTTP/SSE MCP Server and `ludd mcp-bridge` for Artifacts and Logs

* **\[DECISION\]** Rather than relying on agents to write workflow artifacts (such as `spec.md` or `todos.json`) directly to the local filesystem—which would violate read-only permission boundaries during discovery phases—the host orchestrator runs an embedded HTTP/SSE Model Context Protocol (MCP) Server bound to a free ephemeral host port (`127.0.0.1`).  
* **`stdio` MCP Bridge (`ludd mcp-bridge`, ADR-0012) \[DECISION\]:** Because ACP v1 mandates only the `stdio` transport for `mcpServers` and external ACP agents spawn MCP servers as child processes without access to the running worker's in-memory state (such as interactive `ask_user` gates), `@luddjs/cli` provides `ludd mcp-bridge` (`packages/cli/src/mcp-bridge/`). `acpAgent` attaches a `stdio` MCP server entry named `'ludd'` (`ludd mcp-bridge --endpoint <url>`) with `LUDD_MCP_TOKEN` passed in `env`, forwarding newline-delimited JSON-RPC between `stdin`/`stdout` and the embedded core HTTP MCP server.  
* **S3-Like Scoped Artifact Store \[DECISION\]:** Agents interact with the MCP server via structured tool calls (e.g., `put_artifact`, `get_artifact`) to read and write step artifacts scoped to the current `runId`.  
* **Deterministic Output & Artifact Validation \[DECISION\]:** Steps can declare expected output artifacts alongside validation rules (such as non-empty checks, custom validator functions, or strict Zod schemas for JSON artifacts like `todos.json`). In addition, steps can enforce a direct Zod `outputSchema` on the agent's final response. If any artifact is missing or fails schema validation, the harness rejects the completion and enters the self-healing loop.  
* **Context-Friendly Log & Context Offloading \[DECISION\]:** Outputs from `beforeStep` guardrails and raw CLI logs from failing `afterStep` `execGuardrails` (which can easily exceed tens of thousands of lines) are automatically stored in the MCP server. Instead of flooding the agent's context window with raw stack traces, the harness sends a concise notification prompt containing the MCP URI/key so the agent can query and inspect the logs on demand.  
* **Format-Aware MCP Log & Output Pagination \[DECISION\]:** To prevent large offloaded outputs (such as a 50,000-line test log or a massive JSON static analysis report) from flooding the agent's context window when queried via MCP, the embedded MCP server enforces format-aware pagination:  
  * **Multiline Plain-Text Logs (`text`):** Automatically paginated by line breaks (`\n`). Agents query bounded line ranges or pages (e.g., via `read_log_page` / `read_log_lines` and `search_log`) rather than pulling the entire raw text blob at once.  
  * **Structured JSON Outputs (`json`):** Guardrails can configure structured array pagination via a property key/path or a selector callback function (e.g., `pagination: { key: 'errors' }` or `pagination: (data) => data.files`). The MCP server extracts the target array from the JSON payload and serves paginated item slices alongside summary metadata (such as total item count).  
* **Disk Persistence of MCP Artifacts & Offloaded Logs \[DECISION\]:** All MCP artifacts and offloaded guardrail logs are persisted on disk under `.harness/runs/<runId>/artifacts/<artifactKey>` and `.harness/runs/<runId>/logs/<stepId>[-m<matrixIndex>]-<attempt>-<phase>-<guardrailIndex>.log` (plus `.items.json` for JSON-paginated logs, indexed in `state.json`), ensuring they survive runner process restarts and crash rehydration.  
* **Per-Run Bearer Token Authentication & Strict Interface Binding \[DECISION\]:** At the start of each workflow run, the host orchestrator generates a cryptographic per-run Bearer token (`authToken`), injects it into ACP `ludd mcp-bridge` subprocesses via `LUDD_MCP_TOKEN` (and into `execGuardrail` subprocesses via `MCP_SERVER_URL` / `MCP_AUTH_TOKEN`), and requires `Authorization: Bearer <token>` on all HTTP/SSE MCP requests. Furthermore, the embedded MCP server binds strictly to `127.0.0.1` (never `0.0.0.0`), preventing unauthorized network clients from accessing or tampering with another run's artifacts or logs.

#### 5.4.4 Worker Lifecycle, Dynamic Properties (`StepContext`), and Session Reuse

* **\[DECISION\]** Every workflow step operates on explicit inputs and outputs. Configuration properties across steps, agents, and guardrails support a unified `T | ((ctx: StepContext) => T | Promise<T>)` pattern.  
* **StepContext Contract \[DECISION\]:** The `ctx` object passed to all dynamic step, agent, and guardrail callbacks exposes the following strictly typed contract:

| `StepContext` Property | Type / Signature | Description & Usage in `harness.config.ts` |
| :---- | :---- | :---- |
| `ctx.runId` | `string` | Unique identifier of the current workflow execution. |
| `ctx.steps` | `Record<string, StepResult<TOutput>>` | Map of completed or skipped prior steps, exposing `status` (`'passed' \| 'failed' \| 'skipped'`) and typed output (including `sessionId` and validated `outputSchema` fields, e.g., `ctx.steps['triage-and-grilling'].output.sessionId`). |
| `ctx.step` | `{ id: string; output: TCurrentOutput; attempt: number }` | Current step execution state and output payload (used inside `afterStep` callbacks such as `ctx.step.output.status` or `ctx.step.output.commitMessage`). |
| `ctx.matrix` | `{ index: number; total: number; item: TMatrixItem } \| undefined` | Active sequential matrix cursor and typed slice payload when `matrix` is configured on the step. |
| `ctx.artifacts` | `ArtifactClient` | Helper for `fnGuardrail` or TypeScript `run` callbacks to read/write MCP artifacts directly from host code. |

* **RunLifecycleContext Contract \[DECISION\]:** Run-level `cwd`, `env`, `setup`, and `teardown` callbacks receive `{ runId, workspaceRoot, signal }`, allowing authors to isolate workspaces and environment variables deterministically per `runId`.
* **Session Capture & Declarative Reuse \[DECISION\]:** When an agent step finishes, the state machine captures its resulting `sessionId` as part of the step's output. Subsequent steps—or subsequent iterations within a sequential matrix—can declaratively pass a static configuration or a callback (`sessionId: (ctx) => ...`) to either spawn a fresh agent session or resume a prior conversation thread.  
* **ACP Standardization (`@luddjs/agents`, ADR-0012) \[DECISION\]:** `@luddjs/agents` standardizes exclusively on the open **Agent Client Protocol (ACP)** (JSON-RPC 2.0 over `stdio`, built on `@agentclientprotocol/sdk`) for production runs, exposing `acpAgent(config)` alongside thin presets `claudeAcp(options?)`, `codexAcp(options?)`, and `agyAcp(options?)` (`['--acp']` by default). Direct Pi SDK support has been removed.  
* **Capability-Driven `loadSession` Without Fallback \[DECISION\]:** During the ACP `initialize` handshake, `acpAgent` inspects `agentCapabilities?.loadSession`. When `true` and a `previousSessionId` is provided (from retry, rehydration, or step `sessionId`), it invokes ACP `session/load`; when unsupported or absent, it starts a fresh `session/new` without implementing any synthetic rehydration fallback.  
* **Uniform Cancellation (`AbortSignal` \-\> ACP `session/cancel`) \[DECISION\]:** Each turn receives `{ cwd, env, signal, mcp, outputSchema, previousSessionId }`. When `signal` aborts, `acpAgent` sends an ACP `session/cancel` notification for the active `sessionId`, awaits graceful exit up to `shutdownTimeoutMs` (default `5000` ms), and terminates the child process tree if the timeout expires. Unit and E2E tests inject a local fake ACP server or `mockAgent` and never call live LLMs.

---

## 5.5 Explicit Host Execution and Resource Isolation

### 5.5.1 Explicit `cwd`, `env`, and Optional `setup` / `teardown` Hooks (ADR-0013)

* **\[DECISION\]** Per **ADR-0013** (superseding **ADR-0009**), `@luddjs/environments`, environment adapter abstractions (`hostEnv`, `gitWorktreeEnv`, `dockerWorktreeEnv`), `EnvironmentManager`, `cleanupPolicy`, and `ctx.environments` are removed in favor of explicit host execution (`execution-context.ts` and `host-exec.ts`):
  * **Explicit `cwd` and `env` Resolution \[DECISION\]:** Both `HarnessExecutionConfig` (`defineHarness` / `createHarness`) and `StepConfig` accept static or dynamic `cwd` and `env` (`DynamicProperty`). Run-level `cwd` defaults to `workspaceRoot` (`process.cwd()` fallback); `setup(ctx)` may return `{ cwd?, env? }` overriding harness `cwd` and merging into harness `env`; step-level `cwd` resolves relative to run-level `cwd`, and step-level `env` merges over run-level `env` (with guardrail-level `cwd`/`env` overrides resolving on top of step context).
  * **Guaranteed Lifecycle Cleanup (`setup` / `teardown`) \[DECISION\]:** `setup(ctx)` runs once before the first step (for example, calling `spawn` to create a DIY Git worktree at `.harness/worktrees/${ctx.runId}-wt`). `teardown(ctx)` is guaranteed by `executeWithHarnessLifecycle` to run upon run completion, setup/step failure, `AbortSignal` / IPC `run.abort` cancellation, or explicit `ludd teardown` / `teardownRun`. On abort, `teardown(ctx)` receives a fresh non-aborted `AbortSignal` so host cleanup commands (`git worktree remove --force`) succeed reliably.
  * **Sequential Matrix Execution \[DECISION\]:** When a step uses the `matrix` configuration (e.g., iterating over vertical slices from an MCP artifact like `todos.json`), the harness executes the matrix items **sequentially** within the resolved working directory (`cwd`). This eliminates internal Git merge conflicts between slices of the same feature while maintaining full horizontal parallelism across separate `<runId>` instances.

### 5.5.2 Runtime, Database, and Ephemeral Port Isolation

* **\[DECISION\]** Parallel workflow runs require strict isolation of stateful resources such as MySQL or PostgreSQL databases:  
  * **Declarative Run-Scoped Environment Variables & Worktrees \[DECISION\]:** Following the *Code-First* (`ADR-0001`), *Declarative Rather Than Imposed* (`ADR-0008`), and *Explicit Host Execution* (`ADR-0013`) principles, `@luddjs/core` does not hardcode database-specific naming magic or framework-managed port allocators. Instead, harnesses and steps accept dynamic `env: (ctx) => Record<string, string>` callbacks (and `setup` hooks) so workflow authors declaratively derive run-scoped database schemas (e.g., `` DB_DATABASE: `test_run_${ctx.runId}` ``), isolate worktrees per `runId`, and let services bind OS-assigned ephemeral ports directly in `harness.config.ts`.  
  * **Automatic MCP Context Injection \[DECISION\]:** The orchestrator injects `MCP_SERVER_URL` and `MCP_AUTH_TOKEN` into agent turns and `execGuardrail` subprocesses alongside the resolved `env`.

### 5.5.3 Teardown Lifecycle and Filesystem-Only Garbage Collection (`teardownRun` & `gc`)

* **\[DECISION\]** Cleanup is split cleanly between user-owned `teardown` hooks and filesystem-only run pruning:  
  * **Explicit Run Teardown (`teardownRun`) \[DECISION\]:** `@luddjs/core` exposes `teardownRun(runId, options?)` (and the `run.teardown` IPC method / `ludd teardown` CLI command) to invoke a harness's configured `teardown(ctx)` hook, append a `run.teardown` event to `ledger.jsonl`, and finalize incomplete (`running` / `waiting_for_gate`) run states.  
  * **Programmatic Filesystem-Only Garbage Collection (`gc`) \[DECISION\]:** Strictly adhering to the headless core principle (Constraint \#4), `@luddjs/core` exposes `gc({ workspaceDir, olderThan, status, runId, dryRun })`. `gc()` scans `.harness/runs/`, checks `runner.pid` to skip active runs (`skippedActiveRunIds`), and prunes matching `.harness/runs/<runId>/` directories from disk without loading `harness.config.ts` or modifying external worktrees/directories.

---

## 5.6 Permission Model, Host Execution, and Secret Management

### 5.6.1 Delegated ACP Permissions, `ludd mcp-bridge`, and Structured Output

* **\[DECISION\]** With `@luddjs/environments` removed (**ADR-0013**) and in-process agent security extensions removed (**ADR-0012**), `@luddjs/*` delegates workspace sandboxing to the external ACP agent runtime and host OS isolation; projects requiring hard container isolation run `ludd` inside an external container/VM or wrap commands in `harness.config.ts`. Within `@luddjs/agents`, `acpAgent` enforces declarative `AcpPermissionMode` rules:
  1. **ACP Permission Modes (`AcpPermissionMode`) \[DECISION\]:** Configured via `permissionMode?: 'readOnly' | 'acceptEdits' | 'bypassPermissions'` (defaulting to `'readOnly'`). `resolveAgentAccessMode` maps `'readOnly'` to `AgentAccessMode = 'read-only'` and `'acceptEdits'` / `'bypassPermissions'` to `'workspace-write'`. During ACP `session/request_permission`, `'readOnly'` allows only `read`, `search`, `fetch`, and `think` tool kinds; `'acceptEdits'` additionally allows `edit`, `move`, and `delete`; `'bypassPermissions'` allows all tool kinds. Disallowed requests are answered with a `reject_once`/`reject_always` option (or `cancelled` if no reject option exists).
* **Authenticated `stdio` MCP Bridge (`ludd mcp-bridge`) \[DECISION\]:** When `AgentTurnInput.mcp` (`AgentMcpConnection`: `{ url, authToken }`) is set, `buildMcpBridgeServerConfig` attaches a `stdio` MCP server entry (`AcpStdioMcpServerConfig`) named `'ludd'` to `session/new` and `session/load`. It resolves explicit `mcpBridge`, then `process.env.LUDD_CLI_BIN`, then `'ludd'`, passing `['mcp-bridge', '--endpoint', mcp.url]` and `{ name: 'LUDD_MCP_TOKEN', value: mcp.authToken }` in `env` (never passing the token in CLI args). `ludd mcp-bridge` proxies newline-delimited JSON-RPC over `stdin`/`stdout` to the embedded core HTTP MCP server (`put_artifact`, `get_artifact`, `list_artifacts`, `read_log_page`, `read_log_lines`, `search_log`, and `ask_user` when `interactive: true`).
* **Structured Output Validation (`outputSchema`) \[DECISION\]:** When `AgentTurnInput.outputSchema` is declared, `buildPromptWithSchema` appends the JSON Schema contract (`z.toJSONSchema`) to the prompt. After `session/prompt` completes, `resolveStructuredOutput` extracts JSON (from raw text or fenced code blocks) from the accumulated assistant message text and parses it with `outputSchema.safeParse`. Missing or invalid JSON throws `StepOutputValidationError`, which `agent-executor.ts` handles via the self-healing retry loop (`output_schema_validation_failed`, `attempt++`). Steps without an `outputSchema` return the accumulated assistant text directly.

### 5.6.2 Host Execution & Opt-In Secret Sanitization (Amendment to ADR-0007)

* **\[DECISION\]** Per **ADR-0013** (amending **ADR-0007**), host execution via `packages/core/src/runtime/host-exec.ts` (`spawn`) is the explicit default model:  
  * **Explicit `env` Overrides & Opt-In Whitelisting (`env-sanitizer.ts`) \[DECISION\]:** By default, `spawn` inherits host `process.env` merged with configured `env` overrides (`inheritEnv: true`). When tighter secret hygiene is desired for a subprocess, callers can pass `inheritEnv: false` or `sanitizeEnv: true` with `allowedEnvKeys`, delegating to `buildIsolatedEnvironmentVars` (`SAFE_BASELINE_KEYS` + explicit whitelist + injected `env`).  
  * **Step & Guardrail Overrides \[DECISION\]:** Individual steps and guardrails (`execGuardrail`, `agentGuardrail`) can specify their own `cwd` and `env` overrides directly without requiring `hostEnv()`.

### 5.6.3 Declarative Workflow Hygiene and Git Commits

* **\[DECISION\]** Following the principle of *Declarative Rather Than Imposed*, the harness does not perform automatic hidden Git commits or destructive repository resets between steps or matrix slices. Instead, workflow authors declare desired Git checkpoints explicitly—for example, by requiring the agent to output a `commitMessage` via `outputSchema` and running a `git commit` inside an `afterStep` `execGuardrail`.

---

## 5.7 Guardrail Engine

### 5.7.1 Guardrail Contract and Verdict Structure

* **Inherited Host Execution \[DECISION\]:** By default, every guardrail inherits the resolved `cwd` and `env` of its parent step. Individual `execGuardrail` and `agentGuardrail` instances can explicitly override `cwd` and `env` (statically or via `DynamicProperty` callbacks).  
* **Minimalist Verdict (`pass`, `fail`, `skip`) \+ Open `body` \[DECISION\]:** Guardrails return `{ status: 'pass' | 'fail' | 'skip', body?: any }`.

### 5.7.2 Lifecycle Execution (`beforeStep` vs. `afterStep`) and Self-Healing Loops

1. **`beforeStep` Guardrails (Context Collection & Setup) \[DECISION\]:** Executed sequentially before the step's main `run` action. Rather than halting the pipeline on non-zero states, `beforeStep` guardrails store their outputs/verdicts in the MCP server and pass an MCP reference prompt to the agent so it can inspect the collected context (such as user feature descriptions or `git status` outputs). If a workflow author genuinely wants a `beforeStep` check to hard-abort the entire run, they throw an `Error` inside the guardrail callback.  
   * **Typed Step Factories:** `beforeStep` may be a factory (`beforeStep: (ctx) => [...]`) and `run` may be a factory that returns an agent runner (`run: (ctx) => claudeAcp({ permissionMode: 'acceptEdits', prompt: ... })`). Both receive the typed prior-step and matrix context, so values can be interpolated at the step boundary without nested dynamic-property callbacks. Ordinary `run: (ctx) => output` callbacks remain supported.
   * **Before-Step Results:** `beforeStep` may return an array or a named object of guardrails. The runner collects each verdict body's value in `ctx.beforeStep` (by index for arrays, by key for objects), with the body type inferred from each guardrail. These values are checkpointed so a resumed step can use them without rerunning completed guardrails.
2. **`afterStep` Guardrails & Full-Chain Re-Execution \[DECISION\]:** Executed sequentially after the step's main `run` action completes.  
   * **Typed Guardrail Factories:** When a guardrail prompt needs the current step's output, define `afterStep` as a factory (`afterStep: (ctx) => [...]`). Its `ctx.step.output` is inferred from that step's `outputSchema`; this keeps the schema as the single source of truth. A callback nested inside a generic guardrail factory cannot receive contextual typing from the sibling `outputSchema` property.
   * If all guardrails return `pass` or `skip`, the step succeeds and the state machine advances.  
   * If any guardrail returns `fail`, the harness enters a **self-healing feedback loop**: raw logs or review feedback are written to the MCP server, and the active agent session is resumed with a prompt referencing the MCP resource.  
   * **Strict Restart from Guardrail \#1 \[DECISION\]:** Once the agent completes its fix turn, the **entire `afterStep` guardrail chain restarts from the very first guardrail** (index 0). This guarantees that fixing Guardrail \#2 (e.g., `phpunit`) never silently introduces a regression in Guardrail \#1 (e.g., `phpstan`).  
   * **Author Responsibility for Side-Effecting Guardrails (Documentation-Only) \[DECISION\]:** Because any failure restarts the `afterStep` chain from index 0, placing non-idempotent or side-effecting guardrails (such as `git commit` or `git push`) before verification guardrails could cause subsequent retries to fail (e.g., attempting to commit a clean working tree). Following the principle of *Declarative Rather Than Imposed*, `ludd` does not enforce framework-level linting rules or hidden wrappers around shell commands; workflow authors own their pipeline ordering, and official documentation explicitly recommends placing side-effecting guardrails at the end of the `afterStep` chain.  
3. **Cumulative Guardrail Retries, Escalation (`onMaxRetriesExceeded`), and Cancellation (Amendment to ADR-0006 via ADR-0012) \[DECISION\]:** Each `afterStep` guardrail supports `maxRetries` (tracked cumulatively per guardrail within the current step or matrix slice) to prevent ping-pong oscillation when the chain restarts at index 0. The legacy step-level turn circuit breaker (`maxTotalTurns`) was removed in ADR-0012 because each ACP `session/prompt` encapsulates an entire internal agent loop; hanging or cancelled runs are aborted uniformly via `AbortSignal` \-\> ACP `session/cancel`. When a guardrail's `maxRetries` limit is reached and `onMaxRetriesExceeded: 'prompt_user'` is configured, the runner pauses on `control.sock` and opens an interactive escalation gate. Through the JSON-RPC socket, the user can choose any of three resolution actions:  
   * **Retry with Feedback:** Reset or add to the retry counter (`addRetries: N`) and optionally provide a text hint to guide the agent's next attempt.  
   * **Force Pass / Skip:** Override the failing guardrail (`pass` or `skip`) so the step can advance.  
   * **Abort:** Terminate the workflow run cleanly.

### 5.7.3 Built-in Guardrail Types

* **`execGuardrail` \[DECISION\]:** Spawns commands on the host via `host-exec.ts` (`spawn`) in the resolved `cwd` and `env`. To prevent shell-injection or unintended POSIX subshell evaluation (e.g., `$()` or backticks inside double-quoted agent outputs like `commitMessage`), `command` accepts either a direct argv array (`string[]`, executed without shell interpolation), a shell string (`string`), or a callback returning either (`(ctx) => string | string[]`), alongside a safe `sh` template tag helper for escaping interpolated values (e.g., `command: (ctx) => ['git', 'commit', '-m', ctx.step.output.commitMessage]`). By default, exit code 0 maps to `pass` and non-zero maps to `fail`, with raw `stdout`/`stderr` automatically offloaded to the MCP server on failure. An optional custom formatter callback `(result) => { status, body }` can parse CLI output and override the verdict (`pass`, `fail`, `skip`). For large outputs offloaded to MCP, `execGuardrail` supports automatic line-break pagination for plain text as well as configurable JSON array pagination via a key or selector function (`pagination: 'errors' | ((json) => unknown[])`). To protect against hanging processes, `execGuardrail` also supports a configurable timeout in seconds (`timeout?: number`) and a configurable timeout resolution (`onTimeout?: 'fail' | 'skip' | 'pass'`, defaulting to `'fail'`). When the timeout expires, the runner terminates the process tree (`SIGTERM` \-\> `SIGKILL`), offloads partial logs to the MCP server, and returns the configured `onTimeout` verdict.  
* **`fnGuardrail` (Inline / Custom Function) \[DECISION\]:** Executes arbitrary async TypeScript validation logic directly within the orchestrator context.  
* **`agentGuardrail` \[DECISION\]:** Spawns an AI verification agent using an **explicit, mandatory `agent` runner** (`agentGuardrail({ name, agent, prompt, ... })`, e.g. `codexAcp({ permissionMode: 'readOnly' })`), defaulting `mode` to `'read-only'` and inheriting the parent step's `cwd` and `env` while supporting explicit `cwd`/`env` overrides. It enforces the standard `{ status: 'pass' | 'fail' | 'skip', body?: ... }` output structure, allowing the workflow author to supply a custom prompt and custom Zod schema for the `body` payload; the verdict schema is passed as `outputSchema` to the configured `AgentRunner`.  
* **`humanReviewGuardrail` \[DECISION\]:** Pauses execution and emits a `gate.waiting` event to `ledger.jsonl`, waiting for a JSON-RPC resolution on `control.sock`. The user explicitly marks the gate as **Green (`pass`)** to advance or **Red (`fail`) with text feedback**, which feeds the user's answers or revision notes back into the agent session via the standard self-healing loop.

---

## 6\. Failure Modes, ATAM Sensitivity Points & Pre-Mortem Diagnostics

*In accordance with ATAM (Architecture Tradeoff Analysis Method) and Pre-Mortem Inversion practices, this section catalogs critical runtime, IPC, and execution failure modes alongside their binding architectural mitigations.*

| Failure Scenario / Pre-Mortem Vector | Impact if Unhandled | Architectural Mitigation & Decision |
| :---- | :---- | :---- |
| **1\. Ping-Pong Self-Healing Oscillation (Guardrail \#1 vs. Guardrail \#2)** | Guardrail \#1 (`phpstan`) passes; Guardrail \#2 (`phpunit`) fails (retry 1/3). Agent fixes `phpunit` but breaks `phpstan`. Chain restarts at index 0: `phpstan` fails (retry 1/3), agent fixes `phpstan`, resetting or alternating indefinitely if retry counters are scoped only to consecutive failures. | **\[DECISION\]:** Guardrail `maxRetries` counts cumulative failures of that guardrail within the active step/slice when restarting the guardrail chain from index 0, bounded by `onMaxRetriesExceeded` (`'abort'` or `'prompt_user'`). Stuck or cancelled agent turns are terminated via `AbortSignal` \-\> ACP `session/cancel` (ADR-0012). |
| **2\. Process Death (`SIGKILL` / OOM / Power Loss) Mid-Step** | `state.json` might be partially written (corrupted JSON), or the runner process exits while a long `phpunit` suite or agent turn is active. | **\[DECISION\]:** Write `state.json` via atomic write-and-rename (`state.json.tmp` \-\> `fs.renameSync('state.json')`). On rehydration, re-run any configured `setup(ctx)` hook (idempotently when reusing a DIY worktree) and re-resolve host `cwd`/`env` before resuming the step. |
| **3\. Stale `control.sock` Socket File After Crash** | On Unix systems, if a process crashes without unlinking `control.sock`, restarting the runner for the same `<runId>` throws `EADDRINUSE`. Frontends scanning `.harness/runs/*/control.sock` cannot tell a live waiting runner from a dead crashed runner. | **\[DECISION\]:** Persist the active runner process ID in a dedicated `.harness/runs/<runId>/runner.pid` file. Before binding `control.sock` or resuming a run (and when frontends scan run directories), verify whether the PID in `runner.pid` is still running (`process.kill(pid, 0)`). If the process is dead, unlink stale `control.sock` and `runner.pid` files and safely restart/rehydrate; if the process is still alive, abort duplicate startup to prevent split-brain execution. |
| **4\. Non-Idempotent Guardrail Re-Execution** | In Section 7 (`implement-slices`), the final `afterStep` guardrail runs `git add -A && git commit -m ...`. If a subsequent guardrail were placed *after* the commit and failed, restarting the chain from index 0 would attempt `git commit` again on a clean tree and fail with exit code 1\. | **\[DECISION\]:** Handled purely via documentation without framework-imposed linting or magic wrappers. Workflow authors retain full ownership of their pipeline configuration; documentation explicitly notes that side-effecting guardrails (such as `git commit` or `git push`) should be placed at the end of the `afterStep` chain so full-chain restarts from index 0 do not re-trigger them prematurely. |
| **5\. Runaway Command in `execGuardrail` (Hanging Test)** | A test suite waits on stdin or deadlocks; the headless runner hangs forever without emitting a `gate.waiting` event. | **\[DECISION\]:** `execGuardrail` supports an explicit timeout property in seconds (`timeout?: number`) alongside a configurable timeout verdict (`onTimeout?: 'fail' \| 'skip' \| 'pass'`, defaulting to `'fail'`). When the timeout expires, the runner terminates the process tree (`SIGTERM` \-\> `SIGKILL`), offloads partial logs to the MCP server, and returns the configured `onTimeout` verdict. |
| **6\. Host Disk Exhaustion from Run Artifacts, Worktrees & Session Streams** | Across dozens of runs, `.harness/runs/<runId>/` snapshots, `streams/<sessionId>.jsonl` files, offloaded logs, and temporary DIY worktrees accumulate on disk. | **\[DECISION\]:** Use `teardown(ctx)` hooks (guaranteed on completion/failure/abort, or invoked explicitly via `teardownRun` / `ludd teardown`) for external worktree cleanup, and expose a programmatic headless garbage collection API (`gc({ olderThan, status, runId, dryRun })`) in `@luddjs/core` that checks process inactivity via `runner.pid` and prunes old `.harness/runs/<runId>/` directories from disk without touching external directories. |

---

## 7\. "Clients in the Wild", IPC Protocol & Schema Evolution

Even though `ludd` runs locally, a decoupled architecture with long-running background runners (0% CPU waiting on `control.sock`) creates a **"Clients in the Wild" compatibility boundary** between:

1. Background runner processes started hours or days ago (holding open `control.sock` and writing `state.json` / `ledger.jsonl`), and  
2. Newly updated CLI, TUI (Ink/React), or GUI clients connecting to inspect or resolve gates, or a newer `ludd` binary rehydrating an older `state.json`.

### 7.1 Schema Versioning & IPC Protocol Specification

* **Strict Schema Versioning with Fail-Fast Validation (No Migrations) \[DECISION\]:** Both `state.json` and every `ledger.jsonl` event envelope include an explicit version field (e.g., `"schemaVersion": 1`). When the runner rehydrates `state.json` or when a client consumes run state/events, it validates `schemaVersion` against its supported version. If an incompatible version is detected (whether too old or too new), the system immediately throws a clear version mismatch error (fail-fast). In the initial implementation, `ludd` intentionally omits state migration functions for upgrading older schema versions.  
* **Standardized JSON-RPC 2.0 Method Contract on `control.sock` \[DECISION\]:** To enable decoupled TUI, GUI, and CLI frontends to inspect and control waiting runners without guesswork, the bidirectional IPC socket (`.harness/runs/<runId>/control.sock`) enforces the following JSON-RPC 2.0 method contract:  
  * `run.status` (Request \-\> returns the current `state.json` snapshot alongside active gate details).  
  * `gate.resolve` (Params: `{ stepId, guardrailIndex?, action: 'pass' | 'fail' | 'retry' | 'skip' | 'abort' | 'answer', feedback?: string, addRetries?: number, answer?: unknown }`).  
  * `run.abort` (Params: `{ reason?: string, teardown?: boolean }`).  
  * `run.teardown` (Params: `{ force?: boolean }`).

---

## 8\. Security (STRIDE), Privacy, Observability & Testing Strategy

### 8.1 Security & STRIDE Threat Analysis

| STRIDE Category | Specific Threat Vector in `ludd` | Architectural Mitigation & Decision |
| :---- | :---- | :---- |
| **Spoofing & Tampering** | **Unauthenticated Local MCP Server:** The embedded MCP server binds to an ephemeral host port. Another local process could scan ephemeral ports and call `put_artifact` or read offloaded logs from another `<runId>`. | **\[DECISION\]:** Generate a cryptographic per-run Bearer token (`authToken`, passed via `LUDD_MCP_TOKEN` to `ludd mcp-bridge` and `MCP_AUTH_TOKEN` to `execGuardrail`) at run start and require `Authorization: Bearer <token>` on all HTTP/SSE MCP requests. Bind the MCP server strictly to `127.0.0.1` (never `0.0.0.0`). |
| **Elevation of Privilege** | **Unintended Workspace Mutation by Agent:** An agent attempts file edits or shell execution outside the intended phase permissions (e.g., during read-only triage/review). | **\[DECISION\]:** `acpAgent` enforces `AcpPermissionMode` (`'readOnly'` \| `'acceptEdits'` \| `'bypassPermissions'`) in ACP `session/request_permission` handling and delegates underlying filesystem/shell sandboxing to the external ACP CLI (ADR-0012). Projects requiring hard OS/filesystem isolation execute `ludd` inside an external container or VM. |
| **Information Disclosure** | **Accidental Secret Leakage via Offloaded CLI Logs:** A failing `execGuardrail` dumps environment variables or connection strings into `stderr`, which is stored in MCP and read by the cloud LLM. | **\[DECISION\]:** Callers requiring stricter subprocess environment isolation can opt into `sanitizeEnv: true` (`allowedEnvKeys`) or `inheritEnv: false` in `host-exec.ts` (Section 5.6.2). Automated secret-redaction filters inside the MCP log offloader are out of scope; documentation advises workflow authors to mask or filter any sensitive tokens within `execGuardrail` commands or custom formatter callbacks. |

### 8.2 Testing Strategy for `@luddjs/*`

* **Deterministic Test Harness for the Orchestrator \[DECISION\]:**  
  1. **Mock Agent Adapter (`mockAgent`):** Implement a deterministic `mockAgent` in `@luddjs/agents` that replays scripted responses, tool calls (`put_artifact`), and simulated failures so the state machine, sequential matrix loop, and self-healing retry logic can be unit-tested in milliseconds without calling real LLM APIs.  
  2. **End-to-End Crash-Rehydration Integration Tests:** Automated end-to-end integration tests that terminate the runner process across state transition boundaries (`beforeStep`, mid-`run`, mid-`afterStep` retry, waiting on `control.sock`), rehydrate from `state.json`, and assert identical final `ledger.jsonl` states.  
  3. **Explicit Host Execution, DIY Worktree & GC E2E Coverage:** End-to-end tests (`epic-07-host-execution-gc.e2e.test.ts`) verifying static/dynamic `cwd` and `env` precedence across harness, `setup`, steps, and guardrails; parallel `runId`-isolated DIY Git worktrees; guaranteed non-aborted `teardown` on failure, `AbortSignal`, and IPC abort; and filesystem-only `gc()` pruning `.harness/runs/*` without touching external directories.

---

## 9\. Reference Workflow & Declarative Configuration (`harness.config.ts`)

### 9.1 Interactive Feature Development Pipeline Walkthrough

1. **Step 1: Interactive Triage & Clarification (`triage-and-grilling`)**  
   * **`beforeStep`:** Prompts the developer via `humanReviewGuardrail` for the initial feature request and stores the response in the MCP server.  
   * **`run` (Agent \- Read-Only):** Analyzes the codebase and the request, returning a structured Zod output (`status: 'needs_clarification' | 'ready'`, `questions`, `summary`).  
   * **`afterStep` (Human Gate Loop):** If questions remain or the user wants to refine the scope, the developer responds with "Red (`fail`) \+ Feedback" at the `humanReviewGuardrail`. Once everything is clear, the developer marks the gate "Green (`pass`)".  
2. **Step 2: Specification and Ticket Decomposition (`generate-spec-and-todos`)**  
   * **`run` (Agent \- Read-Only, Reused Session):** Resumes the `sessionId` from Step 1 and writes two validated artifacts (`spec.md` and `todos.json`) to the internal MCP server.  
   * **`afterStep` (Human Sign-Off):** The developer inspects the generated specification and slice breakdown via a `humanReviewGuardrail`, requesting tweaks (`fail` \+ feedback) or approving (`pass`).  
3. **Step 3: Sequential Matrix Slice Implementation (`implement-slices`)**  
   * **`matrix`:** Reads `todos.json` from the MCP artifact store and iterates over each slice **sequentially** in the isolated DIY Git worktree (`permissionMode: 'acceptEdits'`).  
   * **`run` (Agent per Slice):** Implements the current slice and outputs a structured `commitMessage`.  
   * **`afterStep` (Automated Verification \+ Declarative Commit):** Runs `phpstan` and `phpunit` via `execGuardrail` (restarting from `phpstan` on any self-healing retry). Once all checks pass, a final `execGuardrail` commits the slice using the agent's generated commit message.  
4. **Step 4: Final Review and Pull Request Generation (`final-review-and-pr`)**  
   * **`beforeStep`:** Runs `git status --porcelain` and `git log` via `execGuardrail`, providing the summary to the agent via MCP.  
   * **`run` (Agent \- Read-Only):** Reviews the complete branch diff and writes the final PR description artifact to the MCP server.  
   * **`afterStep`:** Requests final human sign-off and pushes the branch from the worktree `cwd` on the host before `teardown` removes the temporary worktree.

### 9.2 Complete Reference Configuration (`harness.config.ts`)

<!-- eslint-skip -->
```ts
import fs from 'node:fs'
import path from 'node:path'
import { claudeAcp, codexAcp } from '@luddjs/agents'
import { defineHarness, spawn } from '@luddjs/core'
import {
  agentGuardrail,
  execGuardrail,
  humanReviewGuardrail,
  sh,
} from '@luddjs/guardrails'
import { z } from 'zod'

const TodoSliceSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  acceptanceCriteria: z.array(z.string()),
})

const TodosArtifactSchema = z.array(TodoSliceSchema).min(1)

async function setupFeatureWorktree(
  workspaceRoot: string,
  runId: string,
  signal?: AbortSignal,
): Promise<{ cwd: string }> {
  const root = path.resolve(workspaceRoot)
  const worktreeDir = path.resolve(root, '.harness', 'worktrees', `${runId}-feature-env`)
  const branchName = `ludd/${runId}-feature-env`

  if (fs.existsSync(path.join(worktreeDir, '.git'))) {
    const check = await spawn({
      command: 'git',
      args: ['-C', worktreeDir, 'rev-parse', '--is-inside-work-tree'],
      cwd: root,
      signal,
    })
    if (check.exitCode === 0) {
      return { cwd: worktreeDir }
    }
  }

  fs.mkdirSync(path.dirname(worktreeDir), { recursive: true })
  const refCheck = await spawn({
    command: 'git',
    args: ['show-ref', '--verify', '--quiet', `refs/heads/${branchName}`],
    cwd: root,
    signal,
  })
  const addArgs = refCheck.exitCode === 0
    ? ['worktree', 'add', worktreeDir, branchName]
    : ['worktree', 'add', '-b', branchName, worktreeDir, 'HEAD']
  const addRes = await spawn({ command: 'git', args: addArgs, cwd: root, signal })
  if (addRes.exitCode !== 0) {
    throw new Error(`Failed to create git worktree: ${addRes.stderr}`)
  }
  return { cwd: worktreeDir }
}

async function teardownFeatureWorktree(
  workspaceRoot: string,
  runId: string,
  signal?: AbortSignal,
): Promise<void> {
  const root = path.resolve(workspaceRoot)
  const worktreeDir = path.resolve(root, '.harness', 'worktrees', `${runId}-feature-env`)
  if (fs.existsSync(worktreeDir)) {
    const res = await spawn({
      command: 'git',
      args: ['worktree', 'remove', '--force', worktreeDir],
      cwd: root,
      signal,
    })
    if (res.exitCode !== 0) {
      throw new Error(`Failed to remove git worktree: ${res.stderr}`)
    }
    return
  }
  await spawn({ command: 'git', args: ['worktree', 'prune'], cwd: root, signal })
}

export default defineHarness({
  name: 'interactive-feature-workflow',

  setup: async ({ runId, workspaceRoot, signal }) =>
    setupFeatureWorktree(workspaceRoot, runId, signal),
  teardown: async ({ runId, workspaceRoot, signal }) =>
    teardownFeatureWorktree(workspaceRoot, runId, signal),

  steps: [
    {
      id: 'triage-and-grilling',
      name: 'Interactive Feature Clarification',

      outputSchema: z.object({
        status: z.enum(['needs_clarification', 'ready']),
        questions: z.array(z.string()).describe('Offene Rückfragen an den Entwickler.'),
        summary: z.string().describe('Zusammenfassung des verstandenen Feature-Umfangs.'),
      }),

      beforeStep: [
        humanReviewGuardrail({
          prompt: 'Bitte beschreibe das neue Feature oder den Change-Request:',
        }),
      ],

      run: claudeAcp({
        permissionMode: 'readOnly',
        prompt: 'Lies den initialen Feature-Wunsch aus dem MCP-Kontext und analysiere die Codebase. Wenn Details unklar sind, setze status auf "needs_clarification" und formuliere präzise Fragen. Wenn alles klar ist, setze status auf "ready".',
      }),

      afterStep: ctx => [
        humanReviewGuardrail({
          prompt:
            ctx.step.output.status === 'needs_clarification'
              ? `Der Agent hat noch offene Fragen:\n${ctx.step.output.questions.map(q => `- ${q}`).join('\n')}\n\nBitte antworte (Fail + Feedback) oder gib den Step frei (Pass):`
              : `Zusammenfassung:\n${ctx.step.output.summary}\n\nPasst der Scope so? (Pass zum Fortfahren, Fail + Feedback für Anpassungen)`,
        }),
      ],
    },

    {
      id: 'generate-spec-and-todos',
      name: 'Specification and Todo Decomposition',

      artifacts: {
        'spec.md': { nonEmpty: true },
        'todos.json': { schema: TodosArtifactSchema },
      },

      run: ctx => claudeAcp({
        permissionMode: 'readOnly',
        sessionId: ctx.steps['triage-and-grilling']?.output?.sessionId,
        prompt: 'Erstelle basierend auf unserem geklärten Gespräch über den MCP-Server das Artefakt "spec.md" sowie das Artefakt "todos.json" mit isolierten vertikalen Slices.',
      }),

      afterStep: [
        humanReviewGuardrail({
          prompt: 'Bitte überprüfe die im MCP abgelegten Artefakte "spec.md" und "todos.json". (Pass für Freigabe, Fail + Feedback für Korrekturen)',
        }),
      ],
    },

    {
      id: 'implement-slices',
      name: 'Sequential Matrix Implementation per Todo Slice',

      matrix: {
        itemsFromArtifact: 'todos.json',
      },

      outputSchema: z.object({
        commitMessage: z.string().min(5).describe('Conventional Commit Message für dieses abgeschlossene Slice.'),
      }),

      run: ctx => claudeAcp({
        permissionMode: 'acceptEdits',
        prompt:
          `Implementiere exakt das folgende To-Do-Slice (${ctx.matrix.index + 1}/${ctx.matrix.total}):\n`
          + `Titel: ${ctx.matrix.item.title}\n`
          + `Beschreibung: ${ctx.matrix.item.description}\n`
          + `Kriterien:\n${ctx.matrix.item.acceptanceCriteria.map(c => `- ${c}`).join('\n')}`,
      }),

      afterStep: ctx => [
        execGuardrail({
          command: 'vendor/bin/phpstan analyse src',
          maxRetries: 3,
        }),
        execGuardrail({
          command: 'vendor/bin/phpunit',
          maxRetries: 3,
          onMaxRetriesExceeded: 'prompt_user',
        }),
        agentGuardrail({
          name: 'code-review',
          agent: codexAcp({ permissionMode: 'readOnly' }),
          maxRetries: 2,
          bodySchema: z.object({
            findings: z.array(z.string()),
          }),
          prompt: 'Prüfe den aktuellen Git-Diff dieses Slices auf Architektur-Verstöße oder Sicherheitslücken.',
        }),
        execGuardrail({
          command: ['git', 'add', '-A'],
          maxRetries: 1,
        }),
        execGuardrail({
          command: sh`git commit -m ${ctx.step.output.commitMessage}`,
          maxRetries: 1,
        }),
      ],
    },

    {
      id: 'final-review-and-pr',
      name: 'Final Integration and PR Creation',
      if: ctx => ctx.steps['implement-slices'].status === 'passed',

      artifacts: {
        'pr-description.md': { nonEmpty: true },
      },

      beforeStep: [
        execGuardrail({ command: ['git', 'status', '--porcelain'] }),
        execGuardrail({ command: ['git', 'log', '--oneline', '-n', '10'] }),
      ],

      run: claudeAcp({
        permissionMode: 'readOnly',
        prompt: 'Prüfe die Commit-Historie aus dem MCP-Kontext und erstelle über den MCP-Server das Artefakt "pr-description.md" mit einer präzisen Pull-Request-Beschreibung.',
      }),

      afterStep: [
        humanReviewGuardrail({
          prompt: 'Bitte prüfe die generierte PR-Beschreibung ("pr-description.md"). Bei Freigabe (Pass) wird der Branch gepusht.',
        }),
        execGuardrail({
          command: ['git', 'push', '-u', 'origin', 'HEAD'],
        }),
      ],
    },
  ],
})
```
