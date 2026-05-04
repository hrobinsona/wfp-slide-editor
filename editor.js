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

  const VERSION = '2.0.0-v2.0';
  const HISTORY_MAX = 50;
  const FONT_SIZE_MIN_PX = 8;
  const DRAG_DEADZONE_PX = 5;
  const TOAST_DURATION_MS = 2000;
  const POST_DRAG_CLICK_GUARD_MS = 250;
  const RESIZE_MIN_PX = 8;
  const HANDLE_SIZE_PX = 10;
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
    txn: null, // { snapshots: Map<Element, BeforeSnap> } when an op is in progress
    inspectorMinimised: false, // persists across selections within session; resets on reload
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
       color-scheme. Recipe values come from BRIEF-v2-inspector.md. ----- */
    #${ROOT_ID} .wfpe-toolbar {
      position: fixed;
      top: 16px;
      right: 16px;
      pointer-events: auto;
      display: flex;
      align-items: center;
      gap: 2px;
      padding: 6px;
      border-radius: 22px;
      background: rgba(255, 255, 255, 0.20);
      backdrop-filter: blur(24px) saturate(180%);
      -webkit-backdrop-filter: blur(24px) saturate(180%);
      border: 1px solid rgba(255, 255, 255, 0.24);
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.25);
      font: 13px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
      letter-spacing: 0.005em;
      user-select: none;
      color: rgba(15, 23, 42, 0.85);
      isolation: isolate;
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
      color: inherit;
      font: inherit;
      letter-spacing: inherit;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 8px 12px;
      border-radius: 16px;
      cursor: pointer;
      white-space: nowrap;
      transition: background-color 120ms ease;
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
      background-color: rgba(255, 255, 255, 0.22);
    }
    #${ROOT_ID} .wfpe-toolbar-btn:active,
    #${ROOT_ID} .wfpe-mode-badge:active {
      background-color: rgba(255, 255, 255, 0.32);
    }
    #${ROOT_ID} .wfpe-mode-badge[data-mode="on"] {
      background: linear-gradient(180deg, rgba(244, 132, 123, 1) 0%, rgba(232, 110, 103, 1) 100%);
      color: #fff;
      box-shadow:
        0 1px 2px rgba(168, 56, 48, 0.45),
        inset 0 1px 0 rgba(255, 255, 255, 0.35),
        inset 0 -1px 0 rgba(0, 0, 0, 0.10);
    }
    #${ROOT_ID} .wfpe-mode-badge[data-mode="on"]:hover {
      filter: brightness(1.05);
      background-color: transparent;
    }
    @media (prefers-color-scheme: dark) {
      #${ROOT_ID} .wfpe-toolbar {
        background: rgba(255, 255, 255, 0.12);
        border-color: rgba(255, 255, 255, 0.24);
        color: rgba(255, 255, 255, 0.9);
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.25);
      }
      #${ROOT_ID} .wfpe-toolbar-btn:hover,
      #${ROOT_ID} .wfpe-mode-badge:hover {
        background-color: rgba(255, 255, 255, 0.16);
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
      top: 76px;
      right: 16px;
      width: 280px;
      pointer-events: auto;
      display: none;
      flex-direction: column;
      border-radius: 18px;
      padding: 0;
      background: rgba(255, 255, 255, 0.20);
      backdrop-filter: blur(24px) saturate(180%);
      -webkit-backdrop-filter: blur(24px) saturate(180%);
      border: 1px solid rgba(255, 255, 255, 0.24);
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.25);
      font: 12px/1.35 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
      letter-spacing: 0.005em;
      user-select: none;
      color: rgba(15, 23, 42, 0.85);
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
      border-bottom: 1px solid rgba(15, 23, 42, 0.08);
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
      background: rgba(255, 255, 255, 0.30);
      border: 1px solid rgba(255, 255, 255, 0.32);
      border-radius: 8px;
      padding: 3px 6px 3px 8px;
      font-size: 12px;
    }
    #${ROOT_ID} .wfpe-inspector-field-axis {
      opacity: 0.6;
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
      border-color: rgba(42, 139, 242, 0.7);
      background: rgba(255, 255, 255, 0.5);
    }
    /* Font-size triplet (v2.3): horizontal slider + −/+ buttons + px input,
       all three bound to the selected element's font-size. Renders only
       for text-bearing elements. */
    #${ROOT_ID} .wfpe-inspector-row[data-wfpe-row="font-size"] {
      flex-direction: column;
      align-items: stretch;
      gap: 6px;
    }
    #${ROOT_ID} .wfpe-font-control {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    #${ROOT_ID} .wfpe-font-btn {
      appearance: none;
      -webkit-appearance: none;
      background: rgba(255, 255, 255, 0.30);
      border: 1px solid rgba(255, 255, 255, 0.32);
      color: inherit;
      width: 22px;
      height: 22px;
      border-radius: 8px;
      cursor: pointer;
      font: 600 14px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      flex: 0 0 22px;
      transition: background-color 120ms ease;
    }
    #${ROOT_ID} .wfpe-font-btn:hover {
      background-color: rgba(255, 255, 255, 0.45);
    }
    #${ROOT_ID} .wfpe-font-slider {
      appearance: none;
      -webkit-appearance: none;
      flex: 1;
      height: 4px;
      background: rgba(15, 23, 42, 0.18);
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
      background: rgba(15, 23, 42, 0.85);
      border: 2px solid rgba(255, 255, 255, 0.92);
      box-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
      cursor: grab;
    }
    #${ROOT_ID} .wfpe-font-slider::-moz-range-thumb {
      width: 14px;
      height: 14px;
      border-radius: 50%;
      background: rgba(15, 23, 42, 0.85);
      border: 2px solid rgba(255, 255, 255, 0.92);
      box-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
      cursor: grab;
    }
    @media (prefers-color-scheme: dark) {
      #${ROOT_ID} .wfpe-font-btn {
        background: rgba(255, 255, 255, 0.10);
        border-color: rgba(255, 255, 255, 0.18);
      }
      #${ROOT_ID} .wfpe-font-btn:hover {
        background-color: rgba(255, 255, 255, 0.18);
      }
      #${ROOT_ID} .wfpe-font-slider {
        background: rgba(255, 255, 255, 0.18);
      }
      #${ROOT_ID} .wfpe-font-slider::-webkit-slider-thumb,
      #${ROOT_ID} .wfpe-font-slider::-moz-range-thumb {
        background: rgba(255, 255, 255, 0.92);
        border-color: rgba(15, 23, 42, 0.85);
      }
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
      border: 1px solid rgba(15, 23, 42, 0.18);
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
      inset: -2px;
      opacity: 0;
      cursor: pointer;
      border: 0;
      padding: 0;
      pointer-events: none; /* swatch's own click triggers the picker */
    }
    #${ROOT_ID} .wfpe-color-clear {
      appearance: none;
      -webkit-appearance: none;
      background: rgba(255, 255, 255, 0.30);
      border: 1px solid rgba(255, 255, 255, 0.32);
      color: inherit;
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
      background-color: rgba(255, 255, 255, 0.45);
    }
    @media (prefers-color-scheme: dark) {
      #${ROOT_ID} .wfpe-color-swatch {
        border-color: rgba(255, 255, 255, 0.18);
      }
      #${ROOT_ID} .wfpe-color-clear {
        background: rgba(255, 255, 255, 0.10);
        border-color: rgba(255, 255, 255, 0.18);
      }
      #${ROOT_ID} .wfpe-color-clear:hover {
        background-color: rgba(255, 255, 255, 0.18);
      }
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
      #${ROOT_ID} .wfpe-inspector {
        background: rgba(255, 255, 255, 0.12);
        border-color: rgba(255, 255, 255, 0.24);
        color: rgba(255, 255, 255, 0.9);
      }
      #${ROOT_ID} .wfpe-inspector-field {
        background: rgba(255, 255, 255, 0.10);
        border-color: rgba(255, 255, 255, 0.18);
      }
      #${ROOT_ID} .wfpe-inspector-field:focus-within {
        background: rgba(255, 255, 255, 0.18);
      }
      #${ROOT_ID} .wfpe-dim-bubble {
        background: rgba(255, 255, 255, 0.92);
        color: rgba(15, 23, 42, 0.95);
      }
      #${ROOT_ID} .wfpe-inspector-header {
        border-bottom-color: rgba(255, 255, 255, 0.12);
      }
      #${ROOT_ID} .wfpe-inspector-minimise:hover {
        background-color: rgba(255, 255, 255, 0.16);
      }
    }
    #${ROOT_ID} .wfpe-selection-ring {
      position: fixed;
      pointer-events: none;
      box-sizing: border-box;
      border: 2px solid #2a8bf2;
      box-shadow:
        0 0 0 1px rgba(255, 255, 255, 0.85) inset,
        0 0 0 1px rgba(0, 0, 0, 0.25);
      border-radius: 2px;
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
      width: ${HANDLE_SIZE_PX}px;
      height: ${HANDLE_SIZE_PX}px;
      background: #ffffff;
      border: 1.5px solid #2a8bf2;
      border-radius: 1px;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.35);
      pointer-events: auto;
      display: none;
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
  };

  const toolbar = document.createElement('div');
  toolbar.className = 'wfpe-toolbar';
  toolbar.dataset.mode = 'off';

  // The mode badge IS the Edit toggle. Its text label preserves the v1
  // "Edit: OFF" / "Edit: ON" format (relied on by the bootstrap test
  // suite); v2 adds an icon to the left of the label.
  const badge = document.createElement('button');
  badge.type = 'button';
  badge.className = 'wfpe-mode-badge';
  badge.dataset.mode = 'off';
  badge.dataset.action = 'edit';
  badge.title = 'Toggle edit mode (E)';
  badge.innerHTML = ICONS.edit + '<span class="wfpe-mode-label">Edit: OFF</span>';
  const badgeLabel = badge.querySelector('.wfpe-mode-label');
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

  const exportBtn = makeToolbarButton('export', 'Export', 'Export (Cmd/Ctrl+S)', 'export');
  const undoBtn = makeToolbarButton('undo', 'Undo', 'Undo (Cmd/Ctrl+Z)', 'undo');
  const redoBtn = makeToolbarButton('redo', 'Redo', 'Redo (Cmd/Ctrl+Shift+Z)', 'redo');
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
  };

  // Font-size triplet (v2.3): renders only for text-bearing elements.
  // The slider drives a single history entry per drag (mousedown→mouseup),
  // ± buttons one entry per click, the input one entry per Enter/blur.
  const fontSizeRow = document.createElement('div');
  fontSizeRow.className = 'wfpe-inspector-row';
  fontSizeRow.dataset.wfpeRow = 'font-size';

  const fontSizeRowLabel = document.createElement('span');
  fontSizeRowLabel.className = 'wfpe-inspector-row-label';
  fontSizeRowLabel.textContent = 'Font size';
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

  const fieldFontSize = makeInspectorField('fontSize', '');
  // The font-size input has no axis label — the row label says "Font size".
  fieldFontSize.wrap.querySelector('.wfpe-inspector-field-axis').remove();
  fieldFontSize.input.min = String(FONT_SIZE_MIN_PX);
  fontControl.appendChild(fieldFontSize.wrap);

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

  root.appendChild(inspector);

  // Dimension bubble (v2.2): floating "W × H" chip above the selection
  // ring. Tracks the same lifecycle as the ring.
  const dimBubble = document.createElement('div');
  dimBubble.className = 'wfpe-dim-bubble';
  root.appendChild(dimBubble);

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
  // The intermediate `input` events apply the live value but don't open
  // a fresh txn; the txn opened by mousedown bundles the whole drag.
  let fontSliderTarget = null;
  fontSlider.addEventListener('mousedown', () => {
    const el = state.selected;
    if (!el || !isTextBearing(el)) return;
    fontSliderTarget = el;
    beginTxn();
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
  // the drag; both close the open txn. Idempotent because endTxn no-ops
  // when state.txn is null.
  const endSliderDrag = () => {
    if (!fontSliderTarget) return;
    fontSliderTarget = null;
    endTxn();
  };
  fontSlider.addEventListener('mouseup', endSliderDrag);
  fontSlider.addEventListener('change', endSliderDrag);
  fontSlider.addEventListener('keydown', (e) => e.stopPropagation());

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
  // Picker `input` events apply live within an open txn; the `change`
  // event closes the txn so a full pick session = one history entry.
  function wireColourRow({ swatch, colorInput, hexInput, clearBtn }, target) {
    swatch.addEventListener('click', (e) => {
      e.preventDefault();
      colorInput.click();
    });
    colorInput.addEventListener('input', () => {
      const el = state.selected;
      if (!el) return;
      if (target === 'text' && !isTextBearing(el)) return;
      if (!state.txn || !state.txn.snapshots.has(el)) {
        beginTxn();
        touchElement(el);
      }
      applyColorToElement(el, target, colorInput.value);
      populateColours(el);
    });
    colorInput.addEventListener('change', () => {
      // Closing the picker commits the txn opened on the first input
      // event. endTxn no-ops if no element was touched.
      endTxn();
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
        beginTxn();
        touchElement(el);
        el.style[cssProp] = '';
        endTxn();
        populateColours(el);
      });
    }
  }
  wireColourRow(textColourRow, 'text');
  wireColourRow(bgColourRow, 'bg');

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
    const half = HANDLE_SIZE_PX / 2;
    for (const dir of HANDLE_DIRS) {
      const a = anchors[dir];
      const h = handles[dir];
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
      return;
    }
    if (state.selected && state.selected.isConnected) {
      positionRing(state.selected);
      positionDimBubble(state.selected);
      populateInspector(state.selected);
    } else {
      hideRing();
      hideDimBubble();
    }
  }

  function positionDimBubble(el) {
    const r = el.getBoundingClientRect();
    dimBubble.textContent = `${Math.round(r.width)} × ${Math.round(r.height)}`;
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
    } else {
      hideRing();
      hideDimBubble();
      populateInspector(null);
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
      for (const k of ['x', 'y', 'w', 'h', 'fontSize']) {
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
    beginTxn();
    touchElement(el);
    el.style[cssProp] = norm;
    endTxn();
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
    // default in the picker.
    const bgRgb = getComputedStyle(el).backgroundColor;
    const isTransparent = bgRgb === 'rgba(0, 0, 0, 0)' || bgRgb === 'transparent';
    const bgHex = isTransparent ? '#ffffff' : (rgbStringToHex(bgRgb) || '#ffffff');
    if (document.activeElement !== bgColourRow.hexInput) {
      bgColourRow.hexInput.value = isTransparent ? '' : bgHex;
    }
    bgColourRow.colorInput.value = bgHex;
    if (isTransparent) {
      bgColourRow.swatch.style.backgroundColor = '';
      bgColourRow.swatch.dataset.transparent = 'true';
    } else {
      bgColourRow.swatch.style.backgroundColor = bgHex;
      delete bgColourRow.swatch.dataset.transparent;
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
    const clamped = Math.max(sliderMin, Math.min(sliderMax, px));
    fontSlider.value = String(clamped);
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
      beginTxn();
      touchElement(el);
      el.style.fontSize = `${clamped}px`;
      endTxn();
      refreshSelection();
      return;
    }
    // Compare against the live offset; abort no-op commits so blur
    // cycling doesn't pollute history.
    const offsetMap = { x: 'offsetLeft', y: 'offsetTop', w: 'offsetWidth', h: 'offsetHeight' };
    const current = el[offsetMap[prop]];
    if (Math.round(next) === current) return;

    beginTxn();
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
    endTxn();
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
  function snapshotElement(el) {
    return {
      style: el.getAttribute('style'),
      frozen: el.getAttribute('data-wfp-edit-frozen'),
      flexFrozen: el.getAttribute('data-wfp-edit-flex-frozen'),
      html: el.innerHTML,
    };
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
    if (el.innerHTML !== snap.html) el.innerHTML = snap.html;
  }

  function snapshotsEqual(a, b) {
    return (
      a.style === b.style &&
      a.frozen === b.frozen &&
      a.flexFrozen === b.flexFrozen &&
      a.html === b.html
    );
  }

  function beginTxn() {
    if (state.txn) return; // ignore re-entry; outermost owns the txn
    state.txn = { snapshots: new Map() };
  }

  function touchElement(el) {
    if (!state.txn || !el) return;
    if (state.txn.snapshots.has(el)) return;
    state.txn.snapshots.set(el, snapshotElement(el));
  }

  function endTxn() {
    if (!state.txn) return;
    const txn = state.txn;
    state.txn = null;
    const changes = [];
    for (const [el, before] of txn.snapshots) {
      const after = snapshotElement(el);
      if (snapshotsEqual(before, after)) continue;
      changes.push({ element: el, before, after });
    }
    if (changes.length === 0) return;
    pushHistoryEntry(changes);
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

  function undo() {
    if (state.historyIndex <= 0) return;
    state.historyIndex--;
    const entry = state.history[state.historyIndex];
    for (const c of entry.changes) applyElementSnapshot(c.element, c.before);
    refreshSelection();
  }

  function redo() {
    if (state.historyIndex >= state.history.length) return;
    const entry = state.history[state.historyIndex];
    for (const c of entry.changes) applyElementSnapshot(c.element, c.after);
    state.historyIndex++;
    refreshSelection();
  }

  // ===========================================================================
  // Edit mode
  // ===========================================================================
  function setEditMode(value) {
    state.editMode = !!value;
    badge.dataset.mode = state.editMode ? 'on' : 'off';
    toolbar.dataset.mode = state.editMode ? 'on' : 'off';
    badgeLabel.textContent = state.editMode ? 'Edit: ON' : 'Edit: OFF';
    if (!state.editMode) {
      if (state.editingText) endTextEdit();
      setSelected(null);
      refreshInspector();
    }
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
  // entry rather than being elided by an upstream open txn.
  function nudgeFontSizeWithHistory(deltaPx) {
    const el = state.selected;
    if (!el || !isTextBearing(el)) return;
    beginTxn();
    touchElement(el);
    nudgeFontSize(el, deltaPx);
    endTxn();
    refreshSelection();
  }

  function onKeyDown(e) {
    // While a text edit is open, only intercept Escape/Tab (commit) and
    // Cmd/Ctrl+S (commit + export). Every other key flows to the
    // contenteditable element for default behavior (typing, caret motion),
    // BUT we still call stopPropagation so the fixture's bubble-phase
    // keydown handler (which navigates slides on ArrowLeft/Right/Space)
    // doesn't fire alongside the caret movement.
    if (state.editingText) {
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

    if (!state.editMode) return;

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
    if (!state.editMode) return;
    if (e.button !== 0) return;

    // While a text edit is open, mousedowns INSIDE the editing element are
    // for caret/selection — let the browser handle them natively. Mousedowns
    // OUTSIDE commit the edit and fall through to the rest of onMouseDown
    // so the outside element can be selected normally.
    if (state.editingText) {
      if (state.editingText.el.contains(e.target)) return;
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

    beginTxn();
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
