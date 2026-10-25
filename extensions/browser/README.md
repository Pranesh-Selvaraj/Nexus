# Nexus browser extension (share target)

A minimal Manifest V3 extension that saves the current page into a Nexus
workspace with one click. It is a thin client for `POST /api/v1/urls`, so the
page is fetched and extracted **server-side** (SSRF-guarded, deduplicated by
content hash) — the extension only sends the URL.

## Install

1. Create an API key in **Settings → API keys** with the `documents:write` (and
   `documents:read`, used to list workspaces) scopes.
2. Open `chrome://extensions`, enable **Developer mode**, click **Load
   unpacked** and select this `extensions/browser` directory.
3. Open the popup, set the Nexus URL (e.g. `http://localhost:3000`) and paste
   the key, then **Refresh workspaces** and pick a workspace.

## Use

Open an article (or a YouTube video with captions), click the Nexus icon and
**Save current page**. The status line reports `Saved — indexing…` or
`Already saved`. Indexing progress is visible in the Nexus library; the same
`document.indexed` webhook fires if one is configured.

Security notes: the key is stored in `chrome.storage.local` on your machine and
only sent to the Nexus URL you configure. Host access is **optional** and
requested per origin on first use (the extension does not get access to every
site you visit), and the page content never passes through the extension — only
its URL. Leave `WEBHOOK_ALLOW_PRIVATE_HOSTS` and `INGEST_ALLOW_PRIVATE_HOSTS`
off in any internet-facing deployment.
