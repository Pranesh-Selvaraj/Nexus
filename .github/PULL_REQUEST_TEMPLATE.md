<!--
  Required by the project convention (CONTRIBUTING.md):
  1. Link the issue this PR resolves - CI's docs-check fails without it.
  2. Documentation ships with the code - update it in THIS PR, never after.
-->

## Linked issue

Closes #<!-- issue number -->

## What changed

<!-- What, why, and how you tested it. -->

## Documentation

- [ ] Updated in this PR: <!-- list the files (README.md, SECURITY.md, .env.example, CONTRIBUTING.md) and what changed -->
- [ ] Not needed — <!-- briefly explain why (e.g. internal refactor with no user-visible change) -->

## Testing

- [ ] `pnpm typecheck` / `pnpm build` / `pnpm lint` pass
- [ ] Unit tests: `pnpm test`
- [ ] Integration smoke / e2e affected: `pnpm --filter @nexus/backend smoke` or `pnpm --filter @nexus/frontend test:e2e`
- [ ] Manual steps: <!-- what you exercised -->
