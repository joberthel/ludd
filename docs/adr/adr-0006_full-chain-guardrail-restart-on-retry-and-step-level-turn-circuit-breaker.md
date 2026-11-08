# **ADR-0006: Full-Chain Guardrail Restart on Retry and Step-Level Turn Circuit Breaker**

| Metadata Field | Value |
| :---- | :---- |
| **ADR ID** | `ADR-0006` |
| **Status** | `Accepted` (Immutable once accepted; supersede via new ADR if changed) |
| **Date** | 2026-11-08 |
| **Decision Owner** | Johannes Berthel |
| **Target Packages** | `@ludd/core`, `@ludd/guardrails` |
| **Related Design Doc** | `ludd — Technical Design Document` (Sections 5.2, 5.7.2, 5.7.3, 6\) |

## **1\. Context and Problem Statement**

Steps in `ludd` validate agent work via an ordered chain of `afterStep` guardrails—for example:

* Guardrail \#0: `phpstan` (Static Analysis)  
* Guardrail \#1: `phpunit` (Unit & Integration Tests)  
* Guardrail \#2: `agentGuardrail` (Security & Architecture Review)

When Guardrail \#0 passes but Guardrail \#1 (phpunit) fails, the harness resumes the agent session to fix the failing test. However, an agent fixing a unit test in Guardrail \#1 frequently introduces a new type error or static analysis violation that breaks Guardrail \#0 (phpstan). Conversely, restarting from index 0 introduces the risk of "ping-pong oscillation" between two guardrails if retry counters reset on intermediate passes.

## **2\. Considered Options**

### **Option A: Resume Only From the Failing Guardrail Index**

When Guardrail \#k fails and the agent completes a fix turn, re-run only Guardrail \#k and continue to \#k+1.

* **Pros:** Saves execution time by not re-running earlier guardrails (\#0 .. \#k-1).  
* **Cons:** Allows silent regressions in earlier guardrails (e.g., passing `phpunit` while committing code that violates `phpstan`), violating **Constraint \#1** (100% Deterministic Verification Enforcement).

### **Option B: Full-Chain Restart from Guardrail Index 0 with Consecutive-Only Retry Counters**

Restart the `afterStep` chain from index 0 after every agent fix turn, resetting a guardrail's retry counter whenever it passes.

* **Pros:** Guarantees that all guardrails pass simultaneously on the final state.  
* **Cons:** Vulnerable to infinite ping-pong loops where fixing Guardrail \#1 breaks Guardrail \#0 and fixing Guardrail \#0 breaks Guardrail \#1 forever.

### **Option C: Full-Chain Restart from Index 0 Bounded by Cumulative Per-Guardrail `maxRetries` and Step-Level `maxTotalTurns` (Chosen)**

Always restart the `afterStep` guardrail chain from index 0 after any self-healing turn, while tracking `maxRetries` cumulatively per guardrail within the active step/slice and enforcing an overarching step-level maxTotalTurns circuit breaker.

* **Pros:** Guarantees zero regressions across the entire verification chain while mathematically bounding worst-case retry loops and hanging processes.  
* **Cons:** Re-executes fast early guardrails (like `phpstan`) after downstream fixes.

## **3\. Decision Outcome**

We adopt **Option C: Full-Chain Restart from Index 0 Bounded by Cumulative Per-Guardrail `maxRetries` and Step-Level `maxTotalTurns`**.

1. **Strict Restart from Guardrail \#0:** Whenever any `afterStep` guardrail returns `fail` and triggers a self-healing agent turn, the subsequent verification pass restarts from the very first guardrail (`index: 0`). A step only advances when every guardrail in the chain passes in a single unbroken pass.  
2. **Cumulative `maxRetries` & Step-Level `maxTotalTurns` Circuit Breaker:** Each guardrail's `maxRetries` counter is tracked cumulatively across the active step or matrix slice (never reset on intermediate passes), and each step enforces a `maxTotalTurns` circuit breaker (e.g., default `15` total self-healing turns per step/slice).  
3. **Interactive Escalation (`onMaxRetriesExceeded: 'prompt_user'`):** Reaching either `maxRetries` or `maxTotalTurns` pauses the runner on `control.sock` so the user can `retry` (with feedback and `addRetries`), force `pass`/`skip`, or `abort`.  
4. **Process Timeout Guard (`timeout` & `onTimeout`):** `execGuardrail` supports a configurable `timeout` in seconds (`timeout?: number`) and `onTimeout?: 'fail' | 'skip' | 'pass'` (defaulting to `'fail'`), terminating hanging process trees (`SIGTERM` \-\> `SIGKILL`) and offloading partial logs to MCP.

## **4\. Consequences & Accepted Trade-Offs**

* **Positive:** It is impossible for a late-stage fix to sneak a broken build past an earlier static analysis gate.  
* **Accepted Trade-Off:** Workflow authors should order fast, cheap checks (`phpstan`, linters) before slower test suites (`phpunit`, `agentGuardrail`) and place side-effecting guardrails (`git commit`) at the very end of the `afterStep` chain.

## **5\. Revisit Triggers**

This decision will be revisited if workflows introduce extremely expensive read-only verification steps at index 0 where content-hash caching of unchanged files could safely skip redundant re-runs.