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
 *
 * Internal class names use the `wfpe-` prefix so they don't collide with
 * the WFP fixtures' own `wfp-badge` / `wfp-*` classes.
 */
(function () {
  'use strict';

  const VERSION = '2.5.0';
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
  // ===========================================================================
  // State
  // ===========================================================================
  const state = {
    editMode: false,
    selected: null,
    selectedElements: [], // active-slide selection members; state.selected is the primary member
    drag: null, // { el, items: [{ el, anchorLeft, anchorTop, wasAbsolute }], startX, startY, started }
    resize: null, // { el, dir, startX, startY, initLeft, initTop, initWidth, initHeight }
    editingText: null, // { el, originalContenteditable, savedRange } while a text edit is open
    suppressClickUntil: 0,
    history: [], // entries: [{ changes: [{element, before, after}, ...] }]
    historyIndex: 0, // 0 = nothing applied; history.length = all applied
    txn: null, // { snapshots: Map<Element, BeforeSnap>, captureHtml } when an op is in progress
    clipboard: null, // { outerHTML } session-only element copy/paste payload
    inspectorMinimised: false, // persists across selections within session; resets on reload
    toolbarCollapsed: false, // ink-glass 3b — bar folded to Edit + chevron; session-only
    exportMenuOpen: false, // v2.11 — export action menu (4b) open/closed
    overviewMode: false, // v2.1.0 — bird's-eye grid of all slides; toggled by hotkey O / toolbar button / Escape
    overviewDrag: null, // v2.1.3 — { sourceSlide, sourceIndex, beforeOrder } during a drag-to-reorder
    overviewHoveredSlide: null, // v2.1.4 — slide whose thumb the cursor is over (Backspace/Delete target)
    deckMutated: false, // v2.1.0 hotfix — set true on first overview reorder/delete; flips arrow-nav to live-DOM (the fixture's cached slide list goes stale)
  };
  const deckContext = resolveDeckRoot();
  // ===========================================================================
  // DOM mount
  // ===========================================================================
  const root = document.createElement('div');
  root.id = ROOT_ID;
  Object.assign(root.style, {
    position: 'fixed',
    inset: '0',
    pointerEvents: 'none',
    zIndex: '2147483647',
  });

  const styleEl = document.createElement('style');
  styleEl.textContent = `
    /* ----- Ink Glass instrument (design 3b, July 2026). One dark-glass
       surface in the top-right corner made of two segments — a 36px
       icon-only toolbar and a 246px inspector docked beneath it —
       separated by a 1px seam. Dark-tinted ("ink") glass keeps white
       type readable over any host page, so there are deliberately no
       prefers-color-scheme variants for the instrument.

       Tokens (from the designer handoff wfpe-glass.css):
       glass bg      linear-gradient(rgba(255,255,255,0.10),rgba(255,255,255,0.03)),
                     rgba(22,25,31,0.32)
       glass filter  blur(24px) saturate(170%)
       glass border  1px solid rgba(255,255,255,0.22)
       bar shadow    0 8px 22px rgba(0,0,0,0.26), inset 0 1px 0 rgba(255,255,255,0.25)
       panel shadow  inset 0 1px 0 rgba(255,255,255,0.25) — no outer drop;
                     it would get clipped by the dock fold wrapper and
                     smudge the corners. Depth comes from the bar.
       field bg      rgba(9,11,16,0.32); border rgba(255,255,255,0.12)
       radii         bar/panel 12px · docked corners 6px · buttons 8-9px · fields 7px
       ease          cubic-bezier(0.32, 0.72, 0, 1)
       durations     340ms toolbar collapse · 380ms dock/fold + corner morph ----- */
    #${ROOT_ID} .wfpe-toolbar {
      position: fixed;
      top: 16px;
      right: 16px;
      width: 246px;              /* collapsed: 58px via [data-collapsed] */
      box-sizing: border-box;
      pointer-events: none;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 2px;
      padding: 3px;
      overflow: hidden;
      border-radius: 12px;       /* docked: 12 12 6 6 via [data-docked] */
      background:
        linear-gradient(rgba(255,255,255,0.10), rgba(255,255,255,0.03)),
        rgba(22,25,31,0.32);
      backdrop-filter: blur(24px) saturate(170%);
      -webkit-backdrop-filter: blur(24px) saturate(170%);
      border: 1px solid rgba(255,255,255,0.22);
      box-shadow: 0 8px 22px rgba(0,0,0,0.26), inset 0 1px 0 rgba(255,255,255,0.25);
      color: #fff;
      text-shadow: 0 1px 2px rgba(0,0,0,0.28);
      font: 10px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
      user-select: none;
      isolation: isolate;
      /* Always paint above the selection ring + resize handles, which
         live as later DOM siblings under the same root. */
      z-index: 4;
      transition:
        border-radius 380ms cubic-bezier(0.32,0.72,0,1),
        width         340ms cubic-bezier(0.32,0.72,0,1);
    }
    /* Inspector docked beneath → square off the shared corners. When
       nothing is selected the bar must return to a fully rounded 12px
       capsule — squared bottom corners exist only while docked. */
    #${ROOT_ID} .wfpe-toolbar[data-docked="true"] {
      border-radius: 12px 12px 6px 6px;
    }
    /* Toolbar collapsed to Edit + chevron */
    #${ROOT_ID} .wfpe-toolbar[data-collapsed="true"] {
      width: 58px;
    }
    /* Middle button group folds horizontally (grid-template-columns
       1fr→0fr) so the collapse reads as the bar swallowing its own
       actions rather than clipping them. */
    #${ROOT_ID} .wfpe-toolbar-fold {
      display: grid;
      grid-template-columns: 1fr;
      transition: grid-template-columns 340ms cubic-bezier(0.32,0.72,0,1);
    }
    #${ROOT_ID} .wfpe-toolbar[data-collapsed="true"] .wfpe-toolbar-fold {
      grid-template-columns: 0fr;
    }
    #${ROOT_ID} .wfpe-toolbar-fold-inner {
      min-width: 0;
      overflow: hidden;
      display: flex;
      gap: 2px;
      align-items: center;
    }
    /* Icon-only buttons — labels removed from the DOM; title="" supplies
       the tooltip, aria-label the accessible name. All chrome buttons
       reset padding: the UA stylesheet gives <button> 1px 6px even under
       appearance: none, which squeezes flex-shrinkable icons in narrow
       hit areas (the 20px collapse chevron lost 12px of content box). */
    #${ROOT_ID} .wfpe-toolbar-btn {
      appearance: none;
      -webkit-appearance: none;
      display: flex;
      align-items: center;
      justify-content: center;
      width: 30px;
      height: 30px;
      flex: none;
      padding: 0;
      border: 0;
      border-radius: 8px;
      background: transparent;
      color: #fff;
      cursor: pointer;
      pointer-events: auto;
      transition: background-color 160ms ease;
    }
    #${ROOT_ID} .wfpe-toolbar-btn .wfpe-icon {
      width: 15px;
      height: 15px;
      stroke: currentColor;
      fill: none;
      stroke-width: 1.8;
      stroke-linecap: round;
      stroke-linejoin: round;
    }
    #${ROOT_ID} .wfpe-toolbar-btn:hover { background-color: rgba(255,255,255,0.14); }
    #${ROOT_ID} .wfpe-toolbar-btn:active { background-color: rgba(255,255,255,0.22); }
    #${ROOT_ID} .wfpe-toolbar-btn:disabled,
    #${ROOT_ID} .wfpe-toolbar-btn[aria-disabled="true"] {
      color: rgba(255,255,255,0.35);
      cursor: default;
      background-color: transparent;
    }
    /* Edit mode badge — coral pill when active */
    #${ROOT_ID} .wfpe-mode-badge {
      appearance: none;
      -webkit-appearance: none;
      display: flex;
      align-items: center;
      justify-content: center;
      width: 30px;
      height: 30px;
      flex: none;
      padding: 0;
      border: 0;
      border-radius: 9px;
      background: transparent;
      color: #fff;
      cursor: pointer;
      pointer-events: auto;
      transition: background-color 160ms ease, filter 160ms ease;
    }
    #${ROOT_ID} .wfpe-mode-badge .wfpe-icon {
      width: 15px;
      height: 15px;
      stroke: currentColor;
      fill: none;
      stroke-width: 1.8;
      stroke-linecap: round;
      stroke-linejoin: round;
    }
    #${ROOT_ID} .wfpe-mode-badge:hover { background-color: rgba(255,255,255,0.14); }
    #${ROOT_ID} .wfpe-mode-badge:active { background-color: rgba(255,255,255,0.22); }
    #${ROOT_ID} .wfpe-mode-badge[data-mode="on"] {
      background: linear-gradient(180deg, #ff9e8c, #f0685b 60%, #e55a4e);
      box-shadow: 0 3px 10px rgba(230,88,76,0.45), inset 0 1px 0 rgba(255,255,255,0.40);
    }
    #${ROOT_ID} .wfpe-mode-badge[data-mode="on"]:hover {
      background: linear-gradient(180deg, #ff9e8c, #f0685b 60%, #e55a4e);
      filter: brightness(1.05);
    }
    /* Overview active state keeps the white-tint dialect — distinct from
       Edit's coral pill (Edit signals editability; Overview a view mode). */
    #${ROOT_ID} .wfpe-toolbar-btn[data-mode="on"] {
      background-color: rgba(255,255,255,0.22);
      box-shadow: inset 0 0 0 1px rgba(255,255,255,0.35);
    }
    #${ROOT_ID} .wfpe-toolbar-btn[data-mode="on"]:hover {
      background-color: rgba(255,255,255,0.28);
    }
    [data-wfp-edit-flat-position-context="true"] {
      position: relative !important;
    }
    /* Divider + collapse chevron */
    #${ROOT_ID} .wfpe-toolbar-divider {
      width: 1px;
      height: 18px;
      background: rgba(255,255,255,0.16);
      margin: 0 2px;
      flex: none;
    }
    #${ROOT_ID} .wfpe-toolbar-collapse {
      appearance: none;
      -webkit-appearance: none;
      display: flex;
      align-items: center;
      justify-content: center;
      width: 20px;
      height: 30px;
      flex: none;
      padding: 0;
      border: 0;
      border-radius: 7px;
      background: transparent;
      color: rgba(255,255,255,0.75);
      cursor: pointer;
      pointer-events: auto;
    }
    #${ROOT_ID} .wfpe-toolbar-collapse:hover { background-color: rgba(255,255,255,0.14); }
    #${ROOT_ID} .wfpe-toolbar-collapse .wfpe-icon {
      width: 13px;
      height: 13px;
      stroke: currentColor;
      fill: none;
      stroke-width: 2;
      stroke-linecap: round;
      stroke-linejoin: round;
      transition: transform 340ms cubic-bezier(0.32,0.72,0,1);
    }
    #${ROOT_ID} .wfpe-toolbar[data-collapsed="true"] .wfpe-toolbar-collapse .wfpe-icon {
      transform: rotate(180deg);
    }
    /* v2.11 — export action menu (design 4b): count badge on the Export
       button + the popup itself. The badge needs the button to be a
       positioning context (toolbar buttons are static by default). */
    #${ROOT_ID} .wfpe-toolbar-btn[data-action="export"] { position: relative; }
    #${ROOT_ID} .wfpe-export-badge {
      position: absolute;
      top: -3px;
      right: -3px;
      min-width: 14px;
      height: 14px;
      padding: 0 3px;
      border-radius: 8px;
      background: linear-gradient(180deg, #ff9e8c, #f0685b 70%);
      box-shadow: 0 1px 3px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.35);
      font-size: 8.5px;
      font-weight: 700;
      line-height: 1;
      color: #fff;
      display: flex;
      align-items: center;
      justify-content: center;
      box-sizing: border-box;
      pointer-events: none;
    }
    #${ROOT_ID} .wfpe-export-badge[data-count="0"] { display: none; }
    #${ROOT_ID} .wfpe-export-menu {
      position: fixed;
      z-index: 2147483646;
      /* root is pointer-events:none (click-through by default); this is a
         real popup that needs its own hit-testing, inherited by children. */
      pointer-events: auto;
      min-width: 208px;
      border-radius: 12px 6px 12px 12px;
      background: linear-gradient(rgba(255,255,255,0.10), rgba(255,255,255,0.03)), rgba(22,25,31,0.32);
      backdrop-filter: blur(24px) saturate(170%);
      -webkit-backdrop-filter: blur(24px) saturate(170%);
      border: 1px solid rgba(255,255,255,0.22);
      box-shadow: 0 8px 22px rgba(0,0,0,0.26), inset 0 1px 0 rgba(255,255,255,0.25);
      padding: 5px;
      box-sizing: border-box;
      display: none;
      flex-direction: column;
      gap: 2px;
    }
    #${ROOT_ID} .wfpe-export-menu[data-open="true"] { display: flex; }
    #${ROOT_ID} .wfpe-export-menu-item {
      display: flex;
      gap: 9px;
      align-items: center;
      width: 100%;
      padding: 7px 9px;
      border-radius: 8px;
      background: transparent;
      border: 0;
      color: #fff;
      text-align: left;
      cursor: pointer;
      box-sizing: border-box;
      font: inherit;
    }
    #${ROOT_ID} .wfpe-export-menu-item:hover { background: rgba(255,255,255,0.14); }
    #${ROOT_ID} .wfpe-export-menu-item[data-action="save-in-place"] { background: rgba(255,255,255,0.12); }
    #${ROOT_ID} .wfpe-export-menu-item[data-action="save-in-place"]:hover { background: rgba(255,255,255,0.20); }
    #${ROOT_ID} .wfpe-export-menu-chip {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 24px;
      height: 24px;
      border-radius: 7px;
      flex: none;
    }
    #${ROOT_ID} .wfpe-export-menu-item[data-action="save-in-place"] .wfpe-export-menu-chip {
      background: linear-gradient(180deg, #ff9e8c, #f0685b 60%, #e55a4e);
      box-shadow: inset 0 1px 0 rgba(255,255,255,0.35);
    }
    #${ROOT_ID} .wfpe-export-menu-item[data-action="clean-copy"] .wfpe-export-menu-chip {
      background: rgba(9,11,16,0.32);
      border: 1px solid rgba(255,255,255,0.14);
      box-sizing: border-box;
    }
    #${ROOT_ID} .wfpe-export-menu-chip .wfpe-icon { width: 12px; height: 12px; }
    #${ROOT_ID} .wfpe-export-menu-text { display: flex; flex-direction: column; gap: 1px; }
    #${ROOT_ID} .wfpe-export-menu-label { font-size: 11px; font-weight: 600; }
    #${ROOT_ID} .wfpe-export-menu-sub { font-size: 9.5px; color: rgba(255,255,255,0.60); }
    #${ROOT_ID} .wfpe-export-menu-hint {
      margin-left: auto;
      font-size: 9px;
      color: rgba(255,255,255,0.45);
      font-family: ui-monospace, Menlo, monospace;
    }
    /* ----- Inspector — docked glass segment, 1px seam under the bar.
       The outer dock wrapper animates the whole segment in/out on
       select/deselect via grid-template-rows; the panel itself no longer
       toggles display. ----- */
    #${ROOT_ID} .wfpe-inspector-dock {
      position: fixed;
      top: 53px;                 /* 16 + 36 bar + 1px seam */
      right: 16px;
      width: 246px;
      z-index: 4;
      pointer-events: none;
      display: grid;
      grid-template-rows: 1fr;
      transition: grid-template-rows 380ms cubic-bezier(0.32,0.72,0,1);
    }
    #${ROOT_ID} .wfpe-inspector-dock[data-visible="false"] {
      grid-template-rows: 0fr;
    }
    #${ROOT_ID} .wfpe-inspector-dock-inner {
      min-height: 0;
      overflow: hidden;
    }
    #${ROOT_ID} .wfpe-inspector {
      display: flex;
      flex-direction: column;
      border-radius: 6px 6px 12px 12px;
      background:
        linear-gradient(rgba(255,255,255,0.10), rgba(255,255,255,0.03)),
        rgba(22,25,31,0.32);
      backdrop-filter: blur(24px) saturate(170%);
      -webkit-backdrop-filter: blur(24px) saturate(170%);
      border: 1px solid rgba(255,255,255,0.22);
      box-shadow: inset 0 1px 0 rgba(255,255,255,0.25);  /* no outer drop shadow */
      overflow: hidden;
      color: #fff;
      text-shadow: 0 1px 2px rgba(0,0,0,0.28);
      font: 12px/1.35 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
      user-select: none;
      isolation: isolate;
      box-sizing: border-box;
      /* Instant on open; see the delayed hide below. */
      transition: visibility 0s;
    }
    /* While the dock is folded shut the panel still has natural height
       inside the clipped 0fr row — hide it for focus/AT/tooling once the
       fold animation completes so it is neither tabbable nor "visible". */
    #${ROOT_ID} .wfpe-inspector-dock[data-visible="false"] .wfpe-inspector {
      visibility: hidden;
      transition: visibility 0s 380ms;
    }
    #${ROOT_ID} .wfpe-inspector button,
    #${ROOT_ID} .wfpe-inspector input,
    #${ROOT_ID} .wfpe-inspector textarea,
    #${ROOT_ID} .wfpe-inspector label {
      pointer-events: auto;
    }
    /* Header — 36px, symmetric with the bar when the body is folded */
    #${ROOT_ID} .wfpe-inspector-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      height: 36px;
      box-sizing: border-box;
      padding: 0 6px 0 13px;
    }
    #${ROOT_ID} .wfpe-inspector-title {
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 0.09em;
      text-transform: uppercase;
      opacity: 0.95;
    }
    #${ROOT_ID} .wfpe-inspector-minimise {
      appearance: none;
      -webkit-appearance: none;
      display: flex;
      align-items: center;
      justify-content: center;
      width: 24px;
      height: 24px;
      padding: 0;
      border: 0;
      border-radius: 7px;
      background: transparent;
      color: rgba(255,255,255,0.8);
      cursor: pointer;
      transition: background-color 120ms ease;
    }
    #${ROOT_ID} .wfpe-inspector-minimise:hover { background-color: rgba(255,255,255,0.14); }
    #${ROOT_ID} .wfpe-inspector-minimise .wfpe-icon {
      width: 13px;
      height: 13px;
      stroke: currentColor;
      fill: none;
      stroke-width: 2;
      stroke-linecap: round;
      stroke-linejoin: round;
      transition: transform 380ms cubic-bezier(0.32,0.72,0,1);
    }
    #${ROOT_ID} .wfpe-inspector[data-state="minimised"] .wfpe-inspector-minimise .wfpe-icon {
      transform: rotate(180deg);
    }
    /* Body fold (minimise keeps the 36px header row, rolls the body up) */
    #${ROOT_ID} .wfpe-inspector-fold {
      display: grid;
      grid-template-rows: 1fr;
      transition: grid-template-rows 380ms cubic-bezier(0.32,0.72,0,1);
    }
    #${ROOT_ID} .wfpe-inspector[data-state="minimised"] .wfpe-inspector-fold {
      grid-template-rows: 0fr;
    }
    #${ROOT_ID} .wfpe-inspector-fold-inner {
      min-height: 0;
      overflow: hidden;
      /* Instant on expand; see the delayed hide below. */
      transition: visibility 0s;
    }
    /* The 0fr fold clips paint but not focusability — without this the
       minimised body's fields/buttons stay Tab-reachable at zero height.
       Mirrors the dock's delayed visibility hide on deselect. */
    #${ROOT_ID} .wfpe-inspector[data-state="minimised"] .wfpe-inspector-fold-inner {
      visibility: hidden;
      transition: visibility 0s 380ms;
    }
    #${ROOT_ID} .wfpe-inspector-body {
      border-top: 1px solid rgba(255,255,255,0.14);
      padding: 11px 13px 12px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    /* Rows: 66px label column + control */
    #${ROOT_ID} .wfpe-inspector-row {
      display: grid;
      grid-template-columns: 66px 1fr;
      align-items: center;
      gap: 8px;
    }
    #${ROOT_ID} .wfpe-inspector-row-label {
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: rgba(255,255,255,0.92);
    }
    #${ROOT_ID} .wfpe-inspector-divider {
      height: 1px;
      background: rgba(255,255,255,0.13);
      margin: 2px 0;
    }
    #${ROOT_ID} .wfpe-inspector-pair { display: flex; gap: 5px; }
    /* Fields */
    #${ROOT_ID} .wfpe-inspector-field {
      flex: 1;
      display: inline-flex;
      align-items: center;
      gap: 4px;
      height: 24px;
      box-sizing: border-box;
      padding: 0 8px;
      border-radius: 7px;
      background: rgba(9,11,16,0.32);
      border: 1px solid rgba(255,255,255,0.12);
      box-shadow: inset 0 1px 2px rgba(0,0,0,0.22);
      font-size: 12px;
      font-variant-numeric: tabular-nums;
      color: #fff;
    }
    #${ROOT_ID} .wfpe-inspector-field-axis {
      font-size: 9px;
      font-weight: 700;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      color: rgba(255,255,255,0.65);
    }
    #${ROOT_ID} .wfpe-inspector-field input {
      appearance: none;
      -webkit-appearance: none;
      -moz-appearance: textfield;
      width: 100%;
      background: transparent;
      border: 0;
      color: inherit;
      font: inherit;
      padding: 0;
      margin: 0;
      text-align: right;
      outline: none;
    }
    #${ROOT_ID} .wfpe-inspector-field input::-webkit-outer-spin-button,
    #${ROOT_ID} .wfpe-inspector-field input::-webkit-inner-spin-button {
      -webkit-appearance: none;
      margin: 0;
    }
    #${ROOT_ID} .wfpe-inspector-field:focus-within {
      border-color: rgba(240,104,91,0.75);
      box-shadow: inset 0 1px 2px rgba(0,0,0,0.22), 0 0 0 2px rgba(240,104,91,0.30);
    }
    /* Font row — −/field/+ stepper (design 3b drops the slider) */
    #${ROOT_ID} .wfpe-font-control {
      display: flex;
      align-items: center;
      gap: 5px;
      min-width: 0;
    }
    #${ROOT_ID} .wfpe-font-unit {
      font-size: 9px;
      color: rgba(255,255,255,0.65);
    }
    #${ROOT_ID} .wfpe-font-btn {
      appearance: none;
      -webkit-appearance: none;
      width: 24px;
      height: 24px;
      flex: none;
      padding: 0;
      border-radius: 7px;
      background: rgba(9,11,16,0.32);
      border: 1px solid rgba(255,255,255,0.12);
      color: #fff;
      font-size: 13px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: background-color 120ms ease;
    }
    #${ROOT_ID} .wfpe-font-btn:hover { background: rgba(255,255,255,0.16); }
    /* Segmented control (weight Reg/Med/Bold, align L/C/R) */
    #${ROOT_ID} .wfpe-seg {
      display: flex;
      background: rgba(9,11,16,0.32);
      border: 1px solid rgba(255,255,255,0.10);
      border-radius: 7px;
      padding: 2px;
      gap: 2px;
    }
    #${ROOT_ID} .wfpe-seg-item {
      appearance: none;
      -webkit-appearance: none;
      flex: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 3px 0;
      border: 0;
      border-radius: 5px;
      background: transparent;
      color: rgba(255,255,255,0.65);
      font: 10px/1.2 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
      cursor: pointer;
      transition: background-color 120ms ease, color 120ms ease;
    }
    #${ROOT_ID} .wfpe-seg-item[data-active="true"] {
      background: rgba(255,255,255,0.22);
      color: #fff;
      font-weight: 600;
      box-shadow: 0 1px 3px rgba(0,0,0,0.25);
    }
    #${ROOT_ID} .wfpe-seg-item .wfpe-icon {
      width: 12px;
      height: 12px;
      stroke: currentColor;
      fill: none;
      stroke-width: 2;
      stroke-linecap: round;
      stroke-linejoin: round;
    }
    /* Colour rows */
    #${ROOT_ID} .wfpe-color-control {
      display: flex;
      align-items: center;
      gap: 6px;
      min-width: 0;
    }
    #${ROOT_ID} .wfpe-color-swatch {
      position: relative;
      width: 22px;
      height: 22px;
      flex: none;
      border-radius: 6px;
      border: 1px solid rgba(255,255,255,0.3);
      background-color: #ffffff;
      cursor: pointer;
      padding: 0;
      overflow: hidden;
      isolation: isolate;
    }
    /* Checkerboard for transparent backgrounds — only painted when the
       swatch carries data-transparent="true". */
    #${ROOT_ID} .wfpe-color-swatch[data-transparent="true"] {
      background-image: conic-gradient(#c9c9ce 25%, #fff 0 50%, #c9c9ce 0 75%, #fff 0);
      background-size: 8px 8px;
    }
    /* Element has a background-image (e.g. gradient): diagonal stripe so
       it's obvious why the hex picker can't represent it. */
    #${ROOT_ID} .wfpe-color-swatch[data-image="true"] {
      background:
        repeating-linear-gradient(
          45deg,
          rgba(255, 255, 255, 0.55) 0 4px,
          rgba(15, 23, 42, 0.35) 4px 8px
        );
    }
    #${ROOT_ID} .wfpe-color-swatch input[type="color"] {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      opacity: 0;
      cursor: pointer;
      border: 0;
      padding: 0;
      /* The native input is the click target — clicking it opens the OS
         colour picker directly. Programmatic .click() on a hidden input
         was unreliable across Chromium versions. */
      pointer-events: auto;
    }
    #${ROOT_ID} .wfpe-color-clear {
      appearance: none;
      -webkit-appearance: none;
      width: 24px;
      height: 24px;
      flex: none;
      padding: 0;
      border-radius: 7px;
      background: rgba(9,11,16,0.32);
      border: 1px solid rgba(255,255,255,0.12);
      color: rgba(255,255,255,0.8);
      font-size: 12px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: background-color 120ms ease;
    }
    #${ROOT_ID} .wfpe-color-clear:hover { background: rgba(255,255,255,0.16); }
    /* Opacity row — native range restyled to the handoff's rail/knob
       tokens (3px rail at 25% white, 13px white knob). A custom
       track/knob widget would mean new drag logic for no behavioural
       gain; the native input keeps the one-entry-per-drag contract. */
    #${ROOT_ID} .wfpe-opacity-control {
      display: flex;
      align-items: center;
      gap: 6px;
      min-width: 0;
    }
    #${ROOT_ID} .wfpe-opacity-control .wfpe-inspector-field {
      flex: 0 0 auto;
    }
    #${ROOT_ID} .wfpe-opacity-control .wfpe-inspector-field input {
      width: 26px;
    }
    #${ROOT_ID} .wfpe-opacity-unit {
      font-size: 9px;
      color: rgba(255,255,255,0.65);
    }
    #${ROOT_ID} .wfpe-opacity-slider {
      appearance: none;
      -webkit-appearance: none;
      flex: 1;
      min-width: 0;
      height: 3px;
      background: rgba(255,255,255,0.25);
      border-radius: 2px;
      outline: none;
      margin: 0;
    }
    #${ROOT_ID} .wfpe-opacity-slider::-webkit-slider-thumb {
      -webkit-appearance: none;
      appearance: none;
      width: 13px;
      height: 13px;
      border-radius: 50%;
      background: #fff;
      border: 0;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.4);
      cursor: grab;
    }
    #${ROOT_ID} .wfpe-opacity-slider::-moz-range-thumb {
      width: 13px;
      height: 13px;
      border-radius: 50%;
      background: #fff;
      border: 0;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.4);
      cursor: grab;
    }
    /* Agent note */
    #${ROOT_ID} .wfpe-inspector-row[data-wfpe-row="annotation"] {
      display: flex;
      flex-direction: column;
      align-items: stretch;
      gap: 6px;
      padding-top: 2px;
    }
    #${ROOT_ID} .wfpe-annotation-input {
      appearance: none;
      -webkit-appearance: none;
      min-height: 42px;
      max-height: 160px;
      box-sizing: border-box;
      width: 100%;
      padding: 6px 8px;
      border-radius: 7px;
      background: rgba(9,11,16,0.32);
      border: 1px solid rgba(255,255,255,0.12);
      box-shadow: inset 0 1px 2px rgba(0,0,0,0.22);
      font: 11px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
      color: #fff;
      resize: vertical;
      outline: none;
    }
    #${ROOT_ID} .wfpe-annotation-input::placeholder { color: rgba(255,255,255,0.55); }
    #${ROOT_ID} .wfpe-annotation-input:focus {
      border-color: rgba(240,104,91,0.75);
      box-shadow: inset 0 1px 2px rgba(0,0,0,0.22), 0 0 0 2px rgba(240,104,91,0.30);
    }
    #${ROOT_ID} .wfpe-inspector-row[data-wfpe-row="annotation"][data-has-note="true"] .wfpe-annotation-input {
      border-color: rgba(245, 158, 11, 0.72);
      box-shadow: inset 0 1px 2px rgba(0,0,0,0.22), 0 0 0 1px rgba(245, 158, 11, 0.18) inset;
    }
    #${ROOT_ID} .wfpe-annotation-actions {
      display: flex;
      align-items: center;
      gap: 6px;
      justify-content: flex-end;
    }
    #${ROOT_ID} .wfpe-annotation-status {
      margin-right: auto;
      color: rgba(255,255,255,0.74);
      font: 600 10px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
      letter-spacing: 0.02em;
      min-height: 11px;
    }
    #${ROOT_ID} .wfpe-annotation-save-btn {
      appearance: none;
      -webkit-appearance: none;
      padding: 4px 12px;
      border-radius: 7px;
      background: rgba(255,255,255,0.20);
      border: 1px solid rgba(255,255,255,0.14);
      color: #fff;
      font-size: 10.5px;
      font-weight: 600;
      cursor: pointer;
      transition: background-color 120ms ease;
    }
    #${ROOT_ID} .wfpe-annotation-save-btn:hover { background: rgba(255,255,255,0.28); }
    #${ROOT_ID} .wfpe-annotation-delete-btn {
      appearance: none;
      -webkit-appearance: none;
      padding: 4px 10px;
      border-radius: 7px;
      background: transparent;
      border: 0;
      color: rgba(255,255,255,0.85);
      font-size: 10.5px;
      cursor: pointer;
      transition: background-color 120ms ease, color 120ms ease;
    }
    #${ROOT_ID} .wfpe-annotation-delete-btn:hover:not(:disabled) {
      background-color: rgba(220, 38, 38, 0.28);
    }
    #${ROOT_ID} .wfpe-annotation-delete-btn:disabled {
      color: rgba(255,255,255,0.4);
      cursor: default;
    }
    /* Footer actions: Duplicate / Delete / Reset */
    #${ROOT_ID} .wfpe-action-row {
      display: flex;
      justify-content: space-between;
      border-top: 1px solid rgba(255,255,255,0.13);
      padding-top: 9px;
      margin-top: 1px;
    }
    #${ROOT_ID} .wfpe-action-btn {
      appearance: none;
      -webkit-appearance: none;
      display: flex;
      align-items: center;
      gap: 5px;
      background: transparent;
      border: 0;
      color: rgba(255,255,255,0.95);
      font-size: 10.5px;
      font-weight: 600;
      cursor: pointer;
      padding: 4px 6px;
      border-radius: 6px;
      transition: background-color 120ms ease;
    }
    #${ROOT_ID} .wfpe-action-btn:hover { background: rgba(255,255,255,0.14); }
    #${ROOT_ID} .wfpe-action-btn.wfpe-delete-btn:hover {
      background-color: rgba(220, 38, 38, 0.28);
    }
    #${ROOT_ID} .wfpe-action-btn .wfpe-icon {
      width: 12px;
      height: 12px;
      stroke: currentColor;
      fill: none;
      stroke-width: 1.75;
      stroke-linecap: round;
      stroke-linejoin: round;
    }
    /* Dimension bubble (v2.2): floating chip above the selection ring
       showing W × H. Hidden alongside the ring during inline text edit. */
    #${ROOT_ID} .wfpe-dim-bubble {
      position: fixed;
      pointer-events: none;
      transform: translateX(-50%);
      background: rgba(15, 23, 42, 0.85);
      color: #fff;
      font: 11px/1.2 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
      letter-spacing: 0.02em;
      padding: 3px 7px;
      border-radius: 4px;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.25);
      white-space: nowrap;
      display: none;
      /* Sits inside #wfp-editor-root which already pins the editor's
         stacking context above the slide; no need to compete with the
         ring's z-index since they're siblings under the same root. */
    }
    #${ROOT_ID} .wfpe-annotation-layer {
      position: fixed;
      inset: 0;
      pointer-events: none;
      z-index: 3;
    }
    #${ROOT_ID} .wfpe-annotation-badge {
      position: fixed;
      pointer-events: auto;
      appearance: none;
      -webkit-appearance: none;
      box-sizing: border-box;
      width: 16px;
      height: 16px;
      padding: 0;
      border: 1px solid rgba(255, 214, 196, 0.70);
      border-radius: 50%;
      background:
        radial-gradient(120% 130% at 45% 12%, rgba(255, 221, 198, 0.92) 0%, rgba(252, 170, 139, 0.92) 44%, rgba(244, 132, 123, 0.96) 100%);
      color: transparent;
      box-shadow:
        0 7px 18px rgba(232, 110, 103, 0.34),
        0 3px 12px rgba(15, 23, 42, 0.16),
        inset 0 1px 0 rgba(255, 255, 255, 0.58),
        inset 0 -1px 0 rgba(126, 34, 26, 0.13);
      cursor: pointer;
      font-size: 0;
      line-height: 0;
      user-select: none;
      transition: transform 160ms ease, box-shadow 160ms ease, filter 160ms ease;
    }
    #${ROOT_ID} .wfpe-annotation-badge::before {
      content: '';
      position: absolute;
      inset: 3px 4px auto 4px;
      height: 1px;
      border-radius: 999px;
      background: rgba(255, 255, 255, 0.62);
      pointer-events: none;
    }
    #${ROOT_ID} .wfpe-annotation-badge::after {
      content: none;
    }
    #${ROOT_ID} .wfpe-annotation-badge:hover,
    #${ROOT_ID} .wfpe-annotation-badge[data-selected="true"] {
      filter: brightness(1.04);
      transform: translateY(-1px);
      box-shadow:
        0 9px 22px rgba(232, 110, 103, 0.42),
        0 0 0 2px rgba(255, 255, 255, 0.54),
        0 4px 14px rgba(15, 23, 42, 0.18),
        inset 0 1px 0 rgba(255, 255, 255, 0.66),
        inset 0 -1px 0 rgba(126, 34, 26, 0.14);
    }
    @media (prefers-color-scheme: dark) {
      /* The inspector now uses the same dark-glass recipe in both
         schemes (white text needs the brightness drop regardless of
         host preference). The dim bubble flips its tones in dark mode
         since it sits over slide content, not over the editor surface. */
      #${ROOT_ID} .wfpe-dim-bubble {
        background: rgba(255, 255, 255, 0.92);
        color: rgba(15, 23, 42, 0.95);
      }
    }
    /* Selection ring + handle stratum (v2.7 polish). The brief calls for
       4px rounded corners, a softer blue stroke, and corner dots that
       visually dominate the four edge midpoints. All 8 handles remain
       functional resize hit-targets. */
    #${ROOT_ID} .wfpe-selection-ring {
      position: fixed;
      pointer-events: none;
      box-sizing: border-box;
      border: 1.5px solid #5b9bd9;
      box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.55) inset;
      border-radius: 4px;
      display: none;
    }
    #${ROOT_ID} .wfpe-multi-box,
    #${ROOT_ID} .wfpe-multi-outline {
      position: fixed;
      pointer-events: none;
      box-sizing: border-box;
      display: none;
    }
    #${ROOT_ID} .wfpe-multi-outline-layer {
      position: fixed;
      inset: 0;
      pointer-events: none;
    }
    #${ROOT_ID} .wfpe-multi-box {
      border: 1.5px solid #5b9bd9;
      background: rgba(91, 155, 217, 0.08);
      box-shadow:
        0 0 0 1px rgba(255, 255, 255, 0.55) inset,
        0 6px 18px rgba(15, 23, 42, 0.12);
      border-radius: 6px;
    }
    #${ROOT_ID} .wfpe-multi-outline {
      border: 1px dashed rgba(91, 155, 217, 0.82);
      background: rgba(91, 155, 217, 0.04);
      border-radius: 4px;
    }
    #${ROOT_ID} .wfpe-toast {
      position: fixed;
      pointer-events: none;
      background: rgba(20, 20, 20, 0.92);
      color: #fff;
      font: 11px/1.3 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
      padding: 5px 9px;
      border-radius: 3px;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
      max-width: 280px;
      transition: opacity 200ms ease;
      opacity: 1;
    }
    #${ROOT_ID} .wfpe-toast[data-state="leaving"] {
      opacity: 0;
    }
    #${ROOT_ID} .wfpe-handle {
      position: fixed;
      box-sizing: border-box;
      pointer-events: auto;
      display: none;
      border-radius: 50%;
      background: #ffffff;
      border: 1.5px solid #5b9bd9;
      box-shadow: 0 1px 2px rgba(0, 0, 0, 0.25);
      /* Stay below toolbar/inspector controls so selected elements behind
         those surfaces cannot steal clicks from editor inputs/buttons. */
      z-index: 2;
    }
    /* Corners are the visual anchors — solid white circle at full
       handle size with a crisp blue ring. */
    #${ROOT_ID} .wfpe-handle[data-wfpe-handle="nw"],
    #${ROOT_ID} .wfpe-handle[data-wfpe-handle="ne"],
    #${ROOT_ID} .wfpe-handle[data-wfpe-handle="se"],
    #${ROOT_ID} .wfpe-handle[data-wfpe-handle="sw"] {
      width: ${HANDLE_SIZE_PX}px;
      height: ${HANDLE_SIZE_PX}px;
    }
    /* Edge midpoints are smaller and lower-contrast so the corner
       hierarchy reads at a glance; the underlying hit-target stays
       generous via padding so resize ergonomics don't regress. */
    #${ROOT_ID} .wfpe-handle[data-wfpe-handle="n"],
    #${ROOT_ID} .wfpe-handle[data-wfpe-handle="e"],
    #${ROOT_ID} .wfpe-handle[data-wfpe-handle="s"],
    #${ROOT_ID} .wfpe-handle[data-wfpe-handle="w"] {
      width: 6px;
      height: 6px;
      background: rgba(255, 255, 255, 0.85);
      border-color: rgba(91, 155, 217, 0.55);
      box-shadow: 0 1px 1px rgba(0, 0, 0, 0.18);
    }
    @media (prefers-color-scheme: dark) {
      #${ROOT_ID} .wfpe-handle[data-wfpe-handle="n"],
      #${ROOT_ID} .wfpe-handle[data-wfpe-handle="e"],
      #${ROOT_ID} .wfpe-handle[data-wfpe-handle="s"],
      #${ROOT_ID} .wfpe-handle[data-wfpe-handle="w"] {
        background: rgba(255, 255, 255, 0.75);
      }
    }
    /* ----- Overview mode (v2.1.1) — bird's-eye grid of all slides.
       Strategy: pure-CSS overrides keyed off body[data-wfp-edit-overview]
       so the user's slide DOM is never mutated. The marker uses the
       data-wfp-edit-* namespace so the export scrubber strips it
       automatically (see buildExportHtml). Slide-number badges and the
       active-slide highlight render as fixed-position overlays in
       #wfp-editor-root, anchored to each slide's getBoundingClientRect.
       Overlays don't scale with the slide, which is what we want — they're
       editor chrome, not slide content. ----- */
    body[data-wfp-edit-overview="on"] {
      /* Fixtures set body { overflow: hidden } to lock the canvas; overview
         needs vertical scroll for multi-row decks while the grid itself
         stays viewport-fit horizontally. */
      --wfpe-overview-scale: ${OVERVIEW_SCALE};
      --wfpe-overview-gap: clamp(16px, 1.6vw, 28px);
      --wfpe-overview-pad-inline: clamp(16px, 2vw, 28px);
      --wfpe-overview-pad-top: 112px;
      --wfpe-cell-w: 1920px;
      --wfpe-cell-h: 1080px;
      --wfpe-overview-thumb-width: calc(var(--wfpe-cell-w) * var(--wfpe-overview-scale));
      overflow-x: hidden !important;
      overflow-y: auto !important;
    }
    @media (max-width: 760px) {
      body[data-wfp-edit-overview="on"] {
        --wfpe-overview-scale: 0.18;
        --wfpe-overview-gap: 16px;
        --wfpe-overview-pad-inline: 16px;
      }
    }
    @media (max-width: 500px) {
      body[data-wfp-edit-overview="on"] {
        --wfpe-overview-scale: 0.15;
        --wfpe-overview-gap: 14px;
        --wfpe-overview-pad-inline: 14px;
      }
    }
    @media (max-width: 380px) {
      body[data-wfp-edit-overview="on"] {
        --wfpe-overview-scale: 0.12;
        --wfpe-overview-pad-inline: 12px;
      }
    }
    /* Hide every body-level sibling of the resolved deck root except the editor root —
       WFP fixtures commonly mount slide-progress dots, navigation hints,
       etc. as body children that overlay the slide. In overview those
       UI bits don't apply (no single "current" slide rendering); hide
       them visually without removing them from the DOM so export still
       round-trips them. */
    body[data-wfp-edit-overview="on"] > *:not([data-wfp-edit-deck-root]):not(#${ROOT_ID}) {
      display: none !important;
    }
    body[data-wfp-edit-overview="on"] [data-wfp-edit-deck-root]:not([data-wfp-edit-flat-root]) {
      /* Override the fixture's fixed 1920x1080 + scale() canvas. The grid
         now reflows to the viewport instead of preserving the normal deck
         centering margins or a fixed 4-column width.
         !important is needed because the fixture's resize handler writes
         inline transform/margin values every viewport change. */
      display: grid !important;
      grid-template-columns:
        repeat(auto-fit, minmax(min(100%, var(--wfpe-overview-thumb-width)), var(--wfpe-overview-thumb-width))) !important;
      gap: var(--wfpe-overview-gap);
      padding:
        var(--wfpe-overview-pad-top)
        var(--wfpe-overview-pad-inline)
        var(--wfpe-overview-pad-inline);
      width: 100% !important;
      max-width: 100vw !important;
      height: auto !important;
      min-height: 100vh;
      margin: 0 !important;
      transform: none !important;
      position: static !important;
      overflow: visible !important;
      justify-content: center;
      align-content: start;
      background: #1a1d23;
      box-sizing: border-box;
    }
    body[data-wfp-edit-overview="on"] [data-wfp-edit-deck-root]:not([data-wfp-edit-flat-root]) > .slide {
      /* All slides become visible grid cells. The transform shrinks the
         visual while the slide's own coordinate system stays intact — the
         negative margins reclaim the layout space the
         transform leaves behind, so each cell occupies only the scaled
         visual size. */
      display: var(--wfpe-overview-slide-display, block) !important;
      position: relative !important;
      top: auto !important;
      left: auto !important;
      right: auto !important;
      bottom: auto !important;
      width: var(--wfpe-cell-w) !important;
      height: var(--wfpe-cell-h) !important;
      min-width: 0 !important;
      min-height: 0 !important;
      max-width: none !important;
      max-height: none !important;
      box-sizing: border-box !important;
      opacity: 1 !important;
      visibility: visible !important;
      pointer-events: auto !important;
      transition: none !important;
      transform: scale(var(--wfpe-overview-scale)) !important;
      transform-origin: top left !important;
      margin-right: calc(var(--wfpe-cell-w) * (var(--wfpe-overview-scale) - 1)) !important;
      margin-bottom: calc(var(--wfpe-cell-h) * (var(--wfpe-overview-scale) - 1)) !important;
      cursor: pointer;
      /* Ensure overflow:hidden from the fixture stays — internal slide
         content sticking out of the scaled cell would visually collide
         with neighbouring thumbnails. */
      overflow: hidden !important;
    }
    /* Suppress the editor's own selection ring + handles + note markers
       while overview is active — they refer to slide-element selection,
       which doesn't exist in overview. */
    body[data-wfp-edit-overview="on"] #${ROOT_ID} .wfpe-selection-ring,
    body[data-wfp-edit-overview="on"] #${ROOT_ID} .wfpe-handle,
    body[data-wfp-edit-overview="on"] #${ROOT_ID} .wfpe-dim-bubble,
    body[data-wfp-edit-overview="on"] #${ROOT_ID} .wfpe-annotation-layer,
    body[data-wfp-edit-overview="on"] #${ROOT_ID} .wfpe-inspector-dock {
      display: none !important;
    }
    /* Overlay layer — sits above the deck, below the toolbar. Each thumb
       is a fixed-positioned chrome wrapper anchored to a slide's bounding
       rect. Thumbs become draggable in v2.1.3, so they need pointer-events
       to receive drag/click events. The click handler in onOverviewClick
       walks up to the thumb (or down to its slide via the index dataset)
       to route both navigation and drag through the same surface. */
    #${ROOT_ID} .wfpe-overview-overlay {
      position: fixed;
      inset: 0;
      pointer-events: none;
      display: none;
      z-index: 1;
    }
    #${ROOT_ID} .wfpe-overview-overlay[data-visible="true"] {
      display: block;
    }
    #${ROOT_ID} .wfpe-overview-thumb {
      position: fixed;
      pointer-events: auto;
      cursor: grab;
      box-sizing: border-box;
      border-radius: 4px;
    }
    #${ROOT_ID} .wfpe-overview-thumb[data-dragging="true"] {
      opacity: 0.4;
      cursor: grabbing;
    }
    #${ROOT_ID} .wfpe-overview-thumb::after {
      content: '';
      position: absolute;
      inset: 0;
      border: 1px solid rgba(255, 255, 255, 0.18);
      border-radius: 4px;
      pointer-events: none;
      box-sizing: border-box;
      z-index: 0;
    }
    #${ROOT_ID} .wfpe-overview-thumb[data-empty="true"]::after {
      background:
        linear-gradient(135deg, rgba(255, 255, 255, 0.92), rgba(244, 247, 251, 0.86));
      border-color: rgba(15, 23, 42, 0.22);
      box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.65);
    }
    #${ROOT_ID} .wfpe-overview-add {
      position: fixed;
      width: 24px;
      height: 24px;
      padding: 0;
      border-radius: 50%;
      background: rgba(15, 23, 42, 0.54);
      backdrop-filter: blur(20px) saturate(180%);
      -webkit-backdrop-filter: blur(20px) saturate(180%);
      border: 1px solid rgba(255, 255, 255, 0.22);
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.28);
      color: #fff;
      cursor: pointer;
      appearance: none;
      -webkit-appearance: none;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      pointer-events: auto;
      opacity: 0.42;
      z-index: 2;
      font: 600 18px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
      transition: opacity 120ms ease, background-color 120ms ease, transform 120ms ease;
    }
    #${ROOT_ID} .wfpe-overview-add:hover,
    #${ROOT_ID} .wfpe-overview-add:focus {
      opacity: 1;
      background: rgba(15, 23, 42, 0.86);
      transform: scale(1.06);
      outline: none;
    }
    /* × delete button (v2.1.4) — Liquid Glass pill, top-right of each
       thumb, revealed on thumb hover or focus. Same dark-glass tint as
       the slide-number badge so they read as a matched pair (badge =
       passive label, × = active affordance). */
    #${ROOT_ID} .wfpe-overview-delete {
      position: absolute;
      top: 6px;
      right: 6px;
      width: 22px;
      height: 22px;
      padding: 0;
      border-radius: 50%;
      background: rgba(15, 23, 42, 0.78);
      backdrop-filter: blur(20px) saturate(180%);
      -webkit-backdrop-filter: blur(20px) saturate(180%);
      border: 1px solid rgba(255, 255, 255, 0.22);
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.35);
      color: #fff;
      cursor: pointer;
      appearance: none;
      -webkit-appearance: none;
      display: none;
      align-items: center;
      justify-content: center;
      z-index: 1;
      transition: background-color 120ms ease, transform 120ms ease;
    }
    #${ROOT_ID} .wfpe-overview-thumb:hover .wfpe-overview-delete,
    #${ROOT_ID} .wfpe-overview-thumb:focus-within .wfpe-overview-delete,
    #${ROOT_ID} .wfpe-overview-delete:focus {
      display: inline-flex;
    }
    #${ROOT_ID} .wfpe-overview-delete:hover {
      background: rgba(15, 23, 42, 0.92);
      transform: scale(1.06);
    }
    #${ROOT_ID} .wfpe-overview-delete svg {
      width: 10px;
      height: 10px;
      stroke: currentColor;
      fill: none;
      stroke-width: 2.4;
      stroke-linecap: round;
      stroke-linejoin: round;
    }
    /* Drop indicator — thin vertical bar drawn between the target thumb
       and its neighbour to mark the snap insertion point during drag.
       Pure white at 0.55 (the inspector focus stroke alpha already
       reused for the active-slide ring) with a soft glow so it reads
       against either light or dark slide thumbnails. */
    #${ROOT_ID} .wfpe-overview-drop-indicator {
      position: fixed;
      pointer-events: none;
      width: 3px;
      border-radius: 2px;
      background: rgba(255, 255, 255, 0.55);
      box-shadow: 0 0 8px rgba(255, 255, 255, 0.55);
      display: none;
      z-index: 4;
    }
    #${ROOT_ID} .wfpe-overview-drop-indicator[data-visible="true"] {
      display: block;
    }
    /* Slide-number badge — Liquid Glass dialect, top-left chip on each
       thumbnail. Dark-glass tint with white text reads on light slides
       as well as dark ones. */
    #${ROOT_ID} .wfpe-overview-badge {
      position: absolute;
      top: 6px;
      left: 6px;
      min-width: 22px;
      padding: 3px 7px;
      border-radius: 8px;
      background: rgba(15, 23, 42, 0.78);
      backdrop-filter: blur(20px) saturate(180%);
      -webkit-backdrop-filter: blur(20px) saturate(180%);
      border: 1px solid rgba(255, 255, 255, 0.22);
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.35);
      color: #fff;
      font: 600 11px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
      letter-spacing: 0.02em;
      text-align: center;
      z-index: 1;
    }
    /* Active-slide highlight — Liquid Glass dialect using the inspector
       focus stroke value (rgba(255,255,255,0.55), already used at the
       inspector field focus state) so we don't introduce a new alpha
       token. The inset highlight uses 0.18 (the lower mid-tone present
       throughout the toolbar palette). The ring sits on the thumb
       wrapper, not the slide, so it doesn't scale with the 0.22
       transform. */
    #${ROOT_ID} .wfpe-overview-thumb[data-active="true"]::before {
      content: '';
      position: absolute;
      inset: -3px;
      border: 2px solid rgba(255, 255, 255, 0.55);
      border-radius: 6px;
      box-shadow:
        0 0 0 1px rgba(255, 255, 255, 0.18) inset,
        0 0 28px rgba(255, 255, 255, 0.18);
      pointer-events: none;
    }
  `;
  root.appendChild(styleEl);

  const overviewMeasureStyleEl = document.createElement('style');
  root.appendChild(overviewMeasureStyleEl);
  // Inline SVG icons — single-stroke, 18px, lucide aesthetic. Embedded
  // directly so the editor stays a self-contained file with no icon-font
  // or runtime dependency. `currentColor` lets the toolbar's text colour
  // (and the coral pill's white text) cascade in cleanly.
  const ICONS = {
    edit:
      '<svg class="wfpe-icon" viewBox="0 0 24 24" aria-hidden="true">' +
      '<path d="M12 20h9" />' +
      '<path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />' +
      '</svg>',
    export:
      '<svg class="wfpe-icon" viewBox="0 0 24 24" aria-hidden="true">' +
      '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />' +
      '<polyline points="7 10 12 15 17 10" />' +
      '<line x1="12" y1="15" x2="12" y2="3" />' +
      '</svg>',
    handoff:
      '<svg class="wfpe-icon" viewBox="0 0 24 24" aria-hidden="true">' +
      '<path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z" />' +
      '<path d="M8 9h8" />' +
      '<path d="M8 13h5" />' +
      '</svg>',
    undo:
      '<svg class="wfpe-icon" viewBox="0 0 24 24" aria-hidden="true">' +
      '<path d="M9 14 4 9l5-5" />' +
      '<path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5v0a5.5 5.5 0 0 1-5.5 5.5H11" />' +
      '</svg>',
    redo:
      '<svg class="wfpe-icon" viewBox="0 0 24 24" aria-hidden="true">' +
      '<path d="m15 14 5-5-5-5" />' +
      '<path d="M20 9H9.5A5.5 5.5 0 0 0 4 14.5v0A5.5 5.5 0 0 0 9.5 20H13" />' +
      '</svg>',
    // Chevron-up: inspector minimise control. CSS rotates it 180° in the
    // minimised state (ink-glass 3b) — no swap to a down variant.
    chevronUp:
      '<svg class="wfpe-icon" viewBox="0 0 24 24" aria-hidden="true">' +
      '<polyline points="18 15 12 9 6 15" />' +
      '</svg>',
    // Counter-clockwise refresh — paired with "Reset" in the inspector.
    refresh:
      '<svg class="wfpe-icon" viewBox="0 0 24 24" aria-hidden="true">' +
      '<polyline points="1 4 1 10 7 10" />' +
      '<path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />' +
      '</svg>',
    // Copy — paired with the inspector Duplicate action.
    copy:
      '<svg class="wfpe-icon" viewBox="0 0 24 24" aria-hidden="true">' +
      '<rect x="8" y="8" width="12" height="12" rx="2" />' +
      '<path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" />' +
      '</svg>',
    trash:
      '<svg class="wfpe-icon" viewBox="0 0 24 24" aria-hidden="true">' +
      '<path d="M3 6h18" />' +
      '<path d="M8 6V4h8v2" />' +
      '<path d="M19 6l-1 14H6L5 6" />' +
      '<path d="M10 11v5" />' +
      '<path d="M14 11v5" />' +
      '</svg>',
    // 2x2 grid — Overview toolbar button (v2.1.0).
    overview:
      '<svg class="wfpe-icon" viewBox="0 0 24 24" aria-hidden="true">' +
      '<rect x="3" y="3" width="7" height="7" rx="1" />' +
      '<rect x="14" y="3" width="7" height="7" rx="1" />' +
      '<rect x="3" y="14" width="7" height="7" rx="1" />' +
      '<rect x="14" y="14" width="7" height="7" rx="1" />' +
      '</svg>',
    // Chevron-right: toolbar collapse control (ink-glass 3b). CSS rotates
    // it 180° while the bar is collapsed — no innerHTML swapping.
    chevronRight:
      '<svg class="wfpe-icon" viewBox="0 0 24 24" aria-hidden="true">' +
      '<polyline points="9 18 15 12 9 6" />' +
      '</svg>',
    // Text-align triplet — inspector Align segmented control (ink-glass 3b).
    alignLeft:
      '<svg class="wfpe-icon" viewBox="0 0 24 24" aria-hidden="true">' +
      '<line x1="3" y1="6" x2="21" y2="6" />' +
      '<line x1="3" y1="12" x2="15" y2="12" />' +
      '<line x1="3" y1="18" x2="17" y2="18" />' +
      '</svg>',
    alignCenter:
      '<svg class="wfpe-icon" viewBox="0 0 24 24" aria-hidden="true">' +
      '<line x1="3" y1="6" x2="21" y2="6" />' +
      '<line x1="6" y1="12" x2="18" y2="12" />' +
      '<line x1="5" y1="18" x2="19" y2="18" />' +
      '</svg>',
    alignRight:
      '<svg class="wfpe-icon" viewBox="0 0 24 24" aria-hidden="true">' +
      '<line x1="3" y1="6" x2="21" y2="6" />' +
      '<line x1="9" y1="12" x2="21" y2="12" />' +
      '<line x1="7" y1="18" x2="21" y2="18" />' +
      '</svg>',
    // Small × — overview thumbnail delete button (v2.1.4). No wfpe-icon
    // class here because the delete button stamps its own size via CSS
    // (10px) rather than the toolbar's 18px.
    closeSmall:
      '<svg viewBox="0 0 24 24" aria-hidden="true">' +
      '<path d="M18 6 6 18" />' +
      '<path d="m6 6 12 12" />' +
      '</svg>',
  };

  const toolbar = document.createElement('div');
  toolbar.className = 'wfpe-toolbar';
  toolbar.dataset.mode = 'off';
  toolbar.dataset.docked = 'false';
  toolbar.dataset.collapsed = 'false';

  // The mode badge IS the Edit toggle. Icon-only (ink-glass 3b); the
  // active state is signalled by data-mode (coral fill). title/aria-label
  // carry the text the removed label span used to provide.
  const badge = document.createElement('button');
  badge.type = 'button';
  badge.className = 'wfpe-mode-badge';
  badge.dataset.mode = 'off';
  badge.dataset.action = 'edit';
  badge.title = 'Toggle edit mode (E)';
  badge.setAttribute('aria-label', 'Toggle edit mode');
  badge.innerHTML = ICONS.edit;
  toolbar.appendChild(badge);

  function makeToolbarButton(action, label, hint, iconKey) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'wfpe-toolbar-btn';
    b.dataset.action = action;
    b.title = hint;
    b.setAttribute('aria-label', label);
    b.innerHTML = ICONS[iconKey];
    return b;
  }

  // v2.1.0 — Overview button sits between Edit and the action triplet.
  // Edit + Overview are mode toggles; Export/Undo/Redo are actions. Keeping
  // the two mode controls adjacent reads cleanly in the toolbar.
  const overviewBtn = makeToolbarButton('overview', 'Overview', 'Overview (O)', 'overview');
  overviewBtn.dataset.mode = 'off';
  const exportBtn = makeToolbarButton('export', 'Export', 'Export (Cmd/Ctrl+S)', 'export');
  // v2.11 — annotation-count badge; hidden at zero via CSS [data-count="0"].
  const exportBadge = document.createElement('span');
  exportBadge.className = 'wfpe-export-badge';
  exportBadge.dataset.count = '0';
  exportBadge.setAttribute('aria-hidden', 'true');
  exportBtn.appendChild(exportBadge);
  exportBtn.setAttribute('aria-haspopup', 'menu');
  exportBtn.setAttribute('aria-expanded', 'false');
  const undoBtn = makeToolbarButton('undo', 'Undo', 'Undo (Cmd/Ctrl+Z)', 'undo');
  const redoBtn = makeToolbarButton('redo', 'Redo', 'Redo (Cmd/Ctrl+Shift+Z)', 'redo');

  // Ink-glass 3b: Overview→Redo (+ trailing divider) fold away when the
  // bar collapses; Edit and the chevron stay. The fold wrapper animates
  // grid-template-columns 1fr↔0fr (see CSS) so the group visually
  // compresses instead of being clipped mid-icon.
  const toolbarFold = document.createElement('div');
  toolbarFold.className = 'wfpe-toolbar-fold';
  const toolbarFoldInner = document.createElement('div');
  toolbarFoldInner.className = 'wfpe-toolbar-fold-inner';
  toolbarFold.appendChild(toolbarFoldInner);
  toolbarFoldInner.appendChild(overviewBtn);
  toolbarFoldInner.appendChild(exportBtn);
  toolbarFoldInner.appendChild(undoBtn);
  toolbarFoldInner.appendChild(redoBtn);
  const toolbarDivider = document.createElement('div');
  toolbarDivider.className = 'wfpe-toolbar-divider';
  toolbarFoldInner.appendChild(toolbarDivider);
  toolbar.appendChild(toolbarFold);

  const toolbarCollapseBtn = document.createElement('button');
  toolbarCollapseBtn.type = 'button';
  toolbarCollapseBtn.className = 'wfpe-toolbar-collapse';
  toolbarCollapseBtn.dataset.action = 'toolbar-collapse';
  toolbarCollapseBtn.title = 'Collapse toolbar';
  toolbarCollapseBtn.setAttribute('aria-label', 'Collapse toolbar');
  toolbarCollapseBtn.innerHTML = ICONS.chevronRight;
  toolbar.appendChild(toolbarCollapseBtn);

  function setToolbarCollapsed(value) {
    state.toolbarCollapsed = !!value;
    toolbar.dataset.collapsed = state.toolbarCollapsed ? 'true' : 'false';
    const label = state.toolbarCollapsed ? 'Expand toolbar' : 'Collapse toolbar';
    toolbarCollapseBtn.title = label;
    toolbarCollapseBtn.setAttribute('aria-label', label);
  }

  root.appendChild(toolbar);

  // v2.11 — export action menu (design 4b). Fixed-position flyout under the
  // toolbar; opened by the Export button. Row 1 is the primary save action
  // (Enter / Cmd+S), row 2 is the legacy clean-copy download.
  const exportMenu = document.createElement('div');
  exportMenu.className = 'wfpe-export-menu';
  exportMenu.dataset.open = 'false';
  exportMenu.setAttribute('role', 'menu');
  function makeExportMenuItem(action, iconKey) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'wfpe-export-menu-item';
    b.dataset.action = action;
    b.setAttribute('role', 'menuitem');
    b.innerHTML =
      `<span class="wfpe-export-menu-chip">${ICONS[iconKey]}</span>` +
      '<span class="wfpe-export-menu-text">' +
      '<span class="wfpe-export-menu-label"></span>' +
      '<span class="wfpe-export-menu-sub"></span>' +
      '</span>';
    return b;
  }
  const exportPrimaryItem = makeExportMenuItem('save-in-place', 'handoff');
  const exportHintEl = document.createElement('span');
  exportHintEl.className = 'wfpe-export-menu-hint';
  exportHintEl.textContent = '↵';
  exportPrimaryItem.appendChild(exportHintEl);
  const exportCleanItem = makeExportMenuItem('clean-copy', 'export');
  exportMenu.appendChild(exportPrimaryItem);
  exportMenu.appendChild(exportCleanItem);
  root.appendChild(exportMenu);

  // Inspector panel. Ink-glass 3b docks it beneath the toolbar as the
  // second glass segment: an outer .wfpe-inspector-dock wrapper (fixed at
  // top: 53px = 16 + 36 bar + 1px seam) animates the whole segment open/
  // shut on select/deselect via grid-template-rows, replacing the old
  // display:none toggle on the panel itself. The panel's data-visible
  // attribute is kept in sync purely as a stable hook for tests.
  const inspectorDock = document.createElement('div');
  inspectorDock.className = 'wfpe-inspector-dock';
  inspectorDock.dataset.visible = 'false';
  const inspectorDockInner = document.createElement('div');
  inspectorDockInner.className = 'wfpe-inspector-dock-inner';
  inspectorDock.appendChild(inspectorDockInner);

  const inspector = document.createElement('div');
  inspector.className = 'wfpe-inspector';
  inspector.dataset.visible = 'false';
  inspector.dataset.state = 'expanded';

  const inspectorHeader = document.createElement('div');
  inspectorHeader.className = 'wfpe-inspector-header';

  const inspectorTitle = document.createElement('span');
  inspectorTitle.className = 'wfpe-inspector-title';
  inspectorTitle.textContent = 'Inspector';
  inspectorHeader.appendChild(inspectorTitle);

  const inspectorMinimiseBtn = document.createElement('button');
  inspectorMinimiseBtn.type = 'button';
  inspectorMinimiseBtn.className = 'wfpe-inspector-minimise';
  inspectorMinimiseBtn.dataset.action = 'minimise';
  inspectorMinimiseBtn.title = 'Minimise';
  inspectorMinimiseBtn.setAttribute('aria-label', 'Minimise inspector');
  // Single chevron; CSS rotates it 180° in the minimised state.
  inspectorMinimiseBtn.innerHTML = ICONS.chevronUp;
  inspectorHeader.appendChild(inspectorMinimiseBtn);

  inspector.appendChild(inspectorHeader);

  // Minimise folds the body via the same grid-rows trick as the dock,
  // leaving the 36px header as a capsule symmetric with the toolbar.
  const inspectorFold = document.createElement('div');
  inspectorFold.className = 'wfpe-inspector-fold';
  const inspectorFoldInner = document.createElement('div');
  inspectorFoldInner.className = 'wfpe-inspector-fold-inner';
  inspectorFold.appendChild(inspectorFoldInner);
  inspector.appendChild(inspectorFold);

  const inspectorBody = document.createElement('div');
  inspectorBody.className = 'wfpe-inspector-body';
  inspectorFoldInner.appendChild(inspectorBody);

  // Position + size rows (v2.2). Each input commits on Enter or blur and
  // produces one history entry via the txn machinery; live drag/resize
  // updates the readouts but does not commit (the drag itself owns the
  // history entry).
  function makeInspectorField(prop, axis) {
    const wrap = document.createElement('label');
    wrap.className = 'wfpe-inspector-field';
    const ax = document.createElement('span');
    ax.className = 'wfpe-inspector-field-axis';
    ax.textContent = axis;
    wrap.appendChild(ax);
    const input = document.createElement('input');
    input.type = 'number';
    input.dataset.wfpeProp = prop;
    input.inputMode = 'numeric';
    input.autocomplete = 'off';
    input.spellcheck = false;
    wrap.appendChild(input);
    return { wrap, input };
  }

  function makeInspectorRow(label, fields) {
    const row = document.createElement('div');
    row.className = 'wfpe-inspector-row';
    const lab = document.createElement('span');
    lab.className = 'wfpe-inspector-row-label';
    lab.textContent = label;
    row.appendChild(lab);
    const pair = document.createElement('div');
    pair.className = 'wfpe-inspector-pair';
    for (const f of fields) pair.appendChild(f.wrap);
    row.appendChild(pair);
    return row;
  }

  const fieldX = makeInspectorField('x', 'X');
  const fieldY = makeInspectorField('y', 'Y');
  const fieldW = makeInspectorField('w', 'W');
  const fieldH = makeInspectorField('h', 'H');
  const inspectorInputs = {
    x: fieldX.input,
    y: fieldY.input,
    w: fieldW.input,
    h: fieldH.input,
    fontSize: null, // assigned after the font-size row is built below
    opacity: null, // assigned after the opacity row is built below
  };

  // Font row (v2.3, restyled for ink-glass 3b): a standard 66px-label
  // grid row with a −/field/+ stepper. Design 3b drops the slider.
  // Renders only for text-bearing elements. History contract: input
  // commit (Enter/blur) = one entry, ± click = one entry.
  const fontSizeRow = document.createElement('div');
  fontSizeRow.className = 'wfpe-inspector-row';
  fontSizeRow.dataset.wfpeRow = 'font-size';

  const fontSizeRowLabel = document.createElement('span');
  fontSizeRowLabel.className = 'wfpe-inspector-row-label';
  fontSizeRowLabel.textContent = 'Font';
  fontSizeRow.appendChild(fontSizeRowLabel);

  const fontControl = document.createElement('div');
  fontControl.className = 'wfpe-font-control';

  const fontMinusBtn = document.createElement('button');
  fontMinusBtn.type = 'button';
  fontMinusBtn.className = 'wfpe-font-btn';
  fontMinusBtn.dataset.action = 'font-minus';
  fontMinusBtn.title = 'Decrease font size';
  fontMinusBtn.setAttribute('aria-label', 'Decrease font size');
  fontMinusBtn.textContent = '−';
  fontControl.appendChild(fontMinusBtn);

  const fieldFontSize = makeInspectorField('fontSize', '');
  // The font-size input has no axis label — the row label says "Font".
  fieldFontSize.wrap.querySelector('.wfpe-inspector-field-axis').remove();
  fieldFontSize.input.min = String(FONT_SIZE_MIN_PX);
  const fontUnit = document.createElement('span');
  fontUnit.className = 'wfpe-font-unit';
  fontUnit.textContent = 'px';
  fieldFontSize.wrap.appendChild(fontUnit);
  fontControl.appendChild(fieldFontSize.wrap);

  const fontPlusBtn = document.createElement('button');
  fontPlusBtn.type = 'button';
  fontPlusBtn.className = 'wfpe-font-btn';
  fontPlusBtn.dataset.action = 'font-plus';
  fontPlusBtn.title = 'Increase font size';
  fontPlusBtn.setAttribute('aria-label', 'Increase font size');
  fontPlusBtn.textContent = '+';
  fontControl.appendChild(fontPlusBtn);

  fontSizeRow.appendChild(fontControl);
  inspectorInputs.fontSize = fieldFontSize.input;

  // Typography section (ink-glass 3b): Weight + Align segmented controls.
  // Both follow the font row's text-bearing visibility rule and commit
  // through the same inspector-txn path (one history entry per click).
  function makeSegRow(rowKey, label, items) {
    const row = document.createElement('div');
    row.className = 'wfpe-inspector-row';
    row.dataset.wfpeRow = rowKey;
    const lab = document.createElement('span');
    lab.className = 'wfpe-inspector-row-label';
    lab.textContent = label;
    row.appendChild(lab);
    const seg = document.createElement('div');
    seg.className = 'wfpe-seg';
    const buttons = items.map((item) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'wfpe-seg-item';
      b.dataset.action = item.action;
      b.dataset.wfpeValue = item.value;
      b.dataset.active = 'false';
      b.title = item.hint;
      b.setAttribute('aria-label', item.hint);
      if (item.iconKey) b.innerHTML = ICONS[item.iconKey];
      else b.textContent = item.label;
      seg.appendChild(b);
      return b;
    });
    row.appendChild(seg);
    return { row, buttons };
  }

  const weightRow = makeSegRow('font-weight', 'Weight', [
    { action: 'font-weight', value: '400', label: 'Reg', hint: 'Regular (400)' },
    { action: 'font-weight', value: '500', label: 'Med', hint: 'Medium (500)' },
    { action: 'font-weight', value: '700', label: 'Bold', hint: 'Bold (700)' },
  ]);
  const alignRow = makeSegRow('text-align', 'Align', [
    { action: 'text-align', value: 'left', iconKey: 'alignLeft', hint: 'Align left' },
    { action: 'text-align', value: 'center', iconKey: 'alignCenter', hint: 'Align center' },
    { action: 'text-align', value: 'right', iconKey: 'alignRight', hint: 'Align right' },
  ]);

  // Dividers bracket the typography section (Size ▸ | Font/Weight/Align | ▸
  // colours). They hide with the section for non-text selections so the
  // panel doesn't show a doubled rule.
  function makeInspectorDivider() {
    const d = document.createElement('div');
    d.className = 'wfpe-inspector-divider';
    return d;
  }
  const typographyDividerTop = makeInspectorDivider();
  const typographyDividerBottom = makeInspectorDivider();

  inspectorBody.appendChild(makeInspectorRow('Position', [fieldX, fieldY]));
  inspectorBody.appendChild(makeInspectorRow('Size', [fieldW, fieldH]));
  inspectorBody.appendChild(typographyDividerTop);
  inspectorBody.appendChild(fontSizeRow);
  inspectorBody.appendChild(weightRow.row);
  inspectorBody.appendChild(alignRow.row);
  inspectorBody.appendChild(typographyDividerBottom);

  // Colour rows (v2.4). Text colour for text-bearing only; background
  // colour for any selection. Each row composes a swatch (clickable
  // trigger for the hidden native picker), a hex text input, and — for
  // background only — a "transparent" clear button.
  function makeColourRow({ label, target, prop, includeClear }) {
    const row = document.createElement('div');
    row.className = 'wfpe-inspector-row';
    row.dataset.wfpeRow = target === 'text' ? 'text-color' : 'bg-color';

    const lab = document.createElement('span');
    lab.className = 'wfpe-inspector-row-label';
    lab.textContent = label;
    row.appendChild(lab);

    const control = document.createElement('div');
    control.className = 'wfpe-color-control';

    const swatch = document.createElement('button');
    swatch.type = 'button';
    swatch.className = 'wfpe-color-swatch';
    swatch.dataset.wfpeTarget = target;
    swatch.title = `${label} — pick`;

    // Native colour picker behind the swatch. The swatch's own click
    // triggers the picker programmatically; the picker itself is
    // pointer-events: none so the swatch wins the click.
    const colorInput = document.createElement('input');
    colorInput.type = 'color';
    colorInput.dataset.wfpeTarget = target;
    swatch.appendChild(colorInput);
    control.appendChild(swatch);

    const hexField = document.createElement('label');
    hexField.className = 'wfpe-inspector-field';
    const hexInput = document.createElement('input');
    hexInput.type = 'text';
    hexInput.dataset.wfpeProp = prop;
    hexInput.spellcheck = false;
    hexInput.autocomplete = 'off';
    hexInput.style.width = '64px';
    hexField.appendChild(hexInput);
    control.appendChild(hexField);

    let clearBtn = null;
    if (includeClear) {
      clearBtn = document.createElement('button');
      clearBtn.type = 'button';
      clearBtn.className = 'wfpe-color-clear';
      clearBtn.dataset.wfpeTarget = target;
      clearBtn.title = 'Clear (transparent)';
      clearBtn.setAttribute('aria-label', 'Clear background colour');
      clearBtn.textContent = '×';
      control.appendChild(clearBtn);
    }

    row.appendChild(control);
    return { row, swatch, colorInput, hexInput, clearBtn };
  }

  const textColourRow = makeColourRow({
    label: 'Text colour',
    target: 'text',
    prop: 'textColorHex',
    includeClear: false,
  });
  const bgColourRow = makeColourRow({
    label: 'Background',
    target: 'bg',
    prop: 'bgColorHex',
    includeClear: true,
  });
  inspectorBody.appendChild(textColourRow.row);
  inspectorBody.appendChild(bgColourRow.row);

  // Opacity row (v2.9). Renders for every selection. Layout matches the
  // font-size row: label on its own line, then [input·%][slider]. No
  // ± stepper buttons — opacity has a bounded 0–100 range so the slider
  // is the primary control, with the input for keyboard precision.
  // History contract: input commit (Enter/blur) = one entry, slider
  // drag (mousedown→mouseup) = one entry.
  const opacityRow = document.createElement('div');
  opacityRow.className = 'wfpe-inspector-row';
  opacityRow.dataset.wfpeRow = 'opacity';

  const opacityRowLabel = document.createElement('span');
  opacityRowLabel.className = 'wfpe-inspector-row-label';
  opacityRowLabel.textContent = 'Opacity';
  opacityRow.appendChild(opacityRowLabel);

  const opacityControl = document.createElement('div');
  opacityControl.className = 'wfpe-opacity-control';

  const fieldOpacity = makeInspectorField('opacity', '');
  fieldOpacity.wrap.querySelector('.wfpe-inspector-field-axis').remove();
  fieldOpacity.input.min = '0';
  fieldOpacity.input.max = '100';
  const opacityUnit = document.createElement('span');
  opacityUnit.className = 'wfpe-opacity-unit';
  opacityUnit.textContent = '%';
  fieldOpacity.wrap.appendChild(opacityUnit);
  opacityControl.appendChild(fieldOpacity.wrap);

  const opacitySlider = document.createElement('input');
  opacitySlider.type = 'range';
  opacitySlider.className = 'wfpe-opacity-slider';
  opacitySlider.dataset.wfpeProp = 'opacitySlider';
  opacitySlider.min = '0';
  opacitySlider.max = '100';
  opacitySlider.step = '1';
  opacityControl.appendChild(opacitySlider);

  opacityRow.appendChild(opacityControl);
  inspectorBody.appendChild(opacityRow);
  inspectorInputs.opacity = fieldOpacity.input;

  const annotationRow = document.createElement('div');
  annotationRow.className = 'wfpe-inspector-row';
  annotationRow.dataset.wfpeRow = 'annotation';

  const annotationLabel = document.createElement('span');
  annotationLabel.className = 'wfpe-inspector-row-label';
  annotationLabel.textContent = 'Agent note';
  annotationRow.appendChild(annotationLabel);

  const annotationTextarea = document.createElement('textarea');
  annotationTextarea.className = 'wfpe-annotation-input';
  annotationTextarea.dataset.wfpeProp = 'annotation';
  annotationTextarea.placeholder = 'Instruction for agent cleanup';
  annotationTextarea.spellcheck = true;
  annotationRow.appendChild(annotationTextarea);

  const annotationActions = document.createElement('div');
  annotationActions.className = 'wfpe-annotation-actions';

  const annotationStatus = document.createElement('span');
  annotationStatus.className = 'wfpe-annotation-status';
  annotationActions.appendChild(annotationStatus);

  const annotationDeleteBtn = document.createElement('button');
  annotationDeleteBtn.type = 'button';
  annotationDeleteBtn.className = 'wfpe-annotation-delete-btn';
  annotationDeleteBtn.dataset.action = 'delete-annotation';
  annotationDeleteBtn.textContent = 'Delete';
  annotationDeleteBtn.title = 'Delete agent note';
  annotationActions.appendChild(annotationDeleteBtn);

  const annotationSaveBtn = document.createElement('button');
  annotationSaveBtn.type = 'button';
  annotationSaveBtn.className = 'wfpe-annotation-save-btn';
  annotationSaveBtn.dataset.action = 'save-annotation';
  annotationSaveBtn.textContent = 'Save';
  annotationSaveBtn.title = 'Save agent note';
  annotationActions.appendChild(annotationSaveBtn);

  annotationRow.appendChild(annotationActions);
  inspectorBody.appendChild(annotationRow);

  // Element action row. Duplicate/delete/reset live together to avoid
  // growing the inspector vertically as structural actions are added.
  const actionRow = document.createElement('div');
  actionRow.className = 'wfpe-action-row';
  actionRow.dataset.wfpeRow = 'actions';
  const duplicateBtn = document.createElement('button');
  duplicateBtn.type = 'button';
  duplicateBtn.className = 'wfpe-action-btn wfpe-duplicate-btn';
  duplicateBtn.dataset.action = 'duplicate-element';
  duplicateBtn.innerHTML = ICONS.copy + '<span>Duplicate</span>';
  duplicateBtn.title = 'Duplicate selected element';
  actionRow.appendChild(duplicateBtn);

  const deleteBtn = document.createElement('button');
  deleteBtn.type = 'button';
  deleteBtn.className = 'wfpe-action-btn wfpe-delete-btn';
  deleteBtn.dataset.action = 'delete-element';
  deleteBtn.innerHTML = ICONS.trash + '<span>Delete</span>';
  deleteBtn.title = 'Delete selected element';
  actionRow.appendChild(deleteBtn);

  // Reset action (v2.5). Clears the selected element's entire inline style
  // attribute as one history entry, returning it to its stylesheet-
  // defined rendering. No-op (no history entry) if the element has no
  // inline style to clear.
  const resetBtn = document.createElement('button');
  resetBtn.type = 'button';
  resetBtn.className = 'wfpe-action-btn wfpe-reset-btn';
  resetBtn.dataset.action = 'reset-styles';
  resetBtn.innerHTML = ICONS.refresh + '<span>Reset</span>';
  resetBtn.title = 'Clear all inline style overrides on the selected element';
  actionRow.appendChild(resetBtn);
  inspectorBody.appendChild(actionRow);

  inspectorDockInner.appendChild(inspector);
  root.appendChild(inspectorDock);

  // Dimension bubble (v2.2): floating "W × H" chip above the selection
  // ring. Tracks the same lifecycle as the ring.
  const dimBubble = document.createElement('div');
  dimBubble.className = 'wfpe-dim-bubble';
  root.appendChild(dimBubble);

  const annotationLayer = document.createElement('div');
  annotationLayer.className = 'wfpe-annotation-layer';
  root.appendChild(annotationLayer);

  const multiBox = document.createElement('div');
  multiBox.className = 'wfpe-multi-box';
  root.appendChild(multiBox);

  const multiOutlineLayer = document.createElement('div');
  multiOutlineLayer.className = 'wfpe-multi-outline-layer';
  root.appendChild(multiOutlineLayer);

  // Overview overlay (v2.1.1) — chrome layer rendered above the deck while
  // overview mode is active. Holds one .wfpe-overview-thumb per slide,
  // each anchored to the slide's getBoundingClientRect with a number
  // badge and (when relevant) the active-slide highlight. Empty + hidden
  // outside overview mode.
  const overviewOverlay = document.createElement('div');
  overviewOverlay.className = 'wfpe-overview-overlay';
  overviewOverlay.dataset.visible = 'false';
  root.appendChild(overviewOverlay);

  // Drop indicator (v2.1.3) — thin vertical bar shown between thumbs
  // during drag, marking where the dragged slide will land on drop.
  const overviewDropIndicator = document.createElement('div');
  overviewDropIndicator.className = 'wfpe-overview-drop-indicator';
  overviewDropIndicator.dataset.visible = 'false';
  root.appendChild(overviewDropIndicator);

  const ring = document.createElement('div');
  ring.className = 'wfpe-selection-ring';
  ring.style.display = 'none';
  root.appendChild(ring);

  const handles = {};
  for (const dir of HANDLE_DIRS) {
    const h = document.createElement('div');
    h.className = `wfpe-handle wfpe-handle-${dir}`;
    h.dataset.wfpeHandle = dir;
    h.style.cursor = HANDLE_CURSORS[dir];
    h.style.display = 'none';
    root.appendChild(h);
    handles[dir] = h;
  }

  document.body.appendChild(root);

  // Toolbar button click handlers. These run in bubble phase after the
  // capture-phase onClick short-circuits on editor-root targets, so they
  // don't interfere with selection/deselection logic.
  badge.addEventListener('click', (e) => {
    e.preventDefault();
    setEditMode(!state.editMode);
  });
  undoBtn.addEventListener('click', (e) => {
    e.preventDefault();
    undo();
  });
  redoBtn.addEventListener('click', (e) => {
    e.preventDefault();
    redo();
  });
  // v2.11 — export action menu (design 4b). Popup opened by the Export
  // button; row 1 is the primary save action (Enter / Cmd+S), row 2 is the
  // legacy clean-copy download.
  function openExportMenu() {
    state.exportMenuOpen = true;
    const r = toolbar.getBoundingClientRect();
    exportMenu.style.top = `${r.bottom + 6}px`;
    exportMenu.style.right = `${Math.max(8, window.innerWidth - r.right)}px`;
    exportMenu.dataset.open = 'true';
    exportBtn.setAttribute('aria-expanded', 'true');
    refreshExportUi();
  }
  function closeExportMenu() {
    state.exportMenuOpen = false;
    exportMenu.dataset.open = 'false';
    exportBtn.setAttribute('aria-expanded', 'false');
  }
  // Single dispatcher for menu row 1, Enter-while-open, and Cmd/Ctrl+S.
  // Task 2: save-in-place is primary; legacy download is the Safari/Firefox
  // fallback when the File System Access API isn't available. saveInPlace()
  // is deliberately not awaited here — this fires from a click/keydown
  // handler and must call the native picker within the same user gesture.
  function triggerPrimaryExport() {
    closeExportMenu();
    if (!canSaveInPlace()) {
      // Safari/Firefox fallback — v2.5 download behaviour.
      if (getAnnotatedElements(document).length > 0) exportHandoffHTML();
      else exportHTML();
      return;
    }
    saveInPlace();
  }
  exportBtn.addEventListener('click', (e) => {
    e.preventDefault();
    if (state.exportMenuOpen) closeExportMenu();
    else openExportMenu();
  });
  exportPrimaryItem.addEventListener('click', (e) => {
    e.preventDefault();
    triggerPrimaryExport();
  });
  exportCleanItem.addEventListener('click', (e) => {
    e.preventDefault();
    closeExportMenu();
    exportHTML();
  });
  // Click-away (capture so host-page handlers can't swallow it first).
  document.addEventListener(
    'mousedown',
    (e) => {
      if (!state.exportMenuOpen) return;
      if (exportMenu.contains(e.target) || exportBtn.contains(e.target)) return;
      closeExportMenu();
    },
    true,
  );
  overviewBtn.addEventListener('click', (e) => {
    e.preventDefault();
    if (isFlatMode()) return;
    setOverviewMode(!state.overviewMode);
  });
  inspectorMinimiseBtn.addEventListener('click', (e) => {
    e.preventDefault();
    setInspectorMinimised(!state.inspectorMinimised);
  });

  // Input commit on Enter / blur. Per-keystroke updates are deliberately
  // not wired — they would either flood the history or require batching
  // on every change. Enter and blur are the natural commit points.
  //
  // Each input snapshots `state.selected` at focus-time on its own dataset
  // so the deferred commit on blur targets the element the user was
  // actually editing — not whichever element happens to be selected by
  // the time blur fires (a mousedown on a different slide element runs
  // setSelected before the prior input's blur dispatches).
  let revertingInput = null;
  for (const [prop, input] of Object.entries(inspectorInputs)) {
    input.addEventListener('focus', () => {
      input.__wfpeFocusTarget = state.selected || null;
    });
    input.addEventListener('keydown', (e) => {
      // Stop propagation so editor-level shortcuts (E toggle, arrow nudge,
      // Cmd+Z, etc.) don't fire while typing in the inspector.
      e.stopPropagation();
      if (e.key === 'Enter') {
        e.preventDefault();
        commitInspectorInput(prop, input.value, input.__wfpeFocusTarget);
        input.blur();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        // Revert by repopulating from the live element, then blur. The
        // revertingInput flag suppresses the blur's commit so the no-op
        // path stays explicit rather than implicit-via-equality.
        revertingInput = input;
        populateInspector(state.selected);
        input.blur();
      }
    });
    input.addEventListener('blur', () => {
      const target = input.__wfpeFocusTarget;
      input.__wfpeFocusTarget = null;
      if (revertingInput === input) {
        revertingInput = null;
        return;
      }
      commitInspectorInput(prop, input.value, target);
    });
  }

  // Toolbar collapse chevron (ink-glass 3b) — pure chrome state, no
  // interaction with edit/overview modes or history.
  toolbarCollapseBtn.addEventListener('click', (e) => {
    e.preventDefault();
    setToolbarCollapsed(!state.toolbarCollapsed);
  });

  // Typography segmented controls (ink-glass 3b). Same commit contract
  // as the font-size ± buttons: one history entry per click via the
  // inspector-txn isolation helpers, no-op guarded against the computed
  // style so re-clicking the active segment doesn't pollute history.
  function commitSegStyle(styleProp, value) {
    const el = state.selected;
    if (!el || !isTextBearing(el)) return;
    const cs = getComputedStyle(el);
    const current = styleProp === 'fontWeight'
      ? normalizeFontWeight(cs.fontWeight)
      : normalizeTextAlign(cs.textAlign);
    if (current === value) return;
    const ctx = startInspectorTxn();
    touchElement(el);
    el.style[styleProp] = value;
    endInspectorTxn(ctx);
    populateTypography(el);
    refreshSelection();
  }
  for (const b of weightRow.buttons) {
    b.addEventListener('click', (e) => {
      e.preventDefault();
      commitSegStyle('fontWeight', b.dataset.wfpeValue);
    });
  }
  for (const b of alignRow.buttons) {
    b.addEventListener('click', (e) => {
      e.preventDefault();
      commitSegStyle('textAlign', b.dataset.wfpeValue);
    });
  }

  // Opacity slider — same one-entry-per-drag contract as font-size.
  let opacitySliderTarget = null;
  let opacitySliderRestoreCtx = null;
  opacitySlider.addEventListener('mousedown', () => {
    const el = state.selected;
    if (!el) return;
    opacitySliderTarget = el;
    opacitySliderRestoreCtx = startInspectorTxn();
    touchElement(el);
  });
  opacitySlider.addEventListener('input', () => {
    if (!opacitySliderTarget) return;
    const el = opacitySliderTarget;
    const pct = Math.max(0, Math.min(100, parseFloat(opacitySlider.value)));
    el.style.opacity = String(pct / 100);
    populateOpacity(el);
  });
  const endOpacityDrag = () => {
    if (!opacitySliderTarget) return;
    opacitySliderTarget = null;
    const ctx = opacitySliderRestoreCtx;
    opacitySliderRestoreCtx = null;
    endInspectorTxn(ctx);
  };
  opacitySlider.addEventListener('mouseup', endOpacityDrag);
  opacitySlider.addEventListener('change', endOpacityDrag);
  opacitySlider.addEventListener('keydown', (e) => e.stopPropagation());

  // ± buttons — one history entry per click.
  fontMinusBtn.addEventListener('click', (e) => {
    e.preventDefault();
    nudgeFontSizeWithHistory(-1);
  });
  fontPlusBtn.addEventListener('click', (e) => {
    e.preventDefault();
    nudgeFontSizeWithHistory(+1);
  });

  // ----- Colour controls (v2.4) -----
  // Swatch click programmatically opens the hidden native picker.
  // Picker `input` events apply live within an open isolation context;
  // `change` closes it so a full pick session = one history entry.
  // The isolation context also keeps the entry distinct from any
  // open text-edit (v2.6). The `open` flag is the session sentinel —
  // `restoreCtx` itself can legitimately be null (no text-edit to
  // restore), so we can't reuse null as "no session in progress".
  const pickerSession = {
    text: { open: false, restoreCtx: null, inlineSpan: null },
    bg: { open: false, restoreCtx: null, inlineSpan: null },
  };
  function wireColourRow({ swatch, colorInput, hexInput, clearBtn }, target) {
    // The native colour input sits over the swatch as the actual click
    // target (pointer-events: auto, opacity: 0). No swatch-level click
    // handler — letting the browser open the picker on a real user click
    // is more reliable than calling .click() programmatically.
    colorInput.addEventListener('input', () => {
      const el = state.selected;
      if (!el) return;
      if (target === 'text' && !isTextBearing(el)) return;
      const norm = parseHexInput(colorInput.value);
      if (!norm) return;
      const textRange = target === 'text' && state.editingText && state.editingText.el === el
        ? getTextColourRange(el)
        : null;
      if (!pickerSession[target].open) {
        pickerSession[target].open = true;
        pickerSession[target].inlineSpan = null;
        pickerSession[target].restoreCtx = startInspectorTxn({ captureHtml: !!textRange });
        touchElement(el);
      }
      if (target === 'text' && state.editingText && state.editingText.el === el) {
        pickerSession[target].inlineSpan = applyTextColourToRange(el, norm, pickerSession[target].inlineSpan);
      } else {
        applyColorToElement(el, target, norm);
      }
      populateColours(el);
    });
    colorInput.addEventListener('change', () => {
      if (!pickerSession[target].open) return;
      const ctx = pickerSession[target].restoreCtx;
      pickerSession[target].open = false;
      pickerSession[target].restoreCtx = null;
      pickerSession[target].inlineSpan = null;
      endInspectorTxn(ctx);
    });
    hexInput.addEventListener('focus', () => {
      hexInput.__wfpeFocusTarget = state.selected || null;
      hexInput.__wfpeDirty = false;
    });
    hexInput.addEventListener('input', () => {
      hexInput.__wfpeDirty = true;
    });
    hexInput.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        e.preventDefault();
        if (hexInput.__wfpeDirty) commitColourHex(target, hexInput.value, hexInput.__wfpeFocusTarget);
        hexInput.__wfpeSkipNextBlurCommit = true;
        hexInput.blur();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        revertingInput = hexInput;
        populateColours(state.selected);
        hexInput.blur();
      }
    });
    hexInput.addEventListener('blur', () => {
      const targetEl = hexInput.__wfpeFocusTarget;
      hexInput.__wfpeFocusTarget = null;
      if (hexInput.__wfpeSkipNextBlurCommit) {
        hexInput.__wfpeSkipNextBlurCommit = false;
        return;
      }
      if (revertingInput === hexInput) { revertingInput = null; return; }
      if (!hexInput.__wfpeDirty) return;
      commitColourHex(target, hexInput.value, targetEl);
    });
    if (clearBtn) {
      clearBtn.addEventListener('click', (e) => {
        e.preventDefault();
        const el = state.selected;
        if (!el) return;
        // Only meaningful if there's an inline colour to clear.
        const cssProp = target === 'text' ? 'color' : 'backgroundColor';
        if (!el.style[cssProp]) return;
        const ctx = startInspectorTxn();
        touchElement(el);
        el.style[cssProp] = '';
        endInspectorTxn(ctx);
        populateColours(el);
      });
    }
  }
  wireColourRow(textColourRow, 'text');
  wireColourRow(bgColourRow, 'bg');

  annotationTextarea.addEventListener('focus', () => {
    annotationTextarea.__wfpeFocusTarget = state.selected || null;
  });
  annotationTextarea.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Escape') {
      e.preventDefault();
      populateAnnotation(state.selected, { force: true });
      annotationTextarea.blur();
    }
  });
  annotationSaveBtn.addEventListener('click', (e) => {
    e.preventDefault();
    saveAnnotation(getAnnotationEditorTarget(), annotationTextarea.value);
  });
  annotationTextarea.addEventListener('input', () => {
    updateAnnotationDraftStatus(getAnnotationEditorTarget());
  });
  annotationDeleteBtn.addEventListener('click', (e) => {
    e.preventDefault();
    deleteAnnotation(getAnnotationEditorTarget());
  });
  annotationLayer.addEventListener('click', (e) => {
    const badgeEl = e.target && e.target.closest ? e.target.closest('.wfpe-annotation-badge') : null;
    if (!badgeEl) return;
    e.preventDefault();
    e.stopPropagation();
    const target = findAnnotationElementById(badgeEl.dataset.annotationId || '');
    if (!target) return;
    setEditMode(true);
    setSelected(target);
    refreshSelection();
    refreshInspector();
  });

  // Reset clears the entire inline style attribute as one history entry.
  // Bail when there's nothing to clear so an idle click can't push a
  // no-op entry. The snapshot/endTxn pair captures and restores the
  // attribute via the existing snapshot machinery.
  resetBtn.addEventListener('click', (e) => {
    e.preventDefault();
    const el = state.selected;
    if (!el) return;
    if (!el.hasAttribute('style')) return; // nothing to reset
    const ctx = startInspectorTxn();
    touchElement(el);
    el.removeAttribute('style');
    endInspectorTxn(ctx);
    refreshSelection();
  });
  duplicateBtn.addEventListener('click', (e) => {
    e.preventDefault();
    duplicateSelected();
  });
  deleteBtn.addEventListener('click', (e) => {
    e.preventDefault();
    deleteSelectedElement();
  });
  applyModeFeatureGating();
  reimportHandoffAnnotations();
  refreshExportUi();
  // ===========================================================================
  // Helpers
  // ===========================================================================
  function isInsideEditorRoot(el) {
    return !!el && root.contains(el);
  }

  function isPointInsideElementBox(el, x, y) {
    if (!el || getComputedStyle(el).display === 'none') return false;
    const rect = el.getBoundingClientRect();
    return (
      rect.width > 0 &&
      rect.height > 0 &&
      x >= rect.left &&
      x <= rect.right &&
      y >= rect.top &&
      y <= rect.bottom
    );
  }

  function isPointInsidePassiveEditorSurface(e) {
    if (!e) return false;
    return (
      isPointInsideElementBox(toolbar, e.clientX, e.clientY) ||
      isPointInsideElementBox(inspector, e.clientX, e.clientY)
    );
  }

  function markResolvedRoot(resolvedRoot, mode) {
    if (!resolvedRoot) return;
    resolvedRoot.setAttribute('data-wfp-edit-deck-root', 'true');
    if (mode === 'flat') {
      resolvedRoot.setAttribute('data-wfp-edit-flat-root', 'true');
    }
  }

  function ensureFlatPositionContext(flatRoot) {
    if (!flatRoot) return;
    if (getComputedStyle(flatRoot).position === 'static') {
      flatRoot.setAttribute('data-wfp-edit-flat-position-context', 'true');
    }
  }

  function resolveNativeDeckRoot() {
    return document.querySelector('.deck');
  }

  function resolveForeignDeckRoot() {
    const counts = new Map();
    document.querySelectorAll('.slide').forEach((slide) => {
      const parent = slide.parentElement;
      if (!parent) return;
      counts.set(parent, (counts.get(parent) || 0) + 1);
    });

    let bestRoot = null;
    let bestCount = 0;
    counts.forEach((count, parent) => {
      if (count > bestCount) {
        bestRoot = parent;
        bestCount = count;
      }
    });
    return bestRoot;
  }

  function getFlatRootOverride() {
    const override = window.__WFP_EDIT_ROOT__;
    if (typeof override !== 'string' || !override.trim()) return null;
    try {
      const el = document.querySelector(override);
      return el instanceof Element ? el : null;
    } catch (_) {
      return null;
    }
  }

  function isDominantBodyWrapperCandidate(el) {
    if (!el || el.id === ROOT_ID) return false;
    return !['SCRIPT', 'STYLE', 'LINK', 'META', 'NOSCRIPT', 'TEMPLATE'].includes(el.tagName);
  }

  function resolveFlatRoot() {
    const override = getFlatRootOverride();
    if (override) return override;
    const main = document.querySelector('main');
    if (main) return main;
    const article = document.querySelector('article');
    if (article) return article;
    const bodyChildren = [...document.body.children].filter(isDominantBodyWrapperCandidate);
    if (bodyChildren.length === 1) return bodyChildren[0];
    return document.body;
  }

  function resolveDeckRoot() {
    const nativeRoot = resolveNativeDeckRoot();
    if (nativeRoot) {
      markResolvedRoot(nativeRoot, 'native');
      return { mode: 'native', root: nativeRoot };
    }

    const foreignRoot = resolveForeignDeckRoot();
    if (foreignRoot) {
      markResolvedRoot(foreignRoot, 'foreign');
      return { mode: 'foreign', root: foreignRoot };
    }

    const flatRoot = resolveFlatRoot();
    markResolvedRoot(flatRoot, 'flat');
    ensureFlatPositionContext(flatRoot);
    return { mode: 'flat', root: flatRoot };
  }

  function getDocumentMode() {
    return deckContext.mode;
  }

  function isFlatMode() {
    return getDocumentMode() === 'flat';
  }

  function applyModeFeatureGating() {
    if (!isFlatMode()) return;
    overviewBtn.hidden = true;
    overviewBtn.disabled = true;
    overviewBtn.setAttribute('aria-hidden', 'true');
    overviewBtn.dataset.mode = 'off';
    toolbar.dataset.overviewMode = 'off';
  }

  function getDeckRoot() {
    return deckContext.root;
  }

  function getSlides() {
    const deckRoot = getDeckRoot();
    if (!deckRoot) return [];
    if (getDocumentMode() === 'flat') return [deckRoot];
    return [...deckRoot.querySelectorAll(':scope > .slide')];
  }

  function getActiveSlide() {
    if (getDocumentMode() === 'flat') return getDeckRoot();
    return getSlides().find((slide) => slide.classList.contains('active')) || null;
  }

  function findSelectableTarget(el) {
    if (!el || isInsideEditorRoot(el)) return null;
    const slide = getActiveSlide();
    if (!slide) return null;
    if (el === slide) return null;
    if (el === getDeckRoot()) return null;
    if (!slide.contains(el)) return null;
    return el;
  }

  function isSelectionToggleEvent(e) {
    return !!e && (e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey;
  }

  function selectionArraysEqual(a, b) {
    if (a.length !== b.length) return false;
    return a.every((el, i) => el === b[i]);
  }

  function normalizeSelectionElements(elements) {
    const slide = getActiveSlide();
    if (!slide) return [];
    const out = [];
    for (const el of elements || []) {
      if (!el || !el.isConnected || !slide.contains(el)) continue;
      if (el === slide || el === getDeckRoot()) continue;
      if (isInsideEditorRoot(el)) continue;
      if (!out.includes(el)) out.push(el);
    }
    return out;
  }

  function getSelectedElements() {
    const source = state.selectedElements && state.selectedElements.length
      ? state.selectedElements
      : (state.selected ? [state.selected] : []);
    return normalizeSelectionElements(source);
  }

  function hasMultiSelection() {
    return getSelectedElements().length > 1;
  }

  function toggleSelectedElement(target) {
    if (!target) return;
    const current = getSelectedElements();
    const existingIndex = current.indexOf(target);
    let next;
    let primary = target;
    if (existingIndex >= 0) {
      next = current.filter((el) => el !== target);
      primary = next[next.length - 1] || null;
    } else {
      next = current.filter((el) => !el.contains(target) && !target.contains(el));
      next.push(target);
    }
    setSelectedElements(next, primary);
  }

  function stripEditorArtifactsFrom(el) {
    if (!el) return;
    const nodes = [el, ...el.querySelectorAll('*')];
    for (const node of nodes) {
      for (const attr of [...node.attributes]) {
        if (
          attr.name.startsWith('data-wfp-edit') ||
          attr.name === HANDOFF_TARGET_ATTR ||
          attr.name === HANDOFF_SCRIPT_ATTR
        ) {
          node.removeAttribute(attr.name);
        }
      }
      if (node.hasAttribute('contenteditable')) node.removeAttribute('contenteditable');
    }
  }

  function collectEditorDataAttributes(el) {
    const attrs = {};
    if (!el || !el.attributes) return attrs;
    for (const attr of [...el.attributes]) {
      if (attr.name.startsWith('data-wfp-edit')) attrs[attr.name] = attr.value;
    }
    return attrs;
  }

  function applyEditorDataAttributes(el, attrs) {
    if (!el) return;
    for (const attr of [...el.attributes]) {
      if (attr.name.startsWith('data-wfp-edit')) el.removeAttribute(attr.name);
    }
    for (const [name, value] of Object.entries(attrs || {})) {
      el.setAttribute(name, value);
    }
  }

  function editorDataAttributesEqual(a, b) {
    const aKeys = Object.keys(a || {}).sort();
    const bKeys = Object.keys(b || {}).sort();
    if (aKeys.length !== bKeys.length) return false;
    return aKeys.every((key, index) => key === bKeys[index] && a[key] === b[key]);
  }

  function normalizeAnnotationText(raw) {
    return typeof raw === 'string' ? raw.trim() : '';
  }

  function getAnnotationId(el) {
    return el ? (el.getAttribute(ANNOTATION_ID_ATTR) || '') : '';
  }

  function getAnnotationText(el) {
    return normalizeAnnotationText(el ? el.getAttribute(ANNOTATION_TEXT_ATTR) : '');
  }

  function hasAnnotation(el) {
    return !!getAnnotationId(el) && !!getAnnotationText(el);
  }

  function generateAnnotationId() {
    const time = Date.now().toString(36);
    const rand = Math.random().toString(36).slice(2, 8);
    return `ann-${time}-${rand}`;
  }

  function getAnnotatedElements(rootNode = document) {
    const rootEl = rootNode.documentElement || rootNode;
    const nodes = rootEl ? [...rootEl.querySelectorAll(`[${ANNOTATION_ID_ATTR}][${ANNOTATION_TEXT_ATTR}]`)] : [];
    return nodes.filter((el) => hasAnnotation(el));
  }

  function findAnnotationElementById(id) {
    if (!id) return null;
    return getAnnotatedElements(document).find((el) => getAnnotationId(el) === id) || null;
  }

  function updateAnnotationDraftStatus(el) {
    if (!annotationStatus) return;
    const visible = !!el && getSelectedElements().length === 1;
    if (!visible) {
      annotationRow.dataset.hasNote = 'false';
      annotationRow.dataset.dirty = 'false';
      annotationStatus.textContent = '';
      return;
    }
    const savedText = getAnnotationText(el);
    const draftText = normalizeAnnotationText(annotationTextarea.value);
    const hasSaved = hasAnnotation(el);
    const dirty = draftText !== savedText;
    annotationRow.dataset.hasNote = hasSaved ? 'true' : 'false';
    annotationRow.dataset.dirty = dirty ? 'true' : 'false';
    if (dirty) {
      annotationStatus.textContent = draftText ? 'Unsaved' : (hasSaved ? 'Will delete' : '');
    } else {
      annotationStatus.textContent = hasSaved ? 'Saved' : '';
    }
  }

  function getAnnotationEditorTarget() {
    const selected = getSelectedElements();
    if (
      selected.length === 1 &&
      selected[0] &&
      selected[0].isConnected &&
      !state.overviewMode
    ) {
      return selected[0];
    }
    return (
      annotationRow.__wfpeTarget &&
      annotationRow.__wfpeTarget.isConnected
    ) ? annotationRow.__wfpeTarget : null;
  }

  function isAnnotationMarkerVisibleFor(el, activeSlide) {
    if (!el || !el.isConnected || isInsideEditorRoot(el)) return false;
    const slide = el.closest('.slide');
    if (activeSlide && slide && slide !== activeSlide) return false;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 && rect.height <= 0) return false;
    return rect.right >= 0 && rect.bottom >= 0 && rect.left <= window.innerWidth && rect.top <= window.innerHeight;
  }

  function positionAnnotationBadge(marker, rect) {
    const markerWidth = 16;
    const markerHeight = 16;
    const left = Math.max(4, Math.min(window.innerWidth - markerWidth - 4, rect.right - markerWidth + 6));
    const preferredTop = rect.top - 8;
    const top = preferredTop >= 4 ? preferredTop : Math.min(window.innerHeight - markerHeight - 4, rect.top + 4);
    marker.style.left = `${left}px`;
    marker.style.top = `${Math.max(4, top)}px`;
  }

  function refreshAnnotationMarkers() {
    if (!annotationLayer) return;
    if (!state.editMode || state.overviewMode) {
      annotationLayer.replaceChildren();
      return;
    }
    const activeSlide = getActiveSlide();
    const annotated = getAnnotatedElements(document).filter((el) => isAnnotationMarkerVisibleFor(el, activeSlide));
    const existing = new Map(
      [...annotationLayer.querySelectorAll('.wfpe-annotation-badge')]
        .map((marker) => [marker.dataset.annotationId || '', marker])
    );
    const used = new Set();
    for (const el of annotated) {
      const id = getAnnotationId(el);
      const rect = el.getBoundingClientRect();
      let marker = existing.get(id);
      if (!marker) {
        marker = document.createElement('button');
        marker.type = 'button';
        marker.className = 'wfpe-annotation-badge';
        marker.dataset.annotationId = id;
        marker.setAttribute('aria-label', 'Agent note');
        annotationLayer.appendChild(marker);
      }
      marker.dataset.selected = el === state.selected ? 'true' : 'false';
      marker.textContent = '';
      marker.title = getAnnotationText(el);
      positionAnnotationBadge(marker, rect);
      used.add(marker);
    }
    for (const marker of existing.values()) {
      if (!used.has(marker)) marker.remove();
    }
  }

  function saveAnnotation(targetEl, rawText) {
    const el = (targetEl && targetEl.isConnected) ? targetEl : state.selected;
    if (!el || hasMultiSelection() || state.overviewMode) return false;
    const nextText = normalizeAnnotationText(rawText);
    const currentText = getAnnotationText(el);
    const currentId = getAnnotationId(el);
    if (!nextText && !currentText && !currentId) return false;
    if (nextText && currentText === nextText && currentId) return false;

    const ctx = startInspectorTxn();
    touchElement(el);
    if (!nextText) {
      el.removeAttribute(ANNOTATION_ID_ATTR);
      el.removeAttribute(ANNOTATION_TEXT_ATTR);
    } else {
      el.setAttribute(ANNOTATION_ID_ATTR, currentId || generateAnnotationId());
      el.setAttribute(ANNOTATION_TEXT_ATTR, nextText);
    }
    endInspectorTxn(ctx);
    populateAnnotation(el, { force: true });
    refreshExportUi();
    showToast(el, nextText ? 'Agent note saved.' : 'Agent note deleted.');
    return true;
  }

  function deleteAnnotation(targetEl) {
    const el = (targetEl && targetEl.isConnected) ? targetEl : state.selected;
    if (!el || (!getAnnotationId(el) && !getAnnotationText(el))) return false;
    const ctx = startInspectorTxn();
    touchElement(el);
    el.removeAttribute(ANNOTATION_ID_ATTR);
    el.removeAttribute(ANNOTATION_TEXT_ATTR);
    endInspectorTxn(ctx);
    populateAnnotation(el, { force: true });
    refreshExportUi();
    showToast(el, 'Agent note deleted.');
    return true;
  }

  function populateAnnotation(el, options = {}) {
    const visible = !!el && getSelectedElements().length === 1;
    annotationRow.style.display = visible ? '' : 'none';
    if (!visible) {
      annotationRow.__wfpeTarget = null;
      if (document.activeElement !== annotationTextarea) annotationTextarea.value = '';
      annotationDeleteBtn.disabled = true;
      updateAnnotationDraftStatus(null);
      return;
    }
    const targetChanged = annotationRow.__wfpeTarget !== el;
    const preserveDraft = (
      !options.force &&
      !targetChanged &&
      annotationRow.dataset.dirty === 'true'
    );
    annotationRow.__wfpeTarget = el;
    const text = getAnnotationText(el);
    if (options.force || targetChanged || (!preserveDraft && document.activeElement !== annotationTextarea)) {
      annotationTextarea.value = text;
    }
    annotationDeleteBtn.disabled = !hasAnnotation(el);
    updateAnnotationDraftStatus(el);
  }

  function refreshExportUi() {
    const count = getAnnotatedElements(document).length;
    exportBadge.dataset.count = String(count);
    exportBadge.textContent = count > 0 ? String(count) : '';
    const label = exportPrimaryItem.querySelector('.wfpe-export-menu-label');
    const sub = exportPrimaryItem.querySelector('.wfpe-export-menu-sub');
    if (count > 0) {
      label.textContent = 'Annotated handoff';
      sub.textContent = `Includes ${count} agent note${count === 1 ? '' : 's'}`;
    } else {
      label.textContent = 'Save';
      sub.textContent = 'Edits only';
    }
    if (!canSaveInPlace()) {
      sub.textContent += ' — Downloads';
    }
    const cleanLabel = exportCleanItem.querySelector('.wfpe-export-menu-label');
    const cleanSub = exportCleanItem.querySelector('.wfpe-export-menu-sub');
    cleanLabel.textContent = 'Clean copy';
    cleanSub.textContent = count > 0 ? 'Edits only — notes stripped' : 'Download a copy';
    refreshAnnotationMarkers();
  }

  function parseHandoffPayload() {
    const script = document.querySelector(`script[${HANDOFF_SCRIPT_ATTR}]`);
    if (!script) return null;
    try {
      const payload = JSON.parse(script.textContent || '{}');
      return payload && Array.isArray(payload.annotations) ? payload : null;
    } catch (_) {
      return null;
    }
  }

  function getHandoffTargetsById(rootNode, id) {
    if (!id) return [];
    const rootEl = rootNode.documentElement || rootNode;
    return [...rootEl.querySelectorAll(`[${HANDOFF_TARGET_ATTR}]`)]
      .filter((el) => el.getAttribute(HANDOFF_TARGET_ATTR) === id);
  }

  function removeHandoffArtifacts(rootNode) {
    const rootEl = rootNode.documentElement || rootNode;
    if (!rootEl) return;
    rootEl.querySelectorAll(`script[${HANDOFF_SCRIPT_ATTR}]`).forEach((script) => script.remove());
    [rootEl, ...rootEl.querySelectorAll('*')].forEach((el) => {
      if (el.hasAttribute && el.hasAttribute(HANDOFF_TARGET_ATTR)) el.removeAttribute(HANDOFF_TARGET_ATTR);
    });
    const walker = document.createTreeWalker(rootEl, NodeFilter.SHOW_COMMENT);
    const comments = [];
    let node = walker.nextNode();
    while (node) {
      if ((node.nodeValue || '').includes('WFP Editor handoff:')) comments.push(node);
      node = walker.nextNode();
    }
    comments.forEach((comment) => comment.remove());
  }

  function reimportHandoffAnnotations() {
    const payload = parseHandoffPayload();
    if (!payload) return;
    for (const annotation of payload.annotations) {
      const id = typeof annotation.id === 'string' ? annotation.id : '';
      const instruction = normalizeAnnotationText(annotation.instruction);
      if (!id || !instruction) continue;
      const targets = getHandoffTargetsById(document, id);
      if (!targets.length) continue;
      for (const target of targets) {
        target.setAttribute(ANNOTATION_ID_ATTR, id);
        target.setAttribute(ANNOTATION_TEXT_ATTR, instruction);
      }
    }
    removeHandoffArtifacts(document);
  }

  function getCoordinateRootForElement(el) {
    const slide = el.closest('.slide');
    if (slide && getDeckRoot() && getDeckRoot().contains(slide)) return slide;
    const activeSlide = getActiveSlide();
    if (activeSlide && activeSlide.contains(el)) return activeSlide;
    return getDeckRoot();
  }

  function getSlideBox(el) {
    const coordinateRoot = getCoordinateRootForElement(el);
    const scale = getCanvasScale();
    const elRect = el.getBoundingClientRect();
    const slideRect = coordinateRoot ? coordinateRoot.getBoundingClientRect() : { left: 0, top: 0 };
    const safeScale = scale || 1;
    return {
      left: (elRect.left - slideRect.left) / safeScale,
      top: (elRect.top - slideRect.top) / safeScale,
      width: elRect.width / safeScale,
      height: elRect.height / safeScale,
    };
  }

  function applyExplicitSizeConstraints(el, size) {
    const cs = getComputedStyle(el);
    if (Number.isFinite(size.width)) {
      const maxWidth = parseFloat(cs.maxWidth);
      if (cs.maxWidth !== 'none' && Number.isFinite(maxWidth) && size.width > maxWidth) {
        el.style.maxWidth = 'none';
      }
      const minWidth = parseFloat(cs.minWidth);
      if (Number.isFinite(minWidth) && size.width < minWidth) {
        el.style.minWidth = '0px';
      }
    }
    if (Number.isFinite(size.height)) {
      const maxHeight = parseFloat(cs.maxHeight);
      if (cs.maxHeight !== 'none' && Number.isFinite(maxHeight) && size.height > maxHeight) {
        el.style.maxHeight = 'none';
      }
      const minHeight = parseFloat(cs.minHeight);
      if (Number.isFinite(minHeight) && size.height < minHeight) {
        el.style.minHeight = '0px';
      }
    }
  }

  function serializeElementForClipboard(el) {
    const clone = el.cloneNode(true);
    stripEditorArtifactsFrom(clone);
    const box = getSlideBox(el);
    const computed = getComputedStyle(el);
    const contentWidth = parseFloat(computed.width);
    const contentHeight = parseFloat(computed.height);
    const width = computed.boxSizing === 'border-box'
      ? box.width
      : (Number.isFinite(contentWidth) ? contentWidth : box.width);
    const height = computed.boxSizing === 'border-box'
      ? box.height
      : (Number.isFinite(contentHeight) ? contentHeight : box.height);
    clone.style.position = 'absolute';
    clone.style.left = `${box.left}px`;
    clone.style.top = `${box.top}px`;
    clone.style.width = `${width}px`;
    clone.style.height = `${height}px`;
    return clone.outerHTML;
  }

  function copySelectedElement() {
    const el = state.selected;
    if (hasMultiSelection()) return false;
    if (!el || !el.isConnected) return false;
    state.clipboard = { outerHTML: serializeElementForClipboard(el) };
    return true;
  }

  function parseClipboardElement() {
    if (!state.clipboard || !state.clipboard.outerHTML) return null;
    const template = document.createElement('template');
    template.innerHTML = state.clipboard.outerHTML.trim();
    const el = template.content.firstElementChild;
    if (!el) return null;
    stripEditorArtifactsFrom(el);
    return el;
  }

  function pasteClipboardElement() {
    const slide = getActiveSlide();
    if (!slide) return false;
    const inserted = parseClipboardElement();
    if (!inserted) return false;
    const left = parseFloat(inserted.style.left);
    const top = parseFloat(inserted.style.top);
    inserted.style.position = 'absolute';
    inserted.style.left = `${(Number.isFinite(left) ? left : 0) + 20}px`;
    inserted.style.top = `${(Number.isFinite(top) ? top : 0) + 20}px`;

    const previousSelectedEl = (
      state.selected &&
      state.selected.isConnected &&
      slide.contains(state.selected)
    ) ? state.selected : null;
    slide.appendChild(inserted);
    pushElementInsertEntry({
      type: 'elementInsert',
      slideEl: slide,
      insertedEl: inserted,
      parentEl: slide,
      nextSiblingEl: null,
      previousSelectedEl,
    });
    setSelected(inserted);
    refreshInspector();
    return true;
  }

  function duplicateSelected() {
    if (state.editingText) endTextEdit();
    if (!copySelectedElement()) return false;
    return pasteClipboardElement();
  }

  function deleteSelectedElement() {
    if (state.editingText) endTextEdit();
    if (hasMultiSelection()) return false;
    const el = state.selected;
    if (!el || !el.isConnected || state.overviewMode) return false;
    const parent = el.parentElement;
    const slide = getCoordinateRootForElement(el);
    if (!parent || !slide || !slide.contains(el)) return false;
    const nextSibling = el.nextSibling;
    parent.removeChild(el);
    pushElementInsertEntry({
      type: 'elementDelete',
      slideEl: slide,
      deletedEl: el,
      parentEl: parent,
      nextSiblingEl: nextSibling,
    });
    setSelected(null);
    refreshInspector();
    return true;
  }

  function positionRing(el) {
    const rect = el.getBoundingClientRect();
    ring.style.display = 'block';
    ring.style.top = `${rect.top}px`;
    ring.style.left = `${rect.left}px`;
    ring.style.width = `${rect.width}px`;
    ring.style.height = `${rect.height}px`;
    positionHandles(rect);
  }

  function hideRing() {
    ring.style.display = 'none';
    hideHandles();
  }

  function handleAnchors(rect) {
    return {
      nw: { x: rect.left, y: rect.top },
      n: { x: rect.left + rect.width / 2, y: rect.top },
      ne: { x: rect.left + rect.width, y: rect.top },
      e: { x: rect.left + rect.width, y: rect.top + rect.height / 2 },
      se: { x: rect.left + rect.width, y: rect.top + rect.height },
      s: { x: rect.left + rect.width / 2, y: rect.top + rect.height },
      sw: { x: rect.left, y: rect.top + rect.height },
      w: { x: rect.left, y: rect.top + rect.height / 2 },
    };
  }

  function positionHandles(rect) {
    const anchors = handleAnchors(rect);
    // Use the known handle size per direction so we don't need to read
    // offsetWidth (which would force a layout flush every drag tick).
    for (const dir of HANDLE_DIRS) {
      const a = anchors[dir];
      const h = handles[dir];
      const half = handleSizeFor(dir) / 2;
      h.style.left = `${a.x - half}px`;
      h.style.top = `${a.y - half}px`;
      h.style.display = 'block';
    }
  }

  function hideHandles() {
    for (const dir of HANDLE_DIRS) handles[dir].style.display = 'none';
  }

  function refreshSelection() {
    if (state.editingText) {
      // The selection ring (and the dimension bubble) sitting over a
      // contenteditable target steals visual attention from the caret.
      // Hide both for the duration of the text edit; refreshSelection
      // will re-show them once edit ends.
      hideRing();
      hideHandles();
      hideDimBubble();
      hideMultiSelection();
      refreshAnnotationMarkers();
      stopSelectionTracking();
      return;
    }
    if (clearDisconnectedSelection()) return;
    const members = getSelectedElements();
    if (members.length > 1) {
      hideRing();
      hideHandles();
      hideDimBubble();
      positionMultiSelection(members);
      populateInspector(null);
      refreshAnnotationMarkers();
      startSelectionTracking();
    } else if (members.length === 1) {
      hideMultiSelection();
      state.selected = members[0];
      state.selectedElements = members;
      positionRing(state.selected);
      positionDimBubble(state.selected);
      populateInspector(state.selected);
      refreshAnnotationMarkers();
      startSelectionTracking();
    } else {
      hideRing();
      hideHandles();
      hideDimBubble();
      hideMultiSelection();
      refreshAnnotationMarkers();
      stopSelectionTracking();
    }
  }

  function positionDimBubble(el) {
    const r = el.getBoundingClientRect();
    // Use offsetWidth/Height (unscaled slide coords) so the bubble matches
    // the inspector's W/H readout. r.width/height are post-`transform: scale()`
    // viewport pixels and would diverge from the inline-style values.
    dimBubble.textContent = `${el.offsetWidth} × ${el.offsetHeight}`;
    dimBubble.style.display = 'block';
    // Anchor the bubble centred above the ring with a small gutter; the
    // chip's own height is small (~22px) so a 22px offset clears the
    // ring's stroke without floating off the screen for top-edge selections.
    const top = Math.max(2, r.top - 22);
    const left = r.left + r.width / 2;
    dimBubble.style.top = `${top}px`;
    dimBubble.style.left = `${left}px`;
  }

  function hideDimBubble() {
    dimBubble.style.display = 'none';
  }

  function hideMultiSelection() {
    multiBox.style.display = 'none';
    multiOutlineLayer.replaceChildren();
  }

  function positionMultiSelection(elements) {
    const rects = elements
      .map((el) => el.getBoundingClientRect())
      .filter((r) => r.width > 0 || r.height > 0);
    if (!rects.length) {
      hideMultiSelection();
      return;
    }
    const bounds = rects.reduce((acc, r) => ({
      left: Math.min(acc.left, r.left),
      top: Math.min(acc.top, r.top),
      right: Math.max(acc.right, r.right),
      bottom: Math.max(acc.bottom, r.bottom),
    }), {
      left: rects[0].left,
      top: rects[0].top,
      right: rects[0].right,
      bottom: rects[0].bottom,
    });

    multiBox.style.display = 'block';
    multiBox.style.left = `${bounds.left}px`;
    multiBox.style.top = `${bounds.top}px`;
    multiBox.style.width = `${bounds.right - bounds.left}px`;
    multiBox.style.height = `${bounds.bottom - bounds.top}px`;

    multiOutlineLayer.replaceChildren();
    for (const r of rects) {
      const outline = document.createElement('div');
      outline.className = 'wfpe-multi-outline';
      outline.style.display = 'block';
      outline.style.left = `${r.left}px`;
      outline.style.top = `${r.top}px`;
      outline.style.width = `${r.width}px`;
      outline.style.height = `${r.height}px`;
      multiOutlineLayer.appendChild(outline);
    }
  }

  let selectionRafId = 0;

  function shouldTrackSelection() {
    return (
      state.editMode &&
      !state.overviewMode &&
      !state.editingText &&
      getSelectedElements().length > 0
    );
  }

  function stopSelectionTracking() {
    if (!selectionRafId) return;
    cancelAnimationFrame(selectionRafId);
    selectionRafId = 0;
  }

  function startSelectionTracking() {
    if (selectionRafId || !shouldTrackSelection()) return;
    selectionRafId = requestAnimationFrame(() => {
      selectionRafId = 0;
      if (!shouldTrackSelection()) return;
      refreshSelection();
    });
  }

  function clearDisconnectedSelection() {
    const current = state.selectedElements && state.selectedElements.length
      ? state.selectedElements
      : (state.selected ? [state.selected] : []);
    if (!state.selected && current.length === 0) return false;

    const members = normalizeSelectionElements(current);
    const primary = (state.selected && members.includes(state.selected))
      ? state.selected
      : (members[members.length - 1] || null);
    const changed = state.selected !== primary || !selectionArraysEqual(state.selectedElements, members);
    if (!changed) return false;

    if (state.editingText && state.editingText.el && !members.includes(state.editingText.el)) {
      state.editingText = null;
    }
    state.selected = primary;
    state.selectedElements = primary ? members : [];
    if (!primary) {
      hideRing();
      hideHandles();
      hideDimBubble();
      hideMultiSelection();
      populateInspector(null);
      refreshInspector();
      stopSelectionTracking();
      return true;
    }
    return false;
  }

  function setSelectedElements(elements, primary) {
    // Close any open txn before swapping selection — defends against
    // an orphaned colour-picker txn (input fired without change) being
    // silently bundled with subsequent unrelated edits on the new
    // selection. endTxn no-ops if no element was touched.
    const members = normalizeSelectionElements(elements);
    const nextPrimary = (primary && members.includes(primary))
      ? primary
      : (members[members.length - 1] || null);
    const selectionChanged = (
      state.selected !== nextPrimary ||
      !selectionArraysEqual(state.selectedElements, members)
    );
    if (selectionChanged && state.txn) endTxn();
    state.selected = nextPrimary;
    state.selectedElements = nextPrimary ? members : [];
    if (state.selected) {
      refreshSelection();
    } else {
      hideRing();
      hideHandles();
      hideDimBubble();
      hideMultiSelection();
      populateInspector(null);
      stopSelectionTracking();
    }
    // Inspector visibility is updated by the explicit call sites below
    // (onClick / onMouseUp / setEditMode / slideObserver) rather than from
    // here. If we toggled inspector display:flex synchronously inside a
    // mousedown handler that swaps from "no selection" to "selected", the
    // newly-shown inspector at top-right would intercept the matching
    // mouseup — the browser then fires `click` on the LCA of mousedown
    // and mouseup targets (== body), and onClick can't find the original
    // target. Updating inspector after the mouseup keeps the click cycle
    // against the original DOM.
  }

  function setSelected(el) {
    setSelectedElements(el ? [el] : [], el || null);
  }

  // The typography rows and their bracketing dividers show/hide as one
  // unit so non-text selections don't render a doubled rule between
  // Size and the colour rows.
  function setTypographyRowsVisible(visible) {
    const d = visible ? '' : 'none';
    typographyDividerTop.style.display = d;
    fontSizeRow.style.display = d;
    weightRow.row.style.display = d;
    alignRow.row.style.display = d;
    typographyDividerBottom.style.display = d;
  }

  function populateInspector(el) {
    if (!el) {
      for (const k of ['x', 'y', 'w', 'h', 'fontSize', 'opacity']) {
        if (document.activeElement !== inspectorInputs[k]) inspectorInputs[k].value = '';
      }
      setTypographyRowsVisible(false);
      textColourRow.row.style.display = 'none';
      populateColours(null);
      populateAnnotation(null);
      return;
    }
    // Use offset* values so what the user reads matches the box model
    // the editor writes back to (left/top/width/height in CSS px).
    // Skip the focused input — overwriting it would clobber what the
    // user is currently typing before they commit on Enter/blur.
    const values = {
      x: String(el.offsetLeft),
      y: String(el.offsetTop),
      w: String(el.offsetWidth),
      h: String(el.offsetHeight),
    };
    for (const k of ['x', 'y', 'w', 'h']) {
      if (document.activeElement === inspectorInputs[k]) continue;
      inspectorInputs[k].value = values[k];
    }
    // Typography (font/weight/align) + text-colour rows render only for
    // text-bearing elements (matching BRIEF "Conditional content by
    // selection type"). Background colour and position/size render for
    // any selection.
    if (isTextBearing(el)) {
      setTypographyRowsVisible(true);
      textColourRow.row.style.display = '';
      populateFontSize(el);
      populateTypography(el);
    } else {
      setTypographyRowsVisible(false);
      textColourRow.row.style.display = 'none';
    }
    populateColours(el);
    populateOpacity(el);
    populateAnnotation(el);
  }

  // ---------------------------------------------------------------------------
  // Colour helpers (v2.4). Parse #rgb / #rrggbb (with or without leading #)
  // into normalized "#rrggbb" strings so apply/populate stay deterministic
  // across browser colour serialisations.
  // ---------------------------------------------------------------------------
  function parseHexInput(raw) {
    if (typeof raw !== 'string') return null;
    let h = raw.trim().replace(/^#/, '');
    if (/^[0-9a-fA-F]{3}$/.test(h)) {
      h = h.split('').map((c) => c + c).join('');
    }
    if (!/^[0-9a-fA-F]{6}$/.test(h)) return null;
    return '#' + h.toLowerCase();
  }

  function rgbStringToHex(rgb) {
    if (!rgb || rgb === 'transparent') return null;
    const m = rgb.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
    if (!m) return null;
    const toHex = (n) => Number(n).toString(16).padStart(2, '0');
    return ('#' + toHex(m[1]) + toHex(m[2]) + toHex(m[3])).toLowerCase();
  }

  function applyColorToElement(el, target, hex) {
    const norm = parseHexInput(hex);
    if (!norm) return false;
    el.style[target === 'text' ? 'color' : 'backgroundColor'] = norm;
    return true;
  }

  function commitColourHex(target, raw, targetEl) {
    const el = (targetEl && targetEl.isConnected) ? targetEl : state.selected;
    if (!el) return;
    if (target === 'text' && !isTextBearing(el)) return;
    const norm = parseHexInput(raw);
    if (!norm) {
      // Garbage input — restore from the live element.
      populateColours(el);
      return;
    }
    if (target === 'text' && state.editingText && state.editingText.el === el) {
      const ctx = startInspectorTxn({ captureHtml: !!getTextColourRange(el) });
      touchElement(el);
      applyTextColourToRange(el, norm);
      endInspectorTxn(ctx);
      populateColours(el);
      return;
    }
    const cssProp = target === 'text' ? 'color' : 'backgroundColor';
    const currentHex = rgbStringToHex(el.style[cssProp] || '');
    if (currentHex === norm) return; // no-op; suppress duplicate history entry
    const ctx = startInspectorTxn();
    touchElement(el);
    el.style[cssProp] = norm;
    endInspectorTxn(ctx);
    populateColours(el);
  }

  function populateColours(el) {
    if (!el) {
      for (const r of [textColourRow, bgColourRow]) {
        if (document.activeElement !== r.hexInput) r.hexInput.value = '';
        r.swatch.style.backgroundColor = '';
        r.swatch.dataset.transparent = 'true';
      }
      return;
    }
    // Text colour
    if (isTextBearing(el)) {
      const textColourSource = getActiveTextColourSpan(el) || el;
      const colorRgb = getComputedStyle(textColourSource).color;
      const hex = rgbStringToHex(colorRgb) || '#000000';
      if (document.activeElement !== textColourRow.hexInput) textColourRow.hexInput.value = hex;
      textColourRow.colorInput.value = hex;
      textColourRow.swatch.style.backgroundColor = hex;
      delete textColourRow.swatch.dataset.transparent;
    }
    // Background colour. computed background-color of "rgba(0,0,0,0)"
    // means transparent — show the checkerboard hint and a sensible
    // default in the picker. If the element has a background-image
    // (e.g. a gradient) the swatch flags that with a stripe pattern,
    // since a single hex can't represent it.
    const bgRgb = getComputedStyle(el).backgroundColor;
    const bgImage = getComputedStyle(el).backgroundImage;
    const hasImage = bgImage && bgImage !== 'none';
    const isTransparent = bgRgb === 'rgba(0, 0, 0, 0)' || bgRgb === 'transparent';
    const bgHex = isTransparent ? '#ffffff' : (rgbStringToHex(bgRgb) || '#ffffff');
    if (document.activeElement !== bgColourRow.hexInput) {
      bgColourRow.hexInput.value = isTransparent ? '' : bgHex;
    }
    bgColourRow.colorInput.value = bgHex;
    bgColourRow.hexInput.placeholder = hasImage ? 'image / gradient' : '';
    if (hasImage) {
      bgColourRow.swatch.style.backgroundColor = '';
      bgColourRow.swatch.dataset.image = 'true';
      delete bgColourRow.swatch.dataset.transparent;
    } else if (isTransparent) {
      bgColourRow.swatch.style.backgroundColor = '';
      bgColourRow.swatch.dataset.transparent = 'true';
      delete bgColourRow.swatch.dataset.image;
    } else {
      bgColourRow.swatch.style.backgroundColor = bgHex;
      delete bgColourRow.swatch.dataset.transparent;
      delete bgColourRow.swatch.dataset.image;
    }
  }

  function populateFontSize(el, { forceInput = false } = {}) {
    const px = Math.round(parseFloat(getComputedStyle(el).fontSize)) || FONT_SIZE_MIN_PX;
    if (forceInput || document.activeElement !== inspectorInputs.fontSize) {
      inspectorInputs.fontSize.value = String(px);
    }
  }

  // Typography seg-state (ink-glass 3b). Computed font-weight normalises
  // to a number string; anything that isn't exactly one of the three
  // offered stops (400/500/700) lights no segment rather than lying
  // about the nearest one. text-align's 'start'/'end' resolve by
  // direction; the editor targets ltr decks so start→left, end→right.
  function normalizeFontWeight(raw) {
    const map = { normal: '400', bold: '700' };
    return map[raw] || String(parseInt(raw, 10) || '');
  }

  function normalizeTextAlign(raw) {
    const map = { start: 'left', end: 'right', '-webkit-auto': 'left' };
    return map[raw] || raw;
  }

  function populateTypography(el) {
    const cs = el ? getComputedStyle(el) : null;
    const weight = cs ? normalizeFontWeight(cs.fontWeight) : '';
    const align = cs ? normalizeTextAlign(cs.textAlign) : '';
    for (const b of weightRow.buttons) {
      b.dataset.active = b.dataset.wfpeValue === weight ? 'true' : 'false';
    }
    for (const b of alignRow.buttons) {
      b.dataset.active = b.dataset.wfpeValue === align ? 'true' : 'false';
    }
  }

  function populateOpacity(el) {
    const raw = parseFloat(getComputedStyle(el).opacity);
    const pct = Math.round((Number.isFinite(raw) ? raw : 1) * 100);
    if (document.activeElement !== inspectorInputs.opacity) {
      inspectorInputs.opacity.value = String(pct);
    }
    opacitySlider.value = String(Math.max(0, Math.min(100, pct)));
  }

  function commitInspectorInput(prop, raw, targetEl) {
    // Prefer the target captured at focus-time so a mid-edit selection
    // change doesn't redirect the commit to the new element.
    const el = (targetEl && targetEl.isConnected) ? targetEl : state.selected;
    if (!el) return;
    const next = parseFloat(raw);
    if (!Number.isFinite(next)) {
      // Garbage input — restore the readout from the live element.
      populateInspector(el);
      return;
    }
    if (prop === 'fontSize') {
      if (!isTextBearing(el)) return;
      const current = parseFloat(getComputedStyle(el).fontSize);
      const clamped = Math.max(FONT_SIZE_MIN_PX, next);
      if (Math.round(clamped) === Math.round(current)) return;
      const ctx = startInspectorTxn();
      touchElement(el);
      el.style.fontSize = `${clamped}px`;
      endInspectorTxn(ctx);
      refreshSelection();
      return;
    }
    if (prop === 'opacity') {
      const pct = Math.max(0, Math.min(100, next));
      // `|| 1` would treat a legitimate 0 as falsy and default to 100,
      // breaking the no-op guard after a clamp-to-zero. Use isFinite.
      const raw = parseFloat(getComputedStyle(el).opacity);
      const currentPct = Math.round((Number.isFinite(raw) ? raw : 1) * 100);
      if (Math.round(pct) === currentPct) return;
      const ctx = startInspectorTxn();
      touchElement(el);
      el.style.opacity = String(pct / 100);
      endInspectorTxn(ctx);
      refreshSelection();
      return;
    }
    // Compare against the live offset; abort no-op commits so blur
    // cycling doesn't pollute history.
    const offsetMap = { x: 'offsetLeft', y: 'offsetTop', w: 'offsetWidth', h: 'offsetHeight' };
    const current = el[offsetMap[prop]];
    if (Math.round(next) === current) return;

    const ctx = startInspectorTxn();
    touchElement(el);
    // X/Y require absolute positioning; unlock-on-flow if needed (same
    // path drag/resize use, which also pins flex/grid siblings so the
    // sudden absolute promotion doesn't reflow the layout).
    if (prop === 'x' || prop === 'y') {
      if (getComputedStyle(el).position !== 'absolute') unlockToAbsolute(el);
    }
    const cssProp = { x: 'left', y: 'top', w: 'width', h: 'height' }[prop];
    // Clamp width/height to the same minimum the resize handle enforces
    // so inspector edits can't shrink an element below the resize floor.
    const clamped = (prop === 'w' || prop === 'h') ? Math.max(RESIZE_MIN_PX, next) : next;
    if (prop === 'w') applyExplicitSizeConstraints(el, { width: clamped });
    if (prop === 'h') applyExplicitSizeConstraints(el, { height: clamped });
    el.style[cssProp] = `${clamped}px`;
    endInspectorTxn(ctx);
    refreshSelection();
  }

  // ===========================================================================
  // Inspector visibility + minimise/expand
  //
  // The inspector appears whenever an element is selected and hides on
  // deselect or slide change. Minimised/expanded preference persists
  // across selections within the session via state.inspectorMinimised;
  // reload resets to expanded (in-memory only — localStorage persistence
  // is a v2.x ROADMAP item).
  // ===========================================================================
  function refreshInspector() {
    const visible = getSelectedElements().length === 1 && !!state.selected;
    // Ink-glass 3b: selection drives the dock fold and the toolbar's
    // bottom-corner morph together — they must never disagree, or the
    // seam breaks (squared bar over no panel, or panel under a capsule).
    inspectorDock.dataset.visible = visible ? 'true' : 'false';
    toolbar.dataset.docked = visible ? 'true' : 'false';
    // Legacy mirror — no CSS keys off this any more, but it's a stable
    // hook existing tests/tooling query.
    inspector.dataset.visible = visible ? 'true' : 'false';
    inspector.dataset.state = state.inspectorMinimised ? 'minimised' : 'expanded';
    // The minimise chevron is a single icon rotated by CSS; only the
    // accessible naming changes with state.
    inspectorMinimiseBtn.title = state.inspectorMinimised ? 'Expand' : 'Minimise';
    inspectorMinimiseBtn.setAttribute(
      'aria-label',
      state.inspectorMinimised ? 'Expand inspector' : 'Minimise inspector'
    );
    refreshExportUi();
  }

  function setInspectorMinimised(value) {
    state.inspectorMinimised = !!value;
    refreshInspector();
  }
  // ===========================================================================
  // History (undo/redo)
  //
  // Each history entry is a list of (element, before, after) snapshots. A
  // snapshot captures the element's inline `style` plus any `data-wfp-edit-*`
  // markers that the editor adds during unlock/freeze. Undo restores every
  // element's `before`; redo restores `after`. One drag = one entry, one
  // resize = one entry, one font-size keystroke = one entry; the freeze that
  // a drag performs on flex/grid siblings is bundled into the same entry as
  // the drag itself.
  // ===========================================================================
  function snapshotElement(el, options = {}) {
    const snap = {
      style: el.getAttribute('style'),
      editorAttrs: collectEditorDataAttributes(el),
    };
    if (options.captureHtml) snap.html = el.innerHTML;
    return snap;
  }

  function applyElementSnapshot(el, snap) {
    // Whole-attribute write is intentional here: the snapshot captured the
    // element's complete `style` attribute at change time, so restoring it
    // wholesale (or removing it entirely if it was absent) is the correct
    // undo. Per-property merging would be wrong — undo must reverse all
    // properties this change wrote, not preserve them.
    if (snap.style === null) el.removeAttribute('style');
    else el.setAttribute('style', snap.style);
    applyEditorDataAttributes(el, snap.editorAttrs || {});
    if (Object.prototype.hasOwnProperty.call(snap, 'html') && el.innerHTML !== snap.html) {
      el.innerHTML = snap.html;
    }
  }

  function snapshotsEqual(a, b) {
    const aHasHtml = Object.prototype.hasOwnProperty.call(a, 'html');
    const bHasHtml = Object.prototype.hasOwnProperty.call(b, 'html');
    return (
      a.style === b.style &&
      editorDataAttributesEqual(a.editorAttrs, b.editorAttrs) &&
      ((!aHasHtml && !bHasHtml) || a.html === b.html)
    );
  }

  function beginTxn(options = {}) {
    if (state.txn) return; // ignore re-entry; outermost owns the txn
    state.txn = { snapshots: new Map(), captureHtml: !!options.captureHtml };
  }

  function touchElement(el) {
    if (!state.txn || !el) return;
    if (state.txn.snapshots.has(el)) return;
    state.txn.snapshots.set(el, snapshotElement(el, state.txn));
  }

  function endTxn() {
    if (!state.txn) return;
    const txn = state.txn;
    state.txn = null;
    const changes = [];
    for (const [el, before] of txn.snapshots) {
      const after = snapshotElement(el, txn);
      if (snapshotsEqual(before, after)) continue;
      changes.push({ element: el, before, after });
    }
    if (changes.length === 0) return;
    pushHistoryEntry(changes);
  }

  // ---------------------------------------------------------------------------
  // Inspector-during-text-edit isolation (v2.6).
  //
  // When the user runs an inspector commit (font/colour/position/size/
  // reset) while a text edit is open, the brief calls for *exactly one*
  // history entry per adjustment, separate from the text-edit's typing
  // entry. The single-slot txn machinery would otherwise fold an
  // inspector commit into the open text-edit txn (re-entry no-ops
  // beginTxn) and the next typing batch would have no open txn.
  //
  // Pattern used at every inspector commit site:
  //   const ctx = startInspectorTxn();
  //   touchElement(el);  // (or whatever the commit needs)
  //   ...mutations...
  //   endInspectorTxn(ctx);
  //
  // If text-edit is not open, this is just begin/end. If text-edit is
  // open, it commits the typing-so-far as one entry, isolates the
  // inspector op as another, then re-opens a fresh text-edit txn so
  // subsequent typing accumulates into a new entry on commit.
  // ---------------------------------------------------------------------------
  function startInspectorTxn(options = {}) {
    let restoreEditingEl = null;
    if (state.editingText) {
      restoreEditingEl = state.editingText.el;
      if (state.txn) endTxn(); // commits typing-so-far
    }
    if (!state.txn) beginTxn(options);
    return restoreEditingEl;
  }

  function endInspectorTxn(restoreEditingEl) {
    if (state.txn) endTxn();
    if (
      restoreEditingEl &&
      state.editingText &&
      state.editingText.el === restoreEditingEl
    ) {
      beginTxn({ captureHtml: true });
      touchElement(restoreEditingEl);
    }
  }

  function pushHistoryEntry(changes, slideOps = null) {
    // Truncate any redo stack — a fresh change invalidates everything
    // beyond the current cursor.
    state.history.length = state.historyIndex;
    const entry = { changes };
    if (slideOps && slideOps.length) entry.slideOps = slideOps;
    state.history.push(entry);
    state.historyIndex = state.history.length;
    while (state.history.length > HISTORY_MAX) {
      state.history.shift();
      state.historyIndex--;
    }
  }

  function pushElementInsertEntry(op) {
    pushHistoryEntry([], [op]);
  }

  // Slide-level history op handlers. These run alongside the per-element
  // `changes` array — they EXTEND the entry shape rather than replacing
  // it. Op types: 'reorder' (v2.1.3), 'delete' (v2.1.4),
  // 'elementInsert', 'elementDelete', and 'slideInsert'.
  function undoSlideOp(op) {
    if (op.type === 'reorder') {
      applySlideOrder(op.deck, op.beforeOrder);
    } else if (op.type === 'delete') {
      // Re-attach the deleted slide at its original position. Using
      // node refs (slide + nextSibling) means undo lands the slide in
      // the correct spot even if intervening reorder ops have shuffled
      // its neighbours — node refs follow nodes through reorders.
      // Defensive fallback: if a later op has DELETED the captured
      // nextSibling (orphaning the ref), insertBefore would throw —
      // append to the end instead so the undo still succeeds, just at
      // a less-precise position.
      const ref = (op.nextSibling && op.nextSibling.parentElement === op.deck) ? op.nextSibling : null;
      op.deck.insertBefore(op.slide, ref);
      if (op.wasActive) {
        if (op.fallbackSlide) op.fallbackSlide.classList.remove('active');
        op.slide.classList.add('active');
      }
    } else if (op.type === 'elementInsert') {
      if (op.insertedEl && op.insertedEl.parentElement === op.parentEl) {
        op.parentEl.removeChild(op.insertedEl);
      }
      if (state.selected === op.insertedEl) {
        const fallback = (
          op.previousSelectedEl &&
          op.previousSelectedEl.isConnected &&
          op.slideEl &&
          op.slideEl.contains(op.previousSelectedEl)
        ) ? op.previousSelectedEl : null;
        setSelected(fallback);
        refreshInspector();
      }
    } else if (op.type === 'elementDelete') {
      if (!op.parentEl || !op.deletedEl) return;
      const ref = (
        op.nextSiblingEl &&
        op.nextSiblingEl.parentElement === op.parentEl
      ) ? op.nextSiblingEl : null;
      op.parentEl.insertBefore(op.deletedEl, ref);
      setSelected(op.deletedEl);
      refreshInspector();
    } else if (op.type === 'slideInsert') {
      const deck = op.deckEl || op.deck;
      const inserted = op.insertedSlide;
      if (!deck || !inserted || inserted.parentElement !== deck) return;
      const slides = [...deck.querySelectorAll(':scope > .slide')];
      const idx = slides.indexOf(inserted);
      const fallbackSlide = inserted.classList.contains('active')
        ? (slides[idx + 1] || slides[idx - 1] || null)
        : null;
      if (state.selected && inserted.contains(state.selected)) setSelected(null);
      inserted.classList.remove('active');
      deck.removeChild(inserted);
      if (!deck.querySelector(':scope > .slide.active') && fallbackSlide) {
        fallbackSlide.classList.add('active');
      }
    }
  }
  function redoSlideOp(op) {
    if (op.type === 'reorder') {
      applySlideOrder(op.deck, op.afterOrder);
    } else if (op.type === 'delete') {
      op.deck.removeChild(op.slide);
      if (op.wasActive && op.fallbackSlide) op.fallbackSlide.classList.add('active');
    } else if (op.type === 'elementInsert') {
      if (!op.parentEl || !op.insertedEl) return;
      const ref = (
        op.nextSiblingEl &&
        op.nextSiblingEl.parentElement === op.parentEl
      ) ? op.nextSiblingEl : null;
      op.parentEl.insertBefore(op.insertedEl, ref);
      setSelected(op.insertedEl);
      refreshInspector();
    } else if (op.type === 'elementDelete') {
      if (!op.parentEl || !op.deletedEl) return;
      if (op.deletedEl.parentElement === op.parentEl) {
        op.parentEl.removeChild(op.deletedEl);
      }
      if (state.selected === op.deletedEl || (state.selected && op.deletedEl.contains(state.selected))) {
        setSelected(null);
        refreshInspector();
      }
    } else if (op.type === 'slideInsert') {
      const deck = op.deckEl || op.deck;
      if (!deck || !op.insertedSlide) return;
      const ref = (
        op.beforeSibling &&
        op.beforeSibling.parentElement === deck
      ) ? op.beforeSibling : null;
      op.insertedSlide.classList.remove('active');
      deck.insertBefore(op.insertedSlide, ref);
      observeSlideClass(op.insertedSlide);
    }
  }

  function undo() {
    if (state.historyIndex <= 0) return;
    state.historyIndex--;
    const entry = state.history[state.historyIndex];
    // Slide-level ops in reverse order first, then per-element snapshots.
    if (entry.slideOps) {
      for (let i = entry.slideOps.length - 1; i >= 0; i--) undoSlideOp(entry.slideOps[i]);
    }
    if (entry.changes) {
      for (const c of entry.changes) applyElementSnapshot(c.element, c.before);
    }
    refreshSelection();
    refreshExportUi();
    if (state.overviewMode) buildOverviewOverlay();
  }

  function redo() {
    if (state.historyIndex >= state.history.length) return;
    const entry = state.history[state.historyIndex];
    if (entry.changes) {
      for (const c of entry.changes) applyElementSnapshot(c.element, c.after);
    }
    if (entry.slideOps) {
      for (const op of entry.slideOps) redoSlideOp(op);
    }
    state.historyIndex++;
    refreshSelection();
    refreshExportUi();
    if (state.overviewMode) buildOverviewOverlay();
  }
  // ===========================================================================
  // Edit mode
  // ===========================================================================
  function setEditMode(value) {
    state.editMode = !!value;
    badge.dataset.mode = state.editMode ? 'on' : 'off';
    toolbar.dataset.mode = state.editMode ? 'on' : 'off';
    if (!state.editMode) {
      if (state.editingText) endTextEdit();
      setSelected(null);
      refreshInspector();
    }
    refreshAnnotationMarkers();
  }

  // ===========================================================================
  // Overview mode (v2.1.0)
  //
  // A bird's-eye grid view of all slides — entered by hotkey `O`, the
  // Overview toolbar button, or (later v2.1.x phases) clicking outside the
  // grid; exited by `O`, Escape, or clicking a thumbnail (which both
  // navigates and exits).
  //
  // Mutual exclusion with element selection: entering overview clears
  // state.selected so the inspector and selection ring drop out (they
  // refer to slide-level content that's about to relocate). state.editMode
  // is deliberately untouched — overview can be toggled regardless of
  // edit mode, and exiting overview returns you to whatever edit-mode
  // state you were in.
  //
  // v2.1.0 wires the activation flag and the toolbar button only.
  // Subsequent phases (v2.1.1+) attach the grid DOM, click-to-navigate,
  // drag-to-reorder, and delete affordances on top of this state flag.
  // ===========================================================================
  function setOverviewMode(value) {
    if (isFlatMode()) {
      state.overviewMode = false;
      overviewBtn.dataset.mode = 'off';
      toolbar.dataset.overviewMode = 'off';
      return;
    }
    const next = !!value;
    if (next === state.overviewMode) return;
    state.overviewMode = next;
    if (next) {
      // Closing any open text edit before entering overview: the edited
      // element's contenteditable lifecycle assumes the slide stays in
      // its normal layout. Future phases (v2.1.3 reorder, v2.1.4 delete)
      // mutate slide DOM order; an open contenteditable across that
      // transition would strand the caret.
      if (state.editingText) endTextEdit();
      setSelected(null);
      refreshInspector();
      enterOverview();
    } else {
      exitOverview();
    }
    overviewBtn.dataset.mode = state.overviewMode ? 'on' : 'off';
    toolbar.dataset.overviewMode = state.overviewMode ? 'on' : 'off';
    refreshAnnotationMarkers();
  }

  // ---------------------------------------------------------------------------
  // Overview enter/exit + overlay layer (v2.1.1)
  //
  // CSS-override strategy: the body marker `data-wfp-edit-overview="on"`
  // gates a stylesheet block that overrides .deck/.slide rendering into a
  // grid. No slide DOM is mutated. Exit removes the marker; the fixture
  // CSS resumes its normal rendering with no leftover wrappers, classes,
  // or inline styles. The marker uses the data-wfp-edit-* namespace so
  // the export scrubber strips it as part of its existing sweep.
  //
  // The overlay layer renders editor chrome (slide-number badges, the
  // active-slide highlight; v2.1.4 will add the hover × button) at
  // viewport coordinates anchored to each slide's bounding rect. It
  // doesn't scale with the 0.22 transform — chrome stays at full size.
  // ---------------------------------------------------------------------------
  let overviewRafId = 0;
  function scheduleOverviewReposition() {
    if (overviewRafId) return;
    overviewRafId = requestAnimationFrame(() => {
      overviewRafId = 0;
      positionOverviewOverlay();
    });
  }

  function buildOverviewOverlay() {
    overviewOverlay.innerHTML = '';
    const slides = getSlides();
    for (let i = 0; i < slides.length; i++) {
      const slide = slides[i];
      const thumb = document.createElement('div');
      thumb.className = 'wfpe-overview-thumb';
      thumb.dataset.wfpEditSlideIndex = String(i);
      // Native HTML5 DnD source (v2.1.3). The thumb is editor-owned —
      // setting draggable here keeps slide DOM untouched.
      thumb.draggable = true;
      if (!slide.innerHTML.trim()) thumb.dataset.empty = 'true';
      // Make the thumb focusable (v2.1.4) so the × button reveals via
      // :focus-within for keyboard users; arrow-key navigation between
      // thumbs is an explicit non-goal (BRIEF), but Tab focus is fine.
      thumb.tabIndex = 0;
      if (slide.classList.contains('active')) thumb.dataset.active = 'true';
      const badge = document.createElement('span');
      badge.className = 'wfpe-overview-badge';
      badge.textContent = String(i + 1);
      thumb.appendChild(badge);
      // Delete button (v2.1.4). Carries the slide index so the click
      // handler can resolve the live .deck child without walking the
      // DOM up from event.target.
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'wfpe-overview-delete';
      del.dataset.wfpEditSlideIndex = String(i);
      del.title = 'Delete slide';
      del.setAttribute('aria-label', `Delete slide ${i + 1}`);
      del.innerHTML = ICONS.closeSmall;
      thumb.appendChild(del);
      overviewOverlay.appendChild(thumb);
    }
    for (let i = 0; i <= slides.length; i++) {
      const add = document.createElement('button');
      add.type = 'button';
      add.className = 'wfpe-overview-add';
      add.dataset.wfpEditInsertIndex = String(i);
      add.title = i === 0
        ? 'Insert slide before first slide'
        : (i === slides.length ? 'Insert slide after last slide' : `Insert slide at position ${i + 1}`);
      add.setAttribute('aria-label', add.title);
      add.textContent = '+';
      overviewOverlay.appendChild(add);
    }
    positionOverviewOverlay();
  }

  function positionOverviewOverlay() {
    if (!state.overviewMode) return;
    const slides = getSlides();
    const thumbs = overviewOverlay.querySelectorAll('.wfpe-overview-thumb');
    for (let i = 0; i < slides.length; i++) {
      const t = thumbs[i];
      if (!t) continue;
      const r = slides[i].getBoundingClientRect();
      t.style.top = `${r.top}px`;
      t.style.left = `${r.left}px`;
      t.style.width = `${r.width}px`;
      t.style.height = `${r.height}px`;
    }
    positionOverviewAddButtons(slides);
  }

  function positionOverviewAddButtons(slides) {
    const buttons = overviewOverlay.querySelectorAll('.wfpe-overview-add');
    if (slides.length === 0) {
      buttons.forEach((b) => { b.style.display = 'none'; });
      return;
    }
    const rects = slides.map((slide) => slide.getBoundingClientRect());
    const place = (button, x, y) => {
      button.style.display = 'inline-flex';
      button.style.left = `${x - 12}px`;
      button.style.top = `${y - 12}px`;
    };
    for (let i = 0; i < buttons.length; i++) {
      const button = buttons[i];
      if (i === 0) {
        const first = rects[0];
        place(button, first.left - 14, first.top + first.height / 2);
      } else if (i === rects.length) {
        const last = rects[rects.length - 1];
        place(button, last.right + 14, last.top + last.height / 2);
      } else {
        const prev = rects[i - 1];
        const next = rects[i];
        const sameRow = Math.abs(prev.top - next.top) < 4;
        if (sameRow) {
          place(button, (prev.right + next.left) / 2, next.top + next.height / 2);
        } else {
          place(button, next.left + next.width / 2, (prev.bottom + next.top) / 2);
        }
      }
    }
  }

  function measureOverviewCellDimensions() {
    if (getDocumentMode() === 'native') {
      return { width: 1920, height: 1080 };
    }

    const slides = getSlides();
    let width = 0;
    let height = 0;
    for (const slide of slides) {
      width = Math.max(width, slide.offsetWidth || slide.getBoundingClientRect().width || 0);
      height = Math.max(height, slide.offsetHeight || slide.getBoundingClientRect().height || 0);
    }
    return {
      width: Math.max(1, Math.round(width || 1920)),
      height: Math.max(1, Math.round(height || 1080)),
    };
  }

  function getOverviewSlideDisplay() {
    if (getDocumentMode() === 'native') return 'block';
    const activeSlide = getActiveSlide();
    const slide = activeSlide || getSlides().find((candidate) => candidate && candidate.isConnected);
    if (!slide) return 'block';
    const display = getComputedStyle(slide).display;
    return ['block', 'flex', 'grid', 'inline-block', 'flow-root'].includes(display) ? display : 'block';
  }

  function applyOverviewCellDimensions() {
    const dims = measureOverviewCellDimensions();
    const slideDisplay = getOverviewSlideDisplay();
    overviewMeasureStyleEl.textContent = `
      body[data-wfp-edit-overview="on"] [data-wfp-edit-deck-root]:not([data-wfp-edit-flat-root]) {
        --wfpe-cell-w: ${dims.width}px;
        --wfpe-cell-h: ${dims.height}px;
        --wfpe-overview-slide-display: ${slideDisplay};
      }
    `;
  }

  function clearOverviewCellDimensions() {
    overviewMeasureStyleEl.textContent = '';
  }

  function enterOverview() {
    // The body marker lives on <body> rather than #wfp-editor-root because
    // the CSS-override strategy needs a global selector hook above the
    // .deck level. Using the data-wfp-edit-* namespace means the existing
    // export scrubber (which strips any data-wfp-edit* attribute on any
    // element) cleans it up automatically — no special-case needed.
    applyOverviewCellDimensions();
    document.body.dataset.wfpEditOverview = 'on';
    // Defer overlay build until the browser has applied the new grid
    // layout — getBoundingClientRect right now would still report the
    // pre-grid (stacked-absolute) positions. Save the rAF id so a quick
    // toggle-off (within one frame) can cancel the pending build before
    // it strands a zombie overlay over the restored slide rendering.
    overviewRafId = requestAnimationFrame(() => {
      overviewRafId = 0;
      buildOverviewOverlay();
      overviewOverlay.dataset.visible = 'true';
    });
    window.addEventListener('scroll', scheduleOverviewReposition, true);
    window.addEventListener('resize', scheduleOverviewReposition);
    // Capture-phase click listener owns thumb-click → navigate (v2.1.2).
    // Capture so we beat the fixture's own slide click handlers if any
    // exist. Editor-root clicks (toolbar / inspector) are exempted
    // inside the handler so their existing bubble-phase handlers still
    // fire.
    document.addEventListener('click', onOverviewClick, true);
    // HTML5 native DnD listeners (v2.1.3). Delegated from the overlay
    // root so we don't need to re-bind on each rebuild.
    overviewOverlay.addEventListener('dragstart', onOverviewDragStart);
    overviewOverlay.addEventListener('dragover', onOverviewDragOver);
    overviewOverlay.addEventListener('dragleave', onOverviewDragLeave);
    overviewOverlay.addEventListener('drop', onOverviewDrop);
    overviewOverlay.addEventListener('dragend', onOverviewDragEnd);
    // Hover tracking + delete (v2.1.4). Mouseenter/leave are listened
    // via mouseover/out for delegation efficiency.
    overviewOverlay.addEventListener('mouseover', onOverviewMouseOver);
    overviewOverlay.addEventListener('mouseout', onOverviewMouseOut);
    overviewOverlay.addEventListener('click', onOverviewAddClick);
    overviewOverlay.addEventListener('click', onOverviewDeleteClick);
  }

  function exitOverview() {
    document.body.removeAttribute('data-wfp-edit-overview');
    clearOverviewCellDimensions();
    // Overview enables document scroll for the grid; normal slide view should
    // always return to the top of the viewport.
    window.scrollTo(0, 0);
    overviewOverlay.dataset.visible = 'false';
    overviewOverlay.innerHTML = '';
    overviewDropIndicator.dataset.visible = 'false';
    state.overviewDrag = null;
    window.removeEventListener('scroll', scheduleOverviewReposition, true);
    window.removeEventListener('resize', scheduleOverviewReposition);
    document.removeEventListener('click', onOverviewClick, true);
    overviewOverlay.removeEventListener('dragstart', onOverviewDragStart);
    overviewOverlay.removeEventListener('dragover', onOverviewDragOver);
    overviewOverlay.removeEventListener('dragleave', onOverviewDragLeave);
    overviewOverlay.removeEventListener('drop', onOverviewDrop);
    overviewOverlay.removeEventListener('dragend', onOverviewDragEnd);
    overviewOverlay.removeEventListener('mouseover', onOverviewMouseOver);
    overviewOverlay.removeEventListener('mouseout', onOverviewMouseOut);
    overviewOverlay.removeEventListener('click', onOverviewAddClick);
    overviewOverlay.removeEventListener('click', onOverviewDeleteClick);
    state.overviewHoveredSlide = null;
    if (overviewRafId) {
      cancelAnimationFrame(overviewRafId);
      overviewRafId = 0;
    }
  }

  // Walk up from the click target. Two valid hit types since v2.1.3:
  //   - Click landed on an overlay thumb → look up the slide via the
  //     thumb's wfpEditSlideIndex dataset (thumbs sit above slides with
  //     pointer-events:auto so they receive clicks before the slide).
  //   - Click landed on a slide directly (e.g. fallback if a thumb
  //     hasn't been positioned yet) → walk up to the .deck child slide.
  // Returns null for clicks on editor chrome or grid gutters.
  function findOverviewSlideTarget(el) {
    while (el && el !== document.body) {
      if (el.classList) {
        if (el.classList.contains('wfpe-overview-thumb')) {
          const idx = Number(el.dataset.wfpEditSlideIndex);
          const slides = getSlides();
          return slides[idx] || null;
        }
        if (
          el.classList.contains('slide') &&
          el.parentElement === getDeckRoot()
        ) {
          return el;
        }
      }
      el = el.parentElement;
    }
    return null;
  }

  function navigateToSlide(slide) {
    // Clear .active from any other slide in the same deck, set on the
    // clicked one. Idempotent — clicking the already-active slide just
    // exits overview without churning the class.
    const deck = slide.parentElement;
    if (!deck) return;
    for (const sib of deck.querySelectorAll(':scope > .slide.active')) {
      if (sib !== slide) sib.classList.remove('active');
    }
    if (!slide.classList.contains('active')) slide.classList.add('active');
    setOverviewMode(false);
  }

  function onOverviewClick(e) {
    // Delete-button clicks must NOT navigate — short-circuit before the
    // navigate path so the bubble-phase onOverviewDeleteClick can do
    // its job (capture-phase stopPropagation here would otherwise kill
    // it). v2.1.4 added the × button inside each thumb; the navigate
    // path's editor-root + thumb-walk would otherwise intercept it.
    if (e.target.closest('.wfpe-overview-delete')) return;
    // Editor-root clicks normally flow to their own bubble handlers
    // (toolbar Edit / Export / etc.), but the overview thumbs ALSO live
    // under #wfp-editor-root in v2.1.3 — they need to navigate. Filter
    // by walking up: a thumb hit is fine; any other editor-root hit
    // (toolbar / inspector) is exempted.
    if (isInsideEditorRoot(e.target) && !e.target.closest('.wfpe-overview-thumb')) {
      return;
    }
    const slide = findOverviewSlideTarget(e.target);
    if (!slide) return;
    e.preventDefault();
    e.stopPropagation();
    navigateToSlide(slide);
  }

  // ---------------------------------------------------------------------------
  // Drag to reorder (v2.1.3)
  //
  // Hand-rolled HTML5 native DnD on the overlay thumbs (per BRIEF — no
  // Sortable.js, no other library). DOM mutation only on `drop`: a
  // single .deck.insertBefore(sourceSlide, refNode) call. Active-slide
  // tracking is automatic since the .active class moves with the node.
  //
  // History contract: one drag = one history entry, undoable via the
  // existing v1 stack which has been EXTENDED (not refactored) with a
  // `slideOps` array on each entry. slideOps run alongside the existing
  // per-element `changes` array; reorder ops capture beforeOrder /
  // afterOrder (arrays of slide node references), and undo/redo
  // re-arrange the deck's children to match.
  // ---------------------------------------------------------------------------
  function ordersEqual(a, b) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }

  function applySlideOrder(deck, order) {
    // Re-attach each slide in the desired sequence. appendChild on an
    // already-attached node moves it to the end of the parent — so
    // appending in order produces the sequence in order.
    for (const slide of order) {
      if (slide && slide.parentElement === deck) deck.appendChild(slide);
    }
  }

  function pushSlideOpEntry(slideOp) {
    state.history.length = state.historyIndex;
    state.history.push({ changes: [], slideOps: [slideOp] });
    state.historyIndex = state.history.length;
    while (state.history.length > HISTORY_MAX) {
      state.history.shift();
      state.historyIndex--;
    }
    // Once any slide-level op lands, a deck's cached slide list (often
    // built once at script load via document.querySelectorAll) can be
    // stale relative to the live deck — its arrow-nav would index into
    // the wrong slot or land .active on an orphan. From here on, the
    // editor owns plain-view arrow nav for paginated modes using fresh
    // DOM queries. Flat mode has no page-shaped navigation.
    state.deckMutated = getDocumentMode() !== 'flat';
  }

  // Navigate the live deck by ±1, syncing the fixture's progress-dot
  // siblings if any exist (best-effort — not all fixtures have them).
  // Used by the deckMutated arrow-nav takeover in onKeyDown.
  function navigateRelativeInDeck(delta) {
    const slides = getSlides();
    if (slides.length === 0) return;
    const dots = document.querySelectorAll('.progress-dot');
    let cur = slides.findIndex((s) => s.classList.contains('active'));
    if (cur < 0) {
      // Recovery: no in-DOM slide is .active (e.g., the fixture's
      // stale handler set .active on an orphan before we took over).
      // Re-anchor to the first slide so the user sees something.
      slides[0].classList.add('active');
      if (dots[0]) {
        dots.forEach((d) => d.classList.remove('active'));
        dots[0].classList.add('active');
      }
      return;
    }
    const next = cur + delta;
    if (next < 0 || next >= slides.length) return;
    slides[cur].classList.remove('active');
    slides[next].classList.add('active');
    if (dots[cur]) dots[cur].classList.remove('active');
    if (dots[next]) dots[next].classList.add('active');
  }

  function dropTargetThumb(target) {
    while (target && target !== overviewOverlay) {
      if (target.classList && target.classList.contains('wfpe-overview-thumb')) return target;
      target = target.parentElement;
    }
    return null;
  }

  function hideDropIndicator() {
    overviewDropIndicator.dataset.visible = 'false';
  }

  function positionDropIndicator(thumbRect, insertBefore) {
    overviewDropIndicator.dataset.visible = 'true';
    // Park the bar on the chosen edge, slightly outside the thumb so it
    // reads as a gutter mark rather than a side stripe on the thumb.
    const x = insertBefore ? thumbRect.left - 4 : thumbRect.right + 1;
    overviewDropIndicator.style.left = `${x}px`;
    overviewDropIndicator.style.top = `${thumbRect.top - 4}px`;
    overviewDropIndicator.style.height = `${thumbRect.height + 8}px`;
  }

  function onOverviewDragStart(e) {
    const thumb = dropTargetThumb(e.target);
    if (!thumb) return;
    const idx = Number(thumb.dataset.wfpEditSlideIndex);
    const slides = getSlides();
    const sourceSlide = slides[idx];
    if (!sourceSlide) return;
    state.overviewDrag = {
      sourceSlide,
      sourceIndex: idx,
      beforeOrder: slides.slice(),
    };
    thumb.dataset.dragging = 'true';
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move';
      // Some browsers (Firefox especially) refuse to start a drag unless
      // some payload is set on the dataTransfer — the value itself is
      // unused since we read state.overviewDrag instead.
      try { e.dataTransfer.setData('text/plain', String(idx)); } catch (_) { /* ignore */ }
    }
  }

  function onOverviewDragOver(e) {
    if (!state.overviewDrag) return;
    e.preventDefault(); // required to allow drop
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    const thumb = dropTargetThumb(e.target);
    if (!thumb) {
      hideDropIndicator();
      return;
    }
    const tIdx = Number(thumb.dataset.wfpEditSlideIndex);
    if (tIdx === state.overviewDrag.sourceIndex) {
      hideDropIndicator();
      return;
    }
    const tRect = thumb.getBoundingClientRect();
    const insertBefore = e.clientX < tRect.left + tRect.width / 2;
    positionDropIndicator(tRect, insertBefore);
  }

  function onOverviewDragLeave(e) {
    // When the cursor leaves the overlay entirely, hide the indicator.
    // dragleave on individual thumbs fires constantly during a drag,
    // so only act on overlay-level leaves.
    if (e.target === overviewOverlay) hideDropIndicator();
  }

  function onOverviewDrop(e) {
    if (!state.overviewDrag) return;
    e.preventDefault();
    const drag = state.overviewDrag;
    const thumb = dropTargetThumb(e.target);
    hideDropIndicator();
    if (!thumb) {
      cleanupDrag();
      return;
    }
    const tIdx = Number(thumb.dataset.wfpEditSlideIndex);
    if (tIdx === drag.sourceIndex) {
      cleanupDrag();
      return;
    }
    const slides = getSlides();
    const targetSlide = slides[tIdx];
    if (!targetSlide) {
      cleanupDrag();
      return;
    }
    const tRect = thumb.getBoundingClientRect();
    const insertBefore = e.clientX < tRect.left + tRect.width / 2;
    const deck = drag.sourceSlide.parentElement;
    if (!deck) {
      cleanupDrag();
      return;
    }
    const refNode = insertBefore ? targetSlide : targetSlide.nextSibling;
    deck.insertBefore(drag.sourceSlide, refNode);
    const afterOrder = getSlides();
    if (!ordersEqual(drag.beforeOrder, afterOrder)) {
      pushSlideOpEntry({
        type: 'reorder',
        deck,
        beforeOrder: drag.beforeOrder,
        afterOrder,
      });
    }
    cleanupDrag();
    // Rebuild the overlay so badges, draggables, and active-data flags
    // reflect the new order. positionOverviewOverlay is called inside.
    buildOverviewOverlay();
  }

  function onOverviewDragEnd(_e) {
    // Fires whether or not the drop succeeded. cleanupDrag is idempotent.
    cleanupDrag();
    hideDropIndicator();
  }

  function cleanupDrag() {
    if (!state.overviewDrag) return;
    for (const t of overviewOverlay.querySelectorAll('.wfpe-overview-thumb')) {
      if (t.dataset && 'dragging' in t.dataset) delete t.dataset.dragging;
    }
    state.overviewDrag = null;
  }

  // ---------------------------------------------------------------------------
  // Insert blank slide (overview add affordances)
  // ---------------------------------------------------------------------------
  function nextBlankSlideId(deck) {
    const slides = [...deck.querySelectorAll(':scope > .slide')];
    let maxNumericSuffix = -1;
    for (const slide of slides) {
      const id = slide.getAttribute('id') || '';
      const match = id.match(/(\d+)$/);
      if (!match) continue;
      maxNumericSuffix = Math.max(maxNumericSuffix, Number(match[1]));
    }
    let next = maxNumericSuffix >= 0 ? maxNumericSuffix + 1 : slides.length + 1;
    let id = `s${next}`;
    while (document.getElementById(id)) {
      next++;
      id = `s${next}`;
    }
    return id;
  }

  function insertBlankSlideAt(index) {
    const deck = getDeckRoot();
    if (!deck || getDocumentMode() === 'flat') return null;
    const slides = getSlides();
    const insertIndex = Math.max(0, Math.min(slides.length, Number(index) || 0));
    const beforeSibling = slides[insertIndex] || null;
    const slide = document.createElement('div');
    slide.className = 'slide';
    slide.id = nextBlankSlideId(deck);
    deck.insertBefore(slide, beforeSibling);
    observeSlideClass(slide);
    pushSlideOpEntry({
      type: 'slideInsert',
      deckEl: deck,
      insertedSlide: slide,
      beforeSibling,
    });
    buildOverviewOverlay();
    return slide;
  }

  function onOverviewAddClick(e) {
    const btn = e.target.closest('.wfpe-overview-add');
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation();
    insertBlankSlideAt(Number(btn.dataset.wfpEditInsertIndex));
  }

  // ---------------------------------------------------------------------------
  // Delete (v2.1.4)
  //
  // UX: hover-revealed × button per thumb (CSS-driven via :hover and
  // :focus-within), Backspace/Delete keyboard shortcut on the hovered or
  // focused thumb. Last-slide guard with a one-line toast. Active-slide
  // fallback per BRIEF: if the deleted slide was active, promote the
  // slide that now occupies its position; if it was last, fall back to
  // the new last.
  //
  // History contract: one delete = one history entry. Slide-level op
  // type 'delete' carries enough info to re-insert the exact node at
  // its exact prior position (using nextSibling node ref so re-inserts
  // remain correct across intervening reorder/delete ops).
  // ---------------------------------------------------------------------------
  function deleteSlideFromOverview(slide) {
    const deck = slide && slide.parentElement;
    if (!deck || deck !== getDeckRoot() || getDocumentMode() === 'flat') return;
    const slides = getSlides();
    if (slides.length <= 1) {
      showToast(slide, "Can't delete the last slide.");
      return;
    }
    const wasActive = slide.classList.contains('active');
    const idx = slides.indexOf(slide);
    const nextSibling = slide.nextElementSibling; // may be null if last
    // Per BRIEF: if deleted slide was active and not the last, promote
    // the slide that now occupies its position (was at idx + 1). If it
    // was the last, fall back to the new last (was at idx - 1).
    let fallbackSlide = null;
    if (wasActive) {
      fallbackSlide = slides[idx + 1] || slides[idx - 1] || null;
    }
    deck.removeChild(slide);
    if (wasActive && fallbackSlide) fallbackSlide.classList.add('active');
    pushSlideOpEntry({
      type: 'delete',
      deck,
      slide,
      nextSibling,
      wasActive,
      fallbackSlide,
    });
    // If the just-deleted slide was the hovered target, drop the
    // reference — the next mouseover will re-hydrate.
    if (state.overviewHoveredSlide === slide) state.overviewHoveredSlide = null;
    buildOverviewOverlay();
    refreshExportUi();
  }

  function getOverviewDeleteTarget() {
    // Keyboard focus wins over mouse hover so a user with both
    // (e.g. tabbed to a thumb while the cursor is over a different
    // one) operates on the focused thumb. Falls back to hover.
    const active = document.activeElement;
    if (active && overviewOverlay.contains(active)) {
      const thumb = active.closest('.wfpe-overview-thumb');
      if (thumb) {
        const i = Number(thumb.dataset.wfpEditSlideIndex);
        return getSlides()[i] || null;
      }
    }
    return state.overviewHoveredSlide;
  }

  function onOverviewMouseOver(e) {
    const thumb = e.target.closest('.wfpe-overview-thumb');
    if (!thumb) return;
    const idx = Number(thumb.dataset.wfpEditSlideIndex);
    state.overviewHoveredSlide = getSlides()[idx] || null;
  }

  function onOverviewMouseOut(e) {
    // Only clear when leaving the overlay entirely or moving to a non-thumb
    // ancestor. Moving between thumbs fires mouseout on the previous
    // thumb followed by mouseover on the next; the mouseover above
    // re-hydrates state.overviewHoveredSlide.
    const related = e.relatedTarget;
    if (related && overviewOverlay.contains(related) && related.closest('.wfpe-overview-thumb')) return;
    state.overviewHoveredSlide = null;
  }

  function onOverviewDeleteClick(e) {
    const btn = e.target.closest('.wfpe-overview-delete');
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation();
    const idx = Number(btn.dataset.wfpEditSlideIndex);
    const slide = getSlides()[idx];
    if (!slide) return;
    deleteSlideFromOverview(slide);
  }

  function isTypingTarget(el) {
    if (!el) return false;
    const tag = el.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
    if (el.isContentEditable) return true;
    return false;
  }

  function isTextBearing(el) {
    if (!el) return false;
    for (const node of el.childNodes) {
      if (node.nodeType === 3 && node.textContent.trim().length > 0) return true;
    }
    return false;
  }

  function nudgeFontSize(el, deltaPx) {
    const current = parseFloat(getComputedStyle(el).fontSize);
    if (!Number.isFinite(current)) return;
    const next = Math.max(FONT_SIZE_MIN_PX, current + deltaPx);
    el.style.fontSize = `${next}px`;
  }

  // Inspector ± buttons — same primitive as the keyboard arrow nudge,
  // but bracketed with a fresh txn so each click is exactly one history
  // entry. Uses the inspector-txn isolation helpers so a click during
  // a text-edit produces its own entry separate from the typing.
  function nudgeFontSizeWithHistory(deltaPx) {
    const el = state.selected;
    if (!el || !isTextBearing(el)) return;
    const ctx = startInspectorTxn();
    touchElement(el);
    nudgeFontSize(el, deltaPx);
    endInspectorTxn(ctx);
    populateFontSize(el, { forceInput: true });
    refreshSelection();
  }

  function onKeyDown(e) {
    // v2.11 — while the export menu is open it owns Enter/Escape.
    if (state.exportMenuOpen) {
      if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        triggerPrimaryExport();
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        closeExportMenu();
        return;
      }
    }

    // While a text edit is open, only intercept Escape/Tab (commit) and
    // Cmd/Ctrl+S (commit + export). Every other key flows to the
    // contenteditable element for default behavior (typing, caret motion),
    // BUT we still call stopPropagation so the fixture's bubble-phase
    // keydown handler (which navigates slides on ArrowLeft/Right/Space)
    // doesn't fire alongside the caret movement.
    //
    // Exception (v2.6): keystrokes targeted at the inspector (its inputs,
    // sliders, buttons) must reach their own listeners — Enter to commit
    // a hex value, Escape to revert, etc. Capture-phase stopPropagation
    // would kill those bubble-phase handlers. So when the target lives
    // under the inspector, drop the suppression entirely.
    if (state.editingText) {
      if (inspector.contains(e.target)) return;
      if (e.key === 'Escape' || e.key === 'Tab') {
        e.preventDefault();
        e.stopPropagation();
        endTextEdit();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && (e.key === 's' || e.key === 'S')) {
        e.preventDefault();
        e.stopPropagation();
        endTextEdit();
        triggerPrimaryExport();
        return;
      }
      e.stopPropagation();
      return;
    }

    if (isTypingTarget(e.target)) return;
    const noModifier = !e.metaKey && !e.ctrlKey && !e.altKey;
    const isMod = e.metaKey || e.ctrlKey;

    if ((e.key === 'e' || e.key === 'E') && noModifier) {
      setEditMode(!state.editMode);
      return;
    }

    // Overview mode toggle (v2.1.0). `O` works regardless of edit mode
    // (matches the `E` precedent). Escape exits when overview is on,
    // no-op otherwise — text-edit Escape is already handled above.
    if ((e.key === 'o' || e.key === 'O') && noModifier) {
      if (isFlatMode()) return;
      e.preventDefault();
      e.stopPropagation();
      setOverviewMode(!state.overviewMode);
      return;
    }
    if (e.key === 'Escape' && state.overviewMode && noModifier) {
      e.preventDefault();
      e.stopPropagation();
      setOverviewMode(false);
      return;
    }

    // Plain-view arrow nav takeover (v2.1.0 hotfix). Once the deck has
    // been mutated via overview reorder/delete, the fixture's own
    // keydown handler — which caches slides + cur at load time — is
    // stale: forward nav lands on the wrong slide (reorder) or sets
    // .active on an orphan node leaving the user staring at black
    // (delete). Editor's nav uses fresh DOM queries.
    if (
      state.deckMutated &&
      !state.editMode &&
      !state.overviewMode &&
      !e.metaKey && !e.ctrlKey && !e.altKey &&
      (e.key === 'ArrowRight' || e.key === 'ArrowLeft' || e.key === ' ' || e.key === 'Spacebar')
    ) {
      e.preventDefault();
      e.stopPropagation();
      navigateRelativeInDeck(e.key === 'ArrowLeft' ? -1 : +1);
      return;
    }

    // Editor key handling fires when EITHER edit mode or overview mode
    // is active. Overview is its own "editor active" surface (reorder /
    // delete / undo); requiring edit-mode-on to undo a reorder while in
    // overview would be surprising UX.
    if (!state.editMode && !state.overviewMode) return;

    if (state.editMode && isMod && !e.altKey && (e.key === 'c' || e.key === 'C')) {
      if (!state.selected) return;
      e.preventDefault();
      e.stopPropagation();
      copySelectedElement();
      return;
    }

    if (state.editMode && isMod && !e.altKey && !e.shiftKey && (e.key === 'v' || e.key === 'V')) {
      if (!state.clipboard || state.overviewMode) return;
      e.preventDefault();
      e.stopPropagation();
      pasteClipboardElement();
      return;
    }

    if (
      state.editMode &&
      !state.overviewMode &&
      noModifier &&
      (e.key === 'Backspace' || e.key === 'Delete')
    ) {
      if (!state.selected) return;
      e.preventDefault();
      e.stopPropagation();
      deleteSelectedElement();
      return;
    }

    // Backspace / Delete in overview deletes the hovered (or focused)
    // thumbnail's slide (v2.1.4). Routes through the same path as the
    // × button click so history + last-slide guard behave identically.
    if (
      state.overviewMode &&
      noModifier &&
      (e.key === 'Backspace' || e.key === 'Delete')
    ) {
      const target = getOverviewDeleteTarget();
      if (target) {
        e.preventDefault();
        e.stopPropagation();
        deleteSlideFromOverview(target);
      }
      return;
    }

    // Suppress slide navigation keys while edit mode is on. The fixture's
    // own keydown handler is registered in bubble phase, so by registering
    // ours in capture phase + stopPropagation here, we pre-empt it cleanly.
    if (
      (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === ' ' || e.key === 'Spacebar') &&
      !e.metaKey && !e.ctrlKey && !e.altKey
    ) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }

    if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && noModifier) {
      if (!state.selected) return;
      e.preventDefault();
      e.stopPropagation();
      if (hasMultiSelection() || !isTextBearing(state.selected)) return;
      const direction = e.key === 'ArrowUp' ? +1 : -1;
      const step = e.shiftKey ? 5 : 1;
      beginTxn();
      touchElement(state.selected);
      nudgeFontSize(state.selected, direction * step);
      endTxn();
      refreshSelection();
      return;
    }

    // Undo / redo. Cmd/Ctrl+Z = undo, Cmd/Ctrl+Shift+Z = redo, Cmd/Ctrl+Y = redo.
    if (isMod && (e.key === 'z' || e.key === 'Z')) {
      e.preventDefault();
      e.stopPropagation();
      if (e.shiftKey) redo();
      else undo();
      return;
    }
    if (isMod && (e.key === 'y' || e.key === 'Y') && !e.shiftKey) {
      e.preventDefault();
      e.stopPropagation();
      redo();
      return;
    }

    // Export
    if (isMod && (e.key === 's' || e.key === 'S') && !e.shiftKey) {
      e.preventDefault();
      e.stopPropagation();
      triggerPrimaryExport();
      return;
    }
  }

  document.addEventListener('keydown', onKeyDown, true);
  // ===========================================================================
  // Selection
  // ===========================================================================
  function onClick(e) {
    // In overview mode, slide-element selection is suppressed — overview
    // owns the click semantics (v2.1.2 wires click-to-navigate). Toolbar
    // / inspector clicks still flow through their own handlers because
    // those bubble independently.
    if (state.overviewMode) return;
    if (!state.editMode) return;
    if (Date.now() < state.suppressClickUntil) {
      // The mouseup that ended a drag fired this synthetic click. Swallow it
      // so the click handler doesn't deselect when the cursor released over
      // a non-selectable area.
      e.stopPropagation();
      e.preventDefault();
      state.suppressClickUntil = 0;
      return;
    }
    if (isInsideEditorRoot(e.target)) return;
    if (isPointInsidePassiveEditorSurface(e)) {
      e.stopPropagation();
      e.preventDefault();
      return;
    }
    const target = findSelectableTarget(e.target);
    if (isSelectionToggleEvent(e)) {
      if (target) {
        toggleSelectedElement(target);
        refreshInspector();
        e.preventDefault();
        e.stopPropagation();
      }
      return;
    }
    setSelected(target);
    refreshInspector();
  }

  document.addEventListener('click', onClick, true);

  // Reposition the ring on scroll, resize, and DOM changes that move the target.
  window.addEventListener('scroll', refreshSelection, true);
  window.addEventListener('resize', refreshSelection);

  // Watch for slide transitions: when the .slide.active class moves to a
  // different slide, clear the current selection (it belongs to the previous
  // slide).
  const slideObserver = new MutationObserver((mutations) => {
    let activeChanged = false;
    for (const m of mutations) {
      if (m.type === 'attributes' && m.attributeName === 'class') {
        activeChanged = true;
        break;
      }
    }
    if (!activeChanged) return;
    if (state.editingText) {
      const slide = getActiveSlide();
      if (!slide || !slide.contains(state.editingText.el)) endTextEdit();
    }
    if (state.selected) {
      const slide = getActiveSlide();
      if (!slide || !slide.contains(state.selected)) {
        setSelected(null);
        refreshInspector();
      } else {
        refreshSelection();
      }
    }
    refreshAnnotationMarkers();
  });
  function observeSlideClass(slide) {
    if (!slide) return;
    slideObserver.observe(slide, { attributes: true, attributeFilter: ['class'] });
  }
  document.querySelectorAll('.slide').forEach(observeSlideClass);
  // ===========================================================================
  // Drag (scale-aware, with unlock-on-flow)
  // ===========================================================================
  function getCanvasScale() {
    const deck = getDeckRoot();
    if (!deck) return 1;
    const t = getComputedStyle(deck).transform;
    if (!t || t === 'none') return 1;
    try {
      return new DOMMatrixReadOnly(t).a || 1;
    } catch (_) {
      return 1;
    }
  }

  function showToast(refEl, text) {
    const toast = document.createElement('div');
    toast.className = 'wfpe-toast';
    toast.textContent = text;
    root.appendChild(toast);
    // Position above the reference element (or top-left of viewport as fallback).
    const r = refEl.getBoundingClientRect();
    const top = Math.max(8, r.top - 28);
    const left = Math.max(8, Math.min(window.innerWidth - 290, r.left));
    toast.style.top = `${top}px`;
    toast.style.left = `${left}px`;
    setTimeout(() => {
      toast.dataset.state = 'leaving';
      setTimeout(() => toast.remove(), 220);
    }, TOAST_DURATION_MS);
  }

  function onMouseDown(e) {
    // Overview suppresses drag/select — v2.1.3 will install its own
    // mousedown→drag handler routed through the overlay layer.
    if (state.overviewMode) return;
    if (!state.editMode) return;
    if (e.button !== 0) return;

    // While a text edit is open, mousedowns INSIDE the editing element are
    // for caret/selection — let the browser handle them natively.
    // Mousedowns INSIDE the inspector panel apply font/colour/position
    // controls to the element being edited (BRIEF v2.6); they must not
    // tear down contenteditable. Mousedowns elsewhere commit the edit
    // and fall through so the outside element can be selected normally.
    if (state.editingText) {
      if (state.editingText.el.contains(e.target)) return;
      if (inspector.contains(e.target)) {
        rememberTextSelectionRange();
        return;
      }
      endTextEdit();
    }

    // Resize-handle hit takes precedence over a fresh selection/drag.
    const handleDir = e.target && e.target.dataset && e.target.dataset.wfpeHandle;
    if (handleDir && state.selected && !hasMultiSelection()) {
      startResize(e, handleDir);
      return;
    }

    if (isInsideEditorRoot(e.target)) return;
    if (isPointInsidePassiveEditorSurface(e)) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    const target = findSelectableTarget(e.target);
    if (!target) return;

    if (isSelectionToggleEvent(e)) {
      toggleSelectedElement(target);
      e.preventDefault();
      e.stopPropagation();
      state.suppressClickUntil = Date.now() + POST_DRAG_CLICK_GUARD_MS;
      refreshInspector();
      return;
    }

    const currentSelection = getSelectedElements();
    const dragElements = currentSelection.length > 1 && currentSelection.includes(target)
      ? currentSelection
      : [target];
    if (dragElements.length === 1 && state.selected !== target) {
      setSelected(target);
    }

    // Suppress the browser's default mousedown-then-drag text selection so
    // the user doesn't end up highlighting random copy while moving things.
    e.preventDefault();

    const items = dragElements.map((el) => {
      const cs = getComputedStyle(el);
      return {
        el,
        anchorLeft: el.offsetLeft,
        anchorTop: el.offsetTop,
        width: el.offsetWidth,
        height: el.offsetHeight,
        wasAbsolute: cs.position === 'absolute',
      };
    });
    state.drag = {
      el: target,
      items,
      startX: e.clientX,
      startY: e.clientY,
      started: false,
    };

    document.addEventListener('mousemove', onMouseMove, true);
    document.addEventListener('mouseup', onMouseUp, true);
  }

  function startResize(e, dir) {
    const el = state.selected;
    if (!el || hasMultiSelection()) return;
    e.preventDefault();
    e.stopPropagation();

    const wasAbsolute = getComputedStyle(el).position === 'absolute';
    const r = {
      el,
      dir,
      startX: e.clientX,
      startY: e.clientY,
      initLeft: el.offsetLeft,
      initTop: el.offsetTop,
      initWidth: el.offsetWidth,
      initHeight: el.offsetHeight,
    };
    state.resize = r;

    beginTxn();
    touchElement(el);

    // Resize on a flow-positioned element runs the same unlock conversion as
    // a drag would (which now also freezes flex/grid siblings). After unlock,
    // refetch offsets so subsequent dimensional writes are well-defined.
    if (!wasAbsolute) {
      const rect = unlockToAbsolute(el);
      r.initLeft = rect.left;
      r.initTop = rect.top;
      r.initWidth = rect.width;
      r.initHeight = rect.height;
    } else {
      // Lock in the current dimensions so deltas compose deterministically.
      el.style.left = `${r.initLeft}px`;
      el.style.top = `${r.initTop}px`;
      el.style.width = `${r.initWidth}px`;
      el.style.height = `${r.initHeight}px`;
    }

    document.addEventListener('mousemove', onResizeMove, true);
    document.addEventListener('mouseup', onResizeUp, true);
  }

  function onResizeMove(e) {
    const r = state.resize;
    if (!r) return;
    e.preventDefault();
    e.stopPropagation();

    const scale = getCanvasScale();
    const dx = (e.clientX - r.startX) / scale;
    const dy = (e.clientY - r.startY) / scale;

    let left = r.initLeft;
    let top = r.initTop;
    let width = r.initWidth;
    let height = r.initHeight;

    if (r.dir.includes('w')) {
      left = r.initLeft + dx;
      width = r.initWidth - dx;
    } else if (r.dir.includes('e')) {
      width = r.initWidth + dx;
    }
    if (r.dir.includes('n')) {
      top = r.initTop + dy;
      height = r.initHeight - dy;
    } else if (r.dir.includes('s')) {
      height = r.initHeight + dy;
    }

    if (width < RESIZE_MIN_PX) {
      if (r.dir.includes('w')) left = r.initLeft + (r.initWidth - RESIZE_MIN_PX);
      width = RESIZE_MIN_PX;
    }
    if (height < RESIZE_MIN_PX) {
      if (r.dir.includes('n')) top = r.initTop + (r.initHeight - RESIZE_MIN_PX);
      height = RESIZE_MIN_PX;
    }

    applyExplicitSizeConstraints(r.el, { width, height });
    r.el.style.left = `${left}px`;
    r.el.style.top = `${top}px`;
    r.el.style.width = `${width}px`;
    r.el.style.height = `${height}px`;
    refreshSelection();
  }

  function onResizeUp(_e) {
    document.removeEventListener('mousemove', onResizeMove, true);
    document.removeEventListener('mouseup', onResizeUp, true);
    if (state.resize) {
      state.resize = null;
      state.suppressClickUntil = Date.now() + POST_DRAG_CLICK_GUARD_MS;
      endTxn();
    }
  }

  // ---------------------------------------------------------------------------
  // Unlock helpers
  //
  // Promoting any element to position:absolute removes it from its parent's
  // layout. The remaining siblings then reflow — flex/grid via gap or
  // space-between, block via auto-height collapse, etc. To keep visuals
  // pixel-stable on first grab, we pin the dragged element's IMMEDIATE
  // PARENT: snapshot every child's offset in CSS pixels, then write each
  // child as inline `position: absolute` at the captured rect, and lock the
  // parent's own width/height so any outer flow doesn't shift either.
  //
  // Reading offsetLeft/Top/Width/Height is transform-free (unaffected by
  // the WFP scaleIn entrance animation), and crucially is read for ALL
  // children BEFORE any style mutations so the dragged element's offsetWidth
  // doesn't collapse to shrink-to-fit during the snapshot.
  // ---------------------------------------------------------------------------
  function getChildOffsetRelativeToContainer(child, container) {
    if (child.offsetParent === container) {
      return { left: child.offsetLeft, top: child.offsetTop };
    }
    if (child.offsetParent === container.offsetParent) {
      return {
        left: child.offsetLeft - container.offsetLeft,
        top: child.offsetTop - container.offsetTop,
      };
    }

    const scale = getCanvasScale() || 1;
    const childRect = child.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    return {
      left: (childRect.left - containerRect.left) / scale + container.scrollLeft,
      top: (childRect.top - containerRect.top) / scale + container.scrollTop,
    };
  }

  function snapshotChildOffsetsRelativeTo(container) {
    return [...container.children].map((child) => {
      const pos = getChildOffsetRelativeToContainer(child, container);
      return {
        child,
        left: pos.left,
        top: pos.top,
        width: child.offsetWidth,
        height: child.offsetHeight,
      };
    });
  }

  function pinContainerChildren(container) {
    if (container.dataset.wfpEditFlexFrozen === 'true') return;

    // CRITICAL: read every offset BEFORE any writes. Once we set
    // position:absolute on the first child, subsequent reads of OTHER
    // children's offsets reflect the post-mutation flow (which may have
    // collapsed). Snapshot first, write second.
    const wasStatic = getComputedStyle(container).position === 'static';
    const outerWidth = container.offsetWidth;
    const outerHeight = container.offsetHeight;
    const childRects = snapshotChildOffsetsRelativeTo(container);

    touchElement(container);
    if (wasStatic) container.style.position = 'relative';
    // Pin the container's own outer box. Once its children are all absolute,
    // its intrinsic content collapses and any outer block/flex flow would
    // shift. WFP slides are 1920x1080 with one scale on .deck, so viewport
    // reflow doesn't apply.
    container.style.width = `${outerWidth}px`;
    container.style.height = `${outerHeight}px`;

    for (const m of childRects) {
      touchElement(m.child);
      m.child.style.position = 'absolute';
      // Zero out margins. CSS margin-top/left etc. on a positioned element
      // adds to the `top`/`left` distance from the containing block, so a
      // child with `margin-top: 0.75rem` and pinned `top: 37px` would render
      // at offsetTop 49. The captured offset already represents the child's
      // visual position (margin-collapse and all), so margins must be
      // neutralised for the pin to be authoritative.
      m.child.style.margin = '0';
      m.child.style.left = `${m.left}px`;
      m.child.style.top = `${m.top}px`;
      m.child.style.width = `${m.width}px`;
      m.child.style.height = `${m.height}px`;
      m.child.dataset.wfpEditFrozen = 'true';
    }
    container.dataset.wfpEditFlexFrozen = 'true';
  }

  function unlockToAbsolute(el) {
    const slide = getActiveSlide();

    // Walk every ancestor of `el` up to (but not including) the active slide
    // and pin each one. Outermost first so inner snapshots don't see outer
    // mutations. Pinning at every level keeps both immediate siblings
    // (block-flow reflow) and outer siblings (flex/grid redistribution)
    // stable in one pass. The slide itself is excluded — it has explicit
    // 1920x1080 dimensions and its children in WFP fixtures are typically
    // already position:absolute.
    const ancestors = [];
    {
      let cur = el;
      while (cur && cur.parentElement && cur.parentElement !== slide) {
        ancestors.push(cur.parentElement);
        cur = cur.parentElement;
      }
    }
    ancestors.reverse(); // outermost first

    for (const container of ancestors) {
      pinContainerChildren(container);
    }

    // After pinContainerChildren, `el` is one of the pinned children and
    // already has inline position:absolute. The block below is a safety net
    // for the rare case the pin didn't promote it (e.g., parent === slide).
    // Capture all four dimensions BEFORE mutating position so offsetWidth
    // doesn't collapse to shrink-to-fit between the position write and the
    // width write.
    if (getComputedStyle(el).position !== 'absolute') {
      touchElement(el);
      const left = el.offsetLeft;
      const top = el.offsetTop;
      const width = el.offsetWidth;
      const height = el.offsetHeight;
      el.style.position = 'absolute';
      el.style.margin = '0';
      el.style.left = `${left}px`;
      el.style.top = `${top}px`;
      el.style.width = `${width}px`;
      el.style.height = `${height}px`;
      el.dataset.wfpEditFrozen = 'true';
    }

    showToast(el, 'Unlocked. Now positioned absolutely.');
    return {
      left: el.offsetLeft,
      top: el.offsetTop,
      width: el.offsetWidth,
      height: el.offsetHeight,
    };
  }
  // ===========================================================================
  // Inline text edit
  //
  // Double-click a text-bearing element → set contenteditable="true", focus
  // it, and place the caret at the click point. Escape, Tab, or any
  // mousedown outside the editing element commits the change (one history
  // entry capturing the innerHTML diff via the existing snapshot system).
  // ===========================================================================
  function placeCaretAtPoint(x, y) {
    let range = null;
    if (typeof document.caretRangeFromPoint === 'function') {
      range = document.caretRangeFromPoint(x, y);
    } else if (typeof document.caretPositionFromPoint === 'function') {
      const pos = document.caretPositionFromPoint(x, y);
      if (pos) {
        range = document.createRange();
        range.setStart(pos.offsetNode, pos.offset);
        range.collapse(true);
      }
    }
    if (!range) return;
    const sel = window.getSelection();
    if (!sel) return;
    sel.removeAllRanges();
    sel.addRange(range);
  }

  function isNodeInsideElement(node, el) {
    if (!node || !el) return false;
    if (node === el) return true;
    const container = node.nodeType === 1 ? node : node.parentNode;
    return !!container && (container === el || el.contains(container));
  }

  function isRangeInsideElement(range, el) {
    if (!range || !el || !el.isConnected) return false;
    return (
      isNodeInsideElement(range.startContainer, el) &&
      isNodeInsideElement(range.endContainer, el) &&
      isNodeInsideElement(range.commonAncestorContainer, el)
    );
  }

  function rememberTextSelectionRange() {
    const editing = state.editingText;
    if (!editing || !editing.el || !editing.el.isConnected) return;
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    if (!isRangeInsideElement(range, editing.el)) return;
    editing.savedRange = range.collapsed ? null : range.cloneRange();
  }

  function getTextColourRange(el) {
    const editing = state.editingText;
    if (!editing || editing.el !== el) return null;
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0) {
      const current = sel.getRangeAt(0);
      if (!current.collapsed && isRangeInsideElement(current, el)) {
        editing.savedRange = current.cloneRange();
        return current.cloneRange();
      }
    }
    if (
      editing.savedRange &&
      !editing.savedRange.collapsed &&
      isRangeInsideElement(editing.savedRange, el)
    ) {
      return editing.savedRange.cloneRange();
    }
    return null;
  }

  function saveTextColourSpanRange(el, span) {
    if (!state.editingText || state.editingText.el !== el || !span || !span.isConnected) return;
    const range = document.createRange();
    range.selectNodeContents(span);
    state.editingText.savedRange = range.cloneRange();
  }

  function getColourSpanAncestor(node, boundaryEl) {
    let cur = node && node.nodeType === 1 ? node : (node && node.parentElement);
    while (cur && cur !== boundaryEl) {
      if (cur.tagName === 'SPAN' && cur.style && cur.style.color) return cur;
      cur = cur.parentElement;
    }
    return null;
  }

  function getColourSpanForRange(el, range) {
    if (!range || range.collapsed) return null;
    const startSpan = getColourSpanAncestor(range.startContainer, el);
    const endSpan = getColourSpanAncestor(range.endContainer, el);
    if (!startSpan || startSpan !== endSpan) return null;
    if (range.toString() !== startSpan.textContent) return null;
    return startSpan;
  }

  function getActiveTextColourSpan(el) {
    const range = getTextColourRange(el);
    return range ? getColourSpanForRange(el, range) : null;
  }

  function applyTextColourToRange(el, hex, existingSpan = null) {
    if (existingSpan && existingSpan.isConnected && el.contains(existingSpan)) {
      existingSpan.style.color = hex;
      saveTextColourSpanRange(el, existingSpan);
      return existingSpan;
    }

    const range = getTextColourRange(el);
    if (!range) {
      el.style.color = hex;
      return null;
    }

    const colourSpan = getColourSpanForRange(el, range);
    if (colourSpan) {
      colourSpan.style.color = hex;
      saveTextColourSpanRange(el, colourSpan);
      return colourSpan;
    }

    const span = document.createElement('span');
    span.style.color = hex;
    span.appendChild(range.extractContents());
    range.insertNode(span);
    saveTextColourSpanRange(el, span);
    return span;
  }

  function startTextEdit(el, clickX, clickY) {
    if (state.editingText) return;
    if (!isTextBearing(el)) return;

    state.editingText = {
      el,
      originalContenteditable: el.getAttribute('contenteditable'),
      savedRange: null,
    };

    beginTxn({ captureHtml: true });
    touchElement(el);

    el.setAttribute('contenteditable', 'true');
    el.focus();
    if (clickX != null && clickY != null) placeCaretAtPoint(clickX, clickY);

    refreshSelection(); // hides ring/handles via the editingText guard
  }

  function endTextEdit() {
    const editing = state.editingText;
    if (!editing) return;
    const { el, originalContenteditable } = editing;
    state.editingText = null;

    if (originalContenteditable === null) el.removeAttribute('contenteditable');
    else el.setAttribute('contenteditable', originalContenteditable);

    if (typeof el.blur === 'function') el.blur();
    const sel = window.getSelection();
    if (sel) sel.removeAllRanges();

    endTxn();
    refreshSelection();
  }

  function onDoubleClick(e) {
    // No inline text-edit in overview — slides aren't focusable as text
    // targets; double-click is reserved for future overview semantics.
    if (state.overviewMode) return;
    if (!state.editMode) return;
    if (isInsideEditorRoot(e.target)) return;
    const target = findSelectableTarget(e.target);
    if (!target || !isTextBearing(target)) return;
    e.preventDefault();
    e.stopPropagation();
    setSelected(target);
    startTextEdit(target, e.clientX, e.clientY);
  }

  document.addEventListener('dblclick', onDoubleClick, true);
  document.addEventListener('selectionchange', rememberTextSelectionRange);

  function onMouseMove(e) {
    const d = state.drag;
    if (!d) return;
    const dxView = e.clientX - d.startX;
    const dyView = e.clientY - d.startY;

    if (!d.started) {
      const distSq = dxView * dxView + dyView * dyView;
      if (distSq < DRAG_DEADZONE_PX * DRAG_DEADZONE_PX) return;
      d.started = true;
      beginTxn();
      for (const item of d.items || []) {
        touchElement(item.el);
      }
      for (const item of d.items || []) {
        if (!item.wasAbsolute) {
          unlockToAbsolute(item.el);
        }
      }
      for (const item of d.items || []) {
        if (!item.el || !item.el.isConnected) continue;
        item.anchorLeft = item.el.offsetLeft;
        item.anchorTop = item.el.offsetTop;
        item.width = item.el.offsetWidth;
        item.height = item.el.offsetHeight;
        // Lock in the anchor as inline left/top so subsequent drags compose.
        item.el.style.left = `${item.anchorLeft}px`;
        item.el.style.top = `${item.anchorTop}px`;
      }
    }

    e.preventDefault();
    e.stopPropagation();

    const scale = getCanvasScale();
    const dx = dxView / scale;
    const dy = dyView / scale;
    for (const item of d.items || []) {
      if (!item.el || !item.el.isConnected) continue;
      item.el.style.left = `${item.anchorLeft + dx}px`;
      item.el.style.top = `${item.anchorTop + dy}px`;
    }
    refreshSelection();
  }

  function onMouseUp(_e) {
    document.removeEventListener('mousemove', onMouseMove, true);
    document.removeEventListener('mouseup', onMouseUp, true);
    const d = state.drag;
    state.drag = null;
    if (d && d.started) {
      // The browser will fire a click after this mouseup. Swallow it so we
      // don't accidentally re-select or deselect.
      state.suppressClickUntil = Date.now() + POST_DRAG_CLICK_GUARD_MS;
      endTxn();
    }
    // After a drag (or a no-op mousedown that didn't lead to drag), the
    // post-click suppress fires; refresh the inspector so the panel
    // reflects the resulting selection state.
    refreshInspector();
  }

  document.addEventListener('mousedown', onMouseDown, true);
  // ===========================================================================
  // Save-in-place engine (v2.11)
  //
  // Chromium-only File System Access path. First save binds a file handle
  // via the native picker (the one interaction Chrome's security model
  // requires); subsequent saves write silently. The handle is persisted to
  // IndexedDB keyed by the page URL so a reload only costs a one-click
  // permission re-grant instead of a fresh picker. Storage failures are
  // swallowed: persistence is an optimisation, never a gate on saving.
  // ===========================================================================
  const HANDLE_DB_NAME = 'wfp-editor';
  const HANDLE_STORE_NAME = 'handles';
  let boundFileHandle = null;
  // Captured once at init so saveInPlace() can await the same in-flight
  // rehydration instead of racing it (see the Ready block below).
  let handleRehydration = null;

  function canSaveInPlace() {
    return typeof window.showSaveFilePicker === 'function';
  }

  function deriveSourceFilename() {
    return deriveExportFilename('');
  }

  function openHandleDb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(HANDLE_DB_NAME, 1);
      req.onupgradeneeded = () => {
        req.result.createObjectStore(HANDLE_STORE_NAME);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function loadStoredHandle() {
    try {
      const db = await openHandleDb();
      const result = await new Promise((resolve) => {
        const tx = db.transaction(HANDLE_STORE_NAME, 'readonly');
        const req = tx.objectStore(HANDLE_STORE_NAME).get(location.href);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => resolve(null);
      });
      db.close(); // release the connection once the round-trip settles
      return result;
    } catch (_) {
      return null;
    }
  }

  async function storeBoundHandle(handle) {
    try {
      const db = await openHandleDb();
      await new Promise((resolve) => {
        const tx = db.transaction(HANDLE_STORE_NAME, 'readwrite');
        tx.objectStore(HANDLE_STORE_NAME).put(handle, location.href);
        tx.oncomplete = resolve;
        tx.onabort = resolve;
        tx.onerror = resolve;
      });
      db.close(); // release the connection once the round-trip settles
    } catch (_) {
      /* persistence is best-effort */
    }
  }

  async function forgetBoundHandle() {
    boundFileHandle = null;
    try {
      const db = await openHandleDb();
      await new Promise((resolve) => {
        const tx = db.transaction(HANDLE_STORE_NAME, 'readwrite');
        tx.objectStore(HANDLE_STORE_NAME).delete(location.href);
        tx.oncomplete = resolve;
        tx.onabort = resolve;
        tx.onerror = resolve;
      });
      db.close(); // release the connection once the round-trip settles
    } catch (_) {
      /* best-effort */
    }
  }

  async function ensureHandleWritable(handle) {
    try {
      if (typeof handle.queryPermission === 'function') {
        if ((await handle.queryPermission({ mode: 'readwrite' })) === 'granted') return true;
        if (typeof handle.requestPermission === 'function') {
          return (await handle.requestPermission({ mode: 'readwrite' })) === 'granted';
        }
      }
      return true; // no permission API on this handle — let the write decide
    } catch (_) {
      return false;
    }
  }

  async function writeHtmlToHandle(handle, html) {
    const writable = await handle.createWritable();
    await writable.write(html);
    await writable.close();
  }

  async function pickSourceHandle() {
    const handle = await window.showSaveFilePicker({
      suggestedName: deriveSourceFilename(),
      types: [{ description: 'HTML document', accept: { 'text/html': ['.html', '.htm'] } }],
    });
    boundFileHandle = handle;
    await storeBoundHandle(handle);
    return handle;
  }

  async function saveInPlace() {
    if (state.editingText) endTextEdit();
    const noteCount = getAnnotatedElements(document).length;
    const html = noteCount > 0 ? buildHandoffExportHtml() : buildExportHtml();
    try {
      // A save fired right after ready can race the still-in-flight
      // rehydration; wait for it so we reuse the stored handle instead of
      // opening a needless fresh picker.
      if (!boundFileHandle && handleRehydration) await handleRehydration;
      let handle = boundFileHandle;
      if (!handle) {
        handle = await pickSourceHandle();
      } else if (!(await ensureHandleWritable(handle))) {
        showToast(document.body, 'Save cancelled — file access not granted.');
        return;
      }
      try {
        await writeHtmlToHandle(handle, html);
      } catch (err) {
        // Stale handle (file moved/renamed/deleted): drop it and re-pick
        // within the same user gesture, then retry once.
        await forgetBoundHandle();
        handle = await pickSourceHandle();
        await writeHtmlToHandle(handle, html);
      }
      showToast(
        document.body,
        noteCount > 0
          ? `Saved ${handle.name} — ${noteCount} agent note${noteCount === 1 ? '' : 's'}`
          : `Saved ${handle.name}`,
      );
    } catch (err) {
      if (err && err.name === 'AbortError') {
        showToast(document.body, 'Save cancelled.');
        return;
      }
      showToast(document.body, `Save failed (${(err && err.name) || 'unknown'}) — try Export → Clean copy.`);
    }
  }
  // ===========================================================================
  // Export
  //
  // Clone the live DOM, strip everything the editor injected (root + script
  // + data-wfp-edit-* + contenteditable), serialize, and trigger a download.
  // Normal export stays clean; handoff export intentionally adds structured
  // user-authored annotation metadata after the cleanup pass.
  // ===========================================================================
  function deriveExportFilename(suffix = '-edited') {
    let path = location.pathname || '';
    try {
      path = decodeURIComponent(path);
    } catch (_) {
      /* leave as-is */
    }
    const lastSegment = path.split('/').pop() || '';
    const m = lastSegment.match(/^(.+?)(\.html?)?$/i);
    const base = (m && m[1]) || 'slide';
    const ext = (m && m[2]) || '.html';
    return `${base}${suffix}${ext}`;
  }

  function shouldSkipAssetUrl(raw) {
    const value = (raw || '').trim();
    return (
      !value ||
      value.startsWith('#') ||
      /^(data|blob|javascript|mailto|tel):/i.test(value)
    );
  }

  function resolveExportAssetUrl(raw, baseUrl) {
    const value = (raw || '').trim();
    if (shouldSkipAssetUrl(value)) return raw;
    try {
      return new URL(value, baseUrl).href;
    } catch (_) {
      return raw;
    }
  }

  function absolutizeCssUrls(cssText, baseUrl) {
    if (!cssText || !cssText.includes('url(')) return cssText;
    return cssText.replace(
      /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*?))\s*\)/g,
      (match, doubleQuoted, singleQuoted, bare) => {
        const raw = doubleQuoted ?? singleQuoted ?? (bare || '').trim();
        const resolved = resolveExportAssetUrl(raw, baseUrl);
        if (resolved === raw) return match;
        const quote = singleQuoted !== undefined ? "'" : '"';
        return `url(${quote}${resolved}${quote})`;
      },
    );
  }

  function absolutizeSrcset(value, baseUrl) {
    if (!value) return value;
    return value
      .split(',')
      .map((candidate) => {
        const trimmed = candidate.trim();
        if (!trimmed) return candidate;
        const parts = trimmed.split(/\s+/);
        parts[0] = resolveExportAssetUrl(parts[0], baseUrl);
        return parts.join(' ');
      })
      .join(', ');
  }

  function absolutizeExportAssetUrls(root) {
    const baseUrl = document.baseURI || location.href;
    const attrTargets = [
      ['[src]', 'src'],
      ['link[href], image[href], use[href]', 'href'],
      ['[poster]', 'poster'],
      ['object[data]', 'data'],
    ];

    attrTargets.forEach(([selector, attr]) => {
      root.querySelectorAll(selector).forEach((el) => {
        const value = el.getAttribute(attr);
        const resolved = resolveExportAssetUrl(value, baseUrl);
        if (resolved !== value) el.setAttribute(attr, resolved);
      });
    });

    root.querySelectorAll('[srcset]').forEach((el) => {
      const value = el.getAttribute('srcset');
      const resolved = absolutizeSrcset(value, baseUrl);
      if (resolved !== value) el.setAttribute('srcset', resolved);
    });

    root.querySelectorAll('[style]').forEach((el) => {
      const value = el.getAttribute('style');
      const resolved = absolutizeCssUrls(value, baseUrl);
      if (resolved !== value) el.setAttribute('style', resolved);
    });

    root.querySelectorAll('style').forEach((style) => {
      const resolved = absolutizeCssUrls(style.textContent, baseUrl);
      if (resolved !== style.textContent) style.textContent = resolved;
    });
  }

  function hasDynamicProgressDotBuilder(root) {
    return [...root.querySelectorAll('script')].some((script) => {
      const text = script.textContent || '';
      return (
        /progress-dot/.test(text) &&
        /createElement\s*\(/.test(text) &&
        /appendChild\s*\(/.test(text)
      );
    });
  }

  function isRuntimeGeneratedProgressDot(dot) {
    const nonClassAttributes = [...dot.attributes].filter((attr) => attr.name !== 'class');
    return (
      nonClassAttributes.length === 0 &&
      dot.children.length === 0 &&
      dot.textContent.trim() === ''
    );
  }

  function removeRuntimeGeneratedProgressDots(root) {
    if (!hasDynamicProgressDotBuilder(root)) return;

    root.querySelectorAll('.progress').forEach((progress) => {
      progress.querySelectorAll(':scope > .progress-dot').forEach((dot) => {
        if (isRuntimeGeneratedProgressDot(dot)) dot.remove();
      });
    });
  }

  function getExportDeckRoots(root) {
    const markedRoots = [...root.querySelectorAll('[data-wfp-edit-deck-root]:not([data-wfp-edit-flat-root])')];
    return markedRoots.length ? markedRoots : [...root.querySelectorAll('.deck')];
  }

  function normalizeExportStartupState(root) {
    getExportDeckRoots(root).forEach((deck) => {
      const slides = [...deck.querySelectorAll(':scope > .slide')];
      if (!slides.length) return;
      slides.forEach((slide, index) => {
        slide.classList.toggle('active', index === 0);
      });
    });

    root.querySelectorAll('.progress').forEach((progress) => {
      const dots = [...progress.querySelectorAll('.progress-dot')];
      if (!dots.length) return;
      dots.forEach((dot, index) => {
        dot.classList.toggle('active', index === 0);
      });
    });
  }

  function buildExportClone() {
    const clone = document.documentElement.cloneNode(true);

    const editorRoot = clone.querySelector(`#${ROOT_ID}`);
    if (editorRoot) editorRoot.remove();

    // Two ways the editor script is injected:
    //   - bookmarklet:   <script src="...editor.js?..."> → match by src
    //   - inline tag:    addScriptTag({ path }) — no src → match by the
    //     data-wfp-edit-script marker we set at load time
    // Run BOTH selectors before the data-wfp-edit-* sweep so the marker
    // hasn't been stripped from the script element yet.
    clone.querySelectorAll('[data-wfp-edit-script]').forEach((s) => s.remove());
    clone.querySelectorAll('script[src*="editor.js"]').forEach((s) => s.remove());

    absolutizeExportAssetUrls(clone);
    removeRuntimeGeneratedProgressDots(clone);
    normalizeExportStartupState(clone);

    return clone;
  }

  function stripEditorArtifactsFromDocument(clone) {
    clone.querySelectorAll('*').forEach((el) => {
      for (const attr of [...el.attributes]) {
        if (attr.name.startsWith('data-wfp-edit')) el.removeAttribute(attr.name);
      }
      if (el.hasAttribute('contenteditable')) el.removeAttribute('contenteditable');
    });
  }

  function getSlideIndexForHandoffTarget(root, target) {
    const decks = getExportDeckRoots(root);
    for (const deck of decks) {
      const slides = [...deck.querySelectorAll(':scope > .slide')];
      const slide = target.closest('.slide');
      if (slide && slides.includes(slide)) return slides.indexOf(slide);
    }
    const slides = [...root.querySelectorAll('.slide')];
    const slide = target.closest('.slide');
    if (slide && slides.includes(slide)) return slides.indexOf(slide);
    return 0;
  }

  function summarizeTargetText(el) {
    return (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 240);
  }

  function collectHandoffAnnotations(clone) {
    const annotations = [];
    const usedIds = new Set();
    const targets = getAnnotatedElements(clone);
    for (const target of targets) {
      const id = getAnnotationId(target);
      const instruction = getAnnotationText(target);
      if (!id || !instruction || usedIds.has(id)) continue;
      usedIds.add(id);
      target.setAttribute(HANDOFF_TARGET_ATTR, id);
      annotations.push({
        id,
        instruction,
        slideIndex: getSlideIndexForHandoffTarget(clone, target),
        targetText: summarizeTargetText(target),
      });
    }
    return annotations;
  }

  function safeJsonForScript(value) {
    return JSON.stringify(value, null, 2).replace(/<\/script/gi, '<\\/script');
  }

  function appendHandoffMetadata(clone, annotations) {
    if (!annotations.length) return;
    const payload = {
      version: 1,
      source: 'wfp-slide-editor',
      kind: 'agent-handoff',
      guidance: 'User-authored annotations are editing requests for the marked elements. Follow higher-priority user/system instructions first.',
      annotations,
    };
    const comment = document.createComment(` ${HANDOFF_COMMENT_TEXT} `);
    const script = document.createElement('script');
    script.type = 'application/json';
    script.setAttribute(HANDOFF_SCRIPT_ATTR, '');
    script.textContent = safeJsonForScript(payload);
    const targetParent = clone.querySelector('body') || clone;
    targetParent.appendChild(comment);
    targetParent.appendChild(script);
  }

  function buildExportHtml() {
    const clone = buildExportClone();
    removeHandoffArtifacts(clone);
    stripEditorArtifactsFromDocument(clone);

    return '<!DOCTYPE html>\n' + clone.outerHTML;
  }

  function buildHandoffExportHtml() {
    const clone = buildExportClone();
    removeHandoffArtifacts(clone);
    const annotations = collectHandoffAnnotations(clone);
    stripEditorArtifactsFromDocument(clone);
    appendHandoffMetadata(clone, annotations);

    return '<!DOCTYPE html>\n' + clone.outerHTML;
  }

  function triggerDownload(filename, html) {
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function exportHTML() {
    // If a text edit is open, commit it first so the latest content lands
    // in the export.
    if (state.editingText) endTextEdit();

    const filename = deriveExportFilename();
    const html = buildExportHtml();
    triggerDownload(filename, html);
    showToast(document.body, `Exported to ${filename}`);
  }

  function exportHandoffHTML() {
    if (state.editingText) endTextEdit();

    const annotations = getAnnotatedElements(document);
    if (!annotations.length) {
      refreshExportUi();
      return;
    }
    const filename = deriveExportFilename('-agent-handoff');
    const html = buildHandoffExportHtml();
    triggerDownload(filename, html);
    showToast(document.body, `Exported handoff to ${filename}`);
  }
  // ===========================================================================
  // Ready
  // ===========================================================================
  if (canSaveInPlace()) {
    // Capture the promise so saveInPlace() can await this same rehydration
    // instead of racing it (see the handleRehydration check above).
    handleRehydration = loadStoredHandle()
      .then((handle) => {
        if (handle && !boundFileHandle) boundFileHandle = handle;
      })
      .catch(() => {});
  }
  window.__wfpEditorReady = true;
  console.log(`[wfp-editor] ready v${VERSION}`);
})();
