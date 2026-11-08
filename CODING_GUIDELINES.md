# Coding Guidelines

## Packages

This pnpm monorepo manages multiple related packages within a single repository. They reside inside the central `./packages` folder. Their namespace starts with `@ludd/`.

## Dependencies

**Use latest compatible versions:** When adding new dependencies, verify current releases to ensure no outdated versions are introduced. Always select the most up-to-date versions compatible with the existing repository stack, runtime, and peer dependencies.

## Tests

- **Colocate unit tests (`*.test.ts`) with the file they test:** When a unit test file grows large, split it into a `<source-file>.test/` sibling folder with each file inside named by the behaviour it covers and ending in `.test.ts`.
- Keep end-to-end tests (`*.e2e.test.ts`) in the packages `e2e/` folder.

## Commits and Git hygiene

- **Follow Conventional Commits.** Commit messages follow `<type>(<scope>): <description>`. Types are restricted to: `build`, `chore`, `ci`, `docs`, `feat`, `fix`, `perf`, `refactor`, `revert`, `style` and `test`. Scopes are restricted to monorepo sub-packages (`core`); omitting the scope is permitted for repository-wide changes. An explanatory body separated by a blank line is encouraged for non-trivial context.
