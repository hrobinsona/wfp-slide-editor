  // Slide reuse and small content-authoring actions. UI stays in editor root;
  // inserted content and duplicate-specific CSS belong to the exported deck.
  let authoringUi = null;
  let duplicateSerial = 0;
  let imageRequestSerial = 0;

  function initAuthoring() {
    if (authoringUi) return;
    const style = document.createElement('style');
    style.textContent = `
      #wfp-editor-root .wfpe-authoring-button { pointer-events: auto; font: inherit; color: inherit; border: 1px solid #ffffff35; border-radius: 6px; background: #ffffff12; padding: 7px 10px; cursor: pointer; white-space: nowrap; }
      #wfp-editor-root .wfpe-authoring-button:hover { background: #ffffff25; }
      #wfp-editor-root .wfpe-authoring-button:disabled { opacity: .45; cursor: default; }
      #wfp-editor-root .wfpe-authoring-button[hidden] { display: none !important; }
      #wfp-editor-root .wfpe-add-text[hidden] { display: none !important; }
      #wfp-editor-root .wfpe-toolbar:has(.wfpe-add-text:not([hidden])) .wfpe-toolbar-fold-inner .wfpe-toolbar-btn { width: 26px; }
      #wfp-editor-root .wfpe-overview-duplicate { position: absolute; top: 6px; right: 40px; z-index: 4; color: white; background: #222d3d; font: 11px system-ui; border: 1px solid #ffffff55; border-radius: 5px; padding: 5px 7px; cursor: pointer; pointer-events: auto; }
      #wfp-editor-root .wfpe-authoring-replace { margin: 8px 12px; }
    `;
    root.appendChild(style);
    const add = document.createElement('button');
    add.type = 'button';
    add.dataset.action = 'add-text';
    add.className = 'wfpe-toolbar-btn wfpe-add-text';
    add.setAttribute('aria-label', 'Add text');
    add.innerHTML = '<svg class="wfpe-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 5h12M9 5v14M6 19h6M18 10v8M14 14h8"/></svg>';
    add.title = 'Add text';
    toolbarFoldInner.insertBefore(add, exportBtn);
    add.addEventListener('click', addTextToCurrentSlide);
    const replace = document.createElement('button');
    replace.type = 'button';
    replace.className = 'wfpe-authoring-button wfpe-authoring-replace';
    replace.textContent = 'Replace image';
    inspectorBody.appendChild(replace);
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/png,image/jpeg,image/gif,image/webp,image/avif,image/bmp';
    input.hidden = true;
    input.setAttribute('aria-label', 'Choose replacement image');
    root.appendChild(input);
    authoringUi = { add, replace, input, imageTarget: null };
    state.authoringReady = true;
    replace.addEventListener('click', () => {
      if (!canReplaceSelectedImage()) return;
      if (state.editingText) endTextEdit();
      authoringUi.imageTarget = state.selected;
      input.value = '';
      input.click();
    });
    input.addEventListener('change', () => {
      const file = input.files && input.files[0];
      const target = authoringUi.imageTarget;
      authoringUi.imageTarget = null;
      if (file && target) replaceImageFromFile(target, file);
    });
    input.addEventListener('cancel', () => { authoringUi.imageTarget = null; });
    refreshAuthoringUi();
  }

  function canReplaceSelectedImage() {
    return state.editMode && !state.markdownMode && !state.overviewMode && !hasMultiSelection() &&
      state.selected && state.selected.tagName === 'IMG' && state.selected.isConnected;
  }

  function refreshAuthoringUi() {
    if (!authoringUi) return;
    authoringUi.add.hidden = !state.editMode || state.markdownMode || state.overviewMode || !getActiveSlide();
    authoringUi.replace.hidden = !canReplaceSelectedImage();
  }

  function addTextToCurrentSlide() {
    const slide = getActiveSlide();
    if (!state.editMode || state.markdownMode || state.overviewMode || !slide) return;
    if (state.editingText) endTextEdit();
    flushPendingTxnSessions();
    const previousSelectedEl = state.selected;
    const text = document.createElement('div');
    text.textContent = 'Add your text';
    text.style.cssText = 'position:absolute;margin:0;padding:0;font-size:28px;line-height:1.25;min-height:1.25em;max-width:none;z-index:20;';
    slide.appendChild(text);
    // Use the actual containing block, including in a static flat document.
    // Viewport intersection keeps the box visible after scrolling; the scale
    // comes from the containing block so authored deck transforms are honored.
    const parent = text.offsetParent || document.documentElement;
    const parentRect = parent.getBoundingClientRect();
    const sx = parent.offsetWidth ? parentRect.width / parent.offsetWidth : 1;
    const sy = parent.offsetHeight ? parentRect.height / parent.offsetHeight : sx;
    const rect = slide.getBoundingClientRect();
    const left = Math.max(0, rect.left);
    const top = Math.max(0, rect.top);
    const right = Math.min(innerWidth, rect.right);
    const bottom = Math.min(innerHeight, rect.bottom);
    const width = Math.max(60, Math.min(360, (right - left) / (sx || 1) * .6));
    const x = left + Math.max(0, (right - left - width * sx) / 2);
    const y = top + Math.max(0, (bottom - top) / 2 - 22 * sy);
    text.style.width = `${width}px`;
    text.style.left = `${(x - parentRect.left) / (sx || 1) - parent.clientLeft + parent.scrollLeft}px`;
    text.style.top = `${(y - parentRect.top) / (sy || 1) - parent.clientTop + parent.scrollTop}px`;
    pushElementInsertEntry({ type: 'elementInsert', slideEl: slide, parentEl: slide,
      insertedEl: text, nextSiblingEl: null, previousSelectedEl });
    setSelected(text);
    refreshInspector();
    startTextEdit(text);
    const range = document.createRange();
    range.selectNodeContents(text);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    return text;
  }

  async function replaceImageFromFile(img, file) {
    const request = ++imageRequestSerial;
    const supported = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif', 'image/bmp']);
    if (!supported.has(file.type.toLowerCase())) {
      showToast(img, 'Choose a PNG, JPEG, GIF, WebP, AVIF or BMP image. SVG and other file types are not supported.');
      return false;
    }
    try {
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
      });
      const probe = new Image();
      probe.src = dataUrl;
      await probe.decode();
      if (request !== imageRequestSerial || !img.isConnected || !getActiveSlide()?.contains(img)) return false;
      if (state.editingText) endTextEdit();
      const computed = getComputedStyle(img);
      const width = computed.width;
      const height = computed.height;
      beginTxn({ captureAttributes: ['src', 'srcset', 'sizes', 'media', 'type'] });
      touchElement(img);
      // A picture's source wins over img.src. Keep the authored nodes so Undo
      // can restore responsive art direction without recreating DOM identities.
      if (img.parentElement?.tagName === 'PICTURE') {
        for (const source of img.parentElement.querySelectorAll('source')) {
          touchElement(source);
          source.removeAttribute('srcset');
        }
      }
      img.style.width = width;
      img.style.height = height;
      img.removeAttribute('srcset');
      img.removeAttribute('sizes');
      img.src = dataUrl;
      endTxn();
      refreshSelection();
      refreshExportUi();
      return true;
    } catch (_) {
      if (img.isConnected) showToast(img, 'This image could not be opened. Choose another image file.');
      return false;
    }
  }

  function addOverviewDuplicateButton(thumb, index) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'wfpe-overview-duplicate';
    button.textContent = 'Duplicate';
    button.setAttribute('aria-label', `Duplicate slide ${index + 1}`);
    button.title = 'Duplicate slide';
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      duplicateSlideFromOverview(getSlides()[index]);
    });
    thumb.appendChild(button);
  }

  function rewriteDuplicateIds(value, ids) {
    // Token-aware hash rewriting handles both CSS ID selectors and SVG url().
    // CSS.escape permits authored ids containing punctuation in selectors.
    let output = value;
    for (const [oldId, newId] of ids) {
      const escaped = CSS.escape(oldId).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      output = output.replace(new RegExp(`#${escaped}(?![\\w-])`, 'g'), `#${CSS.escape(newId)}`);
    }
    return output;
  }

  function rewriteDuplicateUrls(value, ids) {
    return value.replace(/url\(\s*(['"]?)#([^)'"\s]+)\1\s*\)/g, (match, quote, id) =>
      ids.has(id) ? `url("#${ids.get(id)}")` : match);
  }

  function rewriteDuplicateStyleRules(rules, ids, onlyChangedSelectors, cloneId = '') {
    const collected = [];
    for (const rule of rules) {
      if (rule.selectorText) {
        const declarations = rewriteDuplicateUrls(rule.style.cssText, ids);
        const selectors = splitSelectorList(rule.selectorText).map((selector) => ({
          original: selector, rewritten: rewriteDuplicateIds(selector, ids),
        })).filter((selector) => !onlyChangedSelectors || selector.original !== selector.rewritten || declarations !== rule.style.cssText);
        const scoped = selectors.map(({ rewritten }) => {
          if (!cloneId) return rewritten;
          const scope = `:where(#${CSS.escape(cloneId)}, #${CSS.escape(cloneId)} *)`;
          // Keep pseudo-elements last; the zero-specificity restriction stops
          // remapped class rules from changing the source or another slide.
          const pseudo = rewritten.match(/(::[\w-]+(?:\([^)]*\))?)$/);
          return pseudo ? rewritten.slice(0, -pseudo[0].length) + scope + pseudo[0] : rewritten + scope;
        });
        if (scoped.length) collected.push(`${scoped.join(',')}{${declarations}}`);
      } else if (rule.cssRules) {
        const inner = rewriteDuplicateStyleRules(rule.cssRules, ids, onlyChangedSelectors, cloneId);
        if (inner) collected.push(`${rule.cssText.slice(0, rule.cssText.indexOf('{'))}{${inner}}`);
      } else if (!onlyChangedSelectors) collected.push(rule.cssText);
    }
    return collected.join('\n');
  }

  function duplicateIdStyles(ids, source, cloneId) {
    const output = [];
    for (const sheet of document.styleSheets) {
      if (sheet.ownerNode && (root.contains(sheet.ownerNode) || source.contains(sheet.ownerNode))) continue;
      if (sheet.disabled) continue;
      try {
        const css = rewriteDuplicateStyleRules(sheet.cssRules, ids, true, cloneId);
        output.push(sheet.media.mediaText ? `@media ${sheet.media.mediaText}{${css}}` : css);
      } catch (_) { /* Cross-origin CSS is unreadable. */ }
    }
    return output.filter(Boolean).join('\n');
  }

  function duplicateSlideFromOverview(source) {
    const deck = getDeckRoot();
    if (!source || source.parentElement !== deck || !state.overviewMode) return null;
    flushPendingTxnSessions();
    const sourceStyle = getComputedStyle(source);
    const decoration = {};
    for (const property of ['background-color', 'background-image', 'background-position', 'background-size', 'background-repeat', 'color']) {
      decoration[property] = sourceStyle.getPropertyValue(property);
    }
    const clone = source.cloneNode(true);
    // Never replay executable scripts or an old handoff metadata payload.
    clone.querySelectorAll('script').forEach((script) => script.remove());
    stripEditorArtifactsFrom(clone);
    const ids = new Map();
    for (const node of [clone, ...clone.querySelectorAll('[id]')]) {
      if (!node.id) continue;
      const old = node.id;
      let id;
      do { id = `${old}-copy-${++duplicateSerial}`; } while (document.getElementById(id));
      ids.set(old, id);
      node.id = id;
    }
    if (!clone.id) clone.id = nextBlankSlideId(deck);
    const idRefs = new Set(['for', 'list', 'form', 'headers', 'aria-labelledby', 'aria-describedby', 'aria-controls', 'aria-owns', 'aria-flowto', 'aria-details', 'aria-errormessage', 'aria-activedescendant']);
    for (const node of [clone, ...clone.querySelectorAll('*')]) {
      for (const attr of [...node.attributes]) {
        if (idRefs.has(attr.name)) {
          node.setAttribute(attr.name, attr.value.split(/\s+/).map((id) => ids.get(id) || id).join(' '));
        } else if ((attr.name === 'href' || attr.name === 'xlink:href') && attr.value.startsWith('#')) {
          const id = ids.get(attr.value.slice(1));
          if (id) node.setAttribute(attr.name, '#' + id);
        } else if (attr.name === 'style' || /url\(/.test(attr.value)) {
          node.setAttribute(attr.name, rewriteDuplicateUrls(attr.value, ids));
        }
      }
      if (node.tagName === 'STYLE') {
        const sheet = new CSSStyleSheet();
        sheet.replaceSync(node.textContent);
        node.textContent = rewriteDuplicateStyleRules(sheet.cssRules, ids, false, clone.id);
      }
    }
    const css = duplicateIdStyles(ids, source, clone.id);
    if (css) {
      const style = document.createElement('style');
      style.textContent = css;
      clone.appendChild(style);
    }
    setSlideActive(clone, false);
    const beforeSibling = source.nextSibling;
    deck.insertBefore(clone, beforeSibling);
    const cloneStyle = getComputedStyle(clone);
    for (const [property, value] of Object.entries(decoration)) {
      if (cloneStyle.getPropertyValue(property) !== value) clone.style.setProperty(property, value);
    }
    observeSlideClass(clone);
    pushSlideOpEntry({ type: 'slideInsert', deckEl: deck, insertedSlide: clone, beforeSibling });
    buildOverviewOverlay();
    refreshExportUi();
    return clone;
  }
