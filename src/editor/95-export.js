  // ===========================================================================
  // Export
  //
  // Clone the live DOM, strip everything the editor injected (root + script
  // + data-wfp-edit-* + contenteditable), serialize, and trigger a download
  // named `<basename>-edited.html`.
  // ===========================================================================
  function deriveExportFilename() {
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
    return `${base}-edited${ext}`;
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

  function normalizeExportStartupState(root) {
    root.querySelectorAll('.deck').forEach((deck) => {
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

  function buildExportHtml() {
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

    clone.querySelectorAll('*').forEach((el) => {
      for (const attr of [...el.attributes]) {
        if (attr.name.startsWith('data-wfp-edit')) el.removeAttribute(attr.name);
      }
      if (el.hasAttribute('contenteditable')) el.removeAttribute('contenteditable');
    });

    absolutizeExportAssetUrls(clone);
    removeRuntimeGeneratedProgressDots(clone);
    normalizeExportStartupState(clone);

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
