# Agent Instructions

@[Coding Guidelines](CODING_GUIDELINES.md)

## Documentation & Architecture References

For design context, architectural specifications, and decision rationale, refer to:
- **Technical Design Document (TDD):** [`docs/technical-design-document.md`](docs/technical-design-document.md)
- **Architecture Decision Records (ADRs):** [`docs/adr/`](docs/adr/)

## Checks before handing work back

All of the following checks must pass before handing work back:

- `pnpm build`: Zero type errors across all packages
- `pnpm test`: Full suite green
- `pnpm test:coverage`: Unit coverage thresholds met across all packages
- `pnpm lint`: Zero ESLint errors across all packages
- `echo "<commit-msg>" | pnpm run commitlint`: Commit messages must follow conventional commits
- `pinact run --check`: All workflow actions pinned to immutable commit SHAs
