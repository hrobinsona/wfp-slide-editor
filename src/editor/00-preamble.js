/* WFP Slide Editor
 *
 * Bookmarklet-loaded visual editor for WFP HTML presentations.
 * See REQUIREMENTS.md, DESIGN.md, TASKS.md.
 *
 * Phase 1: bootstrap + edit-mode toggle.
 * Phase 2: click-to-select inside .slide.active + selection ring.
 * Phase 3: ArrowUp/Down (and Shift+) nudge font-size on selected text element.
 * Phase 4: scale-aware drag, with unlock-on-flow conversion + toast.
 * Phase 5: 8 resize handles on selected element + scale-aware resize.
 * Phase 6: undo/redo history (50-entry cap).
 * Phase 7: double-click → contenteditable; Escape/Tab/click-outside commits.
 * Phase 8: Cmd+S export — clones the document, scrubs editor markers, downloads.
 * Phase 9: liquid-glass toolbar + capture-phase suppression of slide nav keys.
 * v2.0:    toolbar liquid-glass refresh — recipe-correct light/dark variants,
 *          inline SVG icons (lucide aesthetic), no behavior change.
 * v2.1:    Overview mode for slide reorder/delete.
 * v2.2:    element copy/paste/duplicate + Overview blank-slide insertion.
 * v2.5:    agent handoff annotations with explicit handoff export.
 * v2.11:   export action menu; save-in-place via File System Access.
 * v2.12:   adaptive inspector — overlap-gated fade during live edits,
 *          coral value tag, scrubbable font field.
 *
 * Internal class names use the `wfpe-` prefix so they don't collide with
 * the WFP fixtures' own `wfp-badge` / `wfp-*` classes.
 */
(function () {
  'use strict';

  const VERSION = '2.12.1';
  const OVERVIEW_SCALE = 0.22;
  const HISTORY_MAX = 50;
  const FONT_SIZE_MIN_PX = 8;
  const DRAG_DEADZONE_PX = 5;
  const TOAST_DURATION_MS = 2000;
  const POST_DRAG_CLICK_GUARD_MS = 250;
  const RESIZE_MIN_PX = 8;
  const HANDLE_SIZE_PX = 10; // corner handle visual + hit-target size
  const HANDLE_EDGE_SIZE_PX = 6; // edge midpoint handle visual size (smaller per v2.7)
  const CORNER_DIRS = new Set(['nw', 'ne', 'se', 'sw']);
  function handleSizeFor(dir) {
    return CORNER_DIRS.has(dir) ? HANDLE_SIZE_PX : HANDLE_EDGE_SIZE_PX;
  }
  const HANDLE_DIRS = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
  const HANDLE_CURSORS = {
    nw: 'nwse-resize',
    n: 'ns-resize',
    ne: 'nesw-resize',
    e: 'ew-resize',
    se: 'nwse-resize',
    s: 'ns-resize',
    sw: 'nesw-resize',
    w: 'ew-resize',
  };
  const ROOT_ID = 'wfp-editor-root';
  const ANNOTATION_ID_ATTR = 'data-wfp-edit-annotation-id';
  const ANNOTATION_TEXT_ATTR = 'data-wfp-edit-annotation-text';
  const HANDOFF_TARGET_ATTR = 'data-wfp-agent-annotation-id';
  const HANDOFF_SCRIPT_ATTR = 'data-wfp-agent-annotations';
  const HANDOFF_COMMENT_TEXT = 'WFP Editor handoff: user-authored annotations are in script[data-wfp-agent-annotations]. Apply each annotation to the matching data-wfp-agent-annotation-id element, then remove resolved annotation metadata.';

  if (document.getElementById(ROOT_ID)) {
    console.log(`[wfp-editor] already mounted (v${VERSION})`);
    return;
  }

  // Tag the script element that loaded us so the export scrubber can find
  // it regardless of how it was injected (bookmarklet sets a `src`, but
  // dev-server injection / Playwright addScriptTag uses inline content).
  if (document.currentScript) {
    document.currentScript.dataset.wfpEditScript = 'true';
  }
