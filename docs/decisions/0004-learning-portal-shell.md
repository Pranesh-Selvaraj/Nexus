# 0004 — Learning-portal shell: Home, Topics, and mode-based topics

- **Status:** Accepted
- **Date:** 2026-10-25
- **Phase:** 8 (UI)

## Context

The first versions of the UI opened on whichever workspace happened to be
active, or an empty "select or create a workspace" screen. Workspaces were a
sidebar list, and the four capabilities (chat, study, voice, language) were
tabs inside the workspace. That reads as a document tool, not a learning tool:
there was no cross-workspace progress, no "what should I do next?", and the
library competed for space with the conversation.

## Decisions

### 1. The app opens on a universal dashboard

`Home` aggregates every workspace the user owns: totals (topics, sources, cards
due, reviews today, words ingested), a "Continue learning" grid, a suggested
next step (the topic with the most due cards), suggested activities, and
recently added sources. The aggregate is one server endpoint
(`dashboard.overview`) rather than N per-workspace queries.

**Why:** a learner's first question is "what should I do now?", and answering
it requires data across topics.

**Consequences:** the dashboard is read-only and cheap; adding a new learning
signal means extending the aggregate. It shows topics, not documents, as the
primary unit.

### 2. Topics are the primary object, with four learning modes

The sidebar lists topics for quick access, and `Topics` is a gallery with
creation and backup import. A topic page has Learn / Practice / Voice /
Language modes, a header with share/export/reindex/delete, and the sources rail
only on Learn.

**Why:** "workspace" was an implementation word; "topic" is what a learner
thinks in. Keeping the feature panels (chat, study, voice, language) means the
rewrite changes navigation and framing, not working functionality.

**Consequences:** Learn keeps the conversation mounted while other modes are
open, so a streamed answer survives a tab switch. Sources moved into a rail on
Learn and no longer compete with the chat for the main column; a dedicated
library mode may follow if the rail becomes too small.

### 3. Routes stay state-based, except the public share page

The shell switches between Home/Topics/Topic/Settings in React state; only the
capability share page is a real URL (`/share/<token>`), because it must render
outside the authenticated shell.

**Why:** the app is a single-page workspace app with no deep-linking
requirements yet; adding a router would be worthwhile when topics need
shareable in-app URLs.

**Consequences:** refresh returns to Home rather than the last topic; the
public share page deliberately does not depend on the session gate.

## Verification

The five Playwright suites were updated to the new navigation (create topic,
Learn/Practice/Voice/Language labels) and pass, the visual harness was
retargeted to the new shell (55 captures: dashboard, topics, topic modes,
library, settings, offline, sharing, mobile), and the dashboard aggregate has a
smoke assertion.
