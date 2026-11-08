# **ADR-0001: Code-First TypeScript and Zod Workflow Configuration (`harness.config.ts`)**

| Metadata Field | Value |
| :---- | :---- |
| **ADR ID** | `ADR-0001` |
| **Status** | `Accepted` (Immutable once accepted; supersede via new ADR if changed) |
| **Date** | 2026-11-08 |
| **Decision Owner** | Johannes Berthel |
| **Target Packages** | `@ludd/core`, `@ludd/agents`, `@ludd/environments`, `@ludd/guardrails` |
| **Related Design Doc** | `ludd — Technical Design Document` (Sections 1.2, 2.2, 3, 5.3.2, 5.4.4, 9.2) |

## **1\. Context and Problem Statement**

Workflow orchestrators and CI/CD pipelines traditionally define execution graphs in static configuration formats such as YAML or JSON (e.g., GitHub Actions, GitLab CI). However, orchestrating AI coding agents within ludd requires rich, dynamic contracts between steps:

* Steps must enforce structured input/output contracts and validate artifacts (`spec.md`, `todos.json`) at runtime.  
* Step properties (`prompt`, `environment`, `sessionId`, `if` predicates, and `execGuardrail` commands) frequently depend on the strongly typed output of prior steps or the current cursor of a sequential matrix (`StepContext`).  
* Teams want to compose reusable step sequences (such as triage flows or PR creation steps) and read CLI arguments or files without learning a proprietary templating language or custom expression parser.

We need to decide how users author, type-check, and compose `ludd` workflows.

## **2\. Considered Options**

### **Option A: YAML / JSON DSL with Custom Expression Interpolation**

Define workflows in .harness/workflow.yaml using custom string expressions (e.g., \${{ steps.triage.output.sessionId }}) and JSON Schema files for validation.

* **Pros:** Language-agnostic; familiar to users of GitHub Actions.  
* **Cons:** Requires building and maintaining a proprietary expression parser and sub-workflow engine; no compile-time type safety or IDE autocompletion across step outputs; awkward inline callback logic.

### **Option B: Code-First TypeScript Configuration (`harness.config.ts`) with Zod Schemas *(Chosen)***

Define workflows in standard TypeScript via a `defineHarness()` factory helper from `@ludd/core`, using `zod` schemas for runtime and compile-time validation and a unified T \| ((ctx: StepContext) \=\> T \| Promise\<T\>) callback pattern.

* **Pros:** Full end-to-end TypeScript type inference across `ctx.steps`, `ctx.step.output`, `ctx.environments`, and `ctx.matrix`; native composition using standard TypeScript functions and array spread operators; zero custom DSL parser maintenance; native access to Node.js APIs.  
* **Cons:** Requires a TypeScript/Node.js runtime to load `harness.config.ts`; slightly higher barrier to entry for non-TypeScript users.

## **3\. Decision Outcome**

We adopt **Option B: Code-First TypeScript Configuration (`harness.config.ts`) with Zod Schemas**.

1. **Single Entrypoint (`defineHarness()`):** Every workflow is authored in TypeScript and exported via `defineHarness()` from `@ludd/core`.  
2. **Polymorphic Step Execution (`run`) & Conditional Predicates (`if`):** Each step's `run` property accepts either an agent adapter instance (`piAgent(...)`) or a deterministic TypeScript function (`async (ctx) => { ... }`). Step execution can be gated via `if: (ctx) => boolean | Promise<boolean>`.  
3. **Unified Dynamic Callback Contract (`StepContext`):** Configuration properties across steps, agents, and guardrails support `T | ((ctx: StepContext) => T | Promise<T>)`, where `ctx` exposes `runId`, `environments`, `steps`, `step`, `matrix`, and `artifacts`.  
4. **Native Composition:** Reusable workflow fragments are composed via standard TypeScript helper functions and array spread operators—`ludd` will never implement a proprietary YAML DSL or sub-workflow templating engine.

## **4\. Consequences & Accepted Trade-Offs**

* **Positive:** Workflow authors get immediate IDE autocompletion and compile-time errors if a downstream step references a non-existent property on an upstream step's `outputSchema`.  
* **Positive:** Eliminates an entire class of string-interpolation and YAML-indentation bugs.  
* **Accepted Trade-Off:** `@ludd/core` must bundle or invoke a TypeScript loader to evaluate `harness.config.ts` at startup, and workflow authors must write valid TypeScript code.

## **5\. Revisit Triggers**

This decision will only be revisited if:

* External, non-TypeScript consumers require generating workflows dynamically from a language-agnostic JSON representation that cannot be trivially wrapped by a thin `harness.config.ts` adapter.

