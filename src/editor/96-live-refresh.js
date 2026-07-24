  // ===========================================================================
  // Live agent round-trip — SPIKE (worktree-only; not production code)
  //
  // Validates the riskiest assumption behind the "Live Agent Round-trip"
  // roadmap candidate: after an agent rewrites the saved file on disk, the
  // editor detects the write through the bound FileSystemFileHandle, swaps
  // the new document into the live page without a navigation, and re-boots
  // itself with edit mode and the active slide restored.
  //
  // Mechanism:
  //   - Poll boundFileHandle.getFile().lastModified.
  //   - On an external change: stash a restore payload on window (the
  //     window object and its globals survive document.open() — only the
  //     Document's contents and its event listeners are replaced), then
  //     document.open()/write()/close() the new HTML. That erases
  //     document-level listeners (the fixture's stale nav handler and the
  //     old editor's own keydown capture) and re-executes deck scripts
  //     fresh during the write. Finally re-inject the editor script that
  //     was captured at boot.
  //   - The new instance adopts the payload at ready: same file handle (no
  //     re-pick, no re-grant), edit mode, active slide — and deckMutated,
  //     because the re-parsed deck script's closures reset to slide 0,
  //     which is exactly the staleness deckMutated's arrow-nav takeover
  //     already exists to cover.
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

  // Called after our own successful save so the watcher never mistakes the
  // editor's write for an agent update.
  async function agentWatchSyncBaseline(handle) {
    try {
      if (handle && typeof handle.getFile === 'function') {
        const f = await handle.getFile();
        agentWatchBaseline = f.lastModified;
      }
    } catch (_) {
      /* keep the old baseline; the next tick retries */
    }
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
      if (f.lastModified > agentWatchBaseline) {
        const html = await f.text();
        agentWatchBaseline = f.lastModified;
        await performLiveRefresh(html, f.lastModified);
      }
    } catch (_) {
      /* transient read failure (e.g. permission dropped) — retry next tick */
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
    if (getDocumentMode() !== 'flat') state.deckMutated = true;

    if (payload.editMode) setEditMode(true);
    showToast(document.body, 'Reloaded from disk — agent update applied.');
  }
