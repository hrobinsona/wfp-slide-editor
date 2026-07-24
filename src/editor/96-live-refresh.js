  // ===========================================================================
  // Live agent round-trip (v2.13)
  //
  // When an agent rewrites the bound save-in-place file on disk, the editor
  // refreshes the document in place: no reload, no bookmarklet re-click, no
  // permission re-grant. Contract in REQUIREMENTS.md (“Live Agent
  // Round-trip”); design rationale in DESIGN.md; build record in
  // feature-briefs/v2.13-live-agent-roundtrip.md.
  //
  // Mechanism:
  //   - Poll boundFileHandle.getFile().lastModified (~1.2s).
  //   - On an external change: stash a restore payload on window (the
  //     window object and its globals survive document.open() — only the
  //     Document's contents and its event listeners are replaced), then
  //     document.open()/write()/close() the new HTML. That erases
  //     document-level listeners (the deck's stale nav handler and the old
  //     editor's own keydown capture) and re-executes deck scripts exactly
  //     once during the write. Finally re-inject the editor script
  //     captured at boot.
  //   - The new instance adopts the payload at ready: same file handle,
  //     edit mode, active slide, fold states — and deckMutated, because
  //     the re-parsed deck script's closures reset to slide 0, which is
  //     exactly the staleness deckMutated's arrow-nav takeover covers.
  // ===========================================================================
  const AGENT_WATCH_INTERVAL_MS = 1200;
  const LIVE_RESTORE_KEY = '__wfpLiveRefreshRestore';

  // Boot generation counter — test-observable signal that a fresh editor
  // instance finished evaluating (initial load = 1, first refresh = 2, ...).
  window.__wfpEditorGeneration = (window.__wfpEditorGeneration || 0) + 1;

  // Captured while this script evaluates: how to re-inject the editor after
  // document.write() wipes the DOM. Bookmarklet loads carry a src; dev /
  // Playwright addScriptTag injection is inline text.
  const editorScriptRef = (() => {
    const cs = document.currentScript
      || document.querySelector('script[data-wfp-edit-script], script[src*="editor.js"]');
    if (!cs) return null;
    return cs.src ? { src: cs.src } : { text: cs.textContent };
  })();

  let agentWatchTimer = null;
  let agentWatchBaseline = null; // lastModified of the content we last wrote/adopted
  let agentWatchPaused = false;
  let agentWatchBusy = false;

  function agentWatchPause() {
    agentWatchPaused = true;
  }

  function agentWatchResume() {
    agentWatchPaused = false;
  }

  // "Paused" has been announced and "resumed" hasn't yet. The flag only
  // gates the two announcements — a recovered handle refreshes regardless.
  let watchDormant = false;

  // Called after our own successful save so the watcher never mistakes the
  // editor's write for an agent update. A successful save is also the
  // re-link moment when the watch had gone dormant.
  async function agentWatchSyncBaseline(handle) {
    try {
      if (handle && typeof handle.getFile === 'function') {
        const f = await handle.getFile();
        agentWatchBaseline = f.lastModified;
        if (watchDormant) {
          watchDormant = false;
          showToast(document.body, 'Live updates resumed.');
        }
      }
    } catch (_) {
      /* keep the old baseline; the next tick retries */
    }
  }

  // A refresh must not fire mid-interaction: the swap would destroy open
  // transactions, text edits, drags, or overlay state. Deferring instead of
  // dropping works because the baseline only advances on a successful swap,
  // so the next idle tick picks the change up again.
  function isInteractionOpen() {
    return !!(
      state.txn ||
      state.editingText ||
      state.drag ||
      state.resize ||
      state.overviewMode ||
      state.exportMenuOpen
    );
  }

  async function agentWatchTick() {
    if (agentWatchPaused || agentWatchBusy) return;
    const handle = boundFileHandle;
    if (!handle || typeof handle.getFile !== 'function') return;
    agentWatchBusy = true;
    try {
      const f = await handle.getFile();
      if (agentWatchBaseline === null) {
        // First sight of the file (e.g. a handle rehydrated from IndexedDB
        // before any save this session): adopt the current mtime instead of
        // treating pre-existing history as a change.
        agentWatchBaseline = f.lastModified;
        return;
      }
      if (f.lastModified <= agentWatchBaseline) return;
      if (isInteractionOpen()) return; // deferred — retried next tick
      const html = await f.text();
      // Re-check after the awaits: a save may have paused the watcher while
      // this tick was in flight. (The baseline guard defuses this in
      // practice; the check makes the invariant explicit.)
      if (agentWatchPaused) return;
      agentWatchBaseline = f.lastModified;
      await performLiveRefresh(html, f.lastModified);
    } catch (err) {
      const name = err && err.name;
      if ((name === 'NotAllowedError' || name === 'SecurityError') && !watchDormant) {
        watchDormant = true;
        showToast(document.body, 'Live updates paused — file access needed. Save to re-link.');
      }
      /* other read failures are transient — retry next tick */
    } finally {
      agentWatchBusy = false;
    }
  }

  function startAgentWatch() {
    if (agentWatchTimer) return;
    agentWatchTimer = setInterval(agentWatchTick, AGENT_WATCH_INTERVAL_MS);
  }

  function captureActiveSlideIndex() {
    const slides = getSlides();
    return Math.max(0, slides.findIndex((s) => s.classList.contains('active')));
  }

  async function performLiveRefresh(html, lastModified) {
    // The old instance orchestrates its own replacement. Stop the poll and
    // detach our window-level listeners: document-level listeners are
    // erased by document.open(), window-level ones are not guaranteed to
    // be — the spike's probe measures which, this is belt and braces.
    clearInterval(agentWatchTimer);
    agentWatchTimer = null;
    try {
      window.removeEventListener('scroll', scheduleOverviewReposition, true);
      window.removeEventListener('resize', scheduleOverviewReposition);
    } catch (_) {
      /* best-effort */
    }

    window[LIVE_RESTORE_KEY] = {
      handle: boundFileHandle,
      lastModified,
      editMode: state.editMode,
      slideIndex: captureActiveSlideIndex(),
      inspectorMinimised: state.inspectorMinimised,
      toolbarCollapsed: state.toolbarCollapsed,
    };

    // Replace the document wholesale. Same Document object, same realm,
    // same URL — but the children are replaced, document-level listeners
    // are erased, and <script> tags in the new HTML execute fresh during
    // the write, so the deck's own navigation rebinds to the new DOM.
    document.open();
    document.write(html);
    document.close();

    // Re-inject the editor. The saved file never contains the editor
    // (export strips it), so the ROOT_ID singleton guard passes.
    if (editorScriptRef) {
      const s = document.createElement('script');
      if (editorScriptRef.src) s.src = editorScriptRef.src;
      else s.textContent = editorScriptRef.text;
      (document.body || document.documentElement).appendChild(s);
    }
  }

  // Runs in the NEW instance at ready: adopt what the old instance left.
  function adoptLiveRefreshState() {
    const payload = window[LIVE_RESTORE_KEY];
    if (!payload) return;
    delete window[LIVE_RESTORE_KEY];

    if (payload.handle) {
      boundFileHandle = payload.handle;
      agentWatchBaseline = typeof payload.lastModified === 'number' ? payload.lastModified : null;
    }

    // Flat documents have no slide pagination: getSlides() returns the flat
    // root itself, and toggling `active` there would stamp a class onto a
    // user element that export never strips.
    if (getDocumentMode() !== 'flat') {
      const slides = getSlides();
      const idx = Math.min(payload.slideIndex || 0, slides.length - 1);
      if (idx >= 0 && slides[idx]) {
        const dots = document.querySelectorAll('.progress-dot');
        slides.forEach((s, i) => s.classList.toggle('active', i === idx));
        dots.forEach((d, i) => d.classList.toggle('active', i === idx));
      }
      // The re-parsed deck script cached slide 0 as current; hand plain-view
      // arrow nav to the editor's fresh-DOM implementation, the same
      // mechanism used after overview reorder/delete.
      state.deckMutated = true;
    }

    state.inspectorMinimised = !!payload.inspectorMinimised;
    if (payload.toolbarCollapsed) setToolbarCollapsed(true);
    if (payload.editMode) setEditMode(true);
    // When the refreshed file carried a results block, the ready-time
    // summary toast is the more informative message — skip the generic one.
    if (!state.agentResultsSummary) {
      showToast(document.body, 'Reloaded from disk — agent update applied.');
    }
  }
