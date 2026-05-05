# Roadmap

Things deliberately deferred from v1. If you're tempted to build any of these during v1, stop and add notes here instead.

## v2 candidates

### v2 LEAD FEATURE: Overview mode

Decided as the first v2 feature based on conversation during v1 scoping. This section is fully scoped — you should be able to read it cold and start a Claude Code session for v2 without re-reading any other doc.

**Goal.** A bird's-eye grid view of all slides in the deck, activated by a hotkey, allowing the user to see all slides at once, navigate between them, and reorder them by dragging. Equivalent to Keynote's "Show All Slides" or PowerPoint's "Slide Sorter" view.

**Why this lives in the editor (not the boilerplate).** Overview is a build-time tool, not a presentation-time tool. The user always has the editor loaded when building presentations; the presented HTML stays minimal. Reordering slides is a content edit, which puts it squarely in the editor's domain. Modeled on every other major presentation tool (Keynote, PowerPoint, Figma split editing tools from published views).

**Activation.**

- Hotkey `O` toggles overview mode on/off.
- Edit mode and overview mode are mutually exclusive — entering overview clears any element selection; exiting overview returns to a clean (no-selection) edit state.
- Overview can be entered whether edit mode is on or off; entering it does NOT change the edit-mode toggle.

**Layout.**

- All `.slide` elements rendered in a CSS grid.
- 4 thumbnails per row at default viewport widths.
- Each thumbnail at ~22% scale (≈422×237 px from 1920×1080).
- Use `transform: scale(0.22)` rather than resizing — keeps internal coordinate system intact.
- Active slide (the one current before entering overview) is visually highlighted (border or glow — pick at start of v2).
- Slide number badge in the corner of each thumbnail.

**Core interactions.**

*Click to navigate:* Click a thumbnail → exit overview, set that slide as active.

*Drag to reorder:* Click and drag a thumbnail to a new position. Other thumbnails shift to make space. On drop, the underlying DOM order of `.slide` elements is updated. The current active slide pointer follows the moved slide (if you reorder slide 3 to position 1 and slide 3 was active, it remains active in its new position).

*Delete:* Remove a slide from the deck while in overview. One delete = one history entry; Cmd+Z restores the slide. UX details (hover-`×` button, Backspace/Delete shortcut, last-slide guard) live in the v2-overview execution brief.

*Exit:* Press `O` again, press Escape, or click a thumbnail (which both navigates and exits).

**History integration.**

- Reorders go through the existing v1 undo/redo stack.
- One drag = one history entry (the full reorder, not per-position).
- Cmd+Z undoes the reorder; Cmd+Shift+Z reapplies.

**Export.**

- Overview mode itself is NOT preserved on export (the exported HTML opens in normal slide view).
- But slide reorder DOES persist — exported HTML's `.slide` elements appear in the new order.
- The v1 export contract just works: serialize the current DOM (which has been reordered), result is clean reordered HTML.

**Non-goals (explicitly defer further).**

- Multi-select for moving multiple slides at once
- Add new slides from overview
- Duplicate slides from overview
- Animated reorder transitions (snap-into-position is fine for v2.0; animation can be v2.1)
- Keyboard navigation between thumbnails (arrow keys to move highlight)
- Different grid densities (3-across, 5-across, etc.)
- Search/filter slides by content

**Open design questions to decide at start of v2.**

- Reorder animation: snap or animated transition? (Suggest snap for v2.0.)
- Visual style of the active-slide highlight: border, glow, both?
- Behaviour with many slides (>20): grid scrolls vs thumbnails shrink. Suggest scroll, keep thumbnail size constant.
- Drag library: hand-roll (consistent with v1) or pull in Sortable.js (~3KB)? Suggest hand-roll first; escalate if messy.

**Implementation sketch.**

- New section in `editor.js` for overview module (or split into `overview.js` if `editor.js` is already over ~1500 lines by then).
- New scoped CSS: `#wfp-editor-root .wfp-overview-grid { ... }`.
- DOM: on activation, create grid container with thumbnails referencing the slides; on deactivation, remove grid and restore normal `.slide.active` view.
- Test: `tests/v2-overview.spec.js` covering activation, reorder via simulated drag, click-to-navigate, undo of reorder, export round-trip with reordered slides.

**TDD posture suggestion.** Mostly strict, with one build-first phase for the overview grid styling (visual placement of thumbnails is partly aesthetic). Roughly: activation/exit (strict), grid layout (build-first), click-to-navigate (strict), drag-to-reorder (strict), undo integration (strict), export (strict).

### Persistence (autosave)
v1 is "export or lose it." v2 should autosave to localStorage so accidentally closing the tab doesn't lose 20 minutes of tweaks. Key by URL + a slide hash.

### Multi-select
Shift-click to add to selection. Drag-select with marquee. Group operations (move, delete, align).

### Snap-to-grid and alignment guides
A 16px grid would be nice. Smarter: alignment guides that snap to other elements' edges, centers, and the slide's center axes. Like Figma's smart guides.

### Properties panel
Selected element shows a small inspector: position, size, font-size, font-weight, color, padding. Editable directly.

### Color picker
Click a color swatch in the inspector to recolor text or backgrounds.

### Aspect-ratio lock on resize
Hold Shift while resizing to preserve aspect ratio. Useful for images.

### Adding new elements
A small "Add" menu: text, image, divider, shape. Inserts at cursor or center of slide.

### Deleting elements
Delete key removes selected element. Cmd+Z restores it.

### Z-order control
Cmd+] to bring forward, Cmd+[ to send back. Layers panel for fine control.

### Cross-slide operations
Copy a styled element from one slide and paste into another with all styles preserved.

## v3 candidates

### Asset replacement
Click an `<img>`, choose a new file, the editor uploads it (where?) and updates the src. Or: paste an image URL.

### Animation editing
Adjust `animation-delay` values inline. Preview the animation in place.

### Theme variable overrides
WFP slides use CSS variables (`--coral`, `--peach`). Edit them at the slide level and see all dependent elements update.

### Component-aware editing
Recognize WFP-specific patterns (e.g. `.wfp-badge`, `.philips`) and offer pattern-specific options.

## Architectural changes deferred

### Surgical export (Approach B from REQUIREMENTS.md)
v1 serializes the live DOM. v2 might fetch the original source text on load and apply selector-based patches, preserving formatting exactly.

### Editor versioning
v1 ships a single `editor.js`. When v2 lands, freeze v1 as `editor-v1.js` and let users pin to a specific version. New `editor.js` becomes v2. The bookmarklet generator supports a `?version=v1` query param.

### Splitting `editor.js`
If the file exceeds ~1500 lines, split into `editor.js` (loader + core) plus modules loaded via dynamic import. Keep the bookmarklet single-script for simplicity.

### Browser extension (alternative distribution)
Some users prefer an extension over a bookmarklet. Consider once v1 is stable. The same `editor.js` can be the content script.

## Won't build (probably)

These have been considered and rejected for now:

- **Mobile/touch support.** Slides are desktop-first by design.
- **Real-time collaboration.** Out of scope for a personal tool.
- **Cloud sync of edits.** Same.
- **WYSIWYG slide creation from scratch.** The editor is for tweaking, not authoring. Authoring stays with Claude.
- **Plugin system.** Premature.
