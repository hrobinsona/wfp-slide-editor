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
    // Chevron-up: inspector minimise control. CSS rotates it 180° in the
    // minimised state (ink-glass 3b) — no swap to a down variant.
    chevronUp:
      '<svg class="wfpe-icon" viewBox="0 0 24 24" aria-hidden="true">' +
      '<polyline points="18 15 12 9 6 15" />' +
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
    // Chevron-right: toolbar collapse control (ink-glass 3b). CSS rotates
    // it 180° while the bar is collapsed — no innerHTML swapping.
    chevronRight:
      '<svg class="wfpe-icon" viewBox="0 0 24 24" aria-hidden="true">' +
      '<polyline points="9 18 15 12 9 6" />' +
      '</svg>',
    // Text-align triplet — inspector Align segmented control (ink-glass 3b).
    alignLeft:
      '<svg class="wfpe-icon" viewBox="0 0 24 24" aria-hidden="true">' +
      '<line x1="3" y1="6" x2="21" y2="6" />' +
      '<line x1="3" y1="12" x2="15" y2="12" />' +
      '<line x1="3" y1="18" x2="17" y2="18" />' +
      '</svg>',
    alignCenter:
      '<svg class="wfpe-icon" viewBox="0 0 24 24" aria-hidden="true">' +
      '<line x1="3" y1="6" x2="21" y2="6" />' +
      '<line x1="6" y1="12" x2="18" y2="12" />' +
      '<line x1="5" y1="18" x2="19" y2="18" />' +
      '</svg>',
    alignRight:
      '<svg class="wfpe-icon" viewBox="0 0 24 24" aria-hidden="true">' +
      '<line x1="3" y1="6" x2="21" y2="6" />' +
      '<line x1="9" y1="12" x2="21" y2="12" />' +
      '<line x1="7" y1="18" x2="21" y2="18" />' +
      '</svg>',
    // Small × — overview thumbnail delete button (v2.1.4). No wfpe-icon
    // class here because the delete button stamps its own size via CSS
    // (10px) rather than the toolbar's 18px.
    closeSmall:
      '<svg viewBox="0 0 24 24" aria-hidden="true">' +
      '<path d="M18 6 6 18" />' +
      '<path d="m6 6 12 12" />' +
      '</svg>',
    grip:
      '<svg viewBox="0 0 24 24" aria-hidden="true">' +
      '<circle cx="8" cy="7" r="1.5" />' +
      '<circle cx="16" cy="7" r="1.5" />' +
      '<circle cx="8" cy="12" r="1.5" />' +
      '<circle cx="16" cy="12" r="1.5" />' +
      '<circle cx="8" cy="17" r="1.5" />' +
      '<circle cx="16" cy="17" r="1.5" />' +
      '</svg>',
    // Stacked-planes glyph — paired with the inspector Front action (v2.17,
    // bring to front). A diamond over a single chevron reads unambiguously
    // as "layers" with fill: none; two overlapping rects (the original
    // v2.17 icon) crossed their strokes in the overlap zone and read as a
    // hash mark instead (code review, v2.17.1).
    layers:
      '<svg class="wfpe-icon" viewBox="0 0 24 24" aria-hidden="true">' +
      '<polygon points="12 2 3 7 12 12 21 7 12 2" />' +
      '<polyline points="3 12 12 17 21 12" />' +
      '</svg>',
  };

  const toolbar = document.createElement('div');
  toolbar.className = 'wfpe-toolbar';
  toolbar.dataset.mode = 'off';
  toolbar.dataset.docked = 'false';
  toolbar.dataset.collapsed = 'false';

  // The mode badge IS the Edit toggle. Icon-only (ink-glass 3b); the
  // active state is signalled by data-mode (coral fill). title/aria-label
  // carry the text the removed label span used to provide.
  const badge = document.createElement('button');
  badge.type = 'button';
  badge.className = 'wfpe-mode-badge';
  badge.dataset.mode = 'off';
  badge.dataset.action = 'edit';
  badge.title = 'Toggle edit mode (E)';
  badge.setAttribute('aria-label', 'Toggle edit mode');
  badge.innerHTML = ICONS.edit;
  toolbar.appendChild(badge);

  function makeToolbarButton(action, label, hint, iconKey) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'wfpe-toolbar-btn';
    b.dataset.action = action;
    b.title = hint;
    b.setAttribute('aria-label', label);
    b.innerHTML = ICONS[iconKey];
    return b;
  }

  // v2.1.0 — Overview button sits between Edit and the action triplet.
  // Edit + Overview are mode toggles; Export/Undo/Redo are actions. Keeping
  // the two mode controls adjacent reads cleanly in the toolbar.
  const overviewBtn = makeToolbarButton('overview', 'Overview', 'Overview (O)', 'overview');
  overviewBtn.dataset.mode = 'off';
  const exportBtn = makeToolbarButton('export', 'Export', 'Export (Cmd/Ctrl+S)', 'export');
  // v2.11 — annotation-count badge; hidden at zero via CSS [data-count="0"].
  const exportBadge = document.createElement('span');
  exportBadge.className = 'wfpe-export-badge';
  exportBadge.dataset.count = '0';
  exportBadge.setAttribute('aria-hidden', 'true');
  exportBtn.appendChild(exportBadge);
  exportBtn.setAttribute('aria-haspopup', 'menu');
  exportBtn.setAttribute('aria-expanded', 'false');
  const undoBtn = makeToolbarButton('undo', 'Undo', 'Undo (Cmd/Ctrl+Z)', 'undo');
  const redoBtn = makeToolbarButton('redo', 'Redo', 'Redo (Cmd/Ctrl+Shift+Z)', 'redo');

  // Ink-glass 3b: Overview→Redo (+ trailing divider) fold away when the
  // bar collapses; Edit and the chevron stay. The fold wrapper animates
  // grid-template-columns 1fr↔0fr (see CSS) so the group visually
  // compresses instead of being clipped mid-icon.
  const toolbarFold = document.createElement('div');
  toolbarFold.className = 'wfpe-toolbar-fold';
  const toolbarFoldInner = document.createElement('div');
  toolbarFoldInner.className = 'wfpe-toolbar-fold-inner';
  toolbarFold.appendChild(toolbarFoldInner);
  toolbarFoldInner.appendChild(overviewBtn);
  toolbarFoldInner.appendChild(exportBtn);
  toolbarFoldInner.appendChild(undoBtn);
  toolbarFoldInner.appendChild(redoBtn);
  const toolbarDivider = document.createElement('div');
  toolbarDivider.className = 'wfpe-toolbar-divider';
  toolbarFoldInner.appendChild(toolbarDivider);
  toolbar.appendChild(toolbarFold);

  const toolbarCollapseBtn = document.createElement('button');
  toolbarCollapseBtn.type = 'button';
  toolbarCollapseBtn.className = 'wfpe-toolbar-collapse';
  toolbarCollapseBtn.dataset.action = 'toolbar-collapse';
  toolbarCollapseBtn.title = 'Collapse toolbar';
  toolbarCollapseBtn.setAttribute('aria-label', 'Collapse toolbar');
  toolbarCollapseBtn.innerHTML = ICONS.chevronRight;
  toolbar.appendChild(toolbarCollapseBtn);

  function setToolbarCollapsed(value) {
    state.toolbarCollapsed = !!value;
    toolbar.dataset.collapsed = state.toolbarCollapsed ? 'true' : 'false';
    const label = state.toolbarCollapsed ? 'Expand toolbar' : 'Collapse toolbar';
    toolbarCollapseBtn.title = label;
    toolbarCollapseBtn.setAttribute('aria-label', label);
  }

  // v2.11.2 — design 5b: toolbar, export-menu dock, and inspector dock are
  // segments of ONE fixed flex column (1px seam gaps). The menu docking in
  // as a middle segment makes the inspector's offset dynamic, which a
  // shared column handles for free — independently fixed elements can't.
  const stack = document.createElement('div');
  stack.className = 'wfpe-stack';
  stack.dataset.side = 'right';
  stack.appendChild(toolbar);
  root.appendChild(stack);

  // v2.11 — export action menu (design 4b rows, 5b docking). Grid-fold
  // segment under the toolbar; opened by the Export button. Row 1 is the
  // primary save action (Enter / Cmd+S), row 2 is the clean-copy download.
  const exportMenu = document.createElement('div');
  exportMenu.className = 'wfpe-export-menu';
  exportMenu.dataset.open = 'false';
  exportMenu.setAttribute('role', 'menu');
  function makeExportMenuItem(action, iconKey) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'wfpe-export-menu-item';
    b.dataset.action = action;
    b.setAttribute('role', 'menuitem');
    b.innerHTML =
      `<span class="wfpe-export-menu-chip">${ICONS[iconKey]}</span>` +
      '<span class="wfpe-export-menu-text">' +
      '<span class="wfpe-export-menu-label"></span>' +
      '<span class="wfpe-export-menu-sub"></span>' +
      '</span>';
    return b;
  }
  const exportPrimaryItem = makeExportMenuItem('save-in-place', 'handoff');
  const exportHintEl = document.createElement('span');
  exportHintEl.className = 'wfpe-export-menu-hint';
  exportHintEl.textContent = '↵';
  exportPrimaryItem.appendChild(exportHintEl);
  const exportCleanItem = makeExportMenuItem('clean-copy', 'export');
  exportMenu.appendChild(exportPrimaryItem);
  exportMenu.appendChild(exportCleanItem);
  // Middle segment of the stack: a grid-fold dock (0fr ↔ 1fr) identical in
  // mechanism to the inspector dock below, so the menu pushes the inspector
  // down with the same 380ms ease instead of overlaying it.
  const exportDock = document.createElement('div');
  exportDock.className = 'wfpe-export-dock';
  exportDock.dataset.visible = 'false';
  const exportDockInner = document.createElement('div');
  exportDockInner.className = 'wfpe-export-dock-inner';
  exportDockInner.appendChild(exportMenu);
  exportDock.appendChild(exportDockInner);
  stack.appendChild(exportDock);

  // Inspector panel. Ink-glass 3b docks it beneath the toolbar as the
  // second glass segment: an outer .wfpe-inspector-dock wrapper (fixed at
  // top: 53px = 16 + 36 bar + 1px seam) animates the whole segment open/
  // shut on select/deselect via grid-template-rows, replacing the old
  // display:none toggle on the panel itself. The panel's data-visible
  // attribute is kept in sync purely as a stable hook for tests.
  const inspectorDock = document.createElement('div');
  inspectorDock.className = 'wfpe-inspector-dock';
  inspectorDock.dataset.visible = 'false';
  // v2.18 — set by refreshInspector() from getSelectedElements().length > 1.
  // Gates the reduced multi-selection control surface in CSS (geometry
  // rows) and in the populate/gating JS below (typography, action row).
  inspectorDock.dataset.multi = 'false';
  const inspectorDockInner = document.createElement('div');
  inspectorDockInner.className = 'wfpe-inspector-dock-inner';
  inspectorDock.appendChild(inspectorDockInner);

  const inspector = document.createElement('div');
  inspector.className = 'wfpe-inspector';
  inspector.dataset.visible = 'false';
  inspector.dataset.state = 'expanded';
  inspector.dataset.avoidance = 'clear';
  inspector.dataset.revealed = 'false';

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
  // Single chevron; CSS rotates it 180° in the minimised state.
  inspectorMinimiseBtn.innerHTML = ICONS.chevronUp;
  inspectorHeader.appendChild(inspectorMinimiseBtn);

  inspector.appendChild(inspectorHeader);

  // Minimise folds the body via the same grid-rows trick as the dock,
  // leaving the 36px header as a capsule symmetric with the toolbar.
  const inspectorFold = document.createElement('div');
  inspectorFold.className = 'wfpe-inspector-fold';
  const inspectorFoldInner = document.createElement('div');
  inspectorFoldInner.className = 'wfpe-inspector-fold-inner';
  inspectorFold.appendChild(inspectorFoldInner);
  inspector.appendChild(inspectorFold);

  const inspectorBody = document.createElement('div');
  inspectorBody.className = 'wfpe-inspector-body';
  inspectorFoldInner.appendChild(inspectorBody);

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

  // Font row (v2.3, restyled for ink-glass 3b): a standard 66px-label
  // grid row with a −/field/+ stepper. Design 3b drops the slider.
  // Renders only for text-bearing elements. History contract: input
  // commit (Enter/blur) = one entry, ± click = one entry.
  const fontSizeRow = document.createElement('div');
  fontSizeRow.className = 'wfpe-inspector-row';
  fontSizeRow.dataset.wfpeRow = 'font-size';

  const fontSizeRowLabel = document.createElement('span');
  fontSizeRowLabel.className = 'wfpe-inspector-row-label';
  fontSizeRowLabel.textContent = 'Font';
  fontSizeRow.appendChild(fontSizeRowLabel);

  const fontControl = document.createElement('div');
  fontControl.className = 'wfpe-font-control';

  const fontMinusBtn = document.createElement('button');
  fontMinusBtn.type = 'button';
  fontMinusBtn.className = 'wfpe-font-btn';
  fontMinusBtn.dataset.action = 'font-minus';
  fontMinusBtn.title = 'Decrease font size';
  fontMinusBtn.setAttribute('aria-label', 'Decrease font size');
  fontMinusBtn.textContent = '−';
  fontControl.appendChild(fontMinusBtn);

  const fieldFontSize = makeInspectorField('fontSize', '');
  // The font-size input has no axis label — the row label says "Font".
  fieldFontSize.wrap.querySelector('.wfpe-inspector-field-axis').remove();
  fieldFontSize.input.min = String(FONT_SIZE_MIN_PX);
  const fontUnit = document.createElement('span');
  fontUnit.className = 'wfpe-font-unit';
  fontUnit.textContent = 'px';
  fieldFontSize.wrap.appendChild(fontUnit);
  fontControl.appendChild(fieldFontSize.wrap);

  const fontPlusBtn = document.createElement('button');
  fontPlusBtn.type = 'button';
  fontPlusBtn.className = 'wfpe-font-btn';
  fontPlusBtn.dataset.action = 'font-plus';
  fontPlusBtn.title = 'Increase font size';
  fontPlusBtn.setAttribute('aria-label', 'Increase font size');
  fontPlusBtn.textContent = '+';
  fontControl.appendChild(fontPlusBtn);

  fontSizeRow.appendChild(fontControl);
  inspectorInputs.fontSize = fieldFontSize.input;

  // Typography section (ink-glass 3b): Weight + Align segmented controls.
  // Both follow the font row's text-bearing visibility rule and commit
  // through the same inspector-txn path (one history entry per click).
  function makeSegRow(rowKey, label, items) {
    const row = document.createElement('div');
    row.className = 'wfpe-inspector-row';
    row.dataset.wfpeRow = rowKey;
    const lab = document.createElement('span');
    lab.className = 'wfpe-inspector-row-label';
    lab.textContent = label;
    row.appendChild(lab);
    const seg = document.createElement('div');
    seg.className = 'wfpe-seg';
    const buttons = items.map((item) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'wfpe-seg-item';
      b.dataset.action = item.action;
      b.dataset.wfpeValue = item.value;
      b.dataset.active = 'false';
      b.title = item.hint;
      b.setAttribute('aria-label', item.hint);
      if (item.iconKey) b.innerHTML = ICONS[item.iconKey];
      else b.textContent = item.label;
      seg.appendChild(b);
      return b;
    });
    row.appendChild(seg);
    return { row, buttons };
  }

  const weightRow = makeSegRow('font-weight', 'Weight', [
    { action: 'font-weight', value: '400', label: 'Reg', hint: 'Regular (400)' },
    { action: 'font-weight', value: '500', label: 'Med', hint: 'Medium (500)' },
    { action: 'font-weight', value: '700', label: 'Bold', hint: 'Bold (700)' },
  ]);
  const alignRow = makeSegRow('text-align', 'Align', [
    { action: 'text-align', value: 'left', iconKey: 'alignLeft', hint: 'Align left' },
    { action: 'text-align', value: 'center', iconKey: 'alignCenter', hint: 'Align center' },
    { action: 'text-align', value: 'right', iconKey: 'alignRight', hint: 'Align right' },
  ]);

  // Dividers bracket the typography section (Size ▸ | Font/Weight/Align | ▸
  // colours). They hide with the section for non-text selections so the
  // panel doesn't show a doubled rule.
  function makeInspectorDivider() {
    const d = document.createElement('div');
    d.className = 'wfpe-inspector-divider';
    return d;
  }
  const typographyDividerTop = makeInspectorDivider();
  const typographyDividerBottom = makeInspectorDivider();

  // v2.18 — data-wfpe-row identifies these for the [data-multi="true"] CSS
  // gate (20-dom-css.js): per-element X/Y/W/H is ambiguous for a set, so
  // they're hidden outright rather than showing shared-or-Mixed values.
  const positionRow = makeInspectorRow('Position', [fieldX, fieldY]);
  positionRow.dataset.wfpeRow = 'position';
  inspectorBody.appendChild(positionRow);
  const sizeRow = makeInspectorRow('Size', [fieldW, fieldH]);
  sizeRow.dataset.wfpeRow = 'size';
  inspectorBody.appendChild(sizeRow);
  inspectorBody.appendChild(typographyDividerTop);
  inspectorBody.appendChild(fontSizeRow);
  inspectorBody.appendChild(weightRow.row);
  inspectorBody.appendChild(alignRow.row);
  inspectorBody.appendChild(typographyDividerBottom);

  // Colour rows (v2.4). Text colour for text-bearing only; background
  // colour for any selection. Each row composes a swatch (clickable
  // trigger for the hidden native picker), a hex text input, and — for
  // background only — a "transparent" clear button.
  // `label` must fit the 66px label column at 10px/700/0.06em uppercase
  // (~9 chars) — longer strings overflow under the swatch. `pickerHint`
  // carries the full descriptive wording for the swatch tooltip.
  function makeColourRow({ label, pickerHint, target, prop, includeClear }) {
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
    swatch.title = `${pickerHint || label} — pick`;

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
    label: 'Text',
    pickerHint: 'Text colour',
    target: 'text',
    prop: 'textColorHex',
    includeClear: false,
  });
  const bgColourRow = makeColourRow({
    label: 'Fill',
    pickerHint: 'Background colour',
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
  opacitySlider.className = 'wfpe-opacity-slider';
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
  annotationTextarea.className = 'wfpe-annotation-input';
  annotationTextarea.dataset.wfpeProp = 'annotation';
  annotationTextarea.placeholder = 'Instruction for agent cleanup';
  annotationTextarea.spellcheck = true;
  annotationRow.appendChild(annotationTextarea);

  // v2.13 — read-only agent reply line (skipped / needs-input outcomes).
  const annotationReply = document.createElement('div');
  annotationReply.className = 'wfpe-annotation-reply';
  annotationReply.dataset.status = '';
  annotationReply.style.display = 'none';
  annotationRow.appendChild(annotationReply);

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

  // Element action row. Duplicate/delete/reset/front live together to
  // avoid growing the inspector vertically as structural actions are added.
  const actionRow = document.createElement('div');
  actionRow.className = 'wfpe-action-row';
  actionRow.dataset.wfpeRow = 'actions';
  const duplicateBtn = document.createElement('button');
  duplicateBtn.type = 'button';
  duplicateBtn.className = 'wfpe-action-btn wfpe-duplicate-btn';
  duplicateBtn.dataset.action = 'duplicate-element';
  duplicateBtn.innerHTML = ICONS.copy + '<span>Duplicate</span>';
  duplicateBtn.title = 'Duplicate selected element';
  actionRow.appendChild(duplicateBtn);

  const deleteBtn = document.createElement('button');
  deleteBtn.type = 'button';
  deleteBtn.className = 'wfpe-action-btn wfpe-delete-btn';
  deleteBtn.dataset.action = 'delete-element';
  deleteBtn.innerHTML = ICONS.trash + '<span>Delete</span>';
  deleteBtn.title = 'Delete selected element';
  actionRow.appendChild(deleteBtn);

  // Reset action (v2.5, reworked 2026-07). Restores the selected element's
  // inline `style` to its pre-edit original (state.originalStyles) as one
  // history entry. Clearing the whole attribute is wrong here: WFP decks
  // author position/size as inline styles, so clearing warped elements to
  // the slide origin. No-op (no history entry) if the editor never
  // changed the element.
  const resetBtn = document.createElement('button');
  resetBtn.type = 'button';
  resetBtn.className = 'wfpe-action-btn wfpe-reset-btn';
  resetBtn.dataset.action = 'reset-styles';
  resetBtn.innerHTML = ICONS.refresh + '<span>Reset</span>';
  resetBtn.title = "Restore the selected element's styles to their state before any edits";
  actionRow.appendChild(resetBtn);

  // Front action (v2.17; scope corrected in v2.17.1). Raises the selection
  // above everything it visually overlaps anywhere in the active slide —
  // climbing to a capping ancestor when one traps the z-index — and verifies
  // the result by paint truth. One-way only: no send-to-back/step controls.
  const frontBtn = document.createElement('button');
  frontBtn.type = 'button';
  frontBtn.className = 'wfpe-action-btn wfpe-front-btn';
  frontBtn.dataset.action = 'bring-to-front';
  frontBtn.innerHTML = ICONS.layers + '<span>Front</span>';
  frontBtn.title = "Bring the selected element in front of everything it overlaps";
  actionRow.appendChild(frontBtn);
  inspectorBody.appendChild(actionRow);

  inspectorDockInner.appendChild(inspector);
  stack.appendChild(inspectorDock);

  // Dimension bubble (v2.2): floating "W × H" chip above the selection
  // ring. Tracks the same lifecycle as the ring.
  const dimBubble = document.createElement('div');
  dimBubble.className = 'wfpe-dim-bubble';
  root.appendChild(dimBubble);

  // Live value tag (v2.12, design 7): coral chip pinned to the selection
  // during a gesture. Content, position, and visibility are owned by the
  // adaptive-fade module (85-adaptive-fade.js).
  const scrubTag = document.createElement('div');
  scrubTag.className = 'wfpe-scrub-tag';
  scrubTag.dataset.show = 'false';
  root.appendChild(scrubTag);

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

  // The both-sides fallback is intentionally faint at rest. Mouse hover and
  // keyboard focus reveal the complete panel before an action can occur.
  // Touch/pen have no reliable pre-contact hover, so their first contact is
  // consumed as an explicit reveal; the second can activate the control.
  let fallbackMouseInside = false;
  let suppressFallbackClick = false;
  let fallbackClickResetTimer = null;
  function isInspectorFallback() {
    return inspector.dataset.avoidance === 'overlap';
  }
  function setInspectorFallbackRevealed(value) {
    inspector.dataset.revealed = value ? 'true' : 'false';
  }
  inspector.addEventListener('pointerenter', (e) => {
    if (e.pointerType !== 'mouse' || !isInspectorFallback()) return;
    fallbackMouseInside = true;
    suppressFallbackClick = false;
    setInspectorFallbackRevealed(true);
  });
  inspector.addEventListener('pointerleave', (e) => {
    if (e.pointerType !== 'mouse') return;
    fallbackMouseInside = false;
    if (!inspector.contains(document.activeElement)) {
      setInspectorFallbackRevealed(false);
    }
  });
  inspector.addEventListener('focusin', () => {
    if (isInspectorFallback()) setInspectorFallbackRevealed(true);
  });
  inspector.addEventListener('focusout', () => {
    queueMicrotask(() => {
      if (
        isInspectorFallback() &&
        !fallbackMouseInside &&
        !inspector.contains(document.activeElement)
      ) {
        setInspectorFallbackRevealed(false);
      }
    });
  });
  inspector.addEventListener('pointerdown', (e) => {
    if (!isInspectorFallback() || inspector.dataset.revealed === 'true') return;
    e.preventDefault();
    e.stopPropagation();
    suppressFallbackClick = true;
    clearTimeout(fallbackClickResetTimer);
    fallbackClickResetTimer = setTimeout(() => {
      suppressFallbackClick = false;
      fallbackClickResetTimer = null;
    }, 400);
    setInspectorFallbackRevealed(true);
  }, true);
  inspector.addEventListener('click', (e) => {
    if (
      !isInspectorFallback() ||
      (!suppressFallbackClick && inspector.dataset.revealed === 'true')
    ) {
      return;
    }
    suppressFallbackClick = false;
    clearTimeout(fallbackClickResetTimer);
    fallbackClickResetTimer = null;
    e.preventDefault();
    e.stopPropagation();
    setInspectorFallbackRevealed(true);
  }, true);
  document.addEventListener('pointerdown', (e) => {
    if (!isInspectorFallback() || inspector.contains(e.target)) return;
    fallbackMouseInside = false;
    suppressFallbackClick = false;
    clearTimeout(fallbackClickResetTimer);
    fallbackClickResetTimer = null;
    setInspectorFallbackRevealed(false);
  }, true);

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
  // v2.11 — export action menu (4b rows, 5b docking). Opened by the Export
  // button; row 1 is the primary save action (Enter / Cmd+S), row 2 is the
  // legacy clean-copy download.
  //
  // Seam bookkeeping (5b): the toolbar squares its bottom corners while ANY
  // segment is docked below it; the menu keeps a straight 6px top always and
  // rounds its bottom only when it is the LAST segment (no inspector below);
  // the inspector dims + folds to its header while the menu is open.
  function refreshStackSeams() {
    const inspectorVisible = inspectorDock.dataset.visible === 'true';
    toolbar.dataset.docked = String(state.exportMenuOpen || inspectorVisible);
    exportMenu.dataset.abovePanel = String(inspectorVisible);
    inspector.dataset.suppressed = String(state.exportMenuOpen && inspectorVisible);
    positionInspectorStack();
  }
  function openExportMenu() {
    state.exportMenuOpen = true;
    exportDock.dataset.visible = 'true';
    exportMenu.dataset.open = 'true'; // stable hook for tests
    exportBtn.setAttribute('aria-expanded', 'true');
    refreshStackSeams();
    refreshExportUi();
  }
  function closeExportMenu() {
    state.exportMenuOpen = false;
    exportDock.dataset.visible = 'false';
    exportMenu.dataset.open = 'false';
    exportBtn.setAttribute('aria-expanded', 'false');
    refreshStackSeams();
  }
  // Single dispatcher for menu row 1, Enter-while-open, and Cmd/Ctrl+S.
  // Task 2: save-in-place is primary; legacy download is the Safari/Firefox
  // fallback when the File System Access API isn't available. saveInPlace()
  // is deliberately not awaited here — this fires from a click/keydown
  // handler and must call the native picker within the same user gesture.
  function triggerPrimaryExport() {
    closeExportMenu();
    if (!canSaveInPlace()) {
      // Safari/Firefox fallback — v2.5 download behaviour.
      if (getAnnotatedElements(document).length > 0) exportHandoffHTML();
      else exportHTML();
      return;
    }
    saveInPlace();
  }
  exportBtn.addEventListener('click', (e) => {
    e.preventDefault();
    if (state.exportMenuOpen) closeExportMenu();
    else openExportMenu();
  });
  exportPrimaryItem.addEventListener('click', (e) => {
    e.preventDefault();
    triggerPrimaryExport();
  });
  exportCleanItem.addEventListener('click', (e) => {
    e.preventDefault();
    closeExportMenu();
    exportHTML();
  });
  // Click-away (capture so host-page handlers can't swallow it first).
  // The suppressed inspector is excluded: closing here on mousedown would
  // race its header chevron's click handler (mousedown fires first), which
  // has its own dismiss-the-menu behaviour (5b).
  document.addEventListener(
    'mousedown',
    (e) => {
      if (!state.exportMenuOpen) return;
      if (
        exportMenu.contains(e.target) ||
        exportBtn.contains(e.target) ||
        inspectorDock.contains(e.target)
      ) {
        return;
      }
      closeExportMenu();
    },
    true,
  );
  overviewBtn.addEventListener('click', (e) => {
    e.preventDefault();
    if (isFlatMode()) return;
    setOverviewMode(!state.overviewMode);
  });
  inspectorMinimiseBtn.addEventListener('click', (e) => {
    e.preventDefault();
    // 5b: while the export menu suppresses the inspector, the header
    // chevron reads as "restore" — it dismisses the menu, not the panel.
    if (state.exportMenuOpen) {
      closeExportMenu();
      return;
    }
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
        // Revert by repopulating from the live element(s), then blur. The
        // revertingInput flag suppresses the blur's commit so the no-op
        // path stays explicit rather than implicit-via-equality.
        //
        // v2.18 code review (W3) — was an unconditional
        // populateInspector(state.selected), which repaints the SINGLE-
        // selection surface (Duplicate/Delete enabled, geometry rows
        // shown) over a live multi-selection until the next tracking
        // tick quietly repairs it. Route through the same multi/single
        // split every other repopulate call site uses.
        revertingInput = input;
        if (hasMultiSelection()) populateInspectorMulti(getSelectedElements());
        else populateInspector(state.selected);
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

  // Toolbar collapse chevron (ink-glass 3b) — pure chrome state, no
  // interaction with edit/overview modes or history.
  toolbarCollapseBtn.addEventListener('click', (e) => {
    e.preventDefault();
    setToolbarCollapsed(!state.toolbarCollapsed);
  });

  // Typography segmented controls (ink-glass 3b). Same commit contract
  // as the font-size ± buttons: one history entry per click via the
  // inspector-txn isolation helpers, no-op guarded against the computed
  // style so re-clicking the active segment doesn't pollute history.
  function commitSegStyle(styleProp, value, tagLabel) {
    const el = state.selected;
    if (!el || !isTextBearing(el)) return;
    const cs = getComputedStyle(el);
    const current = styleProp === 'fontWeight'
      ? normalizeFontWeight(cs.fontWeight)
      : normalizeTextAlign(cs.textAlign);
    if (current === value) return;
    const ctx = startInspectorTxn();
    touchElement(el);
    el.style[styleProp] = value;
    endInspectorTxn(ctx);
    populateTypography(el);
    // v2.12 — the reflow is what the user wants to see; no-op clicks
    // returned above and don't blip.
    liveEditBlip(tagLabel);
    refreshSelection();
  }
  for (const b of weightRow.buttons) {
    b.addEventListener('click', (e) => {
      e.preventDefault();
      commitSegStyle('fontWeight', b.dataset.wfpeValue, b.textContent);
    });
  }
  for (const b of alignRow.buttons) {
    b.addEventListener('click', (e) => {
      e.preventDefault();
      const v = b.dataset.wfpeValue;
      commitSegStyle('textAlign', v, v.charAt(0).toUpperCase() + v.slice(1));
    });
  }

  // Opacity slider — same one-entry-per-drag contract as font-size. Mouse
  // interaction opens the history session on mousedown, before any `input`
  // fires, and closes it immediately on mouseup/change — unchanged.
  // Keyboard interaction (focus + arrow keys) never fires mousedown, so
  // `input` used to find no open session and bail out entirely: the
  // native thumb moved but opacity never changed, and the next repopulate
  // snapped the thumb back. `input` now opens a session lazily when none
  // is open.
  //
  // Unlike a mouse drag, a native <input type=range> fires `change`
  // immediately after EVERY keyboard-driven `input` — including every
  // step of OS key auto-repeat while an arrow key is held (verified
  // directly against Chromium: a held key produces one input+change pair
  // per repeat tick, not one trailing change at release). Closing on
  // `change` the way mouse does would turn one held-key gesture into
  // dozens of history entries and evict unrelated older undo state
  // (HISTORY_MAX, 00-preamble.js) well before the user lets go. A
  // lazily-opened (keyboard) session therefore settles instead of closing
  // immediately: `change` arms a short timer — the same "wait for the
  // gesture to actually stop" shape as the adaptive-fade restore
  // (FADE_RESTORE_MS, 85-adaptive-fade.js) — that closes the session only
  // once no further input arrives, so a whole burst of presses, held or
  // not, lands as one entry, same as a mouse drag. Losing focus flushes it
  // immediately instead of waiting out the timer.
  //
  // Holding state.txn open for that settle window is only safe because it
  // is registered with 50-history.js's pending-txn-flush mechanism for
  // exactly as long as the timer is armed: any OTHER gesture that opens a
  // transaction while the window is open (a drag, a text edit, another
  // inspector commit) forces this session to finalize as its own history
  // entry FIRST, so it can never silently absorb an unrelated change or
  // swallow another beginTxn() call's own options (e.g. captureHtml).
  const OPACITY_KEYBOARD_SETTLE_MS = 380;
  // v2.18 code review (C1) — was a single `opacitySliderTarget` element, so
  // a slider DRAG under a multi-selection wrote only state.selected: the
  // dock would then repopulate "Mixed" for the other member(s) right after
  // a gesture that visually claimed to edit the whole set. Generalised to
  // the member array captured at session-open; the typed-value path
  // (commitOpacityMulti, 40-helpers-selection-inspector.js) was already
  // correct — this brings the slider's live-drag path to the same scope.
  let opacitySliderMembers = null;
  let opacitySliderRestoreCtx = null;
  let opacitySliderOwnedTxn = null; // identity guard for the deferred keyboard close, below
  let opacitySliderKeyboardSession = false;
  let opacitySliderSettleTimer = null;
  function beginOpacitySession(members, { keyboard = false } = {}) {
    opacitySliderMembers = members;
    opacitySliderRestoreCtx = startInspectorTxn();
    for (const el of members) touchElement(el);
    opacitySliderOwnedTxn = state.txn;
    opacitySliderKeyboardSession = keyboard;
  }
  function closeOpacitySession() {
    // Unregister first and unconditionally: this is also the pending-txn-
    // flush hook itself (see below), so it must be safe to call whether it
    // fires from our own timer, from an external flush, or from a direct
    // mouse/blur close — and must never leave a stale registration behind.
    unregisterPendingTxnFlush(closeOpacitySession);
    clearTimeout(opacitySliderSettleTimer);
    opacitySliderSettleTimer = null;
    if (!opacitySliderMembers) return;
    opacitySliderMembers = null;
    opacitySliderKeyboardSession = false;
    const owned = opacitySliderOwnedTxn;
    opacitySliderOwnedTxn = null;
    const ctx = opacitySliderRestoreCtx;
    opacitySliderRestoreCtx = null;
    // Something else (most plausibly a selection change while a keyboard
    // settle timer was pending) may already have closed/replaced the
    // shared txn slot — only end the one this session actually opened.
    if (state.txn === owned) endInspectorTxn(ctx);
    liveEditEnd();
  }
  opacitySlider.addEventListener('mousedown', () => {
    const members = getSelectedElements();
    if (!members.length) return;
    clearTimeout(opacitySliderSettleTimer);
    opacitySliderSettleTimer = null;
    beginOpacitySession(members);
  });
  opacitySlider.addEventListener('input', () => {
    clearTimeout(opacitySliderSettleTimer);
    opacitySliderSettleTimer = null;
    const currentMembers = getSelectedElements();
    if (opacitySliderMembers && !selectionArraysEqual(opacitySliderMembers, currentMembers)) {
      // An earlier session — most often an orphaned mouse drag whose
      // mouseup never reached us (button released outside the window), or
      // a selection change mid-drag — never closed before membership
      // moved on. Close it out for real (a harmless no-op if it captured
      // no change) instead of silently continuing to apply values to a
      // stale member set.
      closeOpacitySession();
    }
    if (!opacitySliderMembers) {
      if (!currentMembers.length) return;
      beginOpacitySession(currentMembers, { keyboard: true });
    }
    const members = opacitySliderMembers;
    const pct = Math.max(0, Math.min(100, parseFloat(opacitySlider.value)));
    for (const el of members) el.style.opacity = String(pct / 100);
    if (members.length > 1) populateOpacityMulti(members);
    else populateOpacity(members[0]);
    // v2.12 — bounded control keeps its slider; each tick refreshes the
    // tag/fade, and the restore is anchored to true drag-end below so a
    // mid-drag pause can't flicker the chrome back in.
    liveEditUpdate(`${Math.round(pct)} %`);
  });
  const endOpacityDrag = () => {
    if (!opacitySliderMembers) return;
    if (opacitySliderKeyboardSession) {
      clearTimeout(opacitySliderSettleTimer);
      opacitySliderSettleTimer = setTimeout(closeOpacitySession, OPACITY_KEYBOARD_SETTLE_MS);
      // Pending until the timer fires or something else needs the txn
      // slot first — closeOpacitySession() unregisters itself either way.
      registerPendingTxnFlush(closeOpacitySession);
      return;
    }
    closeOpacitySession();
  };
  opacitySlider.addEventListener('mouseup', endOpacityDrag);
  opacitySlider.addEventListener('change', endOpacityDrag);
  opacitySlider.addEventListener('blur', closeOpacitySession);
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
      const norm = parseHexInput(colorInput.value);
      if (!norm) return;
      // v2.18 — colour swatches apply to every selected member, no
      // isTextBearing gate (unlike font size): setting `color` on a
      // non-text element is inert, not wrong, so it isn't worth skipping.
      if (hasMultiSelection()) {
        const members = getSelectedElements();
        if (!pickerSession[target].open) {
          pickerSession[target].open = true;
          pickerSession[target].inlineSpan = null;
          pickerSession[target].restoreCtx = startInspectorTxn();
          for (const el of members) touchElement(el);
        }
        for (const el of members) applyColorToElement(el, target, norm);
        populateColoursMulti(members);
        return;
      }
      const el = state.selected;
      if (!el) return;
      if (target === 'text' && !isTextBearing(el)) return;
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
        // v2.18 code review (W3) — same multi/single split as the numeric
        // fields' Escape handler above.
        revertingInput = hexInput;
        if (hasMultiSelection()) populateColoursMulti(getSelectedElements());
        else populateColours(state.selected);
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
        const cssProp = target === 'text' ? 'color' : 'backgroundColor';
        if (hasMultiSelection()) {
          const members = getSelectedElements().filter((el) => !!el.style[cssProp]);
          if (!members.length) return;
          const ctx = startInspectorTxn();
          for (const el of members) {
            touchElement(el);
            el.style[cssProp] = '';
          }
          endInspectorTxn(ctx);
          populateColoursMulti(getSelectedElements());
          return;
        }
        const el = state.selected;
        if (!el) return;
        // Only meaningful if there's an inline colour to clear.
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
    autoGrowAnnotationTextarea();
    updateAnnotationDraftStatus(getAnnotationEditorTarget());
    positionInspectorStack();
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

  // Reset restores an ordinary element's pre-edit inline style as one
  // history entry. A flow-unlocked element delegates to its recorded unlock
  // group so untouched mechanical pins and their freeze markers can return
  // to the pre-unlock state in that same entry. Later deliberate sibling
  // edits are retained; any container they still depend on stays pinned.
  // No original/group record means the editor never touched the element, so
  // an idle click cannot mutate it or push a no-op entry.
  // v2.18 — getSelectedElements() covers both single and multi selection
  // (it returns [state.selected] for a single selection), so one loop
  // inside one txn serves both: every touched member restores together
  // and undoes together. The no-op guard stays per-member (skip anything
  // the editor never touched) via the `restorable` filter below.
  resetBtn.addEventListener('click', (e) => {
    e.preventDefault();
    const targets = getSelectedElements();
    if (!targets.length) return;
    const restorable = targets.filter((el) => getActiveFlowUnlockGroup(el) || state.originalStyles.has(el));
    if (!restorable.length) return; // none of the targets were ever edited
    const ctx = startInspectorTxn();
    for (const el of restorable) {
      const unlockGroup = getActiveFlowUnlockGroup(el);
      if (unlockGroup) {
        restoreFlowUnlockGroup(unlockGroup, el);
      } else {
        const original = state.originalStyles.get(el);
        touchElement(el);
        if (original === null) el.removeAttribute('style');
        else el.setAttribute('style', original);
      }
    }
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
  // Guarded before the txn opens (no selection, or every target already
  // paints above its competitors and already meets its planned z) so an
  // idle/repeat click pushes no history entry and inflates no z-index. The
  // plan — competitor sets included — is computed once and reused for the
  // guard, the writes and the post-write verification.
  frontBtn.addEventListener('click', (e) => {
    e.preventDefault();
    const targets = getSelectedElements();
    if (!targets.length) return;
    const plan = computeFrontPlan(targets);
    if (!plan || isFrontPlanNoop(plan)) return;
    const ctx = startInspectorTxn();
    applyFrontPlan(plan);
    endInspectorTxn(ctx);
    refreshSelection();
  });
  applyModeFeatureGating();
  reimportHandoffAnnotations();
  refreshExportUi();
