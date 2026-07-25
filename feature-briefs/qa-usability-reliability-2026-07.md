# QA Usability and Reliability Fixes — July 2026

## Status

Active. Source: `slide-editor-usability-issues.xlsx`, based on the sanitized
`foreign-deck.html` QA session from 24 July 2026.

## Goal

Resolve the five confirmed/observed QA findings without changing fixture
rendering before the editor loads, widening the production dependency surface,
or weakening export cleanup.

The work is intentionally split into three branches/worktrees. The two P1
correctness fixes have independent logic and regression surfaces. The three
visual findings share the editor chrome and `20-dom-css.js`, so they travel
together to avoid conflicting design changes and receive one coherent browser
review.

## Workflow A — Foreign-deck navigation state (ISS-001)

- **Priority / mode:** P1, strict TDD.
- **Problem:** after an Overview mutation or live refresh, the editor takes
  over navigation using the live slide list but only synchronizes
  `.progress-dot`. Foreign counters such as `.slide-count` remain stale.
- **Required behaviour:**
  - Every editor-owned slide activation synchronizes the visible current index
    and total for supported host counter patterns.
  - Overview insert/delete/reorder and live-refresh restoration use the same
    synchronization helper as arrow navigation.
  - Contract-deck progress dots retain their existing behaviour.
  - No mutation occurs before the editor owns navigation or on fixtures without
    a recognized counter.
  - Counter support must be capability/pattern based; do not special-case
    `foreignFixtureShow` or rewrite host scripts.
- **Coverage:** add a regression against `fixtures/foreign-deck.html` for insert
  → exit Overview → ArrowRight (`2 / 5`), plus a live-refresh restore assertion
  if the existing harness makes that path practical.

## Workflow B — Reset a flow-unlock group (ISS-002)

- **Priority / mode:** P1, strict TDD.
- **Problem:** Reset restores only the selected flow item. Mechanically pinned
  siblings and containers remain absolute/frozen.
- **Required behaviour:**
  - Resetting an element that participated in a flow unlock restores the
    unlock group to its pre-unlock layout and removes obsolete freeze markers.
  - The reset is one atomic history entry; undo returns the full group to the
    pre-reset edited/frozen state and redo restores the group again.
  - A mechanically pinned member is eligible for group restoration only while
    its inline style still matches the pin recorded by the editor. A member
    deliberately edited after the pin must not have that later user change
    silently discarded.
  - Reset on ordinary absolute/stylesheet-positioned elements preserves the
    existing pre-edit-original contract and remains a no-op when never edited.
  - Selection and inspector remain bound to a connected element after
    reset/undo/redo.
- **Coverage:** extend `tests/v2-5-reset-styles.spec.js` (and the flex-freeze
  spec if useful) with the Plan/Review/Publish-style group repro, marker/style
  assertions, later-sibling-edit policy, and atomic undo/redo.

## Workflow C — Editor chrome usability (ISS-003, ISS-004, ISS-005)

- **Priority / mode:** P2/P3, build-first with Playwright coverage before
  completion.
- **ISS-003, inspector overlap at rest:**
  - Selecting top-right content must not leave its edge hidden beneath an
    opaque inspector before a gesture begins.
  - Prefer an automatic placement/avoidance rule that keeps controls usable.
    If neither viewport side can avoid the selection, use a visibly
    non-obstructive fallback without fading the toolbar.
  - Placement must update when selection geometry, inspector height, viewport,
    Overview state, or minimised state changes and must not oscillate.
  - The existing during-gesture adaptive fade/value-tag behaviour remains
    intact.
- **ISS-004, agent-note authoring area:**
  - A realistic ~136-character instruction must be proofread without an
    immediately cramped viewport.
  - Use bounded auto-growth or a comparably compact larger review surface;
    preserve Escape, save/delete, saved/draft state, and agent-reply behaviour.
  - Keep the inspector usable at 1280×720 and at the existing narrow test
    viewport.
- **ISS-005, Overview affordances:**
  - Every thumbnail shows a persistent, concise drag cue/handle.
  - Delete remains clearly discoverable without hover while preserving hover,
    focus, keyboard delete, last-slide guard, and thumbnail navigation.
  - Cues are editor-owned DOM only and do not leak into exports.
- **Coverage and visual pass:** add attribute/layout tests using sanitized
  fixtures or `dev/harness.html`; verify at 1280×720 against
  `fixtures/foreign-deck.html`; re-run adaptive-inspector, annotation, and
  Overview suites.

## Shared constraints

- Edit source fragments under `src/editor/`; regenerate `editor.js` with
  `npm run build:editor`.
- Production runtime remains dependency-free and self-contained.
- All injected UI remains under `#wfp-editor-root`; user markers remain in the
  `data-wfp-edit-*` namespace.
- Fixtures are immutable. Test artifacts stay under gitignored output paths.
- Update `REQUIREMENTS.md`, `DESIGN.md`, and `FEATURES-AND-BUGS.md` to reflect
  final behaviour and move shipped findings to Resolved.
- Each workflow ends with relevant Playwright tests, `npm run check:editor`,
  project-specific subagent review, and a Conventional Commit. Do not push.

## Integration gate

Merge a workflow branch into `main` only when:

1. its focused tests pass;
2. generated `editor.js` matches source fragments;
3. review has no unresolved actionable finding;
4. the branch contains no private fixtures, screenshots, generated test
   output, or unrelated files.

After all approved merges, run the full Playwright suite and
`npm run build:bookmarklet -- --local` on the integrated `main`.
