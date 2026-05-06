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
- `30-ui-inspector-controls.js` - icons, toolbar, inspector DOM, overlay DOM, and inspector control wiring.
- `40-helpers-selection-inspector.js` - slide helpers, selection overlay refresh, inspector population, colour helpers, inspector visibility.
- `50-history.js` - element transactions, inspector transaction isolation, undo/redo, slide-level history.
- `60-modes-overview-keyboard.js` - edit mode, Overview mode, slide navigation takeover, overview reorder/delete, keyboard shortcuts.
- `70-selection-events.js` - click selection and observers.
- `80-drag-resize-unlock.js` - scale-aware drag/resize and flow unlock.
- `90-text-edit.js` - inline text edit lifecycle.
- `95-export.js` - clean HTML export.
- `99-ready.js` - ready flag and startup log.

Keep `editor.js` in sync with these fragments by running:

```bash
npm run build:editor
```

`npm run build:bookmarklet` checks that `editor.js` is already in sync before
building the bookmarklet string.
