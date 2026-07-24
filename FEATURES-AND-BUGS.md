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

### Editor-owned nav leaves foreign slide counters stale

- **Status:** open
- **Raised:** 2026-07-24, v2.13 live-round-trip build (spike finding, confirmed in the browser demo)

The `deckMutated` arrow-nav takeover and the v2.13 post-refresh slide
restore sync `.progress-dot` elements only. Foreign decks with bespoke
counters (e.g. `fixtures/foreign-deck.html`'s `.slide-count` label) show a
stale "1 / 4" after a live refresh restores slide 3, and after any
takeover navigation. Contract decks are unaffected. Pre-existing for
reorder/delete; v2.13 makes it more visible. Candidate: detect and re-run
the deck's own counter update where a hook exists (`foreignFixtureShow`
style globals), or document as a known foreign-deck limitation.

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

### Handoff ledger reports overflow:true for elements dragged out of an unlock-frozen parent

- **Status:** open
- **Raised:** 2026-07-24, v2.14 manual browser QA (high severity)

`measureElementOverflow` (`src/editor/95-export.js:410-427`) reports
`overflow: true` for a flow-unlocked element that the user dragged to a new,
correctly-rendered position. Root cause is the parent-escape branch
(lines 417-426): when a flex/flow child is dragged, `pinContainerChildren`
freezes the parent (`.chip-row`) to its *pre-drag* footprint, so the
child's new position falls outside that stale parent box and trips the
check — even though the element has no visual clipping. Reproduced live:
dragging a `.chip` out of `fixtures/foreign-deck.html`'s `.chip-row`
yielded `overflow: true` on the drag target while its untouched siblings
read `false`. This hits drag-to-reposition — the most common edit — and
contradicts the ledger's own "preserve these edits" guidance: an agent
trusting the signal could move a correctly-placed element back inside the
stale box. Same unlock/freeze mechanism as the "Reset does not restore
unlock-frozen sibling groups" entry above. Suggested fix: skip or
down-weight the parent-escape check when the element or its parent carries
`data-wfp-edit-frozen`/`data-wfp-edit-flex-frozen` (in that state the
parent box is pre-edit layout, not an intended containment boundary).
Coverage gap: `tests/v2-14-handoff-ground-truth.spec.js` overflow tests
cover a fitting element and a content-overflow case, but no flex-freeze
drag target.

### Handoff measurement reports overflow:true on tight-line-height multi-line text

- **Status:** open (low severity — known tradeoff, flagged in v2.14 code review, confirmed live in QA)
- **Raised:** 2026-07-24, v2.14 manual browser QA

`measureElementOverflow`'s content branch (`src/editor/95-export.js:411-416`)
returns `overflow: true` for a headline with `line-height < 1` once its text
wraps to two lines, because glyph-descender metrics push `scrollHeight` a
few px above `clientHeight` with no actual clipping. Reproduced live on
`h1.foreign-title` (`line-height: 0.96`) at `font-size: 67px`: scrollHeight
136 vs clientHeight 129, `overflow: true`, but the text renders fully
visible. Lower impact than the flex-freeze case but affects a common
display-type pattern. Suggested fix: widen the content tolerance to absorb
typical descender overhang, or note in the guidance that `overflow: true`
near sub-1 line-height warrants a visual check before acting.

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
