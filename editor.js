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
      // The selection ring sitting over a contenteditable target steals
      // visual attention from the caret. Hide it for the duration of the
      // text edit; refreshSelection will re-show it once edit ends.
      hideRing();
      return;
    }
    if (state.selected && state.selected.isConnected) {
      positionRing(state.selected);
    } else {
      hideRing();
    }
  }

  function setSelected(el) {
    state.selected = el || null;
    if (state.selected) positionRing(state.selected);
    else hideRing();
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
