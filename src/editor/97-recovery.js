  // Local working copies are separate from both the source file and clean
  // downloads. IndexedDB accommodates embedded images without localStorage's
  // small synchronous quota. A failed transaction never counts as a backup.
  const RECOVERY_DB = 'wfp-editor-recovery';
  const RECOVERY_HANDOVER = '__wfpRecoveryHandover';
  let recovery = null;

  function recoveryFingerprint() {
    if (recovery && !recovery.needsFingerprint) return recovery.current;
    const clone = buildExportClone({ absolutizeAssets: false });
    removeHandoffArtifacts(clone);
    // Host scale is viewport state; the editor never edits a deck root.
    for (const deck of getExportDeckRoots(clone)) {
      deck.style.removeProperty('transform');
      deck.style.removeProperty('transform-origin');
      if (!deck.getAttribute('style')) deck.removeAttribute('style');
    }
    for (const el of [clone, ...clone.querySelectorAll('*')]) {
      for (const attr of [...el.attributes]) {
        if (attr.name.startsWith('data-wfp-edit') && !attr.name.startsWith('data-wfp-edit-annotation-')) {
          el.removeAttribute(attr.name);
        }
      }
      el.removeAttribute('contenteditable');
    }
    const html = clone.outerHTML;
    let hash = 2166136261;
    for (let i = 0; i < html.length; i++) hash = Math.imul(hash ^ html.charCodeAt(i), 16777619);
    const value = `${html.length}:${hash >>> 0}`;
    if (recovery) { recovery.current = value; recovery.needsFingerprint = false; }
    return value;
  }

  function recoveryStore(action, key, value) {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(RECOVERY_DB, 1);
      let settled = false;
      const timer = setTimeout(() => finish(new Error('Recovery storage timed out')), 4000);
      function finish(err, result) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (err) reject(err); else resolve(result);
      }
      req.onupgradeneeded = () => req.result.createObjectStore('snapshots');
      req.onerror = () => finish(req.error);
      req.onblocked = () => finish(new Error('Recovery storage blocked'));
      req.onsuccess = () => {
        const db = req.result;
        if (settled) { db.close(); return; }
        try {
          const tx = db.transaction('snapshots', action === 'get' ? 'readonly' : 'readwrite');
          const store = tx.objectStore('snapshots');
          const op = action === 'put' ? store.put(value, key) : store[action](key);
          let result;
          op.onsuccess = () => { result = op.result; };
          tx.oncomplete = () => { db.close(); finish(null, result); };
          tx.onabort = tx.onerror = () => { db.close(); finish(tx.error || new Error('Recovery storage failed')); };
        } catch (err) { db.close(); finish(err); }
      };
    });
  }

  function recoveryIsDirty() {
    return !!recovery && recoveryFingerprint() !== recovery.source;
  }

  function renderRecoveryStatus() {
    if (!recovery) return;
    const dirty = recoveryIsDirty();
    const parts = [recovery.saving ? 'Saving…' : dirty ? 'Unsaved changes' : recovery.saved ? 'Saved to source' : 'Source unchanged'];
    if (recovery.error) parts.push('Local recovery unavailable — download a copy');
    else if (recovery.offer) parts.push('Local copy available — choose Restore or Discard');
    else if (recovery.persisted === recoveryFingerprint() && dirty) parts.push('Local recovery saved');
    else if (dirty) parts.push('Local recovery pending');
    if (recovery.pending) parts.push('Newer file waiting — Save blocked');
    recovery.status.textContent = parts.join(' · ');
    recovery.status.dataset.dirty = String(dirty);
  }

  function recoveryContentChanged() {
    if (!recovery || recovery.disposed) return;
    clearTimeout(recovery.timer);
    recovery.needsFingerprint = true;
    // Invalidate the visible backup claim synchronously. Keeping yesterday's
    // "saved" label during the debounce invites a reload before the new write.
    if (!recovery.loading && !recovery.offer && !recovery.pending) {
      recovery.status.textContent = recovery.saving ? 'Saving… · New changes pending' :
        recovery.error ? 'Unsaved changes · Local recovery unavailable — download a copy' :
          'Unsaved changes · Local recovery pending';
      recovery.status.dataset.dirty = 'true';
    }
    recovery.timer = setTimeout(() => {
      renderRecoveryStatus();
      persistRecovery().catch(() => {});
    }, 350);
  }

  // Serialise writes. If content changes while assets are being collected,
  // discard that build and queue another, never label it as the latest copy.
  function persistRecovery() {
    if (!recovery || recovery.disposed) return Promise.resolve(false);
    const owner = recovery;
    owner.queue = owner.queue.catch(() => {}).then(async () => {
      if (owner.disposed || owner.offer || owner.loading) return false;
      const fingerprint = recoveryFingerprint();
      if (fingerprint === owner.persisted) return true;
      try {
        if (fingerprint === owner.source) {
          await recoveryStore('delete', location.href);
          owner.persisted = null;
        } else {
          const html = await buildHandoffExportHtml({ absolutizeAssets: false });
          if (owner.disposed || fingerprint !== recoveryFingerprint()) {
            if (!owner.disposed) recoveryContentChanged();
            return false;
          }
          const record = { version: 1, url: location.href, time: Date.now(), source: owner.source, fingerprint, html };
          await recoveryStore('put', location.href, record);
          owner.persisted = fingerprint;
        }
        owner.error = false;
        renderRecoveryStatus();
        return true;
      } catch (_) {
        owner.error = true;
        renderRecoveryStatus();
        return false;
      }
    });
    return owner.queue;
  }

  function recoveryButton(label, action) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.addEventListener('click', async (event) => {
      event.stopPropagation();
      button.disabled = true;
      try { await action(); } catch (_) {
        showToast(document.body, 'Could not complete recovery action. Your document is unchanged.');
      } finally { button.disabled = false; }
    });
    recovery.panel.appendChild(button);
  }

  function showRecoveryOffer(record, previous = false) {
    recovery.offer = record;
    recovery.offerPrevious = previous;
    const stale = record.source !== recovery.source;
    recovery.panel.replaceChildren();
    recovery.panel.hidden = false;
    const message = document.createElement('p');
    message.textContent = `${previous ? 'Previous local work' : 'Local working copy'} from ${new Date(record.time).toLocaleString()}.${stale ? ' The source has changed since this copy was made.' : ''} Restore replaces the current document; undo history starts fresh.`;
    recovery.panel.appendChild(message);
    recoveryButton('Restore local copy', async () => {
      if (hasPendingNoteDraft()) { showToast(document.body, 'Save or discard your note draft before restoring.'); return; }
      if (state.editingText) endTextEdit();
      // Keep the loaded source available if this recovery belongs to an older
      // source revision. Restoring is explicit; writing over it is not.
      const before = recoveryFingerprint();
      if (before !== recovery.source) {
        const currentHtml = await buildHandoffExportHtml({ absolutizeAssets: false });
        if (before !== recoveryFingerprint() || hasPendingNoteDraft()) return;
        await recoveryStore('put', location.href + ':previous', {
          version: 1, url: location.href, time: Date.now(), source: recovery.source,
          fingerprint: before, html: currentHtml,
        });
        if (before !== recoveryFingerprint() || hasPendingNoteDraft()) return;
      }
      const pending = stale ? { html: await buildHandoffExportHtml({ absolutizeAssets: false }), lastModified: agentWatchBaseline } : null;
      if (before !== recoveryFingerprint() || hasPendingNoteDraft()) {
        showToast(document.body, 'The document changed during recovery. Please try Restore again.');
        return;
      }
      window[RECOVERY_HANDOVER] = { source: recovery.source, pending, restored: true };
      await performLiveRefresh(record.html, agentWatchBaseline);
    });
    recoveryButton('Discard local copy', async () => {
      await recoveryStore('delete', location.href + (previous ? ':previous' : ''));
      recovery.offer = null;
      recovery.panel.hidden = true;
      recoveryContentChanged();
    });
    renderRecoveryStatus();
  }

  function recoveryHoldExternal(html, lastModified) {
    if (!recovery) return false;
    if (!recoveryIsDirty() && !recovery.offer && !recovery.saving && !recovery.pending) return false;
    if (recovery.pending?.html === html && recovery.pending.lastModified === lastModified) return true;
    recovery.pending = { html, lastModified };
    showRecoveryConflict();
    return true;
  }

  function showRecoveryConflict() {
    recovery.panel.replaceChildren();
    recovery.panel.hidden = false;
    const message = document.createElement('p');
    message.textContent = 'A newer file is available. Your local work is still here. Save is blocked until you apply the newer file. Download your local copy to keep a separate file.';
    recovery.panel.appendChild(message);
    recoveryButton('Keep local work', () => { recovery.panel.hidden = true; });
    recoveryButton('Download local copy', async () => {
      if (state.editingText) endTextEdit();
      triggerDownload(deriveExportFilename('-local-working-copy'), await buildHandoffExportHtml());
    });
    recoveryButton('Apply newer file', async () => {
      if (hasPendingNoteDraft()) { showToast(document.body, 'Save or discard your note draft before applying the newer file.'); return; }
      if (state.editingText) endTextEdit();
      flushPendingTxnSessions();
      const before = recoveryFingerprint();
      const html = await buildHandoffExportHtml({ absolutizeAssets: false });
      if (before !== recoveryFingerprint() || hasPendingNoteDraft()) return;
      // Applying is only safe when the prior local document can be recovered.
      // Keep a separate slot: normal autosave of the new source cannot erase it.
      try {
        await recoveryStore('put', location.href + ':previous', {
          version: 1, url: location.href, time: Date.now(), source: recovery.source,
          fingerprint: recoveryFingerprint(), html,
        });
      } catch (_) {
        recovery.error = true;
        renderRecoveryStatus();
        showToast(document.body, 'Could not back up local work. Download a local copy before changing files.');
        return;
      }
      const pending = recovery.pending;
      if (before !== recoveryFingerprint() || hasPendingNoteDraft()) return;
      await recoveryStore('delete', location.href);
      if (before !== recoveryFingerprint() || hasPendingNoteDraft()) {
        showToast(document.body, 'The document changed while backing up. Please apply again.');
        return;
      }
      window[RECOVERY_HANDOVER] = { applied: true };
      await performLiveRefresh(pending.html, pending.lastModified);
    });
    renderRecoveryStatus();
  }

  function recoveryBeginSave() {
    if (!recovery) return {};
    if (recovery.saving) return null;
    if (recovery.pending) { showRecoveryConflict(); return null; }
    if (recovery.offer || recovery.loading) {
      showToast(document.body, 'Choose Restore or Discard for the local working copy before saving.');
      return null;
    }
    const token = { fingerprint: recoveryFingerprint() };
    recovery.saving = token;
    renderRecoveryStatus();
    return token;
  }

  async function recoveryCheckBeforeWrite(handle) {
    if (recovery && recovery.pending) { showRecoveryConflict(); return false; }
    if (!handle || typeof handle.getFile !== 'function') return true;
    const file = await handle.getFile();
    if (agentWatchBaseline !== null && file.lastModified !== agentWatchBaseline) {
      const html = await file.text();
      if (recovery) {
        recovery.pending = { html, lastModified: file.lastModified };
        showRecoveryConflict();
      }
      return false;
    }
    // First explicitly selected destination: its existing version is the
    // save baseline. The final pre-write check detects intervening updates.
    if (agentWatchBaseline === null) agentWatchBaseline = file.lastModified;
    return true;
  }

  function recoverySaveSucceeded(token) {
    if (!recovery) return;
    recovery.source = token.fingerprint;
    recovery.saved = true;
    recoveryContentChanged();
  }

  function recoveryEndSave(token) {
    if (!recovery || recovery.saving !== token) return;
    recovery.saving = null;
    recoveryContentChanged();
  }

  function disposeRecovery() {
    if (!recovery) return;
    recovery.disposed = true;
    clearTimeout(recovery.timer);
    recovery.observer.disconnect();
    window.removeEventListener('beforeunload', recovery.beforeUnload);
    document.removeEventListener('visibilitychange', recovery.onVisibility);
  }

  function initRecovery() {
    if (state.markdownMode) return; // Markdown host owns its writeback lifecycle.
    const handover = window[RECOVERY_HANDOVER];
    delete window[RECOVERY_HANDOVER];
    const status = document.createElement('button');
    status.type = 'button';
    status.className = 'wfpe-recovery-status';
    status.setAttribute('aria-live', 'polite');
    const panel = document.createElement('div');
    panel.className = 'wfpe-recovery-panel';
    panel.setAttribute('role', 'region');
    panel.setAttribute('aria-label', 'Working copy recovery');
    panel.hidden = true;
    root.append(status, panel);
    const css = document.createElement('style');
    css.textContent = `
      #${ROOT_ID} .wfpe-recovery-status, #${ROOT_ID} .wfpe-recovery-panel { position: fixed; left: 16px; bottom: 16px; max-width: min(520px, calc(100vw - 32px)); box-sizing: border-box; color: white; background: rgba(22,25,31,.95); border: 1px solid #697180; border-radius: 9px; font: 12px/1.5 system-ui,sans-serif; padding: 8px 12px; pointer-events: auto; z-index: 8; text-align: left; }
      #${ROOT_ID} .wfpe-recovery-panel { bottom: 76px; max-height: calc(100vh - 130px); overflow: auto; }
      #${ROOT_ID} .wfpe-recovery-panel[hidden] { display: none; }
      #${ROOT_ID} .wfpe-recovery-panel p { margin: 0 0 10px; }
      #${ROOT_ID} .wfpe-recovery-panel button { color: white; background: #344155; border: 1px solid #8190a5; border-radius: 5px; padding: 7px; margin: 3px; font: inherit; cursor: pointer; }
      #${ROOT_ID} .wfpe-recovery-panel button:focus-visible, #${ROOT_ID} .wfpe-recovery-status:focus-visible { outline: 2px solid #ffba9d; outline-offset: 2px; }
    `;
    root.appendChild(css);
    recovery = {
      source: handover && handover.source || recoveryFingerprint(), status, panel,
      pending: handover && handover.pending || null, offer: null, saving: null,
      queue: Promise.resolve(), persisted: null, loading: true, error: false,
      needsFingerprint: true, current: null,
    };
    status.addEventListener('click', () => {
      if (recovery.pending) showRecoveryConflict();
      else if (recovery.offer) showRecoveryOffer(recovery.offer, recovery.offerPrevious);
    });
    for (const type of ['mousedown', 'pointerdown', 'touchstart', 'click', 'wheel']) {
      panel.addEventListener(type, event => event.stopPropagation());
    }
    recovery.observer = new MutationObserver((records) => {
      if (records.some(record => {
        if (root.contains(record.target) || record.target === root) return false;
        if (record.type === 'attributes') {
          const name = record.attributeName;
          if (name === 'contenteditable' || name === EDIT_LEDGER_TARGET_ATTR) return false;
          if (name.startsWith('data-wfp-edit') && !name.startsWith('data-wfp-edit-annotation-')) return false;
          if (name === 'style' && getExportDeckRoots(document).includes(record.target)) return false;
        }
        return true;
      })) recoveryContentChanged();
    });
    recovery.observer.observe(document.documentElement, { subtree: true, attributes: true, childList: true, characterData: true });
    recovery.beforeUnload = (event) => {
      if (!recoveryIsDirty() && !hasPendingNoteDraft()) return;
      // Browsers do not guarantee async writes during unload. Keep the last
      // committed backup and ask the browser to protect any newer local work.
      event.preventDefault();
      event.returnValue = '';
    };
    recovery.onVisibility = () => { if (document.hidden) persistRecovery().catch(() => {}); };
    window.addEventListener('beforeunload', recovery.beforeUnload);
    document.addEventListener('visibilitychange', recovery.onVisibility);
    renderRecoveryStatus();
    (async () => {
      try {
        if (!handover || !handover.restored) {
          const current = await recoveryStore('get', location.href);
          const previous = current ? null : await recoveryStore('get', location.href + ':previous');
          const record = current || previous;
          if (record && record.version === 1 && record.url === location.href && typeof record.html === 'string') {
            showRecoveryOffer(record, !current);
          }
        }
      } catch (_) { recovery.error = true; }
      recovery.loading = false;
      if (recovery.pending) showRecoveryConflict();
      recoveryContentChanged();
    })();
  }
