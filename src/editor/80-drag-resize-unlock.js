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

    // v2.22 — Markdown mode has no geometry: a dragged paragraph would write
    // an inline style the writeback cannot represent and would silently drop.
    // This bails AFTER the text-edit teardown above deliberately — that block
    // is the only thing that commits an open edit when the pointer lands
    // elsewhere, so returning ahead of it strands state.editingText and makes
    // every subsequent block uneditable until edit mode is toggled. Selection
    // is unaffected: the click path (70-selection-events) owns it.
    if (state.markdownMode) return;

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

    // Mousedown only records gesture geometry — cheap reads, no txn, no
    // style writes. All mutation (beginTxn, unlock-or-pin) is deferred until
    // the pointer leaves the deadzone in onResizeMove, mirroring the drag
    // engine, so a zero-move click on a handle leaves the element, the
    // history, and any flow siblings completely untouched.
    state.resize = {
      el,
      dir,
      startX: e.clientX,
      startY: e.clientY,
      initLeft: el.offsetLeft,
      initTop: el.offsetTop,
      initWidth: el.offsetWidth,
      initHeight: el.offsetHeight,
      wasAbsolute: getComputedStyle(el).position === 'absolute',
      started: false,
    };

    document.addEventListener('mousemove', onResizeMove, true);
    document.addEventListener('mouseup', onResizeUp, true);
  }

  function onResizeMove(e) {
    const r = state.resize;
    if (!r) return;
    e.preventDefault();
    e.stopPropagation();

    const dxView = e.clientX - r.startX;
    const dyView = e.clientY - r.startY;

    if (!r.started) {
      const distSq = dxView * dxView + dyView * dyView;
      if (distSq < DRAG_DEADZONE_PX * DRAG_DEADZONE_PX) return;
      r.started = true;
      beginTxn();
      touchElement(r.el);

      // Resize on a flow-positioned element runs the same unlock conversion
      // as a drag would (which also freezes flex/grid siblings). The unlock
      // changes offsets, so refetch the anchors from the element before any
      // dimensional writes.
      if (!r.wasAbsolute) {
        const rect = unlockToAbsolute(r.el);
        r.initLeft = rect.left;
        r.initTop = rect.top;
        r.initWidth = rect.width;
        r.initHeight = rect.height;
      } else {
        // Lock in the current dimensions so deltas compose deterministically.
        // Anchors are re-read here rather than trusted from mousedown: any
        // layout shift between the press and the first move past the
        // deadzone would otherwise snap the element to a stale position.
        r.initLeft = r.el.offsetLeft;
        r.initTop = r.el.offsetTop;
        r.initWidth = r.el.offsetWidth;
        r.initHeight = r.el.offsetHeight;
        r.el.style.left = `${r.initLeft}px`;
        r.el.style.top = `${r.initTop}px`;
        r.el.style.width = `${r.initWidth}px`;
        r.el.style.height = `${r.initHeight}px`;
      }
    }

    const scale = getCanvasScale();
    const dx = dxView / scale;
    const dy = dyView / scale;

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
    // v2.12 — live W × H tag + overlap-gated fade, re-tested every move
    // (a growing element can pass under the panel mid-gesture). Runs
    // before refreshSelection so the dim bubble yields on the first tick.
    liveEditUpdate(`${r.el.offsetWidth} × ${r.el.offsetHeight}`);
    refreshSelection();
  }

  function onResizeUp(_e) {
    document.removeEventListener('mousemove', onResizeMove, true);
    document.removeEventListener('mouseup', onResizeUp, true);
    const r = state.resize;
    if (!r) return;
    state.resize = null;
    // Swallow the synthetic click that follows the release — even for a
    // zero-move gesture — so releasing over the handle never deselects.
    state.suppressClickUntil = Date.now() + POST_DRAG_CLICK_GUARD_MS;
    if (r.started) {
      endTxn();
      liveEditEnd();
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

  function snapshotChildOffsets(children, container) {
    return children.map((child) => {
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

  function snapshotChildOffsetsRelativeTo(container) {
    return snapshotChildOffsets(getPinnableContainerChildren(container), container);
  }

  // v2.15 — the slide/flat root can be document.body (resolveFlatRoot's
  // last fallback), where #wfp-editor-root and the page's own <script>
  // elements are DIRECT siblings of the unlock target. Pinning must never
  // touch editor-injected DOM (inline position:absolute would destroy the
  // fixed overlay) or non-rendered elements (inline styles on <script> and
  // friends survive into exports — the export scrubber only removes
  // data-wfp-edit-* attributes). Neither exclusion is root-specific: a
  // static non-flat slide reaches pinContainerChildren with the same
  // hazards, and an ordinary flex container can hold an inline <script>
  // too, so EVERY pin path filters on the tag/editor-root rules.
  const NON_RENDERED_ROOT_CHILD_TAGS = new Set([
    'SCRIPT', 'STYLE', 'LINK', 'META', 'NOSCRIPT', 'TEMPLATE',
  ]);

  function isPinnableContainerChild(child) {
    if (isInsideEditorRoot(child)) return false;
    return !NON_RENDERED_ROOT_CHILD_TAGS.has(child.tagName);
  }

  // The extra 0x0-rect rule is ROOT-ONLY on purpose: it exists so a hidden
  // body-level panel doesn't count as a sibling worth protecting, and an
  // ordinary container can legitimately hold an empty but layout-
  // participating child (a zero-height flex spacer, a collapsed row) whose
  // pin still matters.
  function isPinnableRootChild(child) {
    if (!isPinnableContainerChild(child)) return false;
    const rect = child.getBoundingClientRect();
    return rect.width > 0 || rect.height > 0;
  }

  function getPinnableContainerChildren(containerEl) {
    return [...containerEl.children].filter(isPinnableContainerChild);
  }

  function getPinnableRootChildren(rootEl) {
    return [...rootEl.children].filter(isPinnableRootChild);
  }

  function addFlowUnlockGroupMember(group, el, isContainer = false) {
    let record = group.records.get(el);
    if (!record) {
      record = {
        el,
        beforeStyle: el.getAttribute('style'),
        beforeFrozen: el.getAttribute('data-wfp-edit-frozen'),
        beforeFlexFrozen: el.getAttribute('data-wfp-edit-flex-frozen'),
        beforeFlatRootHeight: el.getAttribute(FLAT_ROOT_HEIGHT_ATTR),
        pinnedStyle: null,
        isContainer: false,
        children: [],
      };
      group.records.set(el, record);
    }
    if (isContainer) record.isContainer = true;
    return record;
  }

  function registerFlowUnlockGroupMember(group, el) {
    let memberships = state.flowUnlockGroups.get(el);
    if (!memberships) {
      memberships = [];
      state.flowUnlockGroups.set(el, memberships);
    }
    if (!memberships.includes(group)) memberships.push(group);
  }

  function refreshFlowUnlockDiagnostics() {
    let recordCount = 0;
    for (const group of state.flowUnlockGroupRegistry) {
      recordCount += group.records.size;
    }
    root.dataset.flowUnlockGroupCount = String(state.flowUnlockGroupRegistry.size);
    root.dataset.flowUnlockRecordCount = String(recordCount);
  }

  function pruneInactiveFlowUnlockGroups() {
    if (state.flowUnlockGroupRegistry.size === 0) return;
    const retainedByHistory = new Set();
    for (const entry of state.history) {
      for (const transition of entry.flowGroupStates || []) {
        retainedByHistory.add(transition.group);
      }
    }

    let pruned = false;
    for (const group of [...state.flowUnlockGroupRegistry]) {
      if (group.active || retainedByHistory.has(group)) continue;
      for (const record of group.records.values()) {
        const memberships = state.flowUnlockGroups.get(record.el);
        if (!memberships) continue;
        const index = memberships.indexOf(group);
        if (index !== -1) memberships.splice(index, 1);
        if (memberships.length === 0) state.flowUnlockGroups.delete(record.el);
      }
      group.records.clear();
      state.flowUnlockGroupRegistry.delete(group);
      pruned = true;
    }
    if (pruned) refreshFlowUnlockDiagnostics();
  }

  function getActiveFlowUnlockGroup(el) {
    const memberships = state.flowUnlockGroups.get(el) || [];
    for (let i = memberships.length - 1; i >= 0; i--) {
      if (memberships[i].active) return memberships[i];
    }
    return null;
  }

  function prepareFlowUnlockGroup(ancestors, el, rootChildPin = null) {
    const containers = ancestors.filter(
      (container) => container.dataset.wfpEditFlexFrozen !== 'true'
    );
    const group = { records: new Map(), active: false };

    // Snapshot the whole group before the first write. In nested layouts an
    // outer pin mutates the inner container before that inner container is
    // pinned itself; recording up front preserves the genuine pre-unlock
    // style rather than an intermediate mechanical style.
    for (const container of containers) {
      const containerRecord = addFlowUnlockGroupMember(group, container, true);
      // Same filtered list pinContainerChildren pins, so records and pinning
      // agree — an unpinned <script> must not appear as a group member whose
      // retention could hold its container pinned on Reset.
      containerRecord.children = getPinnableContainerChildren(container);
      for (const child of containerRecord.children) {
        addFlowUnlockGroupMember(group, child);
      }
    }

    // v2.15 — direct child of the slide/flat root: the root joins the group
    // as a container member (its flex-frozen latch must restore on Reset/
    // undo) and every child pinRootChildren is about to pin is recorded, so
    // records and pinning agree — but pinRootChildren never writes a style
    // on the root itself. No latch check here: unlockToAbsolute only builds
    // a rootChildPin when there is genuinely something to pin, including the
    // stale-latch case where the root is already marked frozen.
    if (rootChildPin) {
      const rootRecord = addFlowUnlockGroupMember(group, rootChildPin.rootEl, true);
      rootRecord.children = [...rootChildPin.children];
      for (const child of rootRecord.children) {
        addFlowUnlockGroupMember(group, child);
      }
    }

    // A lone direct child of the slide has no sibling to pin, but the
    // safety-net absolute conversion is still an unlock group of one.
    if (group.records.size === 0 && getComputedStyle(el).position !== 'absolute') {
      addFlowUnlockGroupMember(group, el);
    }

    if (group.records.size === 0) return getActiveFlowUnlockGroup(el);
    state.flowUnlockGroupRegistry.add(group);
    for (const record of group.records.values()) {
      registerFlowUnlockGroupMember(group, record.el);
    }
    setFlowUnlockGroupActive(group, true);
    refreshFlowUnlockDiagnostics();
    return group;
  }

  function recordFlowPin(group, el) {
    if (!group) return;
    const record = group.records.get(el);
    if (record) record.pinnedStyle = el.getAttribute('style');
  }

  function pinSnapshottedChildren(childRects, group) {
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
      // v2.14 — record the exact pinned style so the edit ledger can label
      // untouched pins as mechanical; any later user write diverges from it.
      state.pinnedStyles.set(m.child, m.child.getAttribute('style'));
      recordFlowPin(group, m.child);
    }
  }

  function pinContainerChildren(container, group = null) {
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

    pinSnapshottedChildren(childRects, group);
    container.dataset.wfpEditFlexFrozen = 'true';
    state.pinnedStyles.set(container, container.getAttribute('style'));
    recordFlowPin(group, container);
  }

  // v2.15 — with every flat-root child absolute, the root's intrinsic
  // height collapses and BODY-LEVEL siblings of the root (header/main/
  // footer pages) reflow. Hold the measured pre-pin height without inline
  // styles on the live root: stamp a data-wfp-edit-* marker and back it
  // with a dynamic rule in editor-owned CSS keyed to the marker's exact
  // value (precedent: applyOverviewCellDimensions). Rules are additive and
  // never removed — undo/Reset drop the ATTRIBUTE, which un-matches the
  // selector, and redo re-matches it. The export scrubber converts the
  // marker into inline height on the clone (persistFlatRootHeightOnExport)
  // because exported files carry neither editor CSS nor markers.
  let flatRootHeightStyleEl = null;
  const flatRootHeightRuleValues = new Set();

  function measureFlatRootCssHeight(rootEl) {
    // offsetHeight is the border-box height; translate to a `height` value
    // that reproduces it under the root's own box-sizing.
    const cs = getComputedStyle(rootEl);
    let cssHeight = rootEl.offsetHeight;
    if (cs.boxSizing !== 'border-box') {
      cssHeight -=
        (parseFloat(cs.paddingTop) || 0) +
        (parseFloat(cs.paddingBottom) || 0) +
        (parseFloat(cs.borderTopWidth) || 0) +
        (parseFloat(cs.borderBottomWidth) || 0);
    }
    return Math.max(0, Math.round(cssHeight * 100) / 100);
  }

  // The invariant a held height must preserve is the position of whatever
  // FOLLOWS the root, not the root's own border box. On a padding-less,
  // border-less root, margins collapse THROUGH it: the first child's top
  // margin is the root's top margin and the last child's bottom margin is
  // its bottom margin. Pinning the children absolute deletes both (an
  // out-of-flow child has no margin to collapse), and an explicit height
  // stops the bottom margin collapsing even before the children move — so
  // the plain border-box measurement leaves following content short by the
  // two collapsed margins (~48px in the reported case).
  //
  // The follow anchor is the root's next IN-FLOW sibling (editor chrome,
  // script tags, display:none and out-of-flow siblings are skipped: they
  // either must not be touched or do not move with the root's height). With
  // no such sibling, nothing follows the root and the invariant becomes the
  // root's own bottom edge — which is exactly its pre-pin margin-box
  // footprint, since the collapsed-through bottom margin is already baked
  // into where that edge sits.
  //
  // Anchors are read in LAYOUT space (offsetTop/offsetHeight), never through
  // getBoundingClientRect: layout offsets are unaffected by transforms and
  // by scrolling, so the residual is already in the same units as the CSS
  // height being written. A rect-based residual would need to be divided by
  // the scale of the root's ANCESTORS but not by the root's own — dividing
  // by the root's own scale (as an earlier revision did via getCanvasScale)
  // overshoots by exactly 1/scale when the flat root itself is transformed.
  function isFlowFollowerCandidate(el) {
    if (!isPinnableContainerChild(el)) return false;
    const cs = getComputedStyle(el);
    if (cs.position === 'absolute' || cs.position === 'fixed') return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 || rect.height > 0;
  }

  function readFlatRootFollowOffset(rootEl) {
    let sibling = rootEl.nextElementSibling;
    while (sibling && !isFlowFollowerCandidate(sibling)) {
      sibling = sibling.nextElementSibling;
    }
    // A follower and the root are siblings, so they share an offsetParent
    // and their offsets are directly comparable across a re-measure.
    if (sibling) return sibling.offsetTop;
    return rootEl.offsetTop + rootEl.offsetHeight;
  }

  function getPinnedRootChildren(rootEl) {
    return getPinnableRootChildren(rootEl).filter(
      (child) => child.dataset.wfpEditFrozen === 'true'
    );
  }

  // Solve for the height that puts the follow anchor back on its target.
  // One correction is exact wherever the anchor is linear in the root's
  // height (block and flex-column flow); a second pass absorbs rounding.
  // If a pass does not improve on the previous residual — a stretched flex
  // item, a percentage height, a max-height cap — the best value so far is
  // restored, so the hold is never worse than the plain measurement.
  function solveFlatRootHeightHold(rootEl, target) {
    let best = parseFloat(rootEl.getAttribute(FLAT_ROOT_HEIGHT_ATTR));
    if (!Number.isFinite(best)) {
      applyFlatRootHeightHold(rootEl, measureFlatRootCssHeight(rootEl));
      best = parseFloat(rootEl.getAttribute(FLAT_ROOT_HEIGHT_ATTR));
    }
    let bestResidual = target - readFlatRootFollowOffset(rootEl);

    for (let pass = 0; pass < 2 && Math.abs(bestResidual) >= 1; pass++) {
      applyFlatRootHeightHold(rootEl, Math.max(0, best + bestResidual));
      const candidate = parseFloat(rootEl.getAttribute(FLAT_ROOT_HEIGHT_ATTR));
      const residual = target - readFlatRootFollowOffset(rootEl);
      if (Math.abs(residual) >= Math.abs(bestResidual)) {
        applyFlatRootHeightHold(rootEl, best);
        return;
      }
      best = candidate;
      bestResidual = residual;
    }
  }

  // v2.15 review round 4 — the hold is DERIVED state: it is only correct for
  // the set of children pinned RIGHT NOW, and that set keeps changing after
  // the pin that established it (a partial Reset returns some children to
  // flow, undo/redo move between pinned states, a later unlock pins the
  // remainder). A one-shot measurement therefore goes stale — and a stale
  // value reaches the export clone. Instead of special-casing each caller,
  // this re-derives the hold from live geometry and is called after every
  // transition that can change the pinned set.
  //
  // With no pinned child left the marker is dropped outright so the root
  // returns to natural layout; the dynamic CSS rule is keyed on the exact
  // attribute value, so removing the attribute un-matches it.
  function reconcileFlatRootHold(rootEl) {
    if (!rootEl || !rootEl.isConnected) return;
    if (rootEl.getAttribute('data-wfp-edit-flat-root') !== 'true') return;

    if (!getPinnedRootChildren(rootEl).length) {
      if (rootEl.hasAttribute(FLAT_ROOT_HEIGHT_ATTR)) {
        touchElement(rootEl);
        rootEl.removeAttribute(FLAT_ROOT_HEIGHT_ATTR);
      }
      // The TARGET deliberately survives an empty pinned set. Undoing the
      // delete or Reset that emptied it re-attaches pinned children into a
      // collapsed root, and solving back to the retained target is the only
      // way to restore the pre-delete geometry — adopting the collapsed
      // layout instead would freeze the very shift being repaired. A fresh
      // pin re-captures it (see pinRootChildren) so a content edit between
      // unlock cycles is not held against an outdated position.
      return;
    }

    if (!state.flatRootHoldTargets.has(rootEl)) {
      // Pins that arrived without an establishing measurement (redo of a
      // pin whose target was dropped by the undo). History has just made
      // this layout correct, so adopt it as the target.
      state.flatRootHoldTargets.set(rootEl, readFlatRootFollowOffset(rootEl));
      return;
    }

    touchElement(rootEl);
    solveFlatRootHeightHold(rootEl, state.flatRootHoldTargets.get(rootEl));
  }

  // History and group restores can change the pinned set of any root, and
  // there is at most one flat root per document, so re-deriving them all is
  // cheap and needs no separate bookkeeping to stay in sync.
  function reconcileFlatRootHolds() {
    document
      .querySelectorAll('[data-wfp-edit-flat-root="true"]')
      .forEach(reconcileFlatRootHold);
  }

  function applyFlatRootHeightHold(rootEl, cssHeight) {
    const value = String(Math.max(0, Math.round(cssHeight * 100) / 100));
    if (!flatRootHeightStyleEl) {
      flatRootHeightStyleEl = document.createElement('style');
      root.appendChild(flatRootHeightStyleEl);
    }
    if (!flatRootHeightRuleValues.has(value)) {
      flatRootHeightRuleValues.add(value);
      flatRootHeightStyleEl.textContent += `
        [${FLAT_ROOT_HEIGHT_ATTR}="${value}"] { height: ${value}px !important; }
      `;
    }
    rootEl.setAttribute(FLAT_ROOT_HEIGHT_ATTR, value);
  }

  // v2.15 — pinContainerChildren for the slide/flat root itself: identical
  // child pinning, but the root's inline style is never written. Native
  // slides own fixed 1920x1080 stylesheet dimensions, and the flat root's
  // contract is "no inline root mutation" (its positioning context comes
  // from the fixture stylesheet or the editor's
  // data-wfp-edit-flat-position-context CSS). The root still takes the
  // flex-frozen MARKER: it records that an active group owns the children,
  // it restores through the ordinary group/history machinery, and the export
  // scrubber already strips every data-wfp-edit-* attribute. Unlike a
  // container's latch it is not treated as a skip signal — see
  // unlockToAbsolute for why.
  function pinRootChildren(rootEl, children, group = null) {
    // No latch early-return: unlockToAbsolute passes only the children that
    // still need pinning, so a latch left behind by a partial Reset must not
    // suppress protection for the siblings that went back into flow.
    const isFlatRoot = rootEl.getAttribute('data-wfp-edit-flat-root') === 'true';

    const childRects = snapshotChildOffsets(children, rootEl);
    const rootRectBefore = rootEl.getBoundingClientRect();
    // The target is the position following content must keep while anything
    // under this root is pinned. Capture it whenever this pin ESTABLISHES
    // the hold — no child is pinned yet, so the layout being measured is the
    // natural one — which also refreshes it after content changed between
    // unlock cycles. A pin that merely extends an existing hold (the
    // stale-latch remainder) keeps the target it already has. Slides are
    // excluded: they own explicit stylesheet dimensions and never collapse.
    if (isFlatRoot && !getPinnedRootChildren(rootEl).length) {
      state.flatRootHoldTargets.set(rootEl, readFlatRootFollowOffset(rootEl));
    }
    touchElement(rootEl);
    pinSnapshottedChildren(childRects, group);

    // Derive the hold from the pinned set this pin just produced. Every
    // write happens inside one synchronous gesture step, so no intermediate
    // layout is ever painted.
    if (isFlatRoot) reconcileFlatRootHold(rootEl);

    // A padding-less root (typically document.body) can itself move when its
    // children leave the flow: the first child's margin no longer collapses
    // through it, so the root's border box slides up by that collapsed
    // margin and every pinned child — positioned relative to the root —
    // slides with it. Compensate by re-anchoring the pins against the
    // root's PRE-PIN viewport position so the visual result stays fixed.
    const rootRectAfter = rootEl.getBoundingClientRect();
    const scale = getCanvasScale() || 1;
    const shiftX = (rootRectBefore.left - rootRectAfter.left) / scale;
    const shiftY = (rootRectBefore.top - rootRectAfter.top) / scale;
    if (Math.abs(shiftX) > 0.5 || Math.abs(shiftY) > 0.5) {
      for (const m of childRects) {
        m.child.style.left = `${m.left + shiftX}px`;
        m.child.style.top = `${m.top + shiftY}px`;
        // Refresh the mechanical-pin records: the label and Reset paths
        // compare exact style strings, which the compensation just changed.
        state.pinnedStyles.set(m.child, m.child.getAttribute('style'));
        recordFlowPin(group, m.child);
      }
    }

    rootEl.dataset.wfpEditFlexFrozen = 'true';
    state.pinnedStyles.set(rootEl, rootEl.getAttribute('style'));
    recordFlowPin(group, rootEl);
  }

  function restoreOptionalAttribute(el, name, value) {
    if (value === null) el.removeAttribute(name);
    else el.setAttribute(name, value);
  }

  function flowUnlockRecordIsAtRest(record) {
    return (
      record.el.getAttribute('style') === record.beforeStyle &&
      record.el.getAttribute('data-wfp-edit-frozen') === record.beforeFrozen &&
      record.el.getAttribute('data-wfp-edit-flex-frozen') === record.beforeFlexFrozen &&
      record.el.getAttribute(FLAT_ROOT_HEIGHT_ATTR) === record.beforeFlatRootHeight
    );
  }

  function restoreFlowUnlockRecord(record) {
    const el = record.el;
    if (record.beforeStyle === null) el.removeAttribute('style');
    else el.setAttribute('style', record.beforeStyle);
    restoreOptionalAttribute(el, 'data-wfp-edit-frozen', record.beforeFrozen);
    restoreOptionalAttribute(el, 'data-wfp-edit-flex-frozen', record.beforeFlexFrozen);
    restoreOptionalAttribute(el, FLAT_ROOT_HEIGHT_ATTR, record.beforeFlatRootHeight);
  }

  function restoreFlowUnlockGroup(group, selectedEl) {
    if (!group || !group.records) return;
    const restorable = new Map();

    for (const record of group.records.values()) {
      const currentStyle = record.el.getAttribute('style');
      // The selected element is the explicit reset target. Other members are
      // mechanical only while they still equal the exact editor-written pin.
      // A member already restored by a prior partial reset is also safe. An
      // older group never owns a member claimed by a newer active group.
      restorable.set(
        record.el,
        getActiveFlowUnlockGroup(record.el) === group &&
          (
            record.el === selectedEl ||
            currentStyle === record.pinnedStyle ||
            currentStyle === record.beforeStyle
          )
      );
    }

    // A pinned container is a positioning dependency, not just another
    // mechanical style. If any direct child retains a later deliberate edit,
    // keep the container pinned so that edit's containing block and visual
    // position do not change underneath it. Repeat for nested containers.
    let changed = true;
    while (changed) {
      changed = false;
      for (const record of group.records.values()) {
        if (!record.isContainer || !restorable.get(record.el)) continue;
        const hasRetainedChild = record.children.some(
          (child) => group.records.has(child) && !restorable.get(child)
        );
        if (hasRetainedChild) {
          restorable.set(record.el, false);
          changed = true;
        }
      }
    }

    for (const record of group.records.values()) {
      if (!restorable.get(record.el) || flowUnlockRecordIsAtRest(record)) continue;
      touchElement(record.el);
      restoreFlowUnlockRecord(record);
    }

    // Retire completed provenance so subsequent ordinary edits use the
    // pristine originalStyles contract. The transition is part of the same
    // history entry, so undo reactivates the group and redo retires it again.
    // Measured BEFORE the hold is re-derived: a hold correction that another
    // group's surviving pins still require is not this group's residue.
    const fullyRestored = [...group.records.values()].every(flowUnlockRecordIsAtRest);

    // A partial restore returns some children to flow, which re-enables the
    // margin collapse the hold was compensating for. Re-derive it here, in
    // the same transaction, so the live document, undo, and the export clone
    // all see the corrected value.
    for (const record of group.records.values()) {
      if (record.isContainer) reconcileFlatRootHold(record.el);
    }

    if (fullyRestored) setFlowUnlockGroupActive(group, false);
  }

  function unlockToAbsolute(el) {
    const slide = getActiveSlide();

    // Walk every ancestor of `el` up to (but not including) the active slide
    // and pin each one. Outermost first so inner snapshots don't see outer
    // mutations. Pinning at every level keeps both immediate siblings
    // (block-flow reflow) and outer siblings (flex/grid redistribution)
    // stable in one pass. The slide itself is never dimension-pinned — it
    // has explicit 1920x1080 dimensions (or is the inline-untouchable flat
    // root); see pinRootChildren for how its direct children are protected.
    const ancestors = [];
    {
      let cur = el;
      while (cur && cur.parentElement && cur.parentElement !== slide) {
        ancestors.push(cur.parentElement);
        cur = cur.parentElement;
      }
    }
    ancestors.reverse(); // outermost first

    // v2.15 — `el` is a DIRECT child of the slide/flat root: there is no
    // intermediate container, but siblings still reflow when the target
    // leaves the flow, so pin the root's children without mutating the root
    // itself. Slides and the flat root are already positioning contexts
    // (foreign slides are absolute; the flat root gets position: relative
    // from the editor's data-wfp-edit-flat-position-context CSS). A static
    // NON-flat root cannot anchor absolute children without a write, so it
    // falls back to the ordinary container pin — inline position: relative
    // is acceptable there, and only there. Sibling detection counts only
    // PINNABLE children (see isPinnableRootChild): when the flat root is
    // document.body, the editor overlay and <script> elements are direct
    // siblings that must count for nothing and never be pinned. A root with
    // no pinnable sibling keeps the group-of-one safety net.
    //
    // The root's flex-frozen latch is NOT consulted as a skip signal. It
    // means "an active pin holds these children", and a partial group Reset
    // can outlive that: one deliberately-edited child keeps the whole root
    // latched (see restoreFlowUnlockGroup's container-retention pass) while
    // its siblings are restored to flow. Trusting the stale latch skipped
    // sibling protection entirely on the next unlock. The pin set is
    // therefore recomputed from the children that are still pinned — the
    // already-pinned ones are left untouched (re-pinning would clobber the
    // user's edit) and only the in-flow remainder is pinned.
    let rootChildPin = null;
    if (ancestors.length === 0 && slide && el.parentElement === slide) {
      const unpinnedChildren = getPinnableRootChildren(slide).filter(
        (child) => child.dataset.wfpEditFrozen !== 'true'
      );
      if (unpinnedChildren.length > 1) {
        const isFlatRoot = slide.getAttribute('data-wfp-edit-flat-root') === 'true';
        if (!isFlatRoot && getComputedStyle(slide).position === 'static') {
          ancestors.push(slide);
        } else {
          rootChildPin = { rootEl: slide, children: unpinnedChildren };
        }
      }
    }

    const unlockGroup = prepareFlowUnlockGroup(ancestors, el, rootChildPin);
    for (const container of ancestors) {
      pinContainerChildren(container, unlockGroup);
    }
    if (rootChildPin) {
      pinRootChildren(rootChildPin.rootEl, rootChildPin.children, unlockGroup);
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
      state.pinnedStyles.set(el, el.getAttribute('style')); // v2.14 — see pinContainerChildren
      recordFlowPin(unlockGroup, el);
    }

    showToast(el, 'Unlocked. Now positioned absolutely.');
    return {
      left: el.offsetLeft,
      top: el.offsetTop,
      width: el.offsetWidth,
      height: el.offsetHeight,
    };
  }
