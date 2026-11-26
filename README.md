# ludd

A deterministic code harness that orchestrates AI-driven agents.

## Packages

- `@luddjs/core`: Headless workflow state machine, IPC server, embedded MCP server, explicit host execution (`cwd`/`env`, `setup`/`teardown`, `spawn`), `teardownRun`, and filesystem-only `gc`
- `@luddjs/agents`: ACP-standardized agent runner adapters (`acpAgent`, presets `claudeAcp`, `codexAcp`, `agyAcp`) and deterministic `mockAgent` for tests
- `@luddjs/guardrails`: Deterministic and AI verification guardrails (`execGuardrail`, `fnGuardrail`, `agentGuardrail`, `humanReviewGuardrail`)
- `@luddjs/cli`: Terminal runner, interactive gate controls, `abort`, `teardown`, `gc`, and `mcp-bridge` commands

## ACP Agents & Guardrails

`@luddjs/agents` standardizes on the open **Agent Client Protocol (ACP)** over `stdio` via `acpAgent` and thin CLI presets (`claudeAcp`, `codexAcp`, `agyAcp`):

- **Permission modes (`AcpPermissionMode`):** `'readOnly' | 'acceptEdits' | 'bypassPermissions'` evaluated during ACP `session/request_permission` handling.
- **Session resumption without fallback:** During `initialize`, `acpAgent` checks `agentCapabilities.loadSession`. When supported and a previous `sessionId` is provided, it resumes via `session/load`; otherwise it starts a fresh `session/new` without synthetic fallback.
- **Clean cancellation:** Aborting a run (`AbortSignal` / `ludd abort`) sends ACP `session/cancel` for the active session before terminating the subprocess on timeout.
- **MCP via `ludd mcp-bridge`:** When the embedded core MCP server is active, `acpAgent` attaches a `stdio` MCP server entry (`ludd mcp-bridge --endpoint <url>`) authenticated via `LUDD_MCP_TOKEN`, giving external ACP agents access to artifacts, paginated logs, and interactive `ask_user` gates.
- **Explicit `agent` in `agentGuardrail`:** `agentGuardrail({ name, agent, prompt })` requires an explicit `AgentRunner` (such as `codexAcp({ permissionMode: 'readOnly' })`).

<!-- eslint-skip -->
```ts
import { claudeAcp, codexAcp } from '@luddjs/agents'
import { createHarness } from '@luddjs/core'
import { agentGuardrail, execGuardrail } from '@luddjs/guardrails'
import { z } from 'zod'

export default createHarness('acp-example')
  .step({
    id: 'implement',
    run: claudeAcp({
      permissionMode: 'acceptEdits',
      prompt: 'Implement the requested feature and summarize the changes.',
    }),
    outputSchema: z.object({
      summary: z.string(),
    }),
    afterStep: ctx => [
      execGuardrail({ name: 'Tests', command: 'pnpm test' }),
      agentGuardrail({
        name: 'code-review',
        agent: codexAcp({ permissionMode: 'readOnly' }),
        prompt: `Review the changes for: ${ctx.step.output.summary}`,
      }),
    ],
  })
  .build()
```

## Host Execution & DIY Git Worktree Isolation

Workflows execute directly on the host without a separate environment adapter layer (`@luddjs/environments` was removed in [ADR-0013](./docs/adr/adr-0013_removal-of-ludd-environments-and-simplification-to-explicit-host-execution.md)). You control working directories and environment variables explicitly via `cwd` and `env` on `defineHarness` / `createHarness`, individual steps, and `execGuardrail` / `agentGuardrail` overrides.

For isolated parallel runs (such as per-run Git worktrees), define optional `setup` and `teardown` lifecycle hooks in `harness.config.ts`:

<!-- eslint-skip -->
```ts
import path from 'node:path'
import { createHarness, spawn } from '@luddjs/core'

export default createHarness('my-workflow', {
  env: ctx => ({
    DB_DATABASE: `test_run_${ctx.runId}`,
  }),
  async setup({ runId, workspaceRoot, signal }) {
    const worktreeDir = path.resolve(workspaceRoot, '.harness', 'worktrees', runId)
    const res = await spawn({
      command: 'git',
      args: ['worktree', 'add', '-b', `ludd/${runId}`, worktreeDir, 'HEAD'],
      cwd: workspaceRoot,
      signal,
    })
    if (res.exitCode !== 0) {
      throw new Error(`Failed to create worktree: ${res.stderr}`)
    }
    return { cwd: worktreeDir }
  },
  async teardown({ runId, workspaceRoot, signal }) {
    const worktreeDir = path.resolve(workspaceRoot, '.harness', 'worktrees', runId)
    await spawn({
      command: 'git',
      args: ['worktree', 'remove', '--force', worktreeDir],
      cwd: workspaceRoot,
      signal,
    })
  },
})
  .step({
    id: 'check',
    run: async () => 'ok',
  })
  .build()
```

- `setup(ctx)` receives `{ runId, workspaceRoot, signal }` and may return `{ cwd?, env? }` inherited by all steps (step-level `cwd` resolves relative to run-level `cwd`, and `env` merges over run-level `env`).
- `teardown(ctx)` is guaranteed to execute on run completion, failure, `AbortSignal` / `ludd abort` cancellation (with a non-aborted `signal` so cleanup commands succeed), or explicit `ludd teardown`.

## Running the CLI

Build the monorepo first so the `@luddjs/cli` binary (`packages/cli/dist/bin.js`) is up to date:

```bash
pnpm build
```

Then invoke the CLI via `pnpm ludd`:

```bash
# Inspect available commands and options
pnpm ludd --help

# Run using harness.config.ts in the current directory (or pass a config path)
pnpm ludd run
pnpm ludd run path/to/harness.config.ts

# Inspect, resume, abort, tear down, or garbage-collect runs
pnpm ludd status
pnpm ludd resume <run-id>
pnpm ludd abort <run-id> --teardown
pnpm ludd teardown <run-id>
pnpm ludd gc
```

`ludd gc` performs filesystem-only pruning of inactive `.harness/runs/<run-id>/` directories and never inspects or deletes external directories or worktrees.
