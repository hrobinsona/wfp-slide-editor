  // ===========================================================================
  // State
  // ===========================================================================
  const state = {
    editMode: false,
    selected: null,
    drag: null, // { el, startX, startY, anchorLeft, anchorTop, width, height, wasAbsolute, started }
    resize: null, // { el, dir, startX, startY, initLeft, initTop, initWidth, initHeight }
    editingText: null, // { el, originalContenteditable, savedRange } while a text edit is open
    suppressClickUntil: 0,
    history: [], // entries: [{ changes: [{element, before, after}, ...] }]
    historyIndex: 0, // 0 = nothing applied; history.length = all applied
    txn: null, // { snapshots: Map<Element, BeforeSnap>, captureHtml } when an op is in progress
    clipboard: null, // { outerHTML } session-only element copy/paste payload
    inspectorMinimised: false, // persists across selections within session; resets on reload
    overviewMode: false, // v2.1.0 — bird's-eye grid of all slides; toggled by hotkey O / toolbar button / Escape
    overviewDrag: null, // v2.1.3 — { sourceSlide, sourceIndex, beforeOrder } during a drag-to-reorder
    overviewHoveredSlide: null, // v2.1.4 — slide whose thumb the cursor is over (Backspace/Delete target)
    deckMutated: false, // v2.1.0 hotfix — set true on first overview reorder/delete; flips arrow-nav to live-DOM (the fixture's cached slide list goes stale)
  };
