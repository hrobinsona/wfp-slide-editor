import { test, expect } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { EDITOR_PATH } from './_helpers.js';

// Two independent inspector-chrome fixes:
//
// 1. Perf — the R2 idle selection-tracking rAF loop (40-helpers-selection-
//    inspector.js) now dirty-checks bounding rects each tick and only pays
//    for a full refreshSelection() when something actually moved. The tests
//    above pin the R2 guarantee this loop exists for in the first place:
//    the ring (and, separately, an annotation marker on a non-selected
//    element) must still catch up to something that moves with no editor
//    event at all (e.g. a host-page animation).
//
// 2. A11y — the opacity slider's one-history-entry-per-drag session used to
//    open only on `mousedown`, so keyboard users focusing the slider and
//    pressing arrow keys moved the native thumb without ever touching the
//    element's opacity (and the thumb snapped back on the next repopulate).
//    The session now opens lazily on the first `input` when none is open,
//    and settles (rather than closing immediately) when that session was
//    opened by keyboard, since a native range input fires `change`
//    immediately after every keyboard-driven `input` — including every
//    tick of OS key auto-repeat — unlike a mouse drag. Holding state.txn
//    open across that settle window is only safe because it is registered
//    with 50-history.js's pending-txn-flush mechanism: any other gesture
//    that calls beginTxn() while the window is open (a text edit, a drag)
//    forces the pending session to finalize as its own history entry
//    first, so it can neither merge an unrelated change into itself nor
//    swallow another beginTxn() call's own options.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const FIXTURE_PATH = path.join(PROJECT_ROOT, 'fixtures', 'foreign-deck.html');

test.use({ viewport: { width: 2000, height: 1200 } });

async function loadReady(page) {
  await page.goto(pathToFileURL(FIXTURE_PATH).href);
  await page.locator('.slide.active').first().waitFor({ state: 'attached', timeout: 10_000 });
  await page.addScriptTag({ path: EDITOR_PATH });
  await page.waitForFunction(() => window.__wfpEditorReady === true, null, { timeout: 10_000 });
  await page.keyboard.press('e');
}

async function clickToSelect(page, selector) {
  await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    const r = el.getBoundingClientRect();
    el.dispatchEvent(
      new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
        view: window,
        clientX: r.left + r.width / 2,
        clientY: r.top + r.height / 2,
      }),
    );
  }, selector);
}

async function ringState(page) {
  return page.evaluate(() => {
    const ring = document.querySelector('#wfp-editor-root .wfpe-selection-ring');
    return {
      display: ring.style.display,
      top: parseFloat(ring.style.top || '0'),
      left: parseFloat(ring.style.left || '0'),
      width: parseFloat(ring.style.width || '0'),
      height: parseFloat(ring.style.height || '0'),
    };
  });
}

async function rectOf(page, selector) {
  return page.evaluate((sel) => {
    const r = document.querySelector(sel).getBoundingClientRect();
    return { top: r.top, left: r.left, width: r.width, height: r.height };
  }, selector);
}

async function waitForAnimationFrames(page, count = 2) {
  await page.evaluate((frames) => new Promise((resolve) => {
    function tick(remaining) {
      if (remaining <= 0) {
        resolve();
        return;
      }
      requestAnimationFrame(() => tick(remaining - 1));
    }
    tick(frames);
  }), count);
}

async function readOpacity(page, selector) {
  return page.evaluate(
    (sel) => parseFloat(getComputedStyle(document.querySelector(sel)).opacity),
    selector,
  );
}

async function readOffsetLeft(page, selector) {
  return page.evaluate((sel) => document.querySelector(sel).offsetLeft, selector);
}

async function readFontSize(page, selector) {
  return page.evaluate(
    (sel) => Math.round(parseFloat(getComputedStyle(document.querySelector(sel)).fontSize)),
    selector,
  );
}

// Drags the inspector's font field (~1px of font size per 3 pointer px)
// using dispatched pointer events rather than page.mouse. The gesture is
// real — it runs the whole scrub session in 85-adaptive-fade.js, including
// its startInspectorTxn() — but it is addressed to the field element
// instead of to screen coordinates, because any live edit re-lays out the
// inspector stack mid-gesture (the value tag joins the stack and shifts the
// rows by ~130px while the transition runs). Hit-testing against a moving
// panel is what would make this flaky; the element reference does not move.
async function scrubFontField(page, dx) {
  await page.evaluate((delta) => {
    const wrap = document.querySelector(
      '#wfp-editor-root .wfpe-inspector-row[data-wfpe-row="font-size"] .wfpe-inspector-field',
    );
    const r = wrap.getBoundingClientRect();
    const x = r.left + r.width / 2;
    const base = {
      pointerId: 1,
      pointerType: 'mouse',
      isPrimary: true,
      button: 0,
      buttons: 1,
      bubbles: true,
      cancelable: true,
      clientY: r.top + r.height / 2,
    };
    wrap.dispatchEvent(new PointerEvent('pointerdown', { ...base, clientX: x }));
    for (const fraction of [0.4, 0.75, 1]) {
      wrap.dispatchEvent(new PointerEvent('pointermove', { ...base, clientX: x + delta * fraction }));
    }
    wrap.dispatchEvent(new PointerEvent('pointerup', { ...base, buttons: 0, clientX: x + delta }));
  }, dx);
}

// Fires a toolbar action WITHOUT moving focus. A real click on the Undo/Redo
// button would blur the opacity slider first, and the slider's own blur
// handler closes the settle window — flushing the pending session through a
// different route and hiding whatever undo()/redo() do (or fail to do) on
// their own. Dispatching the click leaves focus on the slider, so the
// settle timer is still armed when undo/redo runs. The keyboard shortcut is
// unavailable for the same reason: the document keydown handler defers to
// any focused <input>, so Cmd+Z never reaches undo while the slider holds
// focus.
async function fireToolbarAction(page, action) {
  await page.evaluate((name) => {
    document
      .querySelector(`#wfp-editor-root .wfpe-toolbar-btn[data-action="${name}"]`)
      .dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  }, action);
}

// One unrelated committed history entry: moves the element to x=333 through
// the inspector, then returns focus to the document so nothing of this edit
// is still open.
async function commitUnrelatedXEdit(page, selector) {
  const xInput = page.locator('#wfp-editor-root .wfpe-inspector input[data-wfpe-prop="x"]');
  await xInput.click({ clickCount: 3 });
  await xInput.fill('333');
  await xInput.press('Enter');
  await xInput.evaluate((el) => el.blur());
  expect(await readOffsetLeft(page, selector)).toBe(333);
}

// Opens a keyboard opacity session and leaves its settle window ARMED:
// arrow presses with no blur afterwards, so state.txn is still held open
// when the caller does whatever it is testing.
async function openPendingOpacitySession(page, selector, presses = 3) {
  const before = await readOpacity(page, selector);
  const slider = page.locator('#wfp-editor-root .wfpe-inspector input[data-wfpe-prop="opacitySlider"]');
  await slider.focus();
  for (let i = 0; i < presses; i += 1) await page.keyboard.press('ArrowLeft');
  const after = await readOpacity(page, selector);
  expect(after).toBeCloseTo(before - presses / 100, 2);
  return { before, after };
}

test.describe('Selection tracking perf (idle dirty-check)', () => {
  test('idle tracking loop catches up to an element that moves without an editor event', async ({ page }) => {
    await loadReady(page);
    await clickToSelect(page, '.slide.active .resize-target');

    const initial = await ringState(page);
    expect(initial.display).toBe('block');

    // No editor event fires here — this simulates a host-page animation or
    // script moving the selected element. Only the idle rAF loop's own
    // rect comparison (not any explicit refreshSelection() call site) can
    // notice this and reposition the ring.
    await page.evaluate(() => {
      const el = document.querySelector('.slide.active .resize-target');
      const cs = getComputedStyle(el);
      el.style.left = `${(parseFloat(cs.left) || 0) + 40}px`;
      el.style.top = `${(parseFloat(cs.top) || 0) + 25}px`;
    });

    await waitForAnimationFrames(page, 6);

    const ring = await ringState(page);
    const target = await rectOf(page, '.slide.active .resize-target');
    expect(ring.display).toBe('block');
    expect(ring.top).toBeCloseTo(target.top, 0);
    expect(ring.left).toBeCloseTo(target.left, 0);
    expect(ring.width).toBeCloseTo(target.width, 0);
    expect(ring.height).toBeCloseTo(target.height, 0);
  });

  test('idle tracking loop catches up to an annotated (non-selected) element that moves on its own', async ({ page }) => {
    await loadReady(page);

    // Annotate one element, then select a different one — the marker for
    // the annotated element must keep tracking even though it isn't the
    // selection driving the loop.
    //
    // Saving the annotation via direct DOM dispatch — not Playwright's
    // locator .fill()/.click(), which perform a real scroll-into-view step
    // first — matters here: that step's settle can still fire `scroll`
    // events for several frames afterward, and the editor's own unrelated,
    // pre-existing `window.addEventListener('scroll', refreshSelection,
    // true)` (70-selection-events.js) would drive a full refresh on its
    // own, masking whether the idle tick's annotated-element comparison
    // does anything at all. The explicit scroll-count assertion below
    // keeps that confound from silently coming back.
    await clickToSelect(page, '.slide.active .foreign-note');
    await page.evaluate(() => {
      const textarea = document.querySelector('#wfp-editor-root .wfpe-annotation-input');
      textarea.value = 'Track me while unselected.';
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
      document.querySelector('#wfp-editor-root .wfpe-annotation-save-btn').dispatchEvent(
        new MouseEvent('click', { bubbles: true, cancelable: true }),
      );
    });
    await clickToSelect(page, '.slide.active .resize-target');
    await expect(page.locator('#wfp-editor-root .wfpe-annotation-badge')).toHaveCount(1);

    await page.evaluate(() => {
      window.__wfpeScrollCount = 0;
      window.addEventListener('scroll', () => { window.__wfpeScrollCount += 1; }, true);
      const el = document.querySelector('.slide.active .foreign-note');
      const cs = getComputedStyle(el);
      el.style.left = `${(parseFloat(cs.left) || 0) + 30}px`;
    });

    await waitForAnimationFrames(page, 6);

    // Confirms this test genuinely isolates the idle tick's own
    // comparison: nothing else (scroll-triggered or otherwise) drove a
    // refresh during the observation window.
    expect(await page.evaluate(() => window.__wfpeScrollCount)).toBe(0);

    const marker = await page.evaluate(() => {
      const badge = document.querySelector('#wfp-editor-root .wfpe-annotation-badge');
      const note = document.querySelector('.slide.active .foreign-note').getBoundingClientRect();
      return {
        left: parseFloat(badge.style.left || '0'),
        top: parseFloat(badge.style.top || '0'),
        expectedLeft: note.right - 13 + 6,
        expectedTop: note.top - 6,
      };
    });
    expect(marker.left).toBeCloseTo(marker.expectedLeft, 0);
    expect(marker.top).toBeCloseTo(marker.expectedTop, 0);
  });
});

test.describe('Opacity slider keyboard input', () => {
  test('arrow-key input on the focused opacity slider applies to the selected element and is undoable', async ({ page }) => {
    await loadReady(page);
    await clickToSelect(page, '.slide.active .resize-target');

    const before = await readOpacity(page, '.slide.active .resize-target');

    const slider = page.locator('#wfp-editor-root .wfpe-inspector input[data-wfpe-prop="opacitySlider"]');
    await slider.focus();
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowLeft');

    const afterPresses = await readOpacity(page, '.slide.active .resize-target');
    expect(afterPresses).toBeCloseTo(before - 0.03, 2);

    // No snap-back: the slider's own displayed value must agree with what
    // was actually applied to the element, not silently disagree with it.
    const sliderValue = Number(await slider.inputValue());
    expect(sliderValue).toBe(Math.round(afterPresses * 100));

    // The editor's document-level keydown handler treats any focused
    // <input> (including this slider) as a typing target and defers to it
    // completely — Cmd/Ctrl+Z only reaches undo once focus has moved off
    // the control, same as it would for the number input or a text field.
    // Blurring also flushes the settle timer below immediately, matching
    // how a keyboard user would actually invoke undo right after.
    await slider.evaluate((el) => el.blur());

    // A native <input type=range> fires `change` immediately after every
    // keyboard-driven `input`, unlike a mouse drag where it fires once at
    // release (verified directly against Chromium) — so the whole press
    // burst above settled into ONE session (see the held-key test below
    // for the mechanism): one undo restores the full pre-keyboard value.
    await page.keyboard.press('ControlOrMeta+z');
    expect(await readOpacity(page, '.slide.active .resize-target')).toBeCloseTo(before, 2);

    // Redo re-applies the whole burst as one step too.
    await page.keyboard.press('ControlOrMeta+y');
    expect(await readOpacity(page, '.slide.active .resize-target')).toBeCloseTo(afterPresses, 2);
  });

  test('holding the opacity slider arrow key coalesces the whole burst into one undo step and does not evict older history', async ({ page }) => {
    await loadReady(page);
    await clickToSelect(page, '.slide.active .resize-target');

    // An unrelated prior edit with its own history entry — proves the
    // keyboard burst below doesn't evict it. Chromium fires `change`
    // immediately after every keyboard-driven `input` on a range slider,
    // including every tick of OS key auto-repeat while a key is held —
    // without the settle-timer fix, a ~12-tick hold would previously have
    // produced 12 separate history entries.
    const xInput = page.locator('#wfp-editor-root .wfpe-inspector input[data-wfpe-prop="x"]');
    await xInput.click({ clickCount: 3 });
    await xInput.fill('333');
    await xInput.press('Enter');
    expect(await page.evaluate(() => document.querySelector('.slide.active .resize-target').offsetLeft)).toBe(333);

    const before = await readOpacity(page, '.slide.active .resize-target');

    const slider = page.locator('#wfp-editor-root .wfpe-inspector input[data-wfpe-prop="opacitySlider"]');
    await slider.focus();

    // Simulate a genuinely held arrow key: repeated keydowns with no
    // keyup in between (matches OS auto-repeat), then a single keyup.
    for (let i = 0; i < 12; i += 1) {
      await page.keyboard.down('ArrowLeft');
    }
    await page.keyboard.up('ArrowLeft');

    const afterBurst = await readOpacity(page, '.slide.active .resize-target');
    expect(afterBurst).toBeCloseTo(before - 0.12, 2);

    await slider.evaluate((el) => el.blur());

    // One undo restores the WHOLE burst in a single step...
    await page.keyboard.press('ControlOrMeta+z');
    expect(await readOpacity(page, '.slide.active .resize-target')).toBeCloseTo(before, 2);
    // ...leaving the unrelated prior edit untouched and still in history...
    expect(await page.evaluate(() => document.querySelector('.slide.active .resize-target').offsetLeft)).toBe(333);
    // ...so a second undo is the one that reverts it.
    await page.keyboard.press('ControlOrMeta+z');
    expect(await page.evaluate(() => document.querySelector('.slide.active .resize-target').offsetLeft)).not.toBe(333);
  });

  test('opacity slider arrow-key presses do not bubble to editor shortcuts', async ({ page }) => {
    await loadReady(page);
    await clickToSelect(page, '.slide.active .resize-target');

    const slider = page.locator('#wfp-editor-root .wfpe-inspector input[data-wfpe-prop="opacitySlider"]');
    await slider.focus();
    // ArrowRight, not ArrowLeft: starting on the first slide, the
    // fixture's own nav script clamps ArrowLeft to a no-op regardless of
    // whether the guard leaks, so it can't prove anything either way.
    // ArrowRight would visibly advance to slide 2 if this leaked, which is
    // what makes the assertion below load-bearing.
    await page.keyboard.press('ArrowRight');

    const stillOnFirstSlide = await page.evaluate(
      () => document.querySelector('.slide.active')?.id === 'foreign-slide-1',
    );
    expect(stillOnFirstSlide).toBe(true);
  });

  test('an opacity keyboard burst finalizes as its own entry when a text edit starts within the settle window', async ({ page }) => {
    await loadReady(page);
    await clickToSelect(page, '.slide.active .foreign-title');

    const before = await readOpacity(page, '.slide.active .foreign-title');
    const originalText = await page.evaluate(() => document.querySelector('.slide.active .foreign-title').textContent);

    const slider = page.locator('#wfp-editor-root .wfpe-inspector input[data-wfpe-prop="opacitySlider"]');
    await slider.focus();
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowLeft');
    const afterPresses = await readOpacity(page, '.slide.active .foreign-title');
    expect(afterPresses).toBeCloseTo(before - 0.02, 2);

    // Start (and commit) a text edit on the SAME element WITHOUT waiting
    // for the settle window to expire. Without the pending-txn-flush fix,
    // beginTxn()'s reentry guard would let this silently reuse the
    // opacity session's still-open transaction — captureHtml:true would
    // never take effect, so no innerHTML snapshot is captured and the
    // typed text becomes permanently un-undoable.
    await page.evaluate(() => {
      const el = document.querySelector('.slide.active .foreign-title');
      const r = el.getBoundingClientRect();
      el.dispatchEvent(new MouseEvent('dblclick', {
        bubbles: true,
        cancelable: true,
        view: window,
        clientX: r.left + r.width / 2,
        clientY: r.top + r.height / 2,
      }));
    });
    await page.evaluate(() => {
      document.querySelector('.slide.active .foreign-title').textContent = 'EDITED TEXT';
    });
    await page.keyboard.press('Escape'); // commits the text edit (endTextEdit, not a revert)
    expect(await page.evaluate(() => document.querySelector('.slide.active .foreign-title').textContent)).toBe('EDITED TEXT');

    // One undo reverts the text edit — its own, separate entry — leaving
    // the opacity change from before it untouched...
    await page.keyboard.press('ControlOrMeta+z');
    expect(await page.evaluate(() => document.querySelector('.slide.active .foreign-title').textContent)).toBe(originalText);
    expect(await readOpacity(page, '.slide.active .foreign-title')).toBeCloseTo(afterPresses, 2);

    // ...and a second undo is the one that reverts the opacity burst.
    await page.keyboard.press('ControlOrMeta+z');
    expect(await readOpacity(page, '.slide.active .foreign-title')).toBeCloseTo(before, 2);
  });

  test('an opacity keyboard burst finalizes as its own entry when a drag starts within the settle window', async ({ page }) => {
    await loadReady(page);
    await clickToSelect(page, '.slide.active .resize-target');

    const before = await readOpacity(page, '.slide.active .resize-target');
    const leftBefore = await page.evaluate(() => document.querySelector('.slide.active .resize-target').offsetLeft);

    const slider = page.locator('#wfp-editor-root .wfpe-inspector input[data-wfpe-prop="opacitySlider"]');
    await slider.focus();
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowLeft');
    const afterPresses = await readOpacity(page, '.slide.active .resize-target');
    expect(afterPresses).toBeCloseTo(before - 0.02, 2);

    // Drag the SAME element WITHOUT waiting for the settle window to
    // expire, via real mouse gestures — the drag's own mousedown calls
    // preventDefault() (80-drag-resize-unlock.js), which suppresses the
    // blur that would otherwise have flushed the opacity session another
    // way, so this specifically exercises the pending-txn-flush fix
    // rather than a blur-driven flush. Without the fix, beginTxn()'s
    // reentry guard would let the drag silently merge into the opacity
    // session's still-open transaction, so one undo would revert both the
    // move and the opacity change together instead of as two steps.
    const target = await page.evaluate(() => {
      const el = document.querySelector('.slide.active .resize-target');
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });
    await page.mouse.move(target.x, target.y);
    await page.mouse.down();
    await page.mouse.move(target.x + 60, target.y + 40, { steps: 5 });
    await page.mouse.up();

    const leftAfterDrag = await page.evaluate(() => document.querySelector('.slide.active .resize-target').offsetLeft);
    expect(leftAfterDrag).not.toBe(leftBefore);
    expect(await readOpacity(page, '.slide.active .resize-target')).toBeCloseTo(afterPresses, 2);

    // The document-level keydown handler defers entirely to any focused
    // <input> — the drag's preventDefault() kept focus on the slider
    // throughout, so undo needs an explicit blur first, same as the other
    // keyboard tests above.
    await slider.evaluate((el) => el.blur());

    // One undo reverts the drag — its own, separate entry — leaving the
    // opacity change untouched...
    await page.keyboard.press('ControlOrMeta+z');
    expect(await page.evaluate(() => document.querySelector('.slide.active .resize-target').offsetLeft)).toBe(leftBefore);
    expect(await readOpacity(page, '.slide.active .resize-target')).toBeCloseTo(afterPresses, 2);

    // ...and a second undo is the one that reverts the opacity burst.
    await page.keyboard.press('ControlOrMeta+z');
    expect(await readOpacity(page, '.slide.active .resize-target')).toBeCloseTo(before, 2);
  });

  test('an inspector commit within the settle window lands as its own entry with no text edit open', async ({ page }) => {
    await loadReady(page);
    await clickToSelect(page, '.slide.active .resize-target');

    const fontBefore = await readFontSize(page, '.slide.active .resize-target');
    const { before, after } = await openPendingOpacitySession(page, '.slide.active .resize-target', 2);

    // Scrub the inspector's FONT field while the opacity settle window is
    // still armed. This is the inspector-to-inspector case with NO text
    // edit open: startInspectorTxn() never enters its `state.editingText`
    // branch and goes straight to beginTxn(), whose flush is then the ONLY
    // thing separating the two commits. Restoring an `if (!state.txn)`
    // guard around that beginTxn() call reintroduces exactly the bug this
    // pins — the scrub would find the slot already occupied by the opacity
    // session, skip its own transaction, and fold both edits into one
    // history entry.
    //
    // The scrub is the one product gesture that genuinely reaches this
    // state: its pointerdown calls preventDefault() (85-adaptive-fade.js)
    // so the field never steals focus, which is why the slider does not
    // blur and the settle window survives. The assertion below confirms
    // focus really did stay on the slider — i.e. the window was open, not
    // already flushed by a blur.
    await scrubFontField(page, 30);

    const fontAfter = await readFontSize(page, '.slide.active .resize-target');
    expect(fontAfter).toBe(fontBefore + 10);
    expect(await readOpacity(page, '.slide.active .resize-target')).toBeCloseTo(after, 2);
    expect(await page.evaluate(() => document.activeElement.dataset.wfpeProp)).toBe('opacitySlider');

    // Two entries, in gesture order: the scrub undoes first, leaving the
    // opacity burst standing...
    await fireToolbarAction(page, 'undo');
    expect(await readFontSize(page, '.slide.active .resize-target')).toBe(fontBefore);
    expect(await readOpacity(page, '.slide.active .resize-target')).toBeCloseTo(after, 2);

    // ...and the second undo is the one that reverts the opacity.
    await fireToolbarAction(page, 'undo');
    expect(await readOpacity(page, '.slide.active .resize-target')).toBeCloseTo(before, 2);
  });
});

// A pending settle-window session is an uncommitted edit parked in the
// shared txn slot. beginTxn() has always flushed it; undo()/redo() move the
// same cursor and now flush it too. Both tests below invoke undo/redo
// through the toolbar with the slider still focused, because every keyboard
// route to undo is deliberately deferred to the focused control — and a
// real button click would blur the slider, closing the window through the
// blur handler instead of through the code under test.
test.describe('Undo/redo flush pending settle-window sessions', () => {
  test('undo finalizes a pending opacity burst before it moves the history cursor', async ({ page }) => {
    await loadReady(page);
    await clickToSelect(page, '.slide.active .resize-target');
    await commitUnrelatedXEdit(page, '.slide.active .resize-target');

    const { before, after } = await openPendingOpacitySession(page, '.slide.active .resize-target');

    // Undo while the settle timer is still armed. Without the flush, this
    // undo restores the x-edit's `before` snapshot — a whole-attribute
    // `style` write that silently erases the live opacity edit — and the
    // session's own timer then commits from the moved cursor, truncating
    // the redo stack. With it, the burst becomes its own entry first and
    // this undo simply reverts that entry, leaving x=333 untouched.
    await fireToolbarAction(page, 'undo');
    expect(await readOpacity(page, '.slide.active .resize-target')).toBeCloseTo(before, 2);
    expect(await readOffsetLeft(page, '.slide.active .resize-target')).toBe(333);

    // The redo stack survived: the burst comes back as one step.
    await fireToolbarAction(page, 'redo');
    expect(await readOpacity(page, '.slide.active .resize-target')).toBeCloseTo(after, 2);
    expect(await readOffsetLeft(page, '.slide.active .resize-target')).toBe(333);

    // And the x edit is still a separate step behind it.
    await fireToolbarAction(page, 'undo');
    await fireToolbarAction(page, 'undo');
    expect(await readOffsetLeft(page, '.slide.active .resize-target')).not.toBe(333);
  });

  test('redo finalizes a pending opacity burst instead of re-applying a superseded entry', async ({ page }) => {
    await loadReady(page);
    await clickToSelect(page, '.slide.active .resize-target');
    await commitUnrelatedXEdit(page, '.slide.active .resize-target');

    // Undo the x edit so there is something on the redo stack, then start
    // an opacity burst on top of that cursor position.
    await page.keyboard.press('ControlOrMeta+z');
    const xUndone = await readOffsetLeft(page, '.slide.active .resize-target');
    expect(xUndone).not.toBe(333);

    const { before, after } = await openPendingOpacitySession(page, '.slide.active .resize-target');

    // The burst is a new change made from this cursor, so it invalidates
    // the redo stack — exactly what pushHistoryEntry does for every other
    // committed change. Flushing first makes redo see that: it becomes a
    // no-op. Without the flush, redo re-applies the stale x entry, whose
    // whole-attribute style write silently discards the live opacity edit.
    await fireToolbarAction(page, 'redo');
    expect(await readOffsetLeft(page, '.slide.active .resize-target')).toBe(xUndone);
    expect(await readOpacity(page, '.slide.active .resize-target')).toBeCloseTo(after, 2);

    // The burst is a normal entry now, so it undoes and redoes cleanly.
    await fireToolbarAction(page, 'undo');
    expect(await readOpacity(page, '.slide.active .resize-target')).toBeCloseTo(before, 2);
    await fireToolbarAction(page, 'redo');
    expect(await readOpacity(page, '.slide.active .resize-target')).toBeCloseTo(after, 2);
  });
});
