# Maintainability Refactor Brief

## Status

Executed on branch `codex/refactor-maintainability` and merged to `main`.

This brief remains as the record of what was fixed and as guidance for the next modularity pass. The correctness-focused refactor (R0-R4) is complete. **Physical source splitting has since landed too:** `src/editor/` now holds 14 ordered fragments that `scripts/build-editor.js` concatenates into the generated `editor.js`. See `DESIGN.md` → File Structure for the fragment map and `README.md` → Working on the editor for the workflow.

## Goal

Improve maintainability without changing user-visible editor behaviour:

- Fix known correctness gaps first.
- Stabilize flaky tests.
- Preserve no-framework, no-runtime-dependency, bookmarklet-loaded deployment.
- Leave the project safer for future feature work.

## Scope Completed

### R0 - Lock Down Known Failures

Added regression coverage for:

- Selection ring alignment after a selected element moves without an explicit editor event.
- Undo after flow unlock, ensuring the UI is not bound to a detached selection and keyboard edits do not mutate a detached old reference.
- Bookmarklet output isolation under Playwright parallelism.

### R1 - History Snapshot Correctness

Changed history snapshots so `innerHTML` is captured only for content-edit transactions. Style-only operations now restore style and editor markers without recreating child DOM through parent `innerHTML` writes.

Also added disconnected-selection cleanup so undo/redo cannot leave the inspector or keyboard handlers bound to a detached node.

### R2 - Selection Overlay Resilience

Added requestAnimationFrame-based selection tracking while edit mode has a connected selected element. The loop stops during text edit, Overview mode, deselection, or edit-mode exit.

### R3 - Bookmarklet Test Isolation

Added `--out <path>` / `--out=<path>` support to `scripts/build-bookmarklet.js`. Normal usage still writes `bookmarklet.txt`; tests can now write isolated per-test files.

### R4 - Internal Boundary Cleanup

Kept this intentionally narrow. The refactor clarifies the two highest-risk boundaries:

- Selection overlay lifecycle: `startSelectionTracking`, `stopSelectionTracking`, and disconnected-selection cleanup.
- History snapshot intent: style/marker snapshots versus content snapshots.

Physical source splitting was deferred at the time of this brief and has since been done — see Status above and the Next Maintainability Step below.

## Verification Commands

Run before future modularity work and after any substantial refactor:

```bash
npm test
npx playwright test tests/02-selection.spec.js:65 --repeat-each=10
npx playwright test tests/04b-flex-freeze.spec.js tests/06-undo.spec.js tests/v2-overview.spec.js
npm run build:bookmarklet
```

## Manual Verification

1. Open `fixtures/Townhall-1.html` without the editor loaded. Confirm arrows, animations, and scaling work.
2. Inject the editor and press `E`. Confirm edit mode toggles and slide navigation is suppressed while edit mode is on.
3. Select a heading. Confirm the ring, handles, dimension bubble, and inspector align and remain aligned after a short wait.
4. Drag a flow-positioned element. Undo and redo. Confirm nearby content does not jump and the inspector is not bound to a detached element.
5. Use inspector X/Y, W/H, font size, colour, opacity, and reset. Undo/redo each category at least once.
6. Double-click text, edit it, exit with Escape, then undo/redo the content change.
7. Press `O`. In Overview mode, click a thumbnail to navigate, drag to reorder, delete a slide, undo/redo reorder and delete, then exit Overview.
8. Export and open the edited HTML in a fresh tab. Confirm edits, slide order, and deletion persist, and no editor UI or Overview state is visible.
9. Repeat a quick smoke pass on `boilerplate.html`.

## Next Maintainability Step

The boundaries below were the target list for modularization. Every one of them now has a fragment in `src/editor/` (plus `85-adaptive-fade.js`, added afterwards):

- Constants, icons, and CSS.
- State and lifecycle.
- Slide/deck helpers.
- Selection overlays.
- Drag, resize, and flow unlock.
- Inspector.
- History.
- Inline text edit.
- Overview mode.
- Export.
- Bookmarklet/runtime initialization.

Known shared-scope hazard, found in review 2026-07-26: `rectsOverlap` is declared twice in the single IIFE (`40-helpers-selection-inspector.js` and `85-adaptive-fade.js`). The later declaration wins for all callers, so Front's competitor test actually runs the adaptive-fade copy; the two are semantically identical today, but an edit to the Front-local copy would silently do nothing. Deduplicate to one shared helper during the next pass.

What remains is dependency cleanup rather than further splitting. The fragments share one IIFE scope, so file boundaries currently document ownership without enforcing it: any fragment can still reach any other's helpers. The next pass should narrow those reaches — starting with the largest fragments (`20-dom-css.js`, `30-ui-inspector-controls.js`, `40-helpers-selection-inspector.js`, all around 1.3-1.5k lines) — while keeping the concatenated output byte-identical in behaviour and the deployed runtime a single dependency-free file.

Also update `scripts/build-editor.js` whenever a fragment is added or reordered; its `PARTS` array, not the directory listing, is the source of truth for build order.
