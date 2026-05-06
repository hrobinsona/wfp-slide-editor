# Setup

This project already contains the shipped editor. These notes are for getting a local checkout running, hosting `editor.js`, and generating a bookmarklet.

## Prerequisites

- Node.js 20 or newer.
- A GitHub account if using public GitHub Pages hosting.
- A browser with a bookmarks bar.

## Hosting Models

### Option A: Public GitHub Pages

- The repo is public.
- The editor code is publicly readable.
- Slide fixtures and private deck content stay out of git.
- The bookmarklet works anywhere the browser can fetch your Pages URL.

### Option B: Local-only

- Nothing is hosted publicly.
- The bookmarklet points at `http://localhost:8080/editor.js`.
- You must run `npm run dev` before using the bookmarklet.

## Privacy By Default

HTML fixtures are gitignored unless explicitly allow-listed. Before any commit, inspect `git status` and make sure no private deck HTML or generated test output is staged.

Never use `git add -f` for ignored fixtures without an explicit human decision.

## Install

```bash
cd /path/to/wfp-slide-editor
npm install
```

## Run Tests

```bash
npm test
```

For targeted debugging:

```bash
npx playwright test tests/v2-overview.spec.js
npx playwright test tests/02-selection.spec.js:50 --repeat-each=10
```

## Serve Locally

```bash
npm run dev
```

This serves the repo root on `http://localhost:8080` with caching disabled.

Open a fixture such as:

```text
http://localhost:8080/fixtures/Townhall-1.html
```

## Enable GitHub Pages

On GitHub:

1. Go to the repo settings.
2. Open Pages.
3. Choose "Deploy from a branch".
4. Select `main` and `/ (root)`.
5. Save.

After deployment, `editor.js` is available at:

```text
https://[username].github.io/wfp-slide-editor/editor.js
```

GitHub Pages deploys on push to `main`, so do not push unverified editor changes.

## Build The Bookmarklet

Hosted Pages mode:

```bash
EDITOR_URL=https://[username].github.io/wfp-slide-editor/editor.js npm run build:bookmarklet
```

Local-only mode:

```bash
npm run dev
npm run build:bookmarklet -- --local
```

The script prints the bookmarklet and writes it to `bookmarklet.txt`.

## Use The Editor

1. Open a slide deck HTML file.
2. Click the bookmarklet.
3. Press `E` for edit mode.
4. Press `O` for Overview mode.
5. Press `Cmd/Ctrl+S` or click Export to download edited HTML.

## Working With Codex Or Claude Code

For current development, read these first:

1. `AGENTS.md` or `CLAUDE.md`.
2. `REQUIREMENTS.md`.
3. `DESIGN.md`.
4. `TESTING.md`.
5. `ROADMAP.md`.
6. `REFACTOR-MAINTAINABILITY.md` for maintainability work.

`TASKS.md` and `feature-briefs/` are historical build records. Do not start new work from them unless the user explicitly asks to revisit that history.

## Updating The Editor

Pages mode: commit, test, push when ready, then wait for GitHub Pages to deploy.

Local mode: changes to `editor.js` are available immediately through the local server. The bookmarklet cache-buster prevents stale script loads.
