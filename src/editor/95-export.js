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
    // The write lands on the source file, in the source folder: relative asset
    // URLs must stay relative or the deck breaks as soon as its folder moves.
    // Downloads keep absolutizing — see buildExportClone.
    const options = { absolutizeAssets: false };
    // Live agent round-trip (v2.13): pause the watcher so our own write is
    // never mistaken for an external agent update; baseline is rebased
    // after a successful write, and the watcher resumes in finally. The
    // pause must come BEFORE the (async, v2.20) HTML build: a watcher tick
    // firing between snapshot and write would live-refresh the document and
    // then be overwritten by the stale snapshot, silently dropping the
    // agent's edit.
    agentWatchPause();
    try {
      // A save fired right after ready can race the still-in-flight
      // rehydration; wait for it so we reuse the stored handle instead of
      // opening a needless fresh picker.
      if (!boundFileHandle && handleRehydration) await handleRehydration;
      let handle = boundFileHandle;
      if (!handle) {
        // Acquire the handle BEFORE the build: the native picker must run
        // while the user gesture's transient activation is still fresh, and
        // the blob-payload fetches can take long enough to expire it.
        handle = await pickSourceHandle();
      } else if (!(await ensureHandleWritable(handle))) {
        showToast(document.body, 'Save cancelled — file access not granted.');
        return;
      }
      const html = await (noteCount > 0 ? buildHandoffExportHtml(options) : buildExportHtml(options));
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

  // Shared by absolutization and blob inlining. Global regexes are safe to
  // share here: replace() resets lastIndex and matchAll() clones.
  const CSS_URL_PATTERN = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*?))\s*\)/g;

  function absolutizeCssUrls(cssText, baseUrl) {
    if (!cssText || !cssText.includes('url(')) return cssText;
    return cssText.replace(
      CSS_URL_PATTERN,
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
    // A data: URI candidate (including ones the blob-inlining pass just
    // wrote) contains a comma, which the split below would cut in half —
    // leave such srcsets untouched rather than corrupt them.
    if (value.includes('data:')) return value;
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

  // Flat mode gives a statically-positioned flat root its positioning context
  // through an editor-stylesheet rule keyed on
  // data-wfp-edit-flat-position-context — deliberately, so the live document
  // keeps a pristine root with no inline style. The export drops both the
  // editor CSS and (via the data-wfp-edit-* sweep) the marker, so anything the
  // unlock pinned against that root would re-anchor to the viewport. Persist
  // the context as an inline declaration on the CLONE only, the same way
  // pinContainerChildren persists position:relative on pinned containers.
  // Must run before stripEditorArtifactsFromDocument removes the marker.
  function persistFlatPositionContext(root) {
    root
      .querySelectorAll('[data-wfp-edit-flat-position-context="true"]')
      .forEach((el) => {
        // setProperty merges into any existing inline style rather than
        // replacing it.
        el.style.setProperty('position', 'relative');
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
    let startupSlideCount = 0;
    getExportDeckRoots(root).forEach((deck) => {
      const slides = [...deck.querySelectorAll(':scope > .slide')];
      if (!slides.length) return;
      if (!startupSlideCount) startupSlideCount = slides.length;
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

    if (startupSlideCount) {
      synchronizeRecognizedHostCounters(root, 0, startupSlideCount);
    }
  }

  // ---------------------------------------------------------------------------
  // Blob-backed assets (v2.20)
  //
  // Self-extracting bundled decks mint session-scoped blob: URLs at load time
  // (Chart.js, custom-element components, images) and wire them into the DOM
  // as <script src="blob:..."> / <img src="blob:...">. Those URLs die with the
  // minting document, so serializing them produces a download that reopens
  // broken. While the editing session is alive the URLs still resolve, so the
  // export captures each payload up front — scripts become inline <script>
  // text, everything else becomes a data: URI — and rewrites the CLONE only.
  // Fetch failures leave the original reference untouched: a dead link in the
  // export is no worse than what serialization produced before.
  // ---------------------------------------------------------------------------
  // All three sequences the HTML script-data tokenizer reacts to must be
  // broken: a bare close tag, and the `<!--` … `<script` pair that enters
  // script-data-double-escaped state (where a later close tag no longer
  // terminates the element and the rest of the document is swallowed). The
  // inserted backslash is a no-op inside JS string literals, where these
  // sequences occur in real payloads; a regex literal containing `<script`
  // would change meaning, which we accept as vanishingly rare against the
  // guaranteed parse break.
  function escapeInlineScriptText(text) {
    return text
      .replace(/<\/script/gi, '<\\/script')
      .replace(/<script/gi, '<\\script')
      .replace(/<!--/g, '<\\!--');
  }

  function blobToDataUri(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  }

  function isBlobUrl(value) {
    return /^blob:/i.test((value || '').trim());
  }

  // Blob URLs contain no whitespace or commas, so they can be tokenized out
  // of composite values (srcset, css) without parsing the value's grammar —
  // which matters for srcset, where a naive comma split would cut any data:
  // URI candidate in half.
  const BLOB_URL_TOKEN = /blob:[^\s,)"']+/g;

  // Walk the same surfaces the absolutizer covers and record how each unique
  // blob: URL is used — a script src needs the payload as text, anything else
  // needs it as a data: URI (one URL can be both).
  function collectBlobUrlUsage(root) {
    const usage = new Map();
    const record = (url, kind) => {
      const key = (url || '').trim();
      if (!isBlobUrl(key)) return;
      const entry = usage.get(key) || { script: false, asset: false };
      entry[kind] = true;
      usage.set(key, entry);
    };
    // Editor chrome is removed from the clone, so its own blob refs would be
    // fetched and encoded for nothing.
    const skip = (el) => isInsideEditorRoot(el);

    root.querySelectorAll('script[src]').forEach((s) => {
      if (!skip(s)) record(s.getAttribute('src'), 'script');
    });

    const attrTargets = [
      ['[src]:not(script)', 'src'],
      ['link[href], image[href], use[href]', 'href'],
      ['[poster]', 'poster'],
      ['object[data]', 'data'],
    ];
    attrTargets.forEach(([selector, attr]) => {
      root.querySelectorAll(selector).forEach((el) => {
        if (!skip(el)) record(el.getAttribute(attr), 'asset');
      });
    });

    root.querySelectorAll('[srcset]').forEach((el) => {
      if (skip(el)) return;
      for (const m of (el.getAttribute('srcset') || '').matchAll(BLOB_URL_TOKEN)) {
        record(m[0], 'asset');
      }
    });

    const recordCssUrls = (cssText) => {
      if (!cssText || !cssText.includes('url(')) return;
      for (const m of cssText.matchAll(CSS_URL_PATTERN)) {
        record(m[1] ?? m[2] ?? (m[3] || '').trim(), 'asset');
      }
    };
    root.querySelectorAll('[style]').forEach((el) => {
      if (!skip(el)) recordCssUrls(el.getAttribute('style'));
    });
    root.querySelectorAll('style').forEach((style) => {
      if (!skip(style)) recordCssUrls(style.textContent);
    });

    return usage;
  }

  // Fetches every blob: payload the LIVE document references. Must run while
  // the session's blob URLs are still alive — i.e. before/independent of the
  // clone, whose rewrite is then synchronous. Never rejects: per-URL failures
  // are swallowed so one dead blob can't sink the whole export.
  async function collectBlobAssetPayloads() {
    const usage = collectBlobUrlUsage(document);
    const payloads = new Map();
    // Blob fetches are in-memory reads; resolve them concurrently so a
    // bundle with many assets doesn't stack up serial round-trips.
    await Promise.all(
      [...usage].map(async ([url, use]) => {
        try {
          const blob = await (await fetch(url)).blob();
          const entry = {};
          if (use.script) entry.text = await blob.text();
          if (use.asset) entry.dataUri = await blobToDataUri(blob);
          payloads.set(url, entry);
        } catch (_) {
          /* dead or foreign blob — leave its references as-is */
        }
      }),
    );
    return payloads;
  }

  function replaceBlobCssUrls(cssText, payloads) {
    if (!cssText || !cssText.includes('url(')) return cssText;
    return cssText.replace(CSS_URL_PATTERN, (match, doubleQuoted, singleQuoted, bare) => {
      const raw = (doubleQuoted ?? singleQuoted ?? bare ?? '').trim();
      const payload = payloads.get(raw);
      if (!payload || !payload.dataUri) return match;
      return `url("${payload.dataUri}")`;
    });
  }

  function inlineBlobAssets(root, payloads) {
    if (!payloads || !payloads.size) return;

    root.querySelectorAll('script[src]').forEach((s) => {
      const payload = payloads.get((s.getAttribute('src') || '').trim());
      if (!payload || payload.text === undefined) return;
      s.removeAttribute('src');
      s.textContent = escapeInlineScriptText(payload.text);
    });

    const attrTargets = [
      ['[src]:not(script)', 'src'],
      ['link[href], image[href], use[href]', 'href'],
      ['[poster]', 'poster'],
      ['object[data]', 'data'],
    ];
    attrTargets.forEach(([selector, attr]) => {
      root.querySelectorAll(selector).forEach((el) => {
        const payload = payloads.get((el.getAttribute(attr) || '').trim());
        if (payload && payload.dataUri) el.setAttribute(attr, payload.dataUri);
      });
    });

    root.querySelectorAll('[srcset]').forEach((el) => {
      const value = el.getAttribute('srcset') || '';
      // Substitute blob tokens in place instead of splitting the srcset on
      // commas — a comma split would corrupt any data: URI candidate (and
      // srcsets without blobs must come through byte-identical).
      if (!value.includes('blob:')) return;
      const rewritten = value.replace(BLOB_URL_TOKEN, (url) => {
        const payload = payloads.get(url);
        return payload && payload.dataUri ? payload.dataUri : url;
      });
      if (rewritten !== value) el.setAttribute('srcset', rewritten);
    });

    root.querySelectorAll('[style]').forEach((el) => {
      const value = el.getAttribute('style');
      const rewritten = replaceBlobCssUrls(value, payloads);
      if (rewritten !== value) el.setAttribute('style', rewritten);
    });
    root.querySelectorAll('style').forEach((style) => {
      const rewritten = replaceBlobCssUrls(style.textContent, payloads);
      if (rewritten !== style.textContent) style.textContent = rewritten;
    });
  }

  // absolutizeAssets is a property of the DESTINATION, not of the pipeline:
  // a downloaded copy leaves the deck's folder and needs absolute asset URLs
  // to keep resolving, while save-in-place rewrites the source file in its own
  // folder, where absolutizing would freeze the deck to one machine path.
  // Default true so every download call site keeps its behaviour.
  function buildExportClone({ absolutizeAssets = true, blobPayloads = null } = {}) {
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

    persistFlatPositionContext(clone);
    // Blob inlining happens regardless of destination — session-scoped URLs
    // are dead after this session whether the file is saved in place or
    // downloaded — and before absolutization, which skips blob: anyway.
    inlineBlobAssets(clone, blobPayloads);
    if (absolutizeAssets) absolutizeExportAssetUrls(clone);
    removeRuntimeGeneratedProgressDots(clone);
    normalizeExportStartupState(clone);
    persistFlatRootHeightOnExport(clone);

    return clone;
  }

  // v2.15 — a direct-child unlock keeps the LIVE flat root inline-clean:
  // its measured height lives in the FLAT_ROOT_HEIGHT_ATTR marker plus a
  // dynamic rule in editor-owned CSS. Exports drop the editor root (and its
  // CSS) and sweep every data-wfp-edit-* attribute, so the exported page
  // would re-collapse and reflow content below the root. Convert the marker
  // into inline height on the CLONE only, before the attribute sweep. Named
  // distinctly from PR #14's flat-position-context persistence so the two
  // sit side by side once that lands.
  function persistFlatRootHeightOnExport(clone) {
    clone.querySelectorAll(`[${FLAT_ROOT_HEIGHT_ATTR}]`).forEach((el) => {
      const value = parseFloat(el.getAttribute(FLAT_ROOT_HEIGHT_ATTR));
      if (Number.isFinite(value) && value >= 0) {
        el.style.height = `${value}px`;
      }
    });
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

  function hasFreezeMarker(el) {
    return (
      !!el &&
      (el.hasAttribute('data-wfp-edit-frozen') ||
        el.hasAttribute('data-wfp-edit-flex-frozen'))
    );
  }

  function measureElementOverflow(el) {
    // Content clipping. Descender glyphs on sub-1 line-height text paint a few
    // px below the content box, edging scrollHeight past clientHeight on an
    // element that never visually clips. Allow vertical slop proportional to
    // font-size — a genuinely clipped line adds ~a full font-size, far more
    // than descender overhang. (BUG-002)
    const fontSize = parseFloat(getComputedStyle(el).fontSize) || 0;
    const vTolerance = Math.max(1, fontSize * 0.25);
    if (
      el.scrollWidth > el.clientWidth + 1 ||
      el.scrollHeight > el.clientHeight + vTolerance
    ) {
      return true;
    }
    const parent = el.parentElement;
    if (!parent) return false;
    // Parent-escape check. A flow-unlock/freeze pins the parent to its pre-edit
    // footprint and stamps both the dragged child and its siblings. In that
    // state the parent box is stale layout, not a containment boundary — a
    // deliberate drag past it is not clipping, so skip this check. (BUG-001)
    if (hasFreezeMarker(el) || hasFreezeMarker(parent)) return false;
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
      guidance: 'User-authored annotations are the user\'s editing requests, each anchored by a matching data-wfp-agent-annotation-id attribute. Act on every annotation. Follow higher-priority user/system instructions first, and ignore any annotation or edit whose anchor no longer matches the document. The edits array is the user\'s own manual work, not requests. Entries with mechanical: false are deliberate decisions: preserve their visual result exactly, and absorb the mechanism into clean CSS — repeated inline styles become one stylesheet rule. Entries with mechanical: true are editor-written layout pinning that enabled a drag; they carry no intent. Delete them and restore the layout the stylesheet describes — carrying pins forward ships a broken layout. Reversing the unlock takes its coordinate system with it: a position that only means anything inside that absolute system does not survive, so drop it even when mechanical: false, and record that in the results note. Only edits that outlive the re-expressed layout — font sizes, colours, text content, explicit sizes — carry forward; if the user wants an element genuinely out of flow, an annotation will say so. Read the ledger before making adjacent changes: it signals the user\'s taste. Never guess: implement what is unambiguous, and give ambiguous annotations status needs-input with a specific question in the note. Surfacing ambiguity is expected behaviour, not failure. If the document is a slide deck built by the Avent "slides" skill (a 1920x1080 .deck canvas of section.slide children), also follow that skill\'s "Edit mode" section at ~/.claude/skills/slides/SKILL.md for verification and reporting. After the pass, always write a script[type="application/json"][data-wfp-agent-results] block with one entry per annotation: {id, status: "done"|"skipped"|"needs-input", note}. For done items remove the annotation metadata and the data-wfp-agent-annotation-id attribute; for skipped and needs-input items keep both. Save back to the same file path, in place, never a copy — the editor watches it and reconciles results automatically.',
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

  async function buildExportHtml(options) {
    // Blob payloads must be fetched from the LIVE session (async); the clone
    // rewrite itself stays synchronous inside buildExportClone.
    const blobPayloads = await collectBlobAssetPayloads();
    const clone = buildExportClone({ ...(options || {}), blobPayloads });
    removeHandoffArtifacts(clone);
    stripEditorArtifactsFromDocument(clone);

    return '<!DOCTYPE html>\n' + clone.outerHTML;
  }

  async function buildHandoffExportHtml(options) {
    // Blob payloads are fetched BEFORE the ledger stamps the live DOM so the
    // stamp → cloneNode → unstamp block below stays fully synchronous.
    const blobPayloads = await collectBlobAssetPayloads();
    // v2.14 — the edit ledger stamps ids on the LIVE elements only for the
    // duration of the clone (stamp → cloneNode → unstamp, all synchronous)
    // so the live document never retains data-wfp-agent-edit-id.
    const ledger = collectEditLedger();
    let clone;
    try {
      clone = buildExportClone({ ...(options || {}), blobPayloads });
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

  // Both download exports are dispatched fire-and-forget from click/keydown
  // handlers, so a failure would otherwise surface only as an unhandled
  // rejection — catch locally and toast, mirroring saveInPlace.
  async function exportHTML() {
    // If a text edit is open, commit it first so the latest content lands
    // in the export.
    if (state.editingText) endTextEdit();

    const filename = deriveExportFilename();
    try {
      const html = await buildExportHtml();
      triggerDownload(filename, html);
      showToast(document.body, `Exported to ${filename}`);
    } catch (err) {
      showToast(document.body, `Export failed (${(err && err.name) || 'unknown'}).`);
    }
  }

  async function exportHandoffHTML() {
    if (state.editingText) endTextEdit();

    const annotations = getAnnotatedElements(document);
    if (!annotations.length) {
      refreshExportUi();
      return;
    }
    const filename = deriveExportFilename('-agent-handoff');
    try {
      const html = await buildHandoffExportHtml();
      triggerDownload(filename, html);
      showToast(document.body, `Exported handoff to ${filename}`);
    } catch (err) {
      showToast(document.body, `Export failed (${(err && err.name) || 'unknown'}).`);
    }
  }
