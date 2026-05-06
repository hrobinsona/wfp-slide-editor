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
 *          inline SVG icons (lucide aesthetic), button order Edit · Export ·
 *          Undo · Redo, no behavior change.
 *
 * Internal class names use the `wfpe-` prefix so they don't collide with
 * the WFP fixtures' own `wfp-badge` / `wfp-*` classes.
 */
(function () {
  'use strict';

  const VERSION = '2.1.0-v2.1.1';
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
    drag: null, // { el, startX, startY, anchorLeft, anchorTop, width, height, wasAbsolute, started }
    resize: null, // { el, dir, startX, startY, initLeft, initTop, initWidth, initHeight }
    editingText: null, // { el, originalContenteditable } while a text edit is open
    suppressClickUntil: 0,
    history: [], // entries: [{ changes: [{element, before, after}, ...] }]
    historyIndex: 0, // 0 = nothing applied; history.length = all applied
    txn: null, // { snapshots: Map<Element, BeforeSnap>, captureHtml } when an op is in progress
    inspectorMinimised: false, // persists across selections within session; resets on reload
    overviewMode: false, // v2.1.0 — bird's-eye grid of all slides; toggled by hotkey O / toolbar button / Escape
    overviewDrag: null, // v2.1.3 — { sourceSlide, sourceIndex, beforeOrder } during a drag-to-reorder
    overviewHoveredSlide: null, // v2.1.4 — slide whose thumb the cursor is over (Backspace/Delete target)
    deckMutated: false, // v2.1.0 hotfix — set true on first overview reorder/delete; flips arrow-nav to live-DOM (the fixture's cached slide list goes stale)
  };

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
    /* ----- Liquid glass surface (toolbar; inspector reuses these tokens
       in v2.1+). Light variant by default; dark variant via prefers-
       color-scheme. Recipe values come from feature-briefs/v2-inspector.md. ----- */
    #${ROOT_ID} .wfpe-toolbar {
      position: fixed;
      top: 16px;
      right: 16px;
      pointer-events: auto;
      display: flex;
      align-items: stretch;
      gap: 2px;
      padding: 5px;
      border-radius: 18px;
      /* Liquid-glass luminance rule: white text needs the surface to drop
         brightness, not just blur. White tint kept for the aesthetic, but
         brightness(0.78) ensures contrast on pale backgrounds (e.g. coral
         slides). saturate(180%) restores chroma after the brightness drop. */
      background: rgba(255, 255, 255, 0.12);
      backdrop-filter: blur(20px) saturate(180%) brightness(0.78);
      -webkit-backdrop-filter: blur(20px) saturate(180%) brightness(0.78);
      border: 1px solid rgba(255, 255, 255, 0.24);
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.25);
      font: 10px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
      letter-spacing: 0.005em;
      user-select: none;
      color: #fff;
      isolation: isolate;
      /* Always paint above the selection ring + resize handles, which
         live as later DOM siblings under the same root. */
      z-index: 2;
    }
    /* Inner highlight overlay — renders the bright top-edge sheen called
       out in the recipe. Pointer-events: none so it doesn't eat clicks. */
    #${ROOT_ID} .wfpe-toolbar::before {
      content: '';
      position: absolute;
      inset: 0;
      border-radius: inherit;
      background: linear-gradient(to bottom, rgba(255, 255, 255, 0.35), rgba(255, 255, 255, 0) 40%);
      pointer-events: none;
      z-index: -1;
    }
    #${ROOT_ID} .wfpe-toolbar-btn,
    #${ROOT_ID} .wfpe-mode-badge {
      appearance: none;
      -webkit-appearance: none;
      background: transparent;
      border: 0;
      color: #fff;
      font: inherit;
      letter-spacing: inherit;
      display: inline-flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 3px;
      padding: 6px 10px 5px;
      min-width: 56px;
      border-radius: 13px;
      cursor: pointer;
      white-space: nowrap;
      transition: background-color 180ms ease, transform 180ms ease, box-shadow 180ms ease;
    }
    #${ROOT_ID} .wfpe-toolbar-btn .wfpe-icon,
    #${ROOT_ID} .wfpe-mode-badge .wfpe-icon {
      width: 18px;
      height: 18px;
      flex: 0 0 18px;
      stroke: currentColor;
      fill: none;
      stroke-width: 1.75;
      stroke-linecap: round;
      stroke-linejoin: round;
    }
    #${ROOT_ID} .wfpe-mode-badge {
      font-weight: 600;
    }
    #${ROOT_ID} .wfpe-toolbar-btn:hover,
    #${ROOT_ID} .wfpe-mode-badge:hover {
      background-color: rgba(255, 255, 255, 0.18);
      transform: translateY(-1px);
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.18);
    }
    #${ROOT_ID} .wfpe-toolbar-btn:active,
    #${ROOT_ID} .wfpe-mode-badge:active {
      background-color: rgba(255, 255, 255, 0.28);
      transform: translateY(0);
      box-shadow: none;
    }
    #${ROOT_ID} .wfpe-mode-badge[data-mode="on"] {
      background:
        radial-gradient(120% 120% at 50% 0%, rgba(255, 200, 175, 0.55) 0%, rgba(244, 132, 123, 0.85) 60%, rgba(232, 110, 103, 0.95) 100%);
      color: #fff;
      box-shadow:
        0 6px 18px rgba(232, 110, 103, 0.45),
        inset 0 1px 0 rgba(255, 255, 255, 0.45),
        inset 0 -1px 0 rgba(0, 0, 0, 0.10);
    }
    /* Overview button active state (v2.1.0). A persistent white-tint
       highlight in the Liquid Glass dialect — distinct from Edit's coral
       pill (Edit signals editability; Overview signals a view mode). */
    #${ROOT_ID} .wfpe-toolbar-btn[data-mode="on"] {
      background-color: rgba(255, 255, 255, 0.22);
      box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.35);
    }
    #${ROOT_ID} .wfpe-toolbar-btn[data-mode="on"]:hover {
      background-color: rgba(255, 255, 255, 0.28);
    }
    #${ROOT_ID} .wfpe-mode-badge[data-mode="on"]:hover {
      filter: brightness(1.06);
      background-color: transparent;
      transform: translateY(-1px);
      box-shadow:
        0 8px 22px rgba(232, 110, 103, 0.55),
        inset 0 1px 0 rgba(255, 255, 255, 0.5),
        inset 0 -1px 0 rgba(0, 0, 0, 0.10);
    }
    @media (prefers-color-scheme: dark) {
      #${ROOT_ID} .wfpe-toolbar {
        background: rgba(255, 255, 255, 0.12);
        border-color: rgba(255, 255, 255, 0.24);
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.25);
      }
      #${ROOT_ID} .wfpe-toolbar-btn:hover,
      #${ROOT_ID} .wfpe-mode-badge:hover {
        background-color: rgba(255, 255, 255, 0.14);
      }
      #${ROOT_ID} .wfpe-toolbar-btn:active,
      #${ROOT_ID} .wfpe-mode-badge:active {
        background-color: rgba(255, 255, 255, 0.22);
      }
    }
    /* ----- Inspector panel (v2.1+). Same liquid-glass surface as the
       toolbar, parked top-right beneath it. Empty body in v2.1; subsequent
       phases populate font-size, position/size, colour, and reset controls.
       Minimised state collapses to a slim re-open chevron rendered in place
       of the full panel; the preference persists across selections via
       state.inspectorMinimised but resets on page reload. ----- */
    #${ROOT_ID} .wfpe-inspector {
      position: fixed;
      /* 16 (top offset) + ~58 (toolbar height: 5+18+3+10+5 + 5×2 padding +
         2px buffer) + 8 gap = 82. Keeps a clean 8px gutter under the
         toolbar regardless of slide content. */
      top: 82px;
      right: 16px;
      width: 280px;
      pointer-events: auto;
      display: none;
      /* Same z-index stratum as the toolbar so neither selection ring
         nor resize handles can paint over the inspector. */
      z-index: 2;
      flex-direction: column;
      border-radius: 18px;
      padding: 0;
      /* Same liquid-glass luminance recipe as the toolbar — white text
         needs the surface to drop brightness, not just blur. */
      background: rgba(255, 255, 255, 0.12);
      backdrop-filter: blur(20px) saturate(180%) brightness(0.78);
      -webkit-backdrop-filter: blur(20px) saturate(180%) brightness(0.78);
      border: 1px solid rgba(255, 255, 255, 0.24);
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.25);
      font: 12px/1.35 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
      letter-spacing: 0.005em;
      user-select: none;
      color: #fff;
      isolation: isolate;
    }
    #${ROOT_ID} .wfpe-inspector::before {
      content: '';
      position: absolute;
      inset: 0;
      border-radius: inherit;
      background: linear-gradient(to bottom, rgba(255, 255, 255, 0.35), rgba(255, 255, 255, 0) 40%);
      pointer-events: none;
      z-index: -1;
    }
    #${ROOT_ID} .wfpe-inspector[data-visible="true"] {
      display: flex;
    }
    #${ROOT_ID} .wfpe-inspector-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      padding: 10px 12px 10px 14px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.14);
    }
    #${ROOT_ID} .wfpe-inspector[data-state="minimised"] .wfpe-inspector-header {
      border-bottom: 0;
    }
    #${ROOT_ID} .wfpe-inspector-title {
      font-weight: 600;
      font-size: 12px;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      opacity: 0.8;
    }
    #${ROOT_ID} .wfpe-inspector-minimise {
      appearance: none;
      -webkit-appearance: none;
      background: transparent;
      border: 0;
      color: inherit;
      padding: 4px;
      border-radius: 8px;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      transition: background-color 120ms ease;
    }
    #${ROOT_ID} .wfpe-inspector-minimise:hover {
      background-color: rgba(255, 255, 255, 0.22);
    }
    #${ROOT_ID} .wfpe-inspector-minimise .wfpe-icon {
      width: 16px;
      height: 16px;
      stroke: currentColor;
      fill: none;
      stroke-width: 1.75;
      stroke-linecap: round;
      stroke-linejoin: round;
    }
    #${ROOT_ID} .wfpe-inspector-body {
      padding: 12px 14px 14px 14px;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    #${ROOT_ID} .wfpe-inspector[data-state="minimised"] .wfpe-inspector-body {
      display: none;
    }
    /* Inspector form rows (v2.2+): label on the left, paired numeric
       inputs on the right. Inputs commit on Enter/blur, not per keystroke. */
    #${ROOT_ID} .wfpe-inspector-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
    }
    #${ROOT_ID} .wfpe-inspector-row-label {
      font-size: 11px;
      font-weight: 500;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      opacity: 0.7;
    }
    #${ROOT_ID} .wfpe-inspector-pair {
      display: flex;
      gap: 6px;
    }
    #${ROOT_ID} .wfpe-inspector-field {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      background: rgba(255, 255, 255, 0.12);
      border: 1px solid rgba(255, 255, 255, 0.18);
      border-radius: 8px;
      padding: 3px 6px 3px 8px;
      font-size: 12px;
      color: #fff;
    }
    #${ROOT_ID} .wfpe-inspector-field-axis {
      opacity: 0.65;
      font-size: 10px;
      font-weight: 600;
      letter-spacing: 0.04em;
      text-transform: uppercase;
    }
    #${ROOT_ID} .wfpe-inspector-field input {
      appearance: none;
      -webkit-appearance: none;
      -moz-appearance: textfield;
      background: transparent;
      border: 0;
      color: inherit;
      font: inherit;
      padding: 0;
      margin: 0;
      width: 48px;
      text-align: right;
      outline: none;
    }
    #${ROOT_ID} .wfpe-inspector-field input::-webkit-outer-spin-button,
    #${ROOT_ID} .wfpe-inspector-field input::-webkit-inner-spin-button {
      -webkit-appearance: none;
      margin: 0;
    }
    #${ROOT_ID} .wfpe-inspector-field:focus-within {
      border-color: rgba(255, 255, 255, 0.55);
      background: rgba(255, 255, 255, 0.22);
    }
    /* Font-size row (v2.3): the label sits on its own line above the
       controls so the sub-row [input · px][−][slider][+] gets the full
       panel width without the parent label squeezing it. Renders only
       for text-bearing elements. */
    #${ROOT_ID} .wfpe-inspector-row[data-wfpe-row="font-size"] {
      flex-direction: column;
      align-items: stretch;
      gap: 8px;
    }
    #${ROOT_ID} .wfpe-font-control {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    #${ROOT_ID} .wfpe-font-control .wfpe-inspector-field {
      flex: 0 0 auto;
      justify-content: flex-end;
      padding: 4px 8px;
    }
    #${ROOT_ID} .wfpe-font-control .wfpe-inspector-field input {
      width: 38px;
      text-align: right;
    }
    #${ROOT_ID} .wfpe-font-unit {
      opacity: 0.65;
      font-size: 11px;
      font-weight: 500;
      letter-spacing: 0.02em;
    }
    #${ROOT_ID} .wfpe-font-btn {
      appearance: none;
      -webkit-appearance: none;
      background: rgba(255, 255, 255, 0.12);
      border: 1px solid rgba(255, 255, 255, 0.18);
      color: #fff;
      width: 24px;
      height: 24px;
      border-radius: 7px;
      cursor: pointer;
      font: 600 14px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      flex: 0 0 24px;
      transition: background-color 120ms ease;
    }
    #${ROOT_ID} .wfpe-font-btn:hover {
      background-color: rgba(255, 255, 255, 0.22);
    }
    #${ROOT_ID} .wfpe-font-slider {
      appearance: none;
      -webkit-appearance: none;
      flex: 1;
      min-width: 0;
      height: 4px;
      background: rgba(255, 255, 255, 0.22);
      border-radius: 2px;
      outline: none;
      margin: 0;
    }
    #${ROOT_ID} .wfpe-font-slider::-webkit-slider-thumb {
      -webkit-appearance: none;
      appearance: none;
      width: 14px;
      height: 14px;
      border-radius: 50%;
      background: #fff;
      border: 2px solid rgba(15, 23, 42, 0.85);
      box-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
      cursor: grab;
    }
    #${ROOT_ID} .wfpe-font-slider::-moz-range-thumb {
      width: 14px;
      height: 14px;
      border-radius: 50%;
      background: #fff;
      border: 2px solid rgba(15, 23, 42, 0.85);
      box-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
      cursor: grab;
    }
    /* Colour controls (v2.4): row label, then a swatch (showing the
       current colour), a hex text input, and — for background only —
       a "transparent" clear button. The native <input type="color">
       sits behind the swatch as a click-trigger. */
    #${ROOT_ID} .wfpe-color-control {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    #${ROOT_ID} .wfpe-color-swatch {
      position: relative;
      width: 22px;
      height: 22px;
      border-radius: 6px;
      border: 1px solid rgba(255, 255, 255, 0.32);
      background-color: #ffffff;
      cursor: pointer;
      flex: 0 0 22px;
      padding: 0;
      overflow: hidden;
      isolation: isolate;
    }
    /* Checkerboard for transparent backgrounds — only painted when the
       swatch carries data-transparent="true". */
    #${ROOT_ID} .wfpe-color-swatch[data-transparent="true"] {
      background:
        linear-gradient(45deg, #ccc 25%, transparent 25%) 0 0 / 8px 8px,
        linear-gradient(-45deg, #ccc 25%, transparent 25%) 0 4px / 8px 8px,
        linear-gradient(45deg, transparent 75%, #ccc 75%) 4px -4px / 8px 8px,
        linear-gradient(-45deg, transparent 75%, #ccc 75%) 4px 0 / 8px 8px,
        #fff;
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
    /* Opacity row (v2.9): label on its own line, then a sub-row with
       a value field (whole percent + "%" suffix) and a slider that
       takes the remaining width. Mirrors the font-size row layout. */
    #${ROOT_ID} .wfpe-inspector-row[data-wfpe-row="opacity"] {
      flex-direction: column;
      align-items: stretch;
      gap: 8px;
    }
    #${ROOT_ID} .wfpe-opacity-control {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    #${ROOT_ID} .wfpe-opacity-control .wfpe-inspector-field {
      flex: 0 0 auto;
      justify-content: flex-end;
      padding: 4px 8px;
    }
    #${ROOT_ID} .wfpe-opacity-control .wfpe-inspector-field input {
      width: 38px;
      text-align: right;
    }
    #${ROOT_ID} .wfpe-opacity-unit {
      opacity: 0.65;
      font-size: 11px;
      font-weight: 500;
      letter-spacing: 0.02em;
    }
    /* Element has a background-image (e.g. gradient): show a diagonal
       stripe so it's obvious why the hex picker can't represent it. */
    #${ROOT_ID} .wfpe-color-swatch[data-image="true"] {
      background:
        repeating-linear-gradient(
          45deg,
          rgba(255, 255, 255, 0.55) 0 4px,
          rgba(15, 23, 42, 0.35) 4px 8px
        );
    }
    #${ROOT_ID} .wfpe-color-clear {
      appearance: none;
      -webkit-appearance: none;
      background: rgba(255, 255, 255, 0.12);
      border: 1px solid rgba(255, 255, 255, 0.18);
      color: #fff;
      width: 22px;
      height: 22px;
      border-radius: 6px;
      cursor: pointer;
      font-size: 11px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      flex: 0 0 22px;
      transition: background-color 120ms ease;
    }
    #${ROOT_ID} .wfpe-color-clear:hover {
      background-color: rgba(255, 255, 255, 0.22);
    }
    /* Reset-styles row (v2.5 redesign): inline icon + label, left-aligned,
       reading as a quiet text link rather than a full-width pill. The
       refresh icon signals the destructive nature without leaning on
       colour. The whole row is the click target via the button itself. */
    #${ROOT_ID} .wfpe-inspector-row[data-wfpe-row="reset"] {
      justify-content: flex-start;
      gap: 0;
      padding-top: 4px;
    }
    #${ROOT_ID} .wfpe-reset-btn {
      appearance: none;
      -webkit-appearance: none;
      background: transparent;
      border: 0;
      color: rgba(255, 255, 255, 0.78);
      padding: 4px 6px;
      margin-left: -6px;
      border-radius: 6px;
      cursor: pointer;
      font: 500 11px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
      letter-spacing: 0.01em;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      transition: color 120ms ease, background-color 120ms ease;
    }
    #${ROOT_ID} .wfpe-reset-btn:hover {
      color: #fff;
      background-color: rgba(255, 255, 255, 0.10);
    }
    #${ROOT_ID} .wfpe-reset-btn .wfpe-icon {
      width: 13px;
      height: 13px;
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
      /* Sit above the toolbar/inspector (z-index: 2) so resize stays
         possible when the selected element happens to live behind them
         (e.g. an item in the slide's top-right corner). */
      z-index: 3;
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
      /* Fixtures set body { overflow: hidden } to lock the canvas; we need
         the deck to scroll past 20 slides at 4-per-row. */
      overflow: auto !important;
    }
    /* Hide every body-level sibling of .deck except the editor root —
       WFP fixtures commonly mount slide-progress dots, navigation hints,
       etc. as body children that overlay the slide. In overview those
       UI bits don't apply (no single "current" slide rendering); hide
       them visually without removing them from the DOM so export still
       round-trips them. */
    body[data-wfp-edit-overview="on"] > *:not(.deck):not(#${ROOT_ID}) {
      display: none !important;
    }
    body[data-wfp-edit-overview="on"] .deck {
      /* Override the fixture's fixed 1920x1080 + scale() canvas. The grid
         flows top-down at fixed 4-per-row, ~0.22 scale (BRIEF). At narrow
         viewports (<~1830px) the grid is wider than the viewport — body
         scroll handles both axes.
         !important is needed because the fixture's resize handler writes
         an inline transform every viewport change. */
      display: grid !important;
      grid-template-columns: repeat(4, calc(1920px * ${OVERVIEW_SCALE})) !important;
      gap: 28px;
      padding: 28px;
      /* width: max-content so the grid's natural width reaches its content
         size (~1830px); body overflow:auto then provides horizontal
         scroll on narrow viewports. justify-content:start keeps slide 1
         at the left edge so the user lands on it without scrolling. */
      width: max-content !important;
      height: auto !important;
      min-height: 100vh;
      transform: none !important;
      position: static !important;
      justify-content: start;
      align-content: start;
      background: #1a1d23;
      box-sizing: border-box;
    }
    body[data-wfp-edit-overview="on"] .slide {
      /* All slides become visible grid cells. The transform shrinks the
         visual to ~422x238 while the slide's own coordinate system stays
         1920x1080 — the negative margins reclaim the layout space the
         transform leaves behind, so each cell occupies only the scaled
         visual size. */
      display: block !important;
      position: relative !important;
      top: auto !important;
      left: auto !important;
      transform: scale(${OVERVIEW_SCALE}) !important;
      transform-origin: top left !important;
      margin-right: calc(-1920px * (1 - ${OVERVIEW_SCALE})) !important;
      margin-bottom: calc(-1080px * (1 - ${OVERVIEW_SCALE})) !important;
      cursor: pointer;
      /* Ensure overflow:hidden from the fixture stays — internal slide
         content sticking out of the scaled cell would visually collide
         with neighbouring thumbnails. */
      overflow: hidden !important;
    }
    /* Suppress the editor's own selection ring + handles + dim bubble
       while overview is active — they refer to slide-element selection,
       which doesn't exist in overview. */
    body[data-wfp-edit-overview="on"] #${ROOT_ID} .wfpe-selection-ring,
    body[data-wfp-edit-overview="on"] #${ROOT_ID} .wfpe-handle,
    body[data-wfp-edit-overview="on"] #${ROOT_ID} .wfpe-dim-bubble,
    body[data-wfp-edit-overview="on"] #${ROOT_ID} .wfpe-inspector {
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
    }
    #${ROOT_ID} .wfpe-overview-thumb[data-dragging="true"] {
      opacity: 0.4;
      cursor: grabbing;
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
    // Chevron-up: shown on the inspector header when expanded (click → minimise)
    chevronUp:
      '<svg class="wfpe-icon" viewBox="0 0 24 24" aria-hidden="true">' +
      '<polyline points="18 15 12 9 6 15" />' +
      '</svg>',
    // Chevron-down: shown on the inspector header when minimised (click → expand)
    chevronDown:
      '<svg class="wfpe-icon" viewBox="0 0 24 24" aria-hidden="true">' +
      '<polyline points="6 9 12 15 18 9" />' +
      '</svg>',
    // Counter-clockwise refresh — paired with "Reset styles" in the inspector.
    refresh:
      '<svg class="wfpe-icon" viewBox="0 0 24 24" aria-hidden="true">' +
      '<polyline points="1 4 1 10 7 10" />' +
      '<path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />' +
      '</svg>',
    // 2x2 grid — Overview toolbar button (v2.1.0).
    overview:
      '<svg class="wfpe-icon" viewBox="0 0 24 24" aria-hidden="true">' +
      '<rect x="3" y="3" width="7" height="7" rx="1" />' +
      '<rect x="14" y="3" width="7" height="7" rx="1" />' +
      '<rect x="3" y="14" width="7" height="7" rx="1" />' +
      '<rect x="14" y="14" width="7" height="7" rx="1" />' +
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

  // The mode badge IS the Edit toggle. Label is the constant "Edit"; the
  // active state is signalled by data-mode (peach fill) rather than by
  // text mutation.
  const badge = document.createElement('button');
  badge.type = 'button';
  badge.className = 'wfpe-mode-badge';
  badge.dataset.mode = 'off';
  badge.dataset.action = 'edit';
  badge.title = 'Toggle edit mode (E)';
  badge.innerHTML = ICONS.edit + '<span class="wfpe-mode-label">Edit</span>';
  toolbar.appendChild(badge);

  function makeToolbarButton(action, label, hint, iconKey) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'wfpe-toolbar-btn';
    b.dataset.action = action;
    b.title = hint;
    b.innerHTML = ICONS[iconKey] + `<span>${label}</span>`;
    return b;
  }

  // v2.1.0 — Overview button sits between Edit and the action triplet.
  // Edit + Overview are mode toggles; Export/Undo/Redo are actions. Keeping
  // the two mode controls adjacent reads cleanly in the toolbar.
  const overviewBtn = makeToolbarButton('overview', 'Overview', 'Overview (O)', 'overview');
  overviewBtn.dataset.mode = 'off';
  const exportBtn = makeToolbarButton('export', 'Export', 'Export (Cmd/Ctrl+S)', 'export');
  const undoBtn = makeToolbarButton('undo', 'Undo', 'Undo (Cmd/Ctrl+Z)', 'undo');
  const redoBtn = makeToolbarButton('redo', 'Redo', 'Redo (Cmd/Ctrl+Shift+Z)', 'redo');
  toolbar.appendChild(overviewBtn);
  toolbar.appendChild(exportBtn);
  toolbar.appendChild(undoBtn);
  toolbar.appendChild(redoBtn);

  root.appendChild(toolbar);

  // Inspector panel (v2.1 scaffold). Hidden by default; shown when an
  // element is selected. The body is intentionally empty in v2.1 — phases
  // v2.2-v2.6 plug in the position/size/font/colour/reset controls.
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
  inspectorMinimiseBtn.innerHTML = ICONS.chevronUp;
  inspectorHeader.appendChild(inspectorMinimiseBtn);

  inspector.appendChild(inspectorHeader);

  const inspectorBody = document.createElement('div');
  inspectorBody.className = 'wfpe-inspector-body';
  inspector.appendChild(inspectorBody);

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

  // Font-size row (v2.3): label on its own line, then a single control
  // sub-row [input·px][−][slider][+]. Renders only for text-bearing
  // elements. History contract: input commit (Enter/blur) = one entry,
  // ± click = one entry, slider drag (mousedown→mouseup) = one entry.
  const fontSizeRow = document.createElement('div');
  fontSizeRow.className = 'wfpe-inspector-row';
  fontSizeRow.dataset.wfpeRow = 'font-size';

  const fontSizeRowLabel = document.createElement('span');
  fontSizeRowLabel.className = 'wfpe-inspector-row-label';
  fontSizeRowLabel.textContent = 'Font size';
  fontSizeRow.appendChild(fontSizeRowLabel);

  const fontControl = document.createElement('div');
  fontControl.className = 'wfpe-font-control';

  const fieldFontSize = makeInspectorField('fontSize', '');
  // The font-size input has no axis label — the row label says "Font size".
  fieldFontSize.wrap.querySelector('.wfpe-inspector-field-axis').remove();
  fieldFontSize.input.min = String(FONT_SIZE_MIN_PX);
  const fontUnit = document.createElement('span');
  fontUnit.className = 'wfpe-font-unit';
  fontUnit.textContent = 'px';
  fieldFontSize.wrap.appendChild(fontUnit);
  fontControl.appendChild(fieldFontSize.wrap);

  const fontMinusBtn = document.createElement('button');
  fontMinusBtn.type = 'button';
  fontMinusBtn.className = 'wfpe-font-btn';
  fontMinusBtn.dataset.action = 'font-minus';
  fontMinusBtn.title = 'Decrease font size';
  fontMinusBtn.setAttribute('aria-label', 'Decrease font size');
  fontMinusBtn.textContent = '−';
  fontControl.appendChild(fontMinusBtn);

  const fontSlider = document.createElement('input');
  fontSlider.type = 'range';
  fontSlider.className = 'wfpe-font-slider';
  fontSlider.dataset.wfpeProp = 'fontSizeSlider';
  fontSlider.min = String(FONT_SIZE_MIN_PX);
  // Cap somewhere generous but bounded — v1 has no max for the keyboard
  // nudge, but the slider needs a finite range. 200px covers any
  // realistic display heading size.
  fontSlider.max = '200';
  fontSlider.step = '1';
  fontControl.appendChild(fontSlider);

  const fontPlusBtn = document.createElement('button');
  fontPlusBtn.type = 'button';
  fontPlusBtn.className = 'wfpe-font-btn';
  fontPlusBtn.dataset.action = 'font-plus';
  fontPlusBtn.title = 'Increase font size';
  fontPlusBtn.setAttribute('aria-label', 'Increase font size');
  fontPlusBtn.textContent = '+';
  fontControl.appendChild(fontPlusBtn);

  fontSizeRow.appendChild(fontControl);
  inspectorBody.appendChild(fontSizeRow);
  inspectorInputs.fontSize = fieldFontSize.input;

  inspectorBody.appendChild(makeInspectorRow('Position', [fieldX, fieldY]));
  inspectorBody.appendChild(makeInspectorRow('Size', [fieldW, fieldH]));

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
  opacitySlider.className = 'wfpe-font-slider';
  opacitySlider.dataset.wfpeProp = 'opacitySlider';
  opacitySlider.min = '0';
  opacitySlider.max = '100';
  opacitySlider.step = '1';
  opacityControl.appendChild(opacitySlider);

  opacityRow.appendChild(opacityControl);
  inspectorBody.appendChild(opacityRow);
  inspectorInputs.opacity = fieldOpacity.input;

  // Reset row (v2.5). Clears the selected element's entire inline style
  // attribute as one history entry, returning it to its stylesheet-
  // defined rendering. No-op (no history entry) if the element has no
  // inline style to clear.
  const resetRow = document.createElement('div');
  resetRow.className = 'wfpe-inspector-row';
  resetRow.dataset.wfpeRow = 'reset';
  const resetBtn = document.createElement('button');
  resetBtn.type = 'button';
  resetBtn.className = 'wfpe-reset-btn';
  resetBtn.dataset.action = 'reset-styles';
  resetBtn.innerHTML = ICONS.refresh + '<span>Reset styles</span>';
  resetBtn.title = 'Clear all inline style overrides on the selected element';
  resetRow.appendChild(resetBtn);
  inspectorBody.appendChild(resetRow);

  root.appendChild(inspector);

  // Dimension bubble (v2.2): floating "W × H" chip above the selection
  // ring. Tracks the same lifecycle as the ring.
  const dimBubble = document.createElement('div');
  dimBubble.className = 'wfpe-dim-bubble';
  root.appendChild(dimBubble);

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
  exportBtn.addEventListener('click', (e) => {
    e.preventDefault();
    exportHTML();
  });
  overviewBtn.addEventListener('click', (e) => {
    e.preventDefault();
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

  // Font-size slider — one history entry per drag (mousedown→mouseup).
  // Uses the inspector-txn isolation helpers so a slider drag during
  // an open text-edit produces its own entry, separate from the typing.
  let fontSliderTarget = null;
  let fontSliderRestoreCtx = null;
  fontSlider.addEventListener('mousedown', () => {
    const el = state.selected;
    if (!el || !isTextBearing(el)) return;
    fontSliderTarget = el;
    fontSliderRestoreCtx = startInspectorTxn();
    touchElement(el);
  });
  fontSlider.addEventListener('input', () => {
    // Bail if the slider is being driven without an open drag (e.g. by
    // assistive tech keyboard navigation that didn't fire mousedown).
    // The mousedown→mouseup bracket owns the txn; firing input outside
    // it would create a per-tick history entry instead of one-per-drag.
    if (!fontSliderTarget) return;
    const el = fontSliderTarget;
    if (!isTextBearing(el)) return;
    const v = Math.max(FONT_SIZE_MIN_PX, parseFloat(fontSlider.value) || FONT_SIZE_MIN_PX);
    el.style.fontSize = `${v}px`;
    populateFontSize(el);
  });
  // Both mouseup (mouse drag) and change (keyboard / touch end) can end
  // the drag; both close the inspector txn (which restores the text-
  // edit txn if one was active). Idempotent on a no-op drag.
  const endSliderDrag = () => {
    if (!fontSliderTarget) return;
    fontSliderTarget = null;
    const ctx = fontSliderRestoreCtx;
    fontSliderRestoreCtx = null;
    endInspectorTxn(ctx);
  };
  fontSlider.addEventListener('mouseup', endSliderDrag);
  fontSlider.addEventListener('change', endSliderDrag);
  fontSlider.addEventListener('keydown', (e) => e.stopPropagation());

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
    text: { open: false, restoreCtx: null },
    bg: { open: false, restoreCtx: null },
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
      if (!pickerSession[target].open) {
        pickerSession[target].open = true;
        pickerSession[target].restoreCtx = startInspectorTxn();
        touchElement(el);
      }
      applyColorToElement(el, target, colorInput.value);
      populateColours(el);
    });
    colorInput.addEventListener('change', () => {
      if (!pickerSession[target].open) return;
      const ctx = pickerSession[target].restoreCtx;
      pickerSession[target].open = false;
      pickerSession[target].restoreCtx = null;
      endInspectorTxn(ctx);
    });
    hexInput.addEventListener('focus', () => {
      hexInput.__wfpeFocusTarget = state.selected || null;
    });
    hexInput.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        e.preventDefault();
        commitColourHex(target, hexInput.value, hexInput.__wfpeFocusTarget);
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
      if (revertingInput === hexInput) { revertingInput = null; return; }
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

  // ===========================================================================
  // Helpers
  // ===========================================================================
  function isInsideEditorRoot(el) {
    return !!el && root.contains(el);
  }

  function getActiveSlide() {
    return document.querySelector('.slide.active');
  }

  function findSelectableTarget(el) {
    if (!el || isInsideEditorRoot(el)) return null;
    const slide = getActiveSlide();
    if (!slide) return null;
    if (el === slide) return null;
    if (el.classList && el.classList.contains('deck')) return null;
    if (!slide.contains(el)) return null;
    return el;
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
      hideDimBubble();
      stopSelectionTracking();
      return;
    }
    if (clearDisconnectedSelection()) return;
    if (state.selected && state.selected.isConnected) {
      positionRing(state.selected);
      positionDimBubble(state.selected);
      populateInspector(state.selected);
      startSelectionTracking();
    } else {
      hideRing();
      hideDimBubble();
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

  let selectionRafId = 0;

  function shouldTrackSelection() {
    return (
      state.editMode &&
      !state.overviewMode &&
      !state.editingText &&
      !!state.selected &&
      state.selected.isConnected
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
    if (!state.selected || state.selected.isConnected) return false;
    if (state.editingText && state.editingText.el === state.selected) {
      state.editingText = null;
    }
    state.selected = null;
    hideRing();
    hideDimBubble();
    populateInspector(null);
    refreshInspector();
    stopSelectionTracking();
    return true;
  }

  function setSelected(el) {
    // Close any open txn before swapping selection — defends against
    // an orphaned colour-picker txn (input fired without change) being
    // silently bundled with subsequent unrelated edits on the new
    // selection. endTxn no-ops if no element was touched.
    if (state.selected !== el && state.txn) endTxn();
    state.selected = el || null;
    if (state.selected) {
      positionRing(state.selected);
      positionDimBubble(state.selected);
      populateInspector(state.selected);
      startSelectionTracking();
    } else {
      hideRing();
      hideDimBubble();
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

  function populateInspector(el) {
    if (!el) {
      for (const k of ['x', 'y', 'w', 'h', 'fontSize', 'opacity']) {
        if (document.activeElement !== inspectorInputs[k]) inspectorInputs[k].value = '';
      }
      fontSizeRow.style.display = 'none';
      textColourRow.row.style.display = 'none';
      populateColours(null);
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
    // Font-size + text-colour rows render only for text-bearing elements
    // (matching BRIEF "Conditional content by selection type").
    // Background colour and position/size render for any selection.
    if (isTextBearing(el)) {
      fontSizeRow.style.display = '';
      textColourRow.row.style.display = '';
      populateFontSize(el);
    } else {
      fontSizeRow.style.display = 'none';
      textColourRow.row.style.display = 'none';
    }
    populateColours(el);
    populateOpacity(el);
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
      const colorRgb = getComputedStyle(el).color;
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

  function populateFontSize(el) {
    const px = Math.round(parseFloat(getComputedStyle(el).fontSize)) || FONT_SIZE_MIN_PX;
    if (document.activeElement !== inspectorInputs.fontSize) {
      inspectorInputs.fontSize.value = String(px);
    }
    // Slider snaps to its [min, max] range — clamp the displayed value.
    const sliderMax = Number(fontSlider.max) || 200;
    const sliderMin = Number(fontSlider.min) || FONT_SIZE_MIN_PX;
    fontSlider.value = String(Math.max(sliderMin, Math.min(sliderMax, px)));
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
    const visible = !!state.selected;
    inspector.dataset.visible = visible ? 'true' : 'false';
    inspector.dataset.state = state.inspectorMinimised ? 'minimised' : 'expanded';
    inspectorMinimiseBtn.innerHTML = state.inspectorMinimised ? ICONS.chevronDown : ICONS.chevronUp;
    inspectorMinimiseBtn.title = state.inspectorMinimised ? 'Expand' : 'Minimise';
    inspectorMinimiseBtn.setAttribute(
      'aria-label',
      state.inspectorMinimised ? 'Expand inspector' : 'Minimise inspector'
    );
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
      frozen: el.getAttribute('data-wfp-edit-frozen'),
      flexFrozen: el.getAttribute('data-wfp-edit-flex-frozen'),
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
    if (snap.frozen === null) el.removeAttribute('data-wfp-edit-frozen');
    else el.setAttribute('data-wfp-edit-frozen', snap.frozen);
    if (snap.flexFrozen === null) el.removeAttribute('data-wfp-edit-flex-frozen');
    else el.setAttribute('data-wfp-edit-flex-frozen', snap.flexFrozen);
    if (Object.prototype.hasOwnProperty.call(snap, 'html') && el.innerHTML !== snap.html) {
      el.innerHTML = snap.html;
    }
  }

  function snapshotsEqual(a, b) {
    const aHasHtml = Object.prototype.hasOwnProperty.call(a, 'html');
    const bHasHtml = Object.prototype.hasOwnProperty.call(b, 'html');
    return (
      a.style === b.style &&
      a.frozen === b.frozen &&
      a.flexFrozen === b.flexFrozen &&
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
  function startInspectorTxn() {
    let restoreEditingEl = null;
    if (state.editingText) {
      restoreEditingEl = state.editingText.el;
      if (state.txn) endTxn(); // commits typing-so-far
    }
    if (!state.txn) beginTxn();
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

  function pushHistoryEntry(changes) {
    // Truncate any redo stack — a fresh change invalidates everything
    // beyond the current cursor.
    state.history.length = state.historyIndex;
    state.history.push({ changes });
    state.historyIndex = state.history.length;
    while (state.history.length > HISTORY_MAX) {
      state.history.shift();
      state.historyIndex--;
    }
  }

  // Slide-level history op handlers. These run alongside the per-element
  // `changes` array — they EXTEND the entry shape rather than replacing
  // it. Op types: 'reorder' (v2.1.3), 'delete' (v2.1.4).
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
    }
  }
  function redoSlideOp(op) {
    if (op.type === 'reorder') {
      applySlideOrder(op.deck, op.afterOrder);
    } else if (op.type === 'delete') {
      op.deck.removeChild(op.slide);
      if (op.wasActive && op.fallbackSlide) op.fallbackSlide.classList.add('active');
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
    const slides = [...document.querySelectorAll('.deck > .slide')];
    for (let i = 0; i < slides.length; i++) {
      const slide = slides[i];
      const thumb = document.createElement('div');
      thumb.className = 'wfpe-overview-thumb';
      thumb.dataset.wfpEditSlideIndex = String(i);
      // Native HTML5 DnD source (v2.1.3). The thumb is editor-owned —
      // setting draggable here keeps slide DOM untouched.
      thumb.draggable = true;
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
    positionOverviewOverlay();
  }

  function positionOverviewOverlay() {
    if (!state.overviewMode) return;
    const slides = [...document.querySelectorAll('.deck > .slide')];
    const thumbs = overviewOverlay.children;
    for (let i = 0; i < slides.length; i++) {
      const t = thumbs[i];
      if (!t) continue;
      const r = slides[i].getBoundingClientRect();
      t.style.top = `${r.top}px`;
      t.style.left = `${r.left}px`;
      t.style.width = `${r.width}px`;
      t.style.height = `${r.height}px`;
    }
  }

  function enterOverview() {
    // The body marker lives on <body> rather than #wfp-editor-root because
    // the CSS-override strategy needs a global selector hook above the
    // .deck level. Using the data-wfp-edit-* namespace means the existing
    // export scrubber (which strips any data-wfp-edit* attribute on any
    // element) cleans it up automatically — no special-case needed.
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
    overviewOverlay.addEventListener('click', onOverviewDeleteClick);
  }

  function exitOverview() {
    document.body.removeAttribute('data-wfp-edit-overview');
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
          const slides = document.querySelectorAll('.deck > .slide');
          return slides[idx] || null;
        }
        if (
          el.classList.contains('slide') &&
          el.parentElement && el.parentElement.classList.contains('deck')
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
    // Once any slide-level op lands, the fixture's cached slide list
    // (built once at script load via document.querySelectorAll) is
    // stale relative to the live deck — its arrow-nav would index into
    // the wrong slot or land .active on an orphan. From here on, the
    // editor owns plain-view arrow nav using fresh DOM queries.
    state.deckMutated = true;
  }

  // Navigate the live deck by ±1, syncing the fixture's progress-dot
  // siblings if any exist (best-effort — not all fixtures have them).
  // Used by the deckMutated arrow-nav takeover in onKeyDown.
  function navigateRelativeInDeck(delta) {
    const slides = [...document.querySelectorAll('.deck > .slide')];
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
    const slides = [...document.querySelectorAll('.deck > .slide')];
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
    const slides = [...document.querySelectorAll('.deck > .slide')];
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
    const afterOrder = [...document.querySelectorAll('.deck > .slide')];
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
    for (const t of overviewOverlay.children) {
      if (t.dataset && 'dragging' in t.dataset) delete t.dataset.dragging;
    }
    state.overviewDrag = null;
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
    if (!deck || !deck.classList.contains('deck')) return;
    const slides = [...deck.querySelectorAll(':scope > .slide')];
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
        return document.querySelectorAll('.deck > .slide')[i] || null;
      }
    }
    return state.overviewHoveredSlide;
  }

  function onOverviewMouseOver(e) {
    const thumb = e.target.closest('.wfpe-overview-thumb');
    if (!thumb) return;
    const idx = Number(thumb.dataset.wfpEditSlideIndex);
    state.overviewHoveredSlide = document.querySelectorAll('.deck > .slide')[idx] || null;
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
    const slide = document.querySelectorAll('.deck > .slide')[idx];
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
    refreshSelection();
  }

  function onKeyDown(e) {
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
        exportHTML();
        return;
      }
      e.stopPropagation();
      return;
    }

    if (isTypingTarget(e.target)) return;
    const noModifier = !e.metaKey && !e.ctrlKey && !e.altKey;

    if ((e.key === 'e' || e.key === 'E') && noModifier) {
      setEditMode(!state.editMode);
      return;
    }

    // Overview mode toggle (v2.1.0). `O` works regardless of edit mode
    // (matches the `E` precedent). Escape exits when overview is on,
    // no-op otherwise — text-edit Escape is already handled above.
    if ((e.key === 'o' || e.key === 'O') && noModifier) {
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
      if (!state.selected || !isTextBearing(state.selected)) return;
      e.preventDefault();
      e.stopPropagation();
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
    const isMod = e.metaKey || e.ctrlKey;
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
      exportHTML();
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
    const target = findSelectableTarget(e.target);
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
  });
  document.querySelectorAll('.slide').forEach((slide) => {
    slideObserver.observe(slide, { attributes: true, attributeFilter: ['class'] });
  });

  // ===========================================================================
  // Drag (scale-aware, with unlock-on-flow)
  // ===========================================================================
  function getCanvasScale() {
    const deck = document.querySelector('.deck');
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
      if (inspector.contains(e.target)) return;
      endTextEdit();
    }

    // Resize-handle hit takes precedence over a fresh selection/drag.
    const handleDir = e.target && e.target.dataset && e.target.dataset.wfpeHandle;
    if (handleDir && state.selected) {
      startResize(e, handleDir);
      return;
    }

    if (isInsideEditorRoot(e.target)) return;
    const target = findSelectableTarget(e.target);
    if (!target) return;

    setSelected(target);

    // Suppress the browser's default mousedown-then-drag text selection so
    // the user doesn't end up highlighting random copy while moving things.
    e.preventDefault();

    const cs = getComputedStyle(target);
    state.drag = {
      el: target,
      startX: e.clientX,
      startY: e.clientY,
      anchorLeft: target.offsetLeft,
      anchorTop: target.offsetTop,
      width: target.offsetWidth,
      height: target.offsetHeight,
      wasAbsolute: cs.position === 'absolute',
      started: false,
    };

    document.addEventListener('mousemove', onMouseMove, true);
    document.addEventListener('mouseup', onMouseUp, true);
  }

  function startResize(e, dir) {
    const el = state.selected;
    if (!el) return;
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
  function snapshotChildOffsetsRelativeTo(container) {
    // For a static container, container and its children share the same
    // offsetParent, so child.offsetLeft - container.offsetLeft is the
    // child's position within the container in CSS pixels.
    //
    // For a positioned container, the children's offsetParent IS the
    // container itself; child.offsetLeft is already the in-container offset.
    const isStatic = getComputedStyle(container).position === 'static';
    return [...container.children].map((child) => ({
      child,
      left: isStatic ? child.offsetLeft - container.offsetLeft : child.offsetLeft,
      top: isStatic ? child.offsetTop - container.offsetTop : child.offsetTop,
      width: child.offsetWidth,
      height: child.offsetHeight,
    }));
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

  function commitUnlock(d) {
    const rect = unlockToAbsolute(d.el);
    d.anchorLeft = rect.left;
    d.anchorTop = rect.top;
    d.width = rect.width;
    d.height = rect.height;
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

  function startTextEdit(el, clickX, clickY) {
    if (state.editingText) return;
    if (!isTextBearing(el)) return;

    state.editingText = {
      el,
      originalContenteditable: el.getAttribute('contenteditable'),
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
      touchElement(d.el);
      if (!d.wasAbsolute) {
        commitUnlock(d);
      } else {
        // Lock in the anchor as inline left/top so subsequent drags compose.
        d.el.style.left = `${d.anchorLeft}px`;
        d.el.style.top = `${d.anchorTop}px`;
      }
    }

    e.preventDefault();
    e.stopPropagation();

    const scale = getCanvasScale();
    const dx = dxView / scale;
    const dy = dyView / scale;
    d.el.style.left = `${d.anchorLeft + dx}px`;
    d.el.style.top = `${d.anchorTop + dy}px`;
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
  // Export
  //
  // Clone the live DOM, strip everything the editor injected (root + script
  // + data-wfp-edit-* + contenteditable), serialize, and trigger a download
  // named `<basename>-edited.html`.
  // ===========================================================================
  function deriveExportFilename() {
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
    return `${base}-edited${ext}`;
  }

  function buildExportHtml() {
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

    clone.querySelectorAll('*').forEach((el) => {
      for (const attr of [...el.attributes]) {
        if (attr.name.startsWith('data-wfp-edit')) el.removeAttribute(attr.name);
      }
      if (el.hasAttribute('contenteditable')) el.removeAttribute('contenteditable');
    });

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

  // ===========================================================================
  // Ready
  // ===========================================================================
  window.__wfpEditorReady = true;
  console.log(`[wfp-editor] ready v${VERSION}`);
})();
