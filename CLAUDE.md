# WFP Slide Editor

Bookmarklet-activated visual editor for HTML presentations. Lets a user drag, resize, edit text, and change font size on slides directly in the browser, then export the modified HTML.

## Read these first
- `REQUIREMENTS.md` — what v1 must do (and explicit non-goals)
- `DESIGN.md` — architectural decisions and the rationale behind them
- `TASKS.md` — implementation plan in build order
- `TESTING.md` — fixture-driven test approach

## Stack
- Vanilla JavaScript, no build step, no framework
- Plain CSS scoped via a unique editor ID
- Playwright for end-to-end tests
- GitHub Pages will host the final `editor.js`

## Commands
- `npm install` — install Playwright and dev dependencies
- `npm test` — run all Playwright tests
- `npm run dev` — start a local file server on port 8080 (for opening fixtures with the editor loaded)
- `npm run build:bookmarklet` — minify `editor.js` location into a paste-able bookmarklet string

## Conventions
- No build step for `editor.js`. It must work as a single self-contained file fetched via `<script>` injection.
- No framework. Vanilla JS only. Keep payload small and dependency-free.
- All editor-injected DOM lives inside one root `<div id="wfp-editor-root">` so it's trivial to remove on export.
- All editor-internal markers on user elements use the `data-wfp-edit-*` namespace so they're easy to scrub.
- Fixtures in `fixtures/` are immutable inputs. Never modify them. Tests produce new HTML in `tests/output/` and compare.
- Prefer functional, declarative code with small modules over ES6 classes. State lives in plain objects.

## Workflow rules
- Each phase in TASKS.md is tagged with a TDD mode (see below). Follow it.
- Before declaring a phase done, invoke the `code-reviewer` subagent. Don't move to the next phase until it APPROVES.
- For running tests during implementation, prefer the `playwright-runner` subagent over running `npm test` in the main context. Keeps the main conversation clean.
- Never make a change that alters how `fixtures/*.html` render when the editor is NOT loaded. Open the fixture in a browser without the bookmarklet to confirm.
- If you're unsure whether a change is in scope for v1, check `REQUIREMENTS.md` non-goals. If it's deferred, add it to `ROADMAP.md` instead of building it.

## TDD modes
Each phase in TASKS.md is tagged with one of these:
- **strict:** Write the Playwright test first. Confirm it fails (the feature doesn't exist yet). Then implement until it passes. Then invoke `code-reviewer`.
- **build-first:** Implement the feature, verify visually in a real browser that it looks/behaves right, then write Playwright tests that lock in the behavior. Tests must exist before declaring the phase done. Then invoke `code-reviewer`.

Build-first is reserved for phases where "correct" is partly visual (selection ring rendering, resize handle layout, toolbar polish). Strict is the default for everything else.

## Subagents
Two project subagents are available:
- `code-reviewer` (Opus) — invoked at the end of every phase. Reviews diff with fresh context, checks WFP-specific gotchas, gates phase completion.
- `playwright-runner` (Sonnet) — invoked whenever tests need to run. Returns concise pass/fail with probable cause for failures.

Definitions live in `.claude/agents/`.

## Human checkpoints
Some phases require explicit human approval before proceeding, marked `*(checkpoint)*` in TASKS.md.

At a checkpoint, after `code-reviewer` returns APPROVE:
1. STOP. Do not start the next phase.
2. Produce a checkpoint summary with these sections:
   - **Built:** one paragraph on what's now working.
   - **Verify by hand:** numbered list (copy from the phase's "Verify by hand" section in TASKS.md).
   - **Decisions made:** any non-obvious choices made during implementation that the human should know about (e.g. "added a 5px drag deadzone", "chose 2-second toast duration"). Skip if there were no surprising decisions.
   - **Reply `proceed` to continue, or describe corrections.**
3. Wait for the human's reply. Do not start the next phase until they reply.

Non-checkpoint phases (no `*(checkpoint)*` tag) run through to the next phase automatically once `code-reviewer` approves. Saves context switches on phases where the tests + reviewer catch everything that matters.

## Critical gotchas
- WFP slides apply `transform: scale()` to a `.deck` element to fit 1920×1080 into the viewport. Mouse delta from a drag event is in viewport pixels but the slide coordinate system is unscaled. The editor MUST divide deltas by the current scale before applying them as inline styles.
- Each fixture HTML is a multi-slide deck. Only `.slide.active` is visible. The editor only ever operates on the active slide.
- Existing `keydown` listeners on `document` handle navigation. The editor must `stopPropagation` on its own keys and disable nav while edit mode is on.

## Git workflow
- One commit per phase, made at the end of the phase after `code-reviewer` approves (and after the human approves at checkpoint phases).
- Commit message format: Conventional Commits. `feat(phase-N): short summary` for phase work. `chore:` for setup. `test:` if a phase only adds tests. Example: `feat(phase-4): drag with scale-aware deltas and unlock-on-flow`.
- Each phase in TASKS.md has a `**Commit:**` line at the end specifying the suggested message.
- Do NOT push automatically. Pushing is manual and controlled by the human. Rationale: GitHub Pages auto-deploys on push, and the bookmarklet pulls live; an accidental push of broken code would break the editor for any open slide.
- Tag `v1.0.0` after Phase 10 ships and the human has confirmed the bookmarklet works end-to-end.

## Privacy: what's safe to commit
The editor code is fine to share publicly. WFP/Philips/presentation content is NOT.

Rules for what may enter git:
- ✅ All editor code (`editor.js`, helpers, scripts)
- ✅ All markdown docs (CLAUDE.md, REQUIREMENTS.md, DESIGN.md, etc.)
- ✅ All test code in `tests/` (but NOT test outputs)
- ✅ Fixtures explicitly allow-listed in `.gitignore`
- ❌ Any HTML fixture not on the allow-list (default-blocked by `.gitignore`)
- ❌ Anything containing real names, "Philips", "WFP", "Pregnancy+", "Baby+", or internal product/strategy details
- ❌ Test output files in `tests/output/`
- ❌ Local notes, scratch files, anything ending in `-private.html` or `-internal.html`

Before any `git add` or `git commit`:
1. Run `git status` and read the staged file list.
2. If you see any HTML file in `fixtures/` being staged that isn't already allow-listed in `.gitignore`, STOP. Ask the human whether to add it to the allow-list (deliberate decision) or skip it.
3. Never use `git add -f` to force-add a gitignored file without explicit human approval.

When unsure, ask. The cost of a clarifying question is seconds; the cost of accidentally pushing private content to a public GitHub Pages repo is unrecoverable.
