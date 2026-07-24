  // ===========================================================================
  // Save-in-place engine (v2.11)
  //
  // Chromium-only File System Access path. First save binds a file handle
  // via the native picker (the one interaction Chrome's security model
  // requires); subsequent saves write silently. The handle is persisted to
  // IndexedDB keyed by the page URL so a reload only costs a one-click
  // permission re-grant instead of a fresh picker. Storage failures are
  // swallowed: persistence is an optimisation, never a gate on saving.
  // ===========================================================================
  const HANDLE_DB_NAME = 'wfp-editor';
  const HANDLE_STORE_NAME = 'handles';
  let boundFileHandle = null;
  // Captured once at init so saveInPlace() can await the same in-flight
  // rehydration instead of racing it (see the Ready block below).
  let handleRehydration = null;

  function canSaveInPlace() {
    return typeof window.showSaveFilePicker === 'function';
  }

  function deriveSourceFilename() {
    return deriveExportFilename('');
  }

  function openHandleDb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(HANDLE_DB_NAME, 1);
      req.onupgradeneeded = () => {
        req.result.createObjectStore(HANDLE_STORE_NAME);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function loadStoredHandle() {
    try {
      const db = await openHandleDb();
      try {
        const result = await new Promise((resolve) => {
          const tx = db.transaction(HANDLE_STORE_NAME, 'readonly');
          const req = tx.objectStore(HANDLE_STORE_NAME).get(location.href);
          req.onsuccess = () => resolve(req.result || null);
          req.onerror = () => resolve(null);
        });
        return result;
      } finally {
        db.close(); // release the connection even if the round-trip threw
      }
    } catch (_) {
      return null;
    }
  }

  async function storeBoundHandle(handle) {
    try {
      const db = await openHandleDb();
      try {
        await new Promise((resolve) => {
          const tx = db.transaction(HANDLE_STORE_NAME, 'readwrite');
          tx.objectStore(HANDLE_STORE_NAME).put(handle, location.href);
          tx.oncomplete = resolve;
          tx.onabort = resolve;
          tx.onerror = resolve;
        });
      } finally {
        db.close(); // release the connection even if the round-trip threw
      }
    } catch (_) {
      /* persistence is best-effort */
    }
  }

  async function forgetBoundHandle() {
    boundFileHandle = null;
    try {
      const db = await openHandleDb();
      try {
        await new Promise((resolve) => {
          const tx = db.transaction(HANDLE_STORE_NAME, 'readwrite');
          tx.objectStore(HANDLE_STORE_NAME).delete(location.href);
          tx.oncomplete = resolve;
          tx.onabort = resolve;
          tx.onerror = resolve;
        });
      } finally {
        db.close(); // release the connection even if the round-trip threw
      }
    } catch (_) {
      /* best-effort */
    }
  }

  async function ensureHandleWritable(handle) {
    try {
      if (typeof handle.queryPermission === 'function') {
        if ((await handle.queryPermission({ mode: 'readwrite' })) === 'granted') return true;
        if (typeof handle.requestPermission === 'function') {
          return (await handle.requestPermission({ mode: 'readwrite' })) === 'granted';
        }
      }
      return true; // no permission API on this handle — let the write decide
    } catch (_) {
      return false;
    }
  }

  async function writeHtmlToHandle(handle, html) {
    const writable = await handle.createWritable();
    await writable.write(html);
    await writable.close();
  }

  async function pickSourceHandle() {
    const handle = await window.showSaveFilePicker({
      suggestedName: deriveSourceFilename(),
      types: [{ description: 'HTML document', accept: { 'text/html': ['.html', '.htm'] } }],
    });
    boundFileHandle = handle;
    await storeBoundHandle(handle);
    return handle;
  }

  async function saveInPlace() {
    if (state.editingText) endTextEdit();
    const noteCount = getAnnotatedElements(document).length;
    const html = noteCount > 0 ? buildHandoffExportHtml() : buildExportHtml();
    // Live agent round-trip (v2.13): pause the watcher so our own write is
    // never mistaken for an external agent update; baseline is rebased
    // after a successful write, and the watcher resumes in finally.
    agentWatchPause();
    try {
      // A save fired right after ready can race the still-in-flight
      // rehydration; wait for it so we reuse the stored handle instead of
      // opening a needless fresh picker.
      if (!boundFileHandle && handleRehydration) await handleRehydration;
      let handle = boundFileHandle;
      if (!handle) {
        handle = await pickSourceHandle();
      } else if (!(await ensureHandleWritable(handle))) {
        showToast(document.body, 'Save cancelled — file access not granted.');
        return;
      }
      try {
        await writeHtmlToHandle(handle, html);
      } catch (err) {
        // Stale handle (file moved/renamed/deleted): drop it and re-pick
        // within the same user gesture, then retry once.
        await forgetBoundHandle();
        handle = await pickSourceHandle();
        await writeHtmlToHandle(handle, html);
      }
      await agentWatchSyncBaseline(handle);
      showToast(
        document.body,
        noteCount > 0
          ? `Saved ${handle.name} — ${noteCount} agent note${noteCount === 1 ? '' : 's'}`
          : `Saved ${handle.name}`,
      );
    } catch (err) {
      if (err && err.name === 'AbortError') {
        showToast(document.body, 'Save cancelled.');
        return;
      }
      showToast(document.body, `Save failed (${(err && err.name) || 'unknown'}) — try Export → Clean copy.`);
    } finally {
      agentWatchResume();
    }
  }
  // ===========================================================================
  // Export
  //
  // Clone the live DOM, strip everything the editor injected (root + script
  // + data-wfp-edit-* + contenteditable), serialize, and trigger a download.
  // Normal export stays clean; handoff export intentionally adds structured
  // user-authored annotation metadata after the cleanup pass.
  // ===========================================================================
  function deriveExportFilename(suffix = '-edited') {
    let path = location.pathname || '';
    try {
      path = decodeURIComponent(path);
    } catch (_) {
      /* leave as-is */
    }
    const lastSegment = path.split('/').pop() || '';
    const m = lastSegment.match(/^(.+?)(\.html?)?$/i);
    const base = (m && m[1]) || 'slide';
    const ext = (m && m[2]) || '.html';
    return `${base}${suffix}${ext}`;
  }

  function shouldSkipAssetUrl(raw) {
    const value = (raw || '').trim();
    return (
      !value ||
      value.startsWith('#') ||
      /^(data|blob|javascript|mailto|tel):/i.test(value)
    );
  }

  function resolveExportAssetUrl(raw, baseUrl) {
    const value = (raw || '').trim();
    if (shouldSkipAssetUrl(value)) return raw;
    try {
      return new URL(value, baseUrl).href;
    } catch (_) {
      return raw;
    }
  }

  function absolutizeCssUrls(cssText, baseUrl) {
    if (!cssText || !cssText.includes('url(')) return cssText;
    return cssText.replace(
      /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*?))\s*\)/g,
      (match, doubleQuoted, singleQuoted, bare) => {
        const raw = doubleQuoted ?? singleQuoted ?? (bare || '').trim();
        const resolved = resolveExportAssetUrl(raw, baseUrl);
        if (resolved === raw) return match;
        const quote = singleQuoted !== undefined ? "'" : '"';
        return `url(${quote}${resolved}${quote})`;
      },
    );
  }

  function absolutizeSrcset(value, baseUrl) {
    if (!value) return value;
    return value
      .split(',')
      .map((candidate) => {
        const trimmed = candidate.trim();
        if (!trimmed) return candidate;
        const parts = trimmed.split(/\s+/);
        parts[0] = resolveExportAssetUrl(parts[0], baseUrl);
        return parts.join(' ');
      })
      .join(', ');
  }

  function absolutizeExportAssetUrls(root) {
    const baseUrl = document.baseURI || location.href;
    const attrTargets = [
      ['[src]', 'src'],
      ['link[href], image[href], use[href]', 'href'],
      ['[poster]', 'poster'],
      ['object[data]', 'data'],
    ];

    attrTargets.forEach(([selector, attr]) => {
      root.querySelectorAll(selector).forEach((el) => {
        const value = el.getAttribute(attr);
        const resolved = resolveExportAssetUrl(value, baseUrl);
        if (resolved !== value) el.setAttribute(attr, resolved);
      });
    });

    root.querySelectorAll('[srcset]').forEach((el) => {
      const value = el.getAttribute('srcset');
      const resolved = absolutizeSrcset(value, baseUrl);
      if (resolved !== value) el.setAttribute('srcset', resolved);
    });

    root.querySelectorAll('[style]').forEach((el) => {
      const value = el.getAttribute('style');
      const resolved = absolutizeCssUrls(value, baseUrl);
      if (resolved !== value) el.setAttribute('style', resolved);
    });

    root.querySelectorAll('style').forEach((style) => {
      const resolved = absolutizeCssUrls(style.textContent, baseUrl);
      if (resolved !== style.textContent) style.textContent = resolved;
    });
  }

  function hasDynamicProgressDotBuilder(root) {
    return [...root.querySelectorAll('script')].some((script) => {
      const text = script.textContent || '';
      return (
        /progress-dot/.test(text) &&
        /createElement\s*\(/.test(text) &&
        /appendChild\s*\(/.test(text)
      );
    });
  }

  function isRuntimeGeneratedProgressDot(dot) {
    const nonClassAttributes = [...dot.attributes].filter((attr) => attr.name !== 'class');
    return (
      nonClassAttributes.length === 0 &&
      dot.children.length === 0 &&
      dot.textContent.trim() === ''
    );
  }

  function removeRuntimeGeneratedProgressDots(root) {
    if (!hasDynamicProgressDotBuilder(root)) return;

    root.querySelectorAll('.progress').forEach((progress) => {
      progress.querySelectorAll(':scope > .progress-dot').forEach((dot) => {
        if (isRuntimeGeneratedProgressDot(dot)) dot.remove();
      });
    });
  }

  function getExportDeckRoots(root) {
    const markedRoots = [...root.querySelectorAll('[data-wfp-edit-deck-root]:not([data-wfp-edit-flat-root])')];
    return markedRoots.length ? markedRoots : [...root.querySelectorAll('.deck')];
  }

  function normalizeExportStartupState(root) {
    getExportDeckRoots(root).forEach((deck) => {
      const slides = [...deck.querySelectorAll(':scope > .slide')];
      if (!slides.length) return;
      slides.forEach((slide, index) => {
        slide.classList.toggle('active', index === 0);
      });
    });

    root.querySelectorAll('.progress').forEach((progress) => {
      const dots = [...progress.querySelectorAll('.progress-dot')];
      if (!dots.length) return;
      dots.forEach((dot, index) => {
        dot.classList.toggle('active', index === 0);
      });
    });
  }

  function buildExportClone() {
    const clone = document.documentElement.cloneNode(true);

    const editorRoot = clone.querySelector(`#${ROOT_ID}`);
    if (editorRoot) editorRoot.remove();

    // Two ways the editor script is injected:
    //   - bookmarklet:   <script src="...editor.js?..."> → match by src
    //   - inline tag:    addScriptTag({ path }) — no src → match by the
    //     data-wfp-edit-script marker we set at load time
    // Run BOTH selectors before the data-wfp-edit-* sweep so the marker
    // hasn't been stripped from the script element yet.
    clone.querySelectorAll('[data-wfp-edit-script]').forEach((s) => s.remove());
    clone.querySelectorAll('script[src*="editor.js"]').forEach((s) => s.remove());

    absolutizeExportAssetUrls(clone);
    removeRuntimeGeneratedProgressDots(clone);
    normalizeExportStartupState(clone);

    return clone;
  }

  function stripEditorArtifactsFromDocument(clone) {
    clone.querySelectorAll('*').forEach((el) => {
      for (const attr of [...el.attributes]) {
        if (attr.name.startsWith('data-wfp-edit')) el.removeAttribute(attr.name);
      }
      if (el.hasAttribute('contenteditable')) el.removeAttribute('contenteditable');
    });
  }

  function getSlideIndexForHandoffTarget(root, target) {
    const decks = getExportDeckRoots(root);
    for (const deck of decks) {
      const slides = [...deck.querySelectorAll(':scope > .slide')];
      const slide = target.closest('.slide');
      if (slide && slides.includes(slide)) return slides.indexOf(slide);
    }
    const slides = [...root.querySelectorAll('.slide')];
    const slide = target.closest('.slide');
    if (slide && slides.includes(slide)) return slides.indexOf(slide);
    return 0;
  }

  function summarizeTargetText(el) {
    return (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 240);
  }

  // ===========================================================================
  // Handoff ground truth (v2.14)
  //
  // Two additive payload sections for handoff exports: an edit ledger (one
  // entry per user-touched element whose inline style differs from its
  // pristine pre-edit value) and box/computed/overflow measurements on both
  // ledger entries and annotations. Measurements MUST come from the live
  // document — the export clone is never laid out.
  // ===========================================================================
  function roundToTenth(value) {
    return Math.round(value * 10) / 10;
  }

  function measureElementBox(el) {
    const box = getSlideBox(el);
    return {
      left: roundToTenth(box.left),
      top: roundToTenth(box.top),
      width: roundToTenth(box.width),
      height: roundToTenth(box.height),
    };
  }

  function measureElementComputed(el) {
    const cs = getComputedStyle(el);
    return {
      fontSize: cs.fontSize,
      fontWeight: cs.fontWeight,
      color: cs.color,
      backgroundColor: cs.backgroundColor,
      position: cs.position,
    };
  }

  function measureElementOverflow(el) {
    if (
      el.scrollWidth > el.clientWidth + 1 ||
      el.scrollHeight > el.clientHeight + 1
    ) {
      return true;
    }
    const parent = el.parentElement;
    if (!parent) return false;
    const rect = el.getBoundingClientRect();
    const parentRect = parent.getBoundingClientRect();
    return (
      rect.left < parentRect.left - 1 ||
      rect.top < parentRect.top - 1 ||
      rect.right > parentRect.right + 1 ||
      rect.bottom > parentRect.bottom + 1
    );
  }

  function measureElementForHandoff(el) {
    return {
      box: measureElementBox(el),
      computed: measureElementComputed(el),
      overflow: measureElementOverflow(el),
    };
  }

  function generateEditLedgerId() {
    const time = Date.now().toString(36);
    const rand = Math.random().toString(36).slice(2, 8);
    return `edit-${time}-${rand}`;
  }

  // Mechanical = unlock/freeze pinning written by the editor, not user
  // intent. The frozen markers alone cannot make that call: the freeze
  // stamps the DRAGGED element exactly like its pinned siblings, and the
  // user's move happens inside the same transaction. So an entry is
  // mechanical only while its element's inline style is still exactly what
  // the pin wrote (state.pinnedStyles) — the moment the user drags,
  // resizes, or restyles the element, its style diverges and the entry
  // reads as user intent.
  function isLedgerMechanical(el) {
    if (
      !el.hasAttribute('data-wfp-edit-frozen') &&
      !el.hasAttribute('data-wfp-edit-flex-frozen')
    ) {
      return false;
    }
    if (!state.pinnedStyles.has(el)) return true; // marker without a pin record — trust the marker
    return el.getAttribute('style') === state.pinnedStyles.get(el);
  }

  // Builds the ledger from state.editedElements and stamps each entry's id
  // onto its LIVE element. The caller clones the document while the stamps
  // are present (so entries anchor deterministically in the export) and
  // must unstamp immediately after — see buildHandoffExportHtml.
  function collectEditLedger() {
    const entries = [];
    const stamped = [];
    try {
      for (const el of state.editedElements) {
        if (!el || !el.isConnected || isInsideEditorRoot(el)) continue;
        if (!state.originalStyles.has(el)) continue;
        const before = state.originalStyles.get(el);
        const after = el.getAttribute('style');
        if (before === after) continue; // edited then fully undone
        const id = generateEditLedgerId();
        el.setAttribute(EDIT_LEDGER_TARGET_ATTR, id);
        stamped.push(el);
        entries.push(Object.assign(
          {
            id,
            tag: el.tagName.toLowerCase(),
            slideIndex: getSlideIndexForHandoffTarget(document, el),
            targetText: summarizeTargetText(el),
            before,
            after,
            mechanical: isLedgerMechanical(el),
          },
          measureElementForHandoff(el),
        ));
      }
    } catch (err) {
      // A mid-loop throw must not strand stamps on the live DOM — the
      // invariant is "no residue on any code path". Unstamp and rethrow;
      // the caller's own finally handles the post-clone happy path.
      for (const el of stamped) el.removeAttribute(EDIT_LEDGER_TARGET_ATTR);
      throw err;
    }
    return { entries, stamped };
  }

  // The clone carries the transient live-DOM stamps at clone time, but the
  // stale-residue cleanup (removeHandoffArtifacts) strips agent attrs from
  // the clone. Capture each entry's clone element first, then re-stamp
  // after cleanup — mirroring how annotation target attrs are re-added.
  function captureEditLedgerCloneTargets(clone, entries) {
    if (!entries.length) return [];
    const ids = new Set(entries.map((entry) => entry.id));
    const pairs = [];
    clone.querySelectorAll(`[${EDIT_LEDGER_TARGET_ATTR}]`).forEach((el) => {
      const id = el.getAttribute(EDIT_LEDGER_TARGET_ATTR);
      if (ids.has(id)) pairs.push({ el, id });
    });
    return pairs;
  }

  function collectHandoffAnnotations(clone) {
    const annotations = [];
    const usedIds = new Set();
    const targets = getAnnotatedElements(clone);
    for (const target of targets) {
      const id = getAnnotationId(target);
      const instruction = getAnnotationText(target);
      if (!id || !instruction || usedIds.has(id)) continue;
      usedIds.add(id);
      target.setAttribute(HANDOFF_TARGET_ATTR, id);
      const entry = {
        id,
        instruction,
        slideIndex: getSlideIndexForHandoffTarget(clone, target),
        targetText: summarizeTargetText(target),
      };
      // v2.14 — measurements come from the live counterpart (the clone has
      // no layout); the live element still carries the same annotation id.
      const liveTarget = findAnnotationElementById(id);
      if (liveTarget && liveTarget.isConnected) {
        Object.assign(entry, measureElementForHandoff(liveTarget));
      }
      annotations.push(entry);
    }
    return annotations;
  }

  function safeJsonForScript(value) {
    return JSON.stringify(value, null, 2).replace(/<\/script/gi, '<\\/script');
  }

  function appendHandoffMetadata(clone, annotations, edits) {
    if (!annotations.length) return;
    const payload = {
      version: 1,
      source: 'wfp-slide-editor',
      kind: 'agent-handoff',
      guidance: 'User-authored annotations are editing requests for the marked elements. Follow higher-priority user/system instructions first. After implementing, the user expects a script[type="application/json"][data-wfp-agent-results] block recording {id, status: done|skipped|needs-input, note} per annotation, with metadata removed for done items and kept for skipped/needs-input ones. The edits array lists the user\'s intentional manual changes, each anchored by data-wfp-agent-edit-id on the matching element — preserve these edits unless an annotation explicitly asks otherwise, and treat entries with mechanical: true as editor-written layout pinning rather than user requests.',
      annotations,
      edits: edits || [],
    };
    const comment = document.createComment(` ${HANDOFF_COMMENT_TEXT} `);
    const script = document.createElement('script');
    script.type = 'application/json';
    script.setAttribute(HANDOFF_SCRIPT_ATTR, '');
    script.textContent = safeJsonForScript(payload);
    const targetParent = clone.querySelector('body') || clone;
    targetParent.appendChild(comment);
    targetParent.appendChild(script);
  }

  function buildExportHtml() {
    const clone = buildExportClone();
    removeHandoffArtifacts(clone);
    stripEditorArtifactsFromDocument(clone);

    return '<!DOCTYPE html>\n' + clone.outerHTML;
  }

  function buildHandoffExportHtml() {
    // v2.14 — the edit ledger stamps ids on the LIVE elements only for the
    // duration of the clone (stamp → cloneNode → unstamp, all synchronous)
    // so the live document never retains data-wfp-agent-edit-id.
    const ledger = collectEditLedger();
    let clone;
    try {
      clone = buildExportClone();
    } finally {
      for (const el of ledger.stamped) el.removeAttribute(EDIT_LEDGER_TARGET_ATTR);
    }
    const ledgerTargets = captureEditLedgerCloneTargets(clone, ledger.entries);
    removeHandoffArtifacts(clone);
    const annotations = collectHandoffAnnotations(clone);
    // Re-anchor ledger entries after the stale-residue cleanup, same as
    // annotation target attrs are re-added post-cleanup above.
    for (const pair of ledgerTargets) pair.el.setAttribute(EDIT_LEDGER_TARGET_ATTR, pair.id);
    stripEditorArtifactsFromDocument(clone);
    appendHandoffMetadata(clone, annotations, ledger.entries);

    return '<!DOCTYPE html>\n' + clone.outerHTML;
  }

  function triggerDownload(filename, html) {
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function exportHTML() {
    // If a text edit is open, commit it first so the latest content lands
    // in the export.
    if (state.editingText) endTextEdit();

    const filename = deriveExportFilename();
    const html = buildExportHtml();
    triggerDownload(filename, html);
    showToast(document.body, `Exported to ${filename}`);
  }

  function exportHandoffHTML() {
    if (state.editingText) endTextEdit();

    const annotations = getAnnotatedElements(document);
    if (!annotations.length) {
      refreshExportUi();
      return;
    }
    const filename = deriveExportFilename('-agent-handoff');
    const html = buildHandoffExportHtml();
    triggerDownload(filename, html);
    showToast(document.body, `Exported handoff to ${filename}`);
  }
