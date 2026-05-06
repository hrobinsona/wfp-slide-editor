# Maintainability Refactor Brief

## Status

Active engineering brief. Use this before adding major new product features.

## Context

The v2.1 editor has strong feature coverage: element editing, inspector controls, Overview mode, slide reorder/delete, undo/redo, export, and bookmarklet generation all exist. The implementation is now carrying too much surface area in one file, and review found a few correctness and test-reliability issues that should be fixed before extending the editor further.

Current shape:

- Runtime source: `editor.js`.
- Approximate size: 3.4k lines.
- Runtime dependencies: none.
- Deployment: hosted `editor.js` loaded by bookmarklet.
- Tests: Playwright against local fixture HTML.

## Goal

Improve maintainability without changing user-visible behaviour:

- Fix known correctness gaps first.
- Stabilize flaky tests.
- Clarify internal boundaries in `editor.js`.
- Preserve no-framework, no-runtime-dependency, bookmarklet-loaded deployment.
- Leave the project in a safer state for future feature work.

## Read First

1. `AGENTS.md` or `CLAUDE.md`.
2. `REQUIREMENTS.md`.
3. `DESIGN.md`.
4. `TESTING.md`.
5. `ROADMAP.md`.
6. `editor.js`.
7. The relevant Playwright specs in `tests/`.

## Non-goals

- Do not add new user-facing features.
- Do not change fixture HTML.
- Do not introduce runtime dependencies.
- Do not introduce a required bundler/build step unless the human explicitly approves a deployment change.
- Do not redesign the inspector, toolbar, or Overview visuals.
- Do not remove existing tests to make the suite green.
- Do not rewrite the editor from scratch.

## Phase R0 - Lock Down Known Failures

Mode: strict.

Add or harden tests before changing implementation.

Required tests:

1. **Selection overlay refresh:** selecting an element whose layout shifts after click should keep the ring aligned after at least two animation frames. This should cover the current timing-sensitive failure in `tests/02-selection.spec.js`.
2. **Flow unlock undo selection validity:** after dragging/unlocking a flow-positioned element and undoing, `state.selected` must not point at a detached node. The inspector should hide or re-bind correctly, and a following keyboard/inspector edit must not mutate an orphan node.
3. **Bookmarklet output isolation:** bookmarklet tests must not race on a shared root `bookmarklet.txt` when Playwright runs with full parallelism.

Acceptance:

- The new tests fail or expose the current weak behaviour before implementation, where practical.
- Existing tests are not weakened without replacing them with a more reliable assertion for the same behaviour.

Suggested commit:

```text
test(refactor): cover history selection and bookmarklet isolation
```

## Phase R1 - Fix History Snapshot Correctness

Mode: strict.

Problem:

Current element snapshots store and restore `innerHTML` for every touched element. Flow unlock touches containers and children. Restoring a parent `innerHTML` can recreate child DOM and leave `state.selected` pointing at a detached node.

Implementation direction:

- Split snapshot intent:
  - Style/marker snapshots for drag, resize, inspector, unlock/freeze.
  - Content snapshots only for inline text-edit transactions.
- Avoid restoring `innerHTML` for parent/container snapshots unless the transaction is explicitly a content edit.
- Add a small invariant helper such as `ensureSelectionIsConnected()` and call it after undo/redo and any operation that may recreate nodes.
- If the selected node is disconnected, clear selection and refresh the inspector/overlays, or re-resolve selection only when there is a stable identity to resolve against.

Acceptance:

- Undo/redo for drag, resize, inspector, reset, text edit, slide reorder, and slide delete still works.
- Flow unlock undo does not mutate detached DOM.
- Inspector visibility matches the real selected element state.

Suggested commit:

```text
fix(history): avoid stale selection after snapshot restore
```

## Phase R2 - Stabilize Selection Overlays

Mode: strict.

Problem:

The selection ring is positioned from one `getBoundingClientRect()` read. Some slide elements continue moving because of animation or late layout settlement, so the ring can drift between click and assertion/user perception.

Implementation direction:

- Refresh overlays on animation frames while an element is selected and edit mode is active.
- Stop the loop when selection clears, text-edit mode hides the ring, edit mode exits, or Overview mode takes over.
- Keep the loop cheap: one selected element, one rect read, no broad DOM scans.
- Preserve explicit refresh calls after drag/resize/inspector changes.

Acceptance:

- Selection ring remains aligned after delayed layout movement.
- No visible flicker.
- No runaway requestAnimationFrame loop after deselection or mode exit.

Suggested commit:

```text
fix(selection): keep overlays aligned during layout changes
```

## Phase R3 - Fix Test Isolation

Mode: strict.

Problem:

`tests/10-bookmarklet.spec.js` reads and writes a shared root `bookmarklet.txt` while Playwright runs tests in parallel.

Implementation options:

- Mark the bookmarklet describe block serial.
- Better: teach `scripts/build-bookmarklet.js` to accept an explicit output path and make each test write to an isolated temp file.

Acceptance:

- Bookmarklet tests pass under default parallelism.
- `npm run build:bookmarklet` still writes `bookmarklet.txt` by default for normal users.

Suggested commit:

```text
test(bookmarklet): isolate generated output in parallel tests
```

## Phase R4 - Clarify Internal Boundaries

Mode: build-first, because this is structural and should preserve behaviour.

Refactor within the existing deployment model first. Physical file splitting is optional and should be proposed separately if it requires a build/deploy change.

Target internal boundaries:

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

Implementation guidance:

- Prefer extracting cohesive helper functions over moving code around cosmetically.
- Keep state mutations explicit.
- Avoid broad rewrites that mix formatting churn with behaviour fixes.
- Add comments only for non-obvious invariants, especially around scale math, history snapshots, and Overview deck mutation.
- Keep public/global surface minimal. `window.__wfpEditorReady` and any existing test/debug hooks must remain compatible unless tests are deliberately updated.

Acceptance:

- No user-visible behaviour changes.
- Existing tests pass.
- A future builder can find selection, history, inspector, Overview, and export logic without scanning the whole file.

Suggested commit:

```text
refactor(editor): clarify editor subsystem boundaries
```

## Phase R5 - Documentation And Final Gate

Mode: strict for tests, build-first for docs.

Tasks:

- Update docs if implementation boundaries or commands changed.
- Update this brief with completion notes if useful.
- Run the full verification set below.
- Invoke the project code-reviewer before declaring complete, if available.

Suggested commit:

```text
docs(refactor): record maintainability cleanup
```

## Verification Commands

Run these before calling the refactor done:

```bash
npm test
npx playwright test tests/02-selection.spec.js:50 --repeat-each=10
npx playwright test tests/04b-flex-freeze.spec.js tests/06-undo.spec.js tests/v2-overview.spec.js
npm run build:bookmarklet
```

If `npx playwright test` needs local server permissions in the current environment, request the approval rather than working around the server.

## Manual Verification

Carry out these checks in a real browser:

1. Open `fixtures/Townhall-1.html` without the editor loaded. Confirm arrows, animations, and scaling work.
2. Inject the editor and press `E`. Confirm edit mode toggles and slide navigation is suppressed while edit mode is on.
3. Select a heading. Confirm the ring, handles, dimension bubble, and inspector align and remain aligned after a short wait.
4. Drag a flow-positioned element. Undo and redo. Confirm nearby content does not jump and the inspector is not bound to a detached element.
5. Use inspector X/Y, W/H, font size, colour, opacity, and reset. Undo/redo each category at least once.
6. Double-click text, edit it, exit with Escape, then undo/redo the content change.
7. Press `O`. In Overview mode, click a thumbnail to navigate, drag to reorder, delete a slide, undo/redo reorder and delete, then exit Overview.
8. Export and open the edited HTML in a fresh tab. Confirm edits, slide order, and deletion persist, and no editor UI or Overview state is visible.
9. Repeat a quick smoke pass on `boilerplate.html`.

## Required New Test Cases

These are required before the refactor should be considered complete:

- Selection ring follows a selected element after delayed layout/animation movement.
- Undo after flow unlock clears or re-resolves selection when snapshots recreate DOM nodes.
- Inspector/keyboard edits after that undo cannot mutate a detached node.
- Bookmarklet generator tests are isolated under Playwright parallelism.

## Completion Criteria

The refactor is complete when:

- The required new tests exist and pass.
- `npm test` passes reliably.
- Targeted repeat tests for selection no longer expose the current flake.
- Manual verification passes on at least `Townhall-1.html` and `boilerplate.html`.
- Docs still match the implementation.
- No private fixtures or generated test artifacts are staged.
