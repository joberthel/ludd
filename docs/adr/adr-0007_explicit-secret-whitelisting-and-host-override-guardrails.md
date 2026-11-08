# **ADR-0007: Explicit Secret Whitelisting and Host-Override Guardrails**

| Metadata Field | Value |
| :---- | :---- |
| **ADR ID** | `ADR-0007` |
| **Status** | `Accepted` (Immutable once accepted; supersede via new ADR if changed) |
| **Date** | 2026-11-08 |
| **Decision Owner** | Johannes Berthel |
| **Target Packages** | `@ludd/core`, `@ludd/environments`, `@ludd/guardrails` |
| **Related Design Doc** | `ludd — Technical Design Document` (Sections 3, 4.2, 5.6.2, 8.1, 9.2) |

## **1\. Context and Problem Statement**

Developer workstations and CI hosts hold sensitive credentials in environment variables and local files (SSH private keys, GitHub/GitLab personal access tokens, cloud provider credentials, production API keys). If an AI coding agent executing inside a sandbox (especially with workspace-write or dangerMode enabled) inherits process.env or host SSH sockets by default, a prompt injection, hallucinated command, or malicious package script could exfiltrate host credentials or push unauthorized code to remote repositories.

At the same time, legitimate workflows still need to perform privileged git/network operations (such as git push \-u origin HEAD or gh pr create) once verification gates and human sign-off succeed.

## **2\. Considered Options**

### **Option A: Implicit process.env and SSH Agent Forwarding into Sandboxes**

Pass host environment variables and mount SSH\_AUTH\_SOCK into Docker/VM environments by default so agents can run git push or install private packages out of the box.

* **Pros:** Zero configuration for private registries or git operations inside the container.  
* **Cons:** Violates **Constraint \#3** (Zero Implicit Credential Exposure); gives autonomous AI agents direct access to production/GitHub credentials.

### **Option B: Explicit Secret Whitelisting \+ Host-Override Guardrails (`environment: hostEnv()`) *(Chosen)***

Never pass host environment variables, SSH keys, or API tokens into isolated environments by default. Require explicit whitelisting for sandbox secrets, and execute privileged host operations deterministically via guardrails overridden to run on `hostEnv()`.

* **Pros:** AI agents never see git push tokens or SSH keys; privileged operations (`git push`, `gh pr create`) execute deterministically on the host only after all verification and human review gates pass.  
* **Cons:** Workflow authors must explicitly whitelist any token required inside a container (e.g., `NPM_TOKEN` for private packages).

## **3\. Decision Outcome**

We adopt **Option B: Explicit Secret Whitelisting \+ Host-Override Guardrails (`environment: hostEnv()`)**.

* **Default-Deny Credential Inheritance:** Environment adapters (`dockerWorktreeEnv`, VMs) start with a clean environment containing only system defaults and orchestrator-injected connection parameters (DB URLs, ephemeral ports, `MCP_SERVER_URL`, `MCP_AUTH_TOKEN`). Host `process.env` and SSH keys are never implicitly forwarded.  
* **Explicit Whitelisting:** If a sandboxed tool requires a specific secret, it must be explicitly declared in the environment adapter configuration.  
* **Privilege Separation via Guardrail Environment Overrides:** Individual guardrails can override their parent step's environment (`environment: hostEnv()`). Privileged operations such as `git push -u origin HEAD` run as deterministic `afterStep` `execGuardrails` on the host environment after human sign-off, keeping host credentials completely out of the AI agent's sandbox.

## **4\. Consequences & Accepted Trade-Offs**

* **Positive:** Eliminates accidental credential exfiltration by autonomous agents while still enabling end-to-end automated branch pushing and PR creation.  
* **Accepted Trade-Off:** As documented in Section 8.1, `@ludd/core` does not implement automatic regex secret-redaction inside the MCP log offloader in v0.1; if a whitelisted secret could be printed by a custom `execGuardrail` command, the workflow author is responsible for masking it in the command or custom formatter callback.

## **5\. Revisit Triggers**

This decision will be revisited if enterprise deployments require integration with external secret managers (e.g., 1Password CLI, HashiCorp Vault) via dedicated secret-provider adapters.