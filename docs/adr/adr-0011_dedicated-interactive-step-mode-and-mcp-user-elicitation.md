# ADR-0011: Dedicated Interactive Step Mode and MCP User Elicitation

## Status

Accepted

## Context

Previously, human-in-the-loop interaction was modeled exclusively through `humanReviewGuardrail` in `beforeStep` and `afterStep`. Guardrails are pass/fail approval gates, which made collecting structured upfront parameters or letting an agent ask clarifying questions mid-turn awkward.

With `@ludd/cli` upgraded to Pastel, Ink, React, and `@inkjs/ui`, the CLI can now render rich interactive terminal controls (`TextInput`, `Select`, `MultiSelect`, `ConfirmInput`) while preserving `@ludd/core`'s strictly headless runtime (ADR-0002) and crash-safe persistence (ADR-0003).

## Decision

1. **Step-level `interactive` configuration**:
   - Steps accept `interactive?: boolean | { initialQuestions?: InteractiveQuestionMap | ((ctx) => ...), maxQuestions?: number }`.
   - `initialQuestions` is declared as a named record matching `beforeStep` conventions. Answers are inferred onto `ctx.interactive` for `run(ctx)` and `afterStep(ctx)` without implicitly mutating the agent prompt.
   - Execution order within a slice is `beforeStep` → `interactive.initialQuestions` → `run` → `afterStep`.
   - Supported question types: `text`, `number` (with optional `min`/`max`/`default`), `select`, `multi-select`, and `confirm`.

2. **Mid-turn `ask_user` MCP tool**:
   - When `step.interactive` is enabled, the embedded MCP server dynamically exposes an `ask_user` tool and sets `server.requestTimeout = 0` so human think time does not time out in-flight calls.
   - `piAgent` bridges `ask_user` only when `AgentTurnInput.interactive` is `true`.
   - If `maxQuestions` is set and exceeded, `ask_user` returns a tool error (`isError: true`) instructing the agent to proceed with best-effort assumptions instead of failing the step.

3. **Unified gate transport & persistence**:
   - Both `initialQuestions` and `ask_user` suspend via `GateWaiter`, persisting `ActiveGateState` with `gateType: 'user_question'` and `question` in `state.json` and emitting `gate.waiting` / `gate.resolved` ledger events.
   - Answered `initialQuestions` are persisted incrementally in `snapshot.activeInteractiveAnswers` so resumed runs continue from the first unanswered question.
   - Users answer detached or foreground questions via the same `ludd gate <runId>` command (including `--answer <value>` for scripted/non-TTY resolution).
   - In TTY mode, `@ludd/cli` renders `@inkjs/ui` components; in non-TTY / piped stdin mode, it falls back to readline parsing.

## Consequences

- Guardrails remain focused on pass/fail verification and approval gates, while `interactive` provides typed, structured human elicitation.
- Detached runs (`ludd run -d`), crash recovery (`ludd resume`), and headless E2E testing all work uniformly through the existing IPC control socket and state store.
