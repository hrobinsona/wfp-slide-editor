# v2 Brief — Inspector Panel + Liquid-Glass Refresh

> Status: Delivered. This is a historical execution brief, not the active backlog. The current product contract is `REQUIREMENTS.md`; active maintainability work is in `REFACTOR-MAINTAINABILITY.md`.

## Context

v1 of the WFP Slide Editor is shipped (phases 0–9 complete; phase 10 bookmarklet is the only v1 work outstanding). All current behavior — selection, drag, resize, font-size keyboard nudge, inline text edit, undo/redo, export — works and is locked behind Playwright tests.

This brief covers v2: an inspector panel that exposes the same operations through a UI surface, plus a liquid-glass visual refresh of the toolbar. Treat it as a single coherent v2 release.

**Read these before starting:** `CLAUDE.md`, `REQUIREMENTS.md`, `DESIGN.md`, `ROADMAP.md`, `TESTING.md`, `editor.js`.

**Visual reference:** the user-supplied mockup at `references/v2-inspector-design.png`. Authoritative for layout, colour, spacing, and typography only. **Treat the placeholder presentation content in the mockup ("Lead the next chapter", the ocean photo, "Bold ideas. Human impact." subhead, "Our purpose" CTA, etc.) as random example fill — do NOT copy, reference, or reproduce any of that copy, layout, or content inside `editor.js`, tests, comments, or commits.** The image is a UI spec, not a content spec.

## Build environment

- Worktree branched off `main`. Suggested branch: `feat/v2-inspector`.
- All v1 conventions still apply: vanilla JS, no build step, no framework, single `editor.js`, all editor DOM under `#wfp-editor-root`, all internal markers under the `data-wfp-edit-*` namespace.
- Tests are Playwright. New tests go in `tests/v2-*.spec.js`. Don't modify existing v1 tests; they must all still pass at every phase boundary.
- Each phase ends with a `code-reviewer` subagent invocation, then one Conventional Commit. Pushes are manual and human-controlled.
- No new npm dependencies. No new runtime dependencies. No icon library.
- `references/` is gitignored. Don't allow-list anything inside it without explicit human approval.

## Decisions baked in

These were open questions; they're now answered. Build accordingly — no further confirmation needed.

1. **Colour picker:** native `<input type="color">` styled behind a swatch + hex input. No custom HSL widget.
2. **Reset styles:** clears *all* inline styles on the selected element (matches Figma-style "reset overrides" semantics). One history entry; element returns to its stylesheet-defined rendering.
3. **Liquid-glass theming:** two fixed variants — light glass and dark glass — that match the reference image exactly. **Variant selection is driven by `prefers-color-scheme` only** (consistent with v1's existing dark-mode handling in `editor.js`). The editor does NOT sample slide backgrounds. Per-slide adaptive theming is deferred to v2.1.
4. **Inspector visibility during inline text edit:** the inspector stays visible while a text edit is in progress, so the user can adjust font size, colour, etc. while typing. Clicks inside the inspector must NOT end the text edit (current v1 logic in `onMouseDown` ends text edit on any outside click — this needs an explicit "inspector is not outside" exception).
5. **Inspector minimise/expand:** the inspector has a minimise control that collapses it back into / under the main toolbar so the user can see the full slide unobstructed. The minimised state is **remembered across selections within the editor session** (in-memory; not localStorage — page-reload persistence is part of the broader v2 ROADMAP "persistence" item, not this scope).

## What to build

### 1. Toolbar refresh (visual + structure)

Match the **liquid-glass recipe** in the bottom strip of the mockup precisely. Two fixed variants — selected by `prefers-color-scheme`:

**Light glass variant** (active when `prefers-color-scheme: light`, i.e. for typical light slide backgrounds):
- Backdrop filter `blur(24px) saturate(180%)` (range 20–28px; 24px is the default).
- Background `rgba(255, 255, 255, 0.20)`.
- Border `1px solid rgba(255, 255, 255, 0.24)`.
- Inner highlight `linear-gradient(to bottom, rgba(255,255,255,0.35), rgba(255,255,255,0) 40%)` overlaid via a `::before` or inset box-shadow.
- Outer shadow `0 8px 24px rgba(0, 0, 0, 0.25)`.
- Text / icon colour `rgba(15, 23, 42, 0.85)`.

**Dark glass variant** (active when `prefers-color-scheme: dark`, i.e. for dark slide backgrounds):
- Same blur + saturate.
- Background `rgba(255, 255, 255, 0.12)`.
- Same border, inner highlight, outer shadow.
- Text / icon colour `rgba(255, 255, 255, 0.9)`.

Use `@media (prefers-color-scheme: dark)` exactly as v1 already does for the toolbar — don't introduce a new variant-selection mechanism.

Replace the four current text-only toolbar buttons with icon + label buttons in this order: **Edit · Export · Undo · Redo**. (No Overview, no Help — see non-goals.)

- Icons: inline SVG, single-stroke, ~18px, lucide-aesthetic. Embedded directly in `editor.js` as template strings. No external icon library, no font.
- Three button states must be implemented and visually distinct, matching the mockup:
  - **Default** — glassy, subtle.
  - **Hover** — gentle highlight (deeper background opacity, no jump).
  - **Active** — only Edit shows the coral gradient pill when edit mode is on. The current v1 implementation already does this; carry it forward.

### 2. Inspector panel

Appears whenever an element is selected. Hides when selection clears or when the slide changes. Same liquid-glass styling as the toolbar (light + dark variants).

- **Position:** fixed in the top-right of the viewport, beneath the toolbar with consistent gutter. Does NOT track the selection (would cover slide content). Final positioning is build-first — eyeball it against the mockup.

- **Structure:** a single panel. **No tabs.** The Text / Layout / Style tabs in the original mockup are dropped for this scope.

- **Minimise / expand:**
  - The inspector has a minimise control (small icon button in the inspector's header, top-right corner).
  - When minimised: the inspector collapses out of view, restoring the full slide canvas. Selection ring + corner dots + dimension bubble remain visible; only the inspector controls panel disappears.
  - When minimised, a small "expand" affordance must remain reachable — either a control on the toolbar, or a slim re-open chevron. (Build-first; eyeball it.)
  - The minimised/expanded preference persists across selections within the editor session (one in-memory boolean in `state`). Reload / re-injection resets to expanded.
  - Expanded is the default for the first selection of a session.

- **Conditional content** by selection type:

  **Text-bearing element selected** (uses the existing `isTextBearing()` predicate):
  - Font size — px input + horizontal slider + `−` / `+` buttons; all three bound to the same value.
  - Text colour — hex input + swatch + native `<input type="color">` behind a styled trigger.
  - Background colour — same pattern, with an explicit "transparent" affordance.
  - Position — X / Y px inputs.
  - Size — W / H px inputs.
  - Reset styles — clears the entire inline `style` attribute on the selected element. One history entry.

  **Non-text element selected:**
  - Background colour.
  - Position — X / Y.
  - Size — W / H.
  - Reset styles.

- **Two-way binding rules:**
  - Dragging an element updates X / Y readouts live.
  - Resizing updates W / H live.
  - Typing in any input updates the element on commit (Enter or blur), not per-keystroke.
  - Slider drag and ± clicks update live.
  - Each completed user-driven edit is exactly **one** undo entry: one input commit = one entry, one slider drag from grab to release = one entry, one ± click = one entry.

- **Behavior during inline text edit:**
  - The inspector stays visible (expanded or minimised, whichever the user has set).
  - Clicks inside the inspector panel must NOT end the text edit. v1's `onMouseDown` currently ends the text edit on any click outside the editing element — extend that check so descendants of the inspector are treated as "inside, do not commit."
  - Font-size, colour, position, size adjustments made while a text edit is open apply to the same element being edited and produce one history entry per adjustment, exactly as outside text-edit mode.
  - Typing in an inspector input does NOT route caret keystrokes to the text-edit target. Standard focus management — whichever is focused gets the keystrokes.

- **Dimension bubble:** a small floating chip showing `W <px> × H <px>` positioned just above the selection ring. Updates on every drag and resize tick. Hidden during inline text edit (follows the existing ring-hide behavior; the ring competes visually with the caret and so does the bubble).

### 3. Selection ring polish (build-first)

Match the mockup:

- Rounded corners (4px radius).
- Softer blue stroke than v1's `#2a8bf2`; pull the exact tone off the mockup.
- Four corner dots rendered as solid circles, visually dominant.
- Keep all 8 functional resize handles, but render the four edge midpoints as smaller / lower-contrast circles so the corner dots are the visual hierarchy. Don't drop edge resize functionality.

## What NOT to build (explicit non-goals)

These have been considered and deliberately rejected for v2 scope. If you find yourself building one, stop and add it to `ROADMAP.md` instead.

- ❌ **Help button or modal** — fully removed from the design.
- ❌ **Overview / slide-thumbnails picker** — deferred. It will be its own scoped piece.
- ❌ **Layout tab.**
- ❌ **Style tab.**
- ❌ **Any tabs in the inspector.** It's a single conditional panel.
- ❌ **Custom HSL/HSV colour wheel widget.** The colour picker is `<input type="color">` styled behind a swatch + hex input.
- ❌ **Per-slide adaptive theming / background sampling.** Two fixed variants only, driven by `prefers-color-scheme`. Sampling is a v2.1 candidate.
- ❌ **localStorage persistence of the minimise preference.** In-memory only for v2.0.
- ❌ **New icon-library dependency.** Inline SVG only.
- ❌ **Build step, bundler, or framework.** The editor stays a single self-contained `editor.js`.
- ❌ **Reproducing any content from the reference mockup.** The example slide content shown in the image is purely UI fill. Copy, headlines, body text, image references, button labels, etc. inside the demo slide must NOT appear in `editor.js`, tests, comments, or commit messages. The image specifies how the toolbar / inspector / ring look — nothing about what the slide says.
- ❌ **Changes to existing primitives.** Drag, resize, font-size keyboard nudge, text-edit, undo/redo, and export already work and are tested. The inspector routes through them. If a primitive is missing something the inspector needs (e.g. a function to set colour), add a new primitive — don't bypass or refactor existing ones. The one explicit exception is the click-outside-ends-text-edit logic, which must be widened to recognise the inspector as "inside."
- ❌ **Breaking any v1 "Done criteria" assertion in `REQUIREMENTS.md`.** Run the v1 test suite at every phase boundary.
- ❌ **Changes to how fixture HTML renders without the editor loaded.** Open the fixture without injecting `editor.js` to confirm at every phase.
- ❌ **Widening the editor's DOM footprint into the slide.** New markers live under `data-wfp-edit-*`. Editor DOM stays inside `#wfp-editor-root`.
- ❌ **Other v2 ROADMAP items** — persistence, multi-select, snap-to-grid, aspect-ratio lock, Add menu, delete, z-order, cross-slide ops. All scoped separately.
- ❌ **Renaming or moving v1 files** unless strictly necessary for the v2 work. Stable file paths preserve git blame and reduce review surface.
- ❌ **Allow-listing anything in `references/` to git** without explicit human approval. The folder is gitignored on purpose.

## Visual reference rules

The mockup at `references/v2-inspector-design.png` is authoritative for:

- Toolbar shape, button order, state colours, the three button states (default / hover / active).
- Inspector panel layout: stacked sections with subtle dividers, label / value rows.
- The exact liquid-glass recipe values listed in the bottom strip (now translated into the two fixed variants above).
- Selection ring rounded corners + corner-dot rendering.
- Dimension bubble position and styling above the selection.

The mockup is **not** authoritative for any of the slide content shown inside the example frame on the right. That photo, headline, subhead, button copy, and badge are placeholder fill. Do not reproduce, reference, or evoke them.

If the mockup conflicts with anything in this brief on a UI dimension, raise it as a clarifying question rather than silently picking one. Two minutes of alignment saves a rebuild.

## Suggested phasing

Each phase ends with `code-reviewer` approval and one Conventional Commit. TDD mode follows v1 conventions: **strict** (test-first) for unambiguous behavior, **build-first** for visual judgement calls.

| Phase | Mode | Scope |
|---|---|---|
| v2.0 — Toolbar refresh | build-first | Recipe match (light + dark variants), SVG icons, three states. No behavior change. |
| v2.1 — Inspector scaffold + minimise | build-first | Empty panel appears on selection, hides on deselect. Minimise/expand control with cross-selection memory. Liquid-glass styled. |
| v2.2 — Position & size binding | strict | X / Y / W / H readouts and inputs, two-way bound. Dimension bubble above ring. |
| v2.3 — Font-size triplet | strict | Input + slider + ± buttons, one history entry per commit. |
| v2.4 — Colour controls | strict (logic) + build-first (UI) | Text + background colour. Hex parsing. Transparent affordance. Native picker behind swatch. |
| v2.5 — Reset styles | strict | Clears entire inline `style` attribute. One history entry. |
| v2.6 — Inspector-during-text-edit | strict | Click inside inspector does not end text edit. Adjustments while editing produce normal history entries. |
| v2.7 — Selection ring polish | build-first | Rounded ring, corner dots, smaller midpoint handles. |
| v2.8 — End-to-end pass *(checkpoint)* | build-first | Run on both fixtures. v1 done criteria still pass. v2 spec passes. Tag `v2.0.0`. |

After v2.8 ships and the human confirms end-to-end on a real slide, tag `v2.0.0` and update `ROADMAP.md` to reflect what moved out of v2 candidates.

## Pre-flight (already complete)

- ✅ Image dropped at `references/v2-inspector-design.png`.
- ✅ `references/` added to `.gitignore`.
- ✅ All five open questions answered (see "Decisions baked in" above).

The only outstanding pre-condition is v1 phase 10 (the bookmarklet generator). v2 work does not block on it — phase 10 can ship before, alongside, or after v2 — but the human should sequence pushes deliberately.

---

## Kickoff prompt for the builder

Paste the block below into the worktree builder session. Self-contained — no further context needed.

> **Task:** Execute the v2 Inspector Panel + Liquid-Glass Refresh for the WFP Slide Editor.
>
> **Branch:** create a worktree off `main` on a new branch `feat/v2-inspector`. Do not push.
>
> **Read first, in order:**
> 1. `feature-briefs/v2-inspector.md` end-to-end. This is the spec.
> 2. `references/v2-inspector-design.png`. UI authoritative; presentation content is placeholder only — do not reproduce any of the demo slide's copy, layout, photo, or labels in code, tests, comments, or commit messages.
> 3. `CLAUDE.md`, `REQUIREMENTS.md`, `DESIGN.md`, `TESTING.md`, `ROADMAP.md`, and the current `editor.js`.
>
> **All open questions are already answered. Do not pause to ask.** They are baked in under "Decisions baked in" in the brief: native `<input type="color">` behind a styled swatch; reset styles clears all inline styles; two fixed liquid-glass variants driven by `prefers-color-scheme` (no slide-content sampling); inspector stays visible during inline text edit and clicks inside it do not end the edit; minimise/expand state is remembered across selections via in-memory state.
>
> **`references/` is gitignored.** Do not allow-list anything inside it.
>
> **Execute the suggested phasing v2.0 → v2.8 in order.** For each phase:
> - Follow its TDD mode (`strict` = failing test first; `build-first` = implement + visual verify, then tests before phase close).
> - Run the existing v1 Playwright suite at every phase boundary; all v1 tests must still pass.
> - At the end of the phase, invoke the `code-reviewer` subagent. Do not move on until it returns APPROVE.
> - Make one Conventional Commit per phase. Suggested format: `feat(v2.N): <summary>`. Do not push.
> - For checkpoint phases (currently v2.8), STOP and produce a checkpoint summary as defined in `CLAUDE.md`. Wait for human reply before tagging `v2.0.0`.
>
> **Hard non-goals — do not build any of these even if they seem natural:** Help button or modal; Overview / thumbnail picker; Layout tab; Style tab; tabs of any kind; custom HSL colour widget; per-slide adaptive theming; localStorage persistence; new icon-library or runtime dependencies; build step / bundler / framework; reproducing example content from the reference image; changes to existing primitives beyond the click-outside-text-edit widening; renaming or moving v1 files; allow-listing anything in `references/` to git.
>
> **At v2.8 checkpoint, after `code-reviewer` approves:** stop, summarise, wait for human approval, then on `proceed` reply tag `v2.0.0` and update `ROADMAP.md` to remove the items that v2 delivered.
