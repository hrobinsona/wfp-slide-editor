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
