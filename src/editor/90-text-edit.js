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
