  // ===========================================================================
  // History (undo/redo)
  //
  // Each history entry is a list of (element, before, after) snapshots. A
  // snapshot captures the element's inline `style` plus any `data-wfp-edit-*`
  // markers that the editor adds during unlock/freeze. Undo restores every
  // element's `before`; redo restores `after`. One drag = one entry, one
  // resize = one entry, one font-size keystroke = one entry; the freeze that
  // a drag performs on flex/grid siblings and its unlock-group active state
  // are bundled into the same entry as the drag itself.
  // ===========================================================================
  function snapshotElement(el, options = {}) {
    const snap = {
      style: el.getAttribute('style'),
      editorAttrs: collectEditorDataAttributes(el),
    };
    if (options.captureHtml) snap.html = el.innerHTML;
    return snap;
  }

  function applyElementSnapshot(el, snap) {
    // Whole-attribute write is intentional here: the snapshot captured the
    // element's complete `style` attribute at change time, so restoring it
    // wholesale (or removing it entirely if it was absent) is the correct
    // undo. Per-property merging would be wrong — undo must reverse all
    // properties this change wrote, not preserve them.
    if (snap.style === null) el.removeAttribute('style');
    else el.setAttribute('style', snap.style);
    applyEditorDataAttributes(el, snap.editorAttrs || {});
    if (Object.prototype.hasOwnProperty.call(snap, 'html') && el.innerHTML !== snap.html) {
      el.innerHTML = snap.html;
    }
  }

  function snapshotsEqual(a, b) {
    const aHasHtml = Object.prototype.hasOwnProperty.call(a, 'html');
    const bHasHtml = Object.prototype.hasOwnProperty.call(b, 'html');
    return (
      a.style === b.style &&
      editorDataAttributesEqual(a.editorAttrs, b.editorAttrs) &&
      ((!aHasHtml && !bHasHtml) || a.html === b.html)
    );
  }

  function beginTxn(options = {}) {
    if (state.txn) return; // ignore re-entry; outermost owns the txn
    state.txn = {
      snapshots: new Map(),
      captureHtml: !!options.captureHtml,
      flowGroupStates: new Map(),
    };
  }

  function touchElement(el) {
    if (!state.txn || !el) return;
    if (state.txn.snapshots.has(el)) return;
    state.txn.snapshots.set(el, snapshotElement(el, state.txn));
  }

  function setFlowUnlockGroupActive(group, active) {
    if (!group) return;
    const next = !!active;
    if (group.active === next) return;
    if (state.txn && !state.txn.flowGroupStates.has(group)) {
      state.txn.flowGroupStates.set(group, !!group.active);
    }
    group.active = next;
  }

  function endTxn() {
    if (!state.txn) return;
    const txn = state.txn;
    state.txn = null;
    const changes = [];
    for (const [el, before] of txn.snapshots) {
      const after = snapshotElement(el, txn);
      if (snapshotsEqual(before, after)) continue;
      changes.push({ element: el, before, after });
      // First committed change to this element: its `before` style is the
      // pristine pre-edit value (authored inline style, or null). Reset
      // restores it. Later transactions must not overwrite it.
      if (!state.originalStyles.has(el)) state.originalStyles.set(el, before.style);
      // v2.14 — record the element in the iterable ledger set so the
      // handoff export can enumerate user-touched elements later.
      state.editedElements.add(el);
    }
    const flowGroupStates = [];
    for (const [group, beforeActive] of txn.flowGroupStates) {
      const afterActive = !!group.active;
      if (beforeActive === afterActive) continue;
      flowGroupStates.push({ group, beforeActive, afterActive });
    }
    if (changes.length === 0 && flowGroupStates.length === 0) return;
    pushHistoryEntry(changes, null, flowGroupStates);
  }

  // ---------------------------------------------------------------------------
  // Inspector-during-text-edit isolation (v2.6).
  //
  // When the user runs an inspector commit (font/colour/position/size/
  // reset) while a text edit is open, the brief calls for *exactly one*
  // history entry per adjustment, separate from the text-edit's typing
  // entry. The single-slot txn machinery would otherwise fold an
  // inspector commit into the open text-edit txn (re-entry no-ops
  // beginTxn) and the next typing batch would have no open txn.
  //
  // Pattern used at every inspector commit site:
  //   const ctx = startInspectorTxn();
  //   touchElement(el);  // (or whatever the commit needs)
  //   ...mutations...
  //   endInspectorTxn(ctx);
  //
  // If text-edit is not open, this is just begin/end. If text-edit is
  // open, it commits the typing-so-far as one entry, isolates the
  // inspector op as another, then re-opens a fresh text-edit txn so
  // subsequent typing accumulates into a new entry on commit.
  // ---------------------------------------------------------------------------
  function startInspectorTxn(options = {}) {
    let restoreEditingEl = null;
    if (state.editingText) {
      restoreEditingEl = state.editingText.el;
      if (state.txn) endTxn(); // commits typing-so-far
    }
    if (!state.txn) beginTxn(options);
    return restoreEditingEl;
  }

  function endInspectorTxn(restoreEditingEl) {
    if (state.txn) endTxn();
    if (
      restoreEditingEl &&
      state.editingText &&
      state.editingText.el === restoreEditingEl
    ) {
      beginTxn({ captureHtml: true });
      touchElement(restoreEditingEl);
    }
  }

  function pushHistoryEntry(changes, slideOps = null, flowGroupStates = null) {
    // Truncate any redo stack — a fresh change invalidates everything
    // beyond the current cursor.
    state.history.length = state.historyIndex;
    const entry = { changes };
    if (slideOps && slideOps.length) entry.slideOps = slideOps;
    if (flowGroupStates && flowGroupStates.length) entry.flowGroupStates = flowGroupStates;
    state.history.push(entry);
    state.historyIndex = state.history.length;
    while (state.history.length > HISTORY_MAX) {
      state.history.shift();
      state.historyIndex--;
    }
    pruneInactiveFlowUnlockGroups();
  }

  function pushElementInsertEntry(op) {
    pushHistoryEntry([], [op]);
  }

  // Slide-level history op handlers. These run alongside the per-element
  // `changes` array — they EXTEND the entry shape rather than replacing
  // it. Op types: 'reorder' (v2.1.3), 'delete' (v2.1.4),
  // 'elementInsert', 'elementDelete', and 'slideInsert'.
  function undoSlideOp(op) {
    if (op.type === 'reorder') {
      applySlideOrder(op.deck, op.beforeOrder);
    } else if (op.type === 'delete') {
      // Re-attach the deleted slide at its original position. Using
      // node refs (slide + nextSibling) means undo lands the slide in
      // the correct spot even if intervening reorder ops have shuffled
      // its neighbours — node refs follow nodes through reorders.
      // Defensive fallback: if a later op has DELETED the captured
      // nextSibling (orphaning the ref), insertBefore would throw —
      // append to the end instead so the undo still succeeds, just at
      // a less-precise position.
      const ref = (op.nextSibling && op.nextSibling.parentElement === op.deck) ? op.nextSibling : null;
      op.deck.insertBefore(op.slide, ref);
      if (op.wasActive) {
        if (op.fallbackSlide) op.fallbackSlide.classList.remove('active');
        op.slide.classList.add('active');
      }
    } else if (op.type === 'elementInsert') {
      if (op.insertedEl && op.insertedEl.parentElement === op.parentEl) {
        op.parentEl.removeChild(op.insertedEl);
      }
      if (state.selected === op.insertedEl) {
        const fallback = (
          op.previousSelectedEl &&
          op.previousSelectedEl.isConnected &&
          op.slideEl &&
          op.slideEl.contains(op.previousSelectedEl)
        ) ? op.previousSelectedEl : null;
        setSelected(fallback);
        refreshInspector();
      }
    } else if (op.type === 'elementDelete') {
      if (!op.parentEl || !op.deletedEl) return;
      const ref = (
        op.nextSiblingEl &&
        op.nextSiblingEl.parentElement === op.parentEl
      ) ? op.nextSiblingEl : null;
      op.parentEl.insertBefore(op.deletedEl, ref);
      setSelected(op.deletedEl);
      refreshInspector();
    } else if (op.type === 'slideInsert') {
      const deck = op.deckEl || op.deck;
      const inserted = op.insertedSlide;
      if (!deck || !inserted || inserted.parentElement !== deck) return;
      const slides = [...deck.querySelectorAll(':scope > .slide')];
      const idx = slides.indexOf(inserted);
      const fallbackSlide = inserted.classList.contains('active')
        ? (slides[idx + 1] || slides[idx - 1] || null)
        : null;
      if (state.selected && inserted.contains(state.selected)) setSelected(null);
      inserted.classList.remove('active');
      deck.removeChild(inserted);
      if (!deck.querySelector(':scope > .slide.active') && fallbackSlide) {
        fallbackSlide.classList.add('active');
      }
    }
  }
  function redoSlideOp(op) {
    if (op.type === 'reorder') {
      applySlideOrder(op.deck, op.afterOrder);
    } else if (op.type === 'delete') {
      op.deck.removeChild(op.slide);
      if (op.wasActive && op.fallbackSlide) op.fallbackSlide.classList.add('active');
    } else if (op.type === 'elementInsert') {
      if (!op.parentEl || !op.insertedEl) return;
      const ref = (
        op.nextSiblingEl &&
        op.nextSiblingEl.parentElement === op.parentEl
      ) ? op.nextSiblingEl : null;
      op.parentEl.insertBefore(op.insertedEl, ref);
      setSelected(op.insertedEl);
      refreshInspector();
    } else if (op.type === 'elementDelete') {
      if (!op.parentEl || !op.deletedEl) return;
      if (op.deletedEl.parentElement === op.parentEl) {
        op.parentEl.removeChild(op.deletedEl);
      }
      if (state.selected === op.deletedEl || (state.selected && op.deletedEl.contains(state.selected))) {
        setSelected(null);
        refreshInspector();
      }
    } else if (op.type === 'slideInsert') {
      const deck = op.deckEl || op.deck;
      if (!deck || !op.insertedSlide) return;
      const ref = (
        op.beforeSibling &&
        op.beforeSibling.parentElement === deck
      ) ? op.beforeSibling : null;
      op.insertedSlide.classList.remove('active');
      deck.insertBefore(op.insertedSlide, ref);
      observeSlideClass(op.insertedSlide);
    }
  }

  function undo() {
    if (state.historyIndex <= 0) return;
    state.historyIndex--;
    const entry = state.history[state.historyIndex];
    // Slide-level ops in reverse order first, then per-element snapshots.
    if (entry.slideOps) {
      for (let i = entry.slideOps.length - 1; i >= 0; i--) undoSlideOp(entry.slideOps[i]);
    }
    if (entry.changes) {
      for (const c of entry.changes) applyElementSnapshot(c.element, c.before);
    }
    if (entry.flowGroupStates) {
      for (const transition of entry.flowGroupStates) {
        transition.group.active = transition.beforeActive;
      }
    }
    refreshSelection();
    refreshExportUi();
    if (state.overviewMode) buildOverviewOverlay();
  }

  function redo() {
    if (state.historyIndex >= state.history.length) return;
    const entry = state.history[state.historyIndex];
    if (entry.changes) {
      for (const c of entry.changes) applyElementSnapshot(c.element, c.after);
    }
    if (entry.flowGroupStates) {
      for (const transition of entry.flowGroupStates) {
        transition.group.active = transition.afterActive;
      }
    }
    if (entry.slideOps) {
      for (const op of entry.slideOps) redoSlideOp(op);
    }
    state.historyIndex++;
    refreshSelection();
    refreshExportUi();
    if (state.overviewMode) buildOverviewOverlay();
  }
