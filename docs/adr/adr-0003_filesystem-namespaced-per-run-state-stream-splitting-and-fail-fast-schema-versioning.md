# **ADR-0003: Filesystem-Namespaced Per-Run State, Stream Splitting, and Fail-Fast Schema Versioning**

| Metadata Field | Value |
| :---- | :---- |
| **ADR ID** | `ADR-0003` |
| **Status** | `Accepted` (Immutable once accepted; supersede via new ADR if changed) |
| **Date** | 2026-11-08 |
| **Decision Owner** | Johannes Berthel |
| **Target Packages** | `@ludd/core`, `@ludd/agents` |
| **Related Design Doc** | `ludd — Technical Design Document` (Sections 2.2, 5.2, 5.4.2, 6, 7.1) |

## **1\. Context and Problem Statement**

When multiple `ludd` workflow runners execute in parallel within the same project workspace, they must persist execution state for crash rehydration and emit real-time telemetry for external UIs without locking a shared database or corrupting files on abrupt termination (SIGKILL, OOM, power loss). Furthermore, high-frequency token-level agent telemetry (thoughts, live tool calls, message chunks) can easily reach megabytes per session, which would bloat the main state transition ledger if written to a single file.

## **2\. Considered Options**

### **Option A: Embedded SQLite Database (.harness/state.db)**

Store all runs, events, and agent telemetry in a shared local SQLite database.

* **Pros:** Relational queries across runs; ACID transactions.  
* **Cons:** Introduces `SQLITE_BUSY` lock contention across parallel runners; requires native binary bindings; harder for lightweight CLI/TUI tools to tail via simple file streams; requires schema migration scripts.

### **Option B: Single Monolithic JSON Log per Run**

Write all state transitions and token-level agent streaming chunks into a single .harness/runs/\<runId\>/events.jsonl file.

* **Pros:** Simple single-file structure.  
* **Cons:** Token-level telemetry bloats the lifecycle log, making it slow for frontends to parse high-level step/gate status across 20 parallel runs.

### **Option C: Scoped Per-Run Filesystem Directory with Atomic `state.json`, Split JSONL Streams, and Fail-Fast `schemaVersion` *(Chosen)***

Isolate every run under `.harness/runs/<runId>/` using atomic write-and-rename snapshots (`state.json`), an append-only lifecycle ledger (`ledger.jsonl`), dedicated per-session agent telemetry streams (streams/\<sessionId\>.jsonl), and strict fail-fast schemaVersion validation.

* **Pros:** Zero lock contention across concurrent runs; immune to partial JSON corruption on `SIGKILL`; fast high-level UI rendering via `ledger.jsonl` with on-demand deep inspection via `streams/<sessionId>.jsonl`.  
* **Cons:** Creates multiple files per run on disk (mitigated by the headless `gc()` API).

## **3\. Decision Outcome**

We adopt **Option C: Scoped Per-Run Filesystem Directory with Atomic `state.json`, Split JSONL Streams, and Fail-Fast `schemaVersion`**.

1. **Strict Per-Run Namespacing (`.harness/runs/<runId>/`):** Every workflow run receives a unique `runId`. Parallel runners never share mutable files.  
2. **Atomic `state.json` Snapshots & Rehydration Health Checks:** After every state transition, `state.json` is written to `state.json.tmp` and atomically renamed via `fs.renameSync('state.json')`. On crash rehydration, the orchestrator runs `adapter.ping()` on all referenced environments in `state.json` before resuming at the saved `stepId`, `matrixIndex`, and `sessionId`.  
3. **Stream Splitting (`ledger.jsonl` vs. `streams/<sessionId>.jsonl`):**  
   * `ledger.jsonl` records only high-level lifecycle events (`{ schemaVersion, timestamp, runId, stepId, matrixIndex?, eventType, payload }`).  
   * Token-level agent activity is written to `.harness/runs/<runId>/streams/<sessionId>.jsonl`, referenced by a lightweight pointer event in `ledger.jsonl`.  
4. **Strict Fail-Fast `schemaVersion` (No Migrations):** Both `state.json` and `ledger.jsonl` entries carry `"schemaVersion": 1`. If a runner or frontend encounters an incompatible `schemaVersion` (older or newer), it throws an immediate fail-fast version mismatch error rather than maintaining complex schema migration code.

## **4\. Consequences & Accepted Trade-Offs**

* **Positive:** External UIs can render a dashboard of 50 parallel runs by reading tiny `state.json` and `ledger.jsonl` files, only tailing `streams/<sessionId>.jsonl` for the single run currently focused by the user.  
* **Accepted Trade-Off:** Upgrading `@ludd/core` with a breaking `schemaVersion` bump requires finishing or discarding existing paused runs rather than auto-migrating their `state.json`.

## **5\. Revisit Triggers**

This decision will be revisited if `@ludd/core` reaches a stable `v1.0` release where users require long-term backward-compatible state migrations across minor version upgrades.