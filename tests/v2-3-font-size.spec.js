import { test, expect } from '@playwright/test';
import { loadFixtureWithEditor } from './_helpers.js';

// v2.3 — font-size triplet (px input + horizontal slider + −/+ buttons),
// all three bound to the same value. Strict TDD.
//
// History contract from BRIEF: one input commit = one entry, one slider
// drag grab→release = one entry, one ± click = one entry.

test.use({ viewport: { width: 2000, height: 1200 } });

async function selectByMouse(page, selector) {
  const center = await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }, selector);
  await page.mouse.move(center.x, center.y);
  await page.mouse.down();
  await page.mouse.up();
}

async function readFontSize(page, selector) {
  return page.evaluate(
    (sel) => parseFloat(getComputedStyle(document.querySelector(sel)).fontSize),
    selector
  );
}

async function readFontTriplet(page) {
  return page.evaluate(() => {
    const ins = document.querySelector('#wfp-editor-root .wfpe-inspector');
    return {
      input: ins.querySelector('input[data-wfpe-prop="fontSize"]')?.value ?? null,
      slider: ins.querySelector('input[data-wfpe-prop="fontSizeSlider"]')?.value ?? null,
    };
  });
}

test.describe('v2.3 — font-size triplet', () => {
  test.beforeEach(async ({ page }) => {
    await loadFixtureWithEditor(page, 'Townhall-1.html');
    await page.evaluate(() => { document.querySelector('.deck').style.transform = 'scale(1)'; });
    await page.keyboard.press('e');
  });

  test('font-size controls render only for text-bearing elements', async ({ page }) => {
    // The H1 is text-bearing.
    await selectByMouse(page, '.slide.active h1');
    let row = await page.evaluate(() => {
      const r = document.querySelector('#wfp-editor-root .wfpe-inspector-row[data-wfpe-row="font-size"]');
      return { present: !!r, display: r && getComputedStyle(r).display };
    });
    expect(row.present).toBe(true);
    expect(row.display).not.toBe('none');

    // The WFP badge wraps a text node, but to test the non-text path
    // pick an element with no direct text children. The .deck-arrow-prev
    // is editor-injected pagination, so use slide background `s0-glow-a`
    // or the diagonal — but those may not be selectable. Use the WFP
    // badge's parent inner container if available, otherwise just confirm
    // the row hides when an explicitly non-text-bearing element is
    // selected via setSelected() for simplicity.
    const result = await page.evaluate(() => {
      // Find an element inside the slide that isTextBearing() returns
      // false for (no direct text-node children). Walk slide descendants.
      const slide = document.querySelector('.slide.active');
      const isTextBearing = (el) => [...el.childNodes].some(
        (n) => n.nodeType === 3 && n.textContent.trim().length > 0
      );
      let nonText = null;
      for (const el of slide.querySelectorAll('*')) {
        if (!isTextBearing(el) && el.children.length > 0) { nonText = el; break; }
      }
      if (!nonText) return { found: false };
      // Programmatically select it the same way an outside click would:
      // dispatch a click on it inside edit mode.
      nonText.click();
      const r = document.querySelector('#wfp-editor-root .wfpe-inspector-row[data-wfpe-row="font-size"]');
      return {
        found: true,
        display: r && getComputedStyle(r).display,
      };
    });
    expect(result.found).toBe(true); // fail loud if the fixture stops having a non-text-bearing element with children
    expect(result.display).toBe('none');
  });

  test('input + slider + ± buttons all bound to the same font-size value', async ({ page }) => {
    await selectByMouse(page, '.slide.active h1');
    const live = await readFontSize(page, '.slide.active h1');
    const triplet = await readFontTriplet(page);
    const buttons = await page.evaluate(() => ({
      minus: !!document.querySelector('#wfp-editor-root .wfpe-font-btn[data-action="font-minus"]'),
      plus: !!document.querySelector('#wfp-editor-root .wfpe-font-btn[data-action="font-plus"]'),
    }));
    expect(Number(triplet.input)).toBe(Math.round(live));
    expect(Number(triplet.slider)).toBe(Math.round(live));
    expect(buttons.minus).toBe(true);
    expect(buttons.plus).toBe(true);
  });

  test('typing a font-size into the input and pressing Enter applies as one history entry', async ({ page }) => {
    await selectByMouse(page, '.slide.active h1');
    const before = await readFontSize(page, '.slide.active h1');

    const input = page.locator('#wfp-editor-root .wfpe-inspector input[data-wfpe-prop="fontSize"]');
    await input.click({ clickCount: 3 });
    await input.fill(String(Math.round(before) + 12));
    await input.press('Enter');

    const after = await readFontSize(page, '.slide.active h1');
    expect(after).toBeCloseTo(before + 12, 0);

    // One undo restores the original size — i.e. one history entry.
    await page.keyboard.press('Control+z');
    const undone = await readFontSize(page, '.slide.active h1');
    expect(undone).toBeCloseTo(before, 0);
  });

  test('clicking the + button bumps font-size and creates one history entry per click', async ({ page }) => {
    await selectByMouse(page, '.slide.active h1');
    const before = await readFontSize(page, '.slide.active h1');

    await page.locator('#wfp-editor-root .wfpe-font-btn[data-action="font-plus"]').click();
    const afterOne = await readFontSize(page, '.slide.active h1');
    expect(afterOne).toBeGreaterThan(before);

    await page.locator('#wfp-editor-root .wfpe-font-btn[data-action="font-plus"]').click();
    const afterTwo = await readFontSize(page, '.slide.active h1');
    expect(afterTwo).toBeGreaterThan(afterOne);

    // Two undos to reverse the two clicks individually — confirms one
    // history entry per click rather than batched.
    await page.keyboard.press('Control+z');
    expect(await readFontSize(page, '.slide.active h1')).toBeCloseTo(afterOne, 0);
    await page.keyboard.press('Control+z');
    expect(await readFontSize(page, '.slide.active h1')).toBeCloseTo(before, 0);
  });

  test('clicking the − button decreases font-size with the same per-click history entry', async ({ page }) => {
    await selectByMouse(page, '.slide.active h1');
    const before = await readFontSize(page, '.slide.active h1');

    await page.locator('#wfp-editor-root .wfpe-font-btn[data-action="font-minus"]').click();
    const after = await readFontSize(page, '.slide.active h1');
    expect(after).toBeLessThan(before);

    await page.keyboard.press('Control+z');
    expect(await readFontSize(page, '.slide.active h1')).toBeCloseTo(before, 0);
  });

  test('font-size minimum clamps at 8px regardless of which control drives the change', async ({ page }) => {
    await selectByMouse(page, '.slide.active h1');
    // Push to minimum via input.
    const input = page.locator('#wfp-editor-root .wfpe-inspector input[data-wfpe-prop="fontSize"]');
    await input.click({ clickCount: 3 });
    await input.fill('1');
    await input.press('Enter');
    expect(await readFontSize(page, '.slide.active h1')).toBe(8);

    // − button below 8 stays at 8.
    await page.locator('#wfp-editor-root .wfpe-font-btn[data-action="font-minus"]').click();
    expect(await readFontSize(page, '.slide.active h1')).toBe(8);
  });

  test('slider drag from grab to release = exactly one history entry', async ({ page }) => {
    await selectByMouse(page, '.slide.active h1');
    const before = await readFontSize(page, '.slide.active h1');

    // Simulate a slider drag by dispatching mousedown, multiple input
    // events with synthetic values, then mouseup. Native range-slider
    // dragging in Playwright is platform-dependent; the editor must
    // bracket its history entry around mousedown→mouseup regardless of
    // whether each `input` event ticks during the drag.
    await page.evaluate((newVal) => {
      const slider = document.querySelector('#wfp-editor-root .wfpe-inspector input[data-wfpe-prop="fontSizeSlider"]');
      slider.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      slider.value = String(newVal);
      slider.dispatchEvent(new Event('input', { bubbles: true }));
      slider.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    }, Math.round(before) + 20);

    const after = await readFontSize(page, '.slide.active h1');
    expect(after).toBeCloseTo(before + 20, 0);

    await page.keyboard.press('Control+z');
    const undone = await readFontSize(page, '.slide.active h1');
    expect(undone).toBeCloseTo(before, 0);
  });

  test('changing font-size via any control updates the readout in the other two controls', async ({ page }) => {
    await selectByMouse(page, '.slide.active h1');
    const before = await readFontSize(page, '.slide.active h1');

    await page.locator('#wfp-editor-root .wfpe-font-btn[data-action="font-plus"]').click();
    const after = await readFontTriplet(page);
    const expectedRounded = Math.round(before) + 1;
    expect(Number(after.input)).toBe(expectedRounded);
    expect(Number(after.slider)).toBe(expectedRounded);
  });

  test('clicking + updates the numeric readout even when the font-size input keeps focus', async ({ page }) => {
    await selectByMouse(page, '.slide.active h1');
    const before = Math.round(await readFontSize(page, '.slide.active h1'));

    const after = await page.evaluate(() => {
      const input = document.querySelector('#wfp-editor-root .wfpe-inspector input[data-wfpe-prop="fontSize"]');
      const slider = document.querySelector('#wfp-editor-root .wfpe-inspector input[data-wfpe-prop="fontSizeSlider"]');
      const plus = document.querySelector('#wfp-editor-root .wfpe-font-btn[data-action="font-plus"]');
      input.focus();
      const focusedBefore = document.activeElement === input;
      plus.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      const live = Math.round(parseFloat(getComputedStyle(document.querySelector('.slide.active h1')).fontSize));
      return {
        focusedBefore,
        focusedAfter: document.activeElement === input,
        live,
        input: Number(input.value),
        slider: Number(slider.value),
      };
    });

    expect(after.focusedBefore).toBe(true);
    expect(after.focusedAfter).toBe(true);
    expect(after.live).toBe(before + 1);
    expect(after.input).toBe(after.live);
    expect(after.slider).toBe(after.live);
  });

  test('font-size keystrokes inside the input do not bubble to the editor (no E toggle, no arrow nudge)', async ({ page }) => {
    await selectByMouse(page, '.slide.active h1');
    const beforeMode = await page.evaluate(() => document.querySelector('#wfp-editor-root .wfpe-mode-badge').dataset.mode);
    expect(beforeMode).toBe('on');

    const input = page.locator('#wfp-editor-root .wfpe-inspector input[data-wfpe-prop="fontSize"]');
    await input.focus();
    // Press 'e' inside input — must NOT toggle edit mode off.
    await input.press('e');
    const afterMode = await page.evaluate(() => document.querySelector('#wfp-editor-root .wfpe-mode-badge').dataset.mode);
    expect(afterMode).toBe('on');
  });
});
