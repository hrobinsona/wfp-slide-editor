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
  });
  function observeSlideClass(slide) {
    if (!slide) return;
    slideObserver.observe(slide, { attributes: true, attributeFilter: ['class'] });
  }
  document.querySelectorAll('.slide').forEach(observeSlideClass);
