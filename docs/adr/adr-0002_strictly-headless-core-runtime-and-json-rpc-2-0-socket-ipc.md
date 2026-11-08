# **ADR-0002: Strictly Headless Core Runtime and JSON-RPC 2.0 Socket IPC (`control.sock` & `runner.pid`)**

| Metadata Field | Value |
| :---- | :---- |
| **ADR ID** | `ADR-0002` |
| **Status** | `Accepted` (Immutable once accepted; supersede via new ADR if changed) |
| **Date** | 2026-11-08 |
| **Decision Owner** | Johannes Berthel |
| **Target Packages** | `@ludd/core` |
| **Related Design Doc** | `ludd — Technical Design Document` (Sections 2.1, 3, 5.4.1, 5.4.2, 5.5.3, 6, 7.1) |

## **1\. Context and Problem Statement**

Developers want to run multiple `ludd` workflow instances concurrently in the background while inspecting progress, resolving Human-in-the-Loop review gates (humanReviewGuardrail), or handling max-retry escalations (onMaxRetriesExceeded: 'prompt\_user') from different presentation layers—such as a terminal UI (Ink/React TUI), a CLI script, or a desktop GUI.

If the core execution engine is coupled to terminal rendering (stdin/stdout prompts or Ink components), background runs cannot detach cleanly, multiple UIs cannot attach to a paused run, and crashes leave orphaned socket files (EADDRINUSE).

## **2\. Considered Options**

### **Option A: Monolithic Terminal Runner (Coupled CLI/TUI \+ Engine)**

Run the workflow engine directly inside the interactive TUI/CLI process and prompt the user via standard input (`process.stdin`).

* **Pros:** Simple initial implementation without inter-process communication (IPC).  
* **Cons:** Closing the terminal kills the workflow; impossible to attach a desktop GUI or secondary TUI to an already running background workflow; violates separation of concerns.

### **Option B: Central Daemon / Background Server Process**

Run a single global background daemon managing all active runs in memory over a fixed local TCP port.

* **Pros:** Single point of contact for UI clients.  
* **Cons:** A crash in the central daemon kills all concurrent runs; requires managing a global daemon lifecycle and port registry.

### **Option C: Per-Run Headless Process with Unix Domain Socket JSON-RPC 2.0 IPC & PID Tracking (Chosen)**

Keep `@ludd/core` 100% headless. Each workflow run executes as an independent OS process that listens on a scoped Unix Domain Socket (`.harness/runs/<runId>/control.sock`, or Named Pipe on Windows) and tracks its process liveness via `.harness/runs/<runId>/runner.pid`.

* **Pros:** Complete isolation between concurrent runs; 0% CPU consumption while paused at gates; any frontend (TUI, GUI, CLI) can connect, disconnect, and reconnect at will; stale sockets after crashes are reliably detected via `runner.pid`.  
* **Cons:** Requires implementing a JSON-RPC 2.0 server/client over Unix sockets and PID liveness checks.

## **3\. Decision Outcome**

We adopt **Option C: Per-Run Headless Process with Unix Domain Socket JSON-RPC 2.0 IPC & PID Tracking**.

* **Zero UI Dependencies in `@ludd/core`:** The core runtime never renders UI or reads interactive prompts from `stdin`. Resource cleanup (`teardown(runId)`) and batch garbage collection (`gc({ olderThan, status, ... })`) are exposed as programmatic headless APIs.  
* **0% CPU Waiting on `control.sock`:** When paused at a `humanReviewGuardrail` or escalation prompt, the Node.js runner awaits an unresolved `Promise` at 0% CPU while listening on `.harness/runs/<runId>/control.sock`.  
* **Standardized JSON-RPC 2.0 Method Contract:**  
  * `run.status`: Returns the current `state.json` snapshot alongside active gate details.  
  * `gate.resolve`: Params `{ stepId, guardrailIndex?, action: 'pass' | 'fail' | 'retry' | 'skip' | 'abort', feedback?: string, addRetries?: number }`.  
  * `run.abort`: Params `{ reason?: string, teardown?: boolean }`.  
  * `run.teardown`: Params `{ force?: boolean }`.  
* **Process Liveness & Stale Socket Recovery (`runner.pid`):** On startup, the runner writes its OS PID to `.harness/runs/<runId>/runner.pid`. Before binding `control.sock` or rehydrating a run (and when frontends scan `.harness/runs/*`), the system checks whether the PID is alive (`process.kill(pid, 0)`). If dead, stale `control.sock` and `runner.pid` files are unlinked; if alive, duplicate startup is aborted to prevent split-brain execution.

## **4\. Consequences & Accepted Trade-Offs**

* **Positive:** TUI, CLI, and GUI frontends are pure stateless views over `.harness/runs/<runId>/` files and `control.sock`.  
* **Positive:** Abrupt process kills (`SIGKILL`) never permanently brick a run directory with `EADDRINUSE`.  
* **Accepted Trade-Off:** Windows compatibility requires abstracting Unix Domain Sockets behind Windows Named Pipes (`\\.\pipe\...`).

## **5\. Revisit Triggers**

This decision will be revisited if OS-level socket limits or cross-platform Named Pipe differences cause friction when running more than 50 concurrent workflows on a single host.