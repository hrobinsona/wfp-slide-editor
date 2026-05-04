import { test, expect } from '@playwright/test';
import { loadFixtureWithEditor } from './_helpers.js';

// v2.9 — opacity row. Input + slider, both bound to the selected
// element's opacity (stored as 0..1 in CSS, surfaced as 0..100 % in
// the inspector). History contract mirrors v2.3 font-size: one Enter/
// blur on the input = one entry, one slider drag (mousedown→mouseup)
// = one entry.

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

async function readOpacity(page, selector) {
  return page.evaluate(
    (sel) => parseFloat(getComputedStyle(document.querySelector(sel)).opacity),
    selector,
  );
}

async function readOpacityControls(page) {
  return page.evaluate(() => {
    const ins = document.querySelector('#wfp-editor-root .wfpe-inspector');
    return {
      input: ins.querySelector('input[data-wfpe-prop="opacity"]')?.value ?? null,
      slider: ins.querySelector('input[data-wfpe-prop="opacitySlider"]')?.value ?? null,
    };
  });
}

test.describe('v2.9 — opacity', () => {
  test.beforeEach(async ({ page }) => {
    await loadFixtureWithEditor(page, 'Townhall-1.html');
    await page.evaluate(() => { document.querySelector('.deck').style.transform = 'scale(1)'; });
    await page.keyboard.press('e');
  });

  test('opacity row is present for any selection and starts at the live computed value', async ({ page }) => {
    await selectByMouse(page, '.slide.active .wfp-badge');
    const live = await readOpacity(page, '.slide.active .wfp-badge');
    const controls = await readOpacityControls(page);
    const expected = Math.round(live * 100);
    expect(Number(controls.input)).toBe(expected);
    expect(Number(controls.slider)).toBe(expected);
  });

  test('typing a percent into the input and pressing Enter applies as one history entry', async ({ page }) => {
    await selectByMouse(page, '.slide.active .wfp-badge');
    const before = await readOpacity(page, '.slide.active .wfp-badge');

    const input = page.locator('#wfp-editor-root .wfpe-inspector input[data-wfpe-prop="opacity"]');
    await input.click({ clickCount: 3 });
    await input.fill('40');
    await input.press('Enter');

    expect(await readOpacity(page, '.slide.active .wfp-badge')).toBeCloseTo(0.4, 2);

    await page.keyboard.press('Control+z');
    expect(await readOpacity(page, '.slide.active .wfp-badge')).toBeCloseTo(before, 2);
  });

  test('slider drag from grab to release = exactly one history entry', async ({ page }) => {
    await selectByMouse(page, '.slide.active .wfp-badge');
    const before = await readOpacity(page, '.slide.active .wfp-badge');

    await page.evaluate(() => {
      const slider = document.querySelector('#wfp-editor-root .wfpe-inspector input[data-wfpe-prop="opacitySlider"]');
      slider.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      slider.value = '25';
      slider.dispatchEvent(new Event('input', { bubbles: true }));
      slider.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    });

    expect(await readOpacity(page, '.slide.active .wfp-badge')).toBeCloseTo(0.25, 2);

    await page.keyboard.press('Control+z');
    expect(await readOpacity(page, '.slide.active .wfp-badge')).toBeCloseTo(before, 2);
  });

  test('clamps to [0, 100] regardless of which control drives the change', async ({ page }) => {
    await selectByMouse(page, '.slide.active .wfp-badge');
    const input = page.locator('#wfp-editor-root .wfpe-inspector input[data-wfpe-prop="opacity"]');

    await input.click({ clickCount: 3 });
    await input.fill('-50');
    await input.press('Enter');
    expect(await readOpacity(page, '.slide.active .wfp-badge')).toBe(0);

    await input.click({ clickCount: 3 });
    await input.fill('999');
    await input.press('Enter');
    expect(await readOpacity(page, '.slide.active .wfp-badge')).toBe(1);
  });

  test('changing opacity via the slider updates the input readout', async ({ page }) => {
    await selectByMouse(page, '.slide.active .wfp-badge');

    await page.evaluate(() => {
      const slider = document.querySelector('#wfp-editor-root .wfpe-inspector input[data-wfpe-prop="opacitySlider"]');
      slider.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      slider.value = '70';
      slider.dispatchEvent(new Event('input', { bubbles: true }));
      slider.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    });

    const after = await readOpacityControls(page);
    expect(Number(after.input)).toBe(70);
    expect(Number(after.slider)).toBe(70);
  });

  test('opacity keystrokes inside the input do not bubble to the editor', async ({ page }) => {
    await selectByMouse(page, '.slide.active .wfp-badge');
    const before = await page.evaluate(() => document.querySelector('#wfp-editor-root .wfpe-mode-badge').dataset.mode);
    expect(before).toBe('on');

    const input = page.locator('#wfp-editor-root .wfpe-inspector input[data-wfpe-prop="opacity"]');
    await input.focus();
    await input.press('e');
    const after = await page.evaluate(() => document.querySelector('#wfp-editor-root .wfpe-mode-badge').dataset.mode);
    expect(after).toBe('on');
  });
});
