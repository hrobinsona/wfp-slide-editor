# Design

This document captures architectural decisions and the reasoning behind them. For current product scope, read `REQUIREMENTS.md`. For upcoming cleanup work, read `REFACTOR-MAINTAINABILITY.md`.

## Current Status

The shipped editor is v2.2: v1 element editing, v2 inspector, v2.1 Overview mode, and v2.2 element copy/paste plus Overview blank-slide insertion are all in `editor.js`.

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
- `editingText` for inline text editing.
- `history` and `historyIndex` for undo/redo.
- `clipboard` for session-only serialized element copy/paste.
- `inspectorMinimised` for session-only inspector UI state.
- `deckMutated` for cases where Overview has reordered or deleted slides and the editor must own navigation state.

This state is intentionally session-only. Reloading the page discards it unless the user exported HTML.

## Selection Model

**Decision:** Single-element selection.

The selected element is tracked by DOM reference. A separate selection ring, handle set, dimension bubble, and inspector reflect the current selected element. The target element is not given editor-only classes for selection styling, which keeps export cleanup straightforward.

Selection is only valid while the target remains connected to the document. History restore paths must either preserve selected nodes or clear/re-resolve selection when a selected node is recreated.

## Element Conversion to Absolute Positioning

When a user drags a flow-positioned element, the editor unlocks it into absolute positioning:

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
- Colour controls.
- Opacity.
- Reset inline styles.

The inspector stays under `#wfp-editor-root`, uses editor-scoped CSS, and must not be exported.

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
10. Export.
11. Bookmarklet/runtime initialization.

The next refactor should clarify these boundaries. It may first do that within the single file using stronger section APIs, then consider physical source splitting if that can be done without making deployment fragile.

## What We Do Not Optimize For

- Mobile/touch editing.
- Real-time collaboration.
- Heavy-DOM performance beyond typical slide decks.
- Offline hosted-editor use.
- A general-purpose slide authoring environment.
