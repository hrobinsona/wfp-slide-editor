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

  // ---------------------------------------------------------------------------
  // Pending-transaction flush hooks.
  //
  // A control can legitimately hold state.txn open across a short settle
  // window instead of closing it the instant its own trigger event fires
  // (the opacity slider's keyboard-burst coalescing in 30-ui-inspector-
  // controls.js is the first case: closing on every `change` the way a
  // mouse drag does would fragment one held-key gesture into dozens of
  // history entries). beginTxn()'s reentry guard below — "ignore re-entry;
  // outermost owns the txn" — means any OTHER gesture that starts while
  // that window is still open would otherwise either silently merge into
  // the pending session (wrong granularity — e.g. a drag started moments
  // after an opacity change would undo as one step instead of two) or have
  // its own beginTxn() options silently discarded (data loss — e.g.
  // startTextEdit's captureHtml:true never takes effect, so the typed
  // content becomes permanently un-undoable). A control that holds a
  // session open like this MUST register a flush hook here for exactly as
  // long as the session stays open, so beginTxn() finalizes it as its own
  // history entry before deciding whether a genuine reentry exists.
  //
  // undo() and redo() flush for the same reason: they move the history
  // cursor, which is meaningless while an uncommitted edit is still parked
  // in the txn slot (see the comment above undo()).
  // ---------------------------------------------------------------------------
  const pendingTxnFlushHooks = new Set();

  function registerPendingTxnFlush(hook) {
    pendingTxnFlushHooks.add(hook);
  }

  function unregisterPendingTxnFlush(hook) {
    pendingTxnFlushHooks.delete(hook);
  }

  function flushPendingTxnSessions() {
    if (!pendingTxnFlushHooks.size) return;
    // Snapshot first — a hook's own cleanup unregisters itself mid-loop, and
    // a hook may legitimately open a NEW session, which must not be flushed
    // by the same pass. Deleting each hook BEFORE invoking it makes
    // termination structural rather than a promise each hook has to keep:
    // a hook that forgets to unregister itself (or throws before it can)
    // still cannot be invoked twice by a later flush.
    for (const hook of [...pendingTxnFlushHooks]) {
      pendingTxnFlushHooks.delete(hook);
      hook();
    }
  }

  function beginTxn(options = {}) {
    flushPendingTxnSessions();
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
    // beginTxn() re-checks state.txn itself and flushes any pending
    // settle-window session first (see the flush-hooks block above) — an
    // outer `if (!state.txn)` guard here would skip that flush whenever a
    // pending session (rather than a genuine in-progress txn) happens to
    // be why state.txn is currently set, letting this call silently reuse
    // someone else's transaction instead of opening its own.
    beginTxn(options);
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

  // The single funnel for "an element was attached to or detached from the
  // document" (paste/duplicate insert, element delete). Both change what is
  // under a flat root, and deleting its pinned children down to zero must
  // release the height hold rather than leave an emptied root propped open —
  // in the live document AND in the export, which reads the same marker.
  // Undo/redo of these ops re-derive through their own reconcile.
  function pushElementInsertEntry(op) {
    reconcileFlatRootHolds();
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
        if (op.fallbackSlide) setSlideActive(op.fallbackSlide, false);
        setSlideActive(op.slide, true);
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
      const fallbackSlide = isActiveSlide(inserted)
        ? (slides[idx + 1] || slides[idx - 1] || null)
        : null;
      if (state.selected && inserted.contains(state.selected)) setSelected(null);
      setSlideActive(inserted, false);
      deck.removeChild(inserted);
      if (!slides.some((slide) => slide !== inserted && isActiveSlide(slide)) && fallbackSlide) {
        setSlideActive(fallbackSlide, true);
      }
    }
  }
  function redoSlideOp(op) {
    if (op.type === 'reorder') {
      applySlideOrder(op.deck, op.afterOrder);
    } else if (op.type === 'delete') {
      op.deck.removeChild(op.slide);
      if (op.wasActive && op.fallbackSlide) setSlideActive(op.fallbackSlide, true);
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
      setSlideActive(op.insertedSlide, false);
      deck.insertBefore(op.insertedSlide, ref);
      observeSlideClass(op.insertedSlide);
    }
  }

  // Undo/redo are transaction boundaries in exactly the way beginTxn() is: a
  // settle-window session (the opacity slider's keyboard burst) is a real,
  // uncommitted edit parked in the shared txn slot, and moving the history
  // cursor past it corrupts both halves. Without this flush, the entry being
  // restored below overwrites the live edit wholesale — applyElementSnapshot
  // writes the entire `style` attribute — so the edit is silently discarded;
  // then the session's own timer commits from the already-moved cursor,
  // truncating the redo stack and leaving the next undo looking like it
  // stepped forward. Flushing first turns the pending session into its own
  // entry, so undo/redo simply walk one more step. Runs before the
  // index guards on purpose: the flush can add the entry those guards read.
  function undo() {
    flushPendingTxnSessions();
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
    if (
      entry.slideOps &&
      entry.slideOps.some((op) => (
        op.type === 'reorder' ||
        op.type === 'delete' ||
        op.type === 'slideInsert'
      ))
    ) {
      synchronizeSlideState();
    }
    // v2.15 — the flat-root height hold is derived from which children are
    // pinned, and this entry may have changed that set. Re-deriving is a
    // no-op whenever the snapshot pair was already consistent.
    reconcileFlatRootHolds();
    refreshSelection();
    refreshExportUi();
    if (state.overviewMode) buildOverviewOverlay();
  }

  function redo() {
    flushPendingTxnSessions(); // see undo()
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
    if (
      entry.slideOps &&
      entry.slideOps.some((op) => (
        op.type === 'reorder' ||
        op.type === 'delete' ||
        op.type === 'slideInsert'
      ))
    ) {
      synchronizeSlideState();
    }
    state.historyIndex++;
    reconcileFlatRootHolds(); // see undo()
    refreshSelection();
    refreshExportUi();
    if (state.overviewMode) buildOverviewOverlay();
  }
