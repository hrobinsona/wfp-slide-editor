/* WFP Slide Editor
 *
 * Bookmarklet-loaded visual editor for WFP HTML presentations.
 * See REQUIREMENTS.md, DESIGN.md, TASKS.md.
 *
 * Phase 1: bootstrap + edit-mode toggle.
 *
 * Internal class names use the `wfpe-` prefix so they don't collide with
 * the WFP fixtures' own `wfp-badge` / `wfp-*` classes.
 */
(function () {
  'use strict';

  const VERSION = '0.1.0-phase-1';
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
  `;
  root.appendChild(styleEl);

  const badge = document.createElement('div');
  badge.className = 'wfpe-mode-badge';
  badge.dataset.mode = 'off';
  badge.textContent = 'Edit: OFF';
  root.appendChild(badge);

  document.body.appendChild(root);

  // ===========================================================================
  // Edit mode
  // ===========================================================================
  function setEditMode(value) {
    state.editMode = !!value;
    badge.dataset.mode = state.editMode ? 'on' : 'off';
    badge.textContent = state.editMode ? 'Edit: ON' : 'Edit: OFF';
  }

  function isTypingTarget(el) {
    if (!el) return false;
    const tag = el.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
    if (el.isContentEditable) return true;
    return false;
  }

  function onKeyDown(e) {
    if (e.key !== 'e' && e.key !== 'E') return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (isTypingTarget(e.target)) return;
    setEditMode(!state.editMode);
  }

  document.addEventListener('keydown', onKeyDown);

  // ===========================================================================
  // Ready
  // ===========================================================================
  window.__wfpEditorReady = true;
  console.log(`[wfp-editor] ready v${VERSION}`);
})();
