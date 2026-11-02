# CODING GUIDELINES — LUDD TUI

## 1. GENERAL

This document gives the coding rules for the `ludd` project.
Ludd is a Terminal User Interface (TUI) orchestrator and control plane for parallel background agents.
The software uses Pastel, React 19, Ink v8, `@inkjs/ui`, TypeScript, and `@modelcontextprotocol/server`.
This project is in an alpha stage. Backwards compatibility is not necessary.

The terminal environment has strict limits:
- The available screen area is small.
- The TUI display updates automatically when the React component state or agent state changes.
- The software must stop cleanly, terminate background processes, and return standard exit codes.

## 2. PROJECT STRUCTURE

All source code and unit tests reside in the `source/` directory.
The TypeScript compiler writes the built output to the `dist/` directory when you run `npm run build`.

Follow these file organization rules:
- Keep `source/cli.tsx` as the main Pastel entry point.
- Place all CLI command definitions in `source/commands/`. Pastel uses this directory for file-system routing.
- Place reusable TUI widgets in `source/components/`.
- Separate the Ink presentation layer from background agent orchestration and Model Context Protocol (MCP) server logic.
- Do not import Ink or React components into MCP protocol handlers or background agent controllers.
- Do not edit files in the `dist/` directory manually.

## 3. COMMAND ARGUMENTS AND VALIDATION

Ludd uses Pastel and `zod` to validate CLI inputs and protocol payloads.

Follow these validation rules:
- Define all command flags and positional arguments with `zod` schemas.
- Validate all Model Context Protocol (`@modelcontextprotocol/server`) inputs and agent messages with `zod` schemas.
- Use full, descriptive words for command flags.
- Add single-letter aliases only for frequent flags (for example, `-v` or `-h`).
- Write a short description for each `zod` option. Pastel uses these descriptions to generate the `ludd --help` screen.
- Define default values for all optional properties.
- Do not read process arguments directly from Node.js global variables.

## 4. TERMINAL USER INTERFACE

Apply these display rules to all views in `source/commands/` and `source/components/`:
- Use Ink v4 flexbox container components for all layout alignments, borders, and spacing.
- Put all text strings inside Ink text components. Do not place raw strings directly inside layout containers.
- Use pre-built components from `@inkjs/ui` for standard interface elements such as spinners, status messages, and prompts.
- Use standard ANSI colors (cyan, green, red, yellow) to keep the interface readable across different terminal themes.
- Do not use color alone to show agent status. Always combine color with a text label or symbol (for example, `[RUNNING]`, `[OK]`, or `[ERROR]`).
- Put static agent logs and completed task outputs into Ink static stream components to prevent screen flicker.
- Handle all keyboard navigation and shortcuts through the Ink input hook.

## 5. PROCESS CONTROL AND AGENT LIFECYCLE

Follow these lifecycle rules for `ludd` and its background agents:
- Stop the TUI application only with the Ink application exit function.
- Do not call the Node.js process exit function directly inside a React component. Direct termination skips Ink cleanup and leaves the terminal cursor in a broken state.
- Stop all parallel background agents, MCP server connections, timers, and child processes before a component unmounts.

Return these standard exit codes when `ludd` stops:
- Code `0`: The command and all agent tasks completed successfully.
- Code `1`: An application error, MCP failure, or agent crash occurred.
- Code `2`: The user gave invalid flags, missing arguments, or incorrect command syntax.

## 6. ERROR HANDLING

Apply these rules when errors occur:
- When the user enters invalid command options, display a clear error message and show the correct `ludd` syntax. Do not display stack traces for user input errors.
- Catch unexpected system errors and background agent failures at the root level of the application.
- Isolate errors from individual parallel agents so that one failed agent does not crash the entire TUI control plane.
- Display stack traces only when the user runs `ludd` with a debug or verbose flag.
- Show a spinner or progress indicator from `@inkjs/ui` when an asynchronous agent operation takes longer than 300 milliseconds.

## 7. AUTOMATED TESTS

Place unit tests and component tests inside the `source/` directory next to the files they test.

Test the codebase with `vitest` across three levels:
- **Unit Tests:** Test agent orchestration and MCP server logic in isolation without loading the Ink rendering runtime.
- **Component Tests:** Test TUI views in `source/components/` and `source/commands/` with `ink-testing-library` by verifying the rendered terminal frames.
- **End-to-End Tests:** Run the compiled `dist/` binary in a test shell to verify exit codes, output streams, and Pastel argument parsing.
- Run `npm test` to execute the test suite once, or `npm run test:watch` during local development.

Follow these rules when you test interactive components with `stdin.write`:
- Wait 50 milliseconds before you send input to a new component. This delay allows React to register the input listener.
- Put Enter (`\r`) and confirmation keys inside `vi.waitFor` blocks to repeat submissions during high CPU load.
- Send toggle keys (such as Space) and arrow keys only one time after the initial wait.
- Use `pressKey` and `submitAndWait` from `source/test-helpers.ts` to apply these patterns consistently.

## 8. CODE QUALITY AND GIT WORKFLOW

Verify all source code with the repository tooling before you commit changes:
- **TypeScript:** Keep strict type checking enabled in `tsconfig.json`. Do not use the `any` type.
- **Linting and Formatting:** This project uses ESLint with `@antfu/eslint-config` (`eslint.config.mjs`) for both code analysis and formatting. Do not install or use Prettier.
- Run `npm run lint` to check for code style errors, and run `npm run lint:fix` to format files automatically.
- **Git Hooks:** Keep `simple-git-hooks` active. The `pre-commit` hook runs `lint-staged` to fix staged files automatically.
- **Commit Messages:** Write all commit messages according to the Conventional Commits specification. The `commit-msg` hook validates every commit message against `commitlint.config.mjs`.
