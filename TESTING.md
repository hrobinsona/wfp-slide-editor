# Testing

## Philosophy

Test the editor against real slide decks, not synthetic DOM fragments. The fixtures in `fixtures/` are the ground truth for layout, animation, scale, and export behaviour.

Fixtures are immutable inputs. Tests may export HTML and screenshots into `tests/output/`, but they must never edit files in `fixtures/`.

**Specs must not name deck-specific markup.** A deck's element tags, class names, slide ids, positioning strategy and keyboard map are all authoring choices that change between deck generations. Anything a spec needs from the deck is *discovered* from the fixture that is loaded. See "Deck-agnostic targets" below.

## Current Coverage

The suite now covers the v1 editor, v2 inspector, v2.1 Overview mode, v2.2 copy/paste and blank slide insertion, v2.3 multi-select move, and v2.5 agent handoff annotations.

```text
tests/
├── _helpers.js                    # Fixture loading, editor injection, helpers.
├── 01-bootstrap.spec.js           # Editor load and edit-mode toggle.
├── 02-selection.spec.js           # Selection ring and selectable targets.
├── 03-font-size.spec.js           # Keyboard font-size nudges.
├── 04-drag.spec.js                # Drag movement and scale-aware deltas.
├── 04b-flex-freeze.spec.js        # Flow unlock / flex sibling stability.
├── 05-resize.spec.js              # Resize handles.
├── 06-undo.spec.js                # Element history.
├── 07-text-edit.spec.js           # Inline text edit.
├── 08-export.spec.js              # Clean export.
├── 09-end-to-end.spec.js          # v1 workflow coverage.
├── 10-bookmarklet.spec.js         # Bookmarklet generator and injection.
├── v2-0-toolbar.spec.js           # Inspector-era toolbar behaviour.
├── v2-0-inspector-*.spec.js       # Inspector controls and edge cases.
├── v2-1-6-end-to-end.spec.js      # v2.1 end-to-end coverage.
├── v2-overview.spec.js            # Overview grid, reorder, delete, export.
├── v2-multi-select.spec.js        # Cmd/Ctrl-click multi-select and group movement.
├── v2-agent-annotations.spec.js   # Agent note authoring, visible circular markers, and handoff export.
├── v2-21-notes-panel.spec.js      # Agent-notes panel: cross-slide card list, jump, N/Shift+N flicking. Public fixtures only.
└── v2-10-ink-glass.spec.js        # Ink-glass instrument states (dock/collapse/minimise) + typography section. Runs against dev/harness.html, no private fixtures needed.
```

Use `rg --files tests` for the exact current file list.

## Fixture Strategy

Primary fixtures, declared as `PINNED_PRIMARIES` in `tests/_helpers.js`, are tested on every relevant run:

- `Townhall-1.html` — the current 9-slide finished Avent town hall (copied from the slides skill's `output/slides/d4-ai-town-hall.html`).
- `boilerplate.html` — the current generated Avent scaffold (copied from `assets/boilerplate.html`).

Both filenames are **role names** ("finished multi-slide deck", "scaffold"), deliberately kept stable across deck refreshes so `PINNED_PRIMARIES` and the spec call sites that name them don't churn. `fixtures/README.md` records which deck each one currently is and where it came from — update that table when you refresh them.

Rotation fixtures are every other `.html` in `fixtures/` containing a `.deck`. Currently `d2-intelligence-layer.html` and `pplus-commercial-model.html`.

The three end-to-end specs (`09-end-to-end`, `v2-8-end-to-end`, `v2-1-6-end-to-end`) each add one rotation fixture, so the suite catches layout assumptions that only hold on one deck. The pick is **seeded and stable for the day**, not per-invocation:

- Every Playwright worker re-imports the spec file. A `Math.random()` pick gave each worker a different fixture, the `describe` titles disagreed, and the run failed with `Test not found in the worker process`.
- Day-stable also means a failure is reproducible. Pin it with `WFP_ROTATION_FIXTURE=<name>` (exact filename) or `WFP_ROTATION_SEED=<number>`.

Each of those specs logs the fixture list it is running.

### Missing fixtures

Deck HTML is gitignored. A fresh clone, and every checkout under `.worktrees/`, has none.

That must never abort collection: "nothing ran" is indistinguishable from "everything passed", which is the worst possible failure mode for a gate. Instead:

- `loadFixtureWithEditor` calls `skipIfFixtureMissing`, so any test needing an absent fixture is reported as **skipped** with a reason naming the fixture and pointing at `fixtures/README.md`.
- `pickRandomRotationFixture()` returns `null` instead of throwing; the three end-to-end specs register an explicitly skipped placeholder test in place of the rotation pass.
- Specs that load a fixture directly (`10-bookmarklet`, one `v2-overview` no-editor baseline) call `skipIfFixtureMissing` by hand.

A checkout with no private decks should report roughly `274 skipped, 221 passed` and exit 0. If you ever see zero results, something has regressed the guard.

### Deck-agnostic targets

`tests/_helpers.js` discovers what a spec needs from the loaded fixture:

| Helper | Use it for |
|---|---|
| `requireAbsoluteTarget(page)` | An absolutely-positioned, clickable element. Prefers a natively absolute one; otherwise pins a discovered flow element to absolute the same way the editor's own `unlockToAbsolute` does. Replaces the retired `.slide.active .wfp-badge`. |
| `requireTextTarget(page)` / `requireStableTarget(page)` | A text-bearing / any clickable element with a slide-unique class. |
| `hitPointFor(page, selector)` | A viewport point that hit-tests to the element **itself**. The editor's `findSelectableTarget` returns `event.target` verbatim, and the current decks nest an accent `<span>` dead centre in every headline — so clicking a heading's geometric centre selects the span. |
| `waitForSlideSettled(page)` | Waits out the active slide's entrance transitions/animations. A running animation beats inline styles, so asserting geometry, opacity or colour mid-entrance silently reads the animation's value instead of what the editor wrote. Already called by `loadFixtureWithEditor`. |
| `stampSlideIds(page)` | Gives top-level slides `s0..sN` when the deck authors no ids, so overview reorder/delete/undo/export assertions can name slides. Already called by `loadFixtureWithEditor`; never overwrites authored ids. |
| `parseSlideTags(html)` | Parses slide elements out of exported HTML without assuming the element tag or that ids exist. |
| `EDITOR_MARKER_ATTR_RE` | "No editor markers survived export", scoped to attribute position. A bare `data-wfp-edit` substring check fails on any deck that co-operates with the editor — the Avent template's own stylesheet names `body[data-wfp-edit-overview="on"]` and declares `--wfpe-overview-slide-display`. |

When a deck genuinely has nothing of the required shape, these skip with a reason rather than failing or passing vacuously. If you find yourself adding a deck-specific constant to a spec, that is the signal to reach for one of these instead.

## Running Tests

- `npm test` - all Playwright specs.
- `npx playwright test tests/v2-overview.spec.js` - one spec file.
- `npx playwright test tests/02-selection.spec.js:50 --repeat-each=10` - stress a flaky test.
- `npx playwright test --ui` - interactive debugging.
- `npx playwright test --debug` - step through with Playwright Inspector.

The Playwright config starts the local static server for fixture loading.

## Current Reliability Note

After the fixture refresh, a full `npm test` with the private decks installed reports **511 passed, 2 skipped, 1 failed out of 514**, and without them **221 passed, 274 skipped, 0 failed**.

The one failure is not the same test twice — it is whichever download-driven assertion loses a race under six parallel workers. Both known offenders pass `--repeat-each=6` in isolation and neither is fixture-related:

- `v2-14-handoff-ground-truth.spec.js` → "ledger hygiene…" times out on `page.waitForEvent('download', { timeout: 5_000 })` after clicking the export menu's clean-copy row. Runs against the committed `foreign-deck.html`.
- `08-export.spec.js` → "export does not serialize runtime-generated progress dots" times out on its final `expect.poll` against the reloaded `file://` page, before that page's own script has rebuilt its dots.

Both are 5s budgets competing with other workers. Treat them as the next reliability items: the download-event waits and the reload polls want generous, load-tolerant timeouts, not tighter tests.

The two skips with fixtures present are `v2-1-6-end-to-end`'s reorder/delete cases on `boilerplate.html`, which has only 2 slides — the spec skips them by design.

Treat flakes as an active quality issue, not as acceptable noise. The follow-up work is tracked in `REFACTOR-MAINTAINABILITY.md`.

### A note on why the suite drifted

Before this pass the two pinned primaries were absent from the checkout, and `pickRandomRotationFixture()` threw at collection time. Three specs aborted collection and every spec that named a primary errored out — so in practice most of the suite had not run for a while, and several assertions had gone stale against the editor as it moved on (icon-only toolbar, ink-glass surfaces, `visibility`-based inspector hiding, save-in-place preferring the File System Access API over a download). Those were fixed as part of this pass. The missing-fixture guard exists so that cannot happen silently again.

## Required Test Additions For Refactor Work

Before maintainability refactors land, add or harden tests for:

- Selection overlay refresh while selected targets move because of animation or late layout changes.
- Undo/redo after flow unlock when parent/container snapshots are involved, ensuring selection is cleared or re-resolved if a selected node is recreated.
- Bookmarklet generator isolation, because tests currently share `bookmarklet.txt`.

These are correctness tests, not just cleanup tests.

## Manual Verification

Before declaring a feature or refactor done:

1. Open a fixture without the editor loaded and confirm arrows, animations, and scaling still work.
2. Inject the editor through the bookmarklet or local script.
3. Toggle edit mode with `E`; confirm arrows still change slides with nothing selected, and stop changing slides once an element is selected or a text edit is open.
4. Select, drag, resize, and undo an element on a scaled deck.
5. Cmd/Ctrl-click multiple elements, drag the group on a scaled deck, and undo/redo the group move.
6. Use inspector controls for position, size, font size, colour, opacity, and reset.
7. Double-click text, edit it, exit with Escape, and undo/redo.
8. Toggle Overview with `O`, navigate by clicking a thumbnail, reorder slides, delete a slide, and undo/redo both operations.
9. Export, open the exported HTML in a fresh tab, and confirm edits persist with no editor UI visible.
10. Add an Agent note, confirm the Saved state and peach circular marker appear, export handoff HTML, re-open it with the editor, and confirm the annotation reloads.

## Output Artifacts

- `tests/output/*.html` - exported HTML for inspection.
- `tests/output/screenshots/` - screenshots from failed assertions.
- `playwright-report/` - Playwright HTML report.
- `test-results/` - Playwright traces and attachments.

These are gitignored and should not be committed.

## When Tests Fail

1. Check the Playwright report with `npx playwright show-report`.
2. Re-run the smallest failing file or test title.
3. If the failure is randomized, identify the fixture selected by the run.
4. Reproduce against that fixture until fixed.
5. Do not disable a failing test without replacing it with a more reliable assertion for the same behaviour.
