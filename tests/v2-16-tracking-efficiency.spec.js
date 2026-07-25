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
//    tick of OS key auto-repeat — unlike a mouse drag.

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
    await clickToSelect(page, '.slide.active .foreign-note');
    await page.locator('#wfp-editor-root .wfpe-annotation-input').fill('Track me while unselected.');
    await page.locator('#wfp-editor-root .wfpe-annotation-save-btn').click();
    await clickToSelect(page, '.slide.active .resize-target');
    await expect(page.locator('#wfp-editor-root .wfpe-annotation-badge')).toHaveCount(1);

    await page.evaluate(() => {
      const el = document.querySelector('.slide.active .foreign-note');
      const cs = getComputedStyle(el);
      el.style.left = `${(parseFloat(cs.left) || 0) + 30}px`;
    });

    await waitForAnimationFrames(page, 6);

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
    await page.keyboard.press('ArrowLeft');

    // ArrowLeft is the slide-navigation key outside the inspector; it must
    // not have reached the fixture's own keydown handler while focused on
    // the slider, i.e. the active slide must be unchanged.
    const stillOnFirstSlide = await page.evaluate(
      () => document.querySelector('.slide.active')?.id === 'foreign-slide-1',
    );
    expect(stillOnFirstSlide).toBe(true);
  });
});
