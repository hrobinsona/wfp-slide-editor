# v2 Brief — Overview Mode (grid view, reorder, delete)

## Context

`feat/v2-inspector` ships v2.0.0 (inspector panel + liquid-glass refresh). This brief covers the next minor release on top of it: **Overview mode**, the bird's-eye grid view of all slides with drag-to-reorder and delete. Tagged `v2.1.0` at completion.

Overview is the **lead v2 feature** per `ROADMAP.md`. The roadmap entry is the source of truth for scope. This brief layers execution structure (decisions, phasing, TDD posture, kickoff prompt) on top of it — it does not re-derive scope.

**Read these before starting, in order:**

1. `ROADMAP.md` → `## v2 candidates` → `### v2 LEAD FEATURE: Overview mode`. **This is the canonical scope. Read it cold.**
2. This brief end-to-end.
3. `CLAUDE.md`, `REQUIREMENTS.md`, `DESIGN.md`, `TESTING.md`, `BRIEF-v2-inspector.md`, the post-merge `editor.js`.

**Visual reference:** none. No mockup exists for Overview mode. The visual language reuses the **Liquid Glass dialect** established in `BRIEF-v2-inspector.md` (toolbar variants, backdrop-filter values, border, inner highlight, shadow). When in doubt about styling, mirror inspector — don't invent a new aesthetic. If a mockup is added later, drop it at `references/v2-overview-design.png` (the folder is gitignored — same rule as the inspector reference).

## Build environment

- Worktree branched off `main` **after `feat/v2-inspector` has been merged**, on a new branch `feat/v2-overview`. The Overview feature adds a button to the v2-inspector rebuilt toolbar — branching pre-merge would require re-fitting the button later. Do not branch in true parallel.
- All v1 conventions still apply: vanilla JS, no build step, no framework, single `editor.js` (or split per the roadmap's implementation sketch if `editor.js` is already over ~1500 lines after v2-inspector — builder's call), all editor DOM under `#wfp-editor-root`, all internal markers under `data-wfp-edit-*`.
- Tests are Playwright. New tests in `tests/v2-overview.spec.js`. Don't modify existing v1 or v2-inspector tests; they must all pass at every phase boundary.
- Each phase ends with a `code-reviewer` subagent invocation, then one Conventional Commit on `feat/v2-overview`. Pushes are manual and human-controlled.
- No new npm dependencies. No new runtime dependencies. **No Sortable.js** — drag-to-reorder is hand-rolled.

## Decisions baked in

These were open questions in the roadmap; they're now answered. Build accordingly — no further confirmation needed.

1. **Reorder animation:** snap. No animated transitions for v2.1.0. (Animation is a v2.2 candidate.)
2. **Active-slide highlight:** Liquid Glass dialect consistent with the v2-inspector toolbar — same backdrop-filter, border, inner highlight, shadow values. Builder picks the specific treatment (border-only, ring, glow, or combination) within that dialect during the build-first grid phase. Whatever reads as "selected" against the grid.
3. **Many-slide behaviour (>20 slides):** the grid scrolls. Thumbnail size stays constant at 4-per-row, ~0.22 scale.
4. **Drag library:** hand-roll using HTML5 native drag-and-drop (`draggable="true"`, `dragstart` / `dragover` / `drop`). No Sortable.js or other library.
5. **Toolbar button:** add an "Overview" icon button to the v2-inspector rebuilt toolbar in the same icon-toolbar style as Edit / Export / Undo / Redo. Activation = hotkey `O` **OR** toolbar click; both must work and route to the same toggle.
6. **Branch base:** `feat/v2-overview` branches off `main` after `feat/v2-inspector` merges, to inherit the rebuilt toolbar.
7. **Delete in scope** — explicit roadmap deviation. The originally-pasted roadmap entry listed "Delete slides from overview" under non-goals. Harry has since promoted delete into scope. `ROADMAP.md` has been updated as part of this work to move delete out of the Overview non-goals list and into the scoped feature set. UX is specified below.

## What to build

The roadmap entry covers most of this. Treat the bullets below as deltas and clarifications, not a full restatement.

### Activation, layout, click-to-navigate, drag-to-reorder, history, export

Spec'd in `ROADMAP.md` → `### v2 LEAD FEATURE: Overview mode`. Build to that spec. Two clarifications:

- **DOM strategy on activation:** the roadmap says "create grid container with thumbnails referencing the slides". Builder's choice between (a) temporarily relocating the actual `.slide` elements into a new grid container and restoring on exit, or (b) leaving slides in place and applying CSS-override-via-flag-class to render them as a grid. Either is acceptable. Whichever is chosen must (a) preserve all live styles and animations on slides, (b) leave no trace in the DOM after exit (no leftover wrappers, classes, or inline styles), and (c) survive an export round-trip cleanly.
- **Active-slide highlight specifically:** must use the Liquid Glass values from `BRIEF-v2-inspector.md` — same `rgba` and `blur` numbers. Don't introduce a new colour token.

### Delete (explicit roadmap deviation — new in this scope)

UX:

- **Hover affordance.** Each thumbnail reveals a small `×` button in its top-right corner on hover. Liquid Glass styled (small circular pill in the same dialect as the toolbar). Hidden by default; visible on `:hover` of the thumbnail or on keyboard focus.
- **Click `×`** deletes the slide.
- **Backspace or Delete key** while a thumbnail is hovered (or focused) also deletes that slide. The hovered thumbnail is the operative target — there's no "selected slide" concept in overview beyond the active highlight, which is unrelated to the delete target.
- **Last-slide guard:** if the deck has exactly one slide, delete is a no-op. Show a one-line toast: `Can't delete the last slide.` (Reuse the existing `showToast` helper from v1.)
- **Active-slide deletion:** if the deleted slide was the current active slide, fall back to the slide that now occupies the deleted position; if the deleted slide was the last in the deck, fall back to the new last slide.
- **History:** one delete = one history entry. Cmd+Z restores the slide at its original position; Cmd+Shift+Z re-deletes. Use the existing v1 history stack — don't add a parallel stack for slide-level operations.

Implementation note: the existing v1 history stack snapshots inline `style` and `innerHTML` per element (see `snapshotElement` in `editor.js`). Slide-level delete is a different shape — the slide element is removed entirely. The history entry shape needs extending: alongside the existing per-element snapshots, support a slide-level operation type that captures (a) the removed slide's `outerHTML`, (b) its position index in the parent, and (c) on undo, re-inserts at that index. Reorder uses the same primitive — capture before/after `.slide` order, restore on undo. Add the new operation type as a clean extension to the existing system; **do not refactor or replace the existing per-element snapshot mechanism.**

## What NOT to build (explicit non-goals)

The roadmap's non-goals list applies (with Delete now removed from it per the deviation above). Plus the global non-goals carried forward from the inspector brief:

- ❌ **Multi-select** for moving multiple slides at once.
- ❌ **Add new slides** from overview.
- ❌ **Duplicate slides** from overview.
- ❌ **Animated reorder transitions.** Snap only for v2.1.0.
- ❌ **Keyboard navigation between thumbnails** (arrow keys to move highlight). Click and drag only.
- ❌ **Different grid densities.** Fixed at 4-per-row; do not add 3-across / 5-across variants or a density toggle.
- ❌ **Search / filter slides by content.**
- ❌ **Sortable.js or any other drag library.** Hand-rolled HTML5 native DnD.
- ❌ **New npm or runtime dependencies.** Inline SVG for the `×` icon and the toolbar Overview icon, same as v2-inspector.
- ❌ **Build step, bundler, or framework.** Editor stays single-file (or split per the roadmap's implementation sketch threshold).
- ❌ **Persisting overview mode itself on export.** The exported HTML opens in normal slide view. Overview is a build-time-only surface.
- ❌ **Refactoring or replacing the v1 history stack.** Extend it for slide-level operations; don't rewrite the per-element snapshot mechanism.
- ❌ **Refactoring or replacing v2-inspector primitives.** The toolbar gets one new button. Inspector behavior is unchanged. Click on a thumbnail in overview is not a "selection" in the inspector sense — it does not open the inspector or set `state.selected`.
- ❌ **Breaking any v1 "Done criteria" assertion in `REQUIREMENTS.md`** or any v2-inspector test.
- ❌ **Changes to how fixture HTML renders without the editor loaded.** Verify at every phase.
- ❌ **Widening the editor's DOM footprint into the slide.** New markers under `data-wfp-edit-*`. New CSS scoped to `#wfp-editor-root`.
- ❌ **Allow-listing anything in `references/` to git** without explicit human approval.

## Suggested phasing

Each phase ends with `code-reviewer` approval and one Conventional Commit on `feat/v2-overview`. TDD mode follows v1 / v2-inspector conventions: **strict** for unambiguous behavior, **build-first** for visual judgement calls.

| Phase | Mode | Scope |
|---|---|---|
| v2.1.0 — Activation + toolbar button | strict (logic) + build-first (button) | Hotkey `O` toggles overview. Escape exits. New `Overview` icon button in the rebuilt toolbar. Mode flag in `state`. Mutual exclusion with element selection (entering overview clears `state.selected`; does not change `state.editMode`). |
| v2.1.1 — Grid layout | build-first | Scaled-thumbnail grid (4 per row, `transform: scale(0.22)`, scroll past 20). Slide-number badges. Active-slide highlight in Liquid Glass dialect. DOM strategy chosen (relocate vs. CSS-override) and locked. |
| v2.1.2 — Click to navigate | strict | Click a thumbnail → set that slide as `.slide.active` and exit overview. |
| v2.1.3 — Drag to reorder | strict | HTML5 native DnD. Snap repositioning of other thumbnails during drag. On drop, reorder `.slide` elements in DOM. Active slide pointer follows the moved slide. One drag = one history entry, undoable via the existing v1 stack (extended for slide-level ops). |
| v2.1.4 — Delete slide | strict (logic) + build-first (`×` button UX) | Hover-revealed `×` button in Liquid Glass. Backspace/Delete key while hovering/focused. Last-slide guard with toast. Active-slide fallback rule. One delete = one history entry, undoable. |
| v2.1.5 — Export round-trip | strict | Reorders + deletes persist in exported HTML. Overview UI stripped on export (no grid container, no `data-wfp-edit-*` overview markers, no overview CSS classes left on slides). v1 export contract still honored. |
| v2.1.6 — End-to-end pass *(checkpoint)* | build-first | Run on both fixtures (`Townhall-1.html` and `Inspirational-presentation-2.html`). All v1 done criteria still pass. All v2.0 inspector tests still pass. v2.1 spec passes. Stop, summarise per `CLAUDE.md` checkpoint protocol, wait for human `proceed` before tagging `v2.1.0` and updating `ROADMAP.md` to mark Overview as delivered. |

After v2.1.6 ships and the human confirms end-to-end on a real slide, tag `v2.1.0` and remove the "v2 LEAD FEATURE: Overview mode" entry from the active candidates section of `ROADMAP.md` (move it under a new "Delivered" section or just delete it — builder's call, mirror however v2.0.0 was handled in `ROADMAP.md`).

## Pre-flight (already complete)

- ✅ v2-inspector is the dependency. This brief assumes `feat/v2-inspector` has been merged to `main` before `feat/v2-overview` opens.
- ✅ ROADMAP.md updated — Overview entry inserted, delete moved out of non-goals into Core interactions.
- ✅ All seven decisions baked in (see "Decisions baked in" above).

The only outstanding pre-condition is the `feat/v2-inspector` merge. Do not start this worktree until that ships.

---

## Kickoff prompt for the builder

Paste the block below into the worktree builder session. Self-contained — no further context needed.

> **Task:** Execute v2 Overview mode (grid view, drag-to-reorder, delete) for the WFP Slide Editor.
>
> **Branch:** create a worktree off `main` on a new branch `feat/v2-overview`. **Pre-condition: `feat/v2-inspector` must already be merged to `main`.** If it isn't, stop and tell the human.
>
> **Read first, in order:**
> 1. `ROADMAP.md` → `## v2 candidates` → `### v2 LEAD FEATURE: Overview mode`. This is the canonical scope. Read it cold.
> 2. `BRIEF-v2-overview.md` end-to-end. This is the execution spec.
> 3. `CLAUDE.md`, `REQUIREMENTS.md`, `DESIGN.md`, `TESTING.md`, `BRIEF-v2-inspector.md`, the current `editor.js`.
>
> **All open questions are already answered. Do not pause to ask.** Decisions baked in: snap (no animation); Liquid Glass active-slide highlight in the v2-inspector dialect; grid scrolls past 20 slides at 4-per-row; hand-rolled HTML5 native drag-and-drop (no Sortable.js); toolbar Overview button + hotkey `O`; branch base is post-merge `main`; delete is in scope (explicit roadmap deviation — `ROADMAP.md` already updated).
>
> **Delete UX:** hover-revealed `×` button in Liquid Glass styling, top-right of each thumbnail; Backspace/Delete key while hovering or focused also deletes; one delete = one history entry; last-slide guard with toast `Can't delete the last slide.`; active-slide fallback rule per the brief.
>
> **`references/` is gitignored.** Do not allow-list anything inside it.
>
> **Execute the suggested phasing v2.1.0 → v2.1.6 in order.** For each phase:
> - Follow its TDD mode (`strict` = failing test first; `build-first` = implement + visual verify, then tests before phase close).
> - Run the existing v1 + v2.0 (inspector) Playwright suites at every phase boundary; all prior tests must still pass.
> - At the end of the phase, invoke the `code-reviewer` subagent. Do not move on until it returns APPROVE.
> - Make one Conventional Commit per phase. Suggested format: `feat(v2.1.N): <summary>`. Do not push.
> - For the checkpoint phase (v2.1.6), STOP and produce a checkpoint summary per `CLAUDE.md`. Wait for human `proceed` before tagging `v2.1.0`.
>
> **Hard non-goals — do not build any of these even if they seem natural:** multi-select; add new slides; duplicate slides; animated reorder transitions; keyboard navigation between thumbnails; grid-density variants; search/filter; Sortable.js or any other drag library; new npm or runtime dependencies; build step / bundler / framework; persisting overview mode on export; refactoring the v1 history stack (extend, don't rewrite); refactoring v2-inspector primitives; breaking any v1 or v2.0 test; changing how fixtures render without the editor loaded; widening editor DOM footprint into the slide; allow-listing anything in `references/` to git.
>
> **At the v2.1.6 checkpoint, after `code-reviewer` approves:** stop, summarise, wait for human approval, then on `proceed` reply tag `v2.1.0` and update `ROADMAP.md` to remove the Overview entry from active v2 candidates (mirror however the v2.0.0 inspector entry was retired).
