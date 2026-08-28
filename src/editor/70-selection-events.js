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

  // ── Host gesture takeover (v2.23) ────────────────────────────────────────
  //
  // Host decks page on pointer events as well as on click:
  //
  //   deck.addEventListener('pointerup', (e) => show(
  //     e.clientX < innerWidth / 2 ? current - 1 : current + 1));
  //
  // `pointerup` fires BEFORE `click`, so neither onClick above nor
  // state.suppressClickUntil can ever observe it — the slide has already
  // changed by the time either runs, and the clicked element no longer belongs
  // to the active slide. The result is a deck that pages on every attempted
  // selection and cannot be edited at all.
  //
  // While edit or overview mode owns the canvas, take the whole gesture away
  // from the host. Same capture-phase precedent as the keyboard takeover.
  //
  // stopPropagation only — preventDefault would break focus and the
  // contenteditable caret during text edit. NOT stopImmediatePropagation: the
  // editor's own document-level listeners are registered on this same node and
  // must still run.
  //
  // Accepted consequence: genuinely interactive slide content goes inert while
  // edit mode is on, for every deck. That is the intended reading of edit mode
  // — the editor owns the canvas — and view mode is untouched, so presenting
  // still behaves exactly as the deck author wrote it.
  const HOST_GESTURE_EVENTS = ['pointerdown', 'pointerup', 'pointercancel', 'click'];
  function suppressHostGesture(e) {
    if (!state.editMode && !state.overviewMode) return;
    if (isInsideEditorRoot(e.target)) return;
    e.stopPropagation();
  }
  HOST_GESTURE_EVENTS.forEach((type) => {
    document.addEventListener(type, suppressHostGesture, true);
  });

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
