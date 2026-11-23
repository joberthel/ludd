# **ADR-0012: ACP Protocol Standardization and Pi SDK Removal**

| Property | Value |
| :---- | :---- |
| **Status** | Accepted |
| **Date** | 2026-11-23 |
| **Supersedes** | ADR-0010 (Initial Pi SDK Standardization and Deterministic Mock Agent Adapter) |
| **Amends** | ADR-0004 (MCP Transport), ADR-0006 (Step-Level Turn Circuit Breaker), ADR-0009 (Agent Sandboxing) |
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

* `@luddjs/agents` will expose a single production agent adapter, `AcpAgent` (built on `@agentclientprotocol/sdk`), which manages external ACP-compatible CLIs as subprocesses (`initialize`, `session/new`, `session/load`, `session/prompt`, `session/cancel`).  
* Thin configuration presets (`claudeAcp`, `codexAcp`, `agyAcp`) and a generic entry point (`acpAgent`) will be provided for common agents. These presets contain no protocol logic of their own and only encapsulate default commands, arguments, and options.  
* The entire Pi integration (`pi-agent.ts`, `types/pi-sdk.ts`, `mcp/pi-mcp-tools.ts`, and all associated tests) will be removed.  
* `mock-agent.ts` will remain as the fast, deterministic test adapter for unit and core test suites. For end-to-end tests, `packages/core/e2e/epic-08-fake-pi.ts` will be replaced with a lightweight fake ACP server communicating over `stdio`.

### **2.2 Relaxing Agent Sandboxing and Delegating to ACP (Amendment to ADR-0009)**

* In-process enforcement of filesystem, write, and shell restrictions within `@luddjs/agents` is discontinued.  
* The entire `packages/agents/src/security/` directory (`environment-bash.ts`, `read-only-extension.ts`, `workspace-write-extension.ts`, `workspace-path-guard.ts`, and their tests) will be removed.  
* Permission boundaries (e.g., read-only vs. write access) are passed through to ACP configuration and handled via the ACP permission flow. The harness intentionally avoids duplicating complex isolation wrappers around external agent runtimes.

### **2.3 MCP Integration via `stdio` Bridge (Amendment to ADR-0004)**

* In ACP v1, only the `stdio` transport is mandatory for `mcpServers`, whereas HTTP/SSE transports are optional capabilities. Consequently, `AcpAgent` will pass the Ludd MCP server to ACP sessions using the `stdio` transport.  
* **Process-boundary architecture:** Because the external ACP agent spawns a `stdio` MCP server as its own child process, that process has no direct access to the in-memory state of the running `ludd` worker process—most notably for human gates and interactive user elicitation in `mcp-interactive-tools.ts` (ADR-0011).  
* **Solution:** The existing embedded MCP server in `@luddjs/core` (`packages/core/src/mcp/mcp-server.ts`) remains the single source of truth. A minimal `stdio` proxy entry point (e.g., `ludd mcp-bridge`) is spawned by the ACP agent and transparently forwards JSON-RPC messages between `stdin`/`stdout` and the running local core MCP endpoint (HTTP or Unix socket).  
* The Pi-specific MCP bridge (`pi-mcp-tools.ts`) is removed completely.

### **2.4 Removal of Agent Telemetry and Step-Level Turn Circuit Breaker (Amendment to ADR-0006)**

* **Telemetry:** Because token usage and cost reporting are not uniformly guaranteed across ACP agents and are not currently prioritized, agent telemetry is removed completely (`packages/core/src/runtime/agent-telemetry.ts`, `packages/agents/src/mock-agent.test/telemetry.test.ts`, `packages/guardrails/src/agent-guardrail.test/telemetry.test.ts`).  
* **Turn circuit breaker:** Since a single ACP `session/prompt` call encapsulates an entire internal agent loop, the step-level turn circuit breaker (`packages/core/src/errors/max-total-turns-exceeded-error.ts` and associated turn-counting logic) is removed.  
* **Cancellation and retries:** Guardrail retry loops from ADR-0006 remain unchanged. Hard cancellation of running or stuck steps is handled uniformly via `AbortSignal`, mapped to ACP `session/cancel` (followed by subprocess termination on timeout).

### **2.5 Session Resumption Without Fallback**

* During the `initialize` handshake, `AcpAgent` inspects the agent's `loadSession` capability.  
* If the agent supports `session/load` and a `sessionId` is available, the existing session is resumed.  
* If an agent does not support session resumption, the harness **deliberately implements no** custom fallback or synthetic rehydration workaround; behavior follows the native capabilities of the configured ACP agent.

### **2.6 Mandatory Agent Configuration in `@luddjs/guardrails`**

* With the removal of the Pi SDK, the implicit default agent in `packages/guardrails/src/agent-guardrail.ts` (along with `default-agent.test.ts`) is removed.  
* `agentGuardrail` now requires an explicit agent configuration—either passed directly to the guardrail or inherited by reusing the same ACP configuration defined in `harness.config.ts`.

## **3\. Interface Design and Target API**

### **3.1 `AcpAgent` and Presets (`@luddjs/agents`)**

```
export type AcpPermissionMode = 'readOnly' | 'acceptEdits' | 'bypassPermissions'

export interface AcpAgentConfig {
  /** Executable binary or command (e.g., 'claude', 'codex', 'agy'). */
  command: string
  /** CLI arguments to start the agent in ACP mode (e.g., ['--acp']). */
  args?: string[]
  /** Additional environment variables for the ACP subprocess. */
  env?: Record<string, string>
  /** Permission mode forwarded to ACP permission handling. */
  permissionMode?: AcpPermissionMode
  /** Optional timeout in milliseconds for ACP handshake and cancel cleanup. */
  shutdownTimeoutMs?: number
}

export interface AcpPresetOptions {
  permissionMode?: AcpPermissionMode
  args?: string[]
  env?: Record<string, string>
  command?: string
}

export function acpAgent(config: AcpAgentConfig): AgentRunner
export function claudeAcp(options?: AcpPresetOptions): AgentRunner
export function codexAcp(options?: AcpPresetOptions): AgentRunner
export function agyAcp(options?: AcpPresetOptions): AgentRunner
```

### **3.2 `stdio` MCP Bridge (`@luddjs/core` / `@luddjs/cli`)**

When the core provides an MCP server for a step, `AcpAgent` attaches a `stdio`\-based entry to `mcpServers` during `session/new` or `session/load`:

```
export interface AcpStdioMcpServerConfig {
  name: 'ludd'
  command: string // e.g., process.execPath or the ludd binary
  args: string[]  // e.g., ['mcp-bridge', '--endpoint', coreMcpUrl, '--token', authToken]
  env?: Array<{ name: string; value: string }>
}
```

**Data flow:**

1. `@luddjs/core` starts its embedded MCP server for the run as before (single source of truth for artifacts, logs, and interactive gates).  
2. `AcpAgent` spawns the external ACP agent over `stdio` and passes the `ludd mcp-bridge` definition inside `mcpServers`.  
3. The ACP agent spawns `ludd mcp-bridge` as a child process and sends MCP JSON-RPC requests over `stdin`.  
4. `ludd mcp-bridge` forwards each request with authentication to the local core MCP endpoint and writes the response back to `stdout`.

### **3.3 Usage Example in `harness.config.ts`**

```
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

* **Remove:** `src/pi-agent.ts`, `src/pi-agent.test/`, `src/types/pi-sdk.ts`, `src/mcp/pi-mcp-tools.ts`, `src/mcp/pi-mcp-tools.test.ts`, `src/security/` (entire directory), `src/mock-agent.test/telemetry.test.ts`.  
* **Add:** `src/acp-agent.ts` (built on `@agentclientprotocol/sdk`), presets (`claudeAcp`, `codexAcp`, `agyAcp`), and unit tests backed by a local fake ACP process.  
* **Update:** `src/index.ts`, `src/mock-agent.ts` (remove telemetry fields), `package.json` (remove Pi dependencies, add `@agentclientprotocol/sdk`).

### **`packages/core`**

* **Remove:** `src/runtime/agent-telemetry.ts` (+ test), `src/errors/max-total-turns-exceeded-error.ts` (+ test), `e2e/epic-08-fake-pi.ts`.  
* **Update:** `AgentRunner` interface in `src/types/agent.ts` (strip telemetry/turn fields and type MCP bridge wiring cleanly), `agent-executor.ts` (remove turn circuit breaker, propagate `AbortSignal`), and migrate E2E tests to a fake ACP server.

### **`packages/cli`**

* **Add:** `mcp-bridge` subcommand/entry point forwarding `stdio` MCP traffic to the running core MCP server.

### **`packages/guardrails`**

* **Remove:** `src/agent-guardrail.test/default-agent.test.ts`, `src/agent-guardrail.test/telemetry.test.ts`.  
* **Update:** `src/agent-guardrail.ts` (make the `agent` option mandatory and remove telemetry handling).

### **`docs/adr` & Configuration**

* Commit this document to the repository as `docs/adr/adr-0012_acp-protocol-standardization-and-pi-sdk-removal.md`.  
* Migrate `harness.config.ts` and `packages/core/e2e/fixtures/reference-harness.config.ts` to ACP presets.

