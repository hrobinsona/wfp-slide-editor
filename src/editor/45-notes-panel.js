  // ===========================================================================
  // Agent-notes panel (v2.21)
  //
  // A browsable list of every saved annotation across the deck — the
  // cross-slide counterpart to the active-slide-only pins. Cards live in
  // the .wfpe-notes-list node (30-ui) and are rebuilt wholesale per
  // fan-out; renderNotesPanel() is a no-op while the panel is closed, so
  // the closed panel costs nothing. Entry enumeration reuses
  // getAnnotatedElements(document) — document order, which is slide order
  // — NOT state.annotatedElementsCache (that cache is emptied in overview
  // mode and edit-off, both of which keep the panel populated).
  //
  // Jumping mirrors navigateToSlide()'s activation contract exactly:
  // state.deckMutated flips arrow-nav to live-DOM queries so a fixture's
  // stale navigation closures cannot misnavigate after the editor
  // activates a slide behind the host's back.
  // ===========================================================================
  function collectNotesPanelEntries() {
    const slides = getSlides();
    // Whole-document fallback keeps chip numbering consistent with the
    // handoff payload (getSlideIndexForHandoffTarget) when a slide lives
    // outside the resolved deck root (multi-deck / nested documents).
    const allSlides = [...document.querySelectorAll('.slide')];
    return getAnnotatedElements(document).map((el) => {
      const slide = el.closest('.slide');
      const deckIndex = slide ? slides.indexOf(slide) : -1;
      return {
        id: getAnnotationId(el),
        scope: getAnnotationScope(el),
        el,
        slideIndex: deckIndex >= 0 ? deckIndex : (slide ? allSlides.indexOf(slide) : -1),
        snippet: getAnnotationScope(el) === 'deck' ? 'Whole deck'
          : getAnnotationScope(el) === 'slide' ? 'Whole slide' : summarizeTargetText(el).slice(0, 60),
        instruction: getAnnotationText(el),
        status: el.getAttribute(ANNOTATION_STATUS_ATTR) || '',
        reply: normalizeAnnotationText(el.getAttribute(ANNOTATION_REPLY_ATTR)),
      };
    }).concat(groupPanelEntries());
  }

  function makeNotesCard(entry, selectedId) {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'wfpe-notes-card';
    card.dataset.annotationId = entry.id;
    card.dataset.scope = entry.scope;
    if (entry.status) card.dataset.status = entry.status;
    card.dataset.active = (selectedId && entry.id === selectedId) ? 'true' : 'false';
    card.setAttribute('aria-label', 'Go to agent note');

    const top = document.createElement('span');
    top.className = 'wfpe-notes-card-top';
    if (entry.slideIndex >= 0) {
      const chip = document.createElement('span');
      chip.className = 'wfpe-notes-card-chip';
      chip.textContent = String(entry.slideIndex + 1);
      chip.title = `Slide ${entry.slideIndex + 1}`;
      top.appendChild(chip);
    }
    const snippet = document.createElement('span');
    snippet.className = 'wfpe-notes-card-snippet';
    snippet.textContent = entry.snippet || `<${entry.el.tagName.toLowerCase()}>`;
    top.appendChild(snippet);
    card.appendChild(top);

    const instruction = document.createElement('span');
    instruction.className = 'wfpe-notes-card-instruction';
    instruction.textContent = entry.instruction;
    card.appendChild(instruction);

    if (entry.status) {
      const reply = document.createElement('span');
      reply.className = 'wfpe-notes-card-reply';
      reply.dataset.status = entry.status;
      const label = entry.status === 'needs-input' ? 'Agent needs input' : 'Agent skipped';
      reply.textContent = entry.reply ? `${label}: ${entry.reply}` : `${label}.`;
      card.appendChild(reply);
    }
    return card;
  }

  function renderNotesPanel() {
    if (!state.notesPanelOpen) return;
    const entries = collectNotesPanelEntries();
    const selectedId = (state.groupNotesUi && !state.groupNotesUi.editor.hidden && state.groupNotesUi.id) || getAnnotationId(state.selected) || getAnnotationId(state.scopedNotesUi && state.scopedNotesUi.target);
    refreshScopedNoteEditor();
    notesList.replaceChildren();
    if (entries.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'wfpe-notes-empty';
      empty.textContent = state.scopedNotesUi
        ? 'No agent notes yet. Add a slide or deck note above, or select an element.'
        : 'No agent notes yet. Select an element and add one in the inspector.';
      notesList.appendChild(empty);
    } else {
      for (const entry of entries) notesList.appendChild(makeNotesCard(entry, selectedId));
    }
    const cycleDisabled = entries.length < 2;
    notesPrevBtn.disabled = cycleDisabled;
    notesNextBtn.disabled = cycleDisabled;
  }

  function jumpToAnnotation(id) {
    if (jumpToGroupNote(id)) return;
    if (state.groupNotesUi) state.groupNotesUi.editor.hidden = true;
    const el = findAnnotationElementById(id);
    if (!el) {
      // Stale card (note deleted between fan-outs) — degrade to a
      // re-render, never a wrong jump.
      renderNotesPanel();
      return;
    }
    closeExportMenu();
    const scope = getAnnotationScope(el);
    if (scope !== 'element') {
      if (scope === 'slide') {
        if (state.overviewMode) setOverviewMode(false);
        state.deckMutated = true;
        synchronizeSlideState(el);
      }
      setSelected(null);
      state.notesCursorId = id;
      openNotesPanel();
      openScopedNoteEditor(el, scope);
      return;
    }
    if (state.scopedNotesUi) {
      state.scopedNotesUi.target = null;
      state.scopedNotesUi.editor.hidden = true;
    }
    if (state.overviewMode) setOverviewMode(false);
    // Selection machinery requires edit mode; a jump from edit-off is an
    // explicit "take me to this note", so turning it on is the intent.
    if (!state.editMode) setEditMode(true);
    const slide = el.closest('.slide');
    if (slide && slide !== getActiveSlide()) {
      // The editor activated this slide without advancing the host deck's
      // private cursor — own subsequent arrows (see navigateToSlide).
      state.deckMutated = getDocumentMode() !== 'flat';
      synchronizeSlideState(slide);
    }
    state.notesCursorId = id;
    setSelected(el);
    // Opens the inspector (populated note + reply) and, via its
    // refreshExportUi tail, re-renders the card list with data-active set.
    refreshInspector();
    // Slides are viewport-sized; only flat documents scroll to content.
    if (isFlatMode()) el.scrollIntoView({ block: 'center' });
    // Focus stays OUT of the note textarea: a focused textarea would
    // swallow the next N keystroke (isTypingTarget) and end the flicking.
    const activeCard = notesList.querySelector('[data-active="true"]');
    if (activeCard) activeCard.scrollIntoView({ block: 'nearest' });
  }

  function cycleAnnotation(delta) {
    const entries = collectNotesPanelEntries();
    if (entries.length === 0) return;
    if (!state.notesPanelOpen) openNotesPanel();
    const selectedId = (state.groupNotesUi && !state.groupNotesUi.editor.hidden && state.groupNotesUi.id) || getAnnotationId(state.selected) || getAnnotationId(state.scopedNotesUi && state.scopedNotesUi.target);
    let index = selectedId
      ? entries.findIndex((entry) => entry.id === selectedId)
      : -1;
    if (index < 0 && state.notesCursorId) {
      index = entries.findIndex((entry) => entry.id === state.notesCursorId);
    }
    const next = index < 0
      ? (delta > 0 ? 0 : entries.length - 1)
      : (index + delta + entries.length) % entries.length;
    jumpToAnnotation(entries[next].id);
  }

  // Structural scopes share annotation IDs and attribute history with element
  // notes. They are never selectable canvas elements or floating element pins.
  function initScopedNotes() {
    if (state.scopedNotesUi || state.markdownMode || isFlatMode()) return;
    const style = document.createElement('style');
    style.textContent = `
      #wfp-editor-root .wfpe-notes-panel { max-height:calc(100vh - 76px); overflow-y:auto; overscroll-behavior:contain; }
      #wfp-editor-root .wfpe-scoped-note-actions { display:flex; gap:6px; padding:8px; }
      #wfp-editor-root .wfpe-scoped-note-actions button { flex:1; border:1px solid rgba(255,255,255,.2); border-radius:6px; background:rgba(255,255,255,.08); color:inherit; font:inherit; padding:6px; cursor:pointer; }
      #wfp-editor-root .wfpe-scoped-note-actions button:disabled { opacity:.4; cursor:default; }
      #wfp-editor-root .wfpe-scoped-note-editor { padding:0 8px 8px; }
      #wfp-editor-root .wfpe-scoped-note-editor[hidden] { display:none; }
      #wfp-editor-root .wfpe-scoped-note-label { display:block; margin:3px 0 6px; font-weight:600; }
      #wfp-editor-root .wfpe-scoped-note-input { display:block; box-sizing:border-box; width:100%; min-height:76px; max-height:130px; resize:vertical; border:1px solid rgba(255,255,255,.25); border-radius:6px; background:rgba(0,0,0,.18); color:inherit; font:12px/1.4 system-ui; padding:8px; }
      #wfp-editor-root .wfpe-scoped-note-status { font-size:10px; opacity:.8; }
      #wfp-editor-root .wfpe-scoped-note-reply { font-size:11px; margin:5px 0; }
    `;
    root.appendChild(style);
    const actions = document.createElement('div');
    actions.className = 'wfpe-scoped-note-actions';
    const editor = document.createElement('div');
    editor.className = 'wfpe-scoped-note-editor';
    editor.hidden = true;
    const label = document.createElement('label');
    label.className = 'wfpe-scoped-note-label';
    label.htmlFor = 'wfpe-scoped-note-input';
    const input = document.createElement('textarea');
    input.id = 'wfpe-scoped-note-input';
    input.className = 'wfpe-scoped-note-input';
    input.placeholder = 'What should the agent change?';
    const status = document.createElement('div');
    status.className = 'wfpe-scoped-note-status';
    status.setAttribute('aria-live', 'polite');
    const reply = document.createElement('div');
    reply.className = 'wfpe-scoped-note-reply';
    const buttons = document.createElement('div');
    buttons.className = 'wfpe-scoped-note-actions';
    const ui = { editor, label, input, status, reply, target:null, scope:null, dirty:false, drafts:new Map() };
    state.scopedNotesUi = ui;
    function button(parent, action, text, callback) {
      const el = document.createElement('button');
      el.type = 'button';
      el.dataset.action = action;
      el.textContent = text;
      el.addEventListener('click', callback);
      parent.appendChild(el);
      return el;
    }
    button(actions, 'note-slide', 'Current slide note', () => openScopedNoteEditor(getActiveSlide(), 'slide'));
    button(actions, 'note-deck', 'Whole deck note', () => openScopedNoteEditor(getDeckRoot(), 'deck'));
    ui.save = button(buttons, 'scoped-note-save', 'Save note', () => {
      if (!ui.target || !ui.target.isConnected) return;
      const target = ui.target;
      const text = input.value;
      ui.drafts.delete(target);
      ui.dirty = false;
      saveAnnotation(target, text, ui.scope);
      refreshScopedNoteEditor();
    });
    ui.remove = button(buttons, 'scoped-note-delete', 'Delete note', () => {
      if (!ui.target || !ui.target.isConnected) return;
      ui.drafts.delete(ui.target);
      ui.dirty = false;
      deleteAnnotation(ui.target);
      refreshScopedNoteEditor();
    });
    button(buttons, 'scoped-note-close', 'Close', () => {
      ui.target = null;
      editor.hidden = true;
      renderNotesPanel();
    });
    input.addEventListener('input', () => {
      if (!ui.target) return;
      ui.dirty = normalizeAnnotationText(input.value) !== getAnnotationText(ui.target);
      if (ui.dirty) ui.drafts.set(ui.target, input.value);
      else ui.drafts.delete(ui.target);
      status.textContent = ui.dirty ? 'Unsaved' : (hasAnnotation(ui.target) ? 'Saved' : '');
    });
    input.addEventListener('keydown', (event) => {
      event.stopPropagation();
      if (event.key === 'Escape') {
        event.preventDefault();
        ui.drafts.delete(ui.target);
        ui.dirty = false;
        refreshScopedNoteEditor();
        input.blur();
      } else if (event.key === 'Enter' && event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey) {
        event.preventDefault();
        ui.save.click();
      }
    });
    editor.append(label, input, status, reply, buttons);
    notesPanel.insertBefore(actions, notesList);
    notesPanel.insertBefore(editor, notesList);
  }

  function openScopedNoteEditor(target, scope) {
    if (state.groupNotesUi) state.groupNotesUi.editor.hidden = true;
    const ui = state.scopedNotesUi;
    if (!ui || !target || !target.isConnected) return;
    if (state.editingText) endTextEdit();
    setSelected(null);
    ui.target = target;
    ui.scope = scope;
    ui.dirty = ui.drafts.has(target);
    ui.input.value = ui.dirty ? ui.drafts.get(target) : getAnnotationText(target);
    ui.editor.hidden = false;
    state.notesCursorId = getAnnotationId(target) || null;
    refreshExportUi();
  }

  function refreshScopedNoteEditor() {
    const ui = state.scopedNotesUi;
    if (!ui || !ui.target) return;
    if (!ui.target.isConnected) {
      ui.editor.hidden = true;
      return;
    }
    ui.editor.hidden = false;
    const index = getSlides().indexOf(ui.target);
    ui.label.textContent = ui.scope === 'deck' ? 'Whole deck' : `Whole slide ${index + 1}`;
    if (!ui.dirty) ui.input.value = getAnnotationText(ui.target);
    ui.status.textContent = ui.dirty ? 'Unsaved' : (hasAnnotation(ui.target) ? 'Saved' : '');
    ui.remove.disabled = !hasAnnotation(ui.target);
    const result = ui.target.getAttribute(ANNOTATION_STATUS_ATTR);
    const reply = normalizeAnnotationText(ui.target.getAttribute(ANNOTATION_REPLY_ATTR));
    ui.reply.textContent = result ? `${result === 'needs-input' ? 'Agent needs input' : 'Agent skipped'}${reply ? ': ' + reply : '.'}` : '';
    positionInspectorStack();
  }

  function hasPendingNoteDraft() {
    if (state.groupNotesUi?.dirty && state.groupNotesUi.owner?.isConnected) return true;
    const drafts = state.scopedNotesUi?.drafts;
    if (drafts) {
      for (const target of drafts.keys()) {
        if (!target.isConnected) drafts.delete(target);
      }
      if (drafts.size) return true;
    }
    return annotationRow.dataset.dirty === 'true';
  }
