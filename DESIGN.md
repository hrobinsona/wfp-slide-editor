# Design

This document captures architectural decisions and the reasoning behind them. For current product scope, read `REQUIREMENTS.md`. For upcoming cleanup work, read `REFACTOR-MAINTAINABILITY.md`.

## Current Status

The shipped editor is v2.14: v1 element editing, v2 inspector, v2.1 Overview mode, v2.2 element copy/paste plus Overview blank-slide insertion, v2.3 move-only multi-select, v2.4 adaptive foreign/flat modes, v2.5 agent handoff annotations, v2.10 ink-glass chrome, the v2.11 export action menu with save-in-place, the v2.12 adaptive inspector fade, the v2.13 live agent round-trip, and the v2.14 handoff ground truth (edit ledger + measurements) are all in `editor.js`.

The original design target was a small single file. That has held deployment simple, but the implementation is now about 3.4k lines. The no-build, no-framework runtime constraint still holds; the next engineering priority is to refactor internal boundaries without changing user behaviour.

## Why a Bookmarklet

**Decision:** A bookmarklet loads a hosted `editor.js`.

Alternatives considered:

- Embedded harness in every slide. Rejected because slides should stay production-ready and should not carry editor code.
- Browser extension. Rejected as heavier than needed and harder to distribute across browsers.
- Bookmarklet that loads remote `editor.js`. Chosen because it keeps slides clean, lets the editor evolve independently, and keeps the bookmarklet tiny.

Tradeoffs accepted:

- Requires access to the hosted editor URL unless using local-only mode.
- Some pages may block `javascript:` URLs through Content Security Policy. Local files and self-hosted decks are the target.
- The bookmarklet cache-buster creates a fresh network fetch on activation.

## Why No Framework

**Decision:** Vanilla JavaScript.

The editor runs inside arbitrary slide HTML. A framework would add payload, lifecycle assumptions, and possible conflicts with host pages. The UI surface is toolbar, ring, handles, inspector, overview overlay, and toasts; vanilla DOM is enough.

## Why No Build Step

**Decision:** `editor.js` remains the deployed runtime file.

The current repo deliberately avoids a required compile step. GitHub Pages can serve `editor.js` directly, and the bookmarklet can fetch it as a plain script. Future refactoring may split source files only if the deployment story remains explicit and simple; a hidden build step should not appear by accident.

## Hosting

**Decision:** GitHub Pages on the public repo.

GitHub Pages is free, static, version-controlled, and sufficient for a single hosted JavaScript file. WFP/Philips slide content stays local and gitignored.

Hosted URL pattern:

```text
https://[username].github.io/wfp-slide-editor/editor.js
```

## Versioning Strategy

The bookmarklet loads latest `editor.js`. Releases can be tagged in git for auditability. If a future release introduces a breaking export or interaction model, freeze the older runtime as a pinned file such as `editor-v2.1.js` and document a pinned bookmarklet.

## Coordinate System and Scale

This remains the most important implementation detail. WFP slides render a fixed 1920x1080 canvas inside `.deck`, then scale it to the viewport using `transform: scale()`.

Mouse and pointer events report viewport pixels. Slide styles are written in unscaled slide pixels. Every drag, resize, and overlay calculation must respect that split:

```javascript
function getCanvasScale() {
  const deck = document.querySelector('.deck');
  const matrix = new DOMMatrix(getComputedStyle(deck).transform);
  return matrix.a || 1;
}

function toSlideDelta(pointerDelta) {
  return pointerDelta / getCanvasScale();
}
```

Selection overlays use viewport coordinates from `getBoundingClientRect()`. Style writes use slide coordinates.

## State Model

The editor keeps session state in plain objects. The central state currently includes:

- `editMode` for element editing.
- `overviewMode` for slide-grid editing.
- `selected` for the selected slide element.
- `selectedElements` for the active-slide selection set; `selected` remains the primary selected element.
- `editingText` for inline text editing.
- `history` and `historyIndex` for undo/redo.
- `clipboard` for session-only serialized element copy/paste.
- `inspectorMinimised` for session-only inspector UI state.
- `deckMutated` for cases where Overview has reordered or deleted slides and the editor must own navigation state.

This state is intentionally session-only. Reloading the page discards it unless the user exported HTML.

Agent annotations are deliberately stored on target elements as `data-wfp-edit-annotation-*` attributes rather than as a detached state map. That keeps undo/redo, delete/restore, selection refresh, and export cleanup aligned with the existing live-DOM source of truth.

The user-facing marker is editor chrome, not slide content: compact peach circular markers are rendered in `#wfp-editor-root` against connected annotated elements while edit mode is on. They are omitted from normal and handoff exports with the rest of the editor root.

## Selection Model

**Decision:** Primary-element selection with move-only multi-select.

The primary selected element is tracked by DOM reference in `state.selected`. Multi-select stores active-slide DOM references in `state.selectedElements`; `state.selected` remains the primary member so existing single-element commands retain their contract. A single selected element still shows the selection ring, handle set, dimension bubble, and inspector. Multiple selected elements show one editor-owned group box plus per-element outlines.

Selection is only valid while targets remain connected to the active slide. History restore paths must either preserve selected nodes or clear/re-resolve selection when a selected node is recreated. Ancestor/descendant pairs are normalized so the latest clicked target wins and the same visual content is not moved twice.

The first multi-select release is intentionally move-only: group resize, group delete/copy/duplicate, group inspector edits, group/ungroup, and marquee selection stay out of scope.

## Element Conversion to Absolute Positioning

When a user drags a flow-positioned element, including a flow element inside a multi-selection, the editor unlocks it into absolute positioning:

1. Capture its current box relative to the appropriate positioned ancestor.
2. Write inline `position`, `top`, `left`, `width`, and `height`.
3. Freeze affected layout siblings/containers where needed so nearby content does not jump.
4. Show a short unlock toast/badge.
5. Record the whole operation as one undoable transaction.

This is more complex than the original v1 sketch because real slide layouts use nested flex/grid structures. The behaviour is correct only if undo restores both the moved element and any touched containers without leaving stale selected DOM references.

## Inspector

The inspector is an editor-owned control panel bound to `state.selected`. It writes directly to inline styles using DOM style APIs, not string replacement. Controls should commit predictable atomic history entries:

- Numeric position and size controls.
- Font-size controls.
- Typography weight/align segmented controls (v2.10).
- Colour controls.
- Opacity.
- Reset inline styles to the pre-edit original (`state.originalStyles`
  WeakMap, recorded at each element's first committed transaction in
  `endTxn`).
- Agent note save/delete.

The inspector stays under `#wfp-editor-root`, uses editor-scoped CSS, and must not be exported.

Since the v2.10 "Ink Glass" refresh (design 3b, `feature-briefs/v2-ink-glass-ui.md`), the toolbar and inspector form one two-segment instrument in the top-right corner: the panel lives inside a `.wfpe-inspector-dock` wrapper fixed 1px below the 36px icon-only bar, and selection drives `data-visible` on the dock plus `data-docked` on the toolbar (corner morph) together in `refreshInspector()`. Minimise folds `.wfpe-inspector-fold` via `grid-template-rows`; the bar itself can collapse to 58px via `state.toolbarCollapsed`. Both surfaces use a scheme-invariant dark "ink" glass — there are no `prefers-color-scheme` variants for editor chrome.

The v2.12 adaptive fade (design 7, `feature-briefs/v2.12-adaptive-inspector.md`, module `src/editor/85-adaptive-fade.js`) makes the docked panel get out of the way by itself: any live manipulation — drag-move, resize, font scrub/steppers, opacity slider, weight/align commits, inline text edit — sets `data-fade="true"` on `.wfpe-inspector` (opacity 0.16, pointer-events kept) and pins the coral `.wfpe-scrub-tag` value chip to the selection, restoring ~380ms after the gesture settles. The fade is overlap-gated: it only applies when the selection's bounding box intersects the inspector's live rect, re-tested on every move of a drag/resize and on every `input` of a text edit. The value tag shows regardless of overlap and display-suppresses the v2.2 dim bubble while visible (the bubble's `textContent` keeps tracking). The FONT field is scrubbable — drag left/right for ~1px per 3px, one history entry per gesture; a clean click still focuses the input for typed commits. The toolbar never fades.

## Overview Mode

Overview mode is a temporary editor surface for slide-level changes.

Current approach:

- Toggle a body/editor state flag.
- Use scoped editor CSS to render slides as a thumbnail grid.
- Add overlay thumbnail chrome from `#wfp-editor-root`.
- Keep normal slide DOM as the source of truth.
- Reorder actual `.slide` elements in `.deck`.
- Delete actual `.slide` elements from `.deck`.
- Insert new blank `.slide` elements in `.deck`.
- Restore normal slide view on exit and on export.

Overview changes are real deck mutations. After reorder/delete, the editor cannot rely on the fixture's original slide index closure always matching the live DOM, so editor navigation paths must account for mutated order.

### Editor-owned slide-state synchronization

`synchronizeSlideState` is the single activation boundary once the editor owns
navigation. Overview thumbnail navigation, reorder/delete/insert (including
undo/redo), fresh-DOM arrow navigation, and live-refresh restoration all route
through it. The helper resolves the active index from the current live slide
list, keeps exactly one slide active, and updates contract-deck
`.progress-dot` state.

Foreign counters are capability/pattern based rather than tied to a fixture
global or host script. A host node must expose a semantic slide/page
count/counter hook and either contain a validated text-only `N / N` or
`N of N` shape, or expose validated numeric current/total children. This lets
the editor update current and total without calling stale host closures,
rewriting fixture scripts, flattening authored counter markup, or touching
unrecognized host UI. The synchronizer is not run at boot: until an
editor-owned activation, mutation, or refresh handoff occurs, native deck
navigation remains solely host-owned.

## Export Approach

The editor currently uses live-DOM serialization:

1. Clone `document.documentElement`.
2. Remove `#wfp-editor-root`.
3. Remove editor script tags.
4. Strip `data-wfp-edit-*` attributes.
5. Remove transient editor state such as `contenteditable` and overview/edit flags.
6. Serialize with a `<!DOCTYPE html>` prefix.
7. Download the result.

This approach is pragmatic and has test coverage. A more surgical source-patch export remains a possible future architecture if whitespace/comment preservation becomes important.

Normal export remains the production-clean artifact and strips all `data-wfp-edit-*` attributes, including live annotation markers. Agent handoff export runs the same cleanup path, then deliberately adds a narrow handoff layer:

- `data-wfp-agent-annotation-id` on annotated target elements.
- `script[type="application/json"][data-wfp-agent-annotations]` with user-authored instructions and target context.
- A short HTML comment pointing agents to the metadata.

The handoff layer is structured metadata, not a hidden prompt. When the editor is injected into a handoff export, matching `data-wfp-agent-annotation-id` targets are rehydrated back into live `data-wfp-edit-annotation-*` attributes and stale unmatched metadata is ignored.

## Save-in-place (v2.11)

**Decision:** Export's primary action writes over the source file on disk via the File System Access API (`showSaveFilePicker` / `FileSystemFileHandle`), rather than only ever downloading a new file.

Alternatives considered:

- A dev-server write endpoint (`localhost` PUT). Rejected — the target workflow is local `file://` decks with no server involved.
- Download-only export. Rejected as the primary path — the download loop (Cmd+S → `~/Downloads` → manually move/re-upload so an agent can see the edit) was the actual pain point motivating this feature. It stays live as the Safari/Firefox fallback and as the always-download "Clean copy" menu row.

### Handle lifecycle

A `FileSystemFileHandle` is the editor's only reference to the on-disk save target. Its lifecycle:

1. **Bind via the picker.** The first save in a session with no bound handle calls `showSaveFilePicker` directly from the click/keydown handler. Whatever file the user picks — typically the source file, but a new name is an intentional free "save as" branch — becomes the bound handle: held in memory (`boundFileHandle`) and persisted to IndexedDB (database `wfp-editor`, object store `handles`, keyed by `location.href`).
2. **Reuse in memory.** Every later save in the same session writes to the in-memory handle silently: `queryPermission` → (`requestPermission` if needed) → `createWritable` → `write` → `close`, no dialog.
3. **Rehydration-await on first save after reload.** On load, if the FSA API is present, the editor kicks off an async IndexedDB lookup (`loadStoredHandle`) for a handle keyed by the current URL and stashes it in `boundFileHandle` once found. That lookup is async, and a save can fire before it resolves, so `saveInPlace()` captures the lookup promise (`handleRehydration`) and awaits it — but only when no handle is bound yet — so an early save reuses the rehydrated handle instead of racing it into a redundant fresh picker.
4. **Re-grant on reload.** A rehydrated handle has lost its write permission across the reload — the browser's security floor, not a bug. `ensureHandleWritable` calls `queryPermission` and, if the result isn't `'granted'`, `requestPermission` — one click, no new picker.
5. **Forget-and-repick on stale.** If a write throws (the bound file was moved, renamed, or deleted), the editor drops the handle from memory and IndexedDB (`forgetBoundHandle`) and calls `showSaveFilePicker` again within the same gesture, retrying the write once. A second failure surfaces a toast instead of looping.
6. **Cancel.** An `AbortError` from `showSaveFilePicker` (the user closed the dialog) performs no write and shows "Save cancelled.". A first-save or reload-path cancel leaves all state untouched; cancelling the *retry* picker of a forget-and-repick does not restore the already-forgotten stale handle — the next save starts from the picker, which is the desired outcome for a handle known to be bad.

### The user-gesture constraint

`showSaveFilePicker` only works while the browser still considers the current event a live user gesture (transient activation). The call path from click/keydown to `showSaveFilePicker` must therefore not contain an unrelated `await` first — any intervening microtask/macrotask can burn the activation window and turn the picker call into a silent rejection. `saveInPlace()` is deliberately not awaited by its own click/keydown handler for the same reason: it must run synchronously up to the picker/write call within that turn.

The one sanctioned exception is the `handleRehydration` await from Decision 3 above: it resolves on a millisecond timescale (a same-origin IndexedDB read against a tiny store), and it only runs at all when no handle is already bound. It is intentionally the single await allowed to stand between "user pressed Cmd+S" and "the picker/write call fires" — no other async work belongs in that path.

### Why storage failures are swallowed

`loadStoredHandle`, `storeBoundHandle`, and `forgetBoundHandle` each wrap their IndexedDB calls in `try/catch` and resolve or return quietly on failure — a full `indexedDB.open` failure, a blocked version upgrade, a private-browsing quota wall, and similar cases all degrade the same way. Persistence is an optimisation — it turns a would-be picker into a one-click re-grant — and must never be a gate: when the browser cannot store or retrieve the handle, `saveInPlace()` still writes correctly, by falling through to a fresh `showSaveFilePicker` call on the next save. A user should never see a save fail because `indexedDB.open` failed.

### Fallback

Feature-detected once via `canSaveInPlace()` (`typeof window.showSaveFilePicker === 'function'`). Safari and Firefox lack the API entirely, so row 1 downgrades to the download behaviour Export already had (`<name>-edited.html` / `<name>-agent-handoff.html`) — no handle, no IndexedDB, no user-gesture care beyond what a normal download already requires. The distinction is surfaced to the user only through the menu sublabel (" — Downloads"), not through different content: both paths reuse the same `buildExportHtml`/`buildHandoffExportHtml` pipelines described above.

## Live Agent Round-trip (v2.13)

### Why document.open()/write() instead of a reload

A reload loses the editor (injected scripts do not survive navigation), costs a file-access re-grant, and drops the user's position. `document.open()/write()/close()` replaces the Document's contents inside the same window and realm: window globals survive — which is what carries the `FileSystemFileHandle` across generations with no re-pick — while document-level listeners are erased, killing the deck's stale nav closures and the previous editor instance's key handling in one move (Chromium erases window-level listeners too; the pre-swap `removeEventListener` calls are belt and braces). Scripts in the written HTML execute exactly once against the new DOM. The old instance then re-injects the editor script captured at boot — `src` for bookmarklet loads, inline text for dev/Playwright injection — and the duplicate-mount guard passes because saved files never contain editor chrome.

### Generations

Each boot increments `window.__wfpEditorGeneration`. A refresh is a generation boundary: fresh state, fresh listeners, fresh undo history — deliberate, since the document itself changed underneath the history's DOM references. Continuity travels in a single window-scoped restore payload (file handle, mtime baseline, edit mode, active slide index, inspector/toolbar fold state) that the new instance adopts at ready. Adoption restores the active index through the shared slide-state synchronizer (including progress dots and recognized host counters) and sets `state.deckMutated`, reusing the existing fresh-DOM arrow-nav takeover: the re-parsed deck script cached slide 0 as current, which is precisely the staleness that mechanism was built for.

### Watch discipline

The watcher polls `getFile().lastModified` (~1.2s). Three rules keep it predictable. The editor's own saves pause the watcher and rebase its baseline afterwards, so a save never reads as an agent write. The baseline advances only on a successful swap, so a refresh deferred by an open interaction (transaction, text edit, drag, resize, Overview, export menu) retries on the next idle tick instead of being dropped. Permission failures announce "paused" exactly once and the next successful save announces "resumed" — the dormant flag gates the announcements, not the mechanism, so a silently recovered handle still refreshes.

### Results reconciliation

The handoff guidance asks agents to record per-annotation outcomes in `script[data-wfp-agent-results]` (`{id, status: done|skipped|needs-input, note}`), removing metadata for done items and keeping it otherwise so notes stay anchored. Import reconciles defensively: a done result resolves its annotation even when a sloppy agent leaves metadata behind (this closes the old stale-reimport hole), skipped/needs-input replies re-import as open notes carrying `data-wfp-edit-annotation-status`/`-reply` (rendered as amber/slate badges and a read-only inspector line), and annotations without a result import unchanged for agents that ignore the contract. The parsed summary lands on `state.agentResultsSummary` — on `state` rather than a module `let` because reimport runs during an earlier fragment's top-level evaluation, where a later fragment's `let` binding would still be in its temporal dead zone — and the ready block toasts it once.

## Handoff Ground Truth (v2.14)

Handoff payloads carry two additive sections — an `edits` ledger (per user-touched element: pristine `before` vs current `after` inline style, `mechanical` labelling, and measurements) and the same `box`/`computed`/`overflow` measurements on every annotation. Clean exports are untouched, the payload stays `version: 1`, and reimport ignores `edits` entirely (agent-facing context, never restorable state).

### WeakMap → Set for ledger enumeration

`state.originalStyles` (the pristine pre-edit style Reset already relies on) is a WeakMap and cannot be enumerated, so `endTxn()` also records every changed element in `state.editedElements` — a plain `Set`, session-scoped and never pruned. Holding strong references is deliberate and cheap at slide-deck scale; the ledger build filters instead: disconnected elements, editor chrome, and elements whose `before` equals their current style (edited then fully undone) are skipped at handoff-build time.

### Transient stamping

Ledger entries anchor to exported elements via `data-wfp-agent-edit-id`, but the live DOM must never retain it. The build stamps the live elements, clones the document, then unstamps in a `finally` — all synchronous, so no observer or export can see the stamp outside the build. Because the stale-residue cleanup (`removeHandoffArtifacts`) now also strips `data-wfp-agent-edit-id` (covering reimports of agent-processed files that left anchors behind), the clone's fresh stamps are captured before that pass and re-applied after it — the same "re-add agent attrs after cleanup" order annotation targets use. Measurements (`getSlideBox` for scale-normalised boxes, a fixed computed-style set, an overflow flag) are always read from the live elements: the clone is never laid out.

### Mechanical labelling

Unlock/freeze pinning writes inline styles the user never asked for, and it stamps the *dragged* element with the same `data-wfp-edit-frozen` marker as its pinned siblings — attribute presence alone cannot separate editor mechanics from user intent, and the pin and the user's move commit inside one transaction, so history cannot either. `state.pinnedStyles` (WeakMap) records each element's inline style exactly as the pin wrote it; a ledger entry is `mechanical: true` only while its element carries a frozen marker *and* its style still equals that record. The moment the user drags, resizes, or restyles a pinned element, its style diverges and the entry reads as user intent. The guidance tells agents mechanical entries preserve layout and are not requests.

### Overflow heuristic (and its two known blind spots)

`measureElementOverflow` reports `true` in two ways: content clipping (`scrollWidth`/`scrollHeight` past the client box) or the element's rect escaping its parent's rect. Two v2.14.1 corrections keep it from crying wolf on ordinary edits:

- **Frozen parent is not a boundary.** Flow-unlock pins the parent to its *pre-drag* footprint (`data-wfp-edit-frozen`/`-flex-frozen`), so a child deliberately dragged out of that stale box would trip the parent-escape check. The check is skipped when the element or its parent carries a freeze marker. The content-clipping branch still runs first, so a frozen element that genuinely clips its own content is still reported. *Residual tradeoff:* if a flow-unlock parent ever kept `overflow: hidden`, a child dragged past it would be visually clipped yet report `false` — accepted, because flow-unlock exists to reposition freely and a clipping unlock parent would be a visibly broken feature caught elsewhere.
- **Descenders are not clipping.** Sub-1 line-height display text paints glyph descenders a few px below the content box, edging `scrollHeight` past `clientHeight` with nothing hidden. The vertical comparison allows slop of `max(1, fontSize * 0.25)`; a genuinely clipped line adds roughly a full `fontSize`, far above that floor, so real clipping is still caught. Horizontal tolerance stays `+1` (descenders are vertical). *Residual tradeoff:* partial bottom clipping under a quarter-em can hide.

## Inline-style Merging

Many slide elements already carry inline styles for animation and layout. Editor writes must use DOM style APIs:

```javascript
el.style.left = `${nextLeft}px`;
el.style.fontSize = `${nextFontSize}px`;
```

Avoid wholesale `style` attribute writes during normal edits. Whole-attribute writes are acceptable only for undo/redo restore paths where the snapshot intentionally captured the full previous inline style.

## Editor DOM Containment

All editor-owned DOM mounts under:

```html
<div id="wfp-editor-root"></div>
```

Editor CSS is scoped through that root or through explicit editor state attributes on `body`. Export cleanup depends on this containment. Do not scatter editor UI into slide markup unless the export scrubber is updated and tested.

## Keyboard Handling

The editor coexists with slide-level keyboard listeners:

- Edit mode off and Overview off: pass through normal slide keys.
- Edit mode on: capture editor keys and stop propagation for relevant controls.
- Overview mode on: capture overview keys for exit/delete/undo/redo/navigation actions.
- Inline text edit: allow text input while still handling commit/cancel keys.

Existing slide decks often register keyboard listeners on `document`, so editor handlers must run in capture phase for keys they own.

## File Structure Direction

Current deployment:

```text
editor.js       # Deployed editor runtime; currently single-file and oversized.
```

Current internal sections include:

1. Constants, icons, and CSS.
2. State and initialization.
3. DOM helpers and slide helpers.
4. Selection overlays.
5. Drag/resize/unlock.
6. Inspector.
7. History.
8. Text edit.
9. Overview.
10. Export (clean/handoff pipelines, action menu, save-in-place engine).
11. Bookmarklet/runtime initialization.

The next refactor should clarify these boundaries. It may first do that within the single file using stronger section APIs, then consider physical source splitting if that can be done without making deployment fragile.

## What We Do Not Optimize For

- Mobile/touch editing.
- Real-time collaboration.
- Heavy-DOM performance beyond typical slide decks.
- Offline hosted-editor use.
- A general-purpose slide authoring environment.
