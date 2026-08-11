# Contributing to Nexus

Thanks for your interest in contributing! This document describes the workflow, conventions, and quality gates every contribution must pass.

## Table of contents

- [Code of conduct](#code-of-conduct)
- [Development environment](#development-environment)
- [Branching strategy](#branching-strategy)
- [Pull request workflow](#pull-request-workflow)
- [PR checklist](#pr-checklist)
- [Commit conventions](#commit-conventions)
- [Code style](#code-style)
- [Testing](#testing)
- [Security](#security)
- [Reviewing](#reviewing)

## Code of conduct

Be respectful and constructive. This is a small, focused project — keep discussions technical and kind. Harassment or abusive behavior will result in removal from the project.

## Development environment

Prerequisites: Node.js 20+ (22 recommended), pnpm 11.x, Docker (Compose).

```bash
# 1. Install dependencies
pnpm install

# 2. Start Postgres (pgvector) and Redis
pnpm db:up

# 3. Create your environment file
cp .env.example .env        # then set OPENAI_API_KEY

# 4. Migrate the database
pnpm --filter @nexus/backend db:migrate

# 5. Run everything in watch mode
pnpm dev
```

Verify your setup works by opening http://localhost:5173 and creating a workspace.

> 🐳 Using a different database? Update `DATABASE_URL` in `.env` accordingly. Never commit `.env`.

## Branching strategy

- The default branch is `main`. It is **protected**.
- **Only the repository owner may push directly to `main`.**
- All other changes must land via a pull request from a feature branch.

```text
main  ──────────────  (protected; owner-only direct pushes)
         ▲
         │  pull request (required: CI green + owner review)
         │
feature/your-change ── (branch off main, short-lived)
```

Name branches descriptively, e.g.:

- `feat/workspace-export`
- `fix/upload-timeout`
- `chore/upgrade-langchain`
- `docs/api-usage`

## Pull request workflow

1. **Fork** the repository (external contributors) or create a feature branch (collaborators).
2. Make your changes with focused, well-named commits (see [Commit conventions](#commit-conventions)).
3. Push the branch and open a pull request **against `main`**.
   - Use a clear title and describe *what* changed, *why*, and *how you tested it*.
   - Reference any related issue (e.g. `Closes #12`).
4. Ensure CI passes: `typecheck`, `build`, `Secret scan`, and `Dependency review` are **required**.
5. The repository owner (code owner) reviews and merges the PR. Your branch is auto-deleted on merge.

## PR checklist

Before marking a PR ready for review, confirm:

- [ ] `pnpm typecheck` passes locally
- [ ] `pnpm build` passes locally
- [ ] No secrets or local `.env` values are committed (CI runs gitleaks)
- [ ] New dependencies are necessary and added to the correct workspace `package.json` (the root `pnpm-lock.yaml` is updated via `pnpm install`)
- [ ] Database schema changes include a Drizzle migration (`pnpm --filter @nexus/backend db:generate`) — never hand-edit the `drizzle/` snapshots
- [ ] Public-facing behavior is documented (README/env vars) when relevant
- [ ] Commit messages follow the project conventions
- [ ] PR description explains the change and testing done

## Commit conventions

Use [Conventional Commits](https://www.conventionalcommits.org/) — this keeps history greppable and enables future automated releases.

```text
<type>(<scope>): <short summary>

<optional body>
```

Types: `feat`, `fix`, `docs`, `chore`, `refactor`, `test`, `perf`, `build`, `ci`, `style`.

Examples:

```text
feat(backend): add hybrid search fallback for empty vector results
fix(frontend): reset upload dropzone after failed upload
docs: document environment variables for FRONTEND_ORIGIN
ci: add gitleaks secret scanning to pull requests
chore(deps): bump bullmq to 5.34.0
```

Rules:

- One logical change per commit; keep commits small and reviewable.
- Use the imperative mood ("add", "fix", not "added", "fixes").
- Squash or rebase before merging if history gets noisy.

## Code style

- **TypeScript** everywhere; strict mode is on. Prefer explicit types at API boundaries and let inference work inside functions.
- Follow existing patterns in the codebase (e.g. `src/routers/*`, `src/services/*`, `src/features/*`).
- Keep DTOs shared in `packages/shared-types` when both apps use them.
- Run `pnpm typecheck` before pushing. (ESLint/Prettier are planned — see the README roadmap.)

## Testing

Automated tests are not yet in place (tracked in the README roadmap). Until then:

- Exercise your change manually against a real local stack (`pnpm dev`).
- For backend changes, the smoke script `apps/backend/scripts/smoke.ts` is a starting point — run it with `pnpm --filter @nexus/backend tsx scripts/smoke.ts`.
- For frontend changes, test upload → indexing → chat end-to-end in the UI.
- Describe exactly what you tested in the PR description.

## Security

- **Never** commit secrets, API keys, or `.env` files. Gitleaks runs in CI and will fail the pipeline.
- Uploaded documents live under `apps/backend/uploads/` — this directory is git-ignored; do not commit its contents.
- If you find a vulnerability, do **not** open a public issue. Follow the reporting process in [SECURITY.md](SECURITY.md).
- Security-sensitive changes (auth, uploads, shelling out, dependency upgrades) will get extra scrutiny in review.

## Reviewing

- The repository owner is the sole code owner (`CODEOWNERS`) and must approve every PR.
- Reviewers should verify: CI is green, the diff matches the description, no secrets are exposed, and the change is minimal and focused.
- If a PR has conflicts or stale reviews, rebase and push again — CI will re-run automatically.
