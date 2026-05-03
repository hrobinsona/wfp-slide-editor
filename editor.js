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
 *
 * Internal class names use the `wfpe-` prefix so they don't collide with
 * the WFP fixtures' own `wfp-badge` / `wfp-*` classes.
 */
(function () {
  'use strict';

  const VERSION = '0.6.0-phase-6';
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

  // ===========================================================================
  // State
  // ===========================================================================
  const state = {
    editMode: false,
    selected: null,
    drag: null, // { el, startX, startY, anchorLeft, anchorTop, width, height, wasAbsolute, started }
    resize: null, // { el, dir, startX, startY, initLeft, initTop, initWidth, initHeight }
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
    #${ROOT_ID} .wfpe-mode-badge {
      position: fixed;
      top: 12px;
      right: 12px;
      pointer-events: auto;
      background: rgba(20, 20, 20, 0.85);
      color: #fff;
      font: 12px/1.2 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
      letter-spacing: 0.04em;
      padding: 6px 10px;
      border-radius: 4px;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.25);
      user-select: none;
      cursor: default;
    }
    #${ROOT_ID} .wfpe-mode-badge[data-mode="on"] {
      background: rgba(212, 114, 106, 0.95);
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

  const badge = document.createElement('div');
  badge.className = 'wfpe-mode-badge';
  badge.dataset.mode = 'off';
  badge.textContent = 'Edit: OFF';
  root.appendChild(badge);

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
  }

  function snapshotsEqual(a, b) {
    return a.style === b.style && a.frozen === b.frozen && a.flexFrozen === b.flexFrozen;
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
    badge.textContent = state.editMode ? 'Edit: ON' : 'Edit: OFF';
    if (!state.editMode) setSelected(null);
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
    if (isTypingTarget(e.target)) return;
    const noModifier = !e.metaKey && !e.ctrlKey && !e.altKey;

    if ((e.key === 'e' || e.key === 'E') && noModifier) {
      setEditMode(!state.editMode);
      return;
    }

    if (!state.editMode) return;

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
  }

  document.addEventListener('keydown', onKeyDown);

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
  // Promoting a flex/grid child to position:absolute removes it from the
  // parent's layout, so siblings reflow (e.g. gap/space-between redistributes
  // among the remaining N-1 children). To prevent that, we freeze the entire
  // container on first grab: snapshot every child's rect in slide-space, then
  // pin all of them as position:absolute at those captured pixels. The
  // dragged child is just one of N now-absolute children. Subsequent drags
  // inside the same container skip the freeze.
  //
  // For non-flex/grid parents, the simpler unlock-just-this-one-element path
  // still applies — sibling reflow isn't a concern there.
  // ---------------------------------------------------------------------------
  function isFlexOrGridContainer(el) {
    if (!el) return false;
    const display = getComputedStyle(el).display;
    return (
      display === 'flex' ||
      display === 'inline-flex' ||
      display === 'grid' ||
      display === 'inline-grid'
    );
  }


  function collectFlexAncestors(el) {
    // Returns flex/grid containers above `el`, ordered OUTERMOST FIRST so the
    // caller can freeze from the outside in. Outside-in matters: freezing the
    // outermost container first pins its children's outer rects before we
    // start mutating their internals, so each inner freeze still measures
    // children at their correct flex-flow positions.
    const slide = getActiveSlide();
    const containers = [];
    let cur = el;
    while (cur && cur.parentElement && cur !== slide) {
      if (isFlexOrGridContainer(cur.parentElement)) {
        containers.push(cur.parentElement);
      }
      cur = cur.parentElement;
    }
    return containers.reverse();
  }

  function snapshotChildOffsetsRelativeTo(container) {
    // Use offsetLeft/Top/Width/Height (transform-free, CSS-pixel) instead of
    // getBoundingClientRect (which includes any active CSS animation
    // transforms — fatal during the WFP slides' scaleIn entrance animation).
    //
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

  function unlockToAbsolute(el) {
    // Snapshot every ancestor flex/grid container BEFORE any writes, using
    // transform-free offset measurements so in-flight animations don't taint
    // the captured sizes. Then pin from outermost to innermost.
    const containers = collectFlexAncestors(el);
    const snapshots = containers.map((container) => {
      if (container.dataset.wfpEditFlexFrozen === 'true') return null;
      return {
        container,
        outerWidth: container.offsetWidth,
        outerHeight: container.offsetHeight,
        childRects: snapshotChildOffsetsRelativeTo(container),
        wasStatic: getComputedStyle(container).position === 'static',
      };
    });

    for (const snap of snapshots) {
      if (!snap) continue;
      const { container, outerWidth, outerHeight, childRects, wasStatic } = snap;
      touchElement(container);
      if (wasStatic) container.style.position = 'relative';
      // Pin the container's outer box. Once its children are all absolute,
      // its intrinsic content collapses and any outer block/flex flow would
      // shift. Caveat: if the container itself is a flex item with `flex: 1`
      // or stretch sizing in some non-flex outer context, this lock will
      // freeze its size to the captured pixels even if the viewport later
      // reflows. WFP slides are fixed 1920x1080 with one scale on .deck, so
      // viewport reflow doesn't apply here, but worth knowing.
      container.style.width = `${outerWidth}px`;
      container.style.height = `${outerHeight}px`;
      for (const m of childRects) {
        touchElement(m.child);
        m.child.style.position = 'absolute';
        m.child.style.left = `${m.left}px`;
        m.child.style.top = `${m.top}px`;
        m.child.style.width = `${m.width}px`;
        m.child.style.height = `${m.height}px`;
        m.child.dataset.wfpEditFrozen = 'true';
      }
      container.dataset.wfpEditFlexFrozen = 'true';
    }

    // Then promote the actual dragged element if it isn't already absolute.
    if (getComputedStyle(el).position !== 'absolute') {
      touchElement(el);
      el.style.position = 'absolute';
      el.style.left = `${el.offsetLeft}px`;
      el.style.top = `${el.offsetTop}px`;
      el.style.width = `${el.offsetWidth}px`;
      el.style.height = `${el.offsetHeight}px`;
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
  // Ready
  // ===========================================================================
  window.__wfpEditorReady = true;
  console.log(`[wfp-editor] ready v${VERSION}`);
})();
