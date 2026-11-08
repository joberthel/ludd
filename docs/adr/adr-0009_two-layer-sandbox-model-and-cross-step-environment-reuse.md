# **Architecture Decision Record: Two-Layer Sandbox Model and Cross-Step Environment Reuse**

| Metadata Field | Value |
| :---- | :---- |
| **ADR ID** | `ADR-0009` |
| **Status** | `Accepted` (Immutable once accepted; supersede via new ADR if changed) |
| **Date** | 2026-11-08 |
| **Decision Owner** | Johannes Berthel |
| **Target Packages** | `@ludd/core`, `@ludd/agents`, `@ludd/environments`, `@ludd/guardrails` |
| **Related Design Doc** | `ludd — Technical Design Document` (Sections 3.1, 4.1, 5.5.1, 5.6.1, 5.7.3) |

## **1\. Context and Problem Statement**

A typical multi-step engineering workflow transitions through distinct trust and access phases:

* **Phase 1 (Triage & Specification):** The agent inspects code and writes specifications (`spec.md`, `todos.json`) but must be prevented from modifying source files.  
* **Phase 2 (Implementation):** The agent modifies source code, runs build tools, and potentially installs dependencies inside an isolated sandbox.  
* **Phase 3 (Verification via `agentGuardrail`):** A secondary review agent inspects the Git diff in read-only mode.

If every step or agentGuardrail provisions a brand-new Docker container or clones the filesystem from scratch, pipeline latency and disk usage skyrocket. Conversely, if access control is coupled solely to the physical environment, switching between read-only triage and read-write implementation on the same workspace becomes impossible.

## **2\. Considered Options**

### **Option A: Ephemeral Container per Step and per Guardrail**

Provision a fresh container/worktree for every single step and clone the environment for every `agentGuardrail`.

* **Pros:** Simple lifecycle per step.  
* **Cons:** Massive provisioning overhead (tens of seconds per step/guardrail); loses installed dependencies or warm build caches between steps; requires copying files between steps.

### **Option B: Decoupled Two-Layer Sandbox Model with Cross-Step Environment Reuse (Chosen)**

Separate logical SDK-level file access modes (mode: 'read-only' \| 'workspace-write') from physical environment isolation (`@ludd/environments` adapters \+ optional `dangerMode`), and track provisioned environments in `state.json` so downstream steps and agentGuardrail instances can reuse them with zero provisioning overhead.

* **Pros:** A single `dockerWorktreeEnv({ id: 'feature-env' })` can be provisioned once in Step 1, used in `read-only` mode for Triage/Spec, switched to `workspace-write` mode in Step 3 (`implement-slices`), and reused in `read-only` mode by `agentGuardrail`—all with zero container re-provisioning or filesystem cloning overhead.  
* **Cons:** Requires tracking environment IDs and lifecycle state in `state.json`.

## **3\. Decision Outcome**

We adopt **Option B: Decoupled Two-Layer Sandbox Model with Cross-Step Environment Reuse**.

1. **Layer 1 — Logical SDK Access Modes (`read-only` vs. `workspace-write`):** Configured per agent invocation (`piAgent({ mode })` or `agentGuardrail({ mode })`). In `read-only` mode, the SDK blocks workspace file mutations while allowing MCP artifact writes.  
2. **Layer 2 — Pluggable Physical Isolation & `dangerMode`:** Provisioned via modular Environment Adapters (`hostEnv`, `gitWorktreeEnv`, `dockerWorktreeEnv`, Docker Compose, VMs). Inside disposable container/VM sandboxes, steps can explicitly enable `dangerMode` for administrative/package-install privileges without risking the host. `.harness/runs/` is blacklisted at the SDK level.  
3. **Cross-Step & `agentGuardrail` Environment Reuse:** Provisioned environments are indexed by `id` in `state.json` and exposed via `ctx.environments['<id>']`. By default, `agentGuardrail` reuses its parent step's environment with SDK `mode: 'read-only'` for zero provisioning overhead (only cloning when explicitly configured).  
4. **Declarative Cleanup (`cleanupPolicy`):** Environments remain alive by default (`keep`) for post-run debugging and are torn down declaratively via `cleanupPolicy` or the headless `teardown(runId)` / `gc()` APIs.

## **4\. Consequences & Accepted Trade-Offs**

* **Positive:** Sub-second transitions between read-only specification steps, read-write implementation steps, and read-only AI code review guardrails within the same warm container/worktree.  
* **Accepted Trade-Off:** Because `cleanupPolicy: { onSuccess: 'keep', onFailure: 'keep' }` preserves environments for inspection, external consumers must periodically invoke the headless `gc()` API to reclaim disk and container resources.

## **5\. Revisit Triggers**

This decision will be revisited if parallel `agentGuardrail` execution is introduced in the future where one guardrail mutates temporary build files while another reads the workspace.