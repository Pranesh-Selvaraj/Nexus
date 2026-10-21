# Security Policy

Nexus is a self-hosted, single-user tool — but we still take security seriously.

## Supported versions

| Version | Supported    |
| ------- | ------------ |
| 0.4.x   | ✅ (current) |
| < 0.4.0 | ❌           |

Releases are tagged `vX.Y.Z` and published as GitHub Releases with container images on GHCR (`ghcr.io/pranesh-selvaraj/nexus-backend`, `ghcr.io/pranesh-selvaraj/nexus-frontend`). Security fixes land on `main` and ship as patch releases.

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
- **Voice recordings leave the device only when server dictation is selected.** Browser dictation uses the Web Speech API and is handled by the browser/OS vendor under their terms. When `voice.sttMode` is `server` (or the browser has no Web Speech support), the recorded clip is uploaded to the configured transcription provider — by default your main OpenAI-compatible endpoint. Point `WHISPER_LOCAL_URL` at a local faster-whisper server to keep audio on-premises. Recordings are not stored unless explicitly requested; cached read-aloud speech is retained for `AUDIO_RETENTION_DAYS` (default 7) and capped by `AUDIO_MAX_STORAGE_MB` (default 200 MB) with oldest-first eviction.
- **Pronunciation feedback is an estimate, not a grade.** It is computed locally by aligning the recogniser's transcript with the target text; cloud pronunciation-assessment APIs are not used.

## Security features

- `main` branch protection: only the repository owner can push directly; everyone else requires a reviewed PR with green CI
- Optional session authentication: scrypt-hashed password, httpOnly+SameSite cookie, server-side sessions stored as sha256 token hashes, login rate limiting (10/15min), uploads also require the session
- Audio upload hardening: dictation/pronunciation recordings are capped by `MAX_AUDIO_MB`, filtered by extension and declared MIME type, buffered in memory and written to server-generated random paths under the uploads volume (never derived from the uploaded filename). The audio streaming endpoint only serves assets owned by the session user and refuses paths outside the audio directory.
- Audio retention and quota: cached speech carries an expiry (`AUDIO_RETENTION_DAYS`, purged by the daily maintenance job) and a per-user storage cap (`AUDIO_MAX_STORAGE_MB`) enforced with oldest-first eviction, so audio cannot grow without bound.
- gitleaks secret scanning on every push and PR (blocking)
- GitHub dependency review on PRs (blocking for high severity)
- CodeQL static analysis on every push/PR plus a weekly schedule
- Dependabot for npm and GitHub Actions updates
- GitHub secret scanning with push protection enabled on the repository
- `pnpm audit` runs fail-closed in CI (zero known advisories as of the langchain 0.3 upgrade)
