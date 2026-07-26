# Features and Bugs

Running tracker for known bugs and candidate iterations on **existing**
behaviour — the things too small for a `ROADMAP.md` release entry but worth
not losing. Release-scale feature candidates stay in `ROADMAP.md`; the
current product contract stays in `REQUIREMENTS.md`. When an item here
ships, move it to Resolved with a commit reference rather than deleting it.

Entry format: status, date raised, where it came from, and enough context
that a fresh session can act on it without archaeology.

## Open — behaviour iterations

### Deselect/reselect click pattern remains a latent flake in one annotation test

- **Status:** open (test hygiene; currently passing, hazard is latent)
- **Raised:** 2026-07-26, cross-model review of PR #16

`tests/v2-agent-annotations.spec.js` (~line 247) still re-renders the
annotation row by deselecting and reselecting through a slide click. That is
the exact pattern that made its sibling test ("saved notes, replies, and
actions remain reachable in bounded inspectors") flaky: `onClick` rejects any
click whose point lands inside the docked inspector's box
(`isPointInsidePassiveEditorSurface`, `src/editor/40-helpers-selection-inspector.js`),
and at 1280x720 that box spans roughly x 158-404, y 56-541 — covering the
elements the test clicks. The round trip only lands while the dock is still
animating; once settled the reselect is swallowed and the row never
re-renders. PR #16 fixed the sibling test by pressing Escape in the note field
instead (the editor's own force-repopulate path, reachable from the inspector
alone). Apply the same approach here, then verify with `--repeat-each=5` and
at `--workers=10`.

### Transaction-flush loop guards double-invocation only across calls

- **Status:** open (defensive; inert with today's single hook)
- **Raised:** 2026-07-26, cross-model review of PR #16

`flushPendingTxnSessions()` (`src/editor/50-history.js`) deletes each hook
from the registry before invoking it, which prevents double-invocation across
separate flush calls but not *within* one call: if a hook's own execution
triggered a nested flush while a second hook was still in the outer loop's
snapshot, that second hook could run twice. Inert today — exactly one hook
exists (`closeOpacitySession` in `src/editor/30-ui-inspector-controls.js`,
which self-unregisters as its first statement) and the shared `state.txn` slot
rules out concurrency. Add a `has()` re-check inside the loop before invoking
each hook so the invariant is structural rather than incidental, before any
second settle-window control is introduced.

### Font-size ± steppers and the ↑/↓ keyboard nudge disagree on multi-selection

- **Status:** open (behaviour inconsistency; candidate follow-up)
- **Raised:** 2026-07-26, code review of v2.18 (multi-select inspector)

v2.18 made the inspector's font ± stepper buttons (`nudgeFontSizeWithHistory`,
`src/editor/60-modes-overview-keyboard.js`) operate on every text-bearing
member of a multi-selection, each stepped relatively from its own size. The
keyboard ArrowUp/ArrowDown font nudge (same file, ~line 1041) still bails
outright on `hasMultiSelection()` and does nothing. Two paths that read as
the same feature (step the selected text size by one) now disagree on
whether a multi-selection is a valid target. Worth reconciling — most likely
by extending the keyboard path to the same per-member relative-step logic
the ± buttons now use — but out of scope for the v2.18 brief, which only
specified the inspector buttons.

## Open — bugs

### Content-edit undo can strand a later entry on a recreated child node

- **Status:** open (latent; fails as a silent no-op, not an error)
- **Raised:** 2026-07-25, post-merge review following PRs #13-#15

A content-edit history entry restores through `applyElementSnapshot`'s
`el.innerHTML = snap.html` write (`src/editor/50-history.js`). That write
destroys and recreates the element's child nodes, so any *other* history
entry that holds a direct reference to one of those children — because the
user edited that child in its own later transaction — is left pointing at a
detached node. Redoing that later entry then applies its snapshot to
something no longer in the document: no error, no visible effect, no
indication the redo did nothing.

R1 already removed the common case by capturing `innerHTML` only for
content-edit transactions, so style-only operations no longer recreate
children. What remains is the genuinely nested sequence: edit an element's
text, then edit one of its child elements, then undo past the text edit and
redo forward.

Not yet reproduced in a user report; the cost is a silently skipped redo
step rather than corruption. A fix needs identity that survives an
`innerHTML` rewrite — for example re-resolving each change's target by
index path at apply time, or replaying content restores with node-level
patches instead of a whole-subtree write. Whichever is chosen, the
regression test is the three-step sequence above with an assertion that the
child's redo actually lands on the connected node.

### Drag and Align can stretch a right-anchored, auto-width absolutely-positioned element

- **Status:** open (pre-existing in drag; inherited by Align, v2.19)
- **Raised:** 2026-07-26, code review during v2.19 (align-elements)

Both drag's `onMouseMove` (`src/editor/80-drag-resize-unlock.js`) and the new
Align feature's `applyAlignPlan` (`src/editor/40-helpers-selection-inspector.js`)
move an absolutely-positioned element by writing `style.left`/`style.top`
only. For an element authored with `right: Npx; left: auto; width: auto`,
adding an explicit `left` leaves `left` + `right` + auto-`width` all
constrained at once, and the browser solves `width` to fill the gap instead
of preserving it — the element's position lands correctly but its box
stretches or shrinks. No fixture in `fixtures/foreign-deck.html` currently
exercises this shape, so it hasn't shown up in any spec. A fix would need to
pin `width` (and clear `right`) as part of the same write whenever `right` is
already a non-auto inline/computed value — worth doing for drag and Align
together rather than one at a time, since they share the same write pattern.

## Resolved

### No keyboard way to deselect, so nav keys can only be handed back by mouse

- **Status:** fixed 2026-07-26 (branch `main`)
- **Raised:** 2026-07-26, code review of `feature-briefs/edit-mode-slide-navigation.md`

`Escape` did not clear a live selection — the ring and inspector stayed up
because `Escape` was bound only to text-edit commit, Overview exit, and
export-menu close, none of which touch `state.selected`. Since a live
selection is what reserves `ArrowLeft` / `ArrowRight` / `Space` for the
editor, the only way to hand those keys back was clicking empty slide
background, awkward while the docked inspector covers part of the slide
(`isPointInsidePassiveEditorSurface`).

Fixed in `onKeyDown` (`src/editor/60-modes-overview-keyboard.js`) with an
`Escape` branch placed after the existing consumers: the export menu and
text edit return earlier in the handler, Overview one branch above, and
inspector inputs are excluded by the `isTypingTarget` guard, so their own
revert-on-Escape still runs. The branch no-ops while a drag or resize is
in flight — the pointer gesture owns the element until mouseup. Clearing
goes through `setSelected(null)` + `refreshInspector()`, the same path as a
background click, so single and multi selections both drop in one press.
Coverage in `tests/v2-edit-mode-nav.spec.js` ("Escape clears the selection"),
including the Escape-then-ArrowRight hand-back and the ordering cases.

### Flat-document export dropped the root positioning context

- **Status:** fixed 2026-07-25 (PR #14, merge `8ecc685`; branch `fix/flat-export-position-context`)
- **Raised:** 2026-07-24, flat-document export QA

Exports of a flat (non-`.deck`) document re-anchored absolutely positioned
elements to the document body instead of to the flat root, so every edited
element drifted by roughly 120-170px — the drift scaled with the centering
margin, which is exactly the offset between the two containing blocks. The
live editor was correct; only the exported copy moved. A statically
positioned flat root gets its positioning context from an editor-stylesheet
rule keyed on `data-wfp-edit-flat-position-context` (deliberately, so the
live document keeps a pristine root with no inline style), and the export
strips both the editor CSS and that marker.

Fixed by `persistFlatPositionContext` in `src/editor/95-export.js`, which
stamps an inline `position: relative` on the CLONE's flat root before the
marker sweep runs, so the exported document reproduces the same containing
block without depending on editor CSS. Coverage in
`tests/v2-4-modes.spec.js`.

### Save-in-place rewrote relative asset URLs to machine-local file paths

- **Status:** fixed 2026-07-25 (PR #14, merge `8ecc685`; branch `fix/flat-export-position-context`)
- **Raised:** 2026-07-24, same review

Absolutizing asset URLs is a property of the *destination*, not of the
export pipeline: a downloaded copy leaves the deck's folder and needs
absolute references to survive the move, but save-in-place writes back into
that same folder, where turning `images/pic.png` into
`file:///Users/.../images/pic.png` freezes the deck to one machine and
breaks it the moment the folder is moved, renamed, or shared. Save-in-place
now passes `absolutizeAssets: false`; downloads still absolutize.

Covered in `tests/v2.11-save-in-place.spec.js` for both the clean pipeline
and — added in the follow-up cleanup, branch `chore/post-fix-cleanup` — the
annotated handoff pipeline, which is a separate builder that has to forward
the same option.

### Zero-movement resize-handle clicks mutated the element and pushed phantom history

- **Status:** fixed 2026-07-25 (PR #13, merge `11f00b2`; branch `fix/unlock-resize-hardening`)
- **Raised:** 2026-07-24, resize QA

Pressing and releasing a resize handle without moving the pointer was
treated as a resize: it unlocked flow positioning, wrote explicit
width/height, and pushed a history entry for a gesture the user never made.
The click-to-focus-a-handle case therefore silently changed the document and
added an undo step that appeared to do nothing.

Resize now defers all mutation — unlock, sibling pinning, and style writes —
until the pointer leaves a deadzone, and re-reads its anchors at that point
so the gesture measures from where the real drag began rather than from the
press. Coverage in `tests/v2-15-unlock-hardening.spec.js`.

### Unlocking a direct child of the slide/flat root collapsed its siblings

- **Status:** fixed 2026-07-25 (PR #13, merge `11f00b2`; branch `fix/unlock-resize-hardening`)
- **Raised:** 2026-07-24, flow-unlock QA

Flow unlock pinned siblings when the unlocked element was nested, but not
when it was a DIRECT child of the slide or flat root. Promoting such a child
to absolute removed it from flow with nothing holding the remaining children
in place, so the rest of the document jumped upward — measured at 554px in
the reported case.

Direct-child unlock now pins the root's siblings on the same paths nested
unlock already used, and holds the flat root's height so the emptied flow
does not collapse. The height hold is derived state: it is recorded as a
`data-wfp-edit-*` attribute plus a dynamic editor CSS rule rather than an
inline write on the user's root, re-derived whenever the pinned set changes
(including delete, paste, and live refresh), released when the last pinned
child goes away, and persisted into exports so the exported document matches
what was on screen. Pin paths skip editor DOM and non-rendered children.
Coverage in `tests/v2-15-unlock-hardening.spec.js`.

### Idle selection tracking re-ran the full inspector populate every frame

- **Status:** fixed 2026-07-25 (PR #15, merge `8fef716`; branch `fix/selection-tracking-perf`)
- **Raised:** 2026-07-24, performance review of the R2 tracking loop

The R2 requestAnimationFrame loop that keeps the selection ring aligned with
an element moving under its own steam called the full `refreshSelection()`
path on every tick, including a complete inspector repopulate, whether or
not anything had moved. Idle edit mode therefore burned a steady stream of
layout and script work.

The loop now compares bounding rects each tick and only pays for a refresh
when something actually moved. Measured over one idle second: inspector
populate calls 121 → 0, `LayoutCount` 373 → ~9, `ScriptDuration` ~15ms →
~5ms. The guarantee the loop exists for is unchanged and pinned by
`tests/v2-16-tracking-efficiency.spec.js`: both the ring and an annotation
marker on a non-selected element still catch up to an element moved by a
host-page script with no editor event at all.

### Opacity slider ignored keyboard input

- **Status:** fixed 2026-07-25 (PR #15, merge `8fef716`; branch `fix/selection-tracking-perf`)
- **Raised:** 2026-07-24, accessibility pass

The slider opened its one-entry-per-gesture history session on `mousedown`
only. A keyboard user focusing the slider and pressing arrow keys moved the
native thumb but never changed the element's opacity, and the next
repopulate snapped the thumb back.

The session now opens lazily on the first `input` when none is open. A
keyboard session cannot close the way a mouse drag does, because a native
`<input type=range>` fires `change` immediately after *every* keyboard
`input` — including every tick of OS auto-repeat — so closing on `change`
would turn one held key into dozens of entries and evict unrelated undo
state. It settles instead: `change` arms a short timer that closes the
session once input stops, and a blur flushes it immediately.

Holding `state.txn` open across that settle window is only safe because the
session registers a flush hook with `50-history.js` for exactly as long as
the window is armed, so any other gesture that opens a transaction forces it
to finalize as its own entry first. Follow-up (branch
`chore/post-fix-cleanup`) extended that flush to `undo()` and `redo()`,
which move the same cursor: previously an undo during the settle window
silently discarded the live opacity edit and truncated the redo stack, so
the next undo appeared to step forward. Coverage in
`tests/v2-16-tracking-efficiency.spec.js`.

### Editor-owned nav leaves foreign slide counters stale

- **Status:** fixed 2026-07-25 (ISS-001; branch `codex/fix-foreign-counter`)
- **Raised:** 2026-07-24, v2.13 live-round-trip build (spike finding, confirmed in the browser demo)

Overview mutations/history, thumbnail navigation, fresh-DOM arrow navigation,
and live-refresh restoration now share one slide-state synchronizer. It retains
contract-deck `.progress-dot` active-state behaviour without changing dot count,
and updates foreign current/total counters only when a host node exposes a
recognized semantic counter hook plus a validated text or split-child shape. It
does not call fixture globals, rewrite host scripts, or mutate unrelated
`1 / N` content. Regression coverage uses `fixtures/foreign-deck.html` for
insert → exit Overview → ArrowRight (`2 / 5`) and for live-refresh
restoration/navigation (`3 / 4` → `4 / 4`). It also covers nonzero Overview
thumbnail navigation handing the next arrow to fresh-DOM navigation, plus
clone-side export normalization of a static recognized counter.

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

### Annotation-marker visual assertion lagged the shipped 13px coral dot

- **Status:** fixed 2026-07-25 (test hardening; branch `codex/fix-editor-usability`)
- **Raised:** 2026-07-24, runnable-subset regression run

The annotation spec now asserts the v2.12.2 13×13px coral-glass marker and
its shipped `#f0685b` centre colour rather than the retired 16px recipe.

### Inspector obscured top-right selections before a gesture

- **Status:** fixed 2026-07-25 (ISS-003; branch `codex/fix-editor-usability`)
- **Raised:** 2026-07-24, sanitized foreign-deck usability QA

The editor instrument now chooses a stable left/right dock at rest, retaining
its current side while clear and moving only when the opposite side avoids the
selection. A viewport-spanning selection uses a translucent inspector-only
fallback with explicit mouse-hover/keyboard-focus reveal and guarded first-touch
activation; the toolbar stays opaque and the existing during-gesture adaptive
fade/value tag remains intact.

### Agent-note drafts were cramped for realistic instructions

- **Status:** fixed 2026-07-25 (ISS-004; branch `codex/fix-editor-usability`)
- **Raised:** 2026-07-24, sanitized foreign-deck usability QA

The note textarea now grows from its compact baseline to a five/six-line bound
before scrolling. The inspector body itself is bounded by live viewport units
and scrolls when notes, replies, or narrow windows exceed the available height.
A roughly 136-character instruction remains directly proofreadable at 1280×720
while saved/draft, Escape, reply, save, and delete behaviour continue through
the existing annotation paths.

### Overview reorder/delete depended on hover discovery

- **Status:** fixed 2026-07-25 (ISS-005; branch `codex/fix-editor-usability`)
- **Raised:** 2026-07-24, sanitized foreign-deck usability QA

Each editor-owned thumbnail now persistently shows a concise drag grip and its
delete button. The full thumbnail remains the native drag source, and existing
click navigation, focus, hover, keyboard delete, last-slide guard, and export
cleanup paths are unchanged.

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
