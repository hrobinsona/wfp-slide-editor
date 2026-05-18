  // ===========================================================================
  // Edit mode
  // ===========================================================================
  function setEditMode(value) {
    state.editMode = !!value;
    badge.dataset.mode = state.editMode ? 'on' : 'off';
    toolbar.dataset.mode = state.editMode ? 'on' : 'off';
    if (!state.editMode) {
      if (state.editingText) endTextEdit();
      setSelected(null);
      refreshInspector();
    }
  }

  // ===========================================================================
  // Overview mode (v2.1.0)
  //
  // A bird's-eye grid view of all slides — entered by hotkey `O`, the
  // Overview toolbar button, or (later v2.1.x phases) clicking outside the
  // grid; exited by `O`, Escape, or clicking a thumbnail (which both
  // navigates and exits).
  //
  // Mutual exclusion with element selection: entering overview clears
  // state.selected so the inspector and selection ring drop out (they
  // refer to slide-level content that's about to relocate). state.editMode
  // is deliberately untouched — overview can be toggled regardless of
  // edit mode, and exiting overview returns you to whatever edit-mode
  // state you were in.
  //
  // v2.1.0 wires the activation flag and the toolbar button only.
  // Subsequent phases (v2.1.1+) attach the grid DOM, click-to-navigate,
  // drag-to-reorder, and delete affordances on top of this state flag.
  // ===========================================================================
  function setOverviewMode(value) {
    const next = !!value;
    if (next === state.overviewMode) return;
    state.overviewMode = next;
    if (next) {
      // Closing any open text edit before entering overview: the edited
      // element's contenteditable lifecycle assumes the slide stays in
      // its normal layout. Future phases (v2.1.3 reorder, v2.1.4 delete)
      // mutate slide DOM order; an open contenteditable across that
      // transition would strand the caret.
      if (state.editingText) endTextEdit();
      setSelected(null);
      refreshInspector();
      enterOverview();
    } else {
      exitOverview();
    }
    overviewBtn.dataset.mode = state.overviewMode ? 'on' : 'off';
    toolbar.dataset.overviewMode = state.overviewMode ? 'on' : 'off';
  }

  // ---------------------------------------------------------------------------
  // Overview enter/exit + overlay layer (v2.1.1)
  //
  // CSS-override strategy: the body marker `data-wfp-edit-overview="on"`
  // gates a stylesheet block that overrides .deck/.slide rendering into a
  // grid. No slide DOM is mutated. Exit removes the marker; the fixture
  // CSS resumes its normal rendering with no leftover wrappers, classes,
  // or inline styles. The marker uses the data-wfp-edit-* namespace so
  // the export scrubber strips it as part of its existing sweep.
  //
  // The overlay layer renders editor chrome (slide-number badges, the
  // active-slide highlight; v2.1.4 will add the hover × button) at
  // viewport coordinates anchored to each slide's bounding rect. It
  // doesn't scale with the 0.22 transform — chrome stays at full size.
  // ---------------------------------------------------------------------------
  let overviewRafId = 0;
  function scheduleOverviewReposition() {
    if (overviewRafId) return;
    overviewRafId = requestAnimationFrame(() => {
      overviewRafId = 0;
      positionOverviewOverlay();
    });
  }

  function buildOverviewOverlay() {
    overviewOverlay.innerHTML = '';
    const slides = [...document.querySelectorAll('.deck > .slide')];
    for (let i = 0; i < slides.length; i++) {
      const slide = slides[i];
      const thumb = document.createElement('div');
      thumb.className = 'wfpe-overview-thumb';
      thumb.dataset.wfpEditSlideIndex = String(i);
      // Native HTML5 DnD source (v2.1.3). The thumb is editor-owned —
      // setting draggable here keeps slide DOM untouched.
      thumb.draggable = true;
      if (!slide.innerHTML.trim()) thumb.dataset.empty = 'true';
      // Make the thumb focusable (v2.1.4) so the × button reveals via
      // :focus-within for keyboard users; arrow-key navigation between
      // thumbs is an explicit non-goal (BRIEF), but Tab focus is fine.
      thumb.tabIndex = 0;
      if (slide.classList.contains('active')) thumb.dataset.active = 'true';
      const badge = document.createElement('span');
      badge.className = 'wfpe-overview-badge';
      badge.textContent = String(i + 1);
      thumb.appendChild(badge);
      // Delete button (v2.1.4). Carries the slide index so the click
      // handler can resolve the live .deck child without walking the
      // DOM up from event.target.
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'wfpe-overview-delete';
      del.dataset.wfpEditSlideIndex = String(i);
      del.title = 'Delete slide';
      del.setAttribute('aria-label', `Delete slide ${i + 1}`);
      del.innerHTML = ICONS.closeSmall;
      thumb.appendChild(del);
      overviewOverlay.appendChild(thumb);
    }
    for (let i = 0; i <= slides.length; i++) {
      const add = document.createElement('button');
      add.type = 'button';
      add.className = 'wfpe-overview-add';
      add.dataset.wfpEditInsertIndex = String(i);
      add.title = i === 0
        ? 'Insert slide before first slide'
        : (i === slides.length ? 'Insert slide after last slide' : `Insert slide at position ${i + 1}`);
      add.setAttribute('aria-label', add.title);
      add.textContent = '+';
      overviewOverlay.appendChild(add);
    }
    positionOverviewOverlay();
  }

  function positionOverviewOverlay() {
    if (!state.overviewMode) return;
    const slides = [...document.querySelectorAll('.deck > .slide')];
    const thumbs = overviewOverlay.querySelectorAll('.wfpe-overview-thumb');
    for (let i = 0; i < slides.length; i++) {
      const t = thumbs[i];
      if (!t) continue;
      const r = slides[i].getBoundingClientRect();
      t.style.top = `${r.top}px`;
      t.style.left = `${r.left}px`;
      t.style.width = `${r.width}px`;
      t.style.height = `${r.height}px`;
    }
    positionOverviewAddButtons(slides);
  }

  function positionOverviewAddButtons(slides) {
    const buttons = overviewOverlay.querySelectorAll('.wfpe-overview-add');
    if (slides.length === 0) {
      buttons.forEach((b) => { b.style.display = 'none'; });
      return;
    }
    const rects = slides.map((slide) => slide.getBoundingClientRect());
    const place = (button, x, y) => {
      button.style.display = 'inline-flex';
      button.style.left = `${x - 12}px`;
      button.style.top = `${y - 12}px`;
    };
    for (let i = 0; i < buttons.length; i++) {
      const button = buttons[i];
      if (i === 0) {
        const first = rects[0];
        place(button, first.left - 14, first.top + first.height / 2);
      } else if (i === rects.length) {
        const last = rects[rects.length - 1];
        place(button, last.right + 14, last.top + last.height / 2);
      } else {
        const prev = rects[i - 1];
        const next = rects[i];
        const sameRow = Math.abs(prev.top - next.top) < 4;
        if (sameRow) {
          place(button, (prev.right + next.left) / 2, next.top + next.height / 2);
        } else {
          place(button, next.left + next.width / 2, (prev.bottom + next.top) / 2);
        }
      }
    }
  }

  function enterOverview() {
    // The body marker lives on <body> rather than #wfp-editor-root because
    // the CSS-override strategy needs a global selector hook above the
    // .deck level. Using the data-wfp-edit-* namespace means the existing
    // export scrubber (which strips any data-wfp-edit* attribute on any
    // element) cleans it up automatically — no special-case needed.
    document.body.dataset.wfpEditOverview = 'on';
    // Defer overlay build until the browser has applied the new grid
    // layout — getBoundingClientRect right now would still report the
    // pre-grid (stacked-absolute) positions. Save the rAF id so a quick
    // toggle-off (within one frame) can cancel the pending build before
    // it strands a zombie overlay over the restored slide rendering.
    overviewRafId = requestAnimationFrame(() => {
      overviewRafId = 0;
      buildOverviewOverlay();
      overviewOverlay.dataset.visible = 'true';
    });
    window.addEventListener('scroll', scheduleOverviewReposition, true);
    window.addEventListener('resize', scheduleOverviewReposition);
    // Capture-phase click listener owns thumb-click → navigate (v2.1.2).
    // Capture so we beat the fixture's own slide click handlers if any
    // exist. Editor-root clicks (toolbar / inspector) are exempted
    // inside the handler so their existing bubble-phase handlers still
    // fire.
    document.addEventListener('click', onOverviewClick, true);
    // HTML5 native DnD listeners (v2.1.3). Delegated from the overlay
    // root so we don't need to re-bind on each rebuild.
    overviewOverlay.addEventListener('dragstart', onOverviewDragStart);
    overviewOverlay.addEventListener('dragover', onOverviewDragOver);
    overviewOverlay.addEventListener('dragleave', onOverviewDragLeave);
    overviewOverlay.addEventListener('drop', onOverviewDrop);
    overviewOverlay.addEventListener('dragend', onOverviewDragEnd);
    // Hover tracking + delete (v2.1.4). Mouseenter/leave are listened
    // via mouseover/out for delegation efficiency.
    overviewOverlay.addEventListener('mouseover', onOverviewMouseOver);
    overviewOverlay.addEventListener('mouseout', onOverviewMouseOut);
    overviewOverlay.addEventListener('click', onOverviewAddClick);
    overviewOverlay.addEventListener('click', onOverviewDeleteClick);
  }

  function exitOverview() {
    document.body.removeAttribute('data-wfp-edit-overview');
    overviewOverlay.dataset.visible = 'false';
    overviewOverlay.innerHTML = '';
    overviewDropIndicator.dataset.visible = 'false';
    state.overviewDrag = null;
    window.removeEventListener('scroll', scheduleOverviewReposition, true);
    window.removeEventListener('resize', scheduleOverviewReposition);
    document.removeEventListener('click', onOverviewClick, true);
    overviewOverlay.removeEventListener('dragstart', onOverviewDragStart);
    overviewOverlay.removeEventListener('dragover', onOverviewDragOver);
    overviewOverlay.removeEventListener('dragleave', onOverviewDragLeave);
    overviewOverlay.removeEventListener('drop', onOverviewDrop);
    overviewOverlay.removeEventListener('dragend', onOverviewDragEnd);
    overviewOverlay.removeEventListener('mouseover', onOverviewMouseOver);
    overviewOverlay.removeEventListener('mouseout', onOverviewMouseOut);
    overviewOverlay.removeEventListener('click', onOverviewAddClick);
    overviewOverlay.removeEventListener('click', onOverviewDeleteClick);
    state.overviewHoveredSlide = null;
    if (overviewRafId) {
      cancelAnimationFrame(overviewRafId);
      overviewRafId = 0;
    }
  }

  // Walk up from the click target. Two valid hit types since v2.1.3:
  //   - Click landed on an overlay thumb → look up the slide via the
  //     thumb's wfpEditSlideIndex dataset (thumbs sit above slides with
  //     pointer-events:auto so they receive clicks before the slide).
  //   - Click landed on a slide directly (e.g. fallback if a thumb
  //     hasn't been positioned yet) → walk up to the .deck child slide.
  // Returns null for clicks on editor chrome or grid gutters.
  function findOverviewSlideTarget(el) {
    while (el && el !== document.body) {
      if (el.classList) {
        if (el.classList.contains('wfpe-overview-thumb')) {
          const idx = Number(el.dataset.wfpEditSlideIndex);
          const slides = document.querySelectorAll('.deck > .slide');
          return slides[idx] || null;
        }
        if (
          el.classList.contains('slide') &&
          el.parentElement && el.parentElement.classList.contains('deck')
        ) {
          return el;
        }
      }
      el = el.parentElement;
    }
    return null;
  }

  function navigateToSlide(slide) {
    // Clear .active from any other slide in the same deck, set on the
    // clicked one. Idempotent — clicking the already-active slide just
    // exits overview without churning the class.
    const deck = slide.parentElement;
    if (!deck) return;
    for (const sib of deck.querySelectorAll(':scope > .slide.active')) {
      if (sib !== slide) sib.classList.remove('active');
    }
    if (!slide.classList.contains('active')) slide.classList.add('active');
    setOverviewMode(false);
  }

  function onOverviewClick(e) {
    // Delete-button clicks must NOT navigate — short-circuit before the
    // navigate path so the bubble-phase onOverviewDeleteClick can do
    // its job (capture-phase stopPropagation here would otherwise kill
    // it). v2.1.4 added the × button inside each thumb; the navigate
    // path's editor-root + thumb-walk would otherwise intercept it.
    if (e.target.closest('.wfpe-overview-delete')) return;
    // Editor-root clicks normally flow to their own bubble handlers
    // (toolbar Edit / Export / etc.), but the overview thumbs ALSO live
    // under #wfp-editor-root in v2.1.3 — they need to navigate. Filter
    // by walking up: a thumb hit is fine; any other editor-root hit
    // (toolbar / inspector) is exempted.
    if (isInsideEditorRoot(e.target) && !e.target.closest('.wfpe-overview-thumb')) {
      return;
    }
    const slide = findOverviewSlideTarget(e.target);
    if (!slide) return;
    e.preventDefault();
    e.stopPropagation();
    navigateToSlide(slide);
  }

  // ---------------------------------------------------------------------------
  // Drag to reorder (v2.1.3)
  //
  // Hand-rolled HTML5 native DnD on the overlay thumbs (per BRIEF — no
  // Sortable.js, no other library). DOM mutation only on `drop`: a
  // single .deck.insertBefore(sourceSlide, refNode) call. Active-slide
  // tracking is automatic since the .active class moves with the node.
  //
  // History contract: one drag = one history entry, undoable via the
  // existing v1 stack which has been EXTENDED (not refactored) with a
  // `slideOps` array on each entry. slideOps run alongside the existing
  // per-element `changes` array; reorder ops capture beforeOrder /
  // afterOrder (arrays of slide node references), and undo/redo
  // re-arrange the deck's children to match.
  // ---------------------------------------------------------------------------
  function ordersEqual(a, b) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }

  function applySlideOrder(deck, order) {
    // Re-attach each slide in the desired sequence. appendChild on an
    // already-attached node moves it to the end of the parent — so
    // appending in order produces the sequence in order.
    for (const slide of order) {
      if (slide && slide.parentElement === deck) deck.appendChild(slide);
    }
  }

  function pushSlideOpEntry(slideOp) {
    state.history.length = state.historyIndex;
    state.history.push({ changes: [], slideOps: [slideOp] });
    state.historyIndex = state.history.length;
    while (state.history.length > HISTORY_MAX) {
      state.history.shift();
      state.historyIndex--;
    }
    // Once any slide-level op lands, the fixture's cached slide list
    // (built once at script load via document.querySelectorAll) is
    // stale relative to the live deck — its arrow-nav would index into
    // the wrong slot or land .active on an orphan. From here on, the
    // editor owns plain-view arrow nav using fresh DOM queries.
    state.deckMutated = true;
  }

  // Navigate the live deck by ±1, syncing the fixture's progress-dot
  // siblings if any exist (best-effort — not all fixtures have them).
  // Used by the deckMutated arrow-nav takeover in onKeyDown.
  function navigateRelativeInDeck(delta) {
    const slides = [...document.querySelectorAll('.deck > .slide')];
    if (slides.length === 0) return;
    const dots = document.querySelectorAll('.progress-dot');
    let cur = slides.findIndex((s) => s.classList.contains('active'));
    if (cur < 0) {
      // Recovery: no in-DOM slide is .active (e.g., the fixture's
      // stale handler set .active on an orphan before we took over).
      // Re-anchor to the first slide so the user sees something.
      slides[0].classList.add('active');
      if (dots[0]) {
        dots.forEach((d) => d.classList.remove('active'));
        dots[0].classList.add('active');
      }
      return;
    }
    const next = cur + delta;
    if (next < 0 || next >= slides.length) return;
    slides[cur].classList.remove('active');
    slides[next].classList.add('active');
    if (dots[cur]) dots[cur].classList.remove('active');
    if (dots[next]) dots[next].classList.add('active');
  }

  function dropTargetThumb(target) {
    while (target && target !== overviewOverlay) {
      if (target.classList && target.classList.contains('wfpe-overview-thumb')) return target;
      target = target.parentElement;
    }
    return null;
  }

  function hideDropIndicator() {
    overviewDropIndicator.dataset.visible = 'false';
  }

  function positionDropIndicator(thumbRect, insertBefore) {
    overviewDropIndicator.dataset.visible = 'true';
    // Park the bar on the chosen edge, slightly outside the thumb so it
    // reads as a gutter mark rather than a side stripe on the thumb.
    const x = insertBefore ? thumbRect.left - 4 : thumbRect.right + 1;
    overviewDropIndicator.style.left = `${x}px`;
    overviewDropIndicator.style.top = `${thumbRect.top - 4}px`;
    overviewDropIndicator.style.height = `${thumbRect.height + 8}px`;
  }

  function onOverviewDragStart(e) {
    const thumb = dropTargetThumb(e.target);
    if (!thumb) return;
    const idx = Number(thumb.dataset.wfpEditSlideIndex);
    const slides = [...document.querySelectorAll('.deck > .slide')];
    const sourceSlide = slides[idx];
    if (!sourceSlide) return;
    state.overviewDrag = {
      sourceSlide,
      sourceIndex: idx,
      beforeOrder: slides.slice(),
    };
    thumb.dataset.dragging = 'true';
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move';
      // Some browsers (Firefox especially) refuse to start a drag unless
      // some payload is set on the dataTransfer — the value itself is
      // unused since we read state.overviewDrag instead.
      try { e.dataTransfer.setData('text/plain', String(idx)); } catch (_) { /* ignore */ }
    }
  }

  function onOverviewDragOver(e) {
    if (!state.overviewDrag) return;
    e.preventDefault(); // required to allow drop
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    const thumb = dropTargetThumb(e.target);
    if (!thumb) {
      hideDropIndicator();
      return;
    }
    const tIdx = Number(thumb.dataset.wfpEditSlideIndex);
    if (tIdx === state.overviewDrag.sourceIndex) {
      hideDropIndicator();
      return;
    }
    const tRect = thumb.getBoundingClientRect();
    const insertBefore = e.clientX < tRect.left + tRect.width / 2;
    positionDropIndicator(tRect, insertBefore);
  }

  function onOverviewDragLeave(e) {
    // When the cursor leaves the overlay entirely, hide the indicator.
    // dragleave on individual thumbs fires constantly during a drag,
    // so only act on overlay-level leaves.
    if (e.target === overviewOverlay) hideDropIndicator();
  }

  function onOverviewDrop(e) {
    if (!state.overviewDrag) return;
    e.preventDefault();
    const drag = state.overviewDrag;
    const thumb = dropTargetThumb(e.target);
    hideDropIndicator();
    if (!thumb) {
      cleanupDrag();
      return;
    }
    const tIdx = Number(thumb.dataset.wfpEditSlideIndex);
    if (tIdx === drag.sourceIndex) {
      cleanupDrag();
      return;
    }
    const slides = [...document.querySelectorAll('.deck > .slide')];
    const targetSlide = slides[tIdx];
    if (!targetSlide) {
      cleanupDrag();
      return;
    }
    const tRect = thumb.getBoundingClientRect();
    const insertBefore = e.clientX < tRect.left + tRect.width / 2;
    const deck = drag.sourceSlide.parentElement;
    if (!deck) {
      cleanupDrag();
      return;
    }
    const refNode = insertBefore ? targetSlide : targetSlide.nextSibling;
    deck.insertBefore(drag.sourceSlide, refNode);
    const afterOrder = [...document.querySelectorAll('.deck > .slide')];
    if (!ordersEqual(drag.beforeOrder, afterOrder)) {
      pushSlideOpEntry({
        type: 'reorder',
        deck,
        beforeOrder: drag.beforeOrder,
        afterOrder,
      });
    }
    cleanupDrag();
    // Rebuild the overlay so badges, draggables, and active-data flags
    // reflect the new order. positionOverviewOverlay is called inside.
    buildOverviewOverlay();
  }

  function onOverviewDragEnd(_e) {
    // Fires whether or not the drop succeeded. cleanupDrag is idempotent.
    cleanupDrag();
    hideDropIndicator();
  }

  function cleanupDrag() {
    if (!state.overviewDrag) return;
    for (const t of overviewOverlay.querySelectorAll('.wfpe-overview-thumb')) {
      if (t.dataset && 'dragging' in t.dataset) delete t.dataset.dragging;
    }
    state.overviewDrag = null;
  }

  // ---------------------------------------------------------------------------
  // Insert blank slide (overview add affordances)
  // ---------------------------------------------------------------------------
  function nextBlankSlideId(deck) {
    const slides = [...deck.querySelectorAll(':scope > .slide')];
    let maxNumericSuffix = -1;
    for (const slide of slides) {
      const id = slide.getAttribute('id') || '';
      const match = id.match(/(\d+)$/);
      if (!match) continue;
      maxNumericSuffix = Math.max(maxNumericSuffix, Number(match[1]));
    }
    let next = maxNumericSuffix >= 0 ? maxNumericSuffix + 1 : slides.length + 1;
    let id = `s${next}`;
    while (document.getElementById(id)) {
      next++;
      id = `s${next}`;
    }
    return id;
  }

  function insertBlankSlideAt(index) {
    const deck = document.querySelector('.deck');
    if (!deck) return null;
    const slides = [...deck.querySelectorAll(':scope > .slide')];
    const insertIndex = Math.max(0, Math.min(slides.length, Number(index) || 0));
    const beforeSibling = slides[insertIndex] || null;
    const slide = document.createElement('div');
    slide.className = 'slide';
    slide.id = nextBlankSlideId(deck);
    deck.insertBefore(slide, beforeSibling);
    observeSlideClass(slide);
    pushSlideOpEntry({
      type: 'slideInsert',
      deckEl: deck,
      insertedSlide: slide,
      beforeSibling,
    });
    buildOverviewOverlay();
    return slide;
  }

  function onOverviewAddClick(e) {
    const btn = e.target.closest('.wfpe-overview-add');
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation();
    insertBlankSlideAt(Number(btn.dataset.wfpEditInsertIndex));
  }

  // ---------------------------------------------------------------------------
  // Delete (v2.1.4)
  //
  // UX: hover-revealed × button per thumb (CSS-driven via :hover and
  // :focus-within), Backspace/Delete keyboard shortcut on the hovered or
  // focused thumb. Last-slide guard with a one-line toast. Active-slide
  // fallback per BRIEF: if the deleted slide was active, promote the
  // slide that now occupies its position; if it was last, fall back to
  // the new last.
  //
  // History contract: one delete = one history entry. Slide-level op
  // type 'delete' carries enough info to re-insert the exact node at
  // its exact prior position (using nextSibling node ref so re-inserts
  // remain correct across intervening reorder/delete ops).
  // ---------------------------------------------------------------------------
  function deleteSlideFromOverview(slide) {
    const deck = slide && slide.parentElement;
    if (!deck || !deck.classList.contains('deck')) return;
    const slides = [...deck.querySelectorAll(':scope > .slide')];
    if (slides.length <= 1) {
      showToast(slide, "Can't delete the last slide.");
      return;
    }
    const wasActive = slide.classList.contains('active');
    const idx = slides.indexOf(slide);
    const nextSibling = slide.nextElementSibling; // may be null if last
    // Per BRIEF: if deleted slide was active and not the last, promote
    // the slide that now occupies its position (was at idx + 1). If it
    // was the last, fall back to the new last (was at idx - 1).
    let fallbackSlide = null;
    if (wasActive) {
      fallbackSlide = slides[idx + 1] || slides[idx - 1] || null;
    }
    deck.removeChild(slide);
    if (wasActive && fallbackSlide) fallbackSlide.classList.add('active');
    pushSlideOpEntry({
      type: 'delete',
      deck,
      slide,
      nextSibling,
      wasActive,
      fallbackSlide,
    });
    // If the just-deleted slide was the hovered target, drop the
    // reference — the next mouseover will re-hydrate.
    if (state.overviewHoveredSlide === slide) state.overviewHoveredSlide = null;
    buildOverviewOverlay();
  }

  function getOverviewDeleteTarget() {
    // Keyboard focus wins over mouse hover so a user with both
    // (e.g. tabbed to a thumb while the cursor is over a different
    // one) operates on the focused thumb. Falls back to hover.
    const active = document.activeElement;
    if (active && overviewOverlay.contains(active)) {
      const thumb = active.closest('.wfpe-overview-thumb');
      if (thumb) {
        const i = Number(thumb.dataset.wfpEditSlideIndex);
        return document.querySelectorAll('.deck > .slide')[i] || null;
      }
    }
    return state.overviewHoveredSlide;
  }

  function onOverviewMouseOver(e) {
    const thumb = e.target.closest('.wfpe-overview-thumb');
    if (!thumb) return;
    const idx = Number(thumb.dataset.wfpEditSlideIndex);
    state.overviewHoveredSlide = document.querySelectorAll('.deck > .slide')[idx] || null;
  }

  function onOverviewMouseOut(e) {
    // Only clear when leaving the overlay entirely or moving to a non-thumb
    // ancestor. Moving between thumbs fires mouseout on the previous
    // thumb followed by mouseover on the next; the mouseover above
    // re-hydrates state.overviewHoveredSlide.
    const related = e.relatedTarget;
    if (related && overviewOverlay.contains(related) && related.closest('.wfpe-overview-thumb')) return;
    state.overviewHoveredSlide = null;
  }

  function onOverviewDeleteClick(e) {
    const btn = e.target.closest('.wfpe-overview-delete');
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation();
    const idx = Number(btn.dataset.wfpEditSlideIndex);
    const slide = document.querySelectorAll('.deck > .slide')[idx];
    if (!slide) return;
    deleteSlideFromOverview(slide);
  }

  function isTypingTarget(el) {
    if (!el) return false;
    const tag = el.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
    if (el.isContentEditable) return true;
    return false;
  }

  function isTextBearing(el) {
    if (!el) return false;
    for (const node of el.childNodes) {
      if (node.nodeType === 3 && node.textContent.trim().length > 0) return true;
    }
    return false;
  }

  function nudgeFontSize(el, deltaPx) {
    const current = parseFloat(getComputedStyle(el).fontSize);
    if (!Number.isFinite(current)) return;
    const next = Math.max(FONT_SIZE_MIN_PX, current + deltaPx);
    el.style.fontSize = `${next}px`;
  }

  // Inspector ± buttons — same primitive as the keyboard arrow nudge,
  // but bracketed with a fresh txn so each click is exactly one history
  // entry. Uses the inspector-txn isolation helpers so a click during
  // a text-edit produces its own entry separate from the typing.
  function nudgeFontSizeWithHistory(deltaPx) {
    const el = state.selected;
    if (!el || !isTextBearing(el)) return;
    const ctx = startInspectorTxn();
    touchElement(el);
    nudgeFontSize(el, deltaPx);
    endInspectorTxn(ctx);
    refreshSelection();
  }

  function onKeyDown(e) {
    // While a text edit is open, only intercept Escape/Tab (commit) and
    // Cmd/Ctrl+S (commit + export). Every other key flows to the
    // contenteditable element for default behavior (typing, caret motion),
    // BUT we still call stopPropagation so the fixture's bubble-phase
    // keydown handler (which navigates slides on ArrowLeft/Right/Space)
    // doesn't fire alongside the caret movement.
    //
    // Exception (v2.6): keystrokes targeted at the inspector (its inputs,
    // sliders, buttons) must reach their own listeners — Enter to commit
    // a hex value, Escape to revert, etc. Capture-phase stopPropagation
    // would kill those bubble-phase handlers. So when the target lives
    // under the inspector, drop the suppression entirely.
    if (state.editingText) {
      if (inspector.contains(e.target)) return;
      if (e.key === 'Escape' || e.key === 'Tab') {
        e.preventDefault();
        e.stopPropagation();
        endTextEdit();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && (e.key === 's' || e.key === 'S')) {
        e.preventDefault();
        e.stopPropagation();
        endTextEdit();
        exportHTML();
        return;
      }
      e.stopPropagation();
      return;
    }

    if (isTypingTarget(e.target)) return;
    const noModifier = !e.metaKey && !e.ctrlKey && !e.altKey;
    const isMod = e.metaKey || e.ctrlKey;

    if ((e.key === 'e' || e.key === 'E') && noModifier) {
      setEditMode(!state.editMode);
      return;
    }

    // Overview mode toggle (v2.1.0). `O` works regardless of edit mode
    // (matches the `E` precedent). Escape exits when overview is on,
    // no-op otherwise — text-edit Escape is already handled above.
    if ((e.key === 'o' || e.key === 'O') && noModifier) {
      e.preventDefault();
      e.stopPropagation();
      setOverviewMode(!state.overviewMode);
      return;
    }
    if (e.key === 'Escape' && state.overviewMode && noModifier) {
      e.preventDefault();
      e.stopPropagation();
      setOverviewMode(false);
      return;
    }

    // Plain-view arrow nav takeover (v2.1.0 hotfix). Once the deck has
    // been mutated via overview reorder/delete, the fixture's own
    // keydown handler — which caches slides + cur at load time — is
    // stale: forward nav lands on the wrong slide (reorder) or sets
    // .active on an orphan node leaving the user staring at black
    // (delete). Editor's nav uses fresh DOM queries.
    if (
      state.deckMutated &&
      !state.editMode &&
      !state.overviewMode &&
      !e.metaKey && !e.ctrlKey && !e.altKey &&
      (e.key === 'ArrowRight' || e.key === 'ArrowLeft' || e.key === ' ' || e.key === 'Spacebar')
    ) {
      e.preventDefault();
      e.stopPropagation();
      navigateRelativeInDeck(e.key === 'ArrowLeft' ? -1 : +1);
      return;
    }

    // Editor key handling fires when EITHER edit mode or overview mode
    // is active. Overview is its own "editor active" surface (reorder /
    // delete / undo); requiring edit-mode-on to undo a reorder while in
    // overview would be surprising UX.
    if (!state.editMode && !state.overviewMode) return;

    if (state.editMode && isMod && !e.altKey && (e.key === 'c' || e.key === 'C')) {
      if (!state.selected) return;
      e.preventDefault();
      e.stopPropagation();
      copySelectedElement();
      return;
    }

    if (state.editMode && isMod && !e.altKey && !e.shiftKey && (e.key === 'v' || e.key === 'V')) {
      if (!state.clipboard || state.overviewMode) return;
      e.preventDefault();
      e.stopPropagation();
      pasteClipboardElement();
      return;
    }

    if (
      state.editMode &&
      !state.overviewMode &&
      noModifier &&
      (e.key === 'Backspace' || e.key === 'Delete')
    ) {
      if (!state.selected) return;
      e.preventDefault();
      e.stopPropagation();
      deleteSelectedElement();
      return;
    }

    // Backspace / Delete in overview deletes the hovered (or focused)
    // thumbnail's slide (v2.1.4). Routes through the same path as the
    // × button click so history + last-slide guard behave identically.
    if (
      state.overviewMode &&
      noModifier &&
      (e.key === 'Backspace' || e.key === 'Delete')
    ) {
      const target = getOverviewDeleteTarget();
      if (target) {
        e.preventDefault();
        e.stopPropagation();
        deleteSlideFromOverview(target);
      }
      return;
    }

    // Suppress slide navigation keys while edit mode is on. The fixture's
    // own keydown handler is registered in bubble phase, so by registering
    // ours in capture phase + stopPropagation here, we pre-empt it cleanly.
    if (
      (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === ' ' || e.key === 'Spacebar') &&
      !e.metaKey && !e.ctrlKey && !e.altKey
    ) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }

    if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && noModifier) {
      if (!state.selected || !isTextBearing(state.selected)) return;
      e.preventDefault();
      e.stopPropagation();
      const direction = e.key === 'ArrowUp' ? +1 : -1;
      const step = e.shiftKey ? 5 : 1;
      beginTxn();
      touchElement(state.selected);
      nudgeFontSize(state.selected, direction * step);
      endTxn();
      refreshSelection();
      return;
    }

    // Undo / redo. Cmd/Ctrl+Z = undo, Cmd/Ctrl+Shift+Z = redo, Cmd/Ctrl+Y = redo.
    if (isMod && (e.key === 'z' || e.key === 'Z')) {
      e.preventDefault();
      e.stopPropagation();
      if (e.shiftKey) redo();
      else undo();
      return;
    }
    if (isMod && (e.key === 'y' || e.key === 'Y') && !e.shiftKey) {
      e.preventDefault();
      e.stopPropagation();
      redo();
      return;
    }

    // Export
    if (isMod && (e.key === 's' || e.key === 'S') && !e.shiftKey) {
      e.preventDefault();
      e.stopPropagation();
      exportHTML();
      return;
    }
  }

  document.addEventListener('keydown', onKeyDown, true);

