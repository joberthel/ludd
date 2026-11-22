# ludd

A deterministic code harness that orchestrates AI-driven agents.

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

# Inspect or resume a run
pnpm ludd status
pnpm ludd resume <run-id>
```

