# **ADR-0004: Embedded HTTP/SSE MCP Server for Validated Artifacts and Format-Aware Paginated Logs**

| Metadata Field | Value |
| :---- | :---- |
| **ADR ID** | `ADR-0004` |
| **Status** | `Accepted` (Immutable once accepted; supersede via new ADR if changed) |
| **Date** | 2026-11-08 |
| **Decision Owner** | Johannes Berthel |
| **Target Packages** | `@ludd/core`, `@ludd/guardrails` |
| **Related Design Doc** | `ludd — Technical Design Document` (Sections 2.3, 5.2, 5.4.3, 5.7.3, 8.1) |

## **1\. Context and Problem Statement**

During workflow execution, two critical data-exchange challenges arise:

1. **Read-Only Discovery vs. Artifact Creation:** In discovery, triage, and specification steps (`mode: 'read-only'`), the AI agent must not modify the repository working tree, yet it needs to produce structured workflow artifacts (such as `spec.md`, `todos.json`, or `pr-description.md`) that the host orchestrator can validate against Zod schemas.  
2. **Context Window Pollution from Guardrail Logs:** When an `afterStep` `execGuardrail` (such as `phpunit` or `phpstan`) fails, raw CLI output can easily exceed 10,000–50,000 lines. Injecting raw logs into the retry prompt—or returning the entire log blob in a single unpaginated tool call—exhausts the agent's context window and degrades reasoning quality.

## **2\. Considered Options**

### **Option A: Direct Filesystem Writes & Raw Prompt Injection**

Have agents write artifacts to a `.harness-tmp/` folder inside the workspace and inject failing `stdout`/`stderr` directly into the self-healing retry prompt.

* **Pros:** No network server required.  
* **Cons:** Violates strict `read-only` sandbox constraints; requires mounting `.harness` directories into containers; 50,000-line test logs immediately overflow the LLM context window.

### **Option B: Stdio-Based MCP Server per Step**

Spawn a local stdio MCP server subprocess inside the target environment for each step.

* **Pros:** Uses standard stdio transport.  
* **Cons:** Requires installing the MCP server binary inside every Docker container or VM image; complicates direct memory/state synchronization with the host orchestrator.

### **Option C: Host-Embedded HTTP/SSE MCP Server with Disk Persistence, Format-Aware Pagination, and Bearer Auth *(Chosen)***

Run an embedded HTTP/SSE Model Context Protocol (MCP) server directly inside the host orchestrator process bound to a free ephemeral port on `127.0.0.1` / container bridge IP, secured via a per-run `MCP_AUTH_TOKEN`.

* **Pros:** Works seamlessly across local worktrees, Docker containers, and VMs over the host bridge; preserves strict `read-only` workspace isolation; enables host-side Zod validation and format-aware log pagination.  
* **Cons:** Requires managing local HTTP/SSE transport, bearer token authentication, and bridge routing.

## **3\. Decision Outcome**

We adopt **Option C: Host-Embedded HTTP/SSE MCP Server with Disk Persistence, Format-Aware Pagination, and Bearer Auth**.

1. **S3-Like Scoped Artifact Store & Zod Validation:** Agents read and write artifacts via MCP tool calls (`put_artifact`, `get_artifact`). Steps declare expected `artifacts` with validation rules (`nonEmpty: true`, custom validators, or Zod `schema`). Missing or invalid artifacts trigger the self-healing loop.  
2. **Context-Friendly Offloading & Format-Aware Pagination:** Outputs from `beforeStep` guardrails and failing `afterStep` `execGuardrails` are stored in the MCP server, and the agent receives a lightweight MCP reference URI/key. To prevent context overflow when the agent queries large logs, the MCP server enforces format-aware pagination:  
   * **Plain-Text Logs (`text`):** Automatically paginated by line breaks (`\n`) via bounded range/page tools (`read_log_page`, `read_log_lines`, `search_log`).  
   * **Structured JSON Outputs (`json`):** Guardrails can configure array pagination via a property key or selector callback (`pagination: 'errors' | ((json) => unknown[])`), serving paginated slices with total item counts.  
3. **Disk Persistence:** Artifacts and offloaded logs are persisted under `.harness/runs/<runId>/artifacts/<artifactKey>` and `.harness/runs/<runId>/logs/<stepId>-<attempt>.log` so they survive crash rehydration.  
4. **Security (`MCP_AUTH_TOKEN` & Interface Binding):** At run start, the host generates a cryptographic `MCP_AUTH_TOKEN`, injects it into the step's environment variables, and requires `Authorization: Bearer <token>` on all HTTP/SSE MCP requests. The server binds strictly to `127.0.0.1` and the container/VM bridge IP (never `0.0.0.0`).

## **4\. Consequences & Accepted Trade-Offs**

* **Positive:** Agents in `read-only` mode remain 100% blocked from mutating source files while still producing rich, Zod-validated workflow artifacts.  
* **Positive:** Massive test and static analysis outputs never flood the LLM context window.  
* **Accepted Trade-Off:** Container and VM environment adapters must ensure host-bridge network reachability to the host's ephemeral MCP port.

## **5\. Revisit Triggers**

This decision will be revisited if container bridge networking across macOS OrbStack, Docker Desktop, or rootless Podman introduces routing friction for ephemeral host ports.