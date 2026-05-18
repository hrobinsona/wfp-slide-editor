# Element Copy/Paste + Add Slide in Overview

## Context

The WFP Slide Editor (v2.1) lets authors select, drag, resize, and edit elements on a slide, and lets them reorder/delete slides in Overview mode. Two gaps slow down deck composition:

1. **No element duplication.** Authors who want a second copy of an element — on the same slide or a different one — must rebuild it from scratch.
2. **Overview can't add slides.** While reorganising in overview, an author often realises a slide is missing, but the only way to add one is to edit fixture HTML.

This brief closes both gaps:

- **Element copy/paste/duplicate** via `Cmd/Ctrl+C` / `Cmd/Ctrl+V` and an inspector "Duplicate" button. Single-element scope (no multi-select).
- **Insert blank slide** in Overview mode via hover-revealed "+" affordances between thumbs (and at the start/end of the grid).

Both must be undo/redo-safe, must not leak markers into exported HTML, and must respect the existing capture-phase keyboard handler.

---

## Feature 1: Element Copy / Paste / Duplicate

### Behaviour

| Action | Trigger | Result |
|---|---|---|
| Copy | `Cmd/Ctrl+C` while an element is selected and not in text-edit | Element's serialized clone is stored in `state.clipboard`. Browser default suppressed. |
| Copy (inside text edit) | `Cmd/Ctrl+C` while `state.textEditing === true` | Not intercepted — browser default copy of selected text. |
| Paste | `Cmd/Ctrl+V` in normal slide view, with `state.clipboard` populated | Deep clone inserted into `.slide.active`, offset +20px / +20px from original coordinates. New element becomes `state.selected`. One undo step. |
| Paste (in overview / text-edit) | `Cmd/Ctrl+V` while overview or text-edit owns the keys | No-op for element paste; let browser/overview handle. |
| Duplicate | Inspector "Duplicate" button | Equivalent to copy + paste on the same slide. In-place clone, offset +20/+20, auto-selected. |

### Cross-slide paste

Paste always targets `.slide.active`. To move an element to another slide: select → copy → navigate to destination slide → paste. The +20/+20 offset is applied regardless; slides share the same coordinate system, so positions transfer cleanly.

### Clipboard storage

Add `state.clipboard = { outerHTML: string }` (session-only, plain object). On copy, the selected element is serialised via `el.outerHTML` after a temporary strip of `data-wfp-edit-*` attributes and `contenteditable`. On paste, the HTML is reconstituted via a detached container, the resulting element is positioned, then appended to the active slide.

The clipboard is independent of the source DOM — re-pasting after the original is deleted still works.

### Key handler integration

Extend `onKeyDown` at `editor.js:~2927` (capture phase). Guards in order:

- `state.editMode === true`
- Modifier is `metaKey || ctrlKey`
- For copy: `state.selected != null && !state.textEditing` → handle and `stopPropagation()`; otherwise fall through to browser
- For paste: `state.clipboard != null && !state.textEditing && !state.overviewMode` → handle and `stopPropagation()`; otherwise fall through

### Undo/redo

Add a new op type `elementInsert` to the history system at `editor.js:~2014–2163`:

```js
{ type: 'elementInsert', slideEl, insertedEl, parentEl, nextSiblingEl }
```

- Undo: `parentEl.removeChild(insertedEl)`; if `state.selected === insertedEl`, clear selection.
- Redo: `parentEl.insertBefore(insertedEl, nextSiblingEl)`; `setSelected(insertedEl)`.

Mirrors the existing `slideOps` pattern at `editor.js:~2135–2163` (delete already works this way).

### Inspector "Duplicate" button

Add a button row to inspector body near the Reset action at `editor.js:~1026–1240`. Visible only when `state.selected != null` (inspector is already empty in that state). Calls a single `duplicateSelected()` helper that performs copy-then-paste in one history op.

### Tests (`tests/v2-copy-paste.spec.js`)

Strict TDD per CLAUDE.md for logic; build-first for inspector button visual.

- Copy element, paste on same slide → new element at +20/+20 offset, selected.
- Copy element, navigate to another slide, paste → element appears on destination slide.
- Inspector "Duplicate" button → in-place duplicate.
- Undo after paste → element removed, original re-selected.
- Redo after undo → element back at same offset position.
- `Cmd/Ctrl+C` inside contenteditable text edit → does NOT populate `state.clipboard`; browser text copy still works.
- `Cmd/Ctrl+V` in overview mode → no-op (no insert).
- Exported HTML after paste contains the pasted element but no `data-wfp-edit-*` attributes on it.
- Pasted element keeps its inline `style` (position, size, colours) from the original.

---

## Feature 2: Add New Slide in Overview Mode

### Behaviour

In overview, render hover-revealed "+" affordances:

- Before the first thumb
- Between every pair of adjacent thumbs
- After the last thumb

Clicking a "+" inserts a new blank slide at that index. The user remains in overview. The new thumb appears immediately; clicking it navigates into the (empty) slide where the user can then paste elements from another slide.

### Blank slide markup

```html
<div class="slide" id="s{nextId}"></div>
```

`nextId` = `max(existing numeric suffixes) + 1` across `.deck > .slide[id]`. If a slide has a non-numeric id, fall back to a deck-length-based suffix. No `.active` class on insert. Empty content.

### "+" affordance UI

Rendered inside `buildOverviewOverlay()` at `editor.js:~2271–2305`. After computing each thumb's rect, place an `.wfpe-overview-add` button in the gap before each thumb plus one after the last thumb.

CSS rules (scoped via `#wfp-editor-root` / body `data-wfp-edit-overview="on"`):

- Default: small (~24×24) circular target, low opacity, centred in the gap.
- Hover: full opacity, "+" glyph visible.
- z-index above the grid background, below the active drag preview so it doesn't intercept reorder drags.

Click handler reads `data-wfp-edit-insert-index` off the affordance and performs the insert.

### Undo/redo

Extend `slideOps` at `editor.js:~2135–2163` with op type `slideInsert`:

```js
{ type: 'slideInsert', deckEl, insertedSlide, beforeSibling }
```

- Undo: `deckEl.removeChild(insertedSlide)`; rebuild overlay; if the deleted slide was the only one without an `.active` sibling, reapply active to a neighbour (defensive — usually a no-op since insert never becomes active).
- Redo: `deckEl.insertBefore(insertedSlide, beforeSibling)`; rebuild overlay.

Mirrors the deletion path at `editor.js:~2664`.

### Overlay refresh

After insert (and after undo/redo), call the existing overlay rebuild path used by reorder/delete so thumb indices, badges, and "+" buttons re-render with current order.

### Tests (`tests/v2-overview-add.spec.js`)

Strict TDD for ordering/history; build-first for hover styling.

- Click "+" between slides 2 and 3 → blank slide at index 3; original slide 3 shifts to index 4.
- Click "+" before slide 1 → blank slide at index 1; all originals shift +1.
- Click "+" after last slide → blank slide appended.
- Undo after add → slide removed; deck length restored; overlay shows original order.
- Redo after undo → slide back at the same index.
- Click new thumb → exits overview, the new slide becomes `.active`, deck shows empty slide content.
- Integration: paste a copied element onto the new slide (combines features 1 and 2).
- Exported HTML includes the new slide with no `data-wfp-edit-*` attributes.

---

## Critical Files to Modify

**`editor.js`** — primary file. Touchpoints (line numbers from the architecture survey, approximate):

- **State (~64–82)**: add `state.clipboard`.
- **Inspector body (~1026–1240)**: add "Duplicate" button; show only when `state.selected != null`.
- **Selection helpers (~1579–1758)**: reuse `setSelected()` post-paste and post-insert; no internal changes.
- **History system (~2014–2163)**: add `elementInsert` and `slideInsert` op types; extend undo/redo dispatchers.
- **Overview overlay (~2271–2305)**: render "+" affordances; wire click → `insertBlankSlideAt(index)`.
- **Overview handlers (~2664+)**: add `insertBlankSlideAt(index)` alongside `deleteSlideFromOverview`.
- **Key handler (~2927)**: add Cmd/Ctrl+C and Cmd/Ctrl+V branches in capture phase, with guards above.
- **Export pipeline (~3458–3505)**: no change. Existing `data-wfp-edit-*` strip covers pasted clones and inserted slides automatically (per architecture survey).

**New test files:**

- `tests/v2-copy-paste.spec.js`
- `tests/v2-overview-add.spec.js`

---

## Existing Functions / Utilities to Reuse

- `setSelected(el)` at `editor.js:1731` — select the pasted/duplicated element.
- `snapshotElement(el)` at `editor.js:2014` and `beginTxn/endTxn` at `editor.js:2052–2063` — for any change wrapping; new insert ops follow the same dispatcher pattern but don't need before/after snapshots (a pure insert).
- `findSelectableTarget(target)` at `editor.js:1590` — not directly reused, but validates that pasted nodes remain selectable.
- `buildOverviewOverlay()` at `editor.js:~2271` — single rebuild path after slide insert.
- `deleteSlideFromOverview(slide)` at `editor.js:2664` — pattern reference for slide DOM mutation + history.
- `navigateToSlide(slide)` at `editor.js:2412` — used when the user clicks the newly inserted thumb.
- Existing capture-phase `onKeyDown` registration at `editor.js:2927` — single place to hook new shortcuts.

---

## TDD Mode

Mixed, per CLAUDE.md:

- **Strict TDD** (test first, watch it fail, implement): clipboard state shape, paste position math, history op shapes (`elementInsert`, `slideInsert`), slide insert ordering, undo/redo correctness, exported HTML scrubbing of pasted/inserted nodes.
- **Build-first** (implement, browser-verify, then write coverage before declaring done): inspector "Duplicate" button placement and visual styling; "+" affordance hover behaviour and gap placement in overview.

---

## Verification

1. Install / start: `npm install` (if needed), then `npm run dev`. Open `http://localhost:8080/fixtures/boilerplate.html` (or another allow-listed fixture).
2. Activate the bookmarklet to inject the editor.
3. **Element copy/paste — manual checks**:
   - Select an element. Press `Cmd/Ctrl+C`. Press `Cmd/Ctrl+V`. Verify a duplicate appears offset +20/+20 and is now selected.
   - Click inspector "Duplicate" button. Verify identical behaviour.
   - Navigate to a different slide. Press `Cmd/Ctrl+V`. Verify the element appears on this slide at the original element's coordinates + 20/+20.
   - Press `Cmd+Z` — duplicate disappears, prior selection restored. `Cmd+Y` / `Cmd+Shift+Z` — duplicate returns.
   - Double-click into a text element, select some text, press `Cmd+C` — verify normal browser text copy (paste into another input shows the text, not the element).
4. **Add slide — manual checks**:
   - Enter overview. Hover between two thumbs — "+" appears in the gap. Click it. Verify a blank thumb appears at that index, others shift.
   - Repeat at the start of the grid and after the last thumb.
   - `Cmd+Z` removes the inserted slide. `Cmd+Y` puts it back.
   - Click the new thumb — verify it exits overview into an empty slide.
   - Navigate back to a populated slide, copy an element, navigate to the empty slide, paste — verify it lands and is selectable.
5. **Export sanity**:
   - Trigger "Export HTML". Open the downloaded file in a text editor. Verify: no `#wfp-editor-root`, no `data-wfp-edit-*` attributes, no `contenteditable`, no `editor.js` script tag. Verify pasted elements and inserted slide are present and render correctly when opened standalone.
6. **Automated tests**:
   - `npm test` — all existing specs still pass; new `v2-copy-paste.spec.js` and `v2-overview-add.spec.js` pass.
   - Use the `playwright-runner` subagent for noisy runs.
7. **Code review**:
   - Run the `code-reviewer` subagent on the diff before declaring done (per CLAUDE.md). Focus areas: capture-phase guards (text-edit and overview must not be hijacked), history op symmetry (undo + redo produce identical DOM), export scrubbing on pasted/inserted nodes.

---

## Out of Scope

Explicitly NOT in this brief:

- Per-slide context notes / Claude-handoff briefs.
- Multi-select copy/paste.
- System clipboard integration (cross-tab paste).
- Templates / preset blank slide layouts.
- Drag-to-duplicate.
- `Cmd/Ctrl+D` shortcut (conflicts with browser bookmark).
