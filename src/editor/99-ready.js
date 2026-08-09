  // ===========================================================================
  // Ready
  // ===========================================================================
  // v2.22 — Markdown mode. The host re-renders the document whenever the file
  // is written, which detaches every node the editor may be holding. `reset`
  // lets it drop the selection BEFORE that happens (a selection pointing at
  // detached DOM is the exact hazard the history layer guards against), and
  // `refresh` re-scans the freshly stamped annotations so markers and the
  // notes panel match the new file.
  if (state.markdownMode) {
    // Unlike a deck — which you might simply be viewing — the Markdown review
    // surface exists only to annotate, so starting in view mode is a step that
    // never has a reason to be skipped. Enter edit mode immediately.
    setEditMode(true);
    window.__wfpMarkdownBridge = {
      reset() {
        if (state.editingText) endTextEdit();
        setSelected(null);
        refreshInspector();
      },
      refresh() {
        refreshExportUi();
      },
    };
  }
  if (canSaveInPlace()) {
    // Capture the promise so saveInPlace() can await this same rehydration
    // instead of racing it (see the handleRehydration check above).
    handleRehydration = loadStoredHandle()
      .then((handle) => {
        if (handle && !boundFileHandle) boundFileHandle = handle;
      })
      .catch(() => {});
  }
  // Live agent round-trip (v2.13): adopt state handed over by a previous
  // instance across a document.write refresh, then watch the bound file
  // for external (agent) writes.
  adoptLiveRefreshState();
  if (canSaveInPlace()) startAgentWatch();
  consumeAgentResultsSummaryToast();
  window.__wfpEditorReady = true;
  console.log(`[wfp-editor] ready v${VERSION}`);
})();
