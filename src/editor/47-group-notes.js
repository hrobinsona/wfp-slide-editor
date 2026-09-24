  // Shared instructions have their own slide-owned records. Individual notes
  // stay untouched, and overlapping groups can share stable member identities.
  function readGroupNotes(owner) {
    try {
      const records = JSON.parse(owner.getAttribute(GROUP_NOTES_ATTR) || '[]');
      return Array.isArray(records) ? records.filter(record => record && typeof record.id === 'string' &&
        typeof record.instruction === 'string' && Array.isArray(record.memberIds) &&
        record.memberIds.length >= 2 && record.memberIds.every(id => typeof id === 'string' && id) &&
        new Set(record.memberIds).size === record.memberIds.length) : [];
    } catch (_) { return []; }
  }

  function writeGroupNotes(owner, records) {
    if (records.length) owner.setAttribute(GROUP_NOTES_ATTR, JSON.stringify(records));
    else owner.removeAttribute(GROUP_NOTES_ATTR);
  }

  function resolveGroupMembers(owner, record, attribute = GROUP_TARGET_ATTR) {
    const candidates = [...owner.querySelectorAll(`[${attribute}]`)];
    const members = [], missing = [];
    for (const id of record.memberIds) {
      const matches = candidates.filter(el => el.getAttribute(attribute) === id &&
        (!el.closest('.slide') || el.closest('.slide') === owner));
      if (matches.length === 1) members.push(matches[0]);
      else missing.push(id);
    }
    return { members, missing };
  }

  function collectGroupNotes(rootNode = document) {
    const rootEl = rootNode.documentElement || rootNode;
    const owners = [rootEl, ...rootEl.querySelectorAll(`[${GROUP_NOTES_ATTR}]`)].filter(el => el.hasAttribute(GROUP_NOTES_ATTR));
    return owners.flatMap(owner => readGroupNotes(owner).map(record => ({ owner, record, ...resolveGroupMembers(owner, record) })));
  }

  function getAgentNoteCount() {
    return getAnnotatedElements(document).length + collectGroupNotes().length;
  }

  function groupPanelEntries() {
    return collectGroupNotes().map(({owner, record, members, missing}) => ({
      id:record.id, scope:'group', el:owner, slideIndex:getSlides().indexOf(owner),
      snippet:`Group of ${record.memberIds.length} items${missing.length ? ` · ${missing.length} missing` : ''}`,
      instruction:record.instruction, status:record.status || '', reply:record.reply || '', members,
    }));
  }

  function initGroupNotes() {
    if (state.markdownMode) return;
    const action = document.createElement('button');
    action.type = 'button';
    action.className = 'wfpe-group-note-action';
    action.hidden = true;
    const hint = document.createElement('p');
    hint.className = 'wfpe-selection-hint';
    hint.textContent = 'Drag empty space to select items. Shift-drag over content; Cmd/Ctrl adds items.';
    inspectorBody.append(action, hint);
    const editor = document.createElement('div');
    editor.className = 'wfpe-group-note-editor';
    editor.hidden = true;
    const label = document.createElement('label');
    label.htmlFor = 'wfpe-group-note-input';
    const input = document.createElement('textarea');
    input.id = 'wfpe-group-note-input';
    input.className = 'wfpe-group-note-input';
    input.placeholder = 'What should the agent change for these items together?';
    const status = document.createElement('div');
    status.setAttribute('aria-live','polite');
    const buttons = document.createElement('div');
    buttons.className = 'wfpe-group-note-buttons';
    editor.append(label, input, status, buttons);
    notesPanel.insertBefore(editor, notesList);
    const style = document.createElement('style');
    style.textContent = `
      #wfp-editor-root .wfpe-group-note-action, #wfp-editor-root .wfpe-group-note-editor button { pointer-events:auto; background:#ffffff18; color:inherit; border:1px solid #ffffff40; border-radius:5px; padding:7px; font:inherit; cursor:pointer; }
      #wfp-editor-root .wfpe-group-note-action { margin:8px 12px; }
      #wfp-editor-root .wfpe-group-note-action[hidden], #wfp-editor-root .wfpe-group-note-editor[hidden] { display:none!important; }
      #wfp-editor-root .wfpe-group-note-editor { padding:8px; font:12px/1.4 system-ui; }
      #wfp-editor-root .wfpe-group-note-editor label { display:block; font-weight:600; margin-bottom:6px; }
      #wfp-editor-root .wfpe-group-note-input { box-sizing:border-box; width:100%; min-height:70px; max-height:130px; resize:vertical; color:inherit; background:#0002; border:1px solid #ffffff40; border-radius:5px; padding:8px; font:inherit; }
      #wfp-editor-root .wfpe-group-note-editor button { margin:5px 4px 0 0; }
      #wfp-editor-root .wfpe-group-note-buttons { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:5px; margin-top:5px; }
      #wfp-editor-root .wfpe-group-note-buttons button { margin:0; }
      #wfp-editor-root:has(.wfpe-notes-dock[data-visible="true"] .wfpe-group-note-editor:not([hidden])) .wfpe-notes-panel { max-height:50vh; overflow-y:auto; overscroll-behavior:contain; }
      #wfp-editor-root:has(.wfpe-notes-dock[data-visible="true"] .wfpe-group-note-editor:not([hidden])) .wfpe-inspector-body { max-height:calc(50vh - 112px); }
      #wfp-editor-root .wfpe-selection-hint { font:10px/1.4 system-ui; opacity:.8; margin:6px 12px 10px; }
    `;
    root.appendChild(style);
    const ui = { action, editor, label, input, status, owner:null, id:null, members:[], dirty:false };
    state.groupNotesUi = ui;
    function button(text, callback) {
      const el = document.createElement('button');
      el.type = 'button'; el.textContent = text;
      el.addEventListener('click', callback); buttons.appendChild(el); return el;
    }
    button('Save group note', () => saveGroupNote());
    ui.remove = button('Delete group note', () => saveGroupNote(true));
    button('Close group note', () => { ui.editor.hidden = true; });
    button('Discard group draft', () => { ui.dirty = false; refreshGroupNoteUi(); ui.editor.hidden = true; });
    action.addEventListener('click', () => {
      const members = getSelectedElements();
      if (members.length < 2) return;
      const owner = getActiveSlide();
      const match = collectGroupNotes().find(group => group.owner === owner && !group.missing.length &&
        group.members.length === members.length && group.members.every(el => members.includes(el)));
      openGroupNoteEditor(owner, match?.record.id || null, members);
    });
    input.addEventListener('input', () => {
      const record = ui.owner && readGroupNotes(ui.owner).find(record => record.id === ui.id);
      ui.dirty = normalizeAnnotationText(input.value) !== (record?.instruction || '');
      ui.status.textContent = ui.dirty ? 'Unsaved group draft' : record ? 'Saved' : '';
    });
    input.addEventListener('keydown', event => {
      event.stopPropagation();
      if (event.key === 'Escape') { event.preventDefault(); ui.dirty = false; refreshGroupNoteUi(); input.blur(); }
      if (event.key === 'Enter' && event.shiftKey) { event.preventDefault(); saveGroupNote(); }
    });
    refreshGroupNoteUi();
  }

  function openGroupNoteEditor(owner, id, members) {
    const ui = state.groupNotesUi;
    if (!ui || !owner?.isConnected) return;
    if (ui.dirty && (ui.owner !== owner || ui.id !== id || !selectionArraysEqual(ui.members, members))) {
      ui.editor.hidden = false; openNotesPanel();
      showToast(document.body, 'Save or discard the current group draft before opening another group.'); return;
    }
    if (state.editingText) endTextEdit();
    if (state.scopedNotesUi) { state.scopedNotesUi.target = null; state.scopedNotesUi.editor.hidden = true; }
    ui.owner = owner; ui.id = id; ui.members = [...members];
    ui.editor.hidden = false;
    openNotesPanel(); refreshGroupNoteUi();
  }

  function refreshGroupNoteUi() {
    const ui = state.groupNotesUi;
    if (!ui) return;
    const count = getSelectedElements().length;
    ui.action.hidden = !state.editMode || state.overviewMode || count < 2;
    ui.action.textContent = `Note selected items (${count})`;
    if (!ui.owner) return;
    if (!ui.owner.isConnected) { ui.editor.hidden = true; return; }
    const record = readGroupNotes(ui.owner).find(record => record.id === ui.id);
    const resolved = record ? resolveGroupMembers(ui.owner, record) : { missing: ui.members.filter(el => !el.isConnected || !ui.owner.contains(el)) };
    ui.label.textContent = `Shared note · ${record?.memberIds.length || ui.members.length} items`;
    if (!ui.dirty) ui.input.value = record?.instruction || '';
    ui.status.textContent = ui.dirty ? 'Unsaved group draft' : resolved.missing.length ? `${resolved.missing.length} missing items — restore them before the agent applies this note.` : record ? 'Saved' : '';
    if (record?.status && !ui.dirty) ui.status.textContent += ` · ${record.status}: ${record.reply || ''}`;
    ui.remove.disabled = !record;
  }

  function saveGroupNote(remove = false) {
    const ui = state.groupNotesUi;
    if (!ui?.owner?.isConnected) return;
    const records = readGroupNotes(ui.owner);
    const existing = records.find(record => record.id === ui.id);
    const instruction = normalizeAnnotationText(ui.input.value);
    if (!remove && !instruction) { showToast(document.body, 'Write a group instruction before saving.'); return; }
    if (!remove && !existing && (ui.members.length < 2 || ui.members.some(el => !el.isConnected || !ui.owner.contains(el)))) {
      showToast(document.body, 'Some selected items are missing. Select the group again.'); return;
    }
    if (remove && !existing) return;
    if (!remove && existing?.instruction === instruction) { ui.dirty = false; refreshGroupNoteUi(); return; }
    const ctx = startInspectorTxn();
    touchElement(ui.owner);
    if (!ui.owner.hasAttribute(GROUP_TARGET_ATTR)) ui.owner.setAttribute(GROUP_TARGET_ATTR, generateAnnotationId());
    let memberIds = existing?.memberIds;
    if (!remove && !memberIds) memberIds = ui.members.map(el => {
      touchElement(el);
      if (!el.hasAttribute(GROUP_TARGET_ATTR)) el.setAttribute(GROUP_TARGET_ATTR, generateAnnotationId());
      return el.getAttribute(GROUP_TARGET_ATTR);
    });
    if (!ui.id) ui.id = generateAnnotationId();
    writeGroupNotes(ui.owner, [...records.filter(record => record.id !== ui.id), ...(remove ? [] : [{id:ui.id, instruction, memberIds}])]);
    const remaining = readGroupNotes(ui.owner);
    const used = new Set(remaining.flatMap(record => record.memberIds));
    for (const el of [ui.owner, ...ui.owner.querySelectorAll(`[${GROUP_TARGET_ATTR}]`)]) {
      if (el === ui.owner ? !remaining.length : !used.has(el.getAttribute(GROUP_TARGET_ATTR))) {
        touchElement(el); el.removeAttribute(GROUP_TARGET_ATTR);
      }
    }
    ui.dirty = false;
    endInspectorTxn(ctx);
    refreshExportUi();
    showToast(document.body, remove ? 'Group note deleted.' : 'Group note saved.');
  }

  function jumpToGroupNote(id) {
    const group = collectGroupNotes().find(group => group.record.id === id);
    if (!group) return false;
    if (state.overviewMode) setOverviewMode(false);
    if (!state.editMode) setEditMode(true);
    if (group.owner !== getActiveSlide() && group.owner.matches('.slide')) {
      state.deckMutated = true; synchronizeSlideState(group.owner);
    }
    setSelectedElements(group.members);
    state.notesCursorId = id;
    openGroupNoteEditor(group.owner, id, group.members);
    refreshInspector();
    return true;
  }

  function collectGroupHandoff(clone) {
    return collectGroupNotes(clone).map(({owner, record, members, missing}) => {
      owner.setAttribute(GROUP_HANDOFF_ATTR, owner.getAttribute(GROUP_TARGET_ATTR));
      const liveGroup = collectGroupNotes().find(group => group.record.id === record.id);
      const targets = members.map(el => {
        const id = el.getAttribute(GROUP_TARGET_ATTR);
        el.setAttribute(GROUP_HANDOFF_ATTR, id);
        const live = liveGroup?.members.find(member => member.getAttribute(GROUP_TARGET_ATTR) === id);
        return {id, targetText:summarizeTargetText(el), ...(live ? measureElementForHandoff(live) : {})};
      });
      return {...record, scope:'group', ownerId:owner.getAttribute(GROUP_TARGET_ATTR), slideIndex:getSlideIndexForHandoffTarget(clone, owner), targets, missingMemberIds:missing};
    });
  }

  function reimportGroupNotes(payload, results) {
    if (state.markdownMode) return;
    for (const record of payload?.annotations || []) {
      if (record?.scope !== 'group' || typeof record.ownerId !== 'string') continue;
      const anchors = [...document.querySelectorAll(`[${GROUP_HANDOFF_ATTR}]`)];
      const owners = anchors.filter(el => el.getAttribute(GROUP_HANDOFF_ATTR) === record.ownerId && (getSlides().includes(el) || el === getActiveSlide()));
      if (owners.length !== 1) continue;
      const owner = owners[0];
      const result = results?.byId.get(record.id);
      const valid = readGroupNotes({getAttribute:() => JSON.stringify([record])})[0];
      if (!valid || !normalizeAnnotationText(record.instruction)) continue;
      const remaining = readGroupNotes(owner).filter(existing => existing.id !== record.id);
      if (result?.status === 'done') { writeGroupNotes(owner, remaining); continue; }
      owner.setAttribute(GROUP_TARGET_ATTR, record.ownerId);
      for (const el of anchors) {
        if (el !== owner && owner.contains(el) && record.memberIds.includes(el.getAttribute(GROUP_HANDOFF_ATTR)))
          el.setAttribute(GROUP_TARGET_ATTR, el.getAttribute(GROUP_HANDOFF_ATTR));
      }
      const next = {id:record.id, instruction:normalizeAnnotationText(record.instruction), memberIds:record.memberIds};
      const reply = result || (['skipped','needs-input'].includes(record.status) ? record : null);
      if (reply) { next.status = reply.status; next.reply = normalizeAnnotationText(reply.note || reply.reply); }
      writeGroupNotes(owner, [...remaining, next]);
    }
  }
