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

- **Optional authentication** — set `AUTH_PASSWORD` to require login; when unset the app runs in single-user no-auth mode. Either way, treat the app as a private tool: don't expose it to the public internet without a reverse proxy and TLS (`AUTH_COOKIE_SECURE=true`).

## Security features

- `main` branch protection: only the repository owner can push directly; everyone else requires a reviewed PR with green CI
- Optional session authentication: scrypt-hashed password, httpOnly+SameSite cookie, server-side sessions stored as sha256 token hashes, login rate limiting (10/15min), uploads also require the session
- gitleaks secret scanning on every push and PR (blocking)
- GitHub dependency review on PRs (blocking for high severity)
- CodeQL static analysis on every push/PR plus a weekly schedule
- Dependabot for npm and GitHub Actions updates
- GitHub secret scanning with push protection enabled on the repository
- `pnpm audit` runs fail-closed in CI (zero known advisories as of the langchain 0.3 upgrade)
