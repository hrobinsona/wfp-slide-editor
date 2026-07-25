# Features and Bugs

Running tracker for known bugs and candidate iterations on **existing**
behaviour — the things too small for a `ROADMAP.md` release entry but worth
not losing. Release-scale feature candidates stay in `ROADMAP.md`; the
current product contract stays in `REQUIREMENTS.md`. When an item here
ships, move it to Resolved with a commit reference rather than deleting it.

Entry format: status, date raised, where it came from, and enough context
that a fresh session can act on it without archaeology.

## Open — behaviour iterations

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

## Resolved

### Reset did not restore unlock-frozen sibling groups

- **Status:** fixed 2026-07-25 (ISS-002; branch `codex/fix-flow-reset`)
- **Raised:** 2026-07-24, during the reset-warps-element bug fix

Reset previously restored only the selected element's inline style, leaving
mechanically pinned siblings absolute and their container frozen. Flow unlock
now records a group-wide pre-unlock snapshot plus each exact editor-written pin.
Reset restores eligible members and obsolete freeze markers in one history
transaction, with full undo/redo and connected selection. A member whose style
diverged after pinning is preserved as a deliberate later edit; any container
it still depends on also remains pinned. Follow-up review hardened overlapping
nested unlocks with latest-active ownership, preventing an older reset from
removing newer markers or container dependencies. Group activity now
round-trips with history and retires after undo-unlock/full-reset so stale
metadata cannot intercept later ordinary Reset. Synthetic
Plan/Review/Publish and nested-lane coverage in
`tests/v2-5-reset-styles.spec.js` exercises full, partial, overlapping, and
lifecycle restoration.

### Handoff ledger reported overflow:true for elements dragged out of an unlock-frozen parent

- **Status:** fixed 2026-07-24 (BUG-001, high; branch `fix/v2.14-overflow-false-positives`)
- **Raised:** 2026-07-24, v2.14 manual browser QA

`measureElementOverflow`'s parent-escape branch (`src/editor/95-export.js`)
reported `overflow: true` for a flow-unlocked element the user had dragged to
a new, correctly-rendered position: dragging a flex/flow child freezes the
parent (e.g. `.chip-row`) to its *pre-drag* footprint, so the child's new
position falls outside that stale box and trips the geometric check with no
visual clipping. Fixed by skipping the parent-escape check when the element
or its parent carries `data-wfp-edit-frozen`/`data-wfp-edit-flex-frozen` — in
that state the parent box is pre-edit layout, not a containment boundary. The
content-clipping branch still runs for frozen elements. New coverage:
`tests/v2-14-handoff-ground-truth.spec.js` drags a `.chip` out of
`fixtures/foreign-deck.html`'s `.chip-row` and asserts `overflow: false` on
both the annotation and ledger entries.

### Handoff measurement reported overflow:true on tight-line-height multi-line text

- **Status:** fixed 2026-07-24 (BUG-002, low; branch `fix/v2.14-overflow-false-positives`)
- **Raised:** 2026-07-24, v2.14 manual browser QA

`measureElementOverflow`'s content branch returned `overflow: true` for a
headline with `line-height < 1` once its text wrapped, because glyph-descender
metrics push `scrollHeight` a few px above `clientHeight` with no actual
clipping (live: `h1.foreign-title` at 60–67px, ~7px gap). Fixed by allowing
vertical slop proportional to font-size (`max(1, fontSize * 0.25)`) in the
`scrollHeight` comparison — descender overhang is a fraction of font-size,
while a genuinely clipped line adds roughly a full font-size, so real content
overflow (e.g. the shrunk `.resize-target` case) still reports `true`.
Horizontal tolerance is unchanged. New coverage:
`tests/v2-14-handoff-ground-truth.spec.js` wraps the `line-height: 0.96`
headline and asserts `overflow: false`.

### Reset warped elements to the slide origin

- **Status:** fixed 2026-07-24 (uncommitted at time of writing)
- **Raised:** 2026-07-24, user report

Reset cleared the element's entire inline `style` attribute, destroying
deck-authored position/size (and editor pin styles), dropping elements to
0/0 with auto dimensions. Reset now restores the pre-edit original style
captured at the element's first committed change; no-op on never-edited
elements. Contract updated in `REQUIREMENTS.md`/`DESIGN.md`; spec rewritten
harness-based in `tests/v2-5-reset-styles.spec.js`.
