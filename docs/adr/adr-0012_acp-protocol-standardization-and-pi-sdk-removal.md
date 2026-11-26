# **ADR-0012: ACP Protocol Standardization and Pi SDK Removal**

| Property | Value |
| :---- | :---- |
| **Status** | Accepted |
| **Date** | 2026-11-23 |
| **Supersedes** | [ADR-0010](./adr-0010_initial-pi-sdk-standardization-and-deterministic-mock-agent-adapter.md) (Initial Pi SDK Standardization and Deterministic Mock Agent Adapter) |
| **Amends** | [ADR-0004](./adr-0004_embedded-http-sse-mcp-server-for-validated-artifacts-and-format-aware-paginated-logs.md) (MCP Transport), [ADR-0006](./adr-0006_full-chain-guardrail-restart-on-retry-and-step-level-turn-circuit-breaker.md) (Step-Level Turn Circuit Breaker), [ADR-0009](./adr-0009_two-layer-sandbox-model-and-cross-step-environment-reuse.md) (Agent Sandboxing) |
| **Affected Packages** | `@luddjs/agents`, `@luddjs/core`, `@luddjs/guardrails`, `@luddjs/cli` |

## **1\. Context and Motivation**

Currently, `@luddjs/agents` is coupled in-process to the Pi SDK (ADR-0010). This tight coupling has introduced substantial integration and maintenance overhead across the monorepo:

* A dedicated Pi-specific MCP tool bridge (`packages/agents/src/mcp/pi-mcp-tools.ts`),  
* Extensive security and sandboxing extensions inside the agents package (`environment-bash.ts`, `read-only-extension.ts`, `workspace-write-extension.ts`, `workspace-path-guard.ts`),  
* Agent-specific telemetry and turn-counting logic in `@luddjs/core` and `@luddjs/guardrails`, and  
* An implicit Pi default agent baked into `@luddjs/guardrails`.

To connect modern coding agents such as **Agy**, **Claude**, and **Codex** without maintaining bespoke proprietary adapters—and to significantly lean out the codebase—`@luddjs/agents` will standardize entirely on the open **Agent Client Protocol (ACP)** (JSON-RPC 2.0 over `stdio`). Direct Pi SDK support will be removed completely as part of this migration.

## **2\. Architectural Decisions**

### **2.1 Standardization on ACP and Removal of the Pi SDK**

* `@luddjs/agents` exposes a single production agent adapter, `acpAgent` (built on `@agentclientprotocol/sdk`), which manages external ACP-compatible CLIs as subprocesses (`initialize`, `session/new`, `session/load`, `session/prompt`, `session/cancel`).  
* Thin configuration presets (`claudeAcp`, `codexAcp`, `agyAcp`) and the generic entry point (`acpAgent`) are provided for common agents. These presets contain no protocol logic of their own and only encapsulate default commands (`'claude'`, `'codex'`, `'agy'`), arguments (`['--acp']`), and options (`AcpPresetOptions`).  
* The entire Pi integration (`pi-agent.ts`, `types/pi-sdk.ts`, `mcp/pi-mcp-tools.ts`, and all associated tests) is removed.  
* `mock-agent.ts` remains as the fast, deterministic test adapter for unit and core test suites. For end-to-end tests, `packages/core/e2e/epic-08-fake-pi.ts` is replaced with a lightweight fake ACP server communicating over `stdio` (`packages/core/e2e/epic-08-fake-acp.ts` and `packages/core/e2e/epic-08-fake-acp-server.mjs`).

### **2.2 Relaxing Agent Sandboxing and Delegating to ACP (Amendment to ADR-0009)**

* In-process enforcement of filesystem, write, and shell restrictions within `@luddjs/agents` is discontinued.  
* The entire `packages/agents/src/security/` directory (`environment-bash.ts`, `read-only-extension.ts`, `workspace-write-extension.ts`, `workspace-path-guard.ts`, and their tests) is removed.  
* Permission boundaries (`AcpPermissionMode`: `'readOnly' | 'acceptEdits' | 'bypassPermissions'`) are passed through to ACP `session/request_permission` handling (`packages/agents/src/acp-permissions.ts`). The harness intentionally avoids duplicating complex isolation wrappers around external agent runtimes.

### **2.3 MCP Integration via `stdio` Bridge (Amendment to ADR-0004)**

* In ACP v1, only the `stdio` transport is mandatory for `mcpServers`, whereas HTTP/SSE transports are optional capabilities. Consequently, `acpAgent` passes the Ludd MCP server (`AgentMcpConnection`) to ACP sessions using the `stdio` transport.  
* **Process-boundary architecture:** Because the external ACP agent spawns a `stdio` MCP server as its own child process, that process has no direct access to the in-memory state of the running `ludd` worker process—most notably for human gates and interactive user elicitation in `mcp-interactive-tools.ts` (ADR-0011).  
* **Solution:** The existing embedded MCP server in `@luddjs/core` (`packages/core/src/mcp/mcp-server.ts`) remains the single source of truth. A minimal `stdio` proxy entry point (`ludd mcp-bridge` in `packages/cli/src/mcp-bridge/`) is spawned by the ACP agent and transparently forwards newline-delimited JSON-RPC messages between `stdin`/`stdout` and the running local core HTTP MCP endpoint (authenticated via `LUDD_MCP_TOKEN`).  
* The Pi-specific MCP bridge (`pi-mcp-tools.ts`) is removed completely.

### **2.4 Removal of Agent Telemetry and Step-Level Turn Circuit Breaker (Amendment to ADR-0006)**

* **Telemetry:** Because token usage and cost reporting are not uniformly guaranteed across ACP agents and are not currently prioritized, agent telemetry is removed completely (`packages/core/src/runtime/agent-telemetry.ts`, `packages/agents/src/mock-agent.test/telemetry.test.ts`, `packages/guardrails/src/agent-guardrail.test/telemetry.test.ts`). Normalized ACP `session/update` events (`thought`, `tool_call`, `message_chunk`) continue to be written to `.harness/runs/<runId>/streams/<sessionId>.jsonl` via `packages/agents/src/acp-stream.ts`.  
* **Turn circuit breaker:** Since a single ACP `session/prompt` call encapsulates an entire internal agent loop, the step-level turn circuit breaker (`packages/core/src/errors/max-total-turns-exceeded-error.ts` and `maxTotalTurns` turn-counting logic) is removed.  
* **Cancellation and retries:** Guardrail retry loops from ADR-0006 remain unchanged. Hard cancellation of running or stuck steps is handled uniformly via `AbortSignal`, mapped to ACP `session/cancel` (followed by subprocess termination on timeout after `shutdownTimeoutMs`).

### **2.5 Session Resumption Without Fallback**

* During the `initialize` handshake, `acpAgent` inspects the agent's `agentCapabilities?.loadSession` capability.  
* If `agentCapabilities?.loadSession === true` and a `previousSessionId` is available, `session/load` is called to resume the existing session.  
* If an agent does not support session resumption, the harness **deliberately implements no** custom fallback or synthetic rehydration workaround; behavior follows the native capabilities of the configured ACP agent (starting a fresh `session/new`).

### **2.6 Mandatory Agent Configuration in `@luddjs/guardrails`**

* With the removal of the Pi SDK, the implicit default agent in `packages/guardrails/src/agent-guardrail.ts` (along with `default-agent.test.ts`) is removed.  
* `agentGuardrail` now requires an explicit `agent: AgentRunner<any, any>` configuration—either passed directly to the guardrail or inherited by reusing an ACP preset/runner in `harness.config.ts`.

## **3\. Interface Design and Target API**

### **3.1 `acpAgent` and Presets (`@luddjs/agents`)**

<!-- eslint-skip -->
```ts
export type AcpPermissionMode = 'readOnly' | 'acceptEdits' | 'bypassPermissions'

export interface AcpAgentConfig<
  TContext extends StepContext<any, any, any, any> = StepContext<any, any, any, any>,
> {
  /** Executable binary or command (e.g., 'claude', 'codex', 'agy'). */
  command: string
  /** CLI arguments to start the agent in ACP mode (e.g., ['--acp']). */
  args?: string[]
  /** Additional environment variables merged into the spawned ACP subprocess. */
  env?: Record<string, string>
  /** Permission mode forwarded to ACP `session/request_permission` handling. Defaults to 'readOnly'. */
  permissionMode?: AcpPermissionMode
  /** Timeout in milliseconds for graceful ACP cancel and subprocess exit cleanup. Defaults to 5000. */
  shutdownTimeoutMs?: number
  /** Step prompt template or resolver. Defaults to ''. */
  prompt?: DynamicProperty<string, TContext>
  /** Optional dynamic or static session identifier. */
  sessionId?: DynamicProperty<string | undefined, TContext>
  /** Optional override for the `ludd mcp-bridge` command used when `input.mcp` is provided. */
  mcpBridge?: AcpMcpBridgeConfig
}

export interface AcpPresetOptions<
  TContext extends StepContext<any, any, any, any> = StepContext<any, any, any, any>,
> extends Omit<AcpAgentConfig<TContext>, 'command'> {
  /** Override the default preset executable binary or command. */
  command?: string
}

export function acpAgent<
  TOutput = unknown,
  TContext extends StepContext<any, any, any, any> = StepContext<any, any, any, any>,
>(config: AcpAgentConfig<TContext>): AgentRunner<TOutput, TContext>

export function claudeAcp<
  TOutput = unknown,
  TContext extends StepContext<any, any, any, any> = StepContext<any, any, any, any>,
>(options?: AcpPresetOptions<TContext>): AgentRunner<TOutput, TContext>

export function codexAcp<
  TOutput = unknown,
  TContext extends StepContext<any, any, any, any> = StepContext<any, any, any, any>,
>(options?: AcpPresetOptions<TContext>): AgentRunner<TOutput, TContext>

export function agyAcp<
  TOutput = unknown,
  TContext extends StepContext<any, any, any, any> = StepContext<any, any, any, any>,
>(options?: AcpPresetOptions<TContext>): AgentRunner<TOutput, TContext>
```

### **3.2 `stdio` MCP Bridge (`@luddjs/core` / `@luddjs/agents` / `@luddjs/cli`)**

When `@luddjs/core` provides an embedded MCP server (`AgentMcpConnection`) in `AgentTurnInput.mcp` (alongside optional `previousSessionId` for resumption), `acpAgent` attaches a `stdio`-based entry to `mcpServers` during `session/new` or `session/load`:

<!-- eslint-skip -->
```ts
// @luddjs/core
export interface AgentMcpConnection {
  url: string
  authToken: string
}

// @luddjs/agents
export interface AcpMcpBridgeConfig {
  command: string
  args?: string[]
}

export interface AcpStdioMcpServerConfig {
  name: 'ludd'
  command: string // explicit mcpBridge.command, process.execPath (when LUDD_CLI_BIN is set), or 'ludd'
  args: string[]  // e.g., ['mcp-bridge', '--endpoint', mcp.url]
  env?: Array<{ name: string, value: string }> // [{ name: 'LUDD_MCP_TOKEN', value: mcp.authToken }]
}
```

**Data flow:**

1. `@luddjs/core` starts its embedded HTTP/SSE MCP server (`127.0.0.1`) for the run as before (single source of truth for artifacts, paginated logs, and interactive `ask_user` gates) and passes `AgentMcpConnection` (`{ url, authToken }`) on `AgentTurnInput.mcp`.  
2. `acpAgent` spawns the external ACP agent over `stdio` and passes the `ludd mcp-bridge` definition inside `mcpServers` (resolving explicit `mcpBridge`, then `process.env.LUDD_CLI_BIN` set by `packages/cli/src/bin.ts`, then `'ludd'`, with `LUDD_MCP_TOKEN` passed via environment variable rather than CLI args).  
3. The ACP agent spawns `ludd mcp-bridge` as a child process and sends MCP JSON-RPC requests over `stdin`.  
4. `ludd mcp-bridge` (`packages/cli/src/mcp-bridge/`) forwards each request with Bearer authentication (`LUDD_MCP_TOKEN`) to the local core HTTP MCP endpoint (`--endpoint` / `LUDD_MCP_ENDPOINT`) and writes each JSON-RPC response line back to `stdout`.

### **3.3 Usage Example in `harness.config.ts`**

<!-- eslint-skip -->
```ts
import { acpAgent, agyAcp, claudeAcp, codexAcp } from '@luddjs/agents'
import { agentGuardrail } from '@luddjs/guardrails'

const codingAgent = claudeAcp({ permissionMode: 'acceptEdits' })
const reviewAgent = codexAcp({ permissionMode: 'readOnly' })

// Generic wiring for any ACP-compatible CLI
const customAgy = agyAcp({ permissionMode: 'acceptEdits' })
// or explicitly:
const customAgent = acpAgent({
  command: 'agy',
  args: ['--acp'],
  permissionMode: 'acceptEdits',
})

// Guardrail with mandatory explicit agent configuration
const codeReviewGuardrail = agentGuardrail({
  name: 'code-review',
  agent: reviewAgent,
  prompt: 'Review the changes for correctness and completeness.',
})
```

## **4\. Consequences**

### **Positive Consequences**

* **Unified multi-agent support:** Agy, Claude, Codex, and future ACP-compliant agents work through a single adapter without per-vendor SDK integrations.  
* **Significant codebase simplification:** Removes the Pi SDK, the Pi MCP bridge, in-process security extensions, the telemetry pipeline, and turn-counting logic.  
* **Reliable MCP interoperability:** Routing through the `stdio` bridge ensures artifacts, paginated logs, and interactive elicitation (ADR-0011) work consistently across all ACP v1-compliant agents.

### **Deliberate Trade-offs and Risks**

* **Softer sandboxing:** Enforcement of read-only and workspace boundaries depends on each ACP agent's own permission implementation rather than hard harness-level extensions.  
* **No built-in cost or token telemetry:** Token usage and cost tracking per step are no longer part of the core harness.  
* **Agent-dependent session resumption:** Session-level crash recovery depends on whether the configured ACP agent implements `loadSession`.

## **5\. Migration Plan by Package**

### **`packages/agents`**

* **Removed:** `src/pi-agent.ts`, `src/pi-agent.test/`, `src/types/pi-sdk.ts`, `src/mcp/pi-mcp-tools.ts`, `src/mcp/pi-mcp-tools.test.ts`, `src/security/` (entire directory), `src/mock-agent.test/telemetry.test.ts`.  
* **Added:** `src/acp-agent.ts`, `src/acp-presets.ts` (`claudeAcp`, `codexAcp`, `agyAcp`), `src/acp-mcp.ts`, `src/acp-permissions.ts`, `src/acp-process.ts`, `src/acp-process-monitor.ts`, `src/acp-output.ts`, `src/acp-stream.ts`, and unit tests in `src/acp-agent.test/` backed by a local fake ACP process.  
* **Updated:** `src/index.ts`, `src/mock-agent.ts` (remove telemetry fields), `package.json` (remove Pi dependencies, add `@agentclientprotocol/sdk`).

### **`packages/core`**

* **Removed:** `src/runtime/agent-telemetry.ts` (+ test), `src/errors/max-total-turns-exceeded-error.ts` (+ test), `e2e/epic-08-fake-pi.ts`.  
* **Added:** `e2e/epic-08-fake-acp.ts` and `e2e/epic-08-fake-acp-server.mjs`.  
* **Updated:** `AgentRunner`, `AgentTurnInput`, `AgentTurnResult`, and `AgentMcpConnection` (`previousSessionId`, `mcp`) in `src/types/agent.ts`, `src/runtime/agent-executor.ts` (remove turn circuit breaker, propagate `AbortSignal` and `previousSessionId`), and `e2e/epic-08-reference-workflow.e2e.test.ts` + `e2e/fixtures/reference-harness.config.ts` migrated to the fake ACP server.

### **`packages/cli`**

* **Added:** `packages/cli/src/mcp-bridge/` (`mcp-bridge-command.ts`, `mcp-bridge-transport.ts`, and `mcp-bridge-command.test/`) implementing `ludd mcp-bridge`, plus `packages/cli/e2e/mcp-bridge.e2e.test.ts` and `LUDD_CLI_BIN` propagation in `packages/cli/src/bin.ts`.

### **`packages/guardrails`**

* **Removed:** `src/agent-guardrail.test/default-agent.test.ts`, `src/agent-guardrail.test/telemetry.test.ts`.  
* **Updated:** `src/agent-guardrail.ts` (make the `agent` option mandatory and remove telemetry handling).

### **`docs/adr` & Configuration**

* Finalized this document as `docs/adr/adr-0012_acp-protocol-standardization-and-pi-sdk-removal.md`, marked `adr-0010` as superseded by ADR-0012, and cross-referenced ADR-0012 from `adr-0004`, `adr-0006`, and `adr-0009`.  
* Migrated `harness.config.ts` and `packages/core/e2e/fixtures/reference-harness.config.ts` to ACP presets and `acpAgent`.

