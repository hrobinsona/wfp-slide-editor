# Features and Bugs

Running tracker for known bugs and candidate iterations on **existing**
behaviour — the things too small for a `ROADMAP.md` release entry but worth
not losing. Release-scale feature candidates stay in `ROADMAP.md`; the
current product contract stays in `REQUIREMENTS.md`. When an item here
ships, move it to Resolved with a commit reference rather than deleting it.

Entry format: status, date raised, where it came from, and enough context
that a fresh session can act on it without archaeology.

## Open — behaviour iterations

None.

## Open — bugs

None.

## Resolved

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
