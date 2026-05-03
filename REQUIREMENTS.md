# Requirements: v1 MVP

## Goal

Ship a bookmarklet-activated editor that lets a user fix the obvious things on a WFP HTML slide without re-prompting Claude:

- Adjust font size of any text element
- Move elements around to reposition (logos, cards, images, headings)
- Resize images, cards, and background elements
- Edit text content inline
- Export the modified HTML, preserving everything that wasn't changed

## Non-goals (do NOT build in v1)

These are deferred. If you find yourself building one of these, stop and add it to `ROADMAP.md` instead.

- Multi-select
- Layers / z-order panel
- Color editing
- Snap-to-grid or alignment guides
- Aspect-ratio locking on resize
- Persistence across sessions (localStorage autosave). v1 is "export or lose it."
- Properties / inspector panel
- Group / ungroup operations
- Animation or transition editing
- Adding new elements (only existing elements can be edited)
- Deleting elements
- Cross-slide operations (editing affects only the active slide)

## Activation model

- The editor is loaded by a bookmarklet that injects `<script src="https://[user].github.io/wfp-slide-editor/editor.js">` into the current page.
- The bookmarklet works on any local `file://` URL or any served HTML file. Any slide ever produced by the WFP system should be editable.
- On load, the editor injects its UI but does NOT enter edit mode automatically. The user activates edit mode by pressing the `E` key, or clicking a small "Edit" toggle that appears in the corner of the viewport.
- When edit mode is OFF, the slide behaves exactly as it would without the editor loaded (keyboard navigation works, animations play, no visual changes).
- When edit mode is ON: existing keyboard navigation (arrows, space) is suppressed. The current slide gets a subtle visual indicator that edit mode is active.

## Core interactions

### Selection
- Click on any element inside `.slide.active` to select it.
- A visible selection ring appears around the selected element.
- Clicking on empty canvas deselects.
- The editor itself (its toolbar, handles, etc.) is never selectable as a target.
- Some elements should not be selectable: the `.deck` container, the `.slide` containers themselves, anything inside the editor's own DOM. Effectively: only descendants of `.slide.active` are selectable.

### Drag (move)
- With an element selected, click-drag anywhere on the element's body to move it.
- If the element is already `position: absolute`, update its `top` and `left` inline styles.
- If the element is not absolutely positioned, on the FIRST drag: capture its current bounding box (relative to the nearest positioned ancestor), apply `position: absolute; top: Xpx; left: Ypx; width: Wpx; height: Hpx;` inline, and then begin the drag. This "unlocks" the element. Add a small visual badge to indicate this conversion happened so the user knows.
- The drag delta must be divided by the current `transform: scale()` factor of the `.deck` element. WFP slides scale to fit the viewport; mouse pixels are not slide pixels. Read the scale from `getComputedStyle(deck).transform` or from the inline `transform` style.

### Resize
- Selected element shows 8 resize handles (corners and midpoints).
- Drag a handle to resize. Update `width` and `height` inline. Corner handles modify both dimensions; edge handles modify only one.
- Same scale-aware delta handling as drag.
- For text elements (h1-h6, p, span with text content), resize from the bottom-right corner also nudges font size proportionally. (For v1 keep this simple: width drag = width change only; font size is changed via keyboard, see below.)

### Font size
- With a text element selected, ↑ and ↓ keys nudge font size by 1px.
- Shift+↑ / Shift+↓ nudge by 5px.
- Read the current computed `font-size`, modify, write back as inline `font-size: Xpx`.
- Minimum 8px, no maximum.

### Inline text edit
- Double-click a text-bearing element to enter text-edit mode.
- Set `contenteditable="true"` on the element.
- Click outside, press Escape, or press Tab to exit text-edit mode and apply the change.
- Preserve existing inline HTML inside the element (e.g. `<br>` tags, nested `<span>`s).

### Undo / redo
- Cmd/Ctrl+Z undoes the last change.
- Cmd/Ctrl+Shift+Z (or Cmd/Ctrl+Y) redoes.
- Each atomic change is one history entry: a complete drag = one entry, a single font-size nudge = one entry, one text edit = one entry.
- History persists for the session. It does NOT survive page reload. (v1: out of scope.)
- Minimum 50 history entries.

### Export
- Cmd/Ctrl+S, or the export button in the editor toolbar, triggers export.
- Export produces a downloadable `.html` file matching the original filename with `-edited` suffix (e.g. `Townhall-1.html` becomes `Townhall-1-edited.html`).
- The exported HTML must:
  - Preserve everything in the original file that wasn't changed (DOCTYPE, head, scripts, all CSS, all unchanged elements).
  - For each modified element, add or update a `style="..."` attribute reflecting only the inline-style changes the user made (position, dimensions, font-size, etc.).
  - For text content changes, update the element's inner HTML to match the edited content.
  - Strip all editor-injected markers (`data-wfp-edit-*` attributes, the `<div id="wfp-editor-root">`, the injected `<script>`, any selection rings).
  - Be valid, reload-able HTML that when opened in a browser shows the edited slide as the user left it.

### Implementation note for export

Two viable approaches; either is acceptable for v1:

**Approach A (simpler):** Serialize `document.documentElement.outerHTML` after stripping editor DOM and markers. Risks: may reformat whitespace, may lose comments. Fine for v1.

**Approach B (cleaner):** On editor load, fetch the original page source as text. On each modification, record a patch (selector + style delta + content delta). On export, apply patches to the original source text. Preserves formatting exactly. Slightly more complex.

Pick Approach A for v1 unless it produces visibly broken output on the fixtures, in which case escalate to B.

## Constraints from WFP slides

- Every WFP presentation is a single HTML file containing 9-10 `.slide` divs inside one `.deck`.
- Canvas is fixed: 1920×1080, scaled via `transform: scale()` on `.deck` to fit the viewport.
- Existing keyboard handlers: ArrowLeft/Right, Space, also touch swipe.
- Many elements already use `position: absolute`. Most h1/h2/p elements within slide layouts use flow positioning inside flexbox or absolute parents.
- Heavy use of CSS variables, animations, `::before` / `::after` pseudo-elements.
- Inline styles are already used on many elements for `animation-delay` values. Don't clobber existing inline styles. Merge into them.

## Browser support

- Chrome, Edge, Safari, Firefox, Arc — current versions only.
- No IE, no mobile browser support targeted (slides are designed for desktop presentation anyway).

## Bookmarklet payload

The bookmarklet itself must be under 1KB. It does one thing: injects a `<script src="...">` tag pointing at the hosted `editor.js`. All real logic lives in `editor.js`.

Template:
```
javascript:(function(){var s=document.createElement('script');s.src='https://[user].github.io/wfp-slide-editor/editor.js?'+Date.now();document.body.appendChild(s);})();
```

The `?'+Date.now()` cache-buster ensures the user always gets the latest editor when they click the bookmarklet.

## Done criteria for v1

The editor ships when ALL of the following pass on `fixtures/Townhall-1.html` AND `fixtures/Inspirational-presentation-2.html`:

1. Bookmarklet loads `editor.js` without console errors.
2. Pressing `E` toggles edit mode on/off.
3. With edit mode ON, clicking a heading on the active slide selects it (visible ring).
4. With a heading selected, pressing ↑ five times increases font size by 5px and the change is visible.
5. With a heading selected, dragging it 50px right moves the heading 50px right (accounting for canvas scale).
6. Selecting an absolutely-positioned element (logo, badge), dragging it, then pressing Cmd+Z restores its original position.
7. Double-clicking a paragraph, typing new text, pressing Escape changes the paragraph content.
8. Pressing Cmd+S downloads an HTML file. Opening that file in a fresh browser tab shows the slide with all edits applied and no visible editor UI.
9. With edit mode OFF, ArrowRight/ArrowLeft still navigate slides (editor doesn't break navigation when inactive).
10. With edit mode ON, ArrowRight/ArrowLeft do NOT navigate slides (editor takes precedence).
