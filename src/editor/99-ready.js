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
  window.__wfpEditorReady = true;
  console.log(`[wfp-editor] ready v${VERSION}`);
})();
