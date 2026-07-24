  // ===========================================================================
  // Ready
  // ===========================================================================
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
