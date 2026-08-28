# WFP Slide Editor

Bookmarklet-activated visual editor for HTML presentations. It supports element selection, drag, resize, inline text edit, inspector controls, Overview mode for slide reorder/delete, undo/redo, and clean HTML export.

## Read These First

- `REQUIREMENTS.md` - current v2.1 product contract.
- `DESIGN.md` - architectural decisions and current implementation shape.
- `TESTING.md` - fixture-driven test approach and known reliability work.
- `ROADMAP.md` - deferred features and active engineering tracks.
- `FEATURES-AND-BUGS.md` - running tracker of known bugs and small iteration candidates on existing behaviour.
- `REFACTOR-MAINTAINABILITY.md` - executable brief for the next maintainability pass.
- `TASKS.md` and `feature-briefs/` - historical build records.

## Stack

- Vanilla JavaScript, no framework.
- No required build step for the deployed editor.
- Plain CSS scoped through `#wfp-editor-root` and explicit editor state attributes.
- Playwright for browser tests.
- GitHub Pages hosts `editor.js`.

## Commands

- `npm install` - install dev dependencies.
- `npm test` - run all Playwright tests.
- `npm run dev` - serve the repo on port 8080 for local fixture testing.
- `npm run build:editor` - assemble `editor.js` from `src/editor/` fragments.
- `npm run build:bookmarklet` - generate `bookmarklet.txt` (fails if `editor.js` is out of sync with `src/editor/`).
- `npm run build:md-review` - assemble `tools/md-review.html` from `src/md/` (Markdown review host).

## Conventions

- `editor.js` is **generated** — it is assembled by concatenating `src/editor/*.js` in order. Edit the fragments, then run `npm run build:editor`. Never let the two drift; `build:bookmarklet --check` enforces sync.
- `tools/md-review.html` is **generated** the same way from `src/md/*.js` (`npm run build:md-review`, `--check` verifies). It is inlined rather than importing modules because `file://` origins cannot fetch external ES modules.
- Markdown mode keeps the editor Markdown-ignorant: the host owns all Markdown knowledge and the editor only reads `state.markdownMode` and calls `window.__wfpMarkdownSink`. Do not add Markdown parsing to `src/editor/`.
- `editor.js` must work as a self-contained injected script.
- Keep production runtime dependency-free.
- All editor-injected DOM lives inside `#wfp-editor-root`.
- Editor markers on slide/user elements use the `data-wfp-edit-*` namespace.
- Fixtures in `fixtures/` are immutable inputs. Tests write artifacts to `tests/output/`.
- Prefer small functions and plain objects over classes unless a new abstraction clearly earns its keep.
- Do not alter how fixtures render when the editor is not loaded.

## Current Workflow

- For new feature work, write or update a brief before building.
- For refactor work, follow `REFACTOR-MAINTAINABILITY.md`.
- Preserve existing behaviour unless the brief explicitly changes it.
- Add or harden Playwright coverage before landing behaviour-sensitive changes.
- Before declaring a phase or brief complete, run the relevant tests and invoke the `code-reviewer` subagent if available.
- For noisy Playwright runs, prefer the `playwright-runner` subagent if available.

Historical note: `TASKS.md` is the original v1 phase plan, not the active backlog.

## TDD Modes

Use the mode specified by the active brief:

- **strict:** write the Playwright test first, confirm it fails, then implement.
- **build-first:** implement visual behaviour, verify manually, then write Playwright tests before completion.

Build-first is for visual surfaces where "correct" needs a browser pass; strict is the default for logic and export behaviour.

## Subagents

Project subagents may exist in `.claude/agents/`:

- `code-reviewer` - reviews diffs with fresh context and checks project-specific gotchas.
- `playwright-runner` - runs Playwright and returns concise pass/fail context.

## Critical Gotchas

- WFP slides apply `transform: scale()` to `.deck`. Pointer deltas are viewport pixels; style writes are slide pixels. Divide deltas by the current deck scale.
- Which class marks the visible slide is a host authoring choice, not a contract — `.slide.active` on older decks, `.slide.is-active` on newer ones. Never hardcode either: read with `isActiveSlide()`, write with `setSlideActive()`. `.progress-dot.active` is a separate convention and stays literal. Element editing operates on the active slide only.
- Host decks also page on pointer events (`pointerup` on `.deck`), which fire *before* `click` — `onClick` and `state.suppressClickUntil` cannot see them. Edit and overview mode take the whole gesture in capture phase; view mode leaves it to the deck.
- Do not assume `.deck` is a direct child of `<body>`. Decks that wrap their canvas (`<main class="stage">`) need the ancestor chain spared from overview's sibling-hiding rule — see `data-wfp-edit-deck-ancestor`.
- Existing `keydown` listeners on `document` handle slide navigation. Editor-owned keys must run in capture phase and stop propagation when edit/overview mode owns them.
- Overview reorder/delete mutates actual `.slide` order in `.deck`. After deck mutation, do not assume original fixture navigation closures still match live DOM order.
- Overview state, editor root, `contenteditable`, and `data-wfp-edit-*` markers must not leak into exported HTML.
- Flow unlock touches selected elements, siblings, and containers. Undo/redo must not leave `state.selected` pointing at detached DOM.
- `editor.js` is now oversized. Prefer maintainability cleanup before large new features.

## Git Workflow

- Use Conventional Commits for intentional commits.
- Do not push automatically. GitHub Pages deploys on push and the bookmarklet pulls live code.
- Before staging or committing, run `git status` and inspect the file list.
- Never stage private fixture HTML or generated test output.
- Do not force-add gitignored fixtures without explicit human approval.

## Privacy: Safe To Commit

Safe:

- Editor code and scripts.
- Markdown docs.
- Test code.
- Explicitly allow-listed sanitized fixtures.

Not safe:

- HTML fixtures not already allow-listed.
- Anything containing real names or private WFP/Philips/product strategy content.
- `tests/output/`, Playwright reports, screenshots, local notes, scratch files, and private/internal deck exports.

When unsure, ask before staging.
