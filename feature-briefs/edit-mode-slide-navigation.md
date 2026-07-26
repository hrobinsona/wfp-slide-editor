# Brief: Slide Navigation While Edit Mode Is On

**Status:** approved 2026-07-26
**TDD mode:** strict (keyboard routing logic, no visual surface)

## Problem

Edit mode currently confiscates the deck's navigation keys. `ArrowLeft`,
`ArrowRight`, and `Space` are swallowed unconditionally whenever edit mode
(or Overview) is on, so a user who turns edit mode on and then wants to look
at the next slide has to toggle edit mode off, navigate, and toggle it back
on. Nothing in the editor is bound to those keys when no element is
selected, so the suppression buys nothing in that state.

## Rule

Navigation keys (`ArrowLeft`, `ArrowRight`, `Space`/`Spacebar`, no
Cmd/Ctrl/Alt) belong to the deck unless the editor genuinely has something
bound to them.

| State | Navigation keys | Change |
| --- | --- | --- |
| Text edit open | move the caret, never the slide | unchanged |
| Overview mode | swallowed | unchanged |
| Export menu open | swallowed | tightened (see below) |
| Edit mode + element selected (single or multi) | swallowed | unchanged |
| **Edit mode + nothing selected** | **navigate slides** | **new** |
| Edit mode off | navigate slides | unchanged |

A live selection blocks navigation deliberately: the user is working on an
element, and navigating away would strand the selection on a hidden slide.
`Space` follows `ArrowRight` because it is the deck's standard advance key
and splitting the two would be arbitrary.

## Implementation

`onKeyDown` in `src/editor/60-modes-overview-keyboard.js` had two separate
arrow blocks — the `deckMutated` takeover for plain view, and the blanket
edit/overview suppression later in the handler. They collapse into one
guarded block placed where the takeover was, above the
`!editMode && !overviewMode` early return:

1. Not a navigation key → fall through to the rest of the handler.
2. `exportMenuOpen` → `stopPropagation` so the deck cannot move behind an
   open menu, plus `preventDefault` unless a menu row holds focus (that row
   keeps its native `Space` activation, matching the focus carve-out `Enter`
   already makes).
3. `overviewMode || (editMode && selected)` → `preventDefault` +
   `stopPropagation`, return.
4. `deckMutated` → editor-owned `navigateRelativeInDeck(±1)`.
5. Otherwise → `return`, letting the host deck's own bubble-phase handler
   navigate. Before returning, `preventDefault` when `document.activeElement`
   is inside the editor root: a toolbar button clicked with the mouse keeps
   focus, and `Space`'s native default action would re-activate it, so
   pressing `Space` after clicking Edit would advance the slide *and* toggle
   edit mode off. Suppressing the default action leaves propagation intact,
   so the host still navigates from its own `keydown` listener.

Steps 3 and 4 are the split that already governed plain view, so edit-mode
navigation inherits it for free: an untouched deck keeps its own
transitions and counters, and a reordered/refreshed deck uses fresh-DOM
navigation because the host's cached cursor may be stale.

No selection-state cleanup is needed on the new path. Nothing is selected
by definition, and the slide-class `MutationObserver` in
`src/editor/70-selection-events.js` already clears selection and any open
text edit when `.slide.active` moves.

Flat/scroll documents follow the same rule rather than getting a carve-out.
They have no slides and never set `deckMutated`, so with edit mode on and
nothing selected the keys keep their normal meaning there too — `Space`
scrolls the page. A live selection still suppresses them.

## Tests

New spec `tests/v2-edit-mode-nav.spec.js`, built on `foreign-deck.html`:

- edit on, nothing selected — `ArrowRight` advances, `ArrowLeft` goes back,
  `Space` advances, and the host's `.slide-count` follows.
- edit on via a *click* on the Edit button, nothing selected — `Space`
  advances and edit mode stays on (the focused-button double-fire).
- edit on, nothing selected — after navigating, an element on the newly
  active slide selects cleanly and the ring binds to it.
- edit on, element selected — `ArrowRight` does not navigate and the
  selection survives. Same for a multi-selection.
- edit on, nothing selected, deck reordered in Overview — navigation
  follows live DOM order (the `deckMutated` path).
- edit on, text edit open — arrows still do not navigate.
- Overview on, and export menu open — keys still do not navigate.
- flat document, edit on — `Space` scrolls with nothing selected, and does
  not scroll with an element selected.

Rewritten, not deleted: `tests/09-end-to-end.spec.js` case 10 (“With edit
mode ON, ArrowRight does NOT navigate slides”) becomes the
selected-element version of the same assertion.

Untouched and still passing: `tests/07-text-edit.spec.js:242`.

Not executed on the machine this landed from: `tests/09-end-to-end.spec.js`
(cases 10 and 11) needs the private pinned fixtures, which are absent
locally. Run it once the fixtures are restored.

## Docs

- `REQUIREMENTS.md` — the line stating that edit mode suppresses slide
  keyboard navigation is replaced with the selection-scoped rule above.
- `DESIGN.md` — the keyboard-coexistence list gains the single
  navigation-key decision point and its `deckMutated` routing.
- `TESTING.md` — manual step 3 now checks both halves of the rule.
