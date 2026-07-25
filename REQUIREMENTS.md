# Requirements: Current Product Contract (v2.14)

## Goal

Ship a bookmarklet-activated editor that lets a user polish WFP HTML slide decks directly in the browser:

- Move and resize existing elements on the active slide.
- Multi-select active-slide elements and move them together.
- Edit text inline.
- Adjust typography, colour, opacity, position, and size through an inspector.
- Copy, paste, and duplicate selected elements within the current editing session.
- Reorder and delete slides in Overview mode.
- Insert blank slides from Overview mode.
- Add selected-element agent annotations for focused cleanup handoff.
- Export clean standalone HTML that preserves the user's edits and removes all editor chrome.
- Export annotated agent-handoff HTML as a separate, explicit artifact.
- Watch the saved file and refresh in place when an agent rewrites it, reconciling per-note outcomes.
- Give agents ground truth in handoff exports: a ledger of the user's manual edits plus rendered-geometry measurements neither can reconstruct from raw HTML.

This file is the current product contract. `TASKS.md` and `feature-briefs/` are historical build records.

## Activation Model

- The editor is loaded by a bookmarklet that injects a hosted `editor.js`.
- The bookmarklet works on local `file://` slide decks and served HTML files.
- On load, the editor mounts its UI but does not enter edit mode automatically.
- Press `E` or click the Edit toolbar button to toggle element edit mode.
- Press `O` or click the Overview toolbar button to toggle Overview mode.
- When edit mode and Overview mode are off, the slide behaves as it would without the editor loaded.
- When edit mode is on, slide keyboard navigation is suppressed so editor keys take precedence.
- When Overview mode is on, the deck is shown as a thumbnail grid for slide-level operations.

## Shipped Features

### Toolbar

- Fixed ink-glass toolbar mounted under `#wfp-editor-root`.
- Controls: Edit, Overview, Export, Undo, Redo.
- Toolbar controls never become slide selection targets.
- All editor UI is removed from exported HTML.

### Element Selection

- Click any selectable descendant of `.slide.active` to select it.
- A visible selection ring, resize handles, dimension bubble, and inspector bind to the selected element.
- Clicking the slide canvas deselects.
- The editor does not select `.deck`, `.slide`, or anything inside `#wfp-editor-root`.
- Selection only operates on the active slide.
- Cmd/Ctrl-click toggles active-slide elements into or out of a multi-selection.
- Multi-selection displays one group box plus per-element outlines.
- Plain click returns to single-element selection.
- Selection clears when the slide canvas is clicked, edit mode exits, Overview mode starts, or the active slide changes.
- Ancestor/descendant pairs are not both kept in a multi-selection; the latest clicked target wins.

### Drag and Resize

- Drag a selected element to move it.
- Drag any member of a multi-selection to move all selected elements together.
- Multi-selection movement is one undoable history entry.
- Resize with the eight handles around the selection ring.
- Drag and resize deltas must be divided by the current `.deck` transform scale before writing slide-coordinate styles.
- Existing inline styles must be preserved and merged with editor-written styles.
- Flow-positioned elements can be unlocked into absolute positioning when dragged.
- Unlocking protects affected siblings and layout containers so nearby content does not shift unexpectedly.
- Unlock conversion and the drag/resize operation are undoable.
- Resize handles, the inspector, and dimension bubble are hidden while multiple elements are selected.

### Inspector

The inspector is visible when an element is selected and supports:

- X/Y position controls.
- Width/height controls.
- Font-size controls for text-bearing elements. The font value field is
  scrubbable (v2.12): dragging left/right changes size ~1px per 3px with one
  history entry per gesture; a plain click focuses the field for a typed
  exact value.
- Text colour and background colour controls.
- Opacity controls.
- Reset the selected element's inline styles to their pre-edit originals
  (the `style` attribute captured at the element's first editor change —
  clearing the attribute outright is wrong because decks author
  position/size inline). For a flow-unlocked element, Reset atomically
  restores its unlock group to the recorded pre-unlock styles and removes
  obsolete freeze markers. Mechanically pinned members are restored only
  while their inline style still matches the editor-recorded pin; a sibling
  deliberately edited later is preserved, together with any pinned container
  it still needs as a positioning context. Nested unlocks use latest-active
  ownership: an older group cannot restore a member or container still needed
  by a newer group. Undoing an unlock or completing a full group reset retires
  that group's Reset provenance (undo/redo also round-trips this lifecycle), so
  later ordinary edits reset to the pristine pre-edit original. No-op if the
  editor never changed the element.
- Duplicate selected element.
- Delete selected element.
- Agent note save/delete for focused handoff annotations.
- Minimise/expand state remembered within the editor session.

Inspector clicks must not accidentally select slide content or end inline text editing unless that is the intended control behaviour.

### Adaptive Inspector Fade (v2.12)

- During any live manipulation (drag-move, resize, font scrub or ± steps,
  opacity slider, weight/align commit, inline text edit) the inspector fades
  to a whisper while keeping pointer events, and restores ~380ms after the
  gesture settles. An open text edit holds the fade until it commits.
- The fade only applies when the selection's bounding box intersects the
  inspector's on-screen rectangle. The check runs per gesture and re-runs on
  every move, so dragging under the panel fades it mid-gesture and dragging
  back out restores it.
- A coral value tag pinned to the selection shows live feedback (`N px`,
  `X/Y`, `W × H`, `N %`, weight/align label) whether or not the panel fades.
  While the tag is visible it replaces the dimension bubble.
- The toolbar never fades.

### Font Size Keyboard Controls

- With a text element selected, Up/Down nudge font size by 1px.
- Shift+Up / Shift+Down nudge by 5px.
- The current computed font size is read and written back as an inline `font-size`.
- Minimum font size is 8px.

### Inline Text Editing

- Double-click a text-bearing element to enter text-edit mode.
- The selected element receives `contenteditable="true"` for the duration of the edit.
- Escape, Tab, or clicking outside the edit target exits text-edit mode and commits the edit.
- Existing inline HTML inside the element, such as `<br>` and nested spans, must be preserved.
- Text edits are undoable as a single history entry.

### Element Copy/Paste/Duplicate/Delete

- Cmd/Ctrl+C while an element is selected copies a session-only serialized clone.
- Cmd/Ctrl+C while inline text editing is active must fall through to normal browser text copy.
- Cmd/Ctrl+V in normal slide view pastes the copied element into `.slide.active`.
- Pasted elements are offset by 20px on both axes from the copied element's slide coordinates.
- Pasted elements preserve source inline styles and become the selected element.
- Inspector Duplicate performs the same copy-then-paste behavior on the active slide.
- Backspace/Delete or Inspector Delete removes the selected element from the active slide.
- Duplicate/Delete from the inspector commits any open inline text edit before performing the structural action.
- Element paste/duplicate is undoable and redoable as a structural insert.
- Element delete is undoable and redoable as a structural removal.
- Element clipboard state is not integrated with the system clipboard and does not persist across reloads.
- Multi-selected elements do not copy, paste, duplicate, delete, resize, or receive inspector edits as a group in the first multi-select release.

### Undo and Redo

- Cmd/Ctrl+Z undoes the last change.
- Cmd/Ctrl+Shift+Z or Cmd/Ctrl+Y redoes.
- Atomic actions are one history entry: drag, multi-selection drag, resize, font-size nudge, inspector commit, flow-unlock group reset, annotation save/delete, text edit, element insert/delete, slide reorder, slide delete.
- History persists for the current page session only.
- History must support at least 50 entries.

### Overview Mode

- Overview mode displays all slides in a grid without permanently wrapping or cloning the slide deck.
- Thumbnail grid uses the v2 ink-glass visual language.
- Click a thumbnail to make that slide active and return to normal slide view.
- After thumbnail navigation, the editor owns subsequent plain-view arrows
  using the live slide list; it does not defer to a host cursor that the
  thumbnail activation could not update.
- Drag thumbnails to reorder slides.
- Delete a slide from its thumbnail `x` button, or with Backspace/Delete when a thumbnail delete target is active.
- Insert a blank slide using the `+` affordances before, between, and after thumbnails.
- Deleting the last remaining slide is blocked with a toast.
- If the active slide is deleted, the editor activates the next slide at that position, or the new last slide.
- Slide reorder, slide delete, and slide insert are undoable and redoable.
- Once the editor owns slide navigation after an Overview mutation or live
  refresh, every activation keeps the contract deck's existing progress-dot
  active state aligned with the active slide and synchronizes recognized host
  current/total counters with the live slide index and count. Host counters are
  updated only when they expose a semantic slide/page counter hook and a
  supported counter shape; unrelated host UI is untouched.
- Exported HTML opens in normal slide view, not Overview mode.
- Export startup normalization aligns recognized host current/total counters
  with the exported first active slide and live exported slide count.

### Export

- A single Export toolbar button carries a count badge showing the number of connected agent annotations; the badge is hidden when the count is zero.
- Clicking Export opens a two-row action menu anchored under the toolbar. Escape or a click outside the menu closes it with no side effects.
- Row 1 is the primary, recommended action (marked `↵` in the menu). Cmd/Ctrl+S always dispatches row 1, whether or not the menu is open; Enter dispatches row 1 while the menu is open, unless a menu row holds keyboard focus, in which case Enter activates the focused row.
  - With one or more agent annotations: label "Annotated copy", sublabel "Includes N agent note(s)". The action content is the handoff HTML pipeline (cleanup pass plus handoff metadata).
  - With zero agent annotations: label "Save", sublabel "Edits only". The action content is the clean HTML pipeline (no annotation metadata).
  - Row 1 is never disabled — the zero-annotation state degrades to a plain save instead of being blocked.
- In browsers that implement the File System Access API (current Chrome, Edge, Arc), row 1 writes the chosen content over a file on disk instead of downloading it:
  - No file bound yet: a native save-file picker opens, suggesting the deck's own filename; whichever file the user picks becomes the bound file for the rest of the session.
  - A file is already bound: the write happens silently, with no dialog.
  - The bound file is remembered across a page reload; the next save after a reload costs one click to re-grant file access, not a fresh picker. Declining the re-grant performs no write and shows "Save cancelled — file access not granted.".
  - If the bound file becomes unwritable (moved, renamed, or deleted), the editor drops it and reopens the picker within the same action, retrying the write once.
  - Cancelling the picker performs no write and shows a "Save cancelled." toast.
  - A successful save toasts the actual written filename, e.g. "Saved deck.html" or "Saved deck.html — 3 agent notes".
- In browsers without the File System Access API (Safari, Firefox), row 1 downloads instead of writing to disk: zero notes downloads `<original-name>-edited.html`; one or more notes downloads `<original-name>-agent-handoff.html` — the same destinations as the prior release. Row 1's sublabel is suffixed " — Downloads" in this mode so the destination is never a surprise.
- Row 2 ("Clean copy") always downloads `<original-name>-edited.html` from the clean pipeline, in every browser, regardless of annotation count or File System Access availability. Its sublabel reads "Edits only — notes stripped" when annotations exist, or "Download a copy" when there are none.
- Export must preserve:
  - DOCTYPE, head, scripts, styles, and unchanged slide content.
  - Element style and text edits.
  - Pasted elements.
  - Slide order changes.
  - Slide deletions.
  - Inserted blank slides.
- Export must remove:
  - `#wfp-editor-root`.
  - Editor script tags.
  - `data-wfp-edit-*` markers.
  - `contenteditable`.
  - Body/editor state attributes such as overview/edit-mode flags.
  - Selection rings, handles, toasts, overlays, and thumbnail chrome.

### Agent Handoff Export

- An Agent note can be attached to exactly one selected element.
- Live annotation markers use `data-wfp-edit-annotation-id` and `data-wfp-edit-annotation-text`.
- Saved annotations show an editor-only peach circular marker on the target element while edit mode is on.
- The Agent note row makes saved vs unsaved draft state visible.
- Annotation count drives the Export button's badge and the Export menu's row-1 label/sublabel (see `### Export`); there is no separate Handoff control.
- Handoff export uses the normal cleanup pipeline, then intentionally adds:
  - `data-wfp-agent-annotation-id` markers on annotated targets.
  - `script[type="application/json"][data-wfp-agent-annotations]` metadata.
  - A short HTML comment identifying the metadata as user-authored handoff annotations.
- Handoff metadata must be structured task context, not a hidden prompt that attempts to override agent/system/user instructions.
- Re-injecting the editor into handoff HTML restores matching annotations into live editor annotation markers.
- Normal export after reimport must strip all handoff metadata.
- The embedded guidance documents the agent results contract (v2.13): agents record per-annotation outcomes in a `script[type="application/json"][data-wfp-agent-results]` block as `{id, status: done|skipped|needs-input, note}`, remove annotation metadata for done items, and keep it for skipped/needs-input items so those notes stay anchored.
- On any load of an agent-processed file, the editor reconciles results: a done result resolves its note even when the agent left the metadata behind (stale annotations never re-import); skipped/needs-input results re-import as open notes carrying the agent's reply; annotations without a result entry import unchanged.
- Replied notes render distinctly: the badge is amber for needs-input and slate for skipped (title includes the reply), and the inspector's Agent note row shows a read-only "Agent …" line.
- Saving a new instruction or deleting a note clears the agent status/reply in the same undoable history entry.
- A reconciliation summary (e.g. "Agent update: 2 done, 1 needs input.") is toasted once at ready whenever results were parsed.
- All handoff artifacts, the results block included, are stripped from the live DOM after import and by both export pipelines.

### Handoff Ground Truth (v2.14)

- Handoff payloads additionally carry an `edits` ledger: one entry per user-touched element whose inline style differs from its pristine pre-edit value — `{id, tag, slideIndex, targetText, before, after, mechanical, box, computed, overflow}`.
- `before` is the element's pristine inline style at its first committed change (`null` when it had none); `after` is the current inline style. Elements edited then fully undone, disconnected elements, and anything inside the editor root produce no entry.
- The matching exported element carries a `data-wfp-agent-edit-id` anchor equal to the entry id. The live document holds that attribute only transiently during the handoff build and never after a save.
- `mechanical: true` labels editor-written unlock/freeze pinning (a frozen-marked element whose inline style is still exactly what the pin wrote). An element the user then moved, resized, or restyled reads as user intent (`mechanical: false`) even though the freeze stamped it.
- Every annotation entry and ledger entry carries measurements taken from the live document at build time: a slide-relative, scale-normalised `box` (values rounded to 1 decimal), a fixed `computed` set (`fontSize`, `fontWeight`, `color`, `backgroundColor`, `position`), and an `overflow` flag — true when content overflows the element's own box by more than 1px or its rect escapes its parent's rect by more than 1px on any edge.
- The embedded guidance says ledger entries are the user's intentional manual changes — preserve them unless an annotation explicitly asks otherwise — and that mechanical entries are layout pinning, not requests. The ledger is context, never instructions.
- Reimport ignores `edits` entirely and strips leftover `data-wfp-agent-edit-id` attrs from the live DOM at boot. Clean exports carry neither ledger entries nor edit ids.
- The payload stays `version: 1`; the additions are additive and omitted-field-tolerant for downstream readers.
- Out of scope for ledger v1: slide reorder/insert/delete intent and text-content before/after.

### Live Agent Round-trip

- In File System Access browsers with a bound save file, the editor polls the file (about every 1.2 seconds) and refreshes the document in place when it changes externally — no reload, no bookmarklet re-click, no permission re-grant.
- The refresh replaces the document wholesale, re-executes the deck's own scripts exactly once against the new markup, and re-mounts the editor.
- Restored across a refresh: edit mode, active slide (index clamped to the new deck), inspector minimised state, toolbar collapsed state, and the bound file handle. Selection is cleared, and undo history restarts — a refresh is a new history generation.
- After a refresh the editor owns plain-view arrow navigation (the same takeover used after slide reorder/delete), because the deck script's cached slide state reset to the first slide.
- Restoring the active slide after refresh uses the same slide-state
  synchronization as editor-owned arrow navigation, including progress-dot
  active state and recognized host current/total counters.
- A refresh never interrupts an open interaction (transaction, text edit, drag, resize, Overview mode, or open export menu); the change applies on the next idle poll after the interaction ends.
- The editor's own saves never trigger a refresh.
- If reading the bound file fails for permissions, one toast announces "Live updates paused — file access needed. Save to re-link."; the next successful save re-links the watch and toasts "Live updates resumed.".
- Browsers without the File System Access API keep the existing manual flow; nothing changes for them.

## Constraints From WFP Slides

- Presentations are single HTML files containing `.slide` elements inside `.deck`.
- Only `.slide.active` is visible in normal slide view.
- Canvas is fixed at 1920x1080 and scaled via `transform: scale()` on `.deck`.
- Existing keyboard handlers navigate with ArrowLeft/ArrowRight/Space and may also support touch swipe.
- Many elements already use absolute positioning; many text/layout elements use flex or flow layout inside positioned parents.
- Slides use CSS variables, animations, pseudo-elements, and existing inline styles.
- The editor must not alter how fixtures render when it is not loaded.

## Browser Support

- Current Chrome, Edge, Safari, Firefox, and Arc.
- Desktop browser support only. Mobile/touch editing is not targeted.

## Bookmarklet Payload

The bookmarklet itself stays small and only injects `editor.js`. All real logic lives in `editor.js`.

Template:

```javascript
javascript:(function(){var s=document.createElement('script');s.src='https://[user].github.io/wfp-slide-editor/editor.js?'+Date.now();document.body.appendChild(s);})();
```

The cache-buster ensures the next bookmarklet click fetches the latest hosted editor.

## Current Non-goals

These are not part of the current product contract. Add them to `ROADMAP.md` or a feature brief before building.

- Marquee/lasso selection.
- Layers panel or z-order controls.
- Snap-to-grid or alignment guides.
- Aspect-ratio locking on resize.
- Persistence across reloads or localStorage autosave.
- Group/ungroup operations.
- Animation or transition editing.
- Adding new elements.
- Asset replacement.
- Theme variable editing.
- Overview search/filter or duplicate slide.
- Text-range annotations, slide-level annotations, pins, comments panel, or hidden agent prompts.
- Mobile/touch editing.

## Known Quality Work

The inspector and Overview feature set is shipped, but the codebase now needs a maintainability pass before broad feature expansion. Track that work in `REFACTOR-MAINTAINABILITY.md`.
