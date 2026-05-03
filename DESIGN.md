# Design

This document captures architectural decisions and the reasoning behind them. When in doubt about HOW to build something, this is the file. When in doubt about WHAT to build, see `REQUIREMENTS.md`.

## Why a bookmarklet (vs. browser extension, vs. embedded harness)

**Decision:** Bookmarklet that loads a hosted `editor.js`.

**Alternatives considered:**

- **Embedded harness in every slide.** Every working file ships with editor JS inline; you strip it before distributing. Rejected because it forces a two-mode mental model (working vs. shipped), and you have to remember to strip. Slides should be production-ready from the moment they're created.
- **Browser extension.** Powerful but heavyweight. Requires Chrome Web Store / Firefox Add-ons publication for clean install. Permission prompts. Cross-browser inconsistency. Overkill for a personal tool.
- **Bookmarklet that loads remote `editor.js`.** Chosen. The slide knows nothing about the editor. The editor evolves independently. The bookmarklet itself is ~100 chars; all real logic is hosted and updated centrally. Same pattern as Pinterest's "Save" button and Instapaper's "Read Later."

**Tradeoffs accepted:**

- Requires internet to load `editor.js` (acceptable; the user is at a desk).
- Some sites block `javascript:` URLs via Content Security Policy (not a concern for local file:// URLs or self-hosted slides).
- The cache-buster query param ensures always-latest, but means a network hit on every activation. Fine for our scale.

## Why no framework

**Decision:** Vanilla JavaScript.

The editor needs to be small, load fast, and not conflict with whatever the slide page is already running. A framework adds:

- Bundle size (React + ReactDOM = ~130KB minified)
- A potential conflict if a slide page somehow already had a React in scope
- Build tooling complexity (we want `editor.js` to be the source-of-truth, no compilation)

The editor has limited UI surface (toolbar, selection ring, resize handles, history). Vanilla DOM with small composable functions handles this without ceremony. State lives in a single plain object passed where needed.

## Why no build step

**Decision:** Source `editor.js` IS the deployed `editor.js`.

Build steps create distance between the code you read and the code that runs. For a tool this small, that distance isn't worth it. The bookmarklet loads `editor.js` directly from GitHub Pages. What you push is what runs.

If we ever need minification, we add it as an optional step (`npm run build`) that produces `editor.min.js` alongside, but the unminified version stays canonical.

## Hosting: GitHub Pages

**Decision:** Push to a public GitHub repo, enable Pages on the `main` branch.

**Alternatives considered:**

- **Cloudflare Pages, Vercel, Netlify** — all fine, slightly more setup, no real advantage for a static JS file.
- **A custom domain** — overkill for v1.
- **Local file URL in the bookmarklet** — works for one machine but breaks the "open any slide on any device" promise.

GitHub Pages is free, requires no separate account, and the URL is stable: `https://[username].github.io/wfp-slide-editor/editor.js`.

## Versioning strategy

**Decision (v1):** A single `editor.js` file. The bookmarklet always loads the latest.

**Decision (v2 onward):** When v2 introduces breaking changes to the export format or interaction model, freeze v1 as `editor-v1.js` (kept indefinitely) and ship v2 as the new `editor.js`. Document the bookmarklet for each pinned version. Slides edited with v1 keep working with v1; slides edited with v2 use v2.

This way old slides never lose their editor.

## Coordinate system and scale

This is the single most important implementation detail. WFP slides apply `transform: scale()` to a fixed-size 1920×1080 canvas to make it fit the viewport.

**Implication:** A user dragging an element 100 viewport pixels does NOT mean moving the element 100px in the slide's coordinate system. If the canvas is scaled to 0.5, the same drag is 200px in slide space.

**Pattern:** Every drag/resize handler must read the current scale and divide deltas:

```javascript
function getCanvasScale() {
  const deck = document.querySelector('.deck');
  const matrix = new DOMMatrix(getComputedStyle(deck).transform);
  return matrix.a; // uniform scale assumed (sx === sy in WFP slides)
}

function onDrag(event, elementState) {
  const scale = getCanvasScale();
  const dx = (event.clientX - elementState.startX) / scale;
  const dy = (event.clientY - elementState.startY) / scale;
  // Apply dx, dy as inline top/left offsets
}
```

Alignment guides, snap, and any visual overlays the editor draws on top of the canvas must respect this same scale.

## Selection model

**Decision:** Single-element selection only in v1.

The selected element is tracked in editor state by reference, not by selector. A separate "selection ring" DOM element is positioned over the selected target each frame (or on every change). This avoids modifying the target's class list, which keeps the export clean.

```
state.selected = HTMLElement | null
state.history = [Change, ...]
state.historyIndex = number
state.editMode = boolean
```

## Element conversion to absolute positioning

When the user drags an element that is not absolutely positioned, we have to decide what to do. Options:

1. **Refuse to drag.** Friendly error: "This element uses flex layout. Edit the source to reposition it."
2. **Auto-convert silently.** Every drag forces `position: absolute`. Risk: layout breaks for siblings.
3. **Auto-convert with a visible "unlock" indicator.** User sees what happened and can undo.

**Decision:** Option 3. On the first drag of a flow-positioned element, capture its current `getBoundingClientRect()` relative to the nearest positioned ancestor, write it as inline `position: absolute; top: Xpx; left: Ypx; width: Wpx; height: Hpx`, and show a small "unlocked" badge near the element for ~2 seconds. The conversion is a single history entry, so Cmd+Z reverts both the conversion and the drag.

## Export approach

For v1, use **Approach A: serialize the live DOM** (see REQUIREMENTS.md for the alternative).

```javascript
function exportHTML() {
  // 1. Clone the document
  const clone = document.documentElement.cloneNode(true);
  // 2. Remove editor root
  clone.querySelector('#wfp-editor-root')?.remove();
  // 3. Remove the script tag that loaded the editor
  clone.querySelectorAll('script[src*="editor.js"]').forEach(s => s.remove());
  // 4. Strip data-wfp-edit-* attributes
  clone.querySelectorAll('[data-wfp-edit]').forEach(el => {
    [...el.attributes].forEach(a => {
      if (a.name.startsWith('data-wfp-edit')) el.removeAttribute(a.name);
    });
  });
  // 5. Serialize and download
  const html = '<!DOCTYPE html>\n' + clone.outerHTML;
  triggerDownload(html);
}
```

If this produces visibly broken output on a fixture, fall back to Approach B (patch the original source text using selector-based diffs).

## Inline-style merging

Many WFP elements already have inline styles like `style="animation-delay: 200ms"`. The editor must merge into existing inline styles, not overwrite them.

```javascript
function setInlineStyle(el, prop, value) {
  el.style[camelCase(prop)] = value;
}
```

`element.style.x = y` already merges correctly. The risk is if we ever write `el.setAttribute('style', '...')`, which would clobber. Don't do that. Only use `el.style.foo = ...`.

## Editor DOM containment

All editor UI is mounted inside a single root:

```html
<div id="wfp-editor-root">
  <div class="wfp-toolbar">...</div>
  <div class="wfp-selection-ring">...</div>
  <div class="wfp-handles">...</div>
  <div class="wfp-toast">...</div>
</div>
```

CSS for this root is scoped via `#wfp-editor-root .wfp-* { ... }` selectors. The root sits at the top of `<body>` with `position: fixed; pointer-events: none;` and individual children opt in to `pointer-events: auto`.

This means: removing one element on export removes the entire editor visually. No leftover artifacts.

## Keyboard handling

The editor must coexist with existing slide-level keyboard listeners:

- When edit mode is OFF: pass through. Don't intercept anything.
- When edit mode is ON: register editor handlers in the **capture phase** (`addEventListener('keydown', handler, true)`) and call `stopPropagation()` for keys the editor cares about (arrows when an element is selected, ↑↓ for font size, Cmd+S, Cmd+Z, Escape, E).
- When edit mode is ON but no element is selected: still suppress arrow navigation (otherwise pressing arrows would change slides while editing). Show the editor's selection-arrow behavior instead (no-op or cycle through elements; for v1, just suppress).

## File structure for the editor

```
editor.js              # Single-file editor. ~600-1000 lines target.
```

Internal organization (sections within the file, separated by clear `// ===` headers):

1. State + history
2. DOM helpers (find slide, get scale, etc.)
3. Edit mode toggle
4. Selection
5. Drag
6. Resize
7. Font-size keyboard handling
8. Inline text edit
9. Toolbar UI
10. Export
11. Initialization

If `editor.js` exceeds ~1500 lines, split into multiple files and have the bookmarklet load them in sequence — but only if necessary. Single file is preferred.

## What we explicitly don't optimize for

- Performance under heavy DOM (slides have ~20-50 elements; trivial)
- Memory footprint (editor is short-lived, dropped on page reload)
- Mobile / touch (slides are desktop-only by design)
- Offline use (editor is fetched from network on activation)
