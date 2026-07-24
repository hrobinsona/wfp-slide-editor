# Spike Findings: Live Agent Round-trip (2026-07-24)

Feasibility spike for the ROADMAP candidate "Live Agent Round-trip (Close the
Loop)". Question: after an agent rewrites the saved file on disk, can the
editor detect the write through the bound File System Access handle, swap the
new document into the live page **without a navigation**, and re-boot itself
with edit mode, active slide, and the file handle intact?

**Verdict: feasible — every core risk retired. Recommend proceeding to a full
feature brief.**

## Mechanism validated

1. Poll `boundFileHandle.getFile().lastModified` (1.2s interval).
2. On an external change: stash a restore payload on `window`, then
   `document.open()` / `document.write(newHtml)` / `document.close()`.
3. Re-inject the editor script captured at boot (`src` for bookmarklet loads,
   inline text for dev/Playwright injection).
4. The new instance adopts the payload at ready: same handle, edit mode,
   active slide, `state.deckMutated = true`.

Implementation: `src/editor/96-live-refresh.js` (~190 lines), small hooks in
`95-export.js` (pause watcher during own save, rebase mtime baseline after)
and `99-ready.js` (adopt + start watch).

## Findings

- **The document swap works.** `document.write` re-executes the deck's own
  scripts exactly once against the new DOM, on both file:// and http.
- **Document-level listeners are erased** by `document.open()` — measured
  with a probe listener (post-refresh keydown delta: 0). This kills both the
  fixture's stale nav handler and the old editor instance's key handling in
  one move. **Window-level listeners are also erased in Chromium** (probe
  finding: survived = false), so old-instance cleanup is simpler than
  designed for; the belt-and-braces `removeEventListener` calls were kept.
- **The realm survives.** Window globals persist across the swap, which is
  what carries the FileSystemFileHandle between generations: two refreshes
  plus two saves produced exactly **one** picker call total. No re-pick, no
  re-grant, silent saves keep working post-refresh.
- **State restore works.** Edit mode and the active slide are restored;
  `state.deckMutated = true` hands plain-view arrow nav to the editor's
  existing fresh-DOM takeover (built for overview reorder/delete, which
  produces the same closure-staleness). Exactly-one-slide-advance verified
  in both directions post-refresh.
- **No self-triggering.** The watcher pauses during the editor's own save
  and rebases its baseline afterwards; the boot generation stays stable
  across watcher ticks after a save.
- **The singleton guard composes.** Saved files never contain the editor, so
  the `ROOT_ID` guard passes on re-injection; exactly one `#wfp-editor-root`
  after every generation.

## Known seams for the full build (none are blockers)

- **Fixture-owned counters go stale.** The editor syncs `.progress-dot`
  elements, but foreign decks with bespoke counters (foreign-deck's
  `.slide-count`) show the wrong label after a restore (visible in the
  browser demo: "1 / 4" while slide 3 is active). Fine for contract decks;
  document or special-case for foreign ones.
- **Undo history dies with the old instance.** Arguably correct — the file
  changed generations — but the full brief should make that policy explicit.
- **Mid-interaction refreshes are unhandled.** The spike swaps regardless of
  open text edits, drags, or open transactions. The full build should defer
  the swap until the interaction commits.
- **Permission loss degrades silently.** If `getFile()` starts throwing
  (revoked read permission), the watch goes dormant until the next manual
  save re-binds. The full build should surface watch state in the UI.
- **IndexedDB rehydration is untestable with stubs** (plain-object handles
  are not structured-cloneable), so the window-payload handoff is the
  primary path; IDB rehydration remains the reload fallback it already was.
- **Results contract not spiked.** Per-annotation done/skipped/needs-input
  write-back and resolved-marker rendering are additive UI work on top of
  this mechanism; nothing here constrains them.

## Evidence

- `tests/spike-live-refresh.spec.js` — 3 tests, all passing: core round-trip
  + restore + listener probes; handle continuity across two agent rounds
  with a self-trigger guard; post-refresh nav ownership.
- Regression on the public-fixture subset (`v2-0-toolbar`, `v2-4-modes`,
  `v2-agent-annotations`, `v2.11-save-in-place`): 50 passed. The 5 failures
  are pre-existing on main: 4 load the absent private fixture
  `Townhall-1.html`; 1 is the stale 16px-vs-13px badge assertion already
  tracked in `FEATURES-AND-BUGS.md`.
- Live browser demo on the dev server: annotate slide 3 → save → simulated
  agent rewrite → in-place refresh with the agent's title change visible,
  slide 3 + edit mode restored, generation 2, one editor root.
