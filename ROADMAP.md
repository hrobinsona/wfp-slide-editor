# Roadmap

Things deliberately deferred from v1. If you're tempted to build any of these during v1, stop and add notes here instead.

## v2 candidates

<!-- Delivered: v2.1.0 — Overview mode (grid view, drag-to-reorder, delete).
     See feature-briefs/v2-overview.md for the spec and `git log --grep="v2.1"` for
     the implementation phases. -->

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
