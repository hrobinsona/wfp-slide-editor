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

    applyExplicitSizeConstraints(r.el, { width, height });
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

  function snapshotChildOffsetsRelativeTo(container) {
    return [...container.children].map((child) => {
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
