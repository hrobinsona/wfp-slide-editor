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
    [data-wfp-edit-flat-position-context="true"] {
      position: relative !important;
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
    /* Element action row: compact text-link controls for common structural
       actions. They stay in one row to keep the inspector from growing
       vertically as feature actions are added. */
    #${ROOT_ID} .wfpe-inspector-row[data-wfpe-row="actions"] {
      justify-content: space-between;
      gap: 6px;
      padding-top: 4px;
      flex-wrap: nowrap;
      width: 100%;
      box-sizing: border-box;
    }
    #${ROOT_ID} .wfpe-duplicate-btn,
    #${ROOT_ID} .wfpe-delete-btn,
    #${ROOT_ID} .wfpe-reset-btn {
      appearance: none;
      -webkit-appearance: none;
      background: transparent;
      border: 0;
      color: rgba(255, 255, 255, 0.78);
      padding: 4px 6px;
      border-radius: 6px;
      cursor: pointer;
      font: 500 11px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
      letter-spacing: 0.01em;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      flex: 1 1 0;
      min-width: 0;
      transition: color 120ms ease, background-color 120ms ease;
    }
    #${ROOT_ID} .wfpe-duplicate-btn:hover,
    #${ROOT_ID} .wfpe-delete-btn:hover,
    #${ROOT_ID} .wfpe-reset-btn:hover {
      color: #fff;
      background-color: rgba(255, 255, 255, 0.10);
    }
    #${ROOT_ID} .wfpe-delete-btn:hover {
      background-color: rgba(220, 38, 38, 0.28);
    }
    #${ROOT_ID} .wfpe-duplicate-btn .wfpe-icon,
    #${ROOT_ID} .wfpe-delete-btn .wfpe-icon,
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
      display: block !important;
      position: relative !important;
      top: auto !important;
      left: auto !important;
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
