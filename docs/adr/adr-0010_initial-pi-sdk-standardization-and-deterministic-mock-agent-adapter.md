# **ADR-0010: Initial Pi SDK Standardization and Deterministic Mock Agent Adapter**

| Metadata Field | Value |
| :---- | :---- |
| **ADR ID** | `ADR-0010` |
| **Status** | `Accepted` (Immutable once accepted; supersede via new ADR if changed) |
| **Date** | 2026-11-08 |
| **Decision Owner** | Johannes Berthel |
| **Target Packages** | `@ludd/agents`, `@ludd/core` |
| **Related Design Doc** | `ludd — Technical Design Document` (Sections 2.2, 5.4.4, 8.2, 10.1) |

## **1\. Context and Problem Statement**

The AI coding agent ecosystem includes multiple SDKs and CLI runtimes (Pi SDK, Claude Code SDK, OpenAI Codex CLI, custom MCP agents). Attempting to build, test, and maintain adapters for four different agent runtimes simultaneously during v0.1 of ludd would fragment engineering effort and delay validation of the core state machine.

Furthermore, testing the `@ludd/core` orchestrator itself—especially sequential matrix loops, full-chain guardrail restarts from index 0, maxTotalTurns circuit breakers, and mid-step crash rehydration—cannot rely on live cloud LLM API calls, which are slow, expensive, and non-deterministic.

## **2\. Considered Options**

### **Option A: Multi-SDK Support From Day 1 \+ Live LLM Integration Tests**

Build adapters for Pi, Claude Code, and OpenAI simultaneously in @ludd/agents and run integration tests against live LLM endpoints.

* **Pros:** Early validation of multi-SDK abstractions.  
* **Cons:** High upfront maintenance burden; slow, flaky, and costly CI test runs that fail due to LLM variance rather than orchestrator bugs.

### **Option B: Standardize Initially on Pi SDK (`piAgent`) \+ Deterministic `mockAgent` Adapter *(Chosen)***

Focus production agent integration in v0.1 strictly on the Pi SDK (piAgent in @ludd/agents) behind a clean adapter contract, accompanied by a deterministic **`mockAgent`** adapter for millisecond-fast unit and end-to-end crash-rehydration testing.

* **Pros:** Concentrates engineering effort on perfecting one production SDK integration (session resumption, `read-only` vs. `workspace-write` modes, MCP tool calls, token stream splitting) while enabling 100% deterministic, zero-cost CI testing of `@ludd/core` via `mockAgent`.  
* **Cons:** Users wanting a different agent runtime must wait for a post-v0.1 adapter implementation.

## **3\. Decision Outcome**

We adopt **Option B: Standardize Initially on Pi SDK (`piAgent`) \+ Deterministic `mockAgent` Adapter**.

1. **Pi SDK First (`piAgent`):** `@ludd/agents` v0.1 standardizes strictly around the Pi SDK for production workflows, supporting `mode: 'read-only' | 'workspace-write'`, declarative `sessionId` capture and resumption, structured Zod `outputSchema` enforcement, and per-session telemetry streaming (`streams/<sessionId>.jsonl`).  
2. **Deterministic `mockAgent` for Orchestrator Testing:** `@ludd/agents` provides a first-class `mockAgent` implementation that replays scripted outputs, MCP tool calls (`put_artifact`), and simulated failures. This allows the state machine, sequential matrix engine, self-healing guardrail loops, and end-to-end crash-rehydration tests to execute deterministically in milliseconds without network or LLM dependencies.  
3. **Adapter-Specific Environment Testing:** Alongside `mockAgent`, execution environments (`hostEnv`, `gitWorktreeEnv`, `dockerWorktreeEnv`, VMs) are tested via targeted adapter-specific tests rather than a rigid cross-adapter test suite.

## **4\. Consequences & Accepted Trade-Offs**

* **Positive:** `@ludd/core` and `@ludd/guardrails` can be developed and verified with 100% deterministic unit and crash-recovery tests running in milliseconds.  
* **Accepted Trade-Off:** Some internal assumptions in `@ludd/agents` around `sessionId` lifecycle or access modes may need minor refinement when a second production SDK is added later.

## **5\. Revisit Triggers**

This decision will be revisited once the first 3 production workflows are running reliably on `@ludd/*` with the Pi SDK, or when a concrete requirement arises to plug in a second production agent runtime.