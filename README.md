# WFP Slide Editor

A bookmarklet-activated visual editor for HTML presentations. Click a bookmark, edit any slide directly in the browser (drag, resize, retype, change font size), then export the modified HTML.

## Why this exists

Prompting Claude for spatial tweaks (move that box 20px right, make this title bigger) is slow and error-prone. Direct manipulation is faster for the last 10% of polish. This tool covers that 10% without replacing Claude for everything else.

## How it works

1. The slide HTML stays clean. It never knows about the editor.
2. A bookmarklet (one-click bookmark in your browser bar) loads a hosted `editor.js` on demand.
3. `editor.js` activates an edit overlay on the current slide, lets you make changes directly, and exports the modified HTML when you're done.

This separates content (the slide) from tooling (the editor). Slides remain portable, standards-compliant HTML. The editor evolves independently and applies retroactively to any slide ever made.

## Setup (one-time)

The editor is a single file (`editor.js`) hosted somewhere your browser can fetch on demand. A bookmarklet — a `javascript:` URL saved as a bookmark — injects that file into whichever slide page you have open.

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

### Using it

1. Open any WFP slide HTML (local file or hosted) in your browser.
2. Click the bookmarklet. The editor's "Edit: OFF" pill appears top-right.
3. Press `E` (or click the pill) to toggle edit mode.
4. Click an element to select it. Drag to move. Drag the corner/edge handles to resize. `↑`/`↓` (Shift for ×5) nudges font size on text. Double-click a text element to retype it. `Cmd/Ctrl+Z` undoes; `Cmd/Ctrl+Shift+Z` redoes.
5. `Cmd/Ctrl+S` (or click `Export`) downloads `<original-name>-edited.html`. Open that file anywhere — no editor required.

### Updating the editor

When `editor.js` changes (you push a fix, you bump a version), the next bookmarklet click pulls the latest. The cache-buster in the bookmarklet's URL (`?<timestamp>`) bypasses any browser cache, so there's nothing to clear manually.

## Quickstart for Claude Code

If you're Claude Code reading this for the first time:

1. Read `CLAUDE.md` for stack, commands, and rules.
2. Read `REQUIREMENTS.md` for what v1 must do (and not do).
3. Read `DESIGN.md` for architectural decisions.
4. Read `TASKS.md` for the build plan.
5. Read `TESTING.md` for the fixture-driven test approach.
6. The `fixtures/` directory contains real WFP presentations to test against. Treat them as immutable inputs.

## Project layout

```
.
├── CLAUDE.md                  # Session-persistent instructions for Claude Code
├── README.md                  # This file
├── REQUIREMENTS.md            # v1 spec: what the editor must do
├── DESIGN.md                  # Architectural decisions and rationale
├── STACK.md                   # Tech choices (and why each was chosen)
├── TASKS.md                   # Implementation plan, ordered
├── TESTING.md                 # Test approach using fixture HTMLs
├── ROADMAP.md                 # v2+ deferred items
├── .claude/
│   ├── settings.json          # Project-level Claude Code settings
│   └── agents/
│       ├── code-reviewer.md   # Reviews each phase before completion (Opus)
│       └── playwright-runner.md  # Runs tests, reports failures (Sonnet)
├── fixtures/                  # Real WFP presentations for testing
│   └── README.md              # How fixtures are used
├── tests/                     # Playwright tests (created in TASKS.md)
└── editor.js                  # The actual editor (created in TASKS.md)
```
