  // ===========================================================================
  // State
  // ===========================================================================
  const state = {
    editMode: false,
    selected: null,
    selectedElements: [], // active-slide selection members; state.selected is the primary member
    drag: null, // { el, items: [{ el, anchorLeft, anchorTop, wasAbsolute }], startX, startY, started }
    resize: null, // { el, dir, startX, startY, initLeft, initTop, initWidth, initHeight }
    editingText: null, // { el, originalContenteditable, savedRange } while a text edit is open
    suppressClickUntil: 0,
    history: [], // entries: [{ changes: [{element, before, after}, ...] }]
    historyIndex: 0, // 0 = nothing applied; history.length = all applied
    txn: null, // { snapshots: Map<Element, BeforeSnap>, captureHtml } when an op is in progress
    originalStyles: new WeakMap(), // Element → pre-edit inline `style` value (string | null), captured at the element's first committed change; Reset restores this
    clipboard: null, // { outerHTML } session-only element copy/paste payload
    inspectorMinimised: false, // persists across selections within session; resets on reload
    toolbarCollapsed: false, // ink-glass 3b — bar folded to Edit + chevron; session-only
    exportMenuOpen: false, // v2.11 — export action menu (4b) open/closed
    overviewMode: false, // v2.1.0 — bird's-eye grid of all slides; toggled by hotkey O / toolbar button / Escape
    overviewDrag: null, // v2.1.3 — { sourceSlide, sourceIndex, beforeOrder } during a drag-to-reorder
    overviewHoveredSlide: null, // v2.1.4 — slide whose thumb the cursor is over (Backspace/Delete target)
    deckMutated: false, // v2.1.0 hotfix — set true on first overview reorder/delete; flips arrow-nav to live-DOM (the fixture's cached slide list goes stale)
    agentResultsSummary: null, // v2.13 — {done, skipped, needsInput} parsed from the agent results block at import; consumed by the ready toast. Lives on state (not a module let) because reimport runs during an earlier fragment's evaluation.
  };
  const deckContext = resolveDeckRoot();
