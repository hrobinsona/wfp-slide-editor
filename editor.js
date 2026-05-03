/* WFP Slide Editor
 *
 * Bookmarklet-loaded visual editor for WFP HTML presentations.
 * See REQUIREMENTS.md, DESIGN.md, TASKS.md.
 *
 * Phase 1: bootstrap + edit-mode toggle.
 * Phase 2: click-to-select inside .slide.active + selection ring.
 * Phase 3: ArrowUp/Down (and Shift+) nudge font-size on selected text element.
 *
 * Internal class names use the `wfpe-` prefix so they don't collide with
 * the WFP fixtures' own `wfp-badge` / `wfp-*` classes.
 */
(function () {
  'use strict';

  const VERSION = '0.3.0-phase-3';
  const FONT_SIZE_MIN_PX = 8;
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
  // Ready
  // ===========================================================================
  window.__wfpEditorReady = true;
  console.log(`[wfp-editor] ready v${VERSION}`);
})();
