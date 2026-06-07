  // Inline SVG icons — single-stroke, 18px, lucide aesthetic. Embedded
  // directly so the editor stays a self-contained file with no icon-font
  // or runtime dependency. `currentColor` lets the toolbar's text colour
  // (and the coral pill's white text) cascade in cleanly.
  const ICONS = {
    edit:
      '<svg class="wfpe-icon" viewBox="0 0 24 24" aria-hidden="true">' +
      '<path d="M12 20h9" />' +
      '<path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />' +
      '</svg>',
    export:
      '<svg class="wfpe-icon" viewBox="0 0 24 24" aria-hidden="true">' +
      '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />' +
      '<polyline points="7 10 12 15 17 10" />' +
      '<line x1="12" y1="15" x2="12" y2="3" />' +
      '</svg>',
    handoff:
      '<svg class="wfpe-icon" viewBox="0 0 24 24" aria-hidden="true">' +
      '<path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z" />' +
      '<path d="M8 9h8" />' +
      '<path d="M8 13h5" />' +
      '</svg>',
    undo:
      '<svg class="wfpe-icon" viewBox="0 0 24 24" aria-hidden="true">' +
      '<path d="M9 14 4 9l5-5" />' +
      '<path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5v0a5.5 5.5 0 0 1-5.5 5.5H11" />' +
      '</svg>',
    redo:
      '<svg class="wfpe-icon" viewBox="0 0 24 24" aria-hidden="true">' +
      '<path d="m15 14 5-5-5-5" />' +
      '<path d="M20 9H9.5A5.5 5.5 0 0 0 4 14.5v0A5.5 5.5 0 0 0 9.5 20H13" />' +
      '</svg>',
    // Chevron-up: shown on the inspector header when expanded (click → minimise)
    chevronUp:
      '<svg class="wfpe-icon" viewBox="0 0 24 24" aria-hidden="true">' +
      '<polyline points="18 15 12 9 6 15" />' +
      '</svg>',
    // Chevron-down: shown on the inspector header when minimised (click → expand)
    chevronDown:
      '<svg class="wfpe-icon" viewBox="0 0 24 24" aria-hidden="true">' +
      '<polyline points="6 9 12 15 18 9" />' +
      '</svg>',
    // Counter-clockwise refresh — paired with "Reset" in the inspector.
    refresh:
      '<svg class="wfpe-icon" viewBox="0 0 24 24" aria-hidden="true">' +
      '<polyline points="1 4 1 10 7 10" />' +
      '<path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />' +
      '</svg>',
    // Copy — paired with the inspector Duplicate action.
    copy:
      '<svg class="wfpe-icon" viewBox="0 0 24 24" aria-hidden="true">' +
      '<rect x="8" y="8" width="12" height="12" rx="2" />' +
      '<path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" />' +
      '</svg>',
    trash:
      '<svg class="wfpe-icon" viewBox="0 0 24 24" aria-hidden="true">' +
      '<path d="M3 6h18" />' +
      '<path d="M8 6V4h8v2" />' +
      '<path d="M19 6l-1 14H6L5 6" />' +
      '<path d="M10 11v5" />' +
      '<path d="M14 11v5" />' +
      '</svg>',
    // 2x2 grid — Overview toolbar button (v2.1.0).
    overview:
      '<svg class="wfpe-icon" viewBox="0 0 24 24" aria-hidden="true">' +
      '<rect x="3" y="3" width="7" height="7" rx="1" />' +
      '<rect x="14" y="3" width="7" height="7" rx="1" />' +
      '<rect x="3" y="14" width="7" height="7" rx="1" />' +
      '<rect x="14" y="14" width="7" height="7" rx="1" />' +
      '</svg>',
    // Small × — overview thumbnail delete button (v2.1.4). No wfpe-icon
    // class here because the delete button stamps its own size via CSS
    // (10px) rather than the toolbar's 18px.
    closeSmall:
      '<svg viewBox="0 0 24 24" aria-hidden="true">' +
      '<path d="M18 6 6 18" />' +
      '<path d="m6 6 12 12" />' +
      '</svg>',
  };

  const toolbar = document.createElement('div');
  toolbar.className = 'wfpe-toolbar';
  toolbar.dataset.mode = 'off';

  // The mode badge IS the Edit toggle. Label is the constant "Edit"; the
  // active state is signalled by data-mode (peach fill) rather than by
  // text mutation.
  const badge = document.createElement('button');
  badge.type = 'button';
  badge.className = 'wfpe-mode-badge';
  badge.dataset.mode = 'off';
  badge.dataset.action = 'edit';
  badge.title = 'Toggle edit mode (E)';
  badge.innerHTML = ICONS.edit + '<span class="wfpe-mode-label">Edit</span>';
  toolbar.appendChild(badge);

  function makeToolbarButton(action, label, hint, iconKey) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'wfpe-toolbar-btn';
    b.dataset.action = action;
    b.title = hint;
    b.innerHTML = ICONS[iconKey] + `<span>${label}</span>`;
    return b;
  }

  // v2.1.0 — Overview button sits between Edit and the action triplet.
  // Edit + Overview are mode toggles; Export/Undo/Redo are actions. Keeping
  // the two mode controls adjacent reads cleanly in the toolbar.
  const overviewBtn = makeToolbarButton('overview', 'Overview', 'Overview (O)', 'overview');
  overviewBtn.dataset.mode = 'off';
  const exportBtn = makeToolbarButton('export', 'Export', 'Export (Cmd/Ctrl+S)', 'export');
  const handoffBtn = makeToolbarButton('handoff', 'Handoff', 'Add an Agent note to enable handoff export', 'handoff');
  handoffBtn.disabled = true;
  handoffBtn.setAttribute('aria-disabled', 'true');
  const undoBtn = makeToolbarButton('undo', 'Undo', 'Undo (Cmd/Ctrl+Z)', 'undo');
  const redoBtn = makeToolbarButton('redo', 'Redo', 'Redo (Cmd/Ctrl+Shift+Z)', 'redo');
  toolbar.appendChild(overviewBtn);
  toolbar.appendChild(exportBtn);
  toolbar.appendChild(handoffBtn);
  toolbar.appendChild(undoBtn);
  toolbar.appendChild(redoBtn);

  root.appendChild(toolbar);

  // Inspector panel (v2.1 scaffold). Hidden by default; shown when an
  // element is selected. The body is intentionally empty in v2.1 — phases
  // v2.2-v2.6 plug in the position/size/font/colour/reset controls.
  const inspector = document.createElement('div');
  inspector.className = 'wfpe-inspector';
  inspector.dataset.visible = 'false';
  inspector.dataset.state = 'expanded';

  const inspectorHeader = document.createElement('div');
  inspectorHeader.className = 'wfpe-inspector-header';

  const inspectorTitle = document.createElement('span');
  inspectorTitle.className = 'wfpe-inspector-title';
  inspectorTitle.textContent = 'Inspector';
  inspectorHeader.appendChild(inspectorTitle);

  const inspectorMinimiseBtn = document.createElement('button');
  inspectorMinimiseBtn.type = 'button';
  inspectorMinimiseBtn.className = 'wfpe-inspector-minimise';
  inspectorMinimiseBtn.dataset.action = 'minimise';
  inspectorMinimiseBtn.title = 'Minimise';
  inspectorMinimiseBtn.setAttribute('aria-label', 'Minimise inspector');
  inspectorMinimiseBtn.innerHTML = ICONS.chevronUp;
  inspectorHeader.appendChild(inspectorMinimiseBtn);

  inspector.appendChild(inspectorHeader);

  const inspectorBody = document.createElement('div');
  inspectorBody.className = 'wfpe-inspector-body';
  inspector.appendChild(inspectorBody);

  // Position + size rows (v2.2). Each input commits on Enter or blur and
  // produces one history entry via the txn machinery; live drag/resize
  // updates the readouts but does not commit (the drag itself owns the
  // history entry).
  function makeInspectorField(prop, axis) {
    const wrap = document.createElement('label');
    wrap.className = 'wfpe-inspector-field';
    const ax = document.createElement('span');
    ax.className = 'wfpe-inspector-field-axis';
    ax.textContent = axis;
    wrap.appendChild(ax);
    const input = document.createElement('input');
    input.type = 'number';
    input.dataset.wfpeProp = prop;
    input.inputMode = 'numeric';
    input.autocomplete = 'off';
    input.spellcheck = false;
    wrap.appendChild(input);
    return { wrap, input };
  }

  function makeInspectorRow(label, fields) {
    const row = document.createElement('div');
    row.className = 'wfpe-inspector-row';
    const lab = document.createElement('span');
    lab.className = 'wfpe-inspector-row-label';
    lab.textContent = label;
    row.appendChild(lab);
    const pair = document.createElement('div');
    pair.className = 'wfpe-inspector-pair';
    for (const f of fields) pair.appendChild(f.wrap);
    row.appendChild(pair);
    return row;
  }

  const fieldX = makeInspectorField('x', 'X');
  const fieldY = makeInspectorField('y', 'Y');
  const fieldW = makeInspectorField('w', 'W');
  const fieldH = makeInspectorField('h', 'H');
  const inspectorInputs = {
    x: fieldX.input,
    y: fieldY.input,
    w: fieldW.input,
    h: fieldH.input,
    fontSize: null, // assigned after the font-size row is built below
    opacity: null, // assigned after the opacity row is built below
  };

  // Font-size row (v2.3): label on its own line, then a single control
  // sub-row [input·px][−][slider][+]. Renders only for text-bearing
  // elements. History contract: input commit (Enter/blur) = one entry,
  // ± click = one entry, slider drag (mousedown→mouseup) = one entry.
  const fontSizeRow = document.createElement('div');
  fontSizeRow.className = 'wfpe-inspector-row';
  fontSizeRow.dataset.wfpeRow = 'font-size';

  const fontSizeRowLabel = document.createElement('span');
  fontSizeRowLabel.className = 'wfpe-inspector-row-label';
  fontSizeRowLabel.textContent = 'Font size';
  fontSizeRow.appendChild(fontSizeRowLabel);

  const fontControl = document.createElement('div');
  fontControl.className = 'wfpe-font-control';

  const fieldFontSize = makeInspectorField('fontSize', '');
  // The font-size input has no axis label — the row label says "Font size".
  fieldFontSize.wrap.querySelector('.wfpe-inspector-field-axis').remove();
  fieldFontSize.input.min = String(FONT_SIZE_MIN_PX);
  const fontUnit = document.createElement('span');
  fontUnit.className = 'wfpe-font-unit';
  fontUnit.textContent = 'px';
  fieldFontSize.wrap.appendChild(fontUnit);
  fontControl.appendChild(fieldFontSize.wrap);

  const fontMinusBtn = document.createElement('button');
  fontMinusBtn.type = 'button';
  fontMinusBtn.className = 'wfpe-font-btn';
  fontMinusBtn.dataset.action = 'font-minus';
  fontMinusBtn.title = 'Decrease font size';
  fontMinusBtn.setAttribute('aria-label', 'Decrease font size');
  fontMinusBtn.textContent = '−';
  fontControl.appendChild(fontMinusBtn);

  const fontSlider = document.createElement('input');
  fontSlider.type = 'range';
  fontSlider.className = 'wfpe-font-slider';
  fontSlider.dataset.wfpeProp = 'fontSizeSlider';
  fontSlider.min = String(FONT_SIZE_MIN_PX);
  // Cap somewhere generous but bounded — v1 has no max for the keyboard
  // nudge, but the slider needs a finite range. 200px covers any
  // realistic display heading size.
  fontSlider.max = '200';
  fontSlider.step = '1';
  fontControl.appendChild(fontSlider);

  const fontPlusBtn = document.createElement('button');
  fontPlusBtn.type = 'button';
  fontPlusBtn.className = 'wfpe-font-btn';
  fontPlusBtn.dataset.action = 'font-plus';
  fontPlusBtn.title = 'Increase font size';
  fontPlusBtn.setAttribute('aria-label', 'Increase font size');
  fontPlusBtn.textContent = '+';
  fontControl.appendChild(fontPlusBtn);

  fontSizeRow.appendChild(fontControl);
  inspectorBody.appendChild(fontSizeRow);
  inspectorInputs.fontSize = fieldFontSize.input;

  inspectorBody.appendChild(makeInspectorRow('Position', [fieldX, fieldY]));
  inspectorBody.appendChild(makeInspectorRow('Size', [fieldW, fieldH]));

  // Colour rows (v2.4). Text colour for text-bearing only; background
  // colour for any selection. Each row composes a swatch (clickable
  // trigger for the hidden native picker), a hex text input, and — for
  // background only — a "transparent" clear button.
  function makeColourRow({ label, target, prop, includeClear }) {
    const row = document.createElement('div');
    row.className = 'wfpe-inspector-row';
    row.dataset.wfpeRow = target === 'text' ? 'text-color' : 'bg-color';

    const lab = document.createElement('span');
    lab.className = 'wfpe-inspector-row-label';
    lab.textContent = label;
    row.appendChild(lab);

    const control = document.createElement('div');
    control.className = 'wfpe-color-control';

    const swatch = document.createElement('button');
    swatch.type = 'button';
    swatch.className = 'wfpe-color-swatch';
    swatch.dataset.wfpeTarget = target;
    swatch.title = `${label} — pick`;

    // Native colour picker behind the swatch. The swatch's own click
    // triggers the picker programmatically; the picker itself is
    // pointer-events: none so the swatch wins the click.
    const colorInput = document.createElement('input');
    colorInput.type = 'color';
    colorInput.dataset.wfpeTarget = target;
    swatch.appendChild(colorInput);
    control.appendChild(swatch);

    const hexField = document.createElement('label');
    hexField.className = 'wfpe-inspector-field';
    const hexInput = document.createElement('input');
    hexInput.type = 'text';
    hexInput.dataset.wfpeProp = prop;
    hexInput.spellcheck = false;
    hexInput.autocomplete = 'off';
    hexInput.style.width = '64px';
    hexField.appendChild(hexInput);
    control.appendChild(hexField);

    let clearBtn = null;
    if (includeClear) {
      clearBtn = document.createElement('button');
      clearBtn.type = 'button';
      clearBtn.className = 'wfpe-color-clear';
      clearBtn.dataset.wfpeTarget = target;
      clearBtn.title = 'Clear (transparent)';
      clearBtn.setAttribute('aria-label', 'Clear background colour');
      clearBtn.textContent = '×';
      control.appendChild(clearBtn);
    }

    row.appendChild(control);
    return { row, swatch, colorInput, hexInput, clearBtn };
  }

  const textColourRow = makeColourRow({
    label: 'Text colour',
    target: 'text',
    prop: 'textColorHex',
    includeClear: false,
  });
  const bgColourRow = makeColourRow({
    label: 'Background',
    target: 'bg',
    prop: 'bgColorHex',
    includeClear: true,
  });
  inspectorBody.appendChild(textColourRow.row);
  inspectorBody.appendChild(bgColourRow.row);

  // Opacity row (v2.9). Renders for every selection. Layout matches the
  // font-size row: label on its own line, then [input·%][slider]. No
  // ± stepper buttons — opacity has a bounded 0–100 range so the slider
  // is the primary control, with the input for keyboard precision.
  // History contract: input commit (Enter/blur) = one entry, slider
  // drag (mousedown→mouseup) = one entry.
  const opacityRow = document.createElement('div');
  opacityRow.className = 'wfpe-inspector-row';
  opacityRow.dataset.wfpeRow = 'opacity';

  const opacityRowLabel = document.createElement('span');
  opacityRowLabel.className = 'wfpe-inspector-row-label';
  opacityRowLabel.textContent = 'Opacity';
  opacityRow.appendChild(opacityRowLabel);

  const opacityControl = document.createElement('div');
  opacityControl.className = 'wfpe-opacity-control';

  const fieldOpacity = makeInspectorField('opacity', '');
  fieldOpacity.wrap.querySelector('.wfpe-inspector-field-axis').remove();
  fieldOpacity.input.min = '0';
  fieldOpacity.input.max = '100';
  const opacityUnit = document.createElement('span');
  opacityUnit.className = 'wfpe-opacity-unit';
  opacityUnit.textContent = '%';
  fieldOpacity.wrap.appendChild(opacityUnit);
  opacityControl.appendChild(fieldOpacity.wrap);

  const opacitySlider = document.createElement('input');
  opacitySlider.type = 'range';
  opacitySlider.className = 'wfpe-font-slider';
  opacitySlider.dataset.wfpeProp = 'opacitySlider';
  opacitySlider.min = '0';
  opacitySlider.max = '100';
  opacitySlider.step = '1';
  opacityControl.appendChild(opacitySlider);

  opacityRow.appendChild(opacityControl);
  inspectorBody.appendChild(opacityRow);
  inspectorInputs.opacity = fieldOpacity.input;

  const annotationRow = document.createElement('div');
  annotationRow.className = 'wfpe-inspector-row';
  annotationRow.dataset.wfpeRow = 'annotation';

  const annotationLabel = document.createElement('span');
  annotationLabel.className = 'wfpe-inspector-row-label';
  annotationLabel.textContent = 'Agent note';
  annotationRow.appendChild(annotationLabel);

  const annotationTextarea = document.createElement('textarea');
  annotationTextarea.className = 'wfpe-annotation-textarea';
  annotationTextarea.dataset.wfpeProp = 'annotation';
  annotationTextarea.placeholder = 'Instruction for agent cleanup';
  annotationTextarea.spellcheck = true;
  annotationRow.appendChild(annotationTextarea);

  const annotationActions = document.createElement('div');
  annotationActions.className = 'wfpe-annotation-actions';

  const annotationStatus = document.createElement('span');
  annotationStatus.className = 'wfpe-annotation-status';
  annotationActions.appendChild(annotationStatus);

  const annotationDeleteBtn = document.createElement('button');
  annotationDeleteBtn.type = 'button';
  annotationDeleteBtn.className = 'wfpe-annotation-delete-btn';
  annotationDeleteBtn.dataset.action = 'delete-annotation';
  annotationDeleteBtn.textContent = 'Delete';
  annotationDeleteBtn.title = 'Delete agent note';
  annotationActions.appendChild(annotationDeleteBtn);

  const annotationSaveBtn = document.createElement('button');
  annotationSaveBtn.type = 'button';
  annotationSaveBtn.className = 'wfpe-annotation-save-btn';
  annotationSaveBtn.dataset.action = 'save-annotation';
  annotationSaveBtn.textContent = 'Save';
  annotationSaveBtn.title = 'Save agent note';
  annotationActions.appendChild(annotationSaveBtn);

  annotationRow.appendChild(annotationActions);
  inspectorBody.appendChild(annotationRow);

  // Element action row. Duplicate/delete/reset live together to avoid
  // growing the inspector vertically as structural actions are added.
  const actionRow = document.createElement('div');
  actionRow.className = 'wfpe-inspector-row';
  actionRow.dataset.wfpeRow = 'actions';
  const duplicateBtn = document.createElement('button');
  duplicateBtn.type = 'button';
  duplicateBtn.className = 'wfpe-duplicate-btn';
  duplicateBtn.dataset.action = 'duplicate-element';
  duplicateBtn.innerHTML = ICONS.copy + '<span>Duplicate</span>';
  duplicateBtn.title = 'Duplicate selected element';
  actionRow.appendChild(duplicateBtn);

  const deleteBtn = document.createElement('button');
  deleteBtn.type = 'button';
  deleteBtn.className = 'wfpe-delete-btn';
  deleteBtn.dataset.action = 'delete-element';
  deleteBtn.innerHTML = ICONS.trash + '<span>Delete</span>';
  deleteBtn.title = 'Delete selected element';
  actionRow.appendChild(deleteBtn);

  // Reset action (v2.5). Clears the selected element's entire inline style
  // attribute as one history entry, returning it to its stylesheet-
  // defined rendering. No-op (no history entry) if the element has no
  // inline style to clear.
  const resetBtn = document.createElement('button');
  resetBtn.type = 'button';
  resetBtn.className = 'wfpe-reset-btn';
  resetBtn.dataset.action = 'reset-styles';
  resetBtn.innerHTML = ICONS.refresh + '<span>Reset</span>';
  resetBtn.title = 'Clear all inline style overrides on the selected element';
  actionRow.appendChild(resetBtn);
  inspectorBody.appendChild(actionRow);

  root.appendChild(inspector);

  // Dimension bubble (v2.2): floating "W × H" chip above the selection
  // ring. Tracks the same lifecycle as the ring.
  const dimBubble = document.createElement('div');
  dimBubble.className = 'wfpe-dim-bubble';
  root.appendChild(dimBubble);

  const annotationLayer = document.createElement('div');
  annotationLayer.className = 'wfpe-annotation-layer';
  root.appendChild(annotationLayer);

  const multiBox = document.createElement('div');
  multiBox.className = 'wfpe-multi-box';
  root.appendChild(multiBox);

  const multiOutlineLayer = document.createElement('div');
  multiOutlineLayer.className = 'wfpe-multi-outline-layer';
  root.appendChild(multiOutlineLayer);

  // Overview overlay (v2.1.1) — chrome layer rendered above the deck while
  // overview mode is active. Holds one .wfpe-overview-thumb per slide,
  // each anchored to the slide's getBoundingClientRect with a number
  // badge and (when relevant) the active-slide highlight. Empty + hidden
  // outside overview mode.
  const overviewOverlay = document.createElement('div');
  overviewOverlay.className = 'wfpe-overview-overlay';
  overviewOverlay.dataset.visible = 'false';
  root.appendChild(overviewOverlay);

  // Drop indicator (v2.1.3) — thin vertical bar shown between thumbs
  // during drag, marking where the dragged slide will land on drop.
  const overviewDropIndicator = document.createElement('div');
  overviewDropIndicator.className = 'wfpe-overview-drop-indicator';
  overviewDropIndicator.dataset.visible = 'false';
  root.appendChild(overviewDropIndicator);

  const ring = document.createElement('div');
  ring.className = 'wfpe-selection-ring';
  ring.style.display = 'none';
  root.appendChild(ring);

  const handles = {};
  for (const dir of HANDLE_DIRS) {
    const h = document.createElement('div');
    h.className = `wfpe-handle wfpe-handle-${dir}`;
    h.dataset.wfpeHandle = dir;
    h.style.cursor = HANDLE_CURSORS[dir];
    h.style.display = 'none';
    root.appendChild(h);
    handles[dir] = h;
  }

  document.body.appendChild(root);

  // Toolbar button click handlers. These run in bubble phase after the
  // capture-phase onClick short-circuits on editor-root targets, so they
  // don't interfere with selection/deselection logic.
  badge.addEventListener('click', (e) => {
    e.preventDefault();
    setEditMode(!state.editMode);
  });
  undoBtn.addEventListener('click', (e) => {
    e.preventDefault();
    undo();
  });
  redoBtn.addEventListener('click', (e) => {
    e.preventDefault();
    redo();
  });
  exportBtn.addEventListener('click', (e) => {
    e.preventDefault();
    exportHTML();
  });
  handoffBtn.addEventListener('click', (e) => {
    e.preventDefault();
    if (handoffBtn.disabled) return;
    exportHandoffHTML();
  });
  overviewBtn.addEventListener('click', (e) => {
    e.preventDefault();
    if (isFlatMode()) return;
    setOverviewMode(!state.overviewMode);
  });
  inspectorMinimiseBtn.addEventListener('click', (e) => {
    e.preventDefault();
    setInspectorMinimised(!state.inspectorMinimised);
  });

  // Input commit on Enter / blur. Per-keystroke updates are deliberately
  // not wired — they would either flood the history or require batching
  // on every change. Enter and blur are the natural commit points.
  //
  // Each input snapshots `state.selected` at focus-time on its own dataset
  // so the deferred commit on blur targets the element the user was
  // actually editing — not whichever element happens to be selected by
  // the time blur fires (a mousedown on a different slide element runs
  // setSelected before the prior input's blur dispatches).
  let revertingInput = null;
  for (const [prop, input] of Object.entries(inspectorInputs)) {
    input.addEventListener('focus', () => {
      input.__wfpeFocusTarget = state.selected || null;
    });
    input.addEventListener('keydown', (e) => {
      // Stop propagation so editor-level shortcuts (E toggle, arrow nudge,
      // Cmd+Z, etc.) don't fire while typing in the inspector.
      e.stopPropagation();
      if (e.key === 'Enter') {
        e.preventDefault();
        commitInspectorInput(prop, input.value, input.__wfpeFocusTarget);
        input.blur();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        // Revert by repopulating from the live element, then blur. The
        // revertingInput flag suppresses the blur's commit so the no-op
        // path stays explicit rather than implicit-via-equality.
        revertingInput = input;
        populateInspector(state.selected);
        input.blur();
      }
    });
    input.addEventListener('blur', () => {
      const target = input.__wfpeFocusTarget;
      input.__wfpeFocusTarget = null;
      if (revertingInput === input) {
        revertingInput = null;
        return;
      }
      commitInspectorInput(prop, input.value, target);
    });
  }

  // Font-size slider — one history entry per drag (mousedown→mouseup).
  // Uses the inspector-txn isolation helpers so a slider drag during
  // an open text-edit produces its own entry, separate from the typing.
  let fontSliderTarget = null;
  let fontSliderRestoreCtx = null;
  fontSlider.addEventListener('mousedown', () => {
    const el = state.selected;
    if (!el || !isTextBearing(el)) return;
    fontSliderTarget = el;
    fontSliderRestoreCtx = startInspectorTxn();
    touchElement(el);
  });
  fontSlider.addEventListener('input', () => {
    // Bail if the slider is being driven without an open drag (e.g. by
    // assistive tech keyboard navigation that didn't fire mousedown).
    // The mousedown→mouseup bracket owns the txn; firing input outside
    // it would create a per-tick history entry instead of one-per-drag.
    if (!fontSliderTarget) return;
    const el = fontSliderTarget;
    if (!isTextBearing(el)) return;
    const v = Math.max(FONT_SIZE_MIN_PX, parseFloat(fontSlider.value) || FONT_SIZE_MIN_PX);
    el.style.fontSize = `${v}px`;
    populateFontSize(el);
  });
  // Both mouseup (mouse drag) and change (keyboard / touch end) can end
  // the drag; both close the inspector txn (which restores the text-
  // edit txn if one was active). Idempotent on a no-op drag.
  const endSliderDrag = () => {
    if (!fontSliderTarget) return;
    fontSliderTarget = null;
    const ctx = fontSliderRestoreCtx;
    fontSliderRestoreCtx = null;
    endInspectorTxn(ctx);
  };
  fontSlider.addEventListener('mouseup', endSliderDrag);
  fontSlider.addEventListener('change', endSliderDrag);
  fontSlider.addEventListener('keydown', (e) => e.stopPropagation());

  // Opacity slider — same one-entry-per-drag contract as font-size.
  let opacitySliderTarget = null;
  let opacitySliderRestoreCtx = null;
  opacitySlider.addEventListener('mousedown', () => {
    const el = state.selected;
    if (!el) return;
    opacitySliderTarget = el;
    opacitySliderRestoreCtx = startInspectorTxn();
    touchElement(el);
  });
  opacitySlider.addEventListener('input', () => {
    if (!opacitySliderTarget) return;
    const el = opacitySliderTarget;
    const pct = Math.max(0, Math.min(100, parseFloat(opacitySlider.value)));
    el.style.opacity = String(pct / 100);
    populateOpacity(el);
  });
  const endOpacityDrag = () => {
    if (!opacitySliderTarget) return;
    opacitySliderTarget = null;
    const ctx = opacitySliderRestoreCtx;
    opacitySliderRestoreCtx = null;
    endInspectorTxn(ctx);
  };
  opacitySlider.addEventListener('mouseup', endOpacityDrag);
  opacitySlider.addEventListener('change', endOpacityDrag);
  opacitySlider.addEventListener('keydown', (e) => e.stopPropagation());

  // ± buttons — one history entry per click.
  fontMinusBtn.addEventListener('click', (e) => {
    e.preventDefault();
    nudgeFontSizeWithHistory(-1);
  });
  fontPlusBtn.addEventListener('click', (e) => {
    e.preventDefault();
    nudgeFontSizeWithHistory(+1);
  });

  // ----- Colour controls (v2.4) -----
  // Swatch click programmatically opens the hidden native picker.
  // Picker `input` events apply live within an open isolation context;
  // `change` closes it so a full pick session = one history entry.
  // The isolation context also keeps the entry distinct from any
  // open text-edit (v2.6). The `open` flag is the session sentinel —
  // `restoreCtx` itself can legitimately be null (no text-edit to
  // restore), so we can't reuse null as "no session in progress".
  const pickerSession = {
    text: { open: false, restoreCtx: null, inlineSpan: null },
    bg: { open: false, restoreCtx: null, inlineSpan: null },
  };
  function wireColourRow({ swatch, colorInput, hexInput, clearBtn }, target) {
    // The native colour input sits over the swatch as the actual click
    // target (pointer-events: auto, opacity: 0). No swatch-level click
    // handler — letting the browser open the picker on a real user click
    // is more reliable than calling .click() programmatically.
    colorInput.addEventListener('input', () => {
      const el = state.selected;
      if (!el) return;
      if (target === 'text' && !isTextBearing(el)) return;
      const norm = parseHexInput(colorInput.value);
      if (!norm) return;
      const textRange = target === 'text' && state.editingText && state.editingText.el === el
        ? getTextColourRange(el)
        : null;
      if (!pickerSession[target].open) {
        pickerSession[target].open = true;
        pickerSession[target].inlineSpan = null;
        pickerSession[target].restoreCtx = startInspectorTxn({ captureHtml: !!textRange });
        touchElement(el);
      }
      if (target === 'text' && state.editingText && state.editingText.el === el) {
        pickerSession[target].inlineSpan = applyTextColourToRange(el, norm, pickerSession[target].inlineSpan);
      } else {
        applyColorToElement(el, target, norm);
      }
      populateColours(el);
    });
    colorInput.addEventListener('change', () => {
      if (!pickerSession[target].open) return;
      const ctx = pickerSession[target].restoreCtx;
      pickerSession[target].open = false;
      pickerSession[target].restoreCtx = null;
      pickerSession[target].inlineSpan = null;
      endInspectorTxn(ctx);
    });
    hexInput.addEventListener('focus', () => {
      hexInput.__wfpeFocusTarget = state.selected || null;
      hexInput.__wfpeDirty = false;
    });
    hexInput.addEventListener('input', () => {
      hexInput.__wfpeDirty = true;
    });
    hexInput.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        e.preventDefault();
        if (hexInput.__wfpeDirty) commitColourHex(target, hexInput.value, hexInput.__wfpeFocusTarget);
        hexInput.__wfpeSkipNextBlurCommit = true;
        hexInput.blur();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        revertingInput = hexInput;
        populateColours(state.selected);
        hexInput.blur();
      }
    });
    hexInput.addEventListener('blur', () => {
      const targetEl = hexInput.__wfpeFocusTarget;
      hexInput.__wfpeFocusTarget = null;
      if (hexInput.__wfpeSkipNextBlurCommit) {
        hexInput.__wfpeSkipNextBlurCommit = false;
        return;
      }
      if (revertingInput === hexInput) { revertingInput = null; return; }
      if (!hexInput.__wfpeDirty) return;
      commitColourHex(target, hexInput.value, targetEl);
    });
    if (clearBtn) {
      clearBtn.addEventListener('click', (e) => {
        e.preventDefault();
        const el = state.selected;
        if (!el) return;
        // Only meaningful if there's an inline colour to clear.
        const cssProp = target === 'text' ? 'color' : 'backgroundColor';
        if (!el.style[cssProp]) return;
        const ctx = startInspectorTxn();
        touchElement(el);
        el.style[cssProp] = '';
        endInspectorTxn(ctx);
        populateColours(el);
      });
    }
  }
  wireColourRow(textColourRow, 'text');
  wireColourRow(bgColourRow, 'bg');

  annotationTextarea.addEventListener('focus', () => {
    annotationTextarea.__wfpeFocusTarget = state.selected || null;
  });
  annotationTextarea.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Escape') {
      e.preventDefault();
      populateAnnotation(state.selected, { force: true });
      annotationTextarea.blur();
    }
  });
  annotationSaveBtn.addEventListener('click', (e) => {
    e.preventDefault();
    saveAnnotation(getAnnotationEditorTarget(), annotationTextarea.value);
  });
  annotationTextarea.addEventListener('input', () => {
    updateAnnotationDraftStatus(getAnnotationEditorTarget());
  });
  annotationDeleteBtn.addEventListener('click', (e) => {
    e.preventDefault();
    deleteAnnotation(getAnnotationEditorTarget());
  });
  annotationLayer.addEventListener('click', (e) => {
    const badgeEl = e.target && e.target.closest ? e.target.closest('.wfpe-annotation-badge') : null;
    if (!badgeEl) return;
    e.preventDefault();
    e.stopPropagation();
    const target = findAnnotationElementById(badgeEl.dataset.annotationId || '');
    if (!target) return;
    setEditMode(true);
    setSelected(target);
    refreshSelection();
    refreshInspector();
  });

  // Reset clears the entire inline style attribute as one history entry.
  // Bail when there's nothing to clear so an idle click can't push a
  // no-op entry. The snapshot/endTxn pair captures and restores the
  // attribute via the existing snapshot machinery.
  resetBtn.addEventListener('click', (e) => {
    e.preventDefault();
    const el = state.selected;
    if (!el) return;
    if (!el.hasAttribute('style')) return; // nothing to reset
    const ctx = startInspectorTxn();
    touchElement(el);
    el.removeAttribute('style');
    endInspectorTxn(ctx);
    refreshSelection();
  });
  duplicateBtn.addEventListener('click', (e) => {
    e.preventDefault();
    duplicateSelected();
  });
  deleteBtn.addEventListener('click', (e) => {
    e.preventDefault();
    deleteSelectedElement();
  });
  applyModeFeatureGating();
  reimportHandoffAnnotations();
  refreshHandoffButton();
