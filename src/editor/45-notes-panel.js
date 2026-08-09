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
        el,
        slideIndex: deckIndex >= 0 ? deckIndex : (slide ? allSlides.indexOf(slide) : -1),
        snippet: summarizeTargetText(el).slice(0, 60),
        instruction: getAnnotationText(el),
        status: el.getAttribute(ANNOTATION_STATUS_ATTR) || '',
        reply: normalizeAnnotationText(el.getAttribute(ANNOTATION_REPLY_ATTR)),
      };
    });
  }

  function makeNotesCard(entry, selectedId) {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'wfpe-notes-card';
    card.dataset.annotationId = entry.id;
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
    const selectedId = getAnnotationId(state.selected);
    notesList.replaceChildren();
    if (entries.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'wfpe-notes-empty';
      empty.textContent = 'No agent notes yet. Select an element and add one in the inspector.';
      notesList.appendChild(empty);
    } else {
      for (const entry of entries) notesList.appendChild(makeNotesCard(entry, selectedId));
    }
    const cycleDisabled = entries.length < 2;
    notesPrevBtn.disabled = cycleDisabled;
    notesNextBtn.disabled = cycleDisabled;
  }

  function jumpToAnnotation(id) {
    const el = findAnnotationElementById(id);
    if (!el) {
      // Stale card (note deleted between fan-outs) — degrade to a
      // re-render, never a wrong jump.
      renderNotesPanel();
      return;
    }
    closeExportMenu();
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
    const selectedId = getAnnotationId(state.selected);
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
