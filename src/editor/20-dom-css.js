  // ===========================================================================
  // DOM mount
  // ===========================================================================
  const root = document.createElement('div');
  root.id = ROOT_ID;
  root.dataset.flowUnlockGroupCount = '0';
  root.dataset.flowUnlockRecordCount = '0';
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
    /* v2.11.2 — design 5b: toolbar, export-menu dock, and inspector dock
       are segments of ONE fixed flex column with 1px seam gaps. The menu
       docks in as the middle segment, pushing the inspector down with the
       same 380ms grid fold both docks share. align-items keeps the
       narrower toolbar hugged to the right edge over the 246px panels. */
    #${ROOT_ID} .wfpe-stack {
      position: fixed;
      top: 16px;
      right: 16px;
      width: 246px;
      z-index: 4;
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      gap: 1px;                  /* the seams */
      pointer-events: none;
    }
    /* v2.14.2 — rest-state selection avoidance. The instrument begins at
       the familiar right edge, but can move as one stable unit to the left
       edge when the selected element occupies its footprint. */
    #${ROOT_ID} .wfpe-stack[data-side="left"] {
      right: auto;
      left: 16px;
      align-items: flex-start;
    }
    #${ROOT_ID} .wfpe-toolbar {
      width: 214px;              /* collapsed: 58px via [data-collapsed];
                                    v2.11.1: 246 - 32 after Handoff merged
                                    into Export (one 30px button + 2px gap) */
      flex: none;
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
      /* Non-negative offsets: the toolbar clips overflow, so a badge
         hanging outside the button gets cut. Small enough to sit clear
         of the icon glyph; min-width grows leftward for 2-digit counts. */
      top: 0;
      right: 0;
      min-width: 12px;
      height: 12px;
      padding: 0 3px;
      border-radius: 7px;
      background: linear-gradient(180deg, #ff9e8c, #f0685b 70%);
      box-shadow: 0 1px 3px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.35);
      font-size: 7.5px;
      font-weight: 600;
      line-height: 1;
      color: #fff;
      display: flex;
      align-items: center;
      justify-content: center;
      box-sizing: border-box;
      pointer-events: none;
    }
    #${ROOT_ID} .wfpe-export-badge[data-count="0"] { display: none; }
    /* 5b: the menu is a stack segment, not a flyout — an outer grid-fold
       dock (0fr ↔ 1fr, same recipe as the inspector dock) animates it in,
       pushing the inspector down instead of overlaying it. */
    #${ROOT_ID} .wfpe-export-dock {
      width: 246px;
      pointer-events: none;
      display: grid;
      grid-template-rows: 0fr;
      transition: grid-template-rows 380ms cubic-bezier(0.32,0.72,0,1);
    }
    #${ROOT_ID} .wfpe-export-dock[data-visible="true"] {
      grid-template-rows: 1fr;
    }
    #${ROOT_ID} .wfpe-export-dock-inner {
      min-height: 0;
      overflow: hidden;
    }
    #${ROOT_ID} .wfpe-export-menu {
      /* root is pointer-events:none (click-through by default); this is a
         real popup that needs its own hit-testing, inherited by children. */
      pointer-events: auto;
      /* Straight 6px top always (it sits below the bar); the bottom rounds
         to 12px only when the menu is the last segment — an inspector
         docked below squares it via [data-above-panel]. */
      border-radius: 6px 6px 12px 12px;
      background: linear-gradient(rgba(255,255,255,0.10), rgba(255,255,255,0.03)), rgba(22,25,31,0.32);
      backdrop-filter: blur(24px) saturate(170%);
      -webkit-backdrop-filter: blur(24px) saturate(170%);
      border: 1px solid rgba(255,255,255,0.22);
      box-shadow: inset 0 1px 0 rgba(255,255,255,0.25);  /* no outer drop —
        seams would smudge; depth comes from the bar, as the inspector. */
      padding: 5px;
      box-sizing: border-box;
      display: flex;
      flex-direction: column;
      gap: 2px;
      color: #fff;
      text-shadow: 0 1px 2px rgba(0,0,0,0.28);
      /* Pin the chrome font — menu items use font:inherit, and without
         this they'd inherit the host deck's typeface instead. */
      font: 12px/1.35 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
      user-select: none;
      transition:
        border-radius 380ms cubic-bezier(0.32,0.72,0,1),
        visibility 0s;
    }
    #${ROOT_ID} .wfpe-export-menu[data-above-panel="true"] { border-radius: 6px; }
    /* Folded shut: hide for focus/AT once the fold completes, mirroring
       the inspector dock's rule. */
    #${ROOT_ID} .wfpe-export-dock[data-visible="false"] .wfpe-export-menu {
      visibility: hidden;
      transition: visibility 0s 380ms;
    }
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
      background: #51565e;
      box-shadow: inset 0 1px 0 rgba(255,255,255,0.18);
    }
    /* Chip icons need the stroke treatment explicitly — the toolbar-btn
       rule doesn't reach them, and un-styled SVG paths render black-filled. */
    #${ROOT_ID} .wfpe-export-menu-chip .wfpe-icon {
      width: 12px;
      height: 12px;
      stroke: currentColor;
      fill: none;
      stroke-width: 1.8;
      stroke-linecap: round;
      stroke-linejoin: round;
    }
    #${ROOT_ID} .wfpe-export-menu-text { display: flex; flex-direction: column; gap: 1px; }
    #${ROOT_ID} .wfpe-export-menu-label { font-size: 11px; font-weight: 500; }
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
      width: 246px;              /* last stack segment; seam = stack gap */
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
      max-height: calc(100vh - 72px);
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
      transition:
        visibility 0s,
        opacity 380ms cubic-bezier(0.32,0.72,0,1);
    }
    /* The stack is click-through by default, but every painted part of a
       visible inspector must own its input surface — including row captions,
       body padding, and the scrollbar. Key this to the dock state so the
       natural-size panel inside the closed grid fold cannot intercept the
       slide while it animates shut. */
    #${ROOT_ID} .wfpe-inspector-dock[data-visible="true"] .wfpe-inspector {
      pointer-events: auto;
    }
    /* 5b focus fold: while the export menu is docked above, the inspector
       recedes — dimmed, body folded to its 36px header. Dismissing the
       menu restores it. Shares the minimised fold/chevron mechanics. */
    #${ROOT_ID} .wfpe-inspector[data-suppressed="true"] { opacity: 0.55; }
    /* v2.12 design 7: any live manipulation dissolves the panel to a
       whisper so the selection reflows in full view. Only applied when the
       selection's box actually intersects the panel (smart gate in
       85-adaptive-fade). Pointer-events stay live. After the suppressed
       rule so a mid-gesture fade wins over the export-menu dim. */
    #${ROOT_ID} .wfpe-inspector[data-fade="true"] { opacity: 0.16; }
    /* Extremely wide selections can intersect both side docks. In that
       case only the inspector becomes a readable outline at rest; the
       toolbar remains the fully opaque editor anchor. */
    #${ROOT_ID} .wfpe-inspector[data-avoidance="overlap"][data-revealed="false"]:not([data-fade="true"]) {
      opacity: 0.18;
    }
    #${ROOT_ID} .wfpe-inspector[data-avoidance="overlap"][data-revealed="true"]:not([data-fade="true"]) {
      opacity: 1;
    }
    /* While the dock is folded shut the panel still has natural height
       inside the clipped 0fr row — hide it for focus/AT/tooling once the
       fold animation completes so it is neither tabbable nor "visible". */
    #${ROOT_ID} .wfpe-inspector-dock[data-visible="false"] .wfpe-inspector {
      visibility: hidden;
      transition: visibility 0s 380ms;
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
    #${ROOT_ID} .wfpe-inspector[data-state="minimised"] .wfpe-inspector-minimise .wfpe-icon,
    #${ROOT_ID} .wfpe-inspector[data-suppressed="true"] .wfpe-inspector-minimise .wfpe-icon {
      transform: rotate(180deg);
    }
    /* Body fold (minimise keeps the 36px header row, rolls the body up) */
    #${ROOT_ID} .wfpe-inspector-fold {
      display: grid;
      grid-template-rows: 1fr;
      transition: grid-template-rows 380ms cubic-bezier(0.32,0.72,0,1);
    }
    #${ROOT_ID} .wfpe-inspector[data-state="minimised"] .wfpe-inspector-fold,
    #${ROOT_ID} .wfpe-inspector[data-suppressed="true"] .wfpe-inspector-fold {
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
    #${ROOT_ID} .wfpe-inspector[data-state="minimised"] .wfpe-inspector-fold-inner,
    #${ROOT_ID} .wfpe-inspector[data-suppressed="true"] .wfpe-inspector-fold-inner {
      visibility: hidden;
      transition: visibility 0s 380ms;
    }
    #${ROOT_ID} .wfpe-inspector-body {
      border-top: 1px solid rgba(255,255,255,0.14);
      padding: 11px 13px 12px;
      display: flex;
      flex-direction: column;
      gap: 8px;
      box-sizing: border-box;
      max-height: calc(100vh - 109px);
      overflow-y: auto;
      overscroll-behavior: contain;
      scrollbar-width: thin;
      scrollbar-color: rgba(255,255,255,0.28) transparent;
    }
    #${ROOT_ID} .wfpe-inspector-body::-webkit-scrollbar {
      width: 6px;
    }
    #${ROOT_ID} .wfpe-inspector-body::-webkit-scrollbar-thumb {
      border-radius: 999px;
      background: rgba(255,255,255,0.28);
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
    /* v2.12 design 7: the font value field is scrubbable — drag L/R to
       change size (~1px per 3px). A clean click still focuses the input
       for a typed exact value, so the caret cursor returns on focus. */
    #${ROOT_ID} .wfpe-inspector-row[data-wfpe-row="font-size"] .wfpe-inspector-field,
    #${ROOT_ID} .wfpe-inspector-row[data-wfpe-row="font-size"] .wfpe-inspector-field input {
      cursor: ew-resize;
      touch-action: none;
    }
    #${ROOT_ID} .wfpe-inspector-row[data-wfpe-row="font-size"] .wfpe-inspector-field input:focus {
      cursor: text;
    }
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
      min-height: 52px;
      max-height: 112px;
      box-sizing: border-box;
      width: 100%;
      padding: 6px 8px;
      border-radius: 7px;
      background: rgba(9,11,16,0.32);
      border: 1px solid rgba(255,255,255,0.12);
      box-shadow: inset 0 1px 2px rgba(0,0,0,0.22);
      font: 11px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
      color: #fff;
      resize: none;
      overflow-y: hidden;
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
    /* v2.13 — read-only agent reply under the note textarea. Amber for
       needs-input (the row's existing has-note accent), slate for skipped. */
    #${ROOT_ID} .wfpe-annotation-reply {
      margin-top: 6px;
      padding: 6px 8px;
      border-radius: 7px;
      background: rgba(245, 158, 11, 0.14);
      border: 1px solid rgba(245, 158, 11, 0.38);
      color: rgba(255, 234, 200, 0.96);
      font: 500 10.5px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
      letter-spacing: 0.01em;
      overflow-wrap: break-word;
    }
    #${ROOT_ID} .wfpe-annotation-reply[data-status="skipped"] {
      background: rgba(148, 163, 178, 0.16);
      border-color: rgba(148, 163, 178, 0.4);
      color: rgba(226, 232, 240, 0.92);
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
    /* v2.12 live value tag (design 7): lit coral chip pinned to the
       selection while a gesture is in flight — the eye stays on the
       element, not the faded panel. Supersedes the dim bubble for the
       duration (positionDimBubble defers to it). */
    #${ROOT_ID} .wfpe-scrub-tag {
      position: fixed;
      display: inline-flex;
      align-items: center;
      padding: 4px 10px;
      border-radius: 8px;
      white-space: nowrap;
      pointer-events: none;
      background: linear-gradient(180deg, #ff9e8c, #f0685b 60%, #e55a4e);
      box-shadow: 0 4px 12px rgba(230, 88, 76, 0.45), inset 0 1px 0 rgba(255, 255, 255, 0.40);
      color: #fff;
      font: 700 11px/1.2 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
      letter-spacing: 0.02em;
      font-variant-numeric: tabular-nums;
      opacity: 0;
      transform: translateY(5px);
      transition:
        opacity 200ms cubic-bezier(0.32,0.72,0,1),
        transform 200ms cubic-bezier(0.32,0.72,0,1);
    }
    #${ROOT_ID} .wfpe-scrub-tag[data-show="true"] { opacity: 1; transform: translateY(0); }
    #${ROOT_ID} .wfpe-annotation-layer {
      position: fixed;
      inset: 0;
      pointer-events: none;
      z-index: 3;
    }
    /* Annotation DOT (design 6b, v2.12.2): the "this element has a note"
       marker in the same coral-glass vocabulary as the Edit button and the
       Export badge — 13px coral radial with inset highlight + coral glow,
       replacing the old detached glossy sphere. Class name kept for
       test/handler continuity; the visual recipe is .wfpe-note-dot from
       the 6b reference. */
    #${ROOT_ID} .wfpe-annotation-badge {
      position: fixed;
      pointer-events: auto;
      appearance: none;
      -webkit-appearance: none;
      box-sizing: border-box;
      width: 13px;
      height: 13px;
      padding: 0;
      border: 0;
      border-radius: 50%;
      background: radial-gradient(circle at 35% 30%, #ffc3b2, #f0685b 62%, #d94f43);
      color: transparent;
      box-shadow:
        0 2px 7px rgba(230, 88, 76, 0.55),
        inset 0 1px 1px rgba(255, 255, 255, 0.5);
      cursor: pointer;
      font-size: 0;
      line-height: 0;
      user-select: none;
      transition: transform 160ms ease, box-shadow 160ms ease, filter 160ms ease;
    }
    /* Emphasis stays coral-native (glow + brightness, like the Edit button
       and Export badge) — no white halo ring; the legacy ring dominated the
       13px dot and made the 6b restyle read as the old glossy sphere. */
    #${ROOT_ID} .wfpe-annotation-badge:hover,
    #${ROOT_ID} .wfpe-annotation-badge[data-selected="true"] {
      filter: brightness(1.06);
      transform: translateY(-1px);
      box-shadow:
        0 4px 12px rgba(230, 88, 76, 0.7),
        inset 0 1px 1px rgba(255, 255, 255, 0.5);
    }
    /* v2.13 agent-reply states in the same coral-glass vocabulary:
       needs-input renders amber, skipped renders muted slate. Emphasis
       keeps each state's own glow rather than reverting to coral. */
    #${ROOT_ID} .wfpe-annotation-badge[data-status="needs-input"] {
      background: radial-gradient(circle at 35% 30%, #ffe6b8, #f0a83b 62%, #d8892a);
      box-shadow:
        0 2px 7px rgba(240, 168, 59, 0.55),
        inset 0 1px 1px rgba(255, 255, 255, 0.5);
    }
    #${ROOT_ID} .wfpe-annotation-badge[data-status="needs-input"]:hover,
    #${ROOT_ID} .wfpe-annotation-badge[data-status="needs-input"][data-selected="true"] {
      box-shadow:
        0 4px 12px rgba(240, 168, 59, 0.7),
        inset 0 1px 1px rgba(255, 255, 255, 0.5);
    }
    #${ROOT_ID} .wfpe-annotation-badge[data-status="skipped"] {
      background: radial-gradient(circle at 35% 30%, #e2e8ee, #9aa6b2 62%, #7d8a97);
      box-shadow:
        0 2px 7px rgba(122, 135, 148, 0.5),
        inset 0 1px 1px rgba(255, 255, 255, 0.5);
    }
    #${ROOT_ID} .wfpe-annotation-badge[data-status="skipped"]:hover,
    #${ROOT_ID} .wfpe-annotation-badge[data-status="skipped"][data-selected="true"] {
      box-shadow:
        0 4px 12px rgba(122, 135, 148, 0.65),
        inset 0 1px 1px rgba(255, 255, 255, 0.5);
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
    body[data-wfp-edit-overview="on"] #${ROOT_ID} .wfpe-scrub-tag,
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
    /* Persistent drag cue. The full thumbnail remains the HTML5 drag
       source; this compact top-centre grip makes that capability visible. */
    #${ROOT_ID} .wfpe-overview-drag-handle {
      position: absolute;
      top: 6px;
      left: 50%;
      transform: translateX(-50%);
      width: 30px;
      height: 22px;
      border-radius: 8px;
      background: rgba(15, 23, 42, 0.68);
      backdrop-filter: blur(20px) saturate(180%);
      -webkit-backdrop-filter: blur(20px) saturate(180%);
      border: 1px solid rgba(255, 255, 255, 0.20);
      box-shadow: 0 3px 10px rgba(0, 0, 0, 0.28);
      color: rgba(255, 255, 255, 0.92);
      display: inline-flex;
      align-items: center;
      justify-content: center;
      pointer-events: none;
      z-index: 1;
    }
    #${ROOT_ID} .wfpe-overview-drag-handle svg {
      width: 14px;
      height: 14px;
      fill: currentColor;
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
    /* × delete button (v2.1.4, persistent since v2.14.2) — Liquid Glass
       pill, top-right of each thumb. Same dark-glass tint as
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
      display: inline-flex;
      align-items: center;
      justify-content: center;
      z-index: 1;
      transition: background-color 120ms ease, transform 120ms ease;
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
