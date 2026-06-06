  // ===========================================================================
  // Helpers
  // ===========================================================================
  function isInsideEditorRoot(el) {
    return !!el && root.contains(el);
  }

  function markResolvedRoot(resolvedRoot, mode) {
    if (!resolvedRoot) return;
    resolvedRoot.setAttribute('data-wfp-edit-deck-root', 'true');
    if (mode === 'flat') {
      resolvedRoot.setAttribute('data-wfp-edit-flat-root', 'true');
    }
  }

  function ensureFlatPositionContext(flatRoot) {
    if (!flatRoot) return;
    if (getComputedStyle(flatRoot).position === 'static') {
      flatRoot.setAttribute('data-wfp-edit-flat-position-context', 'true');
    }
  }

  function resolveNativeDeckRoot() {
    return document.querySelector('.deck');
  }

  function resolveForeignDeckRoot() {
    const counts = new Map();
    document.querySelectorAll('.slide').forEach((slide) => {
      const parent = slide.parentElement;
      if (!parent) return;
      counts.set(parent, (counts.get(parent) || 0) + 1);
    });

    let bestRoot = null;
    let bestCount = 0;
    counts.forEach((count, parent) => {
      if (count > bestCount) {
        bestRoot = parent;
        bestCount = count;
      }
    });
    return bestRoot;
  }

  function getFlatRootOverride() {
    const override = window.__WFP_EDIT_ROOT__;
    if (typeof override !== 'string' || !override.trim()) return null;
    try {
      const el = document.querySelector(override);
      return el instanceof Element ? el : null;
    } catch (_) {
      return null;
    }
  }

  function isDominantBodyWrapperCandidate(el) {
    if (!el || el.id === ROOT_ID) return false;
    return !['SCRIPT', 'STYLE', 'LINK', 'META', 'NOSCRIPT', 'TEMPLATE'].includes(el.tagName);
  }

  function resolveFlatRoot() {
    const override = getFlatRootOverride();
    if (override) return override;
    const main = document.querySelector('main');
    if (main) return main;
    const article = document.querySelector('article');
    if (article) return article;
    const bodyChildren = [...document.body.children].filter(isDominantBodyWrapperCandidate);
    if (bodyChildren.length === 1) return bodyChildren[0];
    return document.body;
  }

  function resolveDeckRoot() {
    const nativeRoot = resolveNativeDeckRoot();
    if (nativeRoot) {
      markResolvedRoot(nativeRoot, 'native');
      return { mode: 'native', root: nativeRoot };
    }

    const foreignRoot = resolveForeignDeckRoot();
    if (foreignRoot) {
      markResolvedRoot(foreignRoot, 'foreign');
      return { mode: 'foreign', root: foreignRoot };
    }

    const flatRoot = resolveFlatRoot();
    markResolvedRoot(flatRoot, 'flat');
    ensureFlatPositionContext(flatRoot);
    return { mode: 'flat', root: flatRoot };
  }

  function getDocumentMode() {
    return deckContext.mode;
  }

  function isFlatMode() {
    return getDocumentMode() === 'flat';
  }

  function applyModeFeatureGating() {
    if (!isFlatMode()) return;
    overviewBtn.hidden = true;
    overviewBtn.disabled = true;
    overviewBtn.setAttribute('aria-hidden', 'true');
    overviewBtn.dataset.mode = 'off';
    toolbar.dataset.overviewMode = 'off';
  }

  function getDeckRoot() {
    return deckContext.root;
  }

  function getSlides() {
    const deckRoot = getDeckRoot();
    if (!deckRoot) return [];
    if (getDocumentMode() === 'flat') return [deckRoot];
    return [...deckRoot.querySelectorAll(':scope > .slide')];
  }

  function getActiveSlide() {
    if (getDocumentMode() === 'flat') return getDeckRoot();
    return getSlides().find((slide) => slide.classList.contains('active')) || null;
  }

  function findSelectableTarget(el) {
    if (!el || isInsideEditorRoot(el)) return null;
    const slide = getActiveSlide();
    if (!slide) return null;
    if (el === slide) return null;
    if (el === getDeckRoot()) return null;
    if (!slide.contains(el)) return null;
    return el;
  }

  function isSelectionToggleEvent(e) {
    return !!e && (e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey;
  }

  function selectionArraysEqual(a, b) {
    if (a.length !== b.length) return false;
    return a.every((el, i) => el === b[i]);
  }

  function normalizeSelectionElements(elements) {
    const slide = getActiveSlide();
    if (!slide) return [];
    const out = [];
    for (const el of elements || []) {
      if (!el || !el.isConnected || !slide.contains(el)) continue;
      if (el === slide || el === getDeckRoot()) continue;
      if (isInsideEditorRoot(el)) continue;
      if (!out.includes(el)) out.push(el);
    }
    return out;
  }

  function getSelectedElements() {
    const source = state.selectedElements && state.selectedElements.length
      ? state.selectedElements
      : (state.selected ? [state.selected] : []);
    return normalizeSelectionElements(source);
  }

  function hasMultiSelection() {
    return getSelectedElements().length > 1;
  }

  function toggleSelectedElement(target) {
    if (!target) return;
    const current = getSelectedElements();
    const existingIndex = current.indexOf(target);
    let next;
    let primary = target;
    if (existingIndex >= 0) {
      next = current.filter((el) => el !== target);
      primary = next[next.length - 1] || null;
    } else {
      next = current.filter((el) => !el.contains(target) && !target.contains(el));
      next.push(target);
    }
    setSelectedElements(next, primary);
  }

  function stripEditorArtifactsFrom(el) {
    if (!el) return;
    const nodes = [el, ...el.querySelectorAll('*')];
    for (const node of nodes) {
      for (const attr of [...node.attributes]) {
        if (attr.name.startsWith('data-wfp-edit')) node.removeAttribute(attr.name);
      }
      if (node.hasAttribute('contenteditable')) node.removeAttribute('contenteditable');
    }
  }

  function getCoordinateRootForElement(el) {
    const slide = el.closest('.slide');
    if (slide && getDeckRoot() && getDeckRoot().contains(slide)) return slide;
    const activeSlide = getActiveSlide();
    if (activeSlide && activeSlide.contains(el)) return activeSlide;
    return getDeckRoot();
  }

  function getSlideBox(el) {
    const coordinateRoot = getCoordinateRootForElement(el);
    const scale = getCanvasScale();
    const elRect = el.getBoundingClientRect();
    const slideRect = coordinateRoot ? coordinateRoot.getBoundingClientRect() : { left: 0, top: 0 };
    const safeScale = scale || 1;
    return {
      left: (elRect.left - slideRect.left) / safeScale,
      top: (elRect.top - slideRect.top) / safeScale,
      width: elRect.width / safeScale,
      height: elRect.height / safeScale,
    };
  }

  function applyExplicitSizeConstraints(el, size) {
    const cs = getComputedStyle(el);
    if (Number.isFinite(size.width)) {
      const maxWidth = parseFloat(cs.maxWidth);
      if (cs.maxWidth !== 'none' && Number.isFinite(maxWidth) && size.width > maxWidth) {
        el.style.maxWidth = 'none';
      }
      const minWidth = parseFloat(cs.minWidth);
      if (Number.isFinite(minWidth) && size.width < minWidth) {
        el.style.minWidth = '0px';
      }
    }
    if (Number.isFinite(size.height)) {
      const maxHeight = parseFloat(cs.maxHeight);
      if (cs.maxHeight !== 'none' && Number.isFinite(maxHeight) && size.height > maxHeight) {
        el.style.maxHeight = 'none';
      }
      const minHeight = parseFloat(cs.minHeight);
      if (Number.isFinite(minHeight) && size.height < minHeight) {
        el.style.minHeight = '0px';
      }
    }
  }

  function serializeElementForClipboard(el) {
    const clone = el.cloneNode(true);
    stripEditorArtifactsFrom(clone);
    const box = getSlideBox(el);
    const computed = getComputedStyle(el);
    const contentWidth = parseFloat(computed.width);
    const contentHeight = parseFloat(computed.height);
    const width = computed.boxSizing === 'border-box'
      ? box.width
      : (Number.isFinite(contentWidth) ? contentWidth : box.width);
    const height = computed.boxSizing === 'border-box'
      ? box.height
      : (Number.isFinite(contentHeight) ? contentHeight : box.height);
    clone.style.position = 'absolute';
    clone.style.left = `${box.left}px`;
    clone.style.top = `${box.top}px`;
    clone.style.width = `${width}px`;
    clone.style.height = `${height}px`;
    return clone.outerHTML;
  }

  function copySelectedElement() {
    const el = state.selected;
    if (hasMultiSelection()) return false;
    if (!el || !el.isConnected) return false;
    state.clipboard = { outerHTML: serializeElementForClipboard(el) };
    return true;
  }

  function parseClipboardElement() {
    if (!state.clipboard || !state.clipboard.outerHTML) return null;
    const template = document.createElement('template');
    template.innerHTML = state.clipboard.outerHTML.trim();
    const el = template.content.firstElementChild;
    if (!el) return null;
    stripEditorArtifactsFrom(el);
    return el;
  }

  function pasteClipboardElement() {
    const slide = getActiveSlide();
    if (!slide) return false;
    const inserted = parseClipboardElement();
    if (!inserted) return false;
    const left = parseFloat(inserted.style.left);
    const top = parseFloat(inserted.style.top);
    inserted.style.position = 'absolute';
    inserted.style.left = `${(Number.isFinite(left) ? left : 0) + 20}px`;
    inserted.style.top = `${(Number.isFinite(top) ? top : 0) + 20}px`;

    const previousSelectedEl = (
      state.selected &&
      state.selected.isConnected &&
      slide.contains(state.selected)
    ) ? state.selected : null;
    slide.appendChild(inserted);
    pushElementInsertEntry({
      type: 'elementInsert',
      slideEl: slide,
      insertedEl: inserted,
      parentEl: slide,
      nextSiblingEl: null,
      previousSelectedEl,
    });
    setSelected(inserted);
    refreshInspector();
    return true;
  }

  function duplicateSelected() {
    if (state.editingText) endTextEdit();
    if (!copySelectedElement()) return false;
    return pasteClipboardElement();
  }

  function deleteSelectedElement() {
    if (state.editingText) endTextEdit();
    if (hasMultiSelection()) return false;
    const el = state.selected;
    if (!el || !el.isConnected || state.overviewMode) return false;
    const parent = el.parentElement;
    const slide = getCoordinateRootForElement(el);
    if (!parent || !slide || !slide.contains(el)) return false;
    const nextSibling = el.nextSibling;
    parent.removeChild(el);
    pushElementInsertEntry({
      type: 'elementDelete',
      slideEl: slide,
      deletedEl: el,
      parentEl: parent,
      nextSiblingEl: nextSibling,
    });
    setSelected(null);
    refreshInspector();
    return true;
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
    // Use the known handle size per direction so we don't need to read
    // offsetWidth (which would force a layout flush every drag tick).
    for (const dir of HANDLE_DIRS) {
      const a = anchors[dir];
      const h = handles[dir];
      const half = handleSizeFor(dir) / 2;
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
      // The selection ring (and the dimension bubble) sitting over a
      // contenteditable target steals visual attention from the caret.
      // Hide both for the duration of the text edit; refreshSelection
      // will re-show them once edit ends.
      hideRing();
      hideHandles();
      hideDimBubble();
      hideMultiSelection();
      stopSelectionTracking();
      return;
    }
    if (clearDisconnectedSelection()) return;
    const members = getSelectedElements();
    if (members.length > 1) {
      hideRing();
      hideHandles();
      hideDimBubble();
      positionMultiSelection(members);
      populateInspector(null);
      startSelectionTracking();
    } else if (members.length === 1) {
      hideMultiSelection();
      state.selected = members[0];
      state.selectedElements = members;
      positionRing(state.selected);
      positionDimBubble(state.selected);
      populateInspector(state.selected);
      startSelectionTracking();
    } else {
      hideRing();
      hideHandles();
      hideDimBubble();
      hideMultiSelection();
      stopSelectionTracking();
    }
  }

  function positionDimBubble(el) {
    const r = el.getBoundingClientRect();
    // Use offsetWidth/Height (unscaled slide coords) so the bubble matches
    // the inspector's W/H readout. r.width/height are post-`transform: scale()`
    // viewport pixels and would diverge from the inline-style values.
    dimBubble.textContent = `${el.offsetWidth} × ${el.offsetHeight}`;
    dimBubble.style.display = 'block';
    // Anchor the bubble centred above the ring with a small gutter; the
    // chip's own height is small (~22px) so a 22px offset clears the
    // ring's stroke without floating off the screen for top-edge selections.
    const top = Math.max(2, r.top - 22);
    const left = r.left + r.width / 2;
    dimBubble.style.top = `${top}px`;
    dimBubble.style.left = `${left}px`;
  }

  function hideDimBubble() {
    dimBubble.style.display = 'none';
  }

  function hideMultiSelection() {
    multiBox.style.display = 'none';
    multiOutlineLayer.replaceChildren();
  }

  function positionMultiSelection(elements) {
    const rects = elements
      .map((el) => el.getBoundingClientRect())
      .filter((r) => r.width > 0 || r.height > 0);
    if (!rects.length) {
      hideMultiSelection();
      return;
    }
    const bounds = rects.reduce((acc, r) => ({
      left: Math.min(acc.left, r.left),
      top: Math.min(acc.top, r.top),
      right: Math.max(acc.right, r.right),
      bottom: Math.max(acc.bottom, r.bottom),
    }), {
      left: rects[0].left,
      top: rects[0].top,
      right: rects[0].right,
      bottom: rects[0].bottom,
    });

    multiBox.style.display = 'block';
    multiBox.style.left = `${bounds.left}px`;
    multiBox.style.top = `${bounds.top}px`;
    multiBox.style.width = `${bounds.right - bounds.left}px`;
    multiBox.style.height = `${bounds.bottom - bounds.top}px`;

    multiOutlineLayer.replaceChildren();
    for (const r of rects) {
      const outline = document.createElement('div');
      outline.className = 'wfpe-multi-outline';
      outline.style.display = 'block';
      outline.style.left = `${r.left}px`;
      outline.style.top = `${r.top}px`;
      outline.style.width = `${r.width}px`;
      outline.style.height = `${r.height}px`;
      multiOutlineLayer.appendChild(outline);
    }
  }

  let selectionRafId = 0;

  function shouldTrackSelection() {
    return (
      state.editMode &&
      !state.overviewMode &&
      !state.editingText &&
      getSelectedElements().length > 0
    );
  }

  function stopSelectionTracking() {
    if (!selectionRafId) return;
    cancelAnimationFrame(selectionRafId);
    selectionRafId = 0;
  }

  function startSelectionTracking() {
    if (selectionRafId || !shouldTrackSelection()) return;
    selectionRafId = requestAnimationFrame(() => {
      selectionRafId = 0;
      if (!shouldTrackSelection()) return;
      refreshSelection();
    });
  }

  function clearDisconnectedSelection() {
    const current = state.selectedElements && state.selectedElements.length
      ? state.selectedElements
      : (state.selected ? [state.selected] : []);
    if (!state.selected && current.length === 0) return false;

    const members = normalizeSelectionElements(current);
    const primary = (state.selected && members.includes(state.selected))
      ? state.selected
      : (members[members.length - 1] || null);
    const changed = state.selected !== primary || !selectionArraysEqual(state.selectedElements, members);
    if (!changed) return false;

    if (state.editingText && state.editingText.el && !members.includes(state.editingText.el)) {
      state.editingText = null;
    }
    state.selected = primary;
    state.selectedElements = primary ? members : [];
    if (!primary) {
      hideRing();
      hideHandles();
      hideDimBubble();
      hideMultiSelection();
      populateInspector(null);
      refreshInspector();
      stopSelectionTracking();
      return true;
    }
    return false;
  }

  function setSelectedElements(elements, primary) {
    // Close any open txn before swapping selection — defends against
    // an orphaned colour-picker txn (input fired without change) being
    // silently bundled with subsequent unrelated edits on the new
    // selection. endTxn no-ops if no element was touched.
    const members = normalizeSelectionElements(elements);
    const nextPrimary = (primary && members.includes(primary))
      ? primary
      : (members[members.length - 1] || null);
    const selectionChanged = (
      state.selected !== nextPrimary ||
      !selectionArraysEqual(state.selectedElements, members)
    );
    if (selectionChanged && state.txn) endTxn();
    state.selected = nextPrimary;
    state.selectedElements = nextPrimary ? members : [];
    if (state.selected) {
      refreshSelection();
    } else {
      hideRing();
      hideHandles();
      hideDimBubble();
      hideMultiSelection();
      populateInspector(null);
      stopSelectionTracking();
    }
    // Inspector visibility is updated by the explicit call sites below
    // (onClick / onMouseUp / setEditMode / slideObserver) rather than from
    // here. If we toggled inspector display:flex synchronously inside a
    // mousedown handler that swaps from "no selection" to "selected", the
    // newly-shown inspector at top-right would intercept the matching
    // mouseup — the browser then fires `click` on the LCA of mousedown
    // and mouseup targets (== body), and onClick can't find the original
    // target. Updating inspector after the mouseup keeps the click cycle
    // against the original DOM.
  }

  function setSelected(el) {
    setSelectedElements(el ? [el] : [], el || null);
  }

  function populateInspector(el) {
    if (!el) {
      for (const k of ['x', 'y', 'w', 'h', 'fontSize', 'opacity']) {
        if (document.activeElement !== inspectorInputs[k]) inspectorInputs[k].value = '';
      }
      fontSizeRow.style.display = 'none';
      textColourRow.row.style.display = 'none';
      populateColours(null);
      return;
    }
    // Use offset* values so what the user reads matches the box model
    // the editor writes back to (left/top/width/height in CSS px).
    // Skip the focused input — overwriting it would clobber what the
    // user is currently typing before they commit on Enter/blur.
    const values = {
      x: String(el.offsetLeft),
      y: String(el.offsetTop),
      w: String(el.offsetWidth),
      h: String(el.offsetHeight),
    };
    for (const k of ['x', 'y', 'w', 'h']) {
      if (document.activeElement === inspectorInputs[k]) continue;
      inspectorInputs[k].value = values[k];
    }
    // Font-size + text-colour rows render only for text-bearing elements
    // (matching BRIEF "Conditional content by selection type").
    // Background colour and position/size render for any selection.
    if (isTextBearing(el)) {
      fontSizeRow.style.display = '';
      textColourRow.row.style.display = '';
      populateFontSize(el);
    } else {
      fontSizeRow.style.display = 'none';
      textColourRow.row.style.display = 'none';
    }
    populateColours(el);
    populateOpacity(el);
  }

  // ---------------------------------------------------------------------------
  // Colour helpers (v2.4). Parse #rgb / #rrggbb (with or without leading #)
  // into normalized "#rrggbb" strings so apply/populate stay deterministic
  // across browser colour serialisations.
  // ---------------------------------------------------------------------------
  function parseHexInput(raw) {
    if (typeof raw !== 'string') return null;
    let h = raw.trim().replace(/^#/, '');
    if (/^[0-9a-fA-F]{3}$/.test(h)) {
      h = h.split('').map((c) => c + c).join('');
    }
    if (!/^[0-9a-fA-F]{6}$/.test(h)) return null;
    return '#' + h.toLowerCase();
  }

  function rgbStringToHex(rgb) {
    if (!rgb || rgb === 'transparent') return null;
    const m = rgb.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
    if (!m) return null;
    const toHex = (n) => Number(n).toString(16).padStart(2, '0');
    return ('#' + toHex(m[1]) + toHex(m[2]) + toHex(m[3])).toLowerCase();
  }

  function applyColorToElement(el, target, hex) {
    const norm = parseHexInput(hex);
    if (!norm) return false;
    el.style[target === 'text' ? 'color' : 'backgroundColor'] = norm;
    return true;
  }

  function commitColourHex(target, raw, targetEl) {
    const el = (targetEl && targetEl.isConnected) ? targetEl : state.selected;
    if (!el) return;
    if (target === 'text' && !isTextBearing(el)) return;
    const norm = parseHexInput(raw);
    if (!norm) {
      // Garbage input — restore from the live element.
      populateColours(el);
      return;
    }
    if (target === 'text' && state.editingText && state.editingText.el === el) {
      const ctx = startInspectorTxn({ captureHtml: !!getTextColourRange(el) });
      touchElement(el);
      applyTextColourToRange(el, norm);
      endInspectorTxn(ctx);
      populateColours(el);
      return;
    }
    const cssProp = target === 'text' ? 'color' : 'backgroundColor';
    const currentHex = rgbStringToHex(el.style[cssProp] || '');
    if (currentHex === norm) return; // no-op; suppress duplicate history entry
    const ctx = startInspectorTxn();
    touchElement(el);
    el.style[cssProp] = norm;
    endInspectorTxn(ctx);
    populateColours(el);
  }

  function populateColours(el) {
    if (!el) {
      for (const r of [textColourRow, bgColourRow]) {
        if (document.activeElement !== r.hexInput) r.hexInput.value = '';
        r.swatch.style.backgroundColor = '';
        r.swatch.dataset.transparent = 'true';
      }
      return;
    }
    // Text colour
    if (isTextBearing(el)) {
      const textColourSource = getActiveTextColourSpan(el) || el;
      const colorRgb = getComputedStyle(textColourSource).color;
      const hex = rgbStringToHex(colorRgb) || '#000000';
      if (document.activeElement !== textColourRow.hexInput) textColourRow.hexInput.value = hex;
      textColourRow.colorInput.value = hex;
      textColourRow.swatch.style.backgroundColor = hex;
      delete textColourRow.swatch.dataset.transparent;
    }
    // Background colour. computed background-color of "rgba(0,0,0,0)"
    // means transparent — show the checkerboard hint and a sensible
    // default in the picker. If the element has a background-image
    // (e.g. a gradient) the swatch flags that with a stripe pattern,
    // since a single hex can't represent it.
    const bgRgb = getComputedStyle(el).backgroundColor;
    const bgImage = getComputedStyle(el).backgroundImage;
    const hasImage = bgImage && bgImage !== 'none';
    const isTransparent = bgRgb === 'rgba(0, 0, 0, 0)' || bgRgb === 'transparent';
    const bgHex = isTransparent ? '#ffffff' : (rgbStringToHex(bgRgb) || '#ffffff');
    if (document.activeElement !== bgColourRow.hexInput) {
      bgColourRow.hexInput.value = isTransparent ? '' : bgHex;
    }
    bgColourRow.colorInput.value = bgHex;
    bgColourRow.hexInput.placeholder = hasImage ? 'image / gradient' : '';
    if (hasImage) {
      bgColourRow.swatch.style.backgroundColor = '';
      bgColourRow.swatch.dataset.image = 'true';
      delete bgColourRow.swatch.dataset.transparent;
    } else if (isTransparent) {
      bgColourRow.swatch.style.backgroundColor = '';
      bgColourRow.swatch.dataset.transparent = 'true';
      delete bgColourRow.swatch.dataset.image;
    } else {
      bgColourRow.swatch.style.backgroundColor = bgHex;
      delete bgColourRow.swatch.dataset.transparent;
      delete bgColourRow.swatch.dataset.image;
    }
  }

  function populateFontSize(el, { forceInput = false } = {}) {
    const px = Math.round(parseFloat(getComputedStyle(el).fontSize)) || FONT_SIZE_MIN_PX;
    if (forceInput || document.activeElement !== inspectorInputs.fontSize) {
      inspectorInputs.fontSize.value = String(px);
    }
    // Slider snaps to its [min, max] range — clamp the displayed value.
    const sliderMax = Number(fontSlider.max) || 200;
    const sliderMin = Number(fontSlider.min) || FONT_SIZE_MIN_PX;
    fontSlider.value = String(Math.max(sliderMin, Math.min(sliderMax, px)));
  }

  function populateOpacity(el) {
    const raw = parseFloat(getComputedStyle(el).opacity);
    const pct = Math.round((Number.isFinite(raw) ? raw : 1) * 100);
    if (document.activeElement !== inspectorInputs.opacity) {
      inspectorInputs.opacity.value = String(pct);
    }
    opacitySlider.value = String(Math.max(0, Math.min(100, pct)));
  }

  function commitInspectorInput(prop, raw, targetEl) {
    // Prefer the target captured at focus-time so a mid-edit selection
    // change doesn't redirect the commit to the new element.
    const el = (targetEl && targetEl.isConnected) ? targetEl : state.selected;
    if (!el) return;
    const next = parseFloat(raw);
    if (!Number.isFinite(next)) {
      // Garbage input — restore the readout from the live element.
      populateInspector(el);
      return;
    }
    if (prop === 'fontSize') {
      if (!isTextBearing(el)) return;
      const current = parseFloat(getComputedStyle(el).fontSize);
      const clamped = Math.max(FONT_SIZE_MIN_PX, next);
      if (Math.round(clamped) === Math.round(current)) return;
      const ctx = startInspectorTxn();
      touchElement(el);
      el.style.fontSize = `${clamped}px`;
      endInspectorTxn(ctx);
      refreshSelection();
      return;
    }
    if (prop === 'opacity') {
      const pct = Math.max(0, Math.min(100, next));
      // `|| 1` would treat a legitimate 0 as falsy and default to 100,
      // breaking the no-op guard after a clamp-to-zero. Use isFinite.
      const raw = parseFloat(getComputedStyle(el).opacity);
      const currentPct = Math.round((Number.isFinite(raw) ? raw : 1) * 100);
      if (Math.round(pct) === currentPct) return;
      const ctx = startInspectorTxn();
      touchElement(el);
      el.style.opacity = String(pct / 100);
      endInspectorTxn(ctx);
      refreshSelection();
      return;
    }
    // Compare against the live offset; abort no-op commits so blur
    // cycling doesn't pollute history.
    const offsetMap = { x: 'offsetLeft', y: 'offsetTop', w: 'offsetWidth', h: 'offsetHeight' };
    const current = el[offsetMap[prop]];
    if (Math.round(next) === current) return;

    const ctx = startInspectorTxn();
    touchElement(el);
    // X/Y require absolute positioning; unlock-on-flow if needed (same
    // path drag/resize use, which also pins flex/grid siblings so the
    // sudden absolute promotion doesn't reflow the layout).
    if (prop === 'x' || prop === 'y') {
      if (getComputedStyle(el).position !== 'absolute') unlockToAbsolute(el);
    }
    const cssProp = { x: 'left', y: 'top', w: 'width', h: 'height' }[prop];
    // Clamp width/height to the same minimum the resize handle enforces
    // so inspector edits can't shrink an element below the resize floor.
    const clamped = (prop === 'w' || prop === 'h') ? Math.max(RESIZE_MIN_PX, next) : next;
    if (prop === 'w') applyExplicitSizeConstraints(el, { width: clamped });
    if (prop === 'h') applyExplicitSizeConstraints(el, { height: clamped });
    el.style[cssProp] = `${clamped}px`;
    endInspectorTxn(ctx);
    refreshSelection();
  }

  // ===========================================================================
  // Inspector visibility + minimise/expand
  //
  // The inspector appears whenever an element is selected and hides on
  // deselect or slide change. Minimised/expanded preference persists
  // across selections within the session via state.inspectorMinimised;
  // reload resets to expanded (in-memory only — localStorage persistence
  // is a v2.x ROADMAP item).
  // ===========================================================================
  function refreshInspector() {
    const visible = getSelectedElements().length === 1 && !!state.selected;
    inspector.dataset.visible = visible ? 'true' : 'false';
    inspector.dataset.state = state.inspectorMinimised ? 'minimised' : 'expanded';
    inspectorMinimiseBtn.innerHTML = state.inspectorMinimised ? ICONS.chevronDown : ICONS.chevronUp;
    inspectorMinimiseBtn.title = state.inspectorMinimised ? 'Expand' : 'Minimise';
    inspectorMinimiseBtn.setAttribute(
      'aria-label',
      state.inspectorMinimised ? 'Expand inspector' : 'Minimise inspector'
    );
  }

  function setInspectorMinimised(value) {
    state.inspectorMinimised = !!value;
    refreshInspector();
  }
