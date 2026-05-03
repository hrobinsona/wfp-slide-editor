/* WFP Slide Editor
 *
 * Bookmarklet-loaded visual editor for WFP HTML presentations.
 * See REQUIREMENTS.md, DESIGN.md, TASKS.md.
 *
 * Phase 1: bootstrap + edit-mode toggle.
 * Phase 2: click-to-select inside .slide.active + selection ring.
 * Phase 3: ArrowUp/Down (and Shift+) nudge font-size on selected text element.
 * Phase 4: scale-aware drag, with unlock-on-flow conversion + toast.
 *
 * Internal class names use the `wfpe-` prefix so they don't collide with
 * the WFP fixtures' own `wfp-badge` / `wfp-*` classes.
 */
(function () {
  'use strict';

  const VERSION = '0.4.0-phase-4';
  const FONT_SIZE_MIN_PX = 8;
  const DRAG_DEADZONE_PX = 5;
  const TOAST_DURATION_MS = 2000;
  const POST_DRAG_CLICK_GUARD_MS = 250;
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
    suppressClickUntil: 0,
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
  }

  function hideRing() {
    ring.style.display = 'none';
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
      nudgeFontSize(state.selected, direction * step);
      refreshSelection();
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
    if (isInsideEditorRoot(e.target)) return;
    const target = findSelectableTarget(e.target);
    if (!target) return;

    setSelected(target);

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

  function commitUnlock(d) {
    // Convert the element to inline absolute positioning, anchored at its
    // current visual offset within its offsetParent.
    d.el.style.position = 'absolute';
    d.el.style.left = `${d.anchorLeft}px`;
    d.el.style.top = `${d.anchorTop}px`;
    d.el.style.width = `${d.width}px`;
    d.el.style.height = `${d.height}px`;
    showToast(d.el, 'Unlocked. Now positioned absolutely.');
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
    }
  }

  document.addEventListener('mousedown', onMouseDown, true);

  // ===========================================================================
  // Ready
  // ===========================================================================
  window.__wfpEditorReady = true;
  console.log(`[wfp-editor] ready v${VERSION}`);
})();
