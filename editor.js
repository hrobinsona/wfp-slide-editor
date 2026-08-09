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
 * v2.13:   live agent round-trip — save-file watch, in-place refresh,
 *          agent results reconciliation.
 * v2.14:   handoff ground truth — edit ledger and box/computed/overflow
 *          measurements in the handoff payload.
 * v2.14.1: overflow measurement fixes — skip parent-escape on unlock-frozen
 *          elements; tolerate sub-1 line-height descender overhang.
 * v2.14.2: rest-state inspector avoidance, auto-growing agent notes, and
 *          persistent Overview drag/delete affordances.
 *
 * Internal class names use the `wfpe-` prefix so they don't collide with
 * the WFP fixtures' own `wfp-badge` / `wfp-*` classes.
 */
(function () {
  'use strict';

  const VERSION = '2.14.2';
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
  // v2.15 — a direct-child unlock pins every child of the flat root
  // absolute, collapsing the root's intrinsic height. The measured height
  // is held via this marker plus a dynamic rule in editor-owned CSS (the
  // live root never gets inline styles); export converts the marker into
  // inline height on the clone. Shared between the unlock engine and the
  // export scrubber.
  const FLAT_ROOT_HEIGHT_ATTR = 'data-wfp-edit-flat-root-height';
  const ANNOTATION_ID_ATTR = 'data-wfp-edit-annotation-id';
  const ANNOTATION_TEXT_ATTR = 'data-wfp-edit-annotation-text';
  const HANDOFF_TARGET_ATTR = 'data-wfp-agent-annotation-id';
  // v2.14 — anchors edit-ledger entries to exported elements. Stamped on the
  // live DOM only transiently during the handoff build (stamp → cloneNode →
  // unstamp); persisted in exported files only, stripped again on reimport.
  const EDIT_LEDGER_TARGET_ATTR = 'data-wfp-agent-edit-id';
  const HANDOFF_SCRIPT_ATTR = 'data-wfp-agent-annotations';
  const RESULTS_SCRIPT_ATTR = 'data-wfp-agent-results';
  const ANNOTATION_STATUS_ATTR = 'data-wfp-edit-annotation-status';
  const ANNOTATION_REPLY_ATTR = 'data-wfp-edit-annotation-reply';
  const HANDOFF_COMMENT_TEXT = 'WFP Editor handoff: user-authored annotations are in script[data-wfp-agent-annotations]. Apply each annotation to the matching data-wfp-agent-annotation-id element. The user expects agents to record outcomes in a script[type="application/json"][data-wfp-agent-results] block as {"results":[{"id","status":"done|skipped|needs-input","note"}]}, to remove annotation metadata for done items, and to keep it for skipped or needs-input items so those notes stay anchored. The payload\'s edits array records the user\'s own manual changes, anchored by data-wfp-agent-edit-id; preserve them unless an annotation explicitly asks otherwise (mechanical: true entries are editor-written layout pinning, not requests).';

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
    originalStyles: new WeakMap(), // Element → pre-edit inline `style` value (string | null), captured at the element's first committed change; Reset restores this
    clipboard: null, // { outerHTML } session-only element copy/paste payload
    inspectorMinimised: false, // persists across selections within session; resets on reload
    toolbarCollapsed: false, // ink-glass 3b — bar folded to Edit + chevron; session-only
    exportMenuOpen: false, // v2.11 — export action menu (4b) open/closed
    overviewMode: false, // v2.1.0 — bird's-eye grid of all slides; toggled by hotkey O / toolbar button / Escape
    markdownMode: document.documentElement.dataset.wfpMarkdown === 'true', // v2.22 — the page is a rendered Markdown surface hosted by tools/md-review.html: geometry editing is meaningless here and the primary export writes Markdown through the host's sink instead of HTML
    notesPanelOpen: false, // v2.21 — agent-notes panel (third stack segment) open/closed; toggled by toolbar button / hotkey N / Escape
    notesCursorId: null, // v2.21 — annotation id of the last note jumped to; N/Shift+N flicking resumes here when nothing is selected
    overviewDrag: null, // v2.1.3 — { sourceSlide, sourceIndex, beforeOrder } during a drag-to-reorder
    overviewHoveredSlide: null, // v2.1.4 — slide whose thumb the cursor is over (Backspace/Delete target)
    deckMutated: false, // v2.1.0 hotfix — set after an editor-owned slide activation/mutation/refresh; flips arrow-nav to live-DOM when the fixture's cached cursor/list can be stale
    agentResultsSummary: null, // v2.13 — {done, skipped, needsInput} parsed from the agent results block at import; consumed by the ready toast. Lives on state (not a module let) because reimport runs during an earlier fragment's evaluation.
    annotatedElementsCache: [], // perf fix — every currently-annotated element, cached by refreshAnnotationMarkers() for the idle selection-tracking tick. Lives on state (not a module let) because refreshExportUi()'s tail call to refreshAnnotationMarkers() runs during an earlier fragment's evaluation, same reasoning as agentResultsSummary above.
    editedElements: new Set(), // v2.14 — every element endTxn() committed a change for. Session scope, never pruned: originalStyles is a WeakMap and cannot be enumerated, so this Set is the iterable companion the edit ledger walks at handoff-build time (build-time filters handle disconnected/undone elements).
    pinnedStyles: new WeakMap(), // v2.14 — Element → inline `style` exactly as unlock/freeze pinning wrote it. The dragged element gets the same frozen marker as its pinned siblings, so attribute presence alone cannot tell pinning from intent; a ledger entry is `mechanical` only while its element's style still equals this recorded value.
    flatRootHoldTargets: new WeakMap(), // v2.15 — flat root → the layout offset (offsetTop-space) that content following the root must keep while ANY of its children is pinned. Captured from the pristine layout at the first pin and re-solved whenever the pinned set changes (partial Reset, undo/redo, later unlocks); dropped once no pinned child remains, which also drops the height marker.
    flowUnlockGroups: new WeakMap(), // Element → ordered unlock-group memberships. The latest active group owns Reset for that element; inactive entries remain only so undo/redo can reactivate their provenance.
    flowUnlockGroupRegistry: new Set(), // Iterable companion used to prune inactive groups once no retained history transition can reactivate them. Pruning clears strong record→Element references, including detached members.
  };
  const deckContext = resolveDeckRoot();
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
      width: 246px;              /* collapsed: 58px via [data-collapsed];
                                    v2.21: back to the full stack width —
                                    the Agent-notes button restores the
                                    30px + 2px gap that v2.11.1 removed
                                    when Handoff merged into Export */
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
    /* ----- v2.21 — Agent-notes dock: third stack segment (toolbar →
       export menu → notes → inspector), same grid-fold recipe as the
       export dock. Lists every saved annotation across the deck; the
       inspector docking BELOW it keeps cards stationary as selection
       changes. ----- */
    #${ROOT_ID} .wfpe-notes-dock {
      width: 246px;
      pointer-events: none;
      display: grid;
      grid-template-rows: 0fr;
      /* A zero-height segment still sits between two 1px stack gaps —
         2px of dead seam that would break the ink-glass 1px contract
         (inspector dockTop = 56, menu↔inspector gap = 1). The folded
         dock cancels one gap with a negative margin; the open dock
         restores it, animated with the same fold curve. */
      margin-bottom: -1px;
      transition:
        grid-template-rows 380ms cubic-bezier(0.32,0.72,0,1),
        margin-bottom 380ms cubic-bezier(0.32,0.72,0,1);
    }
    #${ROOT_ID} .wfpe-notes-dock[data-visible="true"] {
      grid-template-rows: 1fr;
      margin-bottom: 0;
    }
    #${ROOT_ID} .wfpe-notes-dock-inner {
      min-height: 0;
      overflow: hidden;
    }
    #${ROOT_ID} .wfpe-notes-panel {
      display: flex;
      flex-direction: column;
      /* Straight 6px top always (it sits below the bar); the bottom rounds
         to 12px only while it is the last segment — an inspector docked
         below squares it via [data-last="false"], mirroring the export
         menu's [data-above-panel] rule. */
      border-radius: 6px 6px 12px 12px;
      background: linear-gradient(rgba(255,255,255,0.10), rgba(255,255,255,0.03)), rgba(22,25,31,0.32);
      backdrop-filter: blur(24px) saturate(170%);
      -webkit-backdrop-filter: blur(24px) saturate(170%);
      border: 1px solid rgba(255,255,255,0.22);
      box-shadow: inset 0 1px 0 rgba(255,255,255,0.25);  /* no outer drop shadow */
      overflow: hidden;
      color: #fff;
      text-shadow: 0 1px 2px rgba(0,0,0,0.28);
      font: 12px/1.35 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
      user-select: none;
      box-sizing: border-box;
      transition:
        border-radius 380ms cubic-bezier(0.32,0.72,0,1),
        visibility 0s;
    }
    #${ROOT_ID} .wfpe-notes-panel[data-last="false"] { border-radius: 6px; }
    #${ROOT_ID} .wfpe-notes-dock[data-visible="true"] .wfpe-notes-panel {
      pointer-events: auto;
    }
    /* Folded shut: hide for focus/AT once the fold completes, mirroring
       the inspector dock's rule. */
    #${ROOT_ID} .wfpe-notes-dock[data-visible="false"] .wfpe-notes-panel {
      visibility: hidden;
      transition: visibility 0s 380ms;
    }
    #${ROOT_ID} .wfpe-notes-header {
      display: flex;
      align-items: center;
      height: 36px;
      box-sizing: border-box;
      padding: 0 6px 0 13px;
      gap: 2px;
    }
    #${ROOT_ID} .wfpe-notes-title {
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 0.09em;
      text-transform: uppercase;
      opacity: 0.95;
      margin-right: auto;
    }
    #${ROOT_ID} .wfpe-notes-nav-btn {
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
    #${ROOT_ID} .wfpe-notes-nav-btn:hover:not(:disabled) { background-color: rgba(255,255,255,0.14); }
    #${ROOT_ID} .wfpe-notes-nav-btn:disabled { opacity: 0.35; cursor: default; }
    #${ROOT_ID} .wfpe-notes-nav-btn .wfpe-icon {
      width: 13px;
      height: 13px;
      stroke: currentColor;
      fill: none;
      stroke-width: 2;
      stroke-linecap: round;
      stroke-linejoin: round;
    }
    /* The hard scroll cap is what keeps toolbar + export/notes + inspector
       inside the viewport budget on short windows. */
    #${ROOT_ID} .wfpe-notes-list {
      min-height: 0;
      max-height: 40vh;
      overflow-y: auto;
      overscroll-behavior: contain;
      padding: 0 5px 5px;
      display: flex;
      flex-direction: column;
      gap: 2px;
      /* Same thin translucent scrollbar recipe as .wfpe-inspector-body —
         the default white scrollbar reads as a foreign object on glass. */
      scrollbar-width: thin;
      scrollbar-color: rgba(255,255,255,0.28) transparent;
    }
    #${ROOT_ID} .wfpe-notes-list::-webkit-scrollbar {
      width: 6px;
    }
    #${ROOT_ID} .wfpe-notes-list::-webkit-scrollbar-thumb {
      border-radius: 999px;
      background: rgba(255,255,255,0.28);
    }
    #${ROOT_ID} .wfpe-notes-empty {
      padding: 2px 9px 12px;
      font-size: 10.5px;
      color: rgba(255,255,255,0.60);
    }
    /* Card accent bar follows the marker status vocabulary: coral note,
       amber needs-input, slate skipped. */
    #${ROOT_ID} .wfpe-notes-card {
      appearance: none;
      -webkit-appearance: none;
      display: flex;
      flex-direction: column;
      gap: 3px;
      width: 100%;
      padding: 7px 9px;
      border: 0;
      border-left: 2px solid #f0685b;
      border-radius: 8px;
      background: transparent;
      color: #fff;
      text-align: left;
      cursor: pointer;
      box-sizing: border-box;
      font: inherit;
    }
    #${ROOT_ID} .wfpe-notes-card:hover { background: rgba(255,255,255,0.10); }
    #${ROOT_ID} .wfpe-notes-card[data-active="true"] { background: rgba(240,104,91,0.20); }
    #${ROOT_ID} .wfpe-notes-card[data-status="needs-input"] { border-left-color: #f0a83b; }
    #${ROOT_ID} .wfpe-notes-card[data-status="skipped"] { border-left-color: #9aa6b2; }
    #${ROOT_ID} .wfpe-notes-card-top {
      display: flex;
      align-items: center;
      gap: 6px;
      min-width: 0;
    }
    #${ROOT_ID} .wfpe-notes-card-chip {
      flex: none;
      min-width: 16px;
      height: 16px;
      padding: 0 4px;
      border-radius: 8px;
      background: rgba(255,255,255,0.14);
      box-shadow: inset 0 1px 0 rgba(255,255,255,0.18);
      font-size: 9px;
      font-weight: 700;
      display: flex;
      align-items: center;
      justify-content: center;
      box-sizing: border-box;
    }
    #${ROOT_ID} .wfpe-notes-card-snippet {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-size: 9.5px;
      color: rgba(255,255,255,0.60);
    }
    #${ROOT_ID} .wfpe-notes-card-instruction {
      font-size: 11px;
      font-weight: 500;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
      overflow-wrap: anywhere;
    }
    #${ROOT_ID} .wfpe-notes-card-reply { font-size: 9.5px; }
    #${ROOT_ID} .wfpe-notes-card-reply[data-status="needs-input"] { color: #ffd9a1; }
    #${ROOT_ID} .wfpe-notes-card-reply[data-status="skipped"] { color: rgba(226,232,238,0.75); }
    /* Notes count badge on the toolbar button — same recipe as the export
       badge above. */
    #${ROOT_ID} .wfpe-toolbar-btn[data-action="notes"] { position: relative; }
    #${ROOT_ID} .wfpe-notes-badge {
      position: absolute;
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
    #${ROOT_ID} .wfpe-notes-badge[data-count="0"] { display: none; }
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
    /* v2.18 — multi-selection reduced surface. Position/Size never carry
       an inline display style (unlike weight/align/annotation, which the
       populate JS toggles per-selection), so a plain attribute selector is
       enough here with no inline-style fight to worry about. */
    #${ROOT_ID} .wfpe-inspector-dock[data-multi="true"] [data-wfpe-row="position"],
    #${ROOT_ID} .wfpe-inspector-dock[data-multi="true"] [data-wfpe-row="size"] {
      display: none;
    }
    /* v2.19 — inverse of the above: Align is multi-selection ONLY (per-
       element geometry rows disappear there; Align is what replaces them).
       Same no-inline-style-fight reasoning — Align never carries an inline
       display style either. */
    #${ROOT_ID} .wfpe-inspector-dock [data-wfpe-row="align-elements"] {
      display: none;
    }
    #${ROOT_ID} .wfpe-inspector-dock[data-multi="true"] [data-wfpe-row="align-elements"] {
      display: grid;
    }
    #${ROOT_ID} .wfpe-inspector-dock-inner {
      min-height: 0;
      overflow: hidden;
    }
    /* v2.22 — Markdown mode: hide every control whose only output is an
       inline style. What survives is the agent note, which is the whole
       point of reviewing a Markdown file. Selection handles go too — a
       resized paragraph has no Markdown representation. */
    #${ROOT_ID} .wfpe-inspector-dock[data-md="true"] [data-wfpe-row="position"],
    #${ROOT_ID} .wfpe-inspector-dock[data-md="true"] [data-wfpe-row="size"],
    #${ROOT_ID} .wfpe-inspector-dock[data-md="true"] [data-wfpe-row="text-color"],
    #${ROOT_ID} .wfpe-inspector-dock[data-md="true"] [data-wfpe-row="bg-color"],
    #${ROOT_ID} .wfpe-inspector-dock[data-md="true"] [data-wfpe-row="opacity"],
    #${ROOT_ID} .wfpe-inspector-dock[data-md="true"] [data-wfpe-row="font-size"],
    #${ROOT_ID} .wfpe-inspector-dock[data-md="true"] [data-wfpe-row="font-weight"],
    #${ROOT_ID} .wfpe-inspector-dock[data-md="true"] [data-wfpe-row="text-align"],
    #${ROOT_ID} .wfpe-inspector-dock[data-md="true"] [data-wfpe-row="align-elements"],
    #${ROOT_ID} .wfpe-inspector-dock[data-md="true"] [data-wfpe-row="actions"],
    #${ROOT_ID} .wfpe-inspector-dock[data-md="true"] .wfpe-inspector-divider {
      display: none !important;
    }
    /* Handles and the W × H bubble are geometry readouts with nothing to
       report on a Markdown block. */
    #${ROOT_ID}[data-md="true"] .wfpe-handle,
    #${ROOT_ID}[data-md="true"] .wfpe-dim-bubble { display: none !important; }
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
    /* Footer actions: Duplicate / Delete / Reset / Front. flex-wrap is load-
       bearing, not cosmetic: the panel is a fixed 246px with overflow:
       hidden (see .wfpe-inspector above), and four buttons' natural width
       can exceed the ~218px content box at some font/platform metrics —
       without wrap the overflow doesn't reflow, it gets hard-clipped
       mid-label by the ancestor (code review, v2.17.1: "Fro" for "Front").
       gap replaces the space-between reliance on exact single-row fit. */
    #${ROOT_ID} .wfpe-action-row {
      display: flex;
      flex-wrap: wrap;
      justify-content: space-between;
      gap: 4px 8px;
      border-top: 1px solid rgba(255,255,255,0.13);
      padding-top: 9px;
      margin-top: 1px;
    }
    #${ROOT_ID} .wfpe-action-btn {
      appearance: none;
      -webkit-appearance: none;
      display: flex;
      align-items: center;
      gap: 4px;
      background: transparent;
      border: 0;
      color: rgba(255,255,255,0.95);
      font-size: 10.5px;
      font-weight: 600;
      cursor: pointer;
      padding: 4px 5px;
      border-radius: 6px;
      transition: background-color 120ms ease;
    }
    #${ROOT_ID} .wfpe-action-btn:hover:not(:disabled) { background: rgba(255,255,255,0.14); }
    #${ROOT_ID} .wfpe-action-btn.wfpe-delete-btn:hover:not(:disabled) {
      background-color: rgba(220, 38, 38, 0.28);
    }
    /* v2.18 — Duplicate/Delete stay visible but inert for a multi-
       selection: their functions already no-op there, so this stops the
       UI from lying about it. */
    #${ROOT_ID} .wfpe-action-btn:disabled {
      color: rgba(255,255,255,0.35);
      cursor: default;
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
    // Chevron-left: notes-panel "previous note" control (v2.21).
    chevronLeft:
      '<svg class="wfpe-icon" viewBox="0 0 24 24" aria-hidden="true">' +
      '<polyline points="15 18 9 12 15 6" />' +
      '</svg>',
    // Round speech bubble — Agent-notes toolbar button (v2.21). Distinct
    // from the squared `handoff` bubble used in the export menu.
    notes:
      '<svg class="wfpe-icon" viewBox="0 0 24 24" aria-hidden="true">' +
      '<path d="M21 11.5a8.38 8.38 0 0 1-8.5 8.3 8.6 8.6 0 0 1-3.8-.9L3 21l2.1-5.7a8.3 8.3 0 1 1 15.9-3.8z" />' +
      '</svg>',
    // × — notes-panel close control (v2.21).
    close:
      '<svg class="wfpe-icon" viewBox="0 0 24 24" aria-hidden="true">' +
      '<line x1="6" y1="6" x2="18" y2="18" />' +
      '<line x1="18" y1="6" x2="6" y2="18" />' +
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
    grip:
      '<svg viewBox="0 0 24 24" aria-hidden="true">' +
      '<circle cx="8" cy="7" r="1.5" />' +
      '<circle cx="16" cy="7" r="1.5" />' +
      '<circle cx="8" cy="12" r="1.5" />' +
      '<circle cx="16" cy="12" r="1.5" />' +
      '<circle cx="8" cy="17" r="1.5" />' +
      '<circle cx="16" cy="17" r="1.5" />' +
      '</svg>',
    // Stacked-planes glyph — paired with the inspector Front action (v2.17,
    // bring to front). A diamond over a single chevron reads unambiguously
    // as "layers" with fill: none; two overlapping rects (the original
    // v2.17 icon) crossed their strokes in the overlap zone and read as a
    // hash mark instead (code review, v2.17.1).
    layers:
      '<svg class="wfpe-icon" viewBox="0 0 24 24" aria-hidden="true">' +
      '<polygon points="12 2 3 7 12 12 21 7 12 2" />' +
      '<polyline points="3 12 12 17 21 12" />' +
      '</svg>',
    // v2.19 — object-alignment glyphs (bar + two boxes), distinct from the
    // text-align triplet above: those set CSS text-align on one element,
    // these move every selected element to an edge/midline of the
    // selection bounding box.
    alignObjLeft:
      '<svg class="wfpe-icon" viewBox="0 0 24 24" aria-hidden="true">' +
      '<line x1="4" y1="2" x2="4" y2="22" />' +
      '<rect x="7" y="5" width="14" height="6" rx="1" />' +
      '<rect x="7" y="14" width="9" height="6" rx="1" />' +
      '</svg>',
    alignObjCenterH:
      '<svg class="wfpe-icon" viewBox="0 0 24 24" aria-hidden="true">' +
      '<line x1="12" y1="2" x2="12" y2="22" />' +
      '<rect x="5" y="5" width="14" height="6" rx="1" />' +
      '<rect x="8" y="14" width="8" height="6" rx="1" />' +
      '</svg>',
    alignObjRight:
      '<svg class="wfpe-icon" viewBox="0 0 24 24" aria-hidden="true">' +
      '<line x1="20" y1="2" x2="20" y2="22" />' +
      '<rect x="3" y="5" width="14" height="6" rx="1" />' +
      '<rect x="8" y="14" width="9" height="6" rx="1" />' +
      '</svg>',
    alignObjTop:
      '<svg class="wfpe-icon" viewBox="0 0 24 24" aria-hidden="true">' +
      '<line x1="2" y1="4" x2="22" y2="4" />' +
      '<rect x="5" y="7" width="6" height="14" rx="1" />' +
      '<rect x="14" y="7" width="6" height="9" rx="1" />' +
      '</svg>',
    alignObjMiddleV:
      '<svg class="wfpe-icon" viewBox="0 0 24 24" aria-hidden="true">' +
      '<line x1="2" y1="12" x2="22" y2="12" />' +
      '<rect x="5" y="5" width="6" height="14" rx="1" />' +
      '<rect x="14" y="8" width="6" height="8" rx="1" />' +
      '</svg>',
    alignObjBottom:
      '<svg class="wfpe-icon" viewBox="0 0 24 24" aria-hidden="true">' +
      '<line x1="2" y1="20" x2="22" y2="20" />' +
      '<rect x="5" y="3" width="6" height="14" rx="1" />' +
      '<rect x="14" y="8" width="6" height="9" rx="1" />' +
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
  // v2.21 — agent-notes panel toggle. Count badge clones the export badge
  // recipe; hidden at zero via CSS [data-count="0"].
  const notesBtn = makeToolbarButton('notes', 'Agent notes', 'Agent notes (N)', 'notes');
  const notesBadge = document.createElement('span');
  notesBadge.className = 'wfpe-notes-badge';
  notesBadge.dataset.count = '0';
  notesBadge.setAttribute('aria-hidden', 'true');
  notesBtn.appendChild(notesBadge);
  notesBtn.setAttribute('aria-expanded', 'false');
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
  toolbarFoldInner.appendChild(notesBtn);
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

  // v2.11.2 — design 5b: toolbar, export-menu dock, and inspector dock are
  // segments of ONE fixed flex column (1px seam gaps). The menu docking in
  // as a middle segment makes the inspector's offset dynamic, which a
  // shared column handles for free — independently fixed elements can't.
  const stack = document.createElement('div');
  stack.className = 'wfpe-stack';
  stack.dataset.side = 'right';
  stack.appendChild(toolbar);
  root.appendChild(stack);

  // v2.11 — export action menu (design 4b rows, 5b docking). Grid-fold
  // segment under the toolbar; opened by the Export button. Row 1 is the
  // primary save action (Enter / Cmd+S), row 2 is the clean-copy download.
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
  // Middle segment of the stack: a grid-fold dock (0fr ↔ 1fr) identical in
  // mechanism to the inspector dock below, so the menu pushes the inspector
  // down with the same 380ms ease instead of overlaying it.
  const exportDock = document.createElement('div');
  exportDock.className = 'wfpe-export-dock';
  exportDock.dataset.visible = 'false';
  const exportDockInner = document.createElement('div');
  exportDockInner.className = 'wfpe-export-dock-inner';
  exportDockInner.appendChild(exportMenu);
  exportDock.appendChild(exportDockInner);
  stack.appendChild(exportDock);

  // v2.21 — agent-notes panel: third stack segment, between the export
  // dock and the inspector dock. The inspector opening BELOW the list
  // keeps cards stationary as selection changes. Same grid-fold recipe
  // as the export dock; card DOM is owned by renderNotesPanel()
  // (45-notes-panel.js) and only built while the panel is open.
  const notesDock = document.createElement('div');
  notesDock.className = 'wfpe-notes-dock';
  notesDock.dataset.visible = 'false';
  const notesDockInner = document.createElement('div');
  notesDockInner.className = 'wfpe-notes-dock-inner';
  notesDock.appendChild(notesDockInner);

  const notesPanel = document.createElement('div');
  notesPanel.className = 'wfpe-notes-panel';
  notesPanel.dataset.open = 'false'; // stable hook for tests
  notesPanel.dataset.last = 'true';

  const notesHeader = document.createElement('div');
  notesHeader.className = 'wfpe-notes-header';
  const notesTitle = document.createElement('span');
  notesTitle.className = 'wfpe-notes-title';
  notesTitle.textContent = 'Agent notes';
  notesHeader.appendChild(notesTitle);

  function makeNotesNavButton(action, label, hint, iconKey) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'wfpe-notes-nav-btn';
    b.dataset.action = action;
    b.title = hint;
    b.setAttribute('aria-label', label);
    b.innerHTML = ICONS[iconKey];
    return b;
  }
  const notesPrevBtn = makeNotesNavButton('notes-prev', 'Previous note', 'Previous note (Shift+N)', 'chevronLeft');
  const notesNextBtn = makeNotesNavButton('notes-next', 'Next note', 'Next note (N)', 'chevronRight');
  const notesCloseBtn = makeNotesNavButton('notes-close', 'Close agent notes', 'Close (Esc)', 'close');
  notesHeader.appendChild(notesPrevBtn);
  notesHeader.appendChild(notesNextBtn);
  notesHeader.appendChild(notesCloseBtn);
  notesPanel.appendChild(notesHeader);

  const notesList = document.createElement('div');
  notesList.className = 'wfpe-notes-list';
  notesPanel.appendChild(notesList);

  notesDockInner.appendChild(notesPanel);
  stack.appendChild(notesDock);

  // Inspector panel. Ink-glass 3b docks it beneath the toolbar as the
  // second glass segment: an outer .wfpe-inspector-dock wrapper (fixed at
  // top: 53px = 16 + 36 bar + 1px seam) animates the whole segment open/
  // shut on select/deselect via grid-template-rows, replacing the old
  // display:none toggle on the panel itself. The panel's data-visible
  // attribute is kept in sync purely as a stable hook for tests.
  const inspectorDock = document.createElement('div');
  inspectorDock.className = 'wfpe-inspector-dock';
  inspectorDock.dataset.visible = 'false';
  // v2.18 — set by refreshInspector() from getSelectedElements().length > 1.
  // Gates the reduced multi-selection control surface in CSS (geometry
  // rows) and in the populate/gating JS below (typography, action row).
  inspectorDock.dataset.multi = 'false';
  const inspectorDockInner = document.createElement('div');
  inspectorDockInner.className = 'wfpe-inspector-dock-inner';
  inspectorDock.appendChild(inspectorDockInner);

  const inspector = document.createElement('div');
  inspector.className = 'wfpe-inspector';
  inspector.dataset.visible = 'false';
  inspector.dataset.state = 'expanded';
  inspector.dataset.avoidance = 'clear';
  inspector.dataset.revealed = 'false';

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

  // v2.19 — Align (object alignment) row: six one-shot actions against the
  // SELECTION bounding box, multi-selection only. Named `alignElementsRow`
  // (not `alignRow`, already taken by the text-align triplet above) and
  // built on the same makeSegRow chrome, but buttons expose their mode as
  // `dataset.align` — a plain action identity, not a persistent toggle
  // state like weight/text-align, so `dataset.active` is left permanently
  // 'false' (no highlighted state to track for a momentary action).
  const alignElementsRow = makeSegRow('align-elements', 'Align', [
    { action: 'align-elements', value: 'left', iconKey: 'alignObjLeft', hint: 'Align left' },
    { action: 'align-elements', value: 'center-h', iconKey: 'alignObjCenterH', hint: 'Align center (horizontal)' },
    { action: 'align-elements', value: 'right', iconKey: 'alignObjRight', hint: 'Align right' },
    { action: 'align-elements', value: 'top', iconKey: 'alignObjTop', hint: 'Align top' },
    { action: 'align-elements', value: 'middle-v', iconKey: 'alignObjMiddleV', hint: 'Align middle (vertical)' },
    { action: 'align-elements', value: 'bottom', iconKey: 'alignObjBottom', hint: 'Align bottom' },
  ]);
  for (const b of alignElementsRow.buttons) b.dataset.align = b.dataset.wfpeValue;

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

  // v2.18 — data-wfpe-row identifies these for the [data-multi="true"] CSS
  // gate (20-dom-css.js): per-element X/Y/W/H is ambiguous for a set, so
  // they're hidden outright rather than showing shared-or-Mixed values.
  const positionRow = makeInspectorRow('Position', [fieldX, fieldY]);
  positionRow.dataset.wfpeRow = 'position';
  inspectorBody.appendChild(positionRow);
  const sizeRow = makeInspectorRow('Size', [fieldW, fieldH]);
  sizeRow.dataset.wfpeRow = 'size';
  inspectorBody.appendChild(sizeRow);
  // v2.19 — Align sits where Position/Size would be for a single selection:
  // hidden by default, shown only under [data-multi="true"] (20-dom-css.js
  // CSS gate, no inline JS toggle — same convention as position/size).
  inspectorBody.appendChild(alignElementsRow.row);
  inspectorBody.appendChild(typographyDividerTop);
  inspectorBody.appendChild(fontSizeRow);
  inspectorBody.appendChild(weightRow.row);
  inspectorBody.appendChild(alignRow.row);
  inspectorBody.appendChild(typographyDividerBottom);

  // Colour rows (v2.4). Text colour for text-bearing only; background
  // colour for any selection. Each row composes a swatch (clickable
  // trigger for the hidden native picker), a hex text input, and — for
  // background only — a "transparent" clear button.
  // `label` must fit the 66px label column at 10px/700/0.06em uppercase
  // (~9 chars) — longer strings overflow under the swatch. `pickerHint`
  // carries the full descriptive wording for the swatch tooltip.
  function makeColourRow({ label, pickerHint, target, prop, includeClear }) {
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
    swatch.title = `${pickerHint || label} — pick`;

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
    label: 'Text',
    pickerHint: 'Text colour',
    target: 'text',
    prop: 'textColorHex',
    includeClear: false,
  });
  const bgColourRow = makeColourRow({
    label: 'Fill',
    pickerHint: 'Background colour',
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

  // v2.13 — read-only agent reply line (skipped / needs-input outcomes).
  const annotationReply = document.createElement('div');
  annotationReply.className = 'wfpe-annotation-reply';
  annotationReply.dataset.status = '';
  annotationReply.style.display = 'none';
  annotationRow.appendChild(annotationReply);

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

  // Element action row. Duplicate/delete/reset/front live together to
  // avoid growing the inspector vertically as structural actions are added.
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

  // Reset action (v2.5, reworked 2026-07). Restores the selected element's
  // inline `style` to its pre-edit original (state.originalStyles) as one
  // history entry. Clearing the whole attribute is wrong here: WFP decks
  // author position/size as inline styles, so clearing warped elements to
  // the slide origin. No-op (no history entry) if the editor never
  // changed the element.
  const resetBtn = document.createElement('button');
  resetBtn.type = 'button';
  resetBtn.className = 'wfpe-action-btn wfpe-reset-btn';
  resetBtn.dataset.action = 'reset-styles';
  resetBtn.innerHTML = ICONS.refresh + '<span>Reset</span>';
  resetBtn.title = "Restore the selected element's styles to their state before any edits";
  actionRow.appendChild(resetBtn);

  // Front action (v2.17; scope corrected in v2.17.1). Raises the selection
  // above everything it visually overlaps anywhere in the active slide —
  // climbing to a capping ancestor when one traps the z-index — and verifies
  // the result by paint truth. One-way only: no send-to-back/step controls.
  const frontBtn = document.createElement('button');
  frontBtn.type = 'button';
  frontBtn.className = 'wfpe-action-btn wfpe-front-btn';
  frontBtn.dataset.action = 'bring-to-front';
  frontBtn.innerHTML = ICONS.layers + '<span>Front</span>';
  frontBtn.title = "Bring the selected element in front of everything it overlaps";
  actionRow.appendChild(frontBtn);
  inspectorBody.appendChild(actionRow);

  inspectorDockInner.appendChild(inspector);
  stack.appendChild(inspectorDock);

  // Dimension bubble (v2.2): floating "W × H" chip above the selection
  // ring. Tracks the same lifecycle as the ring.
  const dimBubble = document.createElement('div');
  dimBubble.className = 'wfpe-dim-bubble';
  root.appendChild(dimBubble);

  // Live value tag (v2.12, design 7): coral chip pinned to the selection
  // during a gesture. Content, position, and visibility are owned by the
  // adaptive-fade module (85-adaptive-fade.js).
  const scrubTag = document.createElement('div');
  scrubTag.className = 'wfpe-scrub-tag';
  scrubTag.dataset.show = 'false';
  root.appendChild(scrubTag);

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

  // The both-sides fallback is intentionally faint at rest. Mouse hover and
  // keyboard focus reveal the complete panel before an action can occur.
  // Touch/pen have no reliable pre-contact hover, so their first contact is
  // consumed as an explicit reveal; the second can activate the control.
  let fallbackMouseInside = false;
  let suppressFallbackClick = false;
  let fallbackClickResetTimer = null;
  function isInspectorFallback() {
    return inspector.dataset.avoidance === 'overlap';
  }
  function setInspectorFallbackRevealed(value) {
    inspector.dataset.revealed = value ? 'true' : 'false';
  }
  inspector.addEventListener('pointerenter', (e) => {
    if (e.pointerType !== 'mouse' || !isInspectorFallback()) return;
    fallbackMouseInside = true;
    suppressFallbackClick = false;
    setInspectorFallbackRevealed(true);
  });
  inspector.addEventListener('pointerleave', (e) => {
    if (e.pointerType !== 'mouse') return;
    fallbackMouseInside = false;
    if (!inspector.contains(document.activeElement)) {
      setInspectorFallbackRevealed(false);
    }
  });
  inspector.addEventListener('focusin', () => {
    if (isInspectorFallback()) setInspectorFallbackRevealed(true);
  });
  inspector.addEventListener('focusout', () => {
    queueMicrotask(() => {
      if (
        isInspectorFallback() &&
        !fallbackMouseInside &&
        !inspector.contains(document.activeElement)
      ) {
        setInspectorFallbackRevealed(false);
      }
    });
  });
  inspector.addEventListener('pointerdown', (e) => {
    if (!isInspectorFallback() || inspector.dataset.revealed === 'true') return;
    e.preventDefault();
    e.stopPropagation();
    suppressFallbackClick = true;
    clearTimeout(fallbackClickResetTimer);
    fallbackClickResetTimer = setTimeout(() => {
      suppressFallbackClick = false;
      fallbackClickResetTimer = null;
    }, 400);
    setInspectorFallbackRevealed(true);
  }, true);
  inspector.addEventListener('click', (e) => {
    if (
      !isInspectorFallback() ||
      (!suppressFallbackClick && inspector.dataset.revealed === 'true')
    ) {
      return;
    }
    suppressFallbackClick = false;
    clearTimeout(fallbackClickResetTimer);
    fallbackClickResetTimer = null;
    e.preventDefault();
    e.stopPropagation();
    setInspectorFallbackRevealed(true);
  }, true);
  document.addEventListener('pointerdown', (e) => {
    if (!isInspectorFallback() || inspector.contains(e.target)) return;
    fallbackMouseInside = false;
    suppressFallbackClick = false;
    clearTimeout(fallbackClickResetTimer);
    fallbackClickResetTimer = null;
    setInspectorFallbackRevealed(false);
  }, true);

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
  // v2.11 — export action menu (4b rows, 5b docking). Opened by the Export
  // button; row 1 is the primary save action (Enter / Cmd+S), row 2 is the
  // legacy clean-copy download.
  //
  // Seam bookkeeping (5b): the toolbar squares its bottom corners while ANY
  // segment is docked below it; the menu keeps a straight 6px top always and
  // rounds its bottom only when it is the LAST segment (no inspector below);
  // the inspector dims + folds to its header while the menu is open.
  function refreshStackSeams() {
    const inspectorVisible = inspectorDock.dataset.visible === 'true';
    toolbar.dataset.docked = String(state.exportMenuOpen || state.notesPanelOpen || inspectorVisible);
    exportMenu.dataset.abovePanel = String(state.notesPanelOpen || inspectorVisible);
    // v2.21 — the notes panel rounds its bottom only while it is the last
    // visible segment. Only the inspector matters here: the export dock
    // sits ABOVE the notes dock, and the two middle segments are mutually
    // exclusive (openNotesPanel/openExportMenu close each other) — if that
    // exclusivity is ever relaxed, revisit this.
    notesPanel.dataset.last = String(!inspectorVisible);
    inspector.dataset.suppressed = String(state.exportMenuOpen && inspectorVisible);
    positionInspectorStack();
  }
  function openExportMenu() {
    state.exportMenuOpen = true;
    closeNotesPanel(); // one middle segment at a time; no-op when closed
    exportDock.dataset.visible = 'true';
    exportMenu.dataset.open = 'true'; // stable hook for tests
    exportBtn.setAttribute('aria-expanded', 'true');
    refreshStackSeams();
    refreshExportUi();
  }
  // v2.21 — notes-panel fold. Unlike the export menu this is a browsing
  // surface, not a menu: it deliberately does NOT close on click-away —
  // only the toolbar toggle, its × button, or Escape dismiss it.
  function openNotesPanel() {
    state.notesPanelOpen = true;
    closeExportMenu(); // one middle segment at a time; no-op when closed
    notesDock.dataset.visible = 'true';
    notesPanel.dataset.open = 'true'; // stable hook for tests
    notesBtn.setAttribute('aria-expanded', 'true');
    // Full fan-out (badges + card render), not just renderNotesPanel():
    // matches openExportMenu, so counts are honest even when annotation
    // attributes changed outside the save path (e.g. agent reimport).
    refreshExportUi();
    refreshStackSeams();
  }
  function closeNotesPanel() {
    state.notesPanelOpen = false;
    notesDock.dataset.visible = 'false';
    notesPanel.dataset.open = 'false';
    notesBtn.setAttribute('aria-expanded', 'false');
    refreshStackSeams();
  }
  function closeExportMenu() {
    state.exportMenuOpen = false;
    exportDock.dataset.visible = 'false';
    exportMenu.dataset.open = 'false';
    exportBtn.setAttribute('aria-expanded', 'false');
    refreshStackSeams();
  }
  // Single dispatcher for menu row 1, Enter-while-open, and Cmd/Ctrl+S.
  // Task 2: save-in-place is primary; legacy download is the Safari/Firefox
  // fallback when the File System Access API isn't available. saveInPlace()
  // is deliberately not awaited here — this fires from a click/keydown
  // handler and must call the native picker within the same user gesture.
  function triggerPrimaryExport() {
    closeExportMenu();
    // v2.22 — in Markdown mode the host owns persistence: it splices the
    // notes back into the original Markdown. Writing HTML here would put
    // markup into the user's .md file, so the sink fully replaces export.
    if (state.markdownMode && typeof window.__wfpMarkdownSink === 'function') {
      window.__wfpMarkdownSink();
      return;
    }
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
  // The suppressed inspector is excluded: closing here on mousedown would
  // race its header chevron's click handler (mousedown fires first), which
  // has its own dismiss-the-menu behaviour (5b).
  document.addEventListener(
    'mousedown',
    (e) => {
      if (!state.exportMenuOpen) return;
      if (
        exportMenu.contains(e.target) ||
        exportBtn.contains(e.target) ||
        inspectorDock.contains(e.target)
      ) {
        return;
      }
      closeExportMenu();
    },
    true,
  );
  overviewBtn.addEventListener('click', (e) => {
    e.preventDefault();
    if (isFlatMode()) return;
    setOverviewMode(!state.overviewMode);
  });
  // v2.21 — notes-panel wiring. Cards are rebuilt wholesale by
  // renderNotesPanel(), so clicks are delegated from the stable list node.
  notesBtn.addEventListener('click', (e) => {
    e.preventDefault();
    if (state.notesPanelOpen) closeNotesPanel();
    else openNotesPanel();
  });
  notesPrevBtn.addEventListener('click', (e) => {
    e.preventDefault();
    cycleAnnotation(-1);
  });
  notesNextBtn.addEventListener('click', (e) => {
    e.preventDefault();
    cycleAnnotation(1);
  });
  notesCloseBtn.addEventListener('click', (e) => {
    e.preventDefault();
    closeNotesPanel();
  });
  notesList.addEventListener('click', (e) => {
    const card = e.target.closest('.wfpe-notes-card');
    if (!card) return;
    e.preventDefault();
    jumpToAnnotation(card.dataset.annotationId);
  });
  inspectorMinimiseBtn.addEventListener('click', (e) => {
    e.preventDefault();
    // 5b: while the export menu suppresses the inspector, the header
    // chevron reads as "restore" — it dismisses the menu, not the panel.
    if (state.exportMenuOpen) {
      closeExportMenu();
      return;
    }
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
        // Revert by repopulating from the live element(s), then blur. The
        // revertingInput flag suppresses the blur's commit so the no-op
        // path stays explicit rather than implicit-via-equality.
        //
        // v2.18 code review (W3) — was an unconditional
        // populateInspector(state.selected), which repaints the SINGLE-
        // selection surface (Duplicate/Delete enabled, geometry rows
        // shown) over a live multi-selection until the next tracking
        // tick quietly repairs it. Route through the same multi/single
        // split every other repopulate call site uses.
        revertingInput = input;
        if (hasMultiSelection()) populateInspectorMulti(getSelectedElements());
        else populateInspector(state.selected);
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
  function commitSegStyle(styleProp, value, tagLabel) {
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
    // v2.12 — the reflow is what the user wants to see; no-op clicks
    // returned above and don't blip.
    liveEditBlip(tagLabel);
    refreshSelection();
  }
  for (const b of weightRow.buttons) {
    b.addEventListener('click', (e) => {
      e.preventDefault();
      commitSegStyle('fontWeight', b.dataset.wfpeValue, b.textContent);
    });
  }
  for (const b of alignRow.buttons) {
    b.addEventListener('click', (e) => {
      e.preventDefault();
      const v = b.dataset.wfpeValue;
      commitSegStyle('textAlign', v, v.charAt(0).toUpperCase() + v.slice(1));
    });
  }

  // Opacity slider — same one-entry-per-drag contract as font-size. Mouse
  // interaction opens the history session on mousedown, before any `input`
  // fires, and closes it immediately on mouseup/change — unchanged.
  // Keyboard interaction (focus + arrow keys) never fires mousedown, so
  // `input` used to find no open session and bail out entirely: the
  // native thumb moved but opacity never changed, and the next repopulate
  // snapped the thumb back. `input` now opens a session lazily when none
  // is open.
  //
  // Unlike a mouse drag, a native <input type=range> fires `change`
  // immediately after EVERY keyboard-driven `input` — including every
  // step of OS key auto-repeat while an arrow key is held (verified
  // directly against Chromium: a held key produces one input+change pair
  // per repeat tick, not one trailing change at release). Closing on
  // `change` the way mouse does would turn one held-key gesture into
  // dozens of history entries and evict unrelated older undo state
  // (HISTORY_MAX, 00-preamble.js) well before the user lets go. A
  // lazily-opened (keyboard) session therefore settles instead of closing
  // immediately: `change` arms a short timer — the same "wait for the
  // gesture to actually stop" shape as the adaptive-fade restore
  // (FADE_RESTORE_MS, 85-adaptive-fade.js) — that closes the session only
  // once no further input arrives, so a whole burst of presses, held or
  // not, lands as one entry, same as a mouse drag. Losing focus flushes it
  // immediately instead of waiting out the timer.
  //
  // Holding state.txn open for that settle window is only safe because it
  // is registered with 50-history.js's pending-txn-flush mechanism for
  // exactly as long as the timer is armed: any OTHER gesture that opens a
  // transaction while the window is open (a drag, a text edit, another
  // inspector commit) forces this session to finalize as its own history
  // entry FIRST, so it can never silently absorb an unrelated change or
  // swallow another beginTxn() call's own options (e.g. captureHtml).
  const OPACITY_KEYBOARD_SETTLE_MS = 380;
  // v2.18 code review (C1) — was a single `opacitySliderTarget` element, so
  // a slider DRAG under a multi-selection wrote only state.selected: the
  // dock would then repopulate "Mixed" for the other member(s) right after
  // a gesture that visually claimed to edit the whole set. Generalised to
  // the member array captured at session-open; the typed-value path
  // (commitOpacityMulti, 40-helpers-selection-inspector.js) was already
  // correct — this brings the slider's live-drag path to the same scope.
  let opacitySliderMembers = null;
  let opacitySliderRestoreCtx = null;
  let opacitySliderOwnedTxn = null; // identity guard for the deferred keyboard close, below
  let opacitySliderKeyboardSession = false;
  let opacitySliderSettleTimer = null;
  function beginOpacitySession(members, { keyboard = false } = {}) {
    opacitySliderMembers = members;
    opacitySliderRestoreCtx = startInspectorTxn();
    for (const el of members) touchElement(el);
    opacitySliderOwnedTxn = state.txn;
    opacitySliderKeyboardSession = keyboard;
  }
  function closeOpacitySession() {
    // Unregister first and unconditionally: this is also the pending-txn-
    // flush hook itself (see below), so it must be safe to call whether it
    // fires from our own timer, from an external flush, or from a direct
    // mouse/blur close — and must never leave a stale registration behind.
    unregisterPendingTxnFlush(closeOpacitySession);
    clearTimeout(opacitySliderSettleTimer);
    opacitySliderSettleTimer = null;
    if (!opacitySliderMembers) return;
    opacitySliderMembers = null;
    opacitySliderKeyboardSession = false;
    const owned = opacitySliderOwnedTxn;
    opacitySliderOwnedTxn = null;
    const ctx = opacitySliderRestoreCtx;
    opacitySliderRestoreCtx = null;
    // Something else (most plausibly a selection change while a keyboard
    // settle timer was pending) may already have closed/replaced the
    // shared txn slot — only end the one this session actually opened.
    if (state.txn === owned) endInspectorTxn(ctx);
    liveEditEnd();
  }
  opacitySlider.addEventListener('mousedown', () => {
    const members = getSelectedElements();
    if (!members.length) return;
    clearTimeout(opacitySliderSettleTimer);
    opacitySliderSettleTimer = null;
    beginOpacitySession(members);
  });
  opacitySlider.addEventListener('input', () => {
    clearTimeout(opacitySliderSettleTimer);
    opacitySliderSettleTimer = null;
    const currentMembers = getSelectedElements();
    if (opacitySliderMembers && !selectionArraysEqual(opacitySliderMembers, currentMembers)) {
      // An earlier session — most often an orphaned mouse drag whose
      // mouseup never reached us (button released outside the window), or
      // a selection change mid-drag — never closed before membership
      // moved on. Close it out for real (a harmless no-op if it captured
      // no change) instead of silently continuing to apply values to a
      // stale member set.
      closeOpacitySession();
    }
    if (!opacitySliderMembers) {
      if (!currentMembers.length) return;
      beginOpacitySession(currentMembers, { keyboard: true });
    }
    const members = opacitySliderMembers;
    const pct = Math.max(0, Math.min(100, parseFloat(opacitySlider.value)));
    for (const el of members) el.style.opacity = String(pct / 100);
    if (members.length > 1) populateOpacityMulti(members);
    else populateOpacity(members[0]);
    // v2.12 — bounded control keeps its slider; each tick refreshes the
    // tag/fade, and the restore is anchored to true drag-end below so a
    // mid-drag pause can't flicker the chrome back in.
    liveEditUpdate(`${Math.round(pct)} %`);
  });
  const endOpacityDrag = () => {
    if (!opacitySliderMembers) return;
    if (opacitySliderKeyboardSession) {
      clearTimeout(opacitySliderSettleTimer);
      opacitySliderSettleTimer = setTimeout(closeOpacitySession, OPACITY_KEYBOARD_SETTLE_MS);
      // Pending until the timer fires or something else needs the txn
      // slot first — closeOpacitySession() unregisters itself either way.
      registerPendingTxnFlush(closeOpacitySession);
      return;
    }
    closeOpacitySession();
  };
  opacitySlider.addEventListener('mouseup', endOpacityDrag);
  opacitySlider.addEventListener('change', endOpacityDrag);
  opacitySlider.addEventListener('blur', closeOpacitySession);
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
      const norm = parseHexInput(colorInput.value);
      if (!norm) return;
      // v2.18 — colour swatches apply to every selected member, no
      // isTextBearing gate (unlike font size): setting `color` on a
      // non-text element is inert, not wrong, so it isn't worth skipping.
      if (hasMultiSelection()) {
        const members = getSelectedElements();
        if (!pickerSession[target].open) {
          pickerSession[target].open = true;
          pickerSession[target].inlineSpan = null;
          pickerSession[target].restoreCtx = startInspectorTxn();
          for (const el of members) touchElement(el);
        }
        for (const el of members) applyColorToElement(el, target, norm);
        populateColoursMulti(members);
        return;
      }
      const el = state.selected;
      if (!el) return;
      if (target === 'text' && !isTextBearing(el)) return;
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
        // v2.18 code review (W3) — same multi/single split as the numeric
        // fields' Escape handler above.
        revertingInput = hexInput;
        if (hasMultiSelection()) populateColoursMulti(getSelectedElements());
        else populateColours(state.selected);
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
        const cssProp = target === 'text' ? 'color' : 'backgroundColor';
        if (hasMultiSelection()) {
          const members = getSelectedElements().filter((el) => !!el.style[cssProp]);
          if (!members.length) return;
          const ctx = startInspectorTxn();
          for (const el of members) {
            touchElement(el);
            el.style[cssProp] = '';
          }
          endInspectorTxn(ctx);
          populateColoursMulti(getSelectedElements());
          return;
        }
        const el = state.selected;
        if (!el) return;
        // Only meaningful if there's an inline colour to clear.
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
    autoGrowAnnotationTextarea();
    updateAnnotationDraftStatus(getAnnotationEditorTarget());
    positionInspectorStack();
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

  // Reset restores an ordinary element's pre-edit inline style as one
  // history entry. A flow-unlocked element delegates to its recorded unlock
  // group so untouched mechanical pins and their freeze markers can return
  // to the pre-unlock state in that same entry. Later deliberate sibling
  // edits are retained; any container they still depend on stays pinned.
  // No original/group record means the editor never touched the element, so
  // an idle click cannot mutate it or push a no-op entry.
  // v2.18 — getSelectedElements() covers both single and multi selection
  // (it returns [state.selected] for a single selection), so one loop
  // inside one txn serves both: every touched member restores together
  // and undoes together. The no-op guard stays per-member (skip anything
  // the editor never touched) via the `restorable` filter below.
  resetBtn.addEventListener('click', (e) => {
    e.preventDefault();
    const targets = getSelectedElements();
    if (!targets.length) return;
    const restorable = targets.filter((el) => getActiveFlowUnlockGroup(el) || state.originalStyles.has(el));
    if (!restorable.length) return; // none of the targets were ever edited
    const ctx = startInspectorTxn();
    for (const el of restorable) {
      const unlockGroup = getActiveFlowUnlockGroup(el);
      if (unlockGroup) {
        restoreFlowUnlockGroup(unlockGroup, el);
      } else {
        const original = state.originalStyles.get(el);
        touchElement(el);
        if (original === null) el.removeAttribute('style');
        else el.setAttribute('style', original);
      }
    }
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
  // Guarded before the txn opens (no selection, or every target already
  // paints above its competitors and already meets its planned z) so an
  // idle/repeat click pushes no history entry and inflates no z-index. The
  // plan — competitor sets included — is computed once and reused for the
  // guard, the writes and the post-write verification.
  frontBtn.addEventListener('click', (e) => {
    e.preventDefault();
    const targets = getSelectedElements();
    if (!targets.length) return;
    const plan = computeFrontPlan(targets);
    if (!plan || isFrontPlanNoop(plan)) return;
    const ctx = startInspectorTxn();
    applyFrontPlan(plan);
    endInspectorTxn(ctx);
    refreshSelection();
  });
  // v2.19 — Align: one click = one plan = one txn (applyAlignPlan owns the
  // guard, the unlock, and the txn; see 40-helpers-selection-inspector.js).
  // Row is CSS-gated to multi mode, but the length guard stays defensive
  // (mirrors the reset/front handlers) in case a stale click ever lands
  // outside it.
  for (const b of alignElementsRow.buttons) {
    b.addEventListener('click', (e) => {
      e.preventDefault();
      const members = getSelectedElements();
      if (members.length < 2) return;
      const plan = computeAlignPlan(b.dataset.align, members);
      if (!applyAlignPlan(plan)) return;
      refreshSelection();
    });
  }
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
      (
        inspectorDock.dataset.visible === 'true' &&
        isPointInsideElementBox(inspector, e.clientX, e.clientY)
      )
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
    // v2.22 — Markdown mode reduces the surface to what a Markdown file can
    // actually represent: annotations and text. Every geometry control writes
    // an inline style with no Markdown equivalent, so the rows are gated off
    // in CSS (same mechanism as v2.18's data-multi) rather than left to write
    // changes the writeback would silently discard.
    if (state.markdownMode) {
      inspectorDock.dataset.md = 'true';
      root.dataset.md = 'true';
    }
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

  // ---------------------------------------------------------------------------
  // Bring to front (v2.17; stacking scope corrected in v2.17.1).
  //
  // v2.17 derived the required z from the target's SIBLINGS. That model is
  // wrong: z-order competes inside the nearest stacking-context ancestor, and
  // every intermediate stacking context caps what a descendant's z-index can
  // reach. On real decks Front therefore did nothing whenever the overlapping
  // element lived in another container (its container's z is what has to be
  // beaten), or whenever an ancestor of the target carried a transform (WFP
  // entrance animations do this constantly), which traps any z we write.
  //
  // So: the scope is the whole active slide — anything whose box actually
  // overlaps the target competes with it, wherever it sits in the tree — and
  // the result is checked against paint truth (elementsFromPoint) rather than
  // inferred from z values, because a capping ancestor can make a perfectly
  // correct z-index irrelevant.
  //
  // All rects here are viewport rects compared against other viewport rects,
  // and none of them is ever written back as a style value, so the deck's
  // transform: scale() never enters the maths (scale division applies only
  // when converting pointer deltas into slide pixels — this feature does no
  // such conversion).
  // ---------------------------------------------------------------------------
  // z-index is inert while position is static — the used value never
  // applies, so it must read as 0 both when this element IS the target
  // (an authored-but-inert z-index must not falsely look "already front")
  // and when it's a competitor being folded into the required max (an inert
  // z-index there must not inflate the plan).
  function effectiveZIndex(el) {
    if (getComputedStyle(el).position === 'static') return 0;
    const z = parseInt(getComputedStyle(el).zIndex, 10);
    return Number.isFinite(z) ? z : 0; // auto (or garbage) reads as 0
  }

  // The z a competitor really defends is the highest one on its ancestor
  // chain, not its own: an ancestor's z-index carries its whole subtree, so a
  // z:auto element inside a z-index:5 container beats a z-index:1 element
  // outside it. Walk up to (but not including) the slide.
  function chainMaxZIndex(el, slide) {
    let max = 0;
    let node = el;
    while (node && node !== slide && slide.contains(node)) {
      max = Math.max(max, effectiveZIndex(node));
      node = node.parentElement;
    }
    return max;
  }

  function rectsOverlap(a, b) {
    return (
      Math.max(a.left, b.left) < Math.min(a.right, b.right) &&
      Math.max(a.top, b.top) < Math.min(a.bottom, b.bottom)
    );
  }

  // Everything in the slide that visually overlaps `el`, minus the things it
  // makes no sense to compete with: editor chrome, anything that paints
  // nothing (a zero-area rect — wrapper divs whose children are all
  // absolutely positioned are the common case), and anything related by
  // containment to a target of this plan in either direction.
  //
  // "Either direction" is load-bearing. Descendants ride with their target,
  // and ancestors contain it — but the ancestors of a CO-target matter too:
  // the climb may raise one, and if it then counted as a competitor of
  // another target in the same plan, the next click would fold our own write
  // back into `required` and inflate the whole group ({3,4} -> {4,5} -> …).
  // Nothing is lost by dropping them, because whatever else lives inside
  // such an ancestor is still a competitor and still reports the ancestor's
  // z through chainMaxZIndex.
  function frontCompetitorsFor(el, targets, slide) {
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return [];
    const out = [];
    for (const node of slide.querySelectorAll('*')) {
      if (isInsideEditorRoot(node)) continue;
      if (targets.some((t) => t === node || t.contains(node) || node.contains(t))) continue;
      const nodeRect = node.getBoundingClientRect();
      if (nodeRect.width <= 0 || nodeRect.height <= 0) continue;
      if (!rectsOverlap(rect, nodeRect)) continue;
      out.push(node);
    }
    return out;
  }

  // Centre plus the four quarter points of the overlap. A lone centre sample
  // is easy to fool — a partial overlap, or a competitor whose middle is a
  // hole punched by a positioned child, both read as "not covered".
  function overlapSamplePoints(a, b) {
    const left = Math.max(a.left, b.left);
    const right = Math.min(a.right, b.right);
    const top = Math.max(a.top, b.top);
    const bottom = Math.min(a.bottom, b.bottom);
    if (right <= left || bottom <= top) return [];
    const w = right - left;
    const h = bottom - top;
    return [
      { x: left + w / 2, y: top + h / 2 },
      { x: left + w / 4, y: top + h / 4 },
      { x: left + (w * 3) / 4, y: top + h / 4 },
      { x: left + w / 4, y: top + (h * 3) / 4 },
      { x: left + (w * 3) / 4, y: top + (h * 3) / 4 },
    ];
  }

  // Paint truth for one target/competitor pair. elementsFromPoint returns the
  // hit stack topmost-first, so whichever of the two shows up first is the
  // one actually painting on top; anything else at that point (a third
  // element, another co-target) is skipped rather than counted as a loss.
  //
  // Known blind spot, accepted: elements with pointer-events: none are
  // invisible to hit testing (the editor's own ring depends on that). We do
  // not try to compensate.
  function competitorPaintsAbove(target, competitor, points) {
    for (const point of points) {
      for (const node of document.elementsFromPoint(point.x, point.y)) {
        if (isInsideEditorRoot(node)) continue;
        if (node === target || target.contains(node)) break; // target wins here
        if (node === competitor || competitor.contains(node)) return true;
      }
    }
    return false;
  }

  function isTargetOccluded(el, competitors) {
    const rect = el.getBoundingClientRect();
    for (const competitor of competitors) {
      const points = overlapSamplePoints(rect, competitor.getBoundingClientRect());
      if (!points.length) continue;
      if (competitorPaintsAbove(el, competitor, points)) return true;
    }
    return false;
  }

  // Pragmatic stacking-context test: the cases that actually occur in slide
  // decks, not the full CSS list. Missing a real stacking context means the
  // climb skips past the ancestor that was actually capping us and raises a
  // larger subtree than necessary (or fails to resolve at all), so the list
  // errs towards including the common triggers.
  function establishesStackingContext(el) {
    const cs = getComputedStyle(el);
    if (cs.position !== 'static' && cs.zIndex !== 'auto') return true;
    if (cs.position === 'fixed' || cs.position === 'sticky') return true;
    if (cs.transform !== 'none' || cs.filter !== 'none' || cs.perspective !== 'none') return true;
    if (cs.clipPath && cs.clipPath !== 'none') return true;
    if (parseFloat(cs.opacity) < 1) return true;
    if (/transform|opacity/.test(cs.willChange || '')) return true;
    if (cs.isolation === 'isolate') return true;
    if (cs.mixBlendMode && cs.mixBlendMode !== 'normal') return true;
    if (/\b(layout|paint|strict|content)\b/.test(cs.contain || '')) return true;
    return false;
  }

  // Is `cs` a containing block for absolutely-positioned descendants? Only
  // relevant for elements that are position: static, where the answer decides
  // whether we may promote them (see canRaiseAncestor).
  function establishesAbsoluteContainingBlock(cs) {
    return (
      cs.transform !== 'none' ||
      cs.filter !== 'none' ||
      cs.perspective !== 'none' ||
      /transform|perspective|filter/.test(cs.willChange || '') ||
      /\b(layout|paint|strict|content)\b/.test(cs.contain || '')
    );
  }

  // "position: relative costs nothing" holds for an element's own box — it is
  // why the static fix-up on the TARGET is safe — but not for its subtree. A
  // static ancestor we promote becomes the containing block for every
  // absolutely-positioned descendant that used to resolve against something
  // further up, and they all jump. That is a silent relayout of the deck,
  // exported along with everything else, so we refuse: the dangerous set is
  // precisely the stacking-context triggers that are NOT also containing-block
  // triggers (opacity < 1, isolation, mix-blend-mode, will-change: opacity).
  // Leaving an occlusion unresolved is much cheaper than moving content, so
  // the climb skips such an ancestor and carries on outwards.
  function canRaiseAncestor(el) {
    const cs = getComputedStyle(el);
    if (cs.position !== 'static') return true;
    return establishesAbsoluteContainingBlock(cs);
  }

  // Nearest-first, strictly below the slide. Captured BEFORE any write:
  // raising an ancestor turns it into a stacking context itself, which would
  // otherwise grow the very chain we are walking.
  function stackingContextAncestors(el, slide) {
    const chain = [];
    let node = el.parentElement;
    while (node && node !== slide && slide.contains(node)) {
      if (establishesStackingContext(node)) chain.push(node);
      node = node.parentElement;
    }
    return chain;
  }

  // DOM-order tiebreak for equal effective z: the element that comes later
  // in the document currently paints on top, so it sorts after — a bump
  // then preserves that relative order instead of collapsing ties.
  function compareStackOrder(a, b) {
    const za = effectiveZIndex(a);
    const zb = effectiveZIndex(b);
    if (za !== zb) return za - zb;
    const position = a.compareDocumentPosition(b);
    return position & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
  }

  // One shared counter above the highest z any competitor defends, assigned
  // in current-stack order so a multi-select bump keeps the targets' relative
  // order (required + 1, required + 2, …) instead of tying them.
  //
  // Multi-target input is reachable through the UI as of v2.18 — the
  // inspector dock now renders (with a reduced control surface) for any
  // selection of one or more elements, not just exactly one, so a real
  // pointer click on the Front button can land during a multi-selection.
  // Tests drive a real click accordingly (tests/v2-17-bring-to-front.spec.js,
  // tests/v2-18-multi-select-inspector.spec.js).
  function computeFrontPlan(elements) {
    const slide = getActiveSlide();
    if (!slide) return null;
    const scoped = [...elements].filter((el) => el && el.isConnected && slide.contains(el));
    if (!scoped.length) return null;
    const ordered = scoped.sort(compareStackOrder);
    let required = 0;
    const entries = ordered.map((el) => {
      const competitors = frontCompetitorsFor(el, ordered, slide);
      for (const competitor of competitors) {
        required = Math.max(required, chainMaxZIndex(competitor, slide));
      }
      return { el, competitors, z: 0 };
    });
    entries.forEach((entry, i) => { entry.z = required + 1 + i; });
    return { slide, entries };
  }

  // No-op guard (v2.17.1: paint truth, not a z comparison). An element can
  // carry a huge z-index and still be buried, because a capping ancestor
  // swallows it — so "already high enough" is not evidence of anything and
  // the sampling has to run first.
  //
  // The planned-z check is kept as a second, independent condition: an
  // element with no overlapping competitor at all is trivially "painting
  // above all of them", and Front on it should still do the obvious thing
  // (give it an explicit z-index) rather than silently nothing. Both
  // conditions must hold for a click to be dropped, which is what keeps
  // repeated clicks from inflating z or pushing history entries.
  function isFrontPlanNoop(plan) {
    return plan.entries.every(({ el, z, competitors }) => (
      effectiveZIndex(el) >= z && !isTargetOccluded(el, competitors)
    ));
  }

  // z-index is inert on position: static, so a raised element is promoted to
  // position: relative first — no offsets are written, so the element's own
  // box does not move. (Its abs-positioned DESCENDANTS can re-anchor, which
  // is why ancestors go through canRaiseAncestor first; on the target itself
  // this is the long-standing v2.17 fix-up.) Never demotes: an element
  // already sitting above the requested z keeps it. touchElement() must run
  // before either write lands.
  function raiseElementZIndex(el, z) {
    if (effectiveZIndex(el) >= z) return;
    touchElement(el);
    if (getComputedStyle(el).position === 'static') el.style.position = 'relative';
    el.style.zIndex = String(z);
  }

  // Verify and climb. A correct z-index is inert inside a capping ancestor
  // (transform, opacity < 1, an own z-index, …), so when the target still
  // paints below a competitor we raise the nearest such ancestor as well,
  // then the next one out, re-checking after each step.
  //
  // Raising a container carries its whole subtree forward. That is
  // unavoidable — it is precisely what "in front" means for a nested
  // element — and it is why we climb only as far as the occlusion needs.
  //
  // v2.18.1 (C1) — that carry is also why ONE sequential sweep does not
  // converge: the subtree a later target's climb brings forward contains
  // NON-target elements, which can bury an earlier target the same sweep had
  // already verified as front-most. Nothing looked back, so the click ended
  // with a target still behind and only a SECOND click (pushing a second
  // history entry) finished the job. The sweep therefore runs in passes —
  // re-verify every target, climb whoever is still occluded — and a pass has
  // to strictly SHRINK the occluded set to earn another. That one rule does
  // both jobs: it caps the loop at one pass per target, and it stops dead on
  // the shapes no amount of climbing can fix (a refused static ancestor;
  // containers that occlude each other mutually), so nothing is spent
  // inflating z on them and their repeat clicks stay silent.
  //
  // A retry needs a HIGHER z than the plan asked for: the per-ancestor dedupe
  // keeps the highest request seen for each ancestor, so replaying a target's
  // original z is refused as already-satisfied and the pass spins. Passes
  // after the first therefore re-plan every target from a base above
  // everything this apply has put into play (`ceiling`), keeping the plan's
  // index order — base + 1 + i, all targets moving together — so the retry is
  // deterministic and the z assignment never inverts.
  //
  // Repeat clicks then settle: every z a later plan can derive from a
  // competitor's chain is one this apply wrote, so the next `required` lands
  // at or below `ceiling` and each target already sits at or above its
  // recomputed required + 1 + i. The guard drops that click, and the writes
  // would be snapshot-equal anyway, so endTxn() pushes nothing. That argument
  // assumes the occlusion sampling sees everything; where it is blind by
  // design (the brief's accepted pointer-events: none case) a shape can still
  // cost one extra click before it settles — it does settle.
  function applyFrontPlan(plan) {
    const chains = new Map();
    for (const { el } of plan.entries) {
      chains.set(el, stackingContextAncestors(el, plan.slide));
    }

    // Planned z per target, kept out of `plan` so the plan stays the
    // immutable value object the guard already read.
    const zFor = new Map(plan.entries.map((entry) => [entry.el, entry.z]));

    // The highest z this apply has put into play — the base a retry has to
    // clear. Read back from the element rather than from the request, since
    // raiseElementZIndex never demotes: an element authored above the plan
    // keeps its own (higher) value, and that is what competitors now face.
    let ceiling = 0;
    function raise(el, z) {
      raiseElementZIndex(el, z);
      ceiling = Math.max(ceiling, effectiveZIndex(el));
    }

    function applyTargetZIndexes() {
      for (const { el } of plan.entries) raise(el, zFor.get(el));
    }

    // Dedupe across targets by keeping the highest request per ancestor; the
    // climb still advances either way, so a shared ancestor can't stall it.
    const raisedAncestors = new Map();
    function climb(entry) {
      const z = zFor.get(entry.el);
      for (const ancestor of chains.get(entry.el)) {
        if (!canRaiseAncestor(ancestor)) continue;
        if ((raisedAncestors.get(ancestor) || 0) < z) {
          raisedAncestors.set(ancestor, z);
          raise(ancestor, z);
        }
        if (!isTargetOccluded(entry.el, entry.competitors)) return;
      }
    }

    applyTargetZIndexes();

    // The shrink rule already bounds this at one pass per target; the counter
    // is a backstop, not the argument.
    let remaining = Infinity;
    for (let pass = 0; pass <= plan.entries.length; pass += 1) {
      const occluded = plan.entries.filter(
        ({ el, competitors }) => isTargetOccluded(el, competitors),
      );
      if (!occluded.length) break;
      if (occluded.length >= remaining) break; // no progress: stop, don't escalate
      remaining = occluded.length;
      if (pass > 0) {
        const base = ceiling;
        plan.entries.forEach((entry, i) => { zFor.set(entry.el, base + 1 + i); });
        applyTargetZIndexes();
      }
      for (const entry of occluded) {
        // An earlier climb in this same pass may already have freed this one.
        if (!isTargetOccluded(entry.el, entry.competitors)) continue;
        climb(entry);
      }
    }
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

  function autoGrowAnnotationTextarea() {
    const minHeight = 52;
    // The textarea has a content cap; viewport pressure is handled by the
    // inspector body's live `100vh` scroll bound rather than a guessed
    // subtraction that cannot account for agent-reply blocks.
    const maxHeight = 112;
    annotationTextarea.style.height = 'auto';
    // scrollHeight excludes the border while height is border-box; include
    // the 1px top/bottom borders so the last line is never clipped by 2px.
    const naturalHeight = Math.max(minHeight, annotationTextarea.scrollHeight + 2);
    const nextHeight = Math.min(maxHeight, naturalHeight);
    annotationTextarea.style.height = `${nextHeight}px`;
    annotationTextarea.style.overflowY = naturalHeight > nextHeight ? 'auto' : 'hidden';
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
    // Fixed-layer equivalent of the 6b reference's in-element anchor
    // (top: -6, right: -6 on a 13px dot): the dot straddles the element's
    // top-right corner, pushed 6px out on both axes.
    const markerWidth = 13;
    const markerHeight = 13;
    const left = Math.max(4, Math.min(window.innerWidth - markerWidth - 4, rect.right - markerWidth + 6));
    const preferredTop = rect.top - 6;
    const top = preferredTop >= 4 ? preferredTop : Math.min(window.innerHeight - markerHeight - 4, rect.top + 4);
    marker.style.left = `${left}px`;
    marker.style.top = `${Math.max(4, top)}px`;
  }

  // All elements bearing a saved annotation, regardless of current
  // visibility (has a note, but not necessarily connected / on the active
  // slide / on screen). getAnnotatedElements(document) is the expensive
  // part — a document-wide attribute query — and refreshAnnotationMarkers()
  // below is the only place that re-runs it, caching the unfiltered result
  // on state.annotatedElementsCache (see 10-state.js for why it lives on
  // state rather than a module let) so the idle selection-tracking tick
  // (further down) never queries the document itself; it just re-checks
  // each already-known element's current visibility and rect.
  function refreshAnnotationMarkers() {
    if (!annotationLayer) return;
    if (!state.editMode || state.overviewMode) {
      annotationLayer.replaceChildren();
      state.annotatedElementsCache = [];
      return;
    }
    const activeSlide = getActiveSlide();
    state.annotatedElementsCache = getAnnotatedElements(document);
    const annotated = state.annotatedElementsCache.filter((el) => isAnnotationMarkerVisibleFor(el, activeSlide));
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
      const status = el.getAttribute(ANNOTATION_STATUS_ATTR);
      if (status) marker.dataset.status = status;
      else delete marker.dataset.status;
      marker.textContent = '';
      const reply = normalizeAnnotationText(el.getAttribute(ANNOTATION_REPLY_ATTR));
      marker.title = reply ? `${getAnnotationText(el)} — Agent: ${reply}` : getAnnotationText(el);
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
    // A changed or deleted instruction supersedes the agent's reply to the
    // old one (v2.13). Same transaction, so undo restores them together.
    el.removeAttribute(ANNOTATION_STATUS_ATTR);
    el.removeAttribute(ANNOTATION_REPLY_ATTR);
    endInspectorTxn(ctx);
    populateAnnotation(el, { force: true });
    refreshExportUi();
    // refreshExportUi() -> refreshAnnotationMarkers() just refreshed
    // annotatedElementsCache; recapture the idle-tracking baseline now so
    // the new/changed annotation is tracked immediately rather than only
    // after the next unrelated full refresh.
    startSelectionTracking();
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
    el.removeAttribute(ANNOTATION_STATUS_ATTR);
    el.removeAttribute(ANNOTATION_REPLY_ATTR);
    endInspectorTxn(ctx);
    populateAnnotation(el, { force: true });
    refreshExportUi();
    startSelectionTracking(); // keep the idle-tracking baseline current — see saveAnnotation
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
      renderAnnotationReply(null);
      autoGrowAnnotationTextarea();
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
    autoGrowAnnotationTextarea();
    annotationDeleteBtn.disabled = !hasAnnotation(el);
    updateAnnotationDraftStatus(el);
    renderAnnotationReply(el);
    positionInspectorStack();
  }

  // Read-only "Agent …" line under the note textarea (v2.13): shows the
  // agent's reply for skipped / needs-input notes, hidden otherwise.
  function renderAnnotationReply(el) {
    const status = el ? (el.getAttribute(ANNOTATION_STATUS_ATTR) || '') : '';
    if (!status) {
      annotationReply.textContent = '';
      annotationReply.dataset.status = '';
      annotationReply.style.display = 'none';
      return;
    }
    const label = status === 'needs-input' ? 'Agent needs input' : 'Agent skipped';
    const reply = normalizeAnnotationText(el.getAttribute(ANNOTATION_REPLY_ATTR));
    annotationReply.textContent = reply ? `${label}: ${reply}` : `${label}.`;
    annotationReply.dataset.status = status;
    annotationReply.style.display = '';
  }

  function refreshExportUi() {
    const count = getAnnotatedElements(document).length;
    exportBadge.dataset.count = String(count);
    exportBadge.textContent = count > 0 ? String(count) : '';
    // v2.21 — the notes-panel toolbar badge tracks the same count.
    notesBadge.dataset.count = String(count);
    notesBadge.textContent = count > 0 ? String(count) : '';
    const label = exportPrimaryItem.querySelector('.wfpe-export-menu-label');
    const sub = exportPrimaryItem.querySelector('.wfpe-export-menu-sub');
    if (count > 0) {
      label.textContent = 'Annotated copy';
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
    // v2.21 — single fan-out point for the notes-panel card list too; a
    // no-op while the panel is closed. Deliberately NOT hooked into
    // refreshAnnotationMarkers(), which runs on every scroll/resize tick.
    renderNotesPanel();
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
    rootEl.querySelectorAll(`script[${RESULTS_SCRIPT_ATTR}]`).forEach((script) => script.remove());
    [rootEl, ...rootEl.querySelectorAll('*')].forEach((el) => {
      if (el.hasAttribute && el.hasAttribute(HANDOFF_TARGET_ATTR)) el.removeAttribute(HANDOFF_TARGET_ATTR);
      // v2.14 — edit-ledger anchors left behind by agent-processed files.
      // The handoff build re-stamps fresh ids on the clone after this pass.
      if (el.hasAttribute && el.hasAttribute(EDIT_LEDGER_TARGET_ATTR)) el.removeAttribute(EDIT_LEDGER_TARGET_ATTR);
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

  // Parses the agent's results block (v2.13). Returns null when absent or
  // malformed; otherwise a per-id map plus counts for the summary toast.
  function parseAgentResults() {
    const script = document.querySelector(`script[${RESULTS_SCRIPT_ATTR}]`);
    if (!script) return null;
    try {
      const payload = JSON.parse(script.textContent || '{}');
      if (!payload || !Array.isArray(payload.results)) return null;
      const byId = new Map();
      const counts = { done: 0, skipped: 0, needsInput: 0 };
      for (const entry of payload.results) {
        const id = (entry && typeof entry.id === 'string') ? entry.id : '';
        const status = entry && entry.status;
        if (!id || byId.has(id)) continue;
        if (status !== 'done' && status !== 'skipped' && status !== 'needs-input') continue;
        byId.set(id, { status, note: normalizeAnnotationText(entry.note) });
        if (status === 'done') counts.done += 1;
        else if (status === 'skipped') counts.skipped += 1;
        else counts.needsInput += 1;
      }
      return byId.size ? { byId, counts } : null;
    } catch (_) {
      return null;
    }
  }

  function reimportHandoffAnnotations() {
    const payload = parseHandoffPayload();
    const results = parseAgentResults();
    if (results) state.agentResultsSummary = results.counts;
    if (!payload && !results) return;
    if (payload) {
      for (const annotation of payload.annotations) {
        const id = typeof annotation.id === 'string' ? annotation.id : '';
        const instruction = normalizeAnnotationText(annotation.instruction);
        if (!id || !instruction) continue;
        const result = results ? results.byId.get(id) : null;
        // A done result resolves the note even if the agent left the
        // metadata in place — stale annotations must not re-import.
        if (result && result.status === 'done') continue;
        const targets = getHandoffTargetsById(document, id);
        if (!targets.length) continue;
        for (const target of targets) {
          target.setAttribute(ANNOTATION_ID_ATTR, id);
          target.setAttribute(ANNOTATION_TEXT_ATTR, instruction);
          if (result) {
            target.setAttribute(ANNOTATION_STATUS_ATTR, result.status);
            if (result.note) target.setAttribute(ANNOTATION_REPLY_ATTR, result.note);
          }
        }
      }
    }
    removeHandoffArtifacts(document);
  }

  // Toasts the reconciliation summary once, at ready. Covers both the live
  // refresh and a manual reopen of an agent-processed file.
  function consumeAgentResultsSummaryToast() {
    const counts = state.agentResultsSummary;
    state.agentResultsSummary = null;
    if (!counts) return;
    const parts = [];
    if (counts.done) parts.push(`${counts.done} done`);
    if (counts.skipped) parts.push(`${counts.skipped} skipped`);
    if (counts.needsInput) parts.push(`${counts.needsInput} needs input`);
    if (!parts.length) return;
    showToast(document.body, `Agent update: ${parts.join(', ')}.`);
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
      populateInspectorMulti(members);
      if (!state.drag && !state.resize && !state.txn && !state.editingText) {
        positionInspectorStack();
      }
      refreshAnnotationMarkers();
      startSelectionTracking();
    } else if (members.length === 1) {
      hideMultiSelection();
      state.selected = members[0];
      state.selectedElements = members;
      positionRing(state.selected);
      positionDimBubble(state.selected);
      populateInspector(state.selected);
      if (!state.drag && !state.resize && !state.txn && !state.editingText) {
        positionInspectorStack();
      }
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
    // v2.12: while the live value tag owns the readout, keep the text
    // tracking (v2-2 reads textContent right after a resize gesture) but
    // yield the pixels to the coral tag.
    dimBubble.style.display = isScrubTagVisible() ? 'none' : 'block';
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

  // ---------------------------------------------------------------------------
  // Align (v2.19) — multi-selection alignment against the SELECTION
  // bounding box (union of member rects), the standard design-tool
  // reference frame. Movement is a positional move exactly like drag:
  // computeAlignPlan is pure geometry (viewport-space rects in, viewport-
  // space per-member deltas out — no DOM writes, no scale), and
  // applyAlignPlan does the scale-aware writes, reusing the unlock-to-
  // absolute path drag and inspector X/Y use (unlockToAbsolute) and the
  // same anchor-then-delta write order as onMouseMove (80-drag-resize-
  // unlock.js): touch every member, unlock whatever was flow-positioned,
  // THEN re-read the position fresh (unlock can change it) before writing
  // the final position. Align never touches width/height.
  //
  // Each entry also carries the ABSOLUTE viewport-space target for the axis
  // it moves (targetLeft/targetTop, null on the untouched axis) alongside
  // the initial dxView/dyView. dxView/dyView answer "would this member move
  // at all" for the no-op filter; the write step re-derives its own delta
  // from the target against a FRESH rect taken after unlock (see
  // applyAlignPlan) rather than trusting the original delta, because
  // unlockToAbsolute's own pinning is itself offsetLeft/offsetTop-based
  // (integer) and can nudge a freshly-promoted flow member by a sub-pixel
  // amount the original delta doesn't account for.
  // ---------------------------------------------------------------------------
  function computeAlignPlan(mode, members) {
    const rects = members
      .map((el) => ({ el, rect: el.getBoundingClientRect() }))
      .filter(({ rect }) => rect.width > 0 || rect.height > 0);
    if (rects.length < 2) return [];

    let bbox = null;
    for (const { rect } of rects) {
      bbox = bbox
        ? {
          left: Math.min(bbox.left, rect.left),
          top: Math.min(bbox.top, rect.top),
          right: Math.max(bbox.right, rect.right),
          bottom: Math.max(bbox.bottom, rect.bottom),
        }
        : { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
    }
    const centerX = (bbox.left + bbox.right) / 2;
    const centerY = (bbox.top + bbox.bottom) / 2;

    return rects.map(({ el, rect }) => {
      let dxView = 0;
      let dyView = 0;
      let targetLeft = null;
      let targetTop = null;
      switch (mode) {
        case 'left': targetLeft = bbox.left; break;
        case 'right': targetLeft = bbox.right - rect.width; break;
        case 'center-h': targetLeft = centerX - rect.width / 2; break;
        case 'top': targetTop = bbox.top; break;
        case 'bottom': targetTop = bbox.bottom - rect.height; break;
        case 'middle-v': targetTop = centerY - rect.height / 2; break;
        default: break;
      }
      if (targetLeft !== null) dxView = targetLeft - rect.left;
      if (targetTop !== null) dyView = targetTop - rect.top;
      return { el, dxView, dyView, targetLeft, targetTop };
    });
  }

  // The #1 CLAUDE.md gotcha: rects are viewport px, style writes are slide
  // px — every delta here is divided by getCanvasScale() before it reaches
  // a style write, same as drag (80-drag-resize-unlock.js:185-187).
  const ALIGN_NOOP_SLIDE_PX = 0.5;

  // Anchor for the write step. offsetLeft/offsetTop (what drag anchors on)
  // are integers per DOM spec — fine for a live "follow the mouse" gesture,
  // but align has an EXACT-equality invariant. getComputedStyle's used
  // value for `left`/`top` on a positioned element is the same fractional
  // CSS pixel value the layout engine derived the current rect from, so
  // anchoring there (rather than the integer offset) keeps the anchor and
  // the rect-derived delta in one consistent, sub-pixel-accurate frame.
  // Falls back to 0 if the computed value is somehow unusable (defensive;
  // unlockToAbsolute/an already-absolute element always yields a plain px
  // value in practice) — a 0 fallback is at least in the SAME frame as the
  // delta it's added to, unlike offsetLeft/offsetTop (which differ from
  // `left`/`top` by margin, a mismatch the original fallback risked).
  function readAlignAnchorPx(el, axis) {
    const prop = axis === 'x' ? 'left' : 'top';
    const parsed = parseFloat(getComputedStyle(el)[prop]);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  // Returns true if anything moved (a txn was opened and closed); false for
  // a no-op plan, in which case NO txn is opened — no history entry, no
  // unlock side-effects, matching the brief's no-op guard.
  function applyAlignPlan(plan) {
    const scale = getCanvasScale();
    const changed = plan
      .filter(({ dxView, dyView }) => (
        Math.abs(dxView / scale) >= ALIGN_NOOP_SLIDE_PX ||
        Math.abs(dyView / scale) >= ALIGN_NOOP_SLIDE_PX
      ))
      // wasAbsolute snapshotted BEFORE any unlock runs — mirrors drag's
      // item.wasAbsolute (captured at mousedown, before the deadzone-
      // triggered unlock loop). unlockToAbsolute is idempotent when a
      // sibling's unlock already pinned this element via a shared flex/grid
      // container, so calling it unconditionally per stale wasAbsolute is
      // safe even if an earlier iteration already promoted this element.
      .map((entry) => ({ ...entry, wasAbsolute: getComputedStyle(entry.el).position === 'absolute' }));
    if (!changed.length) return false;

    const ctx = startInspectorTxn();
    for (const { el } of changed) touchElement(el);
    for (const { el, wasAbsolute } of changed) {
      if (!wasAbsolute) unlockToAbsolute(el);
    }
    for (const { el, targetLeft, targetTop } of changed) {
      if (!el.isConnected) continue;
      // Re-measure AFTER unlock and re-derive the delta from the absolute
      // target rather than reusing the pre-unlock dxView/dyView: unlock's
      // own pin (offsetLeft/offsetTop-based, integer) can nudge a freshly-
      // promoted flow member by a sub-pixel amount the original delta
      // doesn't know about, which would otherwise leave it just short of
      // the target edge — close enough to dodge the no-op guard on a
      // second click, but never exactly aligned.
      const fresh = el.getBoundingClientRect();
      // Axis-conditional: a pure horizontal align (targetTop === null) must
      // leave top untouched, not just numerically unchanged — writing it
      // unconditionally would convert e.g. a bottom-anchored absolute
      // element's implicit top into an explicit one for no reason. Unlock
      // (above) already establishes explicit left/top for a former flow
      // member on BOTH axes, so the unmoved axis stays correctly pinned
      // even though this loop never writes it.
      if (targetLeft !== null) {
        // dx is already slide px (viewport delta / scale) — compare it
        // directly to the slide-px threshold, not a second time divided.
        const dx = (targetLeft - fresh.left) / scale;
        if (Math.abs(dx) >= ALIGN_NOOP_SLIDE_PX) el.style.left = `${readAlignAnchorPx(el, 'x') + dx}px`;
      }
      if (targetTop !== null) {
        const dy = (targetTop - fresh.top) / scale;
        if (Math.abs(dy) >= ALIGN_NOOP_SLIDE_PX) el.style.top = `${readAlignAnchorPx(el, 'y') + dy}px`;
      }
    }
    endInspectorTxn(ctx);
    return true;
  }

  let selectionRafId = 0;
  // Rects captured right after the most recent full refresh, used by the
  // idle tick below to detect whether anything actually moved before
  // paying for another full refresh. Null while nothing is tracked.
  let selectionTrackingSnapshot = null;

  function shouldTrackSelection() {
    return (
      state.editMode &&
      !state.overviewMode &&
      !state.editingText &&
      getSelectedElements().length > 0
    );
  }

  function stopSelectionTracking() {
    selectionTrackingSnapshot = null;
    if (!selectionRafId) return;
    cancelAnimationFrame(selectionRafId);
    selectionRafId = 0;
  }

  // ---------------------------------------------------------------------------
  // Idle-tick dirty check (perf).
  //
  // Every frame while an element sits selected, this loop used to re-run
  // the FULL refreshSelection() path — getComputedStyle reads, inspector
  // input writes, autoGrowAnnotationTextarea's two forced reflows,
  // positionInspectorStack's offset reads, and a document-wide annotation
  // marker query — even when nothing had moved. That's continuous layout
  // work for as long as anything stays selected.
  //
  // refreshSelection() itself and every event-driven call site (click,
  // drag/resize commit, undo/redo, slide change, inspector commits, the
  // v2.12 gesture fade, etc.) are untouched — those still force a full
  // refresh immediately, exactly as before. Only the idle rAF loop gets
  // cheaper: each tick just re-checks the selected element(s) and every
  // known-annotated element's visibility + rect against the values cached
  // from the last full refresh (no document query — annotatedElementsCache
  // above already has the element list). Nothing changed → reschedule and
  // do no other work. Something changed (the selection moved, a
  // no-selection-change host animation moved/revealed/hid an annotated
  // element) → run the full refreshSelection() exactly as before, which
  // recaptures the baseline for the next tick. This is deliberately
  // geometry-only: a host script changing a non-geometric style (e.g.
  // opacity, colour, font-size) directly, with no rect/visibility change
  // and no editor event, will not refresh the inspector's readouts until
  // something else triggers a full refresh.
  // ---------------------------------------------------------------------------
  function rectsRoughlyEqual(a, b) {
    return (
      Math.abs(a.left - b.left) < 0.1 &&
      Math.abs(a.top - b.top) < 0.1 &&
      Math.abs(a.width - b.width) < 0.1 &&
      Math.abs(a.height - b.height) < 0.1
    );
  }

  // Tracks EVERY known-annotated element (not just the currently-visible
  // ones) with its own visibility verdict, so an element that is revealed
  // (or hidden) by host code with no other geometry change still flips
  // the check below — not just elements that were already on screen.
  function captureSelectionTrackingSnapshot() {
    const activeSlide = getActiveSlide();
    return {
      members: getSelectedElements().map((el) => ({ el, rect: el.getBoundingClientRect() })),
      annotated: state.annotatedElementsCache.map((el) => {
        const visible = el.isConnected && isAnnotationMarkerVisibleFor(el, activeSlide);
        return { el, visible, rect: visible ? el.getBoundingClientRect() : null };
      }),
    };
  }

  function selectionTrackingSnapshotIsStale(snapshot, members) {
    if (!snapshot) return true;
    if (members.length !== snapshot.members.length) return true;
    for (let i = 0; i < members.length; i++) {
      const cached = snapshot.members[i];
      if (members[i] !== cached.el || !rectsRoughlyEqual(members[i].getBoundingClientRect(), cached.rect)) {
        return true;
      }
    }
    const activeSlide = getActiveSlide();
    for (const entry of snapshot.annotated) {
      const visible = entry.el.isConnected && isAnnotationMarkerVisibleFor(entry.el, activeSlide);
      if (visible !== entry.visible) return true;
      if (visible && !rectsRoughlyEqual(entry.el.getBoundingClientRect(), entry.rect)) return true;
    }
    return false;
  }

  function startSelectionTracking() {
    if (!shouldTrackSelection()) return;
    // Always refresh the baseline, even if a frame is already scheduled.
    // Event-driven refreshes (e.g. every tick of a drag) call this too;
    // without an unconditional recapture here, the idle loop's next tick
    // would keep comparing against a pre-gesture snapshot and force one
    // redundant extra full refresh right after the gesture ends.
    selectionTrackingSnapshot = captureSelectionTrackingSnapshot();
    if (selectionRafId) return;
    selectionRafId = requestAnimationFrame(selectionTrackingTick);
  }

  function selectionTrackingTick() {
    selectionRafId = 0;
    // Inlines shouldTrackSelection()'s checks so getSelectedElements() (a
    // slide-scoped query plus a per-member containment check) runs once
    // per tick instead of twice.
    if (!state.editMode || state.overviewMode || state.editingText) return;
    const members = getSelectedElements();
    if (!members.length) return;
    if (selectionTrackingSnapshotIsStale(selectionTrackingSnapshot, members)) {
      // Something moved (or selection membership changed) since the last
      // snapshot — full refresh, exactly like every other call site.
      // refreshSelection() re-invokes startSelectionTracking() itself,
      // which recaptures the baseline and reschedules the next tick.
      refreshSelection();
      return;
    }
    // Nothing changed — skip the expensive path and just keep watching.
    selectionRafId = requestAnimationFrame(selectionTrackingTick);
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

  // v2.18 — shared multi-select vs single-select chrome: header label and
  // the Duplicate/Delete disabled state are functions of selection
  // membership alone, so both populate entry points (single-element
  // populateInspector below, and populateInspectorMulti further down) set
  // them explicitly on every call rather than relying on stale state left
  // by whichever path ran last.
  function updateActionRowGating(multi) {
    duplicateBtn.disabled = multi;
    duplicateBtn.title = multi
      ? 'Duplicate is not available for a multi-selection'
      : 'Duplicate selected element';
    deleteBtn.disabled = multi;
    deleteBtn.title = multi
      ? 'Delete is not available for a multi-selection'
      : 'Delete selected element';
  }

  function populateInspector(el) {
    inspectorTitle.textContent = 'Inspector';
    updateActionRowGating(false);
    if (!el) {
      for (const k of ['x', 'y', 'w', 'h', 'fontSize', 'opacity']) {
        if (document.activeElement !== inspectorInputs[k]) inspectorInputs[k].value = '';
        inspectorInputs[k].placeholder = '';
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

  // v2.18 — typed hex commit for a multi-selection: applies to every
  // member unconditionally (no isTextBearing gate, matching the picker's
  // live `input` handler in 30-ui-inspector-controls.js). One txn, per-
  // member no-op guard.
  function commitColourHexMulti(target, raw) {
    const norm = parseHexInput(raw);
    const members = getSelectedElements();
    if (!norm) {
      // Garbage input — restore from the live elements.
      populateColoursMulti(members);
      return;
    }
    const cssProp = target === 'text' ? 'color' : 'backgroundColor';
    const changed = members.filter((el) => rgbStringToHex(getComputedStyle(el)[cssProp]) !== norm);
    if (!changed.length) return;
    const ctx = startInspectorTxn();
    for (const el of changed) {
      touchElement(el);
      el.style[cssProp] = norm;
    }
    endInspectorTxn(ctx);
    populateColoursMulti(members);
  }

  function commitColourHex(target, raw, targetEl) {
    if (hasMultiSelection()) {
      commitColourHexMulti(target, raw);
      return;
    }
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
    // v2.18 code review (suggestion) — clear any 'Mixed' placeholder left
    // over from a prior multi-selection; a single selection always shows
    // a concrete value below (bgColourRow's placeholder is already
    // unconditionally reassigned further down, to '' or 'image / gradient').
    textColourRow.hexInput.placeholder = '';
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

  // v2.18 — shared/mixed reducer for multi-select populate. `mixed: true`
  // means the values disagree — populate call sites blank the field and
  // show the `Mixed` placeholder rather than guessing at a shared value.
  function computeSharedValue(values) {
    if (!values.length) return { shared: null, mixed: false };
    const first = values[0];
    const mixed = !values.every((v) => v === first);
    return { shared: mixed ? null : first, mixed };
  }

  // Background colour of one member, reduced to a value computeSharedValue
  // can compare: a hex string, or the sentinels 'transparent' / 'image'
  // (a gradient/image background has no single hex to show or agree on).
  function readBgColourToken(el) {
    const bgRgb = getComputedStyle(el).backgroundColor;
    const bgImage = getComputedStyle(el).backgroundImage;
    if (bgImage && bgImage !== 'none') return 'image';
    if (bgRgb === 'rgba(0, 0, 0, 0)' || bgRgb === 'transparent') return 'transparent';
    return rgbStringToHex(bgRgb) || '#ffffff';
  }

  // Populates the text/background colour rows for a multi-selection.
  // Unlike single-selection populateColours(), text colour is read from
  // EVERY member regardless of isTextBearing — the brief enables the text
  // colour row unconditionally for multi (writes are likewise unfiltered;
  // see commitColourHexMulti).
  function populateColoursMulti(members) {
    const textHexes = members.map((el) => rgbStringToHex(getComputedStyle(el).color) || '#000000');
    const { shared: sharedText, mixed: textMixed } = computeSharedValue(textHexes);
    if (document.activeElement !== textColourRow.hexInput) {
      textColourRow.hexInput.value = sharedText || '';
    }
    textColourRow.hexInput.placeholder = textMixed ? 'Mixed' : '';
    textColourRow.colorInput.value = sharedText || '#000000';
    if (sharedText) {
      textColourRow.swatch.style.backgroundColor = sharedText;
      delete textColourRow.swatch.dataset.transparent;
    } else {
      textColourRow.swatch.style.backgroundColor = '';
      textColourRow.swatch.dataset.transparent = 'true';
    }

    const bgTokens = members.map(readBgColourToken);
    const { shared: sharedBg, mixed: bgMixed } = computeSharedValue(bgTokens);
    const sharedBgHex = (sharedBg && sharedBg !== 'transparent' && sharedBg !== 'image') ? sharedBg : null;
    if (document.activeElement !== bgColourRow.hexInput) {
      bgColourRow.hexInput.value = sharedBgHex || '';
    }
    bgColourRow.hexInput.placeholder = bgMixed ? 'Mixed' : (sharedBg === 'image' ? 'image / gradient' : '');
    bgColourRow.colorInput.value = sharedBgHex || '#ffffff';
    if (bgMixed) {
      bgColourRow.swatch.style.backgroundColor = '';
      delete bgColourRow.swatch.dataset.image;
      delete bgColourRow.swatch.dataset.transparent;
    } else if (sharedBg === 'image') {
      bgColourRow.swatch.style.backgroundColor = '';
      bgColourRow.swatch.dataset.image = 'true';
      delete bgColourRow.swatch.dataset.transparent;
    } else if (sharedBg === 'transparent') {
      bgColourRow.swatch.style.backgroundColor = '';
      bgColourRow.swatch.dataset.transparent = 'true';
      delete bgColourRow.swatch.dataset.image;
    } else {
      bgColourRow.swatch.style.backgroundColor = sharedBgHex;
      delete bgColourRow.swatch.dataset.transparent;
      delete bgColourRow.swatch.dataset.image;
    }
  }

  function populateFontSize(el, { forceInput = false } = {}) {
    const px = Math.round(parseFloat(getComputedStyle(el).fontSize)) || FONT_SIZE_MIN_PX;
    if (forceInput || document.activeElement !== inspectorInputs.fontSize) {
      inspectorInputs.fontSize.value = String(px);
    }
    // v2.18 code review (suggestion) — clear any 'Mixed' placeholder left
    // over from a prior multi-selection.
    inspectorInputs.fontSize.placeholder = '';
  }

  // v2.18 — font size only participates in multi-select from text-bearing
  // members (writes skip non-text members too; see commitFontSizeMulti).
  // With no text-bearing member in the set the field just goes blank —
  // there's nothing to show shared-or-Mixed for.
  function populateFontSizeMulti(members) {
    const sizes = members
      .filter(isTextBearing)
      .map((el) => Math.round(parseFloat(getComputedStyle(el).fontSize)) || FONT_SIZE_MIN_PX);
    const { shared, mixed } = computeSharedValue(sizes);
    if (document.activeElement !== inspectorInputs.fontSize) {
      inspectorInputs.fontSize.value = shared != null ? String(shared) : '';
    }
    inspectorInputs.fontSize.placeholder = mixed ? 'Mixed' : '';
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
    // v2.18 code review (suggestion) — clear any 'Mixed' placeholder left
    // over from a prior multi-selection.
    inspectorInputs.opacity.placeholder = '';
    opacitySlider.value = String(Math.max(0, Math.min(100, pct)));
  }

  // v2.18 — opacity applies to every member unconditionally (no text-
  // bearing gate). Per the brief, the slider thumb tracks the PRIMARY
  // (state.selected) value when the set disagrees, rather than an
  // arbitrary member or a computed average.
  function populateOpacityMulti(members) {
    const pcts = members.map((el) => {
      const raw = parseFloat(getComputedStyle(el).opacity);
      return Math.round((Number.isFinite(raw) ? raw : 1) * 100);
    });
    const { shared, mixed } = computeSharedValue(pcts);
    if (document.activeElement !== inspectorInputs.opacity) {
      inspectorInputs.opacity.value = shared != null ? String(shared) : '';
    }
    inspectorInputs.opacity.placeholder = mixed ? 'Mixed' : '';
    const primaryRaw = state.selected ? parseFloat(getComputedStyle(state.selected).opacity) : NaN;
    const primaryPct = Math.round((Number.isFinite(primaryRaw) ? primaryRaw : 1) * 100);
    opacitySlider.value = String(Math.max(0, Math.min(100, shared != null ? shared : primaryPct)));
  }

  // v2.18 — multi-selection inspector content. Geometry rows are hidden
  // purely by the [data-multi="true"] CSS gate (20-dom-css.js) since they
  // never carry inline display styles to begin with; weight/align and the
  // typography dividers DO get inline-toggled by populateInspector() for a
  // single text selection, so this path must explicitly reset them on
  // every call — CSS alone can't win against a stale inline style left
  // over from switching out of a single selection.
  function populateInspectorMulti(members) {
    inspectorTitle.textContent = `${members.length} elements`;
    updateActionRowGating(true);
    for (const k of ['x', 'y', 'w', 'h']) {
      if (document.activeElement !== inspectorInputs[k]) inspectorInputs[k].value = '';
    }
    fontSizeRow.style.display = '';
    weightRow.row.style.display = 'none';
    alignRow.row.style.display = 'none';
    typographyDividerTop.style.display = 'none';
    typographyDividerBottom.style.display = 'none';
    textColourRow.row.style.display = '';
    populateFontSizeMulti(members);
    populateColoursMulti(members);
    populateOpacityMulti(members);
    populateAnnotation(null);
  }

  // v2.18 — typed (absolute) font-size commit for a multi-selection: every
  // text-bearing member ends at the SAME value (unlike the ± steppers,
  // which step each member relatively). Non-text members are skipped
  // silently. One txn covers every member that actually changes; the
  // no-op guard is per-member so an already-matching member doesn't churn
  // its style or drag in a spurious history entry.
  function commitFontSizeMulti(next) {
    const clamped = Math.max(FONT_SIZE_MIN_PX, next);
    const members = getSelectedElements().filter(isTextBearing);
    const changed = members.filter((el) => Math.round(parseFloat(getComputedStyle(el).fontSize)) !== Math.round(clamped));
    if (!changed.length) return;
    const ctx = startInspectorTxn();
    for (const el of changed) {
      touchElement(el);
      el.style.fontSize = `${clamped}px`;
    }
    endInspectorTxn(ctx);
    refreshSelection();
  }

  // v2.18 — typed (absolute) opacity commit for a multi-selection: every
  // member ends at the same value (no isTextBearing gate — see
  // populateOpacityMulti). Same one-txn / per-member-no-op shape as
  // commitFontSizeMulti above.
  function commitOpacityMulti(next) {
    const pct = Math.max(0, Math.min(100, next));
    const members = getSelectedElements();
    const changed = members.filter((el) => {
      const raw = parseFloat(getComputedStyle(el).opacity);
      const currentPct = Math.round((Number.isFinite(raw) ? raw : 1) * 100);
      return Math.round(pct) !== currentPct;
    });
    if (!changed.length) return;
    const ctx = startInspectorTxn();
    for (const el of changed) {
      touchElement(el);
      el.style.opacity = String(pct / 100);
    }
    endInspectorTxn(ctx);
    refreshSelection();
  }

  function commitInspectorInput(prop, raw, targetEl) {
    // Prefer the target captured at focus-time so a mid-edit selection
    // change doesn't redirect the commit to the new element.
    const el = (targetEl && targetEl.isConnected) ? targetEl : state.selected;
    if (!el) return;
    const next = parseFloat(raw);
    if (!Number.isFinite(next)) {
      // Garbage input — restore the readout from the live element(s).
      if (hasMultiSelection()) populateInspectorMulti(getSelectedElements());
      else populateInspector(el);
      return;
    }
    if (prop === 'fontSize') {
      if (hasMultiSelection()) {
        commitFontSizeMulti(next);
        return;
      }
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
      if (hasMultiSelection()) {
        commitOpacityMulti(next);
        return;
      }
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
    // x/y/w/h stay single-element only — their rows are hidden in multi
    // mode, but the guard is defensive in case a commit ever reaches here
    // (e.g. a stale focus-time target) with a multi-selection now active.
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
    // v2.18 — deliberate behaviour change: the dock is visible for ANY
    // non-empty selection, not just exactly one. `data-multi` drives the
    // reduced-surface CSS gate (20-dom-css.js) for a set of 2+.
    const members = getSelectedElements();
    const visible = members.length >= 1;
    // Ink-glass 3b/5b: selection drives the dock fold, then the shared
    // seam refresh reconciles the toolbar corner morph, the menu's
    // bottom radius, and inspector suppression in one place — the three
    // must never disagree, or a seam breaks (squared bar over no panel,
    // or panel under a capsule).
    inspectorDock.dataset.visible = visible ? 'true' : 'false';
    inspectorDock.dataset.multi = members.length > 1 ? 'true' : 'false';
    refreshStackSeams();
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
    positionInspectorStack();
    refreshExportUi();
  }

  function setInspectorMinimised(value) {
    state.inspectorMinimised = !!value;
    refreshInspector();
  }

  // Keep the complete editor instrument clear of the selected element at
  // rest. The current side wins while it remains clear; switching happens
  // only when that side overlaps and the opposite side does not. This
  // hysteresis prevents placement oscillation as layout settles.
  function positionInspectorStack() {
    const visible = inspectorDock.dataset.visible === 'true';
    // v2.18 — was `length !== 1`; the dock now also opens for a
    // multi-selection, and getLiveSelectionRect() (85-adaptive-fade.js)
    // already aggregates every selected member's rect into one bounding
    // box, so the avoidance math below needs no other change.
    if (!visible || state.overviewMode || !getSelectedElements().length) {
      inspector.dataset.avoidance = 'clear';
      inspector.dataset.revealed = 'false';
      return;
    }
    // A live manipulation intentionally holds the dock still so v2.12's
    // overlap-gated fade remains meaningful as content passes beneath it.
    if (state.drag || state.resize || state.txn || state.editingText) return;

    const selectionRect = getLiveSelectionRect();
    if (!selectionRect) return;
    const margin = 16;
    const gutter = 10;
    const width = Math.max(246, stack.offsetWidth || 0);
    const toolbarHeight = toolbar.offsetHeight || 36;
    const exportHeight = state.exportMenuOpen ? (exportMenu.offsetHeight + 1) : 0;
    const notesHeight = state.notesPanelOpen ? ((notesPanel.offsetHeight || 0) + 1) : 0;
    const bodyHeight = (state.inspectorMinimised || state.exportMenuOpen)
      ? 0
      : inspectorFoldInner.scrollHeight;
    const inspectorHeight = (inspectorHeader.offsetHeight || 36) + bodyHeight + 1;
    const height = Math.min(
      toolbarHeight + exportHeight + notesHeight + inspectorHeight + 2,
      window.innerHeight - margin * 2
    );
    const expandedSelection = {
      left: selectionRect.left - gutter,
      top: selectionRect.top - gutter,
      right: selectionRect.right + gutter,
      bottom: selectionRect.bottom + gutter,
    };
    const candidates = {
      left: { left: margin, top: margin, right: margin + width, bottom: margin + height },
      right: {
        left: window.innerWidth - margin - width,
        top: margin,
        right: window.innerWidth - margin,
        bottom: margin + height,
      },
    };
    const current = stack.dataset.side === 'left' ? 'left' : 'right';
    const other = current === 'right' ? 'left' : 'right';
    const currentBlocked = rectsOverlap(expandedSelection, candidates[current]);
    const otherBlocked = rectsOverlap(expandedSelection, candidates[other]);
    if (currentBlocked && !otherBlocked) stack.dataset.side = other;
    const nextAvoidance = currentBlocked && otherBlocked ? 'overlap' : 'clear';
    if (inspector.dataset.avoidance !== nextAvoidance || nextAvoidance === 'clear') {
      inspector.dataset.revealed = 'false';
    }
    inspector.dataset.avoidance = nextAvoidance;
  }
  // ===========================================================================
  // Agent-notes panel (v2.21)
  //
  // A browsable list of every saved annotation across the deck — the
  // cross-slide counterpart to the active-slide-only pins. Cards live in
  // the .wfpe-notes-list node (30-ui) and are rebuilt wholesale per
  // fan-out; renderNotesPanel() is a no-op while the panel is closed, so
  // the closed panel costs nothing. Entry enumeration reuses
  // getAnnotatedElements(document) — document order, which is slide order
  // — NOT state.annotatedElementsCache (that cache is emptied in overview
  // mode and edit-off, both of which keep the panel populated).
  //
  // Jumping mirrors navigateToSlide()'s activation contract exactly:
  // state.deckMutated flips arrow-nav to live-DOM queries so a fixture's
  // stale navigation closures cannot misnavigate after the editor
  // activates a slide behind the host's back.
  // ===========================================================================
  function collectNotesPanelEntries() {
    const slides = getSlides();
    // Whole-document fallback keeps chip numbering consistent with the
    // handoff payload (getSlideIndexForHandoffTarget) when a slide lives
    // outside the resolved deck root (multi-deck / nested documents).
    const allSlides = [...document.querySelectorAll('.slide')];
    return getAnnotatedElements(document).map((el) => {
      const slide = el.closest('.slide');
      const deckIndex = slide ? slides.indexOf(slide) : -1;
      return {
        id: getAnnotationId(el),
        el,
        slideIndex: deckIndex >= 0 ? deckIndex : (slide ? allSlides.indexOf(slide) : -1),
        snippet: summarizeTargetText(el).slice(0, 60),
        instruction: getAnnotationText(el),
        status: el.getAttribute(ANNOTATION_STATUS_ATTR) || '',
        reply: normalizeAnnotationText(el.getAttribute(ANNOTATION_REPLY_ATTR)),
      };
    });
  }

  function makeNotesCard(entry, selectedId) {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'wfpe-notes-card';
    card.dataset.annotationId = entry.id;
    if (entry.status) card.dataset.status = entry.status;
    card.dataset.active = (selectedId && entry.id === selectedId) ? 'true' : 'false';
    card.setAttribute('aria-label', 'Go to agent note');

    const top = document.createElement('span');
    top.className = 'wfpe-notes-card-top';
    if (entry.slideIndex >= 0) {
      const chip = document.createElement('span');
      chip.className = 'wfpe-notes-card-chip';
      chip.textContent = String(entry.slideIndex + 1);
      chip.title = `Slide ${entry.slideIndex + 1}`;
      top.appendChild(chip);
    }
    const snippet = document.createElement('span');
    snippet.className = 'wfpe-notes-card-snippet';
    snippet.textContent = entry.snippet || `<${entry.el.tagName.toLowerCase()}>`;
    top.appendChild(snippet);
    card.appendChild(top);

    const instruction = document.createElement('span');
    instruction.className = 'wfpe-notes-card-instruction';
    instruction.textContent = entry.instruction;
    card.appendChild(instruction);

    if (entry.status) {
      const reply = document.createElement('span');
      reply.className = 'wfpe-notes-card-reply';
      reply.dataset.status = entry.status;
      const label = entry.status === 'needs-input' ? 'Agent needs input' : 'Agent skipped';
      reply.textContent = entry.reply ? `${label}: ${entry.reply}` : `${label}.`;
      card.appendChild(reply);
    }
    return card;
  }

  function renderNotesPanel() {
    if (!state.notesPanelOpen) return;
    const entries = collectNotesPanelEntries();
    const selectedId = getAnnotationId(state.selected);
    notesList.replaceChildren();
    if (entries.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'wfpe-notes-empty';
      empty.textContent = 'No agent notes yet. Select an element and add one in the inspector.';
      notesList.appendChild(empty);
    } else {
      for (const entry of entries) notesList.appendChild(makeNotesCard(entry, selectedId));
    }
    const cycleDisabled = entries.length < 2;
    notesPrevBtn.disabled = cycleDisabled;
    notesNextBtn.disabled = cycleDisabled;
  }

  function jumpToAnnotation(id) {
    const el = findAnnotationElementById(id);
    if (!el) {
      // Stale card (note deleted between fan-outs) — degrade to a
      // re-render, never a wrong jump.
      renderNotesPanel();
      return;
    }
    closeExportMenu();
    if (state.overviewMode) setOverviewMode(false);
    // Selection machinery requires edit mode; a jump from edit-off is an
    // explicit "take me to this note", so turning it on is the intent.
    if (!state.editMode) setEditMode(true);
    const slide = el.closest('.slide');
    if (slide && slide !== getActiveSlide()) {
      // The editor activated this slide without advancing the host deck's
      // private cursor — own subsequent arrows (see navigateToSlide).
      state.deckMutated = getDocumentMode() !== 'flat';
      synchronizeSlideState(slide);
    }
    state.notesCursorId = id;
    setSelected(el);
    // Opens the inspector (populated note + reply) and, via its
    // refreshExportUi tail, re-renders the card list with data-active set.
    refreshInspector();
    // Slides are viewport-sized; only flat documents scroll to content.
    if (isFlatMode()) el.scrollIntoView({ block: 'center' });
    // Focus stays OUT of the note textarea: a focused textarea would
    // swallow the next N keystroke (isTypingTarget) and end the flicking.
    const activeCard = notesList.querySelector('[data-active="true"]');
    if (activeCard) activeCard.scrollIntoView({ block: 'nearest' });
  }

  function cycleAnnotation(delta) {
    const entries = collectNotesPanelEntries();
    if (entries.length === 0) return;
    if (!state.notesPanelOpen) openNotesPanel();
    const selectedId = getAnnotationId(state.selected);
    let index = selectedId
      ? entries.findIndex((entry) => entry.id === selectedId)
      : -1;
    if (index < 0 && state.notesCursorId) {
      index = entries.findIndex((entry) => entry.id === state.notesCursorId);
    }
    const next = index < 0
      ? (delta > 0 ? 0 : entries.length - 1)
      : (index + delta + entries.length) % entries.length;
    jumpToAnnotation(entries[next].id);
  }
  // ===========================================================================
  // History (undo/redo)
  //
  // Each history entry is a list of (element, before, after) snapshots. A
  // snapshot captures the element's inline `style` plus any `data-wfp-edit-*`
  // markers that the editor adds during unlock/freeze. Undo restores every
  // element's `before`; redo restores `after`. One drag = one entry, one
  // resize = one entry, one font-size keystroke = one entry; the freeze that
  // a drag performs on flex/grid siblings and its unlock-group active state
  // are bundled into the same entry as the drag itself.
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

  // ---------------------------------------------------------------------------
  // Pending-transaction flush hooks.
  //
  // A control can legitimately hold state.txn open across a short settle
  // window instead of closing it the instant its own trigger event fires
  // (the opacity slider's keyboard-burst coalescing in 30-ui-inspector-
  // controls.js is the first case: closing on every `change` the way a
  // mouse drag does would fragment one held-key gesture into dozens of
  // history entries). beginTxn()'s reentry guard below — "ignore re-entry;
  // outermost owns the txn" — means any OTHER gesture that starts while
  // that window is still open would otherwise either silently merge into
  // the pending session (wrong granularity — e.g. a drag started moments
  // after an opacity change would undo as one step instead of two) or have
  // its own beginTxn() options silently discarded (data loss — e.g.
  // startTextEdit's captureHtml:true never takes effect, so the typed
  // content becomes permanently un-undoable). A control that holds a
  // session open like this MUST register a flush hook here for exactly as
  // long as the session stays open, so beginTxn() finalizes it as its own
  // history entry before deciding whether a genuine reentry exists.
  //
  // undo() and redo() flush for the same reason: they move the history
  // cursor, which is meaningless while an uncommitted edit is still parked
  // in the txn slot (see the comment above undo()).
  // ---------------------------------------------------------------------------
  const pendingTxnFlushHooks = new Set();

  function registerPendingTxnFlush(hook) {
    pendingTxnFlushHooks.add(hook);
  }

  function unregisterPendingTxnFlush(hook) {
    pendingTxnFlushHooks.delete(hook);
  }

  function flushPendingTxnSessions() {
    if (!pendingTxnFlushHooks.size) return;
    // Snapshot first — a hook's own cleanup unregisters itself mid-loop, and
    // a hook may legitimately open a NEW session, which must not be flushed
    // by the same pass. Deleting each hook BEFORE invoking it makes
    // termination structural rather than a promise each hook has to keep:
    // a hook that forgets to unregister itself (or throws before it can)
    // still cannot be invoked twice by a later flush.
    for (const hook of [...pendingTxnFlushHooks]) {
      pendingTxnFlushHooks.delete(hook);
      hook();
    }
  }

  function beginTxn(options = {}) {
    flushPendingTxnSessions();
    if (state.txn) return; // ignore re-entry; outermost owns the txn
    state.txn = {
      snapshots: new Map(),
      captureHtml: !!options.captureHtml,
      flowGroupStates: new Map(),
    };
  }

  function touchElement(el) {
    if (!state.txn || !el) return;
    if (state.txn.snapshots.has(el)) return;
    state.txn.snapshots.set(el, snapshotElement(el, state.txn));
  }

  function setFlowUnlockGroupActive(group, active) {
    if (!group) return;
    const next = !!active;
    if (group.active === next) return;
    if (state.txn && !state.txn.flowGroupStates.has(group)) {
      state.txn.flowGroupStates.set(group, !!group.active);
    }
    group.active = next;
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
      // First committed change to this element: its `before` style is the
      // pristine pre-edit value (authored inline style, or null). Reset
      // restores it. Later transactions must not overwrite it.
      if (!state.originalStyles.has(el)) state.originalStyles.set(el, before.style);
      // v2.14 — record the element in the iterable ledger set so the
      // handoff export can enumerate user-touched elements later.
      state.editedElements.add(el);
    }
    const flowGroupStates = [];
    for (const [group, beforeActive] of txn.flowGroupStates) {
      const afterActive = !!group.active;
      if (beforeActive === afterActive) continue;
      flowGroupStates.push({ group, beforeActive, afterActive });
    }
    if (changes.length === 0 && flowGroupStates.length === 0) return;
    pushHistoryEntry(changes, null, flowGroupStates);
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
    // beginTxn() re-checks state.txn itself and flushes any pending
    // settle-window session first (see the flush-hooks block above) — an
    // outer `if (!state.txn)` guard here would skip that flush whenever a
    // pending session (rather than a genuine in-progress txn) happens to
    // be why state.txn is currently set, letting this call silently reuse
    // someone else's transaction instead of opening its own.
    beginTxn(options);
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

  function pushHistoryEntry(changes, slideOps = null, flowGroupStates = null) {
    // Truncate any redo stack — a fresh change invalidates everything
    // beyond the current cursor.
    state.history.length = state.historyIndex;
    const entry = { changes };
    if (slideOps && slideOps.length) entry.slideOps = slideOps;
    if (flowGroupStates && flowGroupStates.length) entry.flowGroupStates = flowGroupStates;
    state.history.push(entry);
    state.historyIndex = state.history.length;
    while (state.history.length > HISTORY_MAX) {
      state.history.shift();
      state.historyIndex--;
    }
    pruneInactiveFlowUnlockGroups();
  }

  // The single funnel for "an element was attached to or detached from the
  // document" (paste/duplicate insert, element delete). Both change what is
  // under a flat root, and deleting its pinned children down to zero must
  // release the height hold rather than leave an emptied root propped open —
  // in the live document AND in the export, which reads the same marker.
  // Undo/redo of these ops re-derive through their own reconcile.
  function pushElementInsertEntry(op) {
    reconcileFlatRootHolds();
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

  // Undo/redo are transaction boundaries in exactly the way beginTxn() is: a
  // settle-window session (the opacity slider's keyboard burst) is a real,
  // uncommitted edit parked in the shared txn slot, and moving the history
  // cursor past it corrupts both halves. Without this flush, the entry being
  // restored below overwrites the live edit wholesale — applyElementSnapshot
  // writes the entire `style` attribute — so the edit is silently discarded;
  // then the session's own timer commits from the already-moved cursor,
  // truncating the redo stack and leaving the next undo looking like it
  // stepped forward. Flushing first turns the pending session into its own
  // entry, so undo/redo simply walk one more step. Runs before the
  // index guards on purpose: the flush can add the entry those guards read.
  function undo() {
    flushPendingTxnSessions();
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
    if (entry.flowGroupStates) {
      for (const transition of entry.flowGroupStates) {
        transition.group.active = transition.beforeActive;
      }
    }
    if (
      entry.slideOps &&
      entry.slideOps.some((op) => (
        op.type === 'reorder' ||
        op.type === 'delete' ||
        op.type === 'slideInsert'
      ))
    ) {
      synchronizeSlideState();
    }
    // v2.15 — the flat-root height hold is derived from which children are
    // pinned, and this entry may have changed that set. Re-deriving is a
    // no-op whenever the snapshot pair was already consistent.
    reconcileFlatRootHolds();
    refreshSelection();
    refreshExportUi();
    if (state.overviewMode) buildOverviewOverlay();
  }

  function redo() {
    flushPendingTxnSessions(); // see undo()
    if (state.historyIndex >= state.history.length) return;
    const entry = state.history[state.historyIndex];
    if (entry.changes) {
      for (const c of entry.changes) applyElementSnapshot(c.element, c.after);
    }
    if (entry.flowGroupStates) {
      for (const transition of entry.flowGroupStates) {
        transition.group.active = transition.afterActive;
      }
    }
    if (entry.slideOps) {
      for (const op of entry.slideOps) redoSlideOp(op);
    }
    if (
      entry.slideOps &&
      entry.slideOps.some((op) => (
        op.type === 'reorder' ||
        op.type === 'delete' ||
        op.type === 'slideInsert'
      ))
    ) {
      synchronizeSlideState();
    }
    state.historyIndex++;
    reconcileFlatRootHolds(); // see undo()
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
    renderNotesPanel(); // v2.21 — panel stays populated in both modes
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
    renderNotesPanel(); // v2.21 — panel stays populated in both modes
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
      const dragHandle = document.createElement('span');
      dragHandle.className = 'wfpe-overview-drag-handle';
      dragHandle.title = `Drag slide ${i + 1} to reorder`;
      dragHandle.setAttribute('aria-hidden', 'true');
      dragHandle.innerHTML = ICONS.grip;
      thumb.appendChild(dragHandle);
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
    if (!slide.parentElement) return;
    // The editor activated this slide without advancing the host deck's
    // private cursor. Own subsequent arrows immediately; otherwise a foreign
    // handler can navigate from its stale pre-Overview index.
    state.deckMutated = getDocumentMode() !== 'flat';
    synchronizeSlideState(slide);
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
    pruneInactiveFlowUnlockGroups();
    // Once any slide-level op lands, a deck's cached slide list (often
    // built once at script load via document.querySelectorAll) can be
    // stale relative to the live deck — its arrow-nav would index into
    // the wrong slot or land .active on an orphan. From here on, the
    // editor owns plain-view arrow nav for paginated modes using fresh
    // DOM queries. Flat mode has no page-shaped navigation.
    state.deckMutated = getDocumentMode() !== 'flat';
    synchronizeSlideState();
  }

  // Synchronize editor-owned slide activation with common host navigation
  // capabilities. Contract decks expose progress dots. Foreign decks may
  // instead expose a semantic current/total counter. Counter updates are
  // deliberately conservative: a recognized slide/page counter hook must
  // also contain a supported counter shape, so arbitrary host UI that merely
  // happens to include numbers is left untouched.
  function synchronizeRecognizedHostCounters(root, activeIndex, total) {
    const counterSelector = [
      '[data-slide-count]',
      '[data-slide-counter]',
      '[data-page-count]',
      '[data-page-counter]',
      '.slide-count',
      '.slide-counter',
      '.page-count',
      '.page-counter',
      '#slide-count',
      '#slide-counter',
      '#page-count',
      '#page-counter',
    ].join(',');

    for (const counter of root.querySelectorAll(counterSelector)) {
      if (counter.closest(`#${ROOT_ID}`)) continue;

      // Preserve the host's delimiter, surrounding whitespace, and optional
      // "Slide" prefix. Text-only counters are safe to update without
      // flattening authored child markup.
      if (counter.childElementCount === 0) {
        const match = counter.textContent.match(
          /^(\s*(?:slide\s+)?)(\d+)(\s*(?:\/|of)\s*)(\d+)(\s*)$/i,
        );
        if (match) {
          counter.textContent = `${match[1]}${activeIndex + 1}${match[3]}${total}${match[5]}`;
          continue;
        }
      }

      // Split counters keep their authored structure. Require both numeric
      // capabilities before writing either half.
      const current = counter.querySelector(
        '[data-current-slide], [data-current-page], .current-slide, .current-page, .slide-current, .page-current',
      );
      const count = counter.querySelector(
        '[data-total-slides], [data-total-pages], .total-slides, .total-pages, .slide-total, .page-total',
      );
      if (
        current &&
        count &&
        /^\s*\d+\s*$/.test(current.textContent) &&
        /^\s*\d+\s*$/.test(count.textContent)
      ) {
        current.textContent = String(activeIndex + 1);
        count.textContent = String(total);
      }
    }
  }

  function synchronizeSlideState(activeSlide = null) {
    const slides = getSlides();
    if (slides.length === 0 || getDocumentMode() === 'flat') return null;

    let activeIndex = activeSlide ? slides.indexOf(activeSlide) : -1;
    if (activeIndex < 0) {
      activeIndex = slides.findIndex((slide) => slide.classList.contains('active'));
    }
    if (activeIndex < 0) activeIndex = 0;

    slides.forEach((slide, index) => {
      slide.classList.toggle('active', index === activeIndex);
    });
    document.querySelectorAll('.progress-dot').forEach((dot, index) => {
      dot.classList.toggle('active', index === activeIndex);
    });
    synchronizeRecognizedHostCounters(document, activeIndex, slides.length);
    return slides[activeIndex];
  }

  // The keys a slide deck conventionally navigates with. Cmd/Ctrl/Alt
  // combinations are excluded — those belong to the browser or to the
  // editor's own shortcuts. Shift is deliberately not excluded: unlike the
  // Arrow↑/↓ font nudge, where Shift means "bigger step", host decks treat
  // Shift+Arrow as a plain arrow.
  function isSlideNavigationKey(e) {
    return (
      !e.metaKey && !e.ctrlKey && !e.altKey &&
      (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === ' ' || e.key === 'Spacebar')
    );
  }

  // Navigate the live deck by ±1. Used by the editor-owned arrow-nav
  // takeover in onKeyDown.
  function navigateRelativeInDeck(delta) {
    const slides = getSlides();
    if (slides.length === 0) return;
    let cur = slides.findIndex((s) => s.classList.contains('active'));
    if (cur < 0) {
      // Recovery: no in-DOM slide is .active (e.g., the fixture's
      // stale handler set .active on an orphan before we took over).
      // Re-anchor to the first slide so the user sees something.
      synchronizeSlideState(slides[0]);
      return;
    }
    const next = cur + delta;
    if (next < 0 || next >= slides.length) return;
    synchronizeSlideState(slides[next]);
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
  //
  // v2.18 — multi-selection steps every text-bearing member by the SAME
  // delta from its OWN current computed size (nudgeFontSize reads current
  // per element), preserving relative hierarchy between differently-sized
  // members instead of collapsing them to one absolute value. Non-text
  // members are skipped silently, same as the typed-value commit path.
  function nudgeFontSizeWithHistory(deltaPx) {
    const members = getSelectedElements().filter(isTextBearing);
    if (!members.length) return;
    const ctx = startInspectorTxn();
    for (const el of members) {
      touchElement(el);
      nudgeFontSize(el, deltaPx);
    }
    endInspectorTxn(ctx);
    if (hasMultiSelection()) populateFontSizeMulti(getSelectedElements());
    else populateFontSize(members[0], { forceInput: true });
    // v2.12 — each ± step blips the value tag (and the fade when the
    // selection sits under the panel); the settle timer keeps a burst of
    // clicks from flickering the chrome. Blips the primary member when
    // it's one of the ones that moved, else the last member touched.
    const blipEl = (state.selected && isTextBearing(state.selected)) ? state.selected : members[members.length - 1];
    const px = Math.round(parseFloat(getComputedStyle(blipEl).fontSize));
    liveEditBlip(`${px} px`);
    refreshSelection();
  }

  function onKeyDown(e) {
    // v2.11 — while the export menu is open it owns Enter/Escape.
    if (state.exportMenuOpen) {
      if (e.key === 'Enter') {
        // A menu row focused via keyboard owns Enter — let its native
        // activation (click) fire instead of hijacking it for row 1.
        if (exportMenu.contains(document.activeElement)) return;
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

    // v2.21 — flick through agent notes: N next, Shift+N previous
    // (noModifier permits Shift, which carries the direction). Works
    // regardless of edit mode — the jump normalizes mode itself — and
    // opens the panel on first press. With no notes the key is left
    // alone so the host page keeps its normal meaning.
    if ((e.key === 'n' || e.key === 'N') && noModifier) {
      if (getAnnotatedElements(document).length === 0) return;
      e.preventDefault();
      e.stopPropagation();
      cycleAnnotation(e.shiftKey ? -1 : 1);
      return;
    }

    // Escape is the keyboard counterpart to clicking empty slide background:
    // it drops the selection so the ring and inspector go away and the
    // navigation keys revert to the deck. It only gets here once every
    // surface bound to Escape ahead of it has declined — the export menu and
    // text edit return above, Overview one branch up, and inspector inputs
    // (their own Escape reverts a pending value) at the isTypingTarget guard.
    // An in-flight drag or resize keeps its selection: the pointer gesture
    // still owns the element and releases it on mouseup.
    if (e.key === 'Escape' && noModifier && state.selected && !state.drag && !state.resize) {
      e.preventDefault();
      e.stopPropagation();
      setSelected(null);
      refreshInspector();
      return;
    }

    // v2.21 — with nothing selected, Escape closes the notes panel: the
    // last layer of the Escape onion (menu → text edit → overview →
    // deselect → notes panel).
    if (e.key === 'Escape' && noModifier && state.notesPanelOpen) {
      e.preventDefault();
      e.stopPropagation();
      closeNotesPanel();
      return;
    }

    // Slide navigation keys belong to the deck, not the editor. The editor
    // only takes them away when something of its own is bound to them: an
    // open export menu, Overview mode (its own surface), or a live selection
    // — navigating away mid-edit would strand the selection on a hidden
    // slide. Edit mode with nothing selected has no such claim, so the keys
    // keep their normal meaning: slide navigation on a deck, page scroll on
    // a flat document. (Text edit is handled earlier and returns before this
    // point, so a caret keeps its arrows.)
    if (isSlideNavigationKey(e)) {
      // An open export menu owns the keyboard — the deck must not move
      // behind it. Propagation stops either way; the default action is
      // left intact while a menu row holds focus so Space still activates
      // that row natively, the same focus carve-out Enter makes above.
      if (state.exportMenuOpen) {
        e.stopPropagation();
        if (!exportMenu.contains(document.activeElement)) e.preventDefault();
        return;
      }
      if (state.overviewMode || (state.editMode && state.selected)) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      // Editor-owned navigation (v2.1.0 hotfix). Once the editor has
      // activated a slide, mutated the deck, or restored a live refresh, the
      // fixture's own keydown handler — which commonly caches slides + cur at
      // load time — may be stale. Editor navigation uses fresh DOM queries.
      if (state.deckMutated) {
        e.preventDefault();
        e.stopPropagation();
        navigateRelativeInDeck(e.key === 'ArrowLeft' ? -1 : +1);
        return;
      }
      // Untouched deck: let the host's own bubble-phase handler navigate so
      // its transitions, build steps, and counters run as they normally do.
      //
      // A toolbar button clicked with the mouse keeps focus, and Space's
      // native default action would activate it — pressing Space right
      // after clicking Edit would advance the slide AND toggle edit mode
      // back off. Suppressing the default action (not propagation) kills
      // that second effect while the host still navigates from its own
      // keydown listener.
      if (isInsideEditorRoot(document.activeElement)) e.preventDefault();
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

    // v2.22 — Markdown mode has no geometry: a dragged paragraph would write
    // an inline style the writeback cannot represent and would silently drop.
    // This bails AFTER the text-edit teardown above deliberately — that block
    // is the only thing that commits an open edit when the pointer lands
    // elsewhere, so returning ahead of it strands state.editingText and makes
    // every subsequent block uneditable until edit mode is toggled. Selection
    // is unaffected: the click path (70-selection-events) owns it.
    if (state.markdownMode) return;

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

    // Mousedown only records gesture geometry — cheap reads, no txn, no
    // style writes. All mutation (beginTxn, unlock-or-pin) is deferred until
    // the pointer leaves the deadzone in onResizeMove, mirroring the drag
    // engine, so a zero-move click on a handle leaves the element, the
    // history, and any flow siblings completely untouched.
    state.resize = {
      el,
      dir,
      startX: e.clientX,
      startY: e.clientY,
      initLeft: el.offsetLeft,
      initTop: el.offsetTop,
      initWidth: el.offsetWidth,
      initHeight: el.offsetHeight,
      wasAbsolute: getComputedStyle(el).position === 'absolute',
      started: false,
    };

    document.addEventListener('mousemove', onResizeMove, true);
    document.addEventListener('mouseup', onResizeUp, true);
  }

  function onResizeMove(e) {
    const r = state.resize;
    if (!r) return;
    e.preventDefault();
    e.stopPropagation();

    const dxView = e.clientX - r.startX;
    const dyView = e.clientY - r.startY;

    if (!r.started) {
      const distSq = dxView * dxView + dyView * dyView;
      if (distSq < DRAG_DEADZONE_PX * DRAG_DEADZONE_PX) return;
      r.started = true;
      beginTxn();
      touchElement(r.el);

      // Resize on a flow-positioned element runs the same unlock conversion
      // as a drag would (which also freezes flex/grid siblings). The unlock
      // changes offsets, so refetch the anchors from the element before any
      // dimensional writes.
      if (!r.wasAbsolute) {
        const rect = unlockToAbsolute(r.el);
        r.initLeft = rect.left;
        r.initTop = rect.top;
        r.initWidth = rect.width;
        r.initHeight = rect.height;
      } else {
        // Lock in the current dimensions so deltas compose deterministically.
        // Anchors are re-read here rather than trusted from mousedown: any
        // layout shift between the press and the first move past the
        // deadzone would otherwise snap the element to a stale position.
        r.initLeft = r.el.offsetLeft;
        r.initTop = r.el.offsetTop;
        r.initWidth = r.el.offsetWidth;
        r.initHeight = r.el.offsetHeight;
        r.el.style.left = `${r.initLeft}px`;
        r.el.style.top = `${r.initTop}px`;
        r.el.style.width = `${r.initWidth}px`;
        r.el.style.height = `${r.initHeight}px`;
      }
    }

    const scale = getCanvasScale();
    const dx = dxView / scale;
    const dy = dyView / scale;

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
    // v2.12 — live W × H tag + overlap-gated fade, re-tested every move
    // (a growing element can pass under the panel mid-gesture). Runs
    // before refreshSelection so the dim bubble yields on the first tick.
    liveEditUpdate(`${r.el.offsetWidth} × ${r.el.offsetHeight}`);
    refreshSelection();
  }

  function onResizeUp(_e) {
    document.removeEventListener('mousemove', onResizeMove, true);
    document.removeEventListener('mouseup', onResizeUp, true);
    const r = state.resize;
    if (!r) return;
    state.resize = null;
    // Swallow the synthetic click that follows the release — even for a
    // zero-move gesture — so releasing over the handle never deselects.
    state.suppressClickUntil = Date.now() + POST_DRAG_CLICK_GUARD_MS;
    if (r.started) {
      endTxn();
      liveEditEnd();
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

  function snapshotChildOffsets(children, container) {
    return children.map((child) => {
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

  function snapshotChildOffsetsRelativeTo(container) {
    return snapshotChildOffsets(getPinnableContainerChildren(container), container);
  }

  // v2.15 — the slide/flat root can be document.body (resolveFlatRoot's
  // last fallback), where #wfp-editor-root and the page's own <script>
  // elements are DIRECT siblings of the unlock target. Pinning must never
  // touch editor-injected DOM (inline position:absolute would destroy the
  // fixed overlay) or non-rendered elements (inline styles on <script> and
  // friends survive into exports — the export scrubber only removes
  // data-wfp-edit-* attributes). Neither exclusion is root-specific: a
  // static non-flat slide reaches pinContainerChildren with the same
  // hazards, and an ordinary flex container can hold an inline <script>
  // too, so EVERY pin path filters on the tag/editor-root rules.
  const NON_RENDERED_ROOT_CHILD_TAGS = new Set([
    'SCRIPT', 'STYLE', 'LINK', 'META', 'NOSCRIPT', 'TEMPLATE',
  ]);

  function isPinnableContainerChild(child) {
    if (isInsideEditorRoot(child)) return false;
    return !NON_RENDERED_ROOT_CHILD_TAGS.has(child.tagName);
  }

  // The extra 0x0-rect rule is ROOT-ONLY on purpose: it exists so a hidden
  // body-level panel doesn't count as a sibling worth protecting, and an
  // ordinary container can legitimately hold an empty but layout-
  // participating child (a zero-height flex spacer, a collapsed row) whose
  // pin still matters.
  function isPinnableRootChild(child) {
    if (!isPinnableContainerChild(child)) return false;
    const rect = child.getBoundingClientRect();
    return rect.width > 0 || rect.height > 0;
  }

  function getPinnableContainerChildren(containerEl) {
    return [...containerEl.children].filter(isPinnableContainerChild);
  }

  function getPinnableRootChildren(rootEl) {
    return [...rootEl.children].filter(isPinnableRootChild);
  }

  function addFlowUnlockGroupMember(group, el, isContainer = false) {
    let record = group.records.get(el);
    if (!record) {
      record = {
        el,
        beforeStyle: el.getAttribute('style'),
        beforeFrozen: el.getAttribute('data-wfp-edit-frozen'),
        beforeFlexFrozen: el.getAttribute('data-wfp-edit-flex-frozen'),
        beforeFlatRootHeight: el.getAttribute(FLAT_ROOT_HEIGHT_ATTR),
        pinnedStyle: null,
        isContainer: false,
        children: [],
      };
      group.records.set(el, record);
    }
    if (isContainer) record.isContainer = true;
    return record;
  }

  function registerFlowUnlockGroupMember(group, el) {
    let memberships = state.flowUnlockGroups.get(el);
    if (!memberships) {
      memberships = [];
      state.flowUnlockGroups.set(el, memberships);
    }
    if (!memberships.includes(group)) memberships.push(group);
  }

  function refreshFlowUnlockDiagnostics() {
    let recordCount = 0;
    for (const group of state.flowUnlockGroupRegistry) {
      recordCount += group.records.size;
    }
    root.dataset.flowUnlockGroupCount = String(state.flowUnlockGroupRegistry.size);
    root.dataset.flowUnlockRecordCount = String(recordCount);
  }

  function pruneInactiveFlowUnlockGroups() {
    if (state.flowUnlockGroupRegistry.size === 0) return;
    const retainedByHistory = new Set();
    for (const entry of state.history) {
      for (const transition of entry.flowGroupStates || []) {
        retainedByHistory.add(transition.group);
      }
    }

    let pruned = false;
    for (const group of [...state.flowUnlockGroupRegistry]) {
      if (group.active || retainedByHistory.has(group)) continue;
      for (const record of group.records.values()) {
        const memberships = state.flowUnlockGroups.get(record.el);
        if (!memberships) continue;
        const index = memberships.indexOf(group);
        if (index !== -1) memberships.splice(index, 1);
        if (memberships.length === 0) state.flowUnlockGroups.delete(record.el);
      }
      group.records.clear();
      state.flowUnlockGroupRegistry.delete(group);
      pruned = true;
    }
    if (pruned) refreshFlowUnlockDiagnostics();
  }

  function getActiveFlowUnlockGroup(el) {
    const memberships = state.flowUnlockGroups.get(el) || [];
    for (let i = memberships.length - 1; i >= 0; i--) {
      if (memberships[i].active) return memberships[i];
    }
    return null;
  }

  function prepareFlowUnlockGroup(ancestors, el, rootChildPin = null) {
    const containers = ancestors.filter(
      (container) => container.dataset.wfpEditFlexFrozen !== 'true'
    );
    const group = { records: new Map(), active: false };

    // Snapshot the whole group before the first write. In nested layouts an
    // outer pin mutates the inner container before that inner container is
    // pinned itself; recording up front preserves the genuine pre-unlock
    // style rather than an intermediate mechanical style.
    for (const container of containers) {
      const containerRecord = addFlowUnlockGroupMember(group, container, true);
      // Same filtered list pinContainerChildren pins, so records and pinning
      // agree — an unpinned <script> must not appear as a group member whose
      // retention could hold its container pinned on Reset.
      containerRecord.children = getPinnableContainerChildren(container);
      for (const child of containerRecord.children) {
        addFlowUnlockGroupMember(group, child);
      }
    }

    // v2.15 — direct child of the slide/flat root: the root joins the group
    // as a container member (its flex-frozen latch must restore on Reset/
    // undo) and every child pinRootChildren is about to pin is recorded, so
    // records and pinning agree — but pinRootChildren never writes a style
    // on the root itself. No latch check here: unlockToAbsolute only builds
    // a rootChildPin when there is genuinely something to pin, including the
    // stale-latch case where the root is already marked frozen.
    if (rootChildPin) {
      const rootRecord = addFlowUnlockGroupMember(group, rootChildPin.rootEl, true);
      rootRecord.children = [...rootChildPin.children];
      for (const child of rootRecord.children) {
        addFlowUnlockGroupMember(group, child);
      }
    }

    // A lone direct child of the slide has no sibling to pin, but the
    // safety-net absolute conversion is still an unlock group of one.
    if (group.records.size === 0 && getComputedStyle(el).position !== 'absolute') {
      addFlowUnlockGroupMember(group, el);
    }

    if (group.records.size === 0) return getActiveFlowUnlockGroup(el);
    state.flowUnlockGroupRegistry.add(group);
    for (const record of group.records.values()) {
      registerFlowUnlockGroupMember(group, record.el);
    }
    setFlowUnlockGroupActive(group, true);
    refreshFlowUnlockDiagnostics();
    return group;
  }

  function recordFlowPin(group, el) {
    if (!group) return;
    const record = group.records.get(el);
    if (record) record.pinnedStyle = el.getAttribute('style');
  }

  function pinSnapshottedChildren(childRects, group) {
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
      // v2.14 — record the exact pinned style so the edit ledger can label
      // untouched pins as mechanical; any later user write diverges from it.
      state.pinnedStyles.set(m.child, m.child.getAttribute('style'));
      recordFlowPin(group, m.child);
    }
  }

  function pinContainerChildren(container, group = null) {
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

    pinSnapshottedChildren(childRects, group);
    container.dataset.wfpEditFlexFrozen = 'true';
    state.pinnedStyles.set(container, container.getAttribute('style'));
    recordFlowPin(group, container);
  }

  // v2.15 — with every flat-root child absolute, the root's intrinsic
  // height collapses and BODY-LEVEL siblings of the root (header/main/
  // footer pages) reflow. Hold the measured pre-pin height without inline
  // styles on the live root: stamp a data-wfp-edit-* marker and back it
  // with a dynamic rule in editor-owned CSS keyed to the marker's exact
  // value (precedent: applyOverviewCellDimensions). Rules are additive and
  // never removed — undo/Reset drop the ATTRIBUTE, which un-matches the
  // selector, and redo re-matches it. The export scrubber converts the
  // marker into inline height on the clone (persistFlatRootHeightOnExport)
  // because exported files carry neither editor CSS nor markers.
  let flatRootHeightStyleEl = null;
  const flatRootHeightRuleValues = new Set();

  function measureFlatRootCssHeight(rootEl) {
    // offsetHeight is the border-box height; translate to a `height` value
    // that reproduces it under the root's own box-sizing.
    const cs = getComputedStyle(rootEl);
    let cssHeight = rootEl.offsetHeight;
    if (cs.boxSizing !== 'border-box') {
      cssHeight -=
        (parseFloat(cs.paddingTop) || 0) +
        (parseFloat(cs.paddingBottom) || 0) +
        (parseFloat(cs.borderTopWidth) || 0) +
        (parseFloat(cs.borderBottomWidth) || 0);
    }
    return Math.max(0, Math.round(cssHeight * 100) / 100);
  }

  // The invariant a held height must preserve is the position of whatever
  // FOLLOWS the root, not the root's own border box. On a padding-less,
  // border-less root, margins collapse THROUGH it: the first child's top
  // margin is the root's top margin and the last child's bottom margin is
  // its bottom margin. Pinning the children absolute deletes both (an
  // out-of-flow child has no margin to collapse), and an explicit height
  // stops the bottom margin collapsing even before the children move — so
  // the plain border-box measurement leaves following content short by the
  // two collapsed margins (~48px in the reported case).
  //
  // The follow anchor is the root's next IN-FLOW sibling (editor chrome,
  // script tags, display:none and out-of-flow siblings are skipped: they
  // either must not be touched or do not move with the root's height). With
  // no such sibling, nothing follows the root and the invariant becomes the
  // root's own bottom edge — which is exactly its pre-pin margin-box
  // footprint, since the collapsed-through bottom margin is already baked
  // into where that edge sits.
  //
  // Anchors are read in LAYOUT space (offsetTop/offsetHeight), never through
  // getBoundingClientRect: layout offsets are unaffected by transforms and
  // by scrolling, so the residual is already in the same units as the CSS
  // height being written. A rect-based residual would need to be divided by
  // the scale of the root's ANCESTORS but not by the root's own — dividing
  // by the root's own scale (as an earlier revision did via getCanvasScale)
  // overshoots by exactly 1/scale when the flat root itself is transformed.
  function isFlowFollowerCandidate(el) {
    if (!isPinnableContainerChild(el)) return false;
    const cs = getComputedStyle(el);
    if (cs.position === 'absolute' || cs.position === 'fixed') return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 || rect.height > 0;
  }

  function readFlatRootFollowOffset(rootEl) {
    let sibling = rootEl.nextElementSibling;
    while (sibling && !isFlowFollowerCandidate(sibling)) {
      sibling = sibling.nextElementSibling;
    }
    // A follower and the root are siblings, so they share an offsetParent
    // and their offsets are directly comparable across a re-measure.
    if (sibling) return sibling.offsetTop;
    return rootEl.offsetTop + rootEl.offsetHeight;
  }

  function getPinnedRootChildren(rootEl) {
    return getPinnableRootChildren(rootEl).filter(
      (child) => child.dataset.wfpEditFrozen === 'true'
    );
  }

  // Solve for the height that puts the follow anchor back on its target.
  // One correction is exact wherever the anchor is linear in the root's
  // height (block and flex-column flow); a second pass absorbs rounding.
  // If a pass does not improve on the previous residual — a stretched flex
  // item, a percentage height, a max-height cap — the best value so far is
  // restored, so the hold is never worse than the plain measurement.
  function solveFlatRootHeightHold(rootEl, target) {
    let best = parseFloat(rootEl.getAttribute(FLAT_ROOT_HEIGHT_ATTR));
    if (!Number.isFinite(best)) {
      applyFlatRootHeightHold(rootEl, measureFlatRootCssHeight(rootEl));
      best = parseFloat(rootEl.getAttribute(FLAT_ROOT_HEIGHT_ATTR));
    }
    let bestResidual = target - readFlatRootFollowOffset(rootEl);

    for (let pass = 0; pass < 2 && Math.abs(bestResidual) >= 1; pass++) {
      applyFlatRootHeightHold(rootEl, Math.max(0, best + bestResidual));
      const candidate = parseFloat(rootEl.getAttribute(FLAT_ROOT_HEIGHT_ATTR));
      const residual = target - readFlatRootFollowOffset(rootEl);
      if (Math.abs(residual) >= Math.abs(bestResidual)) {
        applyFlatRootHeightHold(rootEl, best);
        return;
      }
      best = candidate;
      bestResidual = residual;
    }
  }

  // v2.15 review round 4 — the hold is DERIVED state: it is only correct for
  // the set of children pinned RIGHT NOW, and that set keeps changing after
  // the pin that established it (a partial Reset returns some children to
  // flow, undo/redo move between pinned states, a later unlock pins the
  // remainder). A one-shot measurement therefore goes stale — and a stale
  // value reaches the export clone. Instead of special-casing each caller,
  // this re-derives the hold from live geometry and is called after every
  // transition that can change the pinned set.
  //
  // With no pinned child left the marker is dropped outright so the root
  // returns to natural layout; the dynamic CSS rule is keyed on the exact
  // attribute value, so removing the attribute un-matches it.
  function reconcileFlatRootHold(rootEl) {
    if (!rootEl || !rootEl.isConnected) return;
    if (rootEl.getAttribute('data-wfp-edit-flat-root') !== 'true') return;

    if (!getPinnedRootChildren(rootEl).length) {
      if (rootEl.hasAttribute(FLAT_ROOT_HEIGHT_ATTR)) {
        touchElement(rootEl);
        rootEl.removeAttribute(FLAT_ROOT_HEIGHT_ATTR);
      }
      // The TARGET deliberately survives an empty pinned set. Undoing the
      // delete or Reset that emptied it re-attaches pinned children into a
      // collapsed root, and solving back to the retained target is the only
      // way to restore the pre-delete geometry — adopting the collapsed
      // layout instead would freeze the very shift being repaired. A fresh
      // pin re-captures it (see pinRootChildren) so a content edit between
      // unlock cycles is not held against an outdated position.
      return;
    }

    if (!state.flatRootHoldTargets.has(rootEl)) {
      // Pins that arrived without an establishing measurement (redo of a
      // pin whose target was dropped by the undo). History has just made
      // this layout correct, so adopt it as the target.
      state.flatRootHoldTargets.set(rootEl, readFlatRootFollowOffset(rootEl));
      return;
    }

    touchElement(rootEl);
    solveFlatRootHeightHold(rootEl, state.flatRootHoldTargets.get(rootEl));
  }

  // History and group restores can change the pinned set of any root, and
  // there is at most one flat root per document, so re-deriving them all is
  // cheap and needs no separate bookkeeping to stay in sync.
  function reconcileFlatRootHolds() {
    document
      .querySelectorAll('[data-wfp-edit-flat-root="true"]')
      .forEach(reconcileFlatRootHold);
  }

  function applyFlatRootHeightHold(rootEl, cssHeight) {
    const value = String(Math.max(0, Math.round(cssHeight * 100) / 100));
    if (!flatRootHeightStyleEl) {
      flatRootHeightStyleEl = document.createElement('style');
      root.appendChild(flatRootHeightStyleEl);
    }
    if (!flatRootHeightRuleValues.has(value)) {
      flatRootHeightRuleValues.add(value);
      flatRootHeightStyleEl.textContent += `
        [${FLAT_ROOT_HEIGHT_ATTR}="${value}"] { height: ${value}px !important; }
      `;
    }
    rootEl.setAttribute(FLAT_ROOT_HEIGHT_ATTR, value);
  }

  // v2.15 — pinContainerChildren for the slide/flat root itself: identical
  // child pinning, but the root's inline style is never written. Native
  // slides own fixed 1920x1080 stylesheet dimensions, and the flat root's
  // contract is "no inline root mutation" (its positioning context comes
  // from the fixture stylesheet or the editor's
  // data-wfp-edit-flat-position-context CSS). The root still takes the
  // flex-frozen MARKER: it records that an active group owns the children,
  // it restores through the ordinary group/history machinery, and the export
  // scrubber already strips every data-wfp-edit-* attribute. Unlike a
  // container's latch it is not treated as a skip signal — see
  // unlockToAbsolute for why.
  function pinRootChildren(rootEl, children, group = null) {
    // No latch early-return: unlockToAbsolute passes only the children that
    // still need pinning, so a latch left behind by a partial Reset must not
    // suppress protection for the siblings that went back into flow.
    const isFlatRoot = rootEl.getAttribute('data-wfp-edit-flat-root') === 'true';

    const childRects = snapshotChildOffsets(children, rootEl);
    const rootRectBefore = rootEl.getBoundingClientRect();
    // The target is the position following content must keep while anything
    // under this root is pinned. Capture it whenever this pin ESTABLISHES
    // the hold — no child is pinned yet, so the layout being measured is the
    // natural one — which also refreshes it after content changed between
    // unlock cycles. A pin that merely extends an existing hold (the
    // stale-latch remainder) keeps the target it already has. Slides are
    // excluded: they own explicit stylesheet dimensions and never collapse.
    if (isFlatRoot && !getPinnedRootChildren(rootEl).length) {
      state.flatRootHoldTargets.set(rootEl, readFlatRootFollowOffset(rootEl));
    }
    touchElement(rootEl);
    pinSnapshottedChildren(childRects, group);

    // Derive the hold from the pinned set this pin just produced. Every
    // write happens inside one synchronous gesture step, so no intermediate
    // layout is ever painted.
    if (isFlatRoot) reconcileFlatRootHold(rootEl);

    // A padding-less root (typically document.body) can itself move when its
    // children leave the flow: the first child's margin no longer collapses
    // through it, so the root's border box slides up by that collapsed
    // margin and every pinned child — positioned relative to the root —
    // slides with it. Compensate by re-anchoring the pins against the
    // root's PRE-PIN viewport position so the visual result stays fixed.
    const rootRectAfter = rootEl.getBoundingClientRect();
    const scale = getCanvasScale() || 1;
    const shiftX = (rootRectBefore.left - rootRectAfter.left) / scale;
    const shiftY = (rootRectBefore.top - rootRectAfter.top) / scale;
    if (Math.abs(shiftX) > 0.5 || Math.abs(shiftY) > 0.5) {
      for (const m of childRects) {
        m.child.style.left = `${m.left + shiftX}px`;
        m.child.style.top = `${m.top + shiftY}px`;
        // Refresh the mechanical-pin records: the label and Reset paths
        // compare exact style strings, which the compensation just changed.
        state.pinnedStyles.set(m.child, m.child.getAttribute('style'));
        recordFlowPin(group, m.child);
      }
    }

    rootEl.dataset.wfpEditFlexFrozen = 'true';
    state.pinnedStyles.set(rootEl, rootEl.getAttribute('style'));
    recordFlowPin(group, rootEl);
  }

  function restoreOptionalAttribute(el, name, value) {
    if (value === null) el.removeAttribute(name);
    else el.setAttribute(name, value);
  }

  function flowUnlockRecordIsAtRest(record) {
    return (
      record.el.getAttribute('style') === record.beforeStyle &&
      record.el.getAttribute('data-wfp-edit-frozen') === record.beforeFrozen &&
      record.el.getAttribute('data-wfp-edit-flex-frozen') === record.beforeFlexFrozen &&
      record.el.getAttribute(FLAT_ROOT_HEIGHT_ATTR) === record.beforeFlatRootHeight
    );
  }

  function restoreFlowUnlockRecord(record) {
    const el = record.el;
    if (record.beforeStyle === null) el.removeAttribute('style');
    else el.setAttribute('style', record.beforeStyle);
    restoreOptionalAttribute(el, 'data-wfp-edit-frozen', record.beforeFrozen);
    restoreOptionalAttribute(el, 'data-wfp-edit-flex-frozen', record.beforeFlexFrozen);
    restoreOptionalAttribute(el, FLAT_ROOT_HEIGHT_ATTR, record.beforeFlatRootHeight);
  }

  function restoreFlowUnlockGroup(group, selectedEl) {
    if (!group || !group.records) return;
    const restorable = new Map();

    for (const record of group.records.values()) {
      const currentStyle = record.el.getAttribute('style');
      // The selected element is the explicit reset target. Other members are
      // mechanical only while they still equal the exact editor-written pin.
      // A member already restored by a prior partial reset is also safe. An
      // older group never owns a member claimed by a newer active group.
      restorable.set(
        record.el,
        getActiveFlowUnlockGroup(record.el) === group &&
          (
            record.el === selectedEl ||
            currentStyle === record.pinnedStyle ||
            currentStyle === record.beforeStyle
          )
      );
    }

    // A pinned container is a positioning dependency, not just another
    // mechanical style. If any direct child retains a later deliberate edit,
    // keep the container pinned so that edit's containing block and visual
    // position do not change underneath it. Repeat for nested containers.
    let changed = true;
    while (changed) {
      changed = false;
      for (const record of group.records.values()) {
        if (!record.isContainer || !restorable.get(record.el)) continue;
        const hasRetainedChild = record.children.some(
          (child) => group.records.has(child) && !restorable.get(child)
        );
        if (hasRetainedChild) {
          restorable.set(record.el, false);
          changed = true;
        }
      }
    }

    for (const record of group.records.values()) {
      if (!restorable.get(record.el) || flowUnlockRecordIsAtRest(record)) continue;
      touchElement(record.el);
      restoreFlowUnlockRecord(record);
    }

    // Retire completed provenance so subsequent ordinary edits use the
    // pristine originalStyles contract. The transition is part of the same
    // history entry, so undo reactivates the group and redo retires it again.
    // Measured BEFORE the hold is re-derived: a hold correction that another
    // group's surviving pins still require is not this group's residue.
    const fullyRestored = [...group.records.values()].every(flowUnlockRecordIsAtRest);

    // A partial restore returns some children to flow, which re-enables the
    // margin collapse the hold was compensating for. Re-derive it here, in
    // the same transaction, so the live document, undo, and the export clone
    // all see the corrected value.
    for (const record of group.records.values()) {
      if (record.isContainer) reconcileFlatRootHold(record.el);
    }

    if (fullyRestored) setFlowUnlockGroupActive(group, false);
  }

  function unlockToAbsolute(el) {
    const slide = getActiveSlide();

    // Walk every ancestor of `el` up to (but not including) the active slide
    // and pin each one. Outermost first so inner snapshots don't see outer
    // mutations. Pinning at every level keeps both immediate siblings
    // (block-flow reflow) and outer siblings (flex/grid redistribution)
    // stable in one pass. The slide itself is never dimension-pinned — it
    // has explicit 1920x1080 dimensions (or is the inline-untouchable flat
    // root); see pinRootChildren for how its direct children are protected.
    const ancestors = [];
    {
      let cur = el;
      while (cur && cur.parentElement && cur.parentElement !== slide) {
        ancestors.push(cur.parentElement);
        cur = cur.parentElement;
      }
    }
    ancestors.reverse(); // outermost first

    // v2.15 — `el` is a DIRECT child of the slide/flat root: there is no
    // intermediate container, but siblings still reflow when the target
    // leaves the flow, so pin the root's children without mutating the root
    // itself. Slides and the flat root are already positioning contexts
    // (foreign slides are absolute; the flat root gets position: relative
    // from the editor's data-wfp-edit-flat-position-context CSS). A static
    // NON-flat root cannot anchor absolute children without a write, so it
    // falls back to the ordinary container pin — inline position: relative
    // is acceptable there, and only there. Sibling detection counts only
    // PINNABLE children (see isPinnableRootChild): when the flat root is
    // document.body, the editor overlay and <script> elements are direct
    // siblings that must count for nothing and never be pinned. A root with
    // no pinnable sibling keeps the group-of-one safety net.
    //
    // The root's flex-frozen latch is NOT consulted as a skip signal. It
    // means "an active pin holds these children", and a partial group Reset
    // can outlive that: one deliberately-edited child keeps the whole root
    // latched (see restoreFlowUnlockGroup's container-retention pass) while
    // its siblings are restored to flow. Trusting the stale latch skipped
    // sibling protection entirely on the next unlock. The pin set is
    // therefore recomputed from the children that are still pinned — the
    // already-pinned ones are left untouched (re-pinning would clobber the
    // user's edit) and only the in-flow remainder is pinned.
    let rootChildPin = null;
    if (ancestors.length === 0 && slide && el.parentElement === slide) {
      const unpinnedChildren = getPinnableRootChildren(slide).filter(
        (child) => child.dataset.wfpEditFrozen !== 'true'
      );
      if (unpinnedChildren.length > 1) {
        const isFlatRoot = slide.getAttribute('data-wfp-edit-flat-root') === 'true';
        if (!isFlatRoot && getComputedStyle(slide).position === 'static') {
          ancestors.push(slide);
        } else {
          rootChildPin = { rootEl: slide, children: unpinnedChildren };
        }
      }
    }

    const unlockGroup = prepareFlowUnlockGroup(ancestors, el, rootChildPin);
    for (const container of ancestors) {
      pinContainerChildren(container, unlockGroup);
    }
    if (rootChildPin) {
      pinRootChildren(rootChildPin.rootEl, rootChildPin.children, unlockGroup);
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
      state.pinnedStyles.set(el, el.getAttribute('style')); // v2.14 — see pinContainerChildren
      recordFlowPin(unlockGroup, el);
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
  // Adaptive inspector fade (v2.12 — design 7 + smart overlap gate)
  //
  // ONE RULE: any live manipulation — drag-move, resize, font scrub/steppers,
  // opacity slider, weight/align commits, inline text edit — dissolves the
  // inspector to a whisper so the selection reflows in full view, and pins
  // the lit coral value tag to it. Chrome restores ~380ms after the gesture
  // ends; an open text edit holds the fade until it commits.
  //
  // THE GATE: the panel only fades when the selection's bounding box
  // actually intersects the inspector's live rectangle. The check runs per
  // gesture and re-runs on every move, so a drag fades the panel the moment
  // the element passes beneath it and releases it on the way out. The value
  // tag shows regardless of overlap — it's useful feedback either way. The
  // toolbar never fades: it's the anchor.
  //
  // Call sites: onMouseMove/onMouseUp + onResizeMove/onResizeUp (80/90),
  // startTextEdit/endTextEdit (90), nudgeFontSizeWithHistory (60), the
  // opacity slider + seg commits (30), and the font-scrub field below.
  // ===========================================================================
  const FADE_RESTORE_MS = 380;
  const SCRUB_PX_PER_STEP = 3; // pointer px per 1 font px
  const SCRUB_DEADZONE_PX = 3; // under this it's a click-to-type, not a scrub
  let fadeRestoreTimer = null;

  function isScrubTagVisible() {
    return scrubTag.dataset.show === 'true';
  }

  function rectsOverlap(a, b) {
    return a.right > b.left && a.left < b.right && a.bottom > b.top && a.top < b.bottom;
  }

  function getLiveSelectionRect() {
    const members = state.editingText && state.editingText.el.isConnected
      ? [state.editingText.el]
      : getSelectedElements();
    let rect = null;
    for (const el of members) {
      const r = el.getBoundingClientRect();
      if (r.width <= 0 && r.height <= 0) continue;
      rect = rect
        ? {
          left: Math.min(rect.left, r.left),
          top: Math.min(rect.top, r.top),
          right: Math.max(rect.right, r.right),
          bottom: Math.max(rect.bottom, r.bottom),
        }
        : { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
    }
    return rect;
  }

  function selectionOverlapsInspector() {
    // A folded dock clips the panel's paint but not its measured rect, so
    // the gate is hard-false unless the segment is actually on screen.
    if (inspectorDock.dataset.visible !== 'true') return false;
    const sel = getLiveSelectionRect();
    if (!sel) return false;
    return rectsOverlap(sel, inspector.getBoundingClientRect());
  }

  function positionScrubTag() {
    const sel = getLiveSelectionRect();
    if (!sel) return;
    scrubTag.style.left = `${Math.max(2, sel.left)}px`;
    scrubTag.style.top = `${Math.max(2, sel.top - 26)}px`;
  }

  // Gesture start AND every move: re-run the gate, refresh the tag.
  // tagText == null means fade-only (text edit, multi-element drag).
  function liveEditUpdate(tagText) {
    clearTimeout(fadeRestoreTimer);
    fadeRestoreTimer = null;
    inspector.dataset.fade = selectionOverlapsInspector() ? 'true' : 'false';
    if (tagText != null && getSelectedElements().length === 1) {
      scrubTag.textContent = tagText;
      scrubTag.dataset.show = 'true';
      positionScrubTag();
      hideDimBubble();
    }
  }

  // Gesture end — settle after a beat so a burst of steps or keystrokes
  // doesn't flicker the chrome between clicks.
  function liveEditEnd() {
    clearTimeout(fadeRestoreTimer);
    fadeRestoreTimer = setTimeout(() => {
      fadeRestoreTimer = null;
      scrubTag.dataset.show = 'false';
      // An open text edit holds the fade until endTextEdit releases it.
      if (!state.editingText) inspector.dataset.fade = 'false';
      refreshSelection(); // restore the dim bubble / selection chrome
    }, FADE_RESTORE_MS);
  }

  // One-shot triggers (steppers, slider ticks, seg commits).
  function liveEditBlip(tagText) {
    liveEditUpdate(tagText);
    liveEditEnd();
  }

  function onTextEditInput() {
    // Typing reflows the element — re-test the overlap as it grows/shrinks.
    liveEditUpdate(null);
  }
  function textEditFadeStart(el) {
    el.addEventListener('input', onTextEditInput);
    liveEditUpdate(null);
  }
  function textEditFadeEnd(el) {
    el.removeEventListener('input', onTextEditInput);
    liveEditEnd();
  }

  // ---------------------------------------------------------------------------
  // FONT is a scrubbable value field (design 7): drag left/right on the
  // field to change size ~1px per 3px dragged. The ± steppers stay for fine
  // single steps; a clean click (no move past the deadzone) hands focus to
  // the input for an exact typed value, so the v2.3 commit-on-Enter/blur
  // contract is untouched. One scrub gesture = one history entry, same as
  // the opacity slider drag. No max clamp — decks legitimately use display
  // sizes past the reference's 96px.
  // ---------------------------------------------------------------------------
  let fontScrubSession = null; // { pointerId, startX, startPx, target, moved, restoreCtx }
  let suppressFieldClickFocus = false;

  // The field wrap is a <label>: even with the pointerdown default
  // suppressed, the trailing click's label activation would focus the
  // input AFTER a scrub — leaving the keyboard captive to the field (a
  // follow-up Cmd+Z would read as typing and never reach undo). A clean
  // click grants focus explicitly in endFontScrub instead.
  fieldFontSize.wrap.addEventListener('click', (e) => {
    if (!suppressFieldClickFocus) return;
    suppressFieldClickFocus = false;
    e.preventDefault();
  });

  fieldFontSize.wrap.addEventListener('pointerdown', (e) => {
    // Self-heal a stale suppression flag (a pointercancel mid-scrub has no
    // trailing click to consume it).
    suppressFieldClickFocus = false;
    if (e.button !== 0) return;
    const el = state.selected;
    if (!el || hasMultiSelection() || !isTextBearing(el)) return;
    // A focused input owns its own drag semantics (in-field text selection).
    if (document.activeElement === inspectorInputs.fontSize) return;
    // Suppress native focus/text-drag; a clean click refocuses on pointerup.
    e.preventDefault();
    fontScrubSession = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startPx: Math.round(parseFloat(getComputedStyle(el).fontSize)) || FONT_SIZE_MIN_PX,
      target: el,
      moved: false,
      restoreCtx: null,
    };
    try {
      fieldFontSize.wrap.setPointerCapture(e.pointerId);
    } catch (_) {
      /* capture is best-effort — scrub still works via bubbling moves */
    }
  });

  fieldFontSize.wrap.addEventListener('pointermove', (e) => {
    const s = fontScrubSession;
    if (!s || e.pointerId !== s.pointerId) return;
    if (!s.target.isConnected) return;
    const dx = e.clientX - s.startX;
    if (!s.moved) {
      if (Math.abs(dx) < SCRUB_DEADZONE_PX) return;
      s.moved = true;
      s.restoreCtx = startInspectorTxn();
      touchElement(s.target);
    }
    const next = Math.max(FONT_SIZE_MIN_PX, s.startPx + Math.round(dx / SCRUB_PX_PER_STEP));
    s.target.style.fontSize = `${next}px`;
    populateFontSize(s.target, { forceInput: true });
    liveEditUpdate(`${next} px`);
    refreshSelection();
  });

  function endFontScrub(e) {
    const s = fontScrubSession;
    if (!s || e.pointerId !== s.pointerId) return;
    fontScrubSession = null;
    try {
      fieldFontSize.wrap.releasePointerCapture(s.pointerId);
    } catch (_) {
      /* already released */
    }
    if (s.moved) {
      suppressFieldClickFocus = true;
      endInspectorTxn(s.restoreCtx);
      liveEditEnd();
      return;
    }
    // Clean click — hand focus to the input for an exact typed value.
    inspectorInputs.fontSize.focus();
    inspectorInputs.fontSize.select();
  }
  fieldFontSize.wrap.addEventListener('pointerup', endFontScrub);
  fieldFontSize.wrap.addEventListener('pointercancel', endFontScrub);
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
    // v2.12 — entering edit mode on an occluded element is intent to see
    // it: fade the panel (no tag) for the whole edit, re-testing the
    // overlap as typing reflows the element.
    textEditFadeStart(el);
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
    textEditFadeEnd(el); // v2.12 — release the edit-long fade hold
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
    // v2.12 — live X/Y tag (single selection only) + overlap-gated fade,
    // re-tested on every move: the panel dims the moment the element passes
    // beneath it and lights back up on the way out. Runs before
    // refreshSelection so the dim bubble yields on the first tick.
    const dragTagText = (d.items || []).length === 1 && d.el && d.el.isConnected
      ? `X ${d.el.offsetLeft} · Y ${d.el.offsetTop}`
      : null;
    liveEditUpdate(dragTagText);
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
      liveEditEnd();
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
      try {
        const result = await new Promise((resolve) => {
          const tx = db.transaction(HANDLE_STORE_NAME, 'readonly');
          const req = tx.objectStore(HANDLE_STORE_NAME).get(location.href);
          req.onsuccess = () => resolve(req.result || null);
          req.onerror = () => resolve(null);
        });
        return result;
      } finally {
        db.close(); // release the connection even if the round-trip threw
      }
    } catch (_) {
      return null;
    }
  }

  async function storeBoundHandle(handle) {
    try {
      const db = await openHandleDb();
      try {
        await new Promise((resolve) => {
          const tx = db.transaction(HANDLE_STORE_NAME, 'readwrite');
          tx.objectStore(HANDLE_STORE_NAME).put(handle, location.href);
          tx.oncomplete = resolve;
          tx.onabort = resolve;
          tx.onerror = resolve;
        });
      } finally {
        db.close(); // release the connection even if the round-trip threw
      }
    } catch (_) {
      /* persistence is best-effort */
    }
  }

  async function forgetBoundHandle() {
    boundFileHandle = null;
    try {
      const db = await openHandleDb();
      try {
        await new Promise((resolve) => {
          const tx = db.transaction(HANDLE_STORE_NAME, 'readwrite');
          tx.objectStore(HANDLE_STORE_NAME).delete(location.href);
          tx.oncomplete = resolve;
          tx.onabort = resolve;
          tx.onerror = resolve;
        });
      } finally {
        db.close(); // release the connection even if the round-trip threw
      }
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
    // The write lands on the source file, in the source folder: relative asset
    // URLs must stay relative or the deck breaks as soon as its folder moves.
    // Downloads keep absolutizing — see buildExportClone.
    const options = { absolutizeAssets: false };
    // Live agent round-trip (v2.13): pause the watcher so our own write is
    // never mistaken for an external agent update; baseline is rebased
    // after a successful write, and the watcher resumes in finally. The
    // pause must come BEFORE the (async, v2.20) HTML build: a watcher tick
    // firing between snapshot and write would live-refresh the document and
    // then be overwritten by the stale snapshot, silently dropping the
    // agent's edit.
    agentWatchPause();
    try {
      // A save fired right after ready can race the still-in-flight
      // rehydration; wait for it so we reuse the stored handle instead of
      // opening a needless fresh picker.
      if (!boundFileHandle && handleRehydration) await handleRehydration;
      let handle = boundFileHandle;
      if (!handle) {
        // Acquire the handle BEFORE the build: the native picker must run
        // while the user gesture's transient activation is still fresh, and
        // the blob-payload fetches can take long enough to expire it.
        handle = await pickSourceHandle();
      } else if (!(await ensureHandleWritable(handle))) {
        showToast(document.body, 'Save cancelled — file access not granted.');
        return;
      }
      const html = await (noteCount > 0 ? buildHandoffExportHtml(options) : buildExportHtml(options));
      try {
        await writeHtmlToHandle(handle, html);
      } catch (err) {
        // Stale handle (file moved/renamed/deleted): drop it and re-pick
        // within the same user gesture, then retry once.
        await forgetBoundHandle();
        handle = await pickSourceHandle();
        await writeHtmlToHandle(handle, html);
      }
      await agentWatchSyncBaseline(handle);
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
    } finally {
      agentWatchResume();
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

  // Shared by absolutization and blob inlining. Global regexes are safe to
  // share here: replace() resets lastIndex and matchAll() clones.
  const CSS_URL_PATTERN = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*?))\s*\)/g;

  function absolutizeCssUrls(cssText, baseUrl) {
    if (!cssText || !cssText.includes('url(')) return cssText;
    return cssText.replace(
      CSS_URL_PATTERN,
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
    // A data: URI candidate (including ones the blob-inlining pass just
    // wrote) contains a comma, which the split below would cut in half —
    // leave such srcsets untouched rather than corrupt them.
    if (value.includes('data:')) return value;
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

  // Flat mode gives a statically-positioned flat root its positioning context
  // through an editor-stylesheet rule keyed on
  // data-wfp-edit-flat-position-context — deliberately, so the live document
  // keeps a pristine root with no inline style. The export drops both the
  // editor CSS and (via the data-wfp-edit-* sweep) the marker, so anything the
  // unlock pinned against that root would re-anchor to the viewport. Persist
  // the context as an inline declaration on the CLONE only, the same way
  // pinContainerChildren persists position:relative on pinned containers.
  // Must run before stripEditorArtifactsFromDocument removes the marker.
  function persistFlatPositionContext(root) {
    root
      .querySelectorAll('[data-wfp-edit-flat-position-context="true"]')
      .forEach((el) => {
        // setProperty merges into any existing inline style rather than
        // replacing it.
        el.style.setProperty('position', 'relative');
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
    let startupSlideCount = 0;
    getExportDeckRoots(root).forEach((deck) => {
      const slides = [...deck.querySelectorAll(':scope > .slide')];
      if (!slides.length) return;
      if (!startupSlideCount) startupSlideCount = slides.length;
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

    if (startupSlideCount) {
      synchronizeRecognizedHostCounters(root, 0, startupSlideCount);
    }
  }

  // ---------------------------------------------------------------------------
  // Blob-backed assets (v2.20)
  //
  // Self-extracting bundled decks mint session-scoped blob: URLs at load time
  // (Chart.js, custom-element components, images) and wire them into the DOM
  // as <script src="blob:..."> / <img src="blob:...">. Those URLs die with the
  // minting document, so serializing them produces a download that reopens
  // broken. While the editing session is alive the URLs still resolve, so the
  // export captures each payload up front — scripts become inline <script>
  // text, everything else becomes a data: URI — and rewrites the CLONE only.
  // Fetch failures leave the original reference untouched: a dead link in the
  // export is no worse than what serialization produced before.
  // ---------------------------------------------------------------------------
  // All three sequences the HTML script-data tokenizer reacts to must be
  // broken: a bare close tag, and the `<!--` … `<script` pair that enters
  // script-data-double-escaped state (where a later close tag no longer
  // terminates the element and the rest of the document is swallowed). The
  // inserted backslash is a no-op inside JS string literals, where these
  // sequences occur in real payloads; a regex literal containing `<script`
  // would change meaning, which we accept as vanishingly rare against the
  // guaranteed parse break.
  function escapeInlineScriptText(text) {
    return text
      .replace(/<\/script/gi, '<\\/script')
      .replace(/<script/gi, '<\\script')
      .replace(/<!--/g, '<\\!--');
  }

  function blobToDataUri(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  }

  function isBlobUrl(value) {
    return /^blob:/i.test((value || '').trim());
  }

  // Blob URLs contain no whitespace or commas, so they can be tokenized out
  // of composite values (srcset, css) without parsing the value's grammar —
  // which matters for srcset, where a naive comma split would cut any data:
  // URI candidate in half.
  const BLOB_URL_TOKEN = /blob:[^\s,)"']+/g;

  // Walk the same surfaces the absolutizer covers and record how each unique
  // blob: URL is used — a script src needs the payload as text, anything else
  // needs it as a data: URI (one URL can be both).
  function collectBlobUrlUsage(root) {
    const usage = new Map();
    const record = (url, kind) => {
      const key = (url || '').trim();
      if (!isBlobUrl(key)) return;
      const entry = usage.get(key) || { script: false, asset: false };
      entry[kind] = true;
      usage.set(key, entry);
    };
    // Editor chrome is removed from the clone, so its own blob refs would be
    // fetched and encoded for nothing.
    const skip = (el) => isInsideEditorRoot(el);

    root.querySelectorAll('script[src]').forEach((s) => {
      if (!skip(s)) record(s.getAttribute('src'), 'script');
    });

    const attrTargets = [
      ['[src]:not(script)', 'src'],
      ['link[href], image[href], use[href]', 'href'],
      ['[poster]', 'poster'],
      ['object[data]', 'data'],
    ];
    attrTargets.forEach(([selector, attr]) => {
      root.querySelectorAll(selector).forEach((el) => {
        if (!skip(el)) record(el.getAttribute(attr), 'asset');
      });
    });

    root.querySelectorAll('[srcset]').forEach((el) => {
      if (skip(el)) return;
      for (const m of (el.getAttribute('srcset') || '').matchAll(BLOB_URL_TOKEN)) {
        record(m[0], 'asset');
      }
    });

    const recordCssUrls = (cssText) => {
      if (!cssText || !cssText.includes('url(')) return;
      for (const m of cssText.matchAll(CSS_URL_PATTERN)) {
        record(m[1] ?? m[2] ?? (m[3] || '').trim(), 'asset');
      }
    };
    root.querySelectorAll('[style]').forEach((el) => {
      if (!skip(el)) recordCssUrls(el.getAttribute('style'));
    });
    root.querySelectorAll('style').forEach((style) => {
      if (!skip(style)) recordCssUrls(style.textContent);
    });

    return usage;
  }

  // Fetches every blob: payload the LIVE document references. Must run while
  // the session's blob URLs are still alive — i.e. before/independent of the
  // clone, whose rewrite is then synchronous. Never rejects: per-URL failures
  // are swallowed so one dead blob can't sink the whole export.
  async function collectBlobAssetPayloads() {
    const usage = collectBlobUrlUsage(document);
    const payloads = new Map();
    // Blob fetches are in-memory reads; resolve them concurrently so a
    // bundle with many assets doesn't stack up serial round-trips.
    await Promise.all(
      [...usage].map(async ([url, use]) => {
        try {
          const blob = await (await fetch(url)).blob();
          const entry = {};
          if (use.script) entry.text = await blob.text();
          if (use.asset) entry.dataUri = await blobToDataUri(blob);
          payloads.set(url, entry);
        } catch (_) {
          /* dead or foreign blob — leave its references as-is */
        }
      }),
    );
    return payloads;
  }

  function replaceBlobCssUrls(cssText, payloads) {
    if (!cssText || !cssText.includes('url(')) return cssText;
    return cssText.replace(CSS_URL_PATTERN, (match, doubleQuoted, singleQuoted, bare) => {
      const raw = (doubleQuoted ?? singleQuoted ?? bare ?? '').trim();
      const payload = payloads.get(raw);
      if (!payload || !payload.dataUri) return match;
      return `url("${payload.dataUri}")`;
    });
  }

  function inlineBlobAssets(root, payloads) {
    if (!payloads || !payloads.size) return;

    root.querySelectorAll('script[src]').forEach((s) => {
      const payload = payloads.get((s.getAttribute('src') || '').trim());
      if (!payload || payload.text === undefined) return;
      s.removeAttribute('src');
      s.textContent = escapeInlineScriptText(payload.text);
    });

    const attrTargets = [
      ['[src]:not(script)', 'src'],
      ['link[href], image[href], use[href]', 'href'],
      ['[poster]', 'poster'],
      ['object[data]', 'data'],
    ];
    attrTargets.forEach(([selector, attr]) => {
      root.querySelectorAll(selector).forEach((el) => {
        const payload = payloads.get((el.getAttribute(attr) || '').trim());
        if (payload && payload.dataUri) el.setAttribute(attr, payload.dataUri);
      });
    });

    root.querySelectorAll('[srcset]').forEach((el) => {
      const value = el.getAttribute('srcset') || '';
      // Substitute blob tokens in place instead of splitting the srcset on
      // commas — a comma split would corrupt any data: URI candidate (and
      // srcsets without blobs must come through byte-identical).
      if (!value.includes('blob:')) return;
      const rewritten = value.replace(BLOB_URL_TOKEN, (url) => {
        const payload = payloads.get(url);
        return payload && payload.dataUri ? payload.dataUri : url;
      });
      if (rewritten !== value) el.setAttribute('srcset', rewritten);
    });

    root.querySelectorAll('[style]').forEach((el) => {
      const value = el.getAttribute('style');
      const rewritten = replaceBlobCssUrls(value, payloads);
      if (rewritten !== value) el.setAttribute('style', rewritten);
    });
    root.querySelectorAll('style').forEach((style) => {
      const rewritten = replaceBlobCssUrls(style.textContent, payloads);
      if (rewritten !== style.textContent) style.textContent = rewritten;
    });
  }

  // absolutizeAssets is a property of the DESTINATION, not of the pipeline:
  // a downloaded copy leaves the deck's folder and needs absolute asset URLs
  // to keep resolving, while save-in-place rewrites the source file in its own
  // folder, where absolutizing would freeze the deck to one machine path.
  // Default true so every download call site keeps its behaviour.
  function buildExportClone({ absolutizeAssets = true, blobPayloads = null } = {}) {
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

    persistFlatPositionContext(clone);
    // Blob inlining happens regardless of destination — session-scoped URLs
    // are dead after this session whether the file is saved in place or
    // downloaded — and before absolutization, which skips blob: anyway.
    inlineBlobAssets(clone, blobPayloads);
    if (absolutizeAssets) absolutizeExportAssetUrls(clone);
    removeRuntimeGeneratedProgressDots(clone);
    normalizeExportStartupState(clone);
    persistFlatRootHeightOnExport(clone);

    return clone;
  }

  // v2.15 — a direct-child unlock keeps the LIVE flat root inline-clean:
  // its measured height lives in the FLAT_ROOT_HEIGHT_ATTR marker plus a
  // dynamic rule in editor-owned CSS. Exports drop the editor root (and its
  // CSS) and sweep every data-wfp-edit-* attribute, so the exported page
  // would re-collapse and reflow content below the root. Convert the marker
  // into inline height on the CLONE only, before the attribute sweep. Named
  // distinctly from PR #14's flat-position-context persistence so the two
  // sit side by side once that lands.
  function persistFlatRootHeightOnExport(clone) {
    clone.querySelectorAll(`[${FLAT_ROOT_HEIGHT_ATTR}]`).forEach((el) => {
      const value = parseFloat(el.getAttribute(FLAT_ROOT_HEIGHT_ATTR));
      if (Number.isFinite(value) && value >= 0) {
        el.style.height = `${value}px`;
      }
    });
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

  // ===========================================================================
  // Handoff ground truth (v2.14)
  //
  // Two additive payload sections for handoff exports: an edit ledger (one
  // entry per user-touched element whose inline style differs from its
  // pristine pre-edit value) and box/computed/overflow measurements on both
  // ledger entries and annotations. Measurements MUST come from the live
  // document — the export clone is never laid out.
  // ===========================================================================
  function roundToTenth(value) {
    return Math.round(value * 10) / 10;
  }

  function measureElementBox(el) {
    const box = getSlideBox(el);
    return {
      left: roundToTenth(box.left),
      top: roundToTenth(box.top),
      width: roundToTenth(box.width),
      height: roundToTenth(box.height),
    };
  }

  function measureElementComputed(el) {
    const cs = getComputedStyle(el);
    return {
      fontSize: cs.fontSize,
      fontWeight: cs.fontWeight,
      color: cs.color,
      backgroundColor: cs.backgroundColor,
      position: cs.position,
    };
  }

  function hasFreezeMarker(el) {
    return (
      !!el &&
      (el.hasAttribute('data-wfp-edit-frozen') ||
        el.hasAttribute('data-wfp-edit-flex-frozen'))
    );
  }

  function measureElementOverflow(el) {
    // Content clipping. Descender glyphs on sub-1 line-height text paint a few
    // px below the content box, edging scrollHeight past clientHeight on an
    // element that never visually clips. Allow vertical slop proportional to
    // font-size — a genuinely clipped line adds ~a full font-size, far more
    // than descender overhang. (BUG-002)
    const fontSize = parseFloat(getComputedStyle(el).fontSize) || 0;
    const vTolerance = Math.max(1, fontSize * 0.25);
    if (
      el.scrollWidth > el.clientWidth + 1 ||
      el.scrollHeight > el.clientHeight + vTolerance
    ) {
      return true;
    }
    const parent = el.parentElement;
    if (!parent) return false;
    // Parent-escape check. A flow-unlock/freeze pins the parent to its pre-edit
    // footprint and stamps both the dragged child and its siblings. In that
    // state the parent box is stale layout, not a containment boundary — a
    // deliberate drag past it is not clipping, so skip this check. (BUG-001)
    if (hasFreezeMarker(el) || hasFreezeMarker(parent)) return false;
    const rect = el.getBoundingClientRect();
    const parentRect = parent.getBoundingClientRect();
    return (
      rect.left < parentRect.left - 1 ||
      rect.top < parentRect.top - 1 ||
      rect.right > parentRect.right + 1 ||
      rect.bottom > parentRect.bottom + 1
    );
  }

  function measureElementForHandoff(el) {
    return {
      box: measureElementBox(el),
      computed: measureElementComputed(el),
      overflow: measureElementOverflow(el),
    };
  }

  function generateEditLedgerId() {
    const time = Date.now().toString(36);
    const rand = Math.random().toString(36).slice(2, 8);
    return `edit-${time}-${rand}`;
  }

  // Mechanical = unlock/freeze pinning written by the editor, not user
  // intent. The frozen markers alone cannot make that call: the freeze
  // stamps the DRAGGED element exactly like its pinned siblings, and the
  // user's move happens inside the same transaction. So an entry is
  // mechanical only while its element's inline style is still exactly what
  // the pin wrote (state.pinnedStyles) — the moment the user drags,
  // resizes, or restyles the element, its style diverges and the entry
  // reads as user intent.
  function isLedgerMechanical(el) {
    if (
      !el.hasAttribute('data-wfp-edit-frozen') &&
      !el.hasAttribute('data-wfp-edit-flex-frozen')
    ) {
      return false;
    }
    if (!state.pinnedStyles.has(el)) return true; // marker without a pin record — trust the marker
    return el.getAttribute('style') === state.pinnedStyles.get(el);
  }

  // Builds the ledger from state.editedElements and stamps each entry's id
  // onto its LIVE element. The caller clones the document while the stamps
  // are present (so entries anchor deterministically in the export) and
  // must unstamp immediately after — see buildHandoffExportHtml.
  function collectEditLedger() {
    const entries = [];
    const stamped = [];
    try {
      for (const el of state.editedElements) {
        if (!el || !el.isConnected || isInsideEditorRoot(el)) continue;
        if (!state.originalStyles.has(el)) continue;
        const before = state.originalStyles.get(el);
        const after = el.getAttribute('style');
        if (before === after) continue; // edited then fully undone
        const id = generateEditLedgerId();
        el.setAttribute(EDIT_LEDGER_TARGET_ATTR, id);
        stamped.push(el);
        entries.push(Object.assign(
          {
            id,
            tag: el.tagName.toLowerCase(),
            slideIndex: getSlideIndexForHandoffTarget(document, el),
            targetText: summarizeTargetText(el),
            before,
            after,
            mechanical: isLedgerMechanical(el),
          },
          measureElementForHandoff(el),
        ));
      }
    } catch (err) {
      // A mid-loop throw must not strand stamps on the live DOM — the
      // invariant is "no residue on any code path". Unstamp and rethrow;
      // the caller's own finally handles the post-clone happy path.
      for (const el of stamped) el.removeAttribute(EDIT_LEDGER_TARGET_ATTR);
      throw err;
    }
    return { entries, stamped };
  }

  // The clone carries the transient live-DOM stamps at clone time, but the
  // stale-residue cleanup (removeHandoffArtifacts) strips agent attrs from
  // the clone. Capture each entry's clone element first, then re-stamp
  // after cleanup — mirroring how annotation target attrs are re-added.
  function captureEditLedgerCloneTargets(clone, entries) {
    if (!entries.length) return [];
    const ids = new Set(entries.map((entry) => entry.id));
    const pairs = [];
    clone.querySelectorAll(`[${EDIT_LEDGER_TARGET_ATTR}]`).forEach((el) => {
      const id = el.getAttribute(EDIT_LEDGER_TARGET_ATTR);
      if (ids.has(id)) pairs.push({ el, id });
    });
    return pairs;
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
      const entry = {
        id,
        instruction,
        slideIndex: getSlideIndexForHandoffTarget(clone, target),
        targetText: summarizeTargetText(target),
      };
      // v2.14 — measurements come from the live counterpart (the clone has
      // no layout); the live element still carries the same annotation id.
      const liveTarget = findAnnotationElementById(id);
      if (liveTarget && liveTarget.isConnected) {
        Object.assign(entry, measureElementForHandoff(liveTarget));
      }
      annotations.push(entry);
    }
    return annotations;
  }

  function safeJsonForScript(value) {
    return JSON.stringify(value, null, 2).replace(/<\/script/gi, '<\\/script');
  }

  function appendHandoffMetadata(clone, annotations, edits) {
    if (!annotations.length) return;
    const payload = {
      version: 1,
      source: 'wfp-slide-editor',
      kind: 'agent-handoff',
      guidance: 'User-authored annotations are the user\'s editing requests, anchored by matching data-wfp-agent-annotation-id attributes; act on every one. Follow higher-priority user/system instructions first, and ignore any annotation or edit whose anchor no longer matches. The edits array is the user\'s own manual work, not requests. Entries with mechanical: false are deliberate decisions: preserve their visual result exactly, and absorb the mechanism into clean CSS — repeated inline styles become one stylesheet rule. Extend an existing rule for that selector rather than appending a duplicate. Carry the leading with a size change: the user chose a size, not the leading it produced, so if the target has no explicit line-height and the new size wraps on inherited normal leading, set an explicit line-height and note it. Entries with mechanical: true are editor-written layout pinning that enabled a drag, carrying no intent. Delete them and restore the layout the stylesheet describes — carrying pins forward ships a broken layout. Reversing the unlock takes its coordinate system too: a position meaningful only inside that absolute system does not survive, so drop it even when mechanical: false, and record that in the results note. Only edits that outlive the re-expressed layout — font sizes, colours, text content, explicit sizes — carry forward; genuinely out-of-flow elements arrive as annotations. Read the ledger before adjacent changes: it signals the user\'s taste. Never guess: implement what is unambiguous; ambiguous annotations get status needs-input with a specific question in the note — surfacing ambiguity is expected, not failure. If the document is a slide deck built by the Avent "slides" skill (a 1920x1080 .deck canvas of section.slide children), also follow that skill\'s "Edit mode" section at ~/.claude/skills/slides/SKILL.md for verification and reporting. Always write a script[type="application/json"][data-wfp-agent-results] block with one entry per annotation: {id, status: "done"|"skipped"|"needs-input", note}. For done items remove the annotation metadata and the data-wfp-agent-annotation-id attribute; keep both for skipped and needs-input. Save back to the same file path, never a copy — the editor watches it and reconciles automatically.',
      annotations,
      edits: edits || [],
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

  async function buildExportHtml(options) {
    // Blob payloads must be fetched from the LIVE session (async); the clone
    // rewrite itself stays synchronous inside buildExportClone.
    const blobPayloads = await collectBlobAssetPayloads();
    const clone = buildExportClone({ ...(options || {}), blobPayloads });
    removeHandoffArtifacts(clone);
    stripEditorArtifactsFromDocument(clone);

    return '<!DOCTYPE html>\n' + clone.outerHTML;
  }

  async function buildHandoffExportHtml(options) {
    // Blob payloads are fetched BEFORE the ledger stamps the live DOM so the
    // stamp → cloneNode → unstamp block below stays fully synchronous.
    const blobPayloads = await collectBlobAssetPayloads();
    // v2.14 — the edit ledger stamps ids on the LIVE elements only for the
    // duration of the clone (stamp → cloneNode → unstamp, all synchronous)
    // so the live document never retains data-wfp-agent-edit-id.
    const ledger = collectEditLedger();
    let clone;
    try {
      clone = buildExportClone({ ...(options || {}), blobPayloads });
    } finally {
      for (const el of ledger.stamped) el.removeAttribute(EDIT_LEDGER_TARGET_ATTR);
    }
    const ledgerTargets = captureEditLedgerCloneTargets(clone, ledger.entries);
    removeHandoffArtifacts(clone);
    const annotations = collectHandoffAnnotations(clone);
    // Re-anchor ledger entries after the stale-residue cleanup, same as
    // annotation target attrs are re-added post-cleanup above.
    for (const pair of ledgerTargets) pair.el.setAttribute(EDIT_LEDGER_TARGET_ATTR, pair.id);
    stripEditorArtifactsFromDocument(clone);
    appendHandoffMetadata(clone, annotations, ledger.entries);

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

  // Both download exports are dispatched fire-and-forget from click/keydown
  // handlers, so a failure would otherwise surface only as an unhandled
  // rejection — catch locally and toast, mirroring saveInPlace.
  async function exportHTML() {
    // If a text edit is open, commit it first so the latest content lands
    // in the export.
    if (state.editingText) endTextEdit();

    const filename = deriveExportFilename();
    try {
      const html = await buildExportHtml();
      triggerDownload(filename, html);
      showToast(document.body, `Exported to ${filename}`);
    } catch (err) {
      showToast(document.body, `Export failed (${(err && err.name) || 'unknown'}).`);
    }
  }

  async function exportHandoffHTML() {
    if (state.editingText) endTextEdit();

    const annotations = getAnnotatedElements(document);
    if (!annotations.length) {
      refreshExportUi();
      return;
    }
    const filename = deriveExportFilename('-agent-handoff');
    try {
      const html = await buildHandoffExportHtml();
      triggerDownload(filename, html);
      showToast(document.body, `Exported handoff to ${filename}`);
    } catch (err) {
      showToast(document.body, `Export failed (${(err && err.name) || 'unknown'}).`);
    }
  }
  // ===========================================================================
  // Live agent round-trip (v2.13)
  //
  // When an agent rewrites the bound save-in-place file on disk, the editor
  // refreshes the document in place: no reload, no bookmarklet re-click, no
  // permission re-grant. Contract in REQUIREMENTS.md (“Live Agent
  // Round-trip”); design rationale in DESIGN.md; build record in
  // feature-briefs/v2.13-live-agent-roundtrip.md.
  //
  // Mechanism:
  //   - Poll boundFileHandle.getFile().lastModified (~1.2s).
  //   - On an external change: stash a restore payload on window (the
  //     window object and its globals survive document.open() — only the
  //     Document's contents and its event listeners are replaced), then
  //     document.open()/write()/close() the new HTML. That erases
  //     document-level listeners (the deck's stale nav handler and the old
  //     editor's own keydown capture) and re-executes deck scripts exactly
  //     once during the write. Finally re-inject the editor script
  //     captured at boot.
  //   - The new instance adopts the payload at ready: same file handle,
  //     edit mode, active slide, fold states — and deckMutated, because
  //     the re-parsed deck script's closures reset to slide 0, which is
  //     exactly the staleness deckMutated's arrow-nav takeover covers.
  // ===========================================================================
  const AGENT_WATCH_INTERVAL_MS = 1200;
  const LIVE_RESTORE_KEY = '__wfpLiveRefreshRestore';

  // Boot generation counter — test-observable signal that a fresh editor
  // instance finished evaluating (initial load = 1, first refresh = 2, ...).
  window.__wfpEditorGeneration = (window.__wfpEditorGeneration || 0) + 1;

  // Captured while this script evaluates: how to re-inject the editor after
  // document.write() wipes the DOM. Bookmarklet loads carry a src; dev /
  // Playwright addScriptTag injection is inline text.
  const editorScriptRef = (() => {
    const cs = document.currentScript
      || document.querySelector('script[data-wfp-edit-script], script[src*="editor.js"]');
    if (!cs) return null;
    return cs.src ? { src: cs.src } : { text: cs.textContent };
  })();

  let agentWatchTimer = null;
  let agentWatchBaseline = null; // lastModified of the content we last wrote/adopted
  let agentWatchPaused = false;
  let agentWatchBusy = false;

  function agentWatchPause() {
    agentWatchPaused = true;
  }

  function agentWatchResume() {
    agentWatchPaused = false;
  }

  // "Paused" has been announced and "resumed" hasn't yet. The flag only
  // gates the two announcements — a recovered handle refreshes regardless.
  let watchDormant = false;

  // Called after our own successful save so the watcher never mistakes the
  // editor's write for an agent update. A successful save is also the
  // re-link moment when the watch had gone dormant.
  async function agentWatchSyncBaseline(handle) {
    try {
      if (handle && typeof handle.getFile === 'function') {
        const f = await handle.getFile();
        agentWatchBaseline = f.lastModified;
        if (watchDormant) {
          watchDormant = false;
          showToast(document.body, 'Live updates resumed.');
        }
      }
    } catch (_) {
      /* keep the old baseline; the next tick retries */
    }
  }

  // A refresh must not fire mid-interaction: the swap would destroy open
  // transactions, text edits, drags, or overlay state. Deferring instead of
  // dropping works because the baseline only advances on a successful swap,
  // so the next idle tick picks the change up again.
  function isInteractionOpen() {
    return !!(
      state.txn ||
      state.editingText ||
      state.drag ||
      state.resize ||
      state.overviewMode ||
      state.exportMenuOpen
    );
  }

  async function agentWatchTick() {
    if (agentWatchPaused || agentWatchBusy) return;
    const handle = boundFileHandle;
    if (!handle || typeof handle.getFile !== 'function') return;
    agentWatchBusy = true;
    try {
      const f = await handle.getFile();
      if (agentWatchBaseline === null) {
        // First sight of the file (e.g. a handle rehydrated from IndexedDB
        // before any save this session): adopt the current mtime instead of
        // treating pre-existing history as a change.
        agentWatchBaseline = f.lastModified;
        return;
      }
      if (f.lastModified <= agentWatchBaseline) return;
      if (isInteractionOpen()) return; // deferred — retried next tick
      const html = await f.text();
      // Re-check after the awaits: a save may have paused the watcher while
      // this tick was in flight. (The baseline guard defuses this in
      // practice; the check makes the invariant explicit.)
      if (agentWatchPaused) return;
      agentWatchBaseline = f.lastModified;
      await performLiveRefresh(html, f.lastModified);
    } catch (err) {
      const name = err && err.name;
      if ((name === 'NotAllowedError' || name === 'SecurityError') && !watchDormant) {
        watchDormant = true;
        showToast(document.body, 'Live updates paused — file access needed. Save to re-link.');
      }
      /* other read failures are transient — retry next tick */
    } finally {
      agentWatchBusy = false;
    }
  }

  function startAgentWatch() {
    if (agentWatchTimer) return;
    agentWatchTimer = setInterval(agentWatchTick, AGENT_WATCH_INTERVAL_MS);
  }

  function captureActiveSlideIndex() {
    const slides = getSlides();
    return Math.max(0, slides.findIndex((s) => s.classList.contains('active')));
  }

  async function performLiveRefresh(html, lastModified) {
    // The old instance orchestrates its own replacement. Stop the poll and
    // detach our window-level listeners: document-level listeners are
    // erased by document.open(), window-level ones are not guaranteed to
    // be — the spike's probe measures which, this is belt and braces.
    clearInterval(agentWatchTimer);
    agentWatchTimer = null;
    try {
      window.removeEventListener('scroll', scheduleOverviewReposition, true);
      window.removeEventListener('resize', scheduleOverviewReposition);
    } catch (_) {
      /* best-effort */
    }

    window[LIVE_RESTORE_KEY] = {
      handle: boundFileHandle,
      lastModified,
      editMode: state.editMode,
      slideIndex: captureActiveSlideIndex(),
      inspectorMinimised: state.inspectorMinimised,
      toolbarCollapsed: state.toolbarCollapsed,
    };

    // Replace the document wholesale. Same Document object, same realm,
    // same URL — but the children are replaced, document-level listeners
    // are erased, and <script> tags in the new HTML execute fresh during
    // the write, so the deck's own navigation rebinds to the new DOM.
    document.open();
    document.write(html);
    document.close();

    // Re-inject the editor. The saved file never contains the editor
    // (export strips it), so the ROOT_ID singleton guard passes.
    if (editorScriptRef) {
      const s = document.createElement('script');
      if (editorScriptRef.src) s.src = editorScriptRef.src;
      else s.textContent = editorScriptRef.text;
      (document.body || document.documentElement).appendChild(s);
    }
  }

  // Runs in the NEW instance at ready: adopt what the old instance left.
  function adoptLiveRefreshState() {
    const payload = window[LIVE_RESTORE_KEY];
    if (!payload) return;
    delete window[LIVE_RESTORE_KEY];

    if (payload.handle) {
      boundFileHandle = payload.handle;
      agentWatchBaseline = typeof payload.lastModified === 'number' ? payload.lastModified : null;
    }

    // Flat documents have no slide pagination: getSlides() returns the flat
    // root itself, and toggling `active` there would stamp a class onto a
    // user element that export never strips.
    if (getDocumentMode() !== 'flat') {
      const slides = getSlides();
      const idx = Math.min(payload.slideIndex || 0, slides.length - 1);
      if (idx >= 0 && slides[idx]) {
        synchronizeSlideState(slides[idx]);
      }
      // The re-parsed deck script cached slide 0 as current; hand plain-view
      // arrow nav to the editor's fresh-DOM implementation, the same
      // mechanism used after overview reorder/delete.
      state.deckMutated = true;
    }

    state.inspectorMinimised = !!payload.inspectorMinimised;
    if (payload.toolbarCollapsed) setToolbarCollapsed(true);
    if (payload.editMode) setEditMode(true);
    // When the refreshed file carried a results block, the ready-time
    // summary toast is the more informative message — skip the generic one.
    if (!state.agentResultsSummary) {
      showToast(document.body, 'Reloaded from disk — agent update applied.');
    }
  }
  // ===========================================================================
  // Ready
  // ===========================================================================
  // v2.22 — Markdown mode. The host re-renders the document whenever the file
  // is written, which detaches every node the editor may be holding. `reset`
  // lets it drop the selection BEFORE that happens (a selection pointing at
  // detached DOM is the exact hazard the history layer guards against), and
  // `refresh` re-scans the freshly stamped annotations so markers and the
  // notes panel match the new file.
  if (state.markdownMode) {
    // Unlike a deck — which you might simply be viewing — the Markdown review
    // surface exists only to annotate, so starting in view mode is a step that
    // never has a reason to be skipped. Enter edit mode immediately.
    setEditMode(true);
    window.__wfpMarkdownBridge = {
      reset() {
        if (state.editingText) endTextEdit();
        setSelected(null);
        refreshInspector();
      },
      refresh() {
        refreshExportUi();
      },
    };
  }
  if (canSaveInPlace()) {
    // Capture the promise so saveInPlace() can await this same rehydration
    // instead of racing it (see the handleRehydration check above).
    handleRehydration = loadStoredHandle()
      .then((handle) => {
        if (handle && !boundFileHandle) boundFileHandle = handle;
      })
      .catch(() => {});
  }
  // Live agent round-trip (v2.13): adopt state handed over by a previous
  // instance across a document.write refresh, then watch the bound file
  // for external (agent) writes.
  adoptLiveRefreshState();
  if (canSaveInPlace()) startAgentWatch();
  consumeAgentResultsSummaryToast();
  window.__wfpEditorReady = true;
  console.log(`[wfp-editor] ready v${VERSION}`);
})();
