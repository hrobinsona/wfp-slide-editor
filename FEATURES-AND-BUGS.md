# Features and Bugs

Running tracker for known bugs and candidate iterations on **existing**
behaviour — the things too small for a `ROADMAP.md` release entry but worth
not losing. Release-scale feature candidates stay in `ROADMAP.md`; the
current product contract stays in `REQUIREMENTS.md`. When an item here
ships, move it to Resolved with a commit reference rather than deleting it.

Entry format: status, date raised, where it came from, and enough context
that a fresh session can act on it without archaeology.

## Open — behaviour iterations

### Reset does not restore unlock-frozen sibling groups

- **Status:** open
- **Raised:** 2026-07-24, during the reset-warps-element bug fix

Reset restores the selected element's inline `style` to its pre-edit
original (`state.originalStyles`, captured at the element's first committed
transaction). It is deliberately scoped to that one element: when a
flow-layout element is dragged, `unlockToAbsolute`/`pinContainerChildren`
(`src/editor/80-drag-resize-unlock.js`) pin its ancestor containers
(explicit width/height, `position: relative`) and absolutely position every
sibling, all marked `data-wfp-edit-frozen`/`data-wfp-edit-flex-frozen`.
Resetting that element reverts only its own styles — the container stays
pinned and siblings stay absolute, so the element re-enters flow inside a
frozen container and can land somewhere unhelpful (e.g. stretched across a
flex row as its only in-flow child).

A fuller reset would restore the whole unlock group. The open design
question: siblings edited *after* the freeze have their own intentional
edits, and group-restore would silently revert them. Per-element originals
already exist for every pinned element (recorded in the same transaction as
the freeze), so the data is there; the policy isn't. See the scope comment
above the reset handler in `src/editor/30-ui-inspector-controls.js`.

## Open — bugs

### Stale annotation-marker size assertions (16px vs 13px)

- **Status:** open — spun off as a background task chip on 2026-07-24
- **Raised:** 2026-07-24, found by the runnable-subset regression run

`tests/v2-agent-annotations.spec.js` ("…are undoable", ~line 171) asserts
the annotation badge is 16×16px, but commit `379a2a4` (v2.12.2 coral-glass
note dot) restyled `.wfpe-annotation-badge` to 13×13px
(`src/editor/20-dom-css.js`). The restyle is intentional per its commit
message, so the test is stale, not the code. Test-only fix; check the spec
for other 16px badge references.

## Resolved

### Reset warped elements to the slide origin

- **Status:** fixed 2026-07-24 (uncommitted at time of writing)
- **Raised:** 2026-07-24, user report

Reset cleared the element's entire inline `style` attribute, destroying
deck-authored position/size (and editor pin styles), dropping elements to
0/0 with auto dimensions. Reset now restores the pre-edit original style
captured at the element's first committed change; no-op on never-edited
elements. Contract updated in `REQUIREMENTS.md`/`DESIGN.md`; spec rewritten
harness-based in `tests/v2-5-reset-styles.spec.js`.
