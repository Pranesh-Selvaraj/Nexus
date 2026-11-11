# Nexus brand kit

The identity for Nexus: one mark, one wordmark, one violet point. This document is the source of truth for how they are built, combined and used.

## Contents

- [The idea](#the-idea)
- [Asset index](#asset-index)
- [The mark: the weave](#the-mark-the-weave)
- [The wordmark](#the-wordmark)
- [The point](#the-point)
- [The lockups](#the-lockups)
- [Colour](#colour)
- [Typography](#typography)
- [App icons, favicon and install](#app-icons-favicon-and-install)
- [Using the logo](#using-the-logo)
- [Voice and tone](#voice-and-tone)
- [Regenerating the raster assets](#regenerating-the-raster-assets)
- [Licensing and attribution](#licensing-and-attribution)

## The idea

Nexus takes many sources — books, papers, slides, lectures, web pages, photographs — and weaves them into one grounded answer. The mark is that sentence: **two strands woven with a visible over-and-under gap**. Many threads, one fabric.

The wordmark is lowercase **nexus**, set tight and heavy so it reads as a word rather than a label. The **violet point** at the end is the full stop that closes the thought — the single place where everything the strands carry comes together.

Three constraints shaped the system:

- **It has to survive 16 px.** The braid's silhouette is a single woven band, so it stays legible in a tab even when the individual strands merge.
- **It has to work in one ink.** Every lockup ships in a monochrome cut, so the identity prints, embosses, and survives a terminal without colour.
- **It has to look like the product.** No glow, no bevel, no 3D. The only effects are two flat violet gradients and the gaps in the weave.

## Asset index

All masters live in [`assets/brand/`](../../assets/brand) and are SVG. Edit a master, never a PNG.

| File                                  | What it is                                    | Use it for                             |
| ------------------------------------- | --------------------------------------------- | -------------------------------------- |
| `nexus-mark.svg`                      | The braid alone, `currentColor`, 32-unit grid | Inline UI, one-colour contexts         |
| `nexus-mark-brand.svg`                | The braid in the violet gradient              | Light backgrounds, documents           |
| `nexus-lockup-horizontal.svg`         | Braid + wordmark + point (ink wordmark)       | Light backgrounds: README, docs, print |
| `nexus-lockup-horizontal-inverse.svg` | Braid + wordmark + point (paper wordmark)     | Dark backgrounds: app, slides, video   |
| `nexus-lockup-horizontal-mono.svg`    | The whole lockup in `currentColor`            | One-colour print, engraving, terminals |
| `nexus-lockup-stacked.svg`            | Braid above the wordmark, light variant       | Square formats, covers, avatars        |
| `nexus-lockup-stacked-inverse.svg`    | Stacked, dark variant                         | Same, on dark backgrounds              |
| `nexus-lockup-stacked-mono.svg`       | Stacked, `currentColor`                       | One-colour contexts                    |
| `nexus-wordmark.svg`                  | Wordmark + point alone, ink                   | Where the braid already appears nearby |
| `nexus-wordmark-inverse.svg`          | Wordmark + point alone, paper                 | Same, on dark                          |
| `nexus-tile.svg`                      | App icon: violet tile, white braid            | Source for the PWA/store icons         |
| `nexus-tile-favicon.svg`              | Tile with a thicker braid for small sizes     | Browser tabs (16–32 px)                |
| `nexus-tile-maskable.svg`             | Full-bleed tile, braid inside the safe zone   | Android/maskable install icons         |
| `nexus-social-card.svg` / `.png`      | 1280×640 preview card                         | GitHub social preview, link previews   |

Runtime files generated from those masters:

| File                                               | Size    | Purpose                       |
| -------------------------------------------------- | ------- | ----------------------------- |
| `apps/frontend/public/icons/favicon.svg`           | vector  | Browser tab icon              |
| `apps/frontend/public/icons/icon-192.png`          | 192×192 | PWA icon, `purpose: any`      |
| `apps/frontend/public/icons/icon-512.png`          | 512×512 | PWA icon, `purpose: any`      |
| `apps/frontend/public/icons/icon-maskable-512.png` | 512×512 | PWA icon, `purpose: maskable` |
| `apps/frontend/public/icons/apple-touch-icon.png`  | 180×180 | iOS home screen               |

The in-app mark is `apps/frontend/src/components/NexusLogo.tsx`, which mirrors `nexus-mark.svg`. If the mark changes, both change together.

## The mark: the weave

The braid is drawn on a **32-unit grid**:

- Two strands, each a sampled cosine of **two periods** across the box, oscillating ±4.9 units around the centre line, from `x = 4` to `x = 28`, drawn with a **3.45-unit round-capped stroke**.
- They cross at **`x = 10` and `x = 22`**. The weave **alternates**: at the first crossing the front strand is interrupted by a 3.275-unit-radius gap and the back strand passes over it; at the second the back strand carries the gap and the front passes over. That alternation — not just a gap — is what makes it read as a plait rather than as two broken curves.
- Nothing else. No outline, no shadow, no second colour inside the mark.

The ink box is 27.45 × 13.25 units, centred in the 32-unit canvas. Keep the surrounding whitespace: do not crop the file.

**Clear space.** Leave at least **12 units** (about one braid height) clear on every side. All lockups include it.

**Cache busting.** Favicons are cached harder than anything else a browser fetches. The `?v=` query on the icon links in `index.html`, the `?v=` on the manifest icons and the service-worker `VERSION` must all be bumped together whenever the mark, the tile or the wordmark changes — otherwise the tab keeps the previous logo for days.

**Minimum sizes.**

| Asset             | Minimum                          |
| ----------------- | -------------------------------- |
| Mark alone        | 24 px                            |
| Horizontal lockup | 140 px wide (≈ 25 px cap height) |
| Stacked lockup    | 96 px wide                       |
| Wordmark alone    | 100 px wide                      |
| App tile          | 32 px                            |

Below these sizes the weave starts to close up. That is what the favicon tile is for — it uses a heavier stroke (4.3 instead of 3.45) and a larger scale so the braid still reads at 16 px.

## The wordmark

The wordmark is **“nexus”** in **Inter Tight ExtraBold (800)**, lowercase, tracking **−4.5 % (−0.045 em)**.

It ships as **outlines** in every master: no webfont is loaded at runtime, and no font can silently substitute. The rules that follow:

- **Never retype the wordmark** in a text box, another weight, another face or different tracking. Use the SVG files.
- **Never set it in caps** in a lockup. “NEXUS” is fine in body copy or a label, never as the logo.
- **The point is part of the wordmark** in every lockup: keep it, at the same size and offset.

The wordmark's x-height is 54.59 units at font size 100 (cap height 72.75). That ratio is why the braid is scaled to a **82-unit box** in the horizontal lockup: its ink lands at about the wordmark's x-height, so the mark and the word read as one line.

## The point

The point is a **20-unit circle at font size 100 (0.2 em)**, centred **8 units after the wordmark's last glyph** with its bottom edge on the baseline. It carries the violet gradient and is the only element besides the braid that is allowed colour.

- In the wordmark-only files the point is the whole accent.
- It is never used on its own as a mark (the braid is the mark).
- It is never removed from a lockup, and never made a different colour from the gradient.

## The lockups

Three arrangements, each in light, inverse and monochrome:

- **Horizontal** — braid, then wordmark, then point. The default. The braid's ink sits **30 units (0.3 em) left of the wordmark's ink**.
- **Stacked** — braid centred above the wordmark, 30 units of vertical air. For covers, avatars and square formats.
- **Wordmark only** — when the braid is already present in the layout (for example a slide footer that repeats the tile).

The masters include the clear space, so a lockup can be placed flush against a container edge without extra padding.

## Colour

One accent (violet) and one neutral ramp. Nothing else.

### Violet

| Name       | Hex       | Use                                                 |
| ---------- | --------- | --------------------------------------------------- |
| Violet 300 | `#c4b5fd` | The braid on dark backgrounds (gradient start)      |
| Violet 400 | `#a78bfa` | Braid gradient start on light; point gradient start |
| Violet 500 | `#8b5cf6` | Tile gradient start, point gradient start           |
| Violet 600 | `#7c3aed` | Braid gradient end on light                         |
| Violet 700 | `#6d28d9` | Braid gradient end on dark                          |
| Purple 600 | `#9333ea` | Point/tile gradient end                             |

- **Braid, light backgrounds:** `#a78bfa → #6d28d9`.
- **Braid, dark backgrounds:** `#c4b5fd → #8b5cf6`.
- **Point:** `#8b5cf6 → #9333ea`.
- **Tile:** `#8b5cf6 → #9333ea`.

Do not add a third stop, a bevel, a glow or a shadow.

### Neutrals

| Name              | Hex       | Use                 |
| ----------------- | --------- | ------------------- |
| Ink               | `#0b0910` | Canvas, social card |
| Paper             | `#faf9fc` | Light backgrounds   |
| Wordmark on dark  | `#f4f2f8` | The lockup's white  |
| Wordmark on light | `#0d0b12` | The lockup's ink    |
| Muted             | `#8a8196` | Captions on dark    |

### Semantic signals

Amber `#fbbf24` (due), emerald `#34d399` (done), red `#f87171` (danger), sky `#38bdf8` (info). These belong to state in the interface and never to the logo.

## Typography

**Interface:** the system UI stack — Nexus makes no webfont requests.

```
ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif
```

**Mono:** the system mono stack, for code, keys and identifiers.

**Wordmark:** Inter Tight ExtraBold, outlines only.

Weights in use: 400 body, 500 labels, 600 headings and the wordmark's parent UI, 800 only inside the wordmark outline.

## App icons, favicon and install

The install icon is the **tile**: a 32-unit rounded square (`rx` 7.52) filled with the `#8b5cf6 → #9333ea` gradient, carrying the braid in white at 74 % scale.

- **`any` icons** keep the rounded corners and transparency outside them.
- **`maskable`** is full-bleed with the braid at 58 % so it stays inside the 80 % safe circle.
- **`apple-touch-icon`** is the full-bleed square (iOS rounds it itself); never transparent.
- **`favicon.svg`** scales the whole braid to 86 % (stroke and gaps together — thickening only the stroke closes the weave), and a 32 px PNG plus a real `/favicon.ico` cover clients that ignore SVG icons.

## Using the logo

**Do**

- Pick the variant by background: `-inverse` on dark, plain on light, `-mono` for one colour.
- Keep the aspect ratio and scale uniformly.
- Use the SVG master, or `NexusLogo` for the mark inside the app.
- Keep the point with the wordmark.

**Don't**

- Don't recolour the braid outside the violet ramp, and never give the two strands different colours.
- Don't rotate, skew, outline, emboss, or add shadows and glows.
- Don't put the braid on a mid-tone or a photograph; use the inverse or a scrim.
- Don't rebuild the lockup from the mark plus typeset text: the gap, the x-height match and the point offset are set in the lockup files.
- Don't put the braid inside a different shape; the tile is the one container.
- Don't use the mark as a bullet, a spinner or a pattern.
- Don't imply endorsement: a fork may say “works with Nexus”, but may not present itself as Nexus.

## Voice and tone

Nexus speaks like a careful tutor who has read the material:

- **Grounded.** Say what is cited and what is missing.
- **Direct.** Second person, present tense, short sentences.
- **Specific.** Name the file, the page, the count, the model.
- **Calm.** No urgency theatre, no streak-shaming, no confetti.
- **Honest about limits.** Name the gap in the same breath as the feature.

Names: **Nexus** (capital N, one word), **topics** (not workspaces), **sources** for documents, **cards** for flashcards, **practice** for the study loop.

## Regenerating the raster assets

```bash
pnpm brand:assets
```

`scripts/brand-assets.mjs` renders the masters with the Chromium the frontend's Playwright dependency already installs, writes the PNG icons (192, 512, maskable 512, Apple 180, favicon 32) and the social card, copies the favicon master, assembles `/favicon.ico` from the 32 px PNG, and fails if a PNG has the wrong size or colour type or if `manifest.webmanifest` references a missing file.

To change the identity: edit the masters, run the script, and update `NexusLogo.tsx` to match. The committed PNGs must be regenerated in the same commit as the masters.

## Licensing and attribution

The brand assets are part of Nexus and covered by its [MIT licence](../../LICENSE), with the caveat about endorsement above.

The wordmark outlines were converted from **Inter Tight** by Rasmus Andersson, licensed under the [SIL Open Font License 1.1](https://github.com/rsms/inter/blob/master/LICENSE.txt). The font itself is not redistributed here — only outlined letterforms are.
