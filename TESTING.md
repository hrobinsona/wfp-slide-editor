# Testing

## Philosophy

Test the editor against real WFP slide decks, not synthetic DOM fragments. The fixtures in `fixtures/` are the ground truth for layout, animation, scale, and export behaviour.

Fixtures are immutable inputs. Tests may export HTML and screenshots into `tests/output/`, but they must never edit files in `fixtures/`.

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
└── v2-10-ink-glass.spec.js        # Ink-glass instrument states (dock/collapse/minimise) + typography section. Runs against dev/harness.html, no private fixtures needed.
```

Use `rg --files tests` for the exact current file list.

## Fixture Strategy

Primary fixtures are tested on every relevant run:

- `Townhall-1.html`.
- `boilerplate.html`.

Rotation fixtures cover additional finished decks:

- `Inspirational-presentation-1.html`.
- `Inspirational-presentation-2.html`.

Some specs pick a random rotation fixture so the suite catches layout assumptions that only hold on one deck. When a randomized test fails, capture the fixture name from Playwright output and reproduce against that fixture directly.

## Running Tests

- `npm test` - all Playwright specs.
- `npx playwright test tests/v2-overview.spec.js` - one spec file.
- `npx playwright test tests/02-selection.spec.js:50 --repeat-each=10` - stress a flaky test.
- `npx playwright test --ui` - interactive debugging.
- `npx playwright test --debug` - step through with Playwright Inspector.

The Playwright config starts the local static server for fixture loading.

## Current Reliability Note

As of the v2.1 review, the suite has broad coverage but is not fully clean:

- One full `npm test` run reported 252 passed and 2 failed out of 254.
- The failing tests passed when rerun directly.
- Repeating the targeted selection/flex checks showed the selection-ring assertion is timing-sensitive.

Treat this as an active quality issue, not as acceptable noise. The follow-up work is tracked in `REFACTOR-MAINTAINABILITY.md`.

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
