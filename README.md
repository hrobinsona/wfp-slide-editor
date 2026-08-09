# WFP Slide Editor

A bookmarklet-activated visual editor for HTML presentations. Click a bookmark, edit slides directly in the browser, use the inspector for precise adjustments, reorder/delete slides in Overview mode, then export the modified HTML.

## Why this exists

Prompting Claude for spatial tweaks (move that box 20px right, make this title bigger) is slow and error-prone. Direct manipulation is faster for the last 10% of polish. This tool covers that 10% without replacing Claude for everything else.

## How it works

1. The slide HTML stays clean. It never knows about the editor.
2. A bookmarklet (one-click bookmark in your browser bar) loads a hosted `editor.js` on demand.
3. `editor.js` mounts editor chrome in `#wfp-editor-root`, lets you edit the current slide or switch to Overview mode, and exports clean standalone HTML when you're done.

This separates content (the slide) from tooling (the editor). Slides remain portable, standards-compliant HTML. The editor evolves independently and applies retroactively to any slide ever made.

## Setup (one-time)

What you deploy is a single file (`editor.js`) hosted somewhere your browser can fetch on demand. A bookmarklet — a `javascript:` URL saved as a bookmark — injects that file into whichever slide page you have open. (`editor.js` is generated from `src/editor/`; see [Working on the editor](#working-on-the-editor) before you change it.)

**Option A — public GitHub Pages (recommended).** Editor URL lives at `https://<your-user>.github.io/wfp-slide-editor/editor.js`. Works on any device, any slide, any time.

```bash
# 1. Push this repo to GitHub. Make the repo public.
git remote add origin https://github.com/<your-user>/wfp-slide-editor.git
git push -u origin main

# 2. On github.com → Settings → Pages → Source: Deploy from branch → main / (root) → Save.
#    Wait ~1 minute for the first deploy.

# 3. Generate the bookmarklet pointed at your hosted editor.js
EDITOR_URL=https://<your-user>.github.io/wfp-slide-editor/editor.js npm run build:bookmarklet

# 4. The string is printed to stdout AND written to bookmarklet.txt.
#    Copy it, then in your browser create a new bookmark and paste it as the URL.
#    Drag-and-drop also works: select the string in a text file and drag onto your bookmarks bar.
```

**Option B — local-only.** Editor URL points at `http://localhost:8080/editor.js`. Only works while `npm run dev` is running on the same machine. Nothing of the editor lives on the internet.

```bash
# In one terminal, leave running:
npm run dev

# In another:
npm run build:bookmarklet -- --local
# (or:  EDITOR_URL=http://localhost:8080/editor.js npm run build:bookmarklet)

# Save the printed string as a bookmark.
```

### Using It

1. Open any WFP slide HTML (local file or hosted) in your browser.
2. Click the bookmarklet. The editor's "Edit: OFF" pill appears top-right.
3. Press `E` (or click the pill) to toggle edit mode.
4. Click an element to select it. Drag to move, resize with handles, edit text by double-clicking, or use the inspector for position, size, font size, colour, opacity, and reset styles.
5. Press `O` (or click `Overview`) for the slide grid. Click a slide to navigate, drag thumbnails to reorder, or delete slides with the thumbnail `x` button / Backspace / Delete.
6. `Cmd/Ctrl+Z` undoes; `Cmd/Ctrl+Shift+Z` or `Cmd/Ctrl+Y` redoes. `Cmd/Ctrl+S` (or `Export`) downloads `<original-name>-edited.html`. Open that file anywhere; no editor required.

### Reviewing Markdown files

The same editor annotates Markdown — `context.md`, `plan.md`, vault notes — without converting them to HTML. Markdown stays the source of truth.

```bash
npm run build:md-review
# then open tools/md-review.html in Chrome (double-click it; no server needed)
```

Bookmark that page (a normal bookmark, not a bookmarklet — a `.md` file is not a web page, so there is nothing to inject into). Then:

- **Open folder** once on your vault or repo root. Every `.md` beneath it appears in the dropdown, so switching notes is one click with no picker, and relative images resolve.
- **Open .md** for a one-off file outside that folder.
- **Recent…** lists the last eight files you opened, most recent first, across folders. It updates on every open and survives a restart (picking one is also the gesture Chrome needs to re-grant write access).

Edit mode is already on when the file opens — this surface exists only to annotate. Select any block, write an agent note, and press `Cmd/Ctrl+S`. The note is written back into the Markdown as an Obsidian callout:

```markdown
> [!HARRY] this figure is from the old model
```

That renders natively in Obsidian, greps cleanly, and needs no handoff protocol — Claude Code opens the file, sees the callout, and acts on it. Reopening the file turns those callouts back into live notes rather than showing them as content, so the notes panel (`N`) always reflects what is in the file.

Markdown mode reduces the editor to what Markdown can represent: agent notes plus text edits to plain paragraphs and headings. Geometry controls are hidden, and a block containing inline markup (a link, bold, code) is never rewritten from its rendered text — it is reported as skipped instead of having its syntax silently flattened. Obsidian-specific syntax (`[[wikilinks]]`, embeds, Dataview) renders as literal text; the page is an anchoring surface, not an Obsidian replica.

Nothing wakes the agent up: the note simply sits in the file until you next ask Claude to act on it. That is the trade for needing no server, no port, and no background process.

### Updating the editor

When `editor.js` changes (you push a fix, you bump a version), the next bookmarklet click pulls the latest. The cache-buster in the bookmarklet's URL (`?<timestamp>`) bypasses any browser cache, so there's nothing to clear manually.

## Working on the editor

`editor.js` is **generated**. Do not edit it directly — your change will be overwritten by the next build, and the sync check will reject the commit.

The source lives in `src/editor/` as 14 ordered fragments (`00-preamble.js` … `99-ready.js`). `scripts/build-editor.js` concatenates them, in the order listed in its `PARTS` array, into the deployed file. They all share one IIFE scope, so the split is purely about ownership: no modules, no loader, no extra browser request, and the deployed runtime is still one self-contained, dependency-free file.

```bash
# 1. Edit the fragment that owns the behaviour (see DESIGN.md → File Structure).
# 2. Regenerate the deployed file.
npm run build:editor

# 3. Confirm they agree. build:bookmarklet runs this first and refuses a stale editor.js.
node scripts/build-editor.js --check
```

Commit the fragments and the regenerated `editor.js` in the same commit.

## Quickstart for Claude Code

If you're Claude Code reading this for the first time:

1. Read `CLAUDE.md` or `AGENTS.md` for stack, commands, privacy rules, and workflow.
2. Read `REQUIREMENTS.md` for the current v2.1 product contract.
3. Read `DESIGN.md` for architectural decisions.
4. Read `TESTING.md` for the fixture-driven test approach.
5. Read `REFACTOR-MAINTAINABILITY.md` before maintainability work.
6. Use `TASKS.md` and `feature-briefs/` as historical build records, not as the active product backlog.
7. The `fixtures/` directory contains real WFP presentations to test against. Treat them as immutable inputs.

## Project layout

```
.
├── CLAUDE.md                  # Session-persistent instructions for Claude Code
├── README.md                  # This file
├── REQUIREMENTS.md            # Current v2.1 product contract
├── DESIGN.md                  # Architectural decisions and rationale
├── STACK.md                   # Tech choices (and why each was chosen)
├── TASKS.md                   # Historical v1 implementation plan
├── TESTING.md                 # Test approach using fixture HTMLs
├── ROADMAP.md                 # v2+ deferred items
├── REFACTOR-MAINTAINABILITY.md # Executable refactor brief
├── feature-briefs/            # Delivered v2 feature briefs, kept as history
├── fixtures/                  # Real WFP presentations for testing
│   └── README.md              # How fixtures are used
├── scripts/                   # build-editor.js, build-bookmarklet.js
├── src/editor/                # Editor source: 14 ordered fragments (edit these)
│   └── README.md              # Fragment boundaries
├── tests/                     # Playwright coverage for v1, inspector, overview
└── editor.js                  # GENERATED deployed runtime — do not edit
```
