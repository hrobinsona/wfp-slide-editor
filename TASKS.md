# Tasks: v1 Build Plan

> Status: Historical. This was the original v1 implementation plan. The current product contract is `REQUIREMENTS.md`; delivered v2 work is archived in `feature-briefs/`; active maintainability work is in `REFACTOR-MAINTAINABILITY.md`. Do not treat this file as the current backlog unless the user explicitly asks to revisit v1 history.

This is the build order. Each task is independently testable. Don't move on until the verification step passes AND the `code-reviewer` subagent approves.

If you finish a task and discover that REQUIREMENTS.md is missing something, update REQUIREMENTS.md, then continue.

## TDD posture by phase

| Phase | Mode | Checkpoint? | Reason |
|---|---|---|---|
| Phase 0 | N/A (setup) | No | No code to test yet |
| Phase 1 | strict | No | Bootstrap is mechanical; tests cover it |
| Phase 2 | build-first | **Yes** | First visible UI — set the aesthetic bar |
| Phase 3 | strict | No | Pure logic, fully testable |
| Phase 4 | strict | **Yes** | Highest-risk math; sanity-check that drag *feels* right |
| Phase 5 | build-first | **Yes** | Visual placement of resize handles needs eyeballing |
| Phase 6 | strict | No | Pure state logic, tests catch everything |
| Phase 7 | strict | No | Text edit transitions are unambiguous |
| Phase 8 | strict | **Yes** | First moment you can verify export round-trip end-to-end |
| Phase 9 | build-first | **Yes** | Final gate before declaring v1 done |
| Phase 10 | build-first | No | Bookmarklet glue; manually run through Setup once |

**strict** = Write failing test first, then implement.
**build-first** = Implement, verify visually, then write tests before declaring the phase done.
**Checkpoint** = Stop after `code-reviewer` approves and wait for human reply before next phase. See CLAUDE.md.

In all phases, invoke the `code-reviewer` subagent at the end before moving on.

## Phase 0 — Project setup *(N/A)*

### Task 0.1: Initialize npm project
- Run `npm init -y`
- Set `"type": "module"` in package.json
- Add scripts:
  - `"test": "playwright test"`
  - `"dev": "http-server -p 8080 -c-1 ."` (the `-c-1` disables caching)
  - `"build:bookmarklet": "node scripts/build-bookmarklet.js"`
- Install dev dependencies: `npm i -D @playwright/test http-server`
- Run `npx playwright install chromium`

**Verify:** `npm run dev` serves the project root at http://localhost:8080.

### Task 0.2: Add `.gitignore`
- Ignore `node_modules/`, `tests/output/`, `.DS_Store`, `*.local`.

### Task 0.3: Smoke-test fixtures load
- Open `http://localhost:8080/fixtures/Townhall-1.html` in a browser.
- Confirm the slide deck loads, animations play, arrow keys advance slides.

**Verify:** Both fixtures render correctly without any editor loaded. This is the baseline.


### Verify by hand (Phase 0)
1. Run `npm run dev` and open http://localhost:8080/fixtures/Townhall-1.html in your browser.
2. Press ArrowRight several times. Slides advance smoothly.
3. Press ArrowLeft. Slides go back.
4. Resize the browser window. Slide scales to fit.
5. Open `fixtures/Inspirational-presentation-2.html` and repeat. Both fixtures must work as a baseline before the editor is built.


**Pre-commit check:** Run `git status`. Confirm only intended files are staged. No untracked HTML in `fixtures/` should appear unless deliberately allow-listed. If anything looks off, STOP and ask the human.

**Commit:** `chore(phase-0): project setup — npm init, dependencies, dev server` (do not push)

## Phase 1 — Editor skeleton *(TDD: strict)*

Write `tests/01-bootstrap.spec.js` first, confirm it fails, then implement Tasks 1.1 and 1.2 below until it passes. Invoke `code-reviewer` before moving to Phase 2.

### Task 1.1: Create `editor.js` with bootstrap and toggle
- Single file at project root.
- On load: log a version string, mount `<div id="wfp-editor-root">` to `<body>`, register a `keydown` listener for the `E` key.
- Pressing `E` toggles a boolean `editMode` and updates a small fixed-position badge in the corner showing "Edit: ON" / "Edit: OFF".
- No selection, drag, or anything else yet. Just the toggle.

**Verify:** Open `fixtures/Townhall-1.html` in a browser, paste this into the console:
```javascript
var s = document.createElement('script'); s.src = '/editor.js'; document.body.appendChild(s);
```
Press `E`. Badge appears and toggles. Press `E` again. Badge updates.

### Task 1.2: Add Playwright fixture-loading helper
- Create `tests/_helpers.js` with a function `loadFixtureWithEditor(page, fixturePath)` that:
  1. Navigates to the fixture URL on the local dev server
  2. Waits for the deck to render
  3. Injects `editor.js` into the page
  4. Waits for the editor's "ready" log message
- Create `tests/01-bootstrap.spec.js` that uses this helper to load `fixtures/Townhall-1.html`, presses `E`, and asserts the edit-mode badge appears.

**Verify:** `npm test` passes.


### Verify by hand (Phase 1)
1. Load a fixture. Inject editor.js via the dev console.
2. Confirm "Edit: OFF" badge appears in the corner.
3. Press `E`. Badge changes to "Edit: ON".
4. Press `E` again. Badge changes back to "Edit: OFF".
5. With edit mode OFF, press ArrowRight. Slide still advances. (Editor must not break navigation when inactive.)


**Pre-commit check:** Run `git status`. Confirm only intended files are staged. No untracked HTML in `fixtures/` should appear unless deliberately allow-listed. If anything looks off, STOP and ask the human.

**Commit:** `feat(phase-1): editor.js bootstrap with edit-mode toggle` (do not push)

## Phase 2 — Selection *(TDD: build-first)* *(checkpoint)*

Implement selection and the visible ring first. Open a fixture in a browser, inject the editor, click on elements, and confirm by eye that the ring appears correctly, follows the element on scroll, and respects the "only descendants of `.slide.active`" scope. THEN write `tests/02-selection.spec.js` to lock in the behavior. Invoke `code-reviewer` before moving to Phase 3.

### Task 2.1: Click-to-select inside `.slide.active`
- When `editMode` is true: clicking on any descendant of `.slide.active` selects it.
- "Selected" is a single state slot: `state.selected = element`.
- Render a selection ring: a `<div class="wfp-selection-ring">` positioned absolutely over the selected element's bounding box.
- The ring updates on scroll, resize, or any DOM change to the selected element. Use `getBoundingClientRect()` to position it.
- Clicking on empty area deselects.
- Elements inside `#wfp-editor-root` are never selectable.
- The `.deck` and `.slide` containers themselves are not selectable; only their descendants are.

**Verify:** Test that clicks inside the active slide produce a visible ring. Test that clicks on the editor toolbar do not. Add `tests/02-selection.spec.js`.

### Task 2.2: Selection survives slide transitions
- If the user advances slides while edit mode is on, the previous selection is cleared.

**Verify:** Manually test. Add a Playwright test if straightforward.


### Verify by hand (Phase 2)
1. Load a fixture, inject editor, press `E`.
2. Click on a heading inside the active slide. Selection ring appears around it.
3. Click on a different element. Selection moves.
4. Click on empty area inside the slide. Selection clears.
5. Click on the edit-mode badge or any editor UI. NO selection occurs (editor UI is not selectable).
6. Try clicking on `.slide` itself (e.g. an empty corner). NO selection (only descendants are selectable).
7. Advance to a different slide. Selection from the previous slide is cleared.
8. Aesthetic check: ring should be subtle but clearly visible, not jarring against WFP's coral/peach palette.


**Pre-commit check:** Run `git status`. Confirm only intended files are staged. No untracked HTML in `fixtures/` should appear unless deliberately allow-listed. If anything looks off, STOP and ask the human.

**Commit:** `feat(phase-2): click-to-select with visible selection ring` (do not push)

## Phase 3 — Font-size keyboard nudge *(TDD: strict)*

Write `tests/03-font-size.spec.js` first. Confirm it fails. Then implement Task 3.1 until it passes. Invoke `code-reviewer` before moving to Phase 4.

### Task 3.1: ↑/↓ adjust font-size on selected text element
- When `editMode` is on AND a text-bearing element is selected:
  - `↑` increases inline `font-size` by 1px
  - `↓` decreases by 1px
  - `Shift+↑` / `Shift+↓` change by 5px
- "Text-bearing" means: contains at least one non-whitespace text node directly (not just nested children).
- Do not apply if no element is selected.
- `event.stopPropagation()` and `event.preventDefault()` so the change does not bubble to slide navigation.
- Each keystroke is one history entry (Phase 6 will handle history; for now, just apply).
- Minimum 8px. No max.

**Verify:** Add `tests/03-font-size.spec.js`. Select a heading, press ↑ five times, assert computed `font-size` increased by 5px.


### Verify by hand (Phase 3)
1. Select a heading. Press ↑ five times. Heading visibly grows (5px larger).
2. Press ↓ three times. Heading shrinks back partially.
3. Press Shift+↑ once. Heading jumps up 5px.
4. Hold ↓ until you hit the 8px minimum. Confirm it stops shrinking.
5. With edit mode OFF and a heading "selected" mentally, press ↑. Nothing happens (handler suppressed when edit mode off).


**Pre-commit check:** Run `git status`. Confirm only intended files are staged. No untracked HTML in `fixtures/` should appear unless deliberately allow-listed. If anything looks off, STOP and ask the human.

**Commit:** `feat(phase-3): font-size keyboard nudge on selected text` (do not push)

## Phase 4 — Drag *(TDD: strict)* *(checkpoint)*

This is the highest-risk phase due to the scale-transform math. Write `tests/04-drag.spec.js` first, including specific assertions about scale-corrected deltas (drag at 0.5 scale must produce 2x the pixel delta in slide space). Confirm it fails. Then implement Tasks 4.1 and 4.2. Invoke `code-reviewer` before moving to Phase 5.

### Task 4.1: Drag absolutely-positioned elements
- For elements with `getComputedStyle(el).position === 'absolute'`:
  - On `mousedown` inside the element body (not on a resize handle), start a drag.
  - Track `mousemove` deltas, divided by current canvas scale (see DESIGN.md "Coordinate system and scale").
  - Apply deltas to inline `top` and `left`, preserving any existing inline styles like `animation-delay`.
  - End on `mouseup`.

### Task 4.2: "Unlock" non-absolute elements before drag
- For elements that are NOT `position: absolute`:
  - On the first drag of this element: capture its `getBoundingClientRect()` and the offset relative to the nearest positioned ancestor.
  - Set inline `position: absolute; top: Xpx; left: Ypx; width: Wpx; height: Hpx`.
  - Show a small toast near the element: "Unlocked. Now positioned absolutely."
  - Then start the drag.

**Verify:** Add `tests/04-drag.spec.js`. Drag the WFP badge in `Townhall-1.html`'s active slide 100px right; assert its new `left` value reflects the move (after dividing by scale). Drag a `<p>` element that's flow-positioned, confirm it's converted to absolute.


### Verify by hand (Phase 4)
1. Select the WFP badge (top-right of slide 0). Drag it 200px to the left. Badge moves smoothly with the cursor.
2. Resize the browser window so the canvas scales to ~50%. Drag the badge again. The badge still tracks the cursor 1:1 (NOT half-speed). This confirms scale correction is working.
3. Select a flow-positioned `<p>` (e.g. a paragraph in slide 1). Drag it. Confirm:
   - A toast appears saying "Unlocked. Now positioned absolutely."
   - The paragraph follows the cursor.
   - Sibling elements don't reflow weirdly (they may shift slightly since the absolute element is now out of flow).
4. Drag feel check: short clicks (under 5px movement) should NOT move the element. Only deliberate drags should.
5. Press Cmd+Z. Element returns to original position. The unlock-to-absolute conversion is also undone.


**Pre-commit check:** Run `git status`. Confirm only intended files are staged. No untracked HTML in `fixtures/` should appear unless deliberately allow-listed. If anything looks off, STOP and ask the human.

**Commit:** `feat(phase-4): drag with scale-aware deltas and unlock-on-flow` (do not push)

## Phase 5 — Resize *(TDD: build-first)* *(checkpoint)*

Implement resize handles and resize logic first. Open a fixture, verify by eye that the 8 handles appear in the right places, that cursors are correct, that resize feels right. THEN write `tests/05-resize.spec.js` to lock in the dimensional behavior (which is testable; the visual placement is what's "build-first" here). Invoke `code-reviewer` before moving to Phase 6.

### Task 5.1: Render 8 resize handles around selected element
- 8 small squares: corners and edge midpoints. `<div class="wfp-handle wfp-handle-nw">`, etc.
- Position them on top of the selection ring.
- Pointer cursor adapts: `nwse-resize`, `ns-resize`, etc.

### Task 5.2: Resize via handle drag
- `mousedown` on a handle starts a resize. Track which handle.
- `mousemove` deltas (scale-corrected) update inline `width` and/or `height` and possibly `top`/`left` depending on which handle.
- Edge handles: change one dimension. Corner handles: change two.
- Top and left handles also adjust `top`/`left` so the opposite edge stays fixed.
- Minimum 8px on each axis.

**Verify:** Add `tests/05-resize.spec.js`. Resize a `.s0-glow-a` element via the SE handle and assert width/height changed.


### Verify by hand (Phase 5)
1. Select an element. 8 handles appear: 4 corners + 4 edge midpoints.
2. Hover over each handle. Cursor changes appropriately (`nwse-resize`, `ns-resize`, etc.).
3. Drag the SE corner handle. Element grows toward the bottom-right.
4. Drag the NW corner handle. Element grows toward the top-left (top and left adjust so the SE corner stays fixed).
5. Drag the N edge handle. Only height changes; width stays the same.
6. Resize at 50% canvas scale. Element growth tracks the cursor 1:1, not half-speed.
7. Try to resize below 8px. Resize stops; element doesn't shrink to nothing.
8. Aesthetic check: handles should be visible but unobtrusive. Small squares, not big chunky blocks.


**Pre-commit check:** Run `git status`. Confirm only intended files are staged. No untracked HTML in `fixtures/` should appear unless deliberately allow-listed. If anything looks off, STOP and ask the human.

**Commit:** `feat(phase-5): resize handles with dimensional changes` (do not push)

## Phase 6 — Undo/redo *(TDD: strict)*

Write `tests/06-undo.spec.js` first with assertions on history depth, undo restoring previous style, redo reapplying. Confirm it fails. Then implement Task 6.1. Invoke `code-reviewer` before moving to Phase 7.

### Task 6.1: History stack
- `state.history = []`, `state.historyIndex = -1`.
- A "change" is a snapshot: `{ element: HTMLElement, beforeStyle: string, afterStyle: string, beforeContent?: string, afterContent?: string }`.
- Each drag (start to mouseup) is one change. Each font-size keystroke is one change. Each text edit (enter to exit) is one change.
- On undo: apply `beforeStyle` and `beforeContent` to the element. Decrement index.
- On redo: apply `afterStyle` and `afterContent`. Increment index.
- Cmd/Ctrl+Z = undo. Cmd/Ctrl+Shift+Z or Cmd/Ctrl+Y = redo.
- Cap at 50 entries; older changes drop off.

**Verify:** Add `tests/06-undo.spec.js`. Drag an element, undo, assert original position. Redo, assert dragged position.


### Verify by hand (Phase 6)
1. Make 5 changes (e.g. drag, font-size up, drag again, font-size down, text edit).
2. Press Cmd+Z five times. Each undo reverses one change in reverse order.
3. Press Cmd+Shift+Z three times. Three changes reapply in original order.
4. Make a NEW change after partial undo. Confirm the redo stack clears (typical undo/redo semantics).
5. Hold Cmd+Z to spam undo. No errors. Undoing past index 0 is a no-op.


**Pre-commit check:** Run `git status`. Confirm only intended files are staged. No untracked HTML in `fixtures/` should appear unless deliberately allow-listed. If anything looks off, STOP and ask the human.

**Commit:** `feat(phase-6): undo/redo history stack` (do not push)

## Phase 7 — Inline text edit *(TDD: strict)*

Write `tests/07-text-edit.spec.js` first. Confirm it fails. Then implement Task 7.1. Invoke `code-reviewer` before moving to Phase 8.

### Task 7.1: Double-click to edit
- Double-click any text-bearing element → set `contenteditable="true"`, focus it, place caret at click point.
- Click outside, Escape, or Tab exits edit mode and applies. Set `contenteditable="false"`.
- Capture the change as one history entry (before/after `innerHTML`).
- During edit mode, the selection ring is hidden so it doesn't interfere with the caret.
- Existing inline HTML (e.g. `<br>`) is preserved.

**Verify:** Add `tests/07-text-edit.spec.js`. Double-click a heading, type a new value, press Escape. Assert the heading text changed and is preserved on undo.


### Verify by hand (Phase 7)
1. Double-click a heading. Cursor appears in the heading; you can type.
2. Type new text. The change is reflected live.
3. Press Escape. Edit mode exits. Heading shows the new text.
4. Press Cmd+Z. Original text restored.
5. Double-click a paragraph that contains a `<br>`. Edit one line of text. Press Tab. Confirm the `<br>` is preserved (the line break didn't disappear).
6. While in text-edit mode, the selection ring should be hidden so it doesn't interfere with the cursor.


**Pre-commit check:** Run `git status`. Confirm only intended files are staged. No untracked HTML in `fixtures/` should appear unless deliberately allow-listed. If anything looks off, STOP and ask the human.

**Commit:** `feat(phase-7): inline text editing via double-click` (do not push)

## Phase 8 — Export *(TDD: strict)* *(checkpoint)*

Write `tests/08-export.spec.js` first with assertions on the exported HTML: editor DOM removed, script tag removed, edits present, file is valid HTML that opens in a fresh browser. Confirm it fails. Then implement Task 8.1. Invoke `code-reviewer` before moving to Phase 9.

### Task 8.1: Cmd+S triggers export
- Clone `document.documentElement`.
- Remove `#wfp-editor-root`.
- Remove `<script>` tags whose `src` includes `editor.js`.
- Strip all `data-wfp-edit-*` attributes from any element.
- Strip any `contenteditable` attributes.
- Serialize: `'<!DOCTYPE html>\n' + clone.outerHTML`.
- Trigger a download. Filename: original basename + `-edited.html`. (Read the basename from `location.pathname`.)
- Show a toast: "Exported to [filename]".

**Verify:** Add `tests/08-export.spec.js`. Make a font-size change, export, parse the downloaded file, assert the change is in the inline style and the editor DOM is gone. Open the exported file in a fresh browser tab and confirm it renders.


### Verify by hand (Phase 8)
1. Make several changes: drag a logo, increase a heading's font size, edit a paragraph's text.
2. Press Cmd+S. A file downloads named `Townhall-1-edited.html` (or similar).
3. Open the downloaded file in a fresh browser tab (NO editor injected).
4. Confirm: all your changes are visible. The slide looks exactly as it did when you exported.
5. Confirm: NO editor UI is visible. No "Edit: OFF" badge, no toolbar, no selection ring.
6. View the file's source. Confirm: no `<div id="wfp-editor-root">`, no `<script src="...editor.js">`, no `data-wfp-edit-*` attributes, no `contenteditable="true"` left over.
7. Press ArrowRight in the exported file. Slide navigation still works.


**Pre-commit check:** Run `git status`. Confirm only intended files are staged. No untracked HTML in `fixtures/` should appear unless deliberately allow-listed. If anything looks off, STOP and ask the human.

**Commit:** `feat(phase-8): export modified HTML with editor DOM stripped` (do not push)

## Phase 9 — Edit-mode toggle polish *(TDD: build-first)* *(checkpoint)*

Implement Tasks 9.1 and 9.2 first. Verify by eye that the toolbar looks unobtrusive and doesn't overlap slide content. THEN write `tests/09-end-to-end.spec.js` covering ALL "Done criteria" items in REQUIREMENTS.md, run against the two pinned primaries (`Townhall-1.html` and `boilerplate.html`) AND a randomly selected rotation fixture (use `pickRandomRotationFixture` from `tests/_helpers.js`). Invoke `code-reviewer` before moving to Phase 10.

### Task 9.1: Suppress slide navigation while edit mode is on
- Edit-mode keydown handler runs in the capture phase: `document.addEventListener('keydown', handler, true)`.
- When edit mode is on AND the user presses ArrowLeft/Right/Space, call `stopPropagation()` and `preventDefault()`.
- When edit mode is off, pass through.

### Task 9.2: Toolbar with Edit toggle and Export buttons
- Small fixed toolbar in the top-right of the viewport (NOT the slide).
- Buttons: "Edit (E)", "Export (Ctrl+S)", "Undo (Ctrl+Z)", "Redo (Ctrl+Shift+Z)".
- Subtle styling. Do not interfere with the slide content visually.
- Toolbar is hidden when edit mode is off. (The "Edit" button itself remains visible to allow toggling.)

**Verify:** Run all tests. Run final `tests/09-end-to-end.spec.js` against `fixtures/Townhall-1.html` AND a randomly chosen second fixture, exercising every interaction listed in the REQUIREMENTS.md "Done criteria for v1" checklist.


### Verify by hand (Phase 9)
This is the final hand-check before declaring v1 done. Walk through the full "Done criteria for v1" checklist in REQUIREMENTS.md, on BOTH fixtures:
1. Bookmarklet loads editor.js without console errors.
2. Press `E` toggles edit mode.
3. Click selects a heading; ring appears.
4. ↑ five times grows font by 5px.
5. Drag heading 50px right; movement matches cursor at any zoom level.
6. Drag a logo; press Cmd+Z; logo returns.
7. Double-click paragraph, type, Escape; text changes.
8. Cmd+S downloads HTML; opening it shows edits with no editor UI.
9. Edit mode OFF: ArrowRight navigates slides.
10. Edit mode ON: ArrowRight does NOT navigate slides.

If all 10 pass on both fixtures, v1 is done.


**Pre-commit check:** Run `git status`. Confirm only intended files are staged. No untracked HTML in `fixtures/` should appear unless deliberately allow-listed. If anything looks off, STOP and ask the human.

**Commit:** `feat(phase-9): toolbar polish and keyboard suppression in edit mode` (do not push)

## Phase 10 — Bookmarklet *(TDD: build-first)*

Implement Tasks 10.1 and 10.2 first. Manually run through the setup steps once: build the bookmarklet, drag it to your bookmarks bar, click it on a real local slide, confirm the editor loads. THEN add a small test that verifies `npm run build:bookmarklet` produces a valid bookmarklet string under 1KB. Final `code-reviewer` invocation before declaring v1 done.

### Task 10.1: Build the bookmarklet string
- Create `scripts/build-bookmarklet.js`.
- Reads a template URL from `EDITOR_URL` env var, default `https://[user].github.io/wfp-slide-editor/editor.js`.
- Supports a `--local` flag that overrides the URL to `http://localhost:8080/editor.js` (for users who chose Option B in SETUP.md).
- Outputs the bookmarklet string to stdout AND writes `bookmarklet.txt`.
- Format: `javascript:(function(){var s=document.createElement('script');s.src='URL'+(URL.includes('?')?'&':'?')+Date.now();document.body.appendChild(s);})();`

### Task 10.2: Document setup in README.md
- Add a "Setup" section with steps:
  1. Create a public GitHub repo with this project's contents
  2. Enable GitHub Pages (Settings → Pages → Source: main branch, root)
  3. Wait for the first deploy
  4. Run `EDITOR_URL=https://[user].github.io/[repo]/editor.js npm run build:bookmarklet`
  5. Drag the resulting bookmarklet to your bookmarks bar

**Verify:** Manually run through the setup steps once. Click the bookmarklet on a real slide hosted from `file://` or `localhost`. Editor loads.


### Verify by hand (Phase 10)
1. Run `EDITOR_URL=https://[your-username].github.io/wfp-slide-editor/editor.js npm run build:bookmarklet`.
2. Confirm `bookmarklet.txt` is created and contains a `javascript:...` string under 1KB.
3. Drag the bookmarklet to your browser's bookmarks bar.
4. Open a real WFP slide HTML on your local machine.
5. Click the bookmarklet. Editor loads. Press `E`. Edit mode activates.
6. Make a change, export. Confirm the round-trip works end-to-end.
7. Push a small change to `editor.js`. Wait ~1 minute for GitHub Pages to redeploy.
8. Click the bookmarklet on a fresh slide. Confirm the new version is loaded (the cache-buster ensures freshness).


**Pre-commit check:** Run `git status`. Confirm only intended files are staged. No untracked HTML in `fixtures/` should appear unless deliberately allow-listed. If anything looks off, STOP and ask the human.

**Commit:** `feat(phase-10): bookmarklet generator and setup docs` (do not push)

## Done

When all phases pass, all `code-reviewer` invocations have approved, and a final end-to-end run on two fixtures is green: mark v1 shipped. After human confirms the bookmarklet works end-to-end on a real slide, tag the release:

```
git tag v1.0.0
git push --tags
```

Then open `ROADMAP.md` and pick the first v2 item.
