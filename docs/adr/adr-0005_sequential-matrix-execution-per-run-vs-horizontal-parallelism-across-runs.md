# **ADR-0005: Sequential Matrix Execution per Run vs. Horizontal Parallelism across Runs**

| Metadata Field | Value |
| :---- | :---- |
| **ADR ID** | `ADR-0005` |
| **Status** | `Accepted` (Immutable once accepted; supersede via new ADR if changed) |
| **Date** | 2026-11-08 |
| **Decision Owner** | Johannes Berthel |
| **Target Packages** | `@ludd/core`, `@ludd/environments` |
| **Related Design Doc** | `ludd — Technical Design Document` (Sections 1.1, 3.1, 5.5.1, 9.1, 9.2) |

## **1\. Context and Problem Statement**

Complex features are typically decomposed during the specification step into an ordered list of vertical implementation slices (e.g., stored in the `todos.json` MCP artifact). At the same time, developers want to parallelize their engineering throughput by working on multiple features or issues simultaneously.

If a single workflow run spawns parallel sub-agents to implement multiple slices of the same feature concurrently against the same branch or codebase, those slices inevitably edit overlapping files, break each other's types, and create severe Git merge conflicts.

## **2\. Considered Options**

### **Option A: Parallel Fan-Out Matrix Within a Single Workflow Run**

Spawn \$N\$ concurrent containers/worktrees for the \$N\$ slices in todos.json within the same \<runId\> and attempt an automated Git merge step at the end.

* **Pros:** Theoretical wall-clock speedup for a single feature if slices are 100% orthogonal.  
* **Cons:** In real-world codebases, vertical slices of the same feature touch shared models, routes, DI containers, or tests; automated Git merges frequently fail or produce broken combined code that neither slice tested.

### **Option B: Sequential Matrix Execution Within a Run (`<runId>`) \+ Horizontal Parallelism Across Independent Runs *(Chosen)***

Execute `matrix` items (`itemsFromArtifact: 'todos.json'`) **strictly sequentially** within the single run's reused isolated environment, while scaling throughput horizontally by running multiple independent `<runId>` workflow instances in parallel.

* **Pros:** Each slice builds cleanly on top of the committed, verified state of the previous slice; zero internal Git merge conflicts; zero container re-provisioning overhead between slices; full horizontal scalability across separate issues/features.  
* **Cons:** A 5-slice feature within a single `<runId>` executes slices 1 through 5 one after another.

## **3\. Decision Outcome**

We adopt **Option B: Sequential Matrix Execution Within a Run (`<runId>`) \+ Horizontal Parallelism Across Independent Runs**.

1. **Sequential Intra-Run Matrix Loop:** When a step declares `matrix: { itemsFromArtifact: 'todos.json' }`, the state machine iterates over the array items sequentially (`index: 0 .. total - 1`) inside the step's provisioned environment.  
2. **Typed Matrix Context (`ctx.matrix`):** Each iteration exposes `{ index, total, item }` on `StepContext`, tracks `matrixIndex` in `state.json` for exact crash recovery, and runs the full `afterStep` verification and commit chain before advancing to `index + 1`.  
3. **Horizontal Inter-Run Parallelism:** Parallelism is achieved by launching multiple independent `<runId>` instances concurrently, each isolated via `.harness/runs/<runId>/`, dedicated Git worktrees/containers, isolated DB schemas (`test_run_<runId>`), and ephemeral ports.

## **4\. Consequences & Accepted Trade-Offs**

* **Positive:** Eliminates merge conflict resolution agents and non-deterministic integration failures between slices of the same feature.  
* **Positive:** Every matrix slice is verified (`phpstan`, `phpunit`, `agentGuardrail`) and committed onto a linear Git history before the next slice begins.  
* **Accepted Trade-Off:** Decomposition prompts in Step 2 (`generate-spec-and-todos`) must order slices logically so foundational slices execute first.

## **5\. Revisit Triggers**

This decision will be revisited if a future use case requires read-only parallel fan-out matrices (e.g., running 5 independent read-only audit agents across different repository modules where no files are mutated).