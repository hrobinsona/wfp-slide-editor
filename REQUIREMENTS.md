# Requirements: Current Product Contract (v2.1)

## Goal

Ship a bookmarklet-activated editor that lets a user polish WFP HTML slide decks directly in the browser:

- Move and resize existing elements on the active slide.
- Edit text inline.
- Adjust typography, colour, opacity, position, and size through an inspector.
- Reorder and delete slides in Overview mode.
- Export clean standalone HTML that preserves the user's edits and removes all editor chrome.

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

- Fixed liquid-glass toolbar mounted under `#wfp-editor-root`.
- Controls: Edit, Overview, Export, Undo, Redo.
- Toolbar controls never become slide selection targets.
- All editor UI is removed from exported HTML.

### Element Selection

- Click any selectable descendant of `.slide.active` to select it.
- A visible selection ring, resize handles, dimension bubble, and inspector bind to the selected element.
- Clicking the slide canvas deselects.
- The editor does not select `.deck`, `.slide`, or anything inside `#wfp-editor-root`.
- Selection only operates on the active slide.

### Drag and Resize

- Drag a selected element to move it.
- Resize with the eight handles around the selection ring.
- Drag and resize deltas must be divided by the current `.deck` transform scale before writing slide-coordinate styles.
- Existing inline styles must be preserved and merged with editor-written styles.
- Flow-positioned elements can be unlocked into absolute positioning when dragged.
- Unlocking protects affected siblings and layout containers so nearby content does not shift unexpectedly.
- Unlock conversion and the drag/resize operation are undoable.

### Inspector

The inspector is visible when an element is selected and supports:

- X/Y position controls.
- Width/height controls.
- Font-size controls for text-bearing elements.
- Text colour and background colour controls.
- Opacity controls.
- Reset inline styles for the selected element.
- Minimise/expand state remembered within the editor session.

Inspector clicks must not accidentally select slide content or end inline text editing unless that is the intended control behaviour.

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

### Undo and Redo

- Cmd/Ctrl+Z undoes the last change.
- Cmd/Ctrl+Shift+Z or Cmd/Ctrl+Y redoes.
- Atomic actions are one history entry: drag, resize, font-size nudge, inspector commit, text edit, slide reorder, slide delete.
- History persists for the current page session only.
- History must support at least 50 entries.

### Overview Mode

- Overview mode displays all slides in a grid without permanently wrapping or cloning the slide deck.
- Thumbnail grid uses the v2 liquid-glass visual language.
- Click a thumbnail to make that slide active and return to normal slide view.
- Drag thumbnails to reorder slides.
- Delete a slide from its thumbnail `x` button, or with Backspace/Delete when a thumbnail delete target is active.
- Deleting the last remaining slide is blocked with a toast.
- If the active slide is deleted, the editor activates the next slide at that position, or the new last slide.
- Slide reorder and slide delete are undoable and redoable.
- Exported HTML opens in normal slide view, not Overview mode.

### Export

- Cmd/Ctrl+S or the Export toolbar button downloads `<original-name>-edited.html`.
- Export serializes the current live document after cleaning editor-only artifacts.
- Export must preserve:
  - DOCTYPE, head, scripts, styles, and unchanged slide content.
  - Element style and text edits.
  - Slide order changes.
  - Slide deletions.
- Export must remove:
  - `#wfp-editor-root`.
  - Editor script tags.
  - `data-wfp-edit-*` markers.
  - `contenteditable`.
  - Body/editor state attributes such as overview/edit-mode flags.
  - Selection rings, handles, toasts, overlays, and thumbnail chrome.

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

- Multi-select.
- Layers panel or z-order controls.
- Snap-to-grid or alignment guides.
- Aspect-ratio locking on resize.
- Persistence across reloads or localStorage autosave.
- Group/ungroup operations.
- Animation or transition editing.
- Adding new elements.
- Element deletion from normal edit mode.
- Cross-slide copy/paste.
- Asset replacement.
- Theme variable editing.
- Overview search/filter, duplicate slide, or add slide.
- Mobile/touch editing.

## Known Quality Work

The inspector and Overview feature set is shipped, but the codebase now needs a maintainability pass before broad feature expansion. Track that work in `REFACTOR-MAINTAINABILITY.md`.
