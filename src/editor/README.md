# Editor Source Layout

`editor.js` remains the deployed bookmarklet runtime. The files in this
directory are ordered source fragments assembled by `npm run build:editor`.

This first modularization pass is intentionally conservative: all fragments are
concatenated into the same IIFE scope, so no runtime loader, framework, import
map, or extra browser request is introduced. The split gives future work
physical ownership boundaries before deeper dependency cleanup.

## Fragment Boundaries

- `00-preamble.js` - file header, IIFE wrapper, constants, duplicate-mount guard, script tagging.
- `10-state.js` - session state shape.
- `20-dom-css.js` - editor root, scoped CSS, and root style mount.
- `30-ui-inspector-controls.js` - icons, toolbar, the export action menu DOM and dispatch, inspector DOM, overlay DOM, and inspector control wiring.
- `40-helpers-selection-inspector.js` - slide helpers, selection overlay refresh, export/badge UI refresh, inspector population, colour helpers, inspector visibility.
- `50-history.js` - element transactions, inspector transaction isolation, undo/redo, slide-level history.
- `60-modes-overview-keyboard.js` - edit mode, Overview mode, slide navigation takeover, overview reorder/delete, keyboard shortcuts.
- `70-selection-events.js` - click selection and observers.
- `80-drag-resize-unlock.js` - scale-aware drag/resize and flow unlock.
- `85-adaptive-fade.js` - adaptive chrome fade, live value tag, and the font-field scrub gesture.
- `90-text-edit.js` - inline text edit lifecycle.
- `95-export.js` - clean/handoff HTML export pipelines and the v2.11 save-in-place engine (File System Access + IndexedDB handle store).
- `96-live-refresh.js` - v2.13 live agent round-trip: save-file watch, in-place document swap, editor re-injection, and cross-generation state adoption.
- `99-ready.js` - restore adoption, watch start, results summary toast, ready flag, and startup log.

`scripts/build-editor.js` owns the build order in its `PARTS` array — add a new
fragment there, not just to this directory.

Keep `editor.js` in sync with these fragments by running:

```bash
npm run build:editor
```

`node scripts/build-editor.js --check` verifies the two agree, and
`npm run build:bookmarklet` runs that check before building the bookmarklet
string, so a stale `editor.js` cannot be published.
