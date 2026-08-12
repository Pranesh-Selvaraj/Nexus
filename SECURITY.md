# Security Policy

Nexus is a self-hosted, single-user tool — but we still take security seriously.

## Supported versions

| Version | Supported                                   |
| ------- | ------------------------------------------- |
| main    | ✅ (active development)                     |
| < 0.1.0 | ❌ (pre-release, no releases published yet) |

Since no tagged releases exist yet, fixes land on `main`. Once stable releases are published, this table will list them.

## Reporting a vulnerability

**Please do not open a public issue for security problems.**

To report a vulnerability:

1. Use GitHub's private reporting: **Security → Report a vulnerability** on the [repository](https://github.com/Pranesh-Selvaraj/Nexus/security/advisories/new), or
2. Email the maintainer (Pranesh Selvaraj) privately via the contact address on their GitHub profile.

Include as much of the following as possible:

- Type of issue (e.g. path traversal, RCE, SSRF, secret exposure, XSS)
- Affected component and file(s)/endpoints
- Steps to reproduce, including payloads or sample requests
- Impact and any suggested fix, if you have one

You will receive a response within **5 business days**. We will work with you to triage and fix the issue, and we will credit you in the advisory unless you prefer to stay anonymous.

## Known items / accepted risk

These are tracked internally and documented publicly so users can make informed decisions:

- **`langchain@0.2.x` transitive advisories** — `pnpm audit` currently reports high-severity advisories reachable via `langchain` → `langsmith` (e.g. GHSA-3644-q5cj-c5c7). The dependency audit job in CI is report-only until `langchain` is upgraded to a supported major. Tracked in the [README roadmap](README.md#roadmap).
- **No authentication** — by design, the app is a single-user tool with no auth. Do not expose it directly to the public internet; put it behind a reverse proxy (with e.g. SSO/basic auth) if you do.

## Security features

- `main` branch protection: only the repository owner can push directly; everyone else requires a reviewed PR with green CI
- gitleaks secret scanning on every push and PR (blocking)
- GitHub dependency review on PRs (blocking for high severity)
- CodeQL static analysis on every push/PR plus a weekly schedule
- Dependabot for npm and GitHub Actions updates
- GitHub secret scanning with push protection enabled on the repository
