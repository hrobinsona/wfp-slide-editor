# v2 Brief — "Ink Glass" Toolbar + Inspector Refresh (design 3b)

> Status: In progress on branch `worktree-ink-glass-ui`.

## Context

Restyles the v2.5 toolbar + inspector to the approved "Ink Glass" design (option
3b). Spec source is the designer handoff bundle (`README.md` +
`wfpe-glass.css`, July 2026): one top-right "instrument" made of two dark-glass
segments separated by a 1px seam — a 36px icon-only toolbar and a 246px
inspector that docks beneath it when an element is selected.

The referenced interactive mockup (`Bookmarklet UI.dc.html`, option 3b) was not
available at implementation time; the handoff README's states/motion table and
the reviewer checklist below are the behavior reference.

**This is a restyle.** Editor logic, history/txn machinery, and export code are
not to be changed. The only new behaviors are UI-chrome states (toolbar
collapse, inspector dock/fold) and the typography section the handoff requires,
which writes through the *existing* history/txn path.

## Spec highlights (from handoff README)

- Ink glass surface: `blur(24px) saturate(170%)` over `rgba(22,25,31,0.32)` +
  white top sheen (inset box-shadow, no `::before` overlay). White type on all
  hosts; **no `prefers-color-scheme` variants** for the instrument.
- Radii 18 → 12px; buttons 8–9px; fields 7px. Bar 246×36 (58×36 collapsed).
- Inspector: 246 wide, 66px label column, 24px fields, docked at
  `top: 53px` (16 + 36 + 1px seam), corners `6 6 12 12`; **no outer drop
  shadow** on the inspector segment (clipped by the fold wrapper otherwise).
- Motion, all `cubic-bezier(0.32,0.72,0,1)`:
  - dock open/close (`grid-template-rows 0fr↔1fr` on `.wfpe-inspector-dock`) — 380ms
  - bar bottom-corner morph 12↔6px via `data-docked` — 380ms
  - toolbar collapse 246↔58px + middle-group fold via `data-collapsed` — 340ms
  - inspector minimise fold (36px header stays) — 380ms
- When nothing is selected the bar returns to a fully-rounded 12px capsule.

## DOM changes (editor.js)

1. Toolbar buttons are icon-only (labels removed, `title` kept, `aria-label`s
   added). Overview→Redo + trailing divider wrap in
   `.wfpe-toolbar-fold > .wfpe-toolbar-fold-inner`; a `.wfpe-toolbar-collapse`
   chevron button follows. New `state.toolbarCollapsed` toggles
   `data-collapsed` on the bar.
2. Inspector wraps in `.wfpe-inspector-dock > .wfpe-inspector-dock-inner`.
   Selection drives `data-visible` on the dock and `data-docked` on the
   toolbar, both from `refreshInspector()`. The panel's own
   `data-visible`/`display:none` mechanism is retired (attribute kept in sync
   for test continuity).
3. Inspector body wraps in `.wfpe-inspector-fold > .wfpe-inspector-fold-inner`;
   minimise folds the body, leaving the 36px header. The minimise chevron is a
   single icon rotated by CSS (no innerHTML swapping).
4. Typography section between Size and the colour rows, bounded by
   `.wfpe-inspector-divider`s:
   - Font: −/field/+ stepper (the slider is **removed** — not in design 3b).
   - Weight: `.wfpe-seg` Reg/Med/Bold → `font-weight` 400/500/700.
   - Align: `.wfpe-seg` icon items → `text-align` left/center/right.
   Weight/align follow font-size's text-bearing visibility rule and commit via
   `startInspectorTxn`/`touchElement`/`endInspectorTxn` — one entry per click,
   no-op guarded.
5. Action row becomes `.wfpe-action-row` with `.wfpe-action-btn` buttons
   (existing per-button classes retained alongside).

## Deviations from the handoff CSS (deliberate)

- `.wfpe-annotation-delete-btn[data-enabled="true"]` → styled via
  `:not(:disabled)` instead; the DOM already manages `disabled` and changing
  that would be logic churn for no visual gain.
- `.wfpe-color-swatch[data-empty="true"]` → selector kept as the existing
  `[data-transparent="true"]` (same checkerboard treatment).
- Custom opacity rail/knob CSS (`.wfpe-opacity-track/rail/fill/knob`) is not
  adopted: it would replace the native range input with new drag logic. The
  native slider is restyled to the same rail/knob token values instead.
- Annotation status line, `data-has-note` outline, `data-image` swatch stripe,
  colour-input click-target rule, spin-button removal, and the flat-mode
  position-context rule are preserved from the current CSS (absent from the
  handoff, still required).
- Delete button keeps its red hover (destructive affordance, existing
  behavior).
- `.wfpe-inspector-dock[data-visible="false"] .wfpe-inspector` additionally
  gets delayed `visibility: hidden` so the folded panel is neither
  focus-reachable nor reported visible by tooling.
- Overview mode's `display:none !important` rule retargets from
  `.wfpe-inspector` to `.wfpe-inspector-dock`.

## Test impact

- TDD mode: **build-first** (visual surface) per CLAUDE.md.
- Private fixtures (`Townhall-1.html`, `boilerplate.html`, rotation pool) are
  absent on this machine, so the existing suite cannot run here. Existing specs
  are updated best-effort where they reference removed DOM (mode labels, font
  slider, annotation textarea class); the suite needs a verification run on a
  machine with fixtures before merge.
- New spec `tests/v2-10-ink-glass.spec.js` runs against `dev/harness.html`
  (synthetic deck, safe to commit) covering: dock/data-docked sync on
  select/deselect, capsule re-round, toolbar collapse to 58px, minimise fold,
  weight/align apply + single-entry undo, and export cleanliness of the new
  wrappers.

## Open questions for the designer

- Collapsed bar (58px) + docked inspector (246px) can coexist: the narrow
  bar sits corner-morphed above the full-width panel. The handoff's states
  table doesn't cover this combination; current behavior keeps the two
  states independent. If it reads poorly, candidates are auto-expanding
  the bar on selection or suppressing the corner morph while collapsed.

## Reviewer checklist (visual pass)

- Capsule re-rounds to 12px on deselect (squared corners only while docked).
- Exactly 1px seam between bar and inspector.
- No outer drop shadow on the inspector segment.
- Collapsed bar is 58px and symmetric with the folded inspector header (36px).
- Chevrons rotate 180° via CSS transform; Edit pill is coral when active.
