# **ADR-0008: Declarative Workflow Hygiene over Implicit Framework Magic**

| Metadata Field | Value |
| :---- | :---- |
| **ADR ID** | `ADR-0008` |
| **Status** | `Accepted` (Immutable once accepted; supersede via new ADR if changed) |
| **Date** | 2026-11-08 |
| **Decision Owner** | Johannes Berthel |
| **Target Packages** | `@ludd/core`, `@ludd/guardrails` |
| **Related Design Doc** | `ludd — Technical Design Document` (Sections 2.2, 4.3, 5.6.3, 5.7.2, 5.7.3, 6, 8.1, 9.2) |

## **1\. Context and Problem Statement**

Many agentic frameworks attempt to be "helpful" by performing implicit background actions: automatically committing or resetting Git working trees between steps, wrapping user shell commands in opinionated linters, or silently mutating outputs.

In practice, hidden framework magic makes debugging deterministic pipelines harder, surprises experienced engineers when resuming interrupted runs, and restricts legitimate custom workflows. At the same time, passing AI-generated strings (such as ctx.step.output.commitMessage) into shell commands poses a real risk of unintended POSIX subshell evaluation (\$(), backticks) if interpolated into double-quoted shell strings.

## **2\. Considered Options**

### **Option A: Framework-Imposed Git Checkpoints, Pipeline Linters, and Automatic Magic**

Automatically run git commit or git reset \--hard between matrix slices, enforce static ordering rules on afterStep guardrails, and run heuristic regex filters across all logs.

* **Pros:** Prevents beginners from misordering a `git commit` guardrail.  
* **Cons:** Destroys uncommitted debugging state on crash rehydration; prevents custom Git workflows (e.g., amend workflows or multi-step staging); violates the principle of transparent, predictable execution.

### **Option B: "Declarative Rather Than Imposed" Hygiene \+ Safe Array Command Primitives *(Chosen)***

Never perform hidden Git commits, repository resets, or framework-imposed pipeline linting. Give workflow authors full ownership of their pipeline configuration while providing safe, explicit primitives (such as argv array commands string\[\] and a sh template tag helper in `execGuardrail`).

* **Pros:** 100% transparent execution—nothing happens to the repository unless declared in `harness.config.ts`; eliminates POSIX shell injection when using argv arrays (`['git', 'commit', '-m', ctx.step.output.commitMessage]`).  
* **Cons:** Workflow authors are responsible for placing side-effecting guardrails at the end of `afterStep` chains.

## **3\. Decision Outcome**

We adopt **Option B: "Declarative Rather Than Imposed" Hygiene \+ Safe Array Command Primitives**.

1. **No Implicit Git Magic:** `ludd` never executes hidden `git commit`, `git stash`, or `git reset` commands between steps or sequential matrix slices. Checkpoints are declared explicitly by the workflow author (e.g., requiring `commitMessage` in `outputSchema` and running `git add` / `git commit` in `afterStep` `execGuardrails`).  
2. **Safe Argv Array & `sh` Helper in `execGuardrail`:** To prevent shell-injection or unintended subshell expansion (`$()`, backticks) when passing agent outputs as arguments, `execGuardrail`'s `command` property accepts:  
   * A direct argv array (`string[]` or `(ctx) => string[]`), executed directly without shell interpolation (e.g., `command: (ctx) => ['git', 'commit', '-m', ctx.step.output.commitMessage]`), OR  
   * A shell string (`string` or `(ctx) => string`), accompanied by a safe `sh` template tag helper for escaping interpolated values.  
3. **Documentation-Guided Best Practices over Framework Restrictions:** Rather than imposing rigid framework linters or hidden wrappers, official documentation clearly states author responsibilities regarding:  
   * Placing side-effecting guardrails (`git commit`, `git push`) at the end of `afterStep` chains so full-chain restarts from index 0 do not re-trigger them prematurely.  
   * Never bind-mounting `.harness/runs/` into Docker containers.  
   * Filtering sensitive tokens in custom `execGuardrail` commands or formatters.

## **4\. Consequences & Accepted Trade-Offs**

* **Positive:** Every repository mutation is explicitly visible in `harness.config.ts` and recorded in `ledger.jsonl`.  
* **Positive:** Using argv arrays (`string[]`) completely neutralizes shell injection from LLM-generated strings.  
* **Accepted Trade-Off:** Misconfiguring a non-idempotent command as the first `afterStep` guardrail is the workflow author's responsibility.

## **5\. Revisit Triggers**

This decision will be revisited if users request an *opt-in* convenience helper (e.g., `gitCommitGuardrail()`) that wraps the standard git add \+ git commit array pattern as an explicit, composable guardrail function.