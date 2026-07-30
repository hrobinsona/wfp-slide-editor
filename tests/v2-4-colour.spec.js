import { test, expect } from '@playwright/test';
import { loadFixtureWithEditor, hitPointFor } from './_helpers.js';

// v2.4 — colour controls (text + background). Strict TDD for logic;
// the UI shell (swatch sitting in front of native <input type="color">,
// hex input, transparent affordance) is exercised functionally here
// and visually verified outside the suite.
//
// Decisions baked in (BRIEF "Decisions baked in" #1): native
// <input type="color"> behind a styled swatch + hex input. No custom
// HSL widget. Transparent affordance for background only.

test.use({ viewport: { width: 2000, height: 1200 } });

async function selectByMouse(page, selector) {
  const center = await hitPointFor(page, selector);
  await page.mouse.move(center.x, center.y);
  await page.mouse.down();
  await page.mouse.up();
}

function rgb(hex) {
  const h = hex.replace('#', '');
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

test.describe('v2.4 — colour controls', () => {
  test.beforeEach(async ({ page }) => {
    await loadFixtureWithEditor(page, 'Townhall-1.html');
    await page.evaluate(() => { document.querySelector('.deck').style.transform = 'scale(1)'; });
    await page.keyboard.press('e');
  });

  test('text colour control renders only for text-bearing elements; background renders for any selection', async ({ page }) => {
    await selectByMouse(page, '.slide.active h1');
    let rows = await page.evaluate(() => {
      const text = document.querySelector('#wfp-editor-root .wfpe-inspector-row[data-wfpe-row="text-color"]');
      const bg = document.querySelector('#wfp-editor-root .wfpe-inspector-row[data-wfpe-row="bg-color"]');
      return {
        textPresent: !!text,
        textDisplay: text && getComputedStyle(text).display,
        bgPresent: !!bg,
        bgDisplay: bg && getComputedStyle(bg).display,
      };
    });
    expect(rows.textPresent).toBe(true);
    expect(rows.textDisplay).not.toBe('none');
    expect(rows.bgPresent).toBe(true);
    expect(rows.bgDisplay).not.toBe('none');

    // Pick a non-text-bearing element and confirm text-colour hides.
    const result = await page.evaluate(() => {
      const slide = document.querySelector('.slide.active');
      const isTextBearing = (el) => [...el.childNodes].some(
        (n) => n.nodeType === 3 && n.textContent.trim().length > 0
      );
      let nonText = null;
      for (const el of slide.querySelectorAll('*')) {
        if (!isTextBearing(el) && el.children.length > 0) { nonText = el; break; }
      }
      if (!nonText) return { found: false };
      nonText.click();
      return {
        found: true,
        textDisplay: getComputedStyle(document.querySelector('.wfpe-inspector-row[data-wfpe-row="text-color"]')).display,
        bgDisplay: getComputedStyle(document.querySelector('.wfpe-inspector-row[data-wfpe-row="bg-color"]')).display,
      };
    });
    expect(result.found).toBe(true);
    expect(result.textDisplay).toBe('none');
    expect(result.bgDisplay).not.toBe('none');
  });

  test('text colour hex input commits a colour change as one history entry', async ({ page }) => {
    await selectByMouse(page, '.slide.active h1');
    const before = await page.evaluate(
      () => document.querySelector('.slide.active h1').style.color || ''
    );

    const hex = page.locator('#wfp-editor-root input[data-wfpe-prop="textColorHex"]');
    await hex.click({ clickCount: 3 });
    await hex.fill('#ff3344');
    await hex.press('Enter');

    const inline = await page.evaluate(
      () => document.querySelector('.slide.active h1').style.color
    );
    // Browsers normalise to rgb() when serialising inline color.
    expect(inline).toBe('rgb(255, 51, 68)');

    await page.keyboard.press('Control+z');
    const undone = await page.evaluate(
      () => document.querySelector('.slide.active h1').style.color || ''
    );
    expect(undone).toBe(before);
  });

  test('background colour hex input commits to background-color as one history entry', async ({ page }) => {
    await selectByMouse(page, '.slide.active h1');
    const before = await page.evaluate(
      () => document.querySelector('.slide.active h1').style.backgroundColor || ''
    );

    const hex = page.locator('#wfp-editor-root input[data-wfpe-prop="bgColorHex"]');
    await hex.click({ clickCount: 3 });
    await hex.fill('#112233');
    await hex.press('Enter');

    const inline = await page.evaluate(
      () => document.querySelector('.slide.active h1').style.backgroundColor
    );
    expect(inline).toBe('rgb(17, 34, 51)');

    await page.keyboard.press('Control+z');
    expect(
      await page.evaluate(() => document.querySelector('.slide.active h1').style.backgroundColor || '')
    ).toBe(before);
  });

  test('hex input accepts shorthand (#abc) and commits the expanded colour', async ({ page }) => {
    await selectByMouse(page, '.slide.active h1');
    const hex = page.locator('#wfp-editor-root input[data-wfpe-prop="textColorHex"]');
    await hex.click({ clickCount: 3 });
    await hex.fill('#abc');
    await hex.press('Enter');
    const inline = await page.evaluate(
      () => document.querySelector('.slide.active h1').style.color
    );
    expect(inline).toBe('rgb(170, 187, 204)');
  });

  test('garbage hex input reverts the readout without changing the element', async ({ page }) => {
    await selectByMouse(page, '.slide.active h1');
    const before = await page.evaluate(
      () => document.querySelector('.slide.active h1').style.color || ''
    );
    const hex = page.locator('#wfp-editor-root input[data-wfpe-prop="textColorHex"]');
    await hex.click({ clickCount: 3 });
    await hex.fill('not-a-hex');
    await hex.press('Enter');
    const after = await page.evaluate(
      () => document.querySelector('.slide.active h1').style.color || ''
    );
    expect(after).toBe(before);
  });

  test('background "transparent" affordance clears any inline background-color in one history entry', async ({ page }) => {
    await selectByMouse(page, '.slide.active h1');
    // Seed a background-color so the transparent action has something
    // to undo.
    const hex = page.locator('#wfp-editor-root input[data-wfpe-prop="bgColorHex"]');
    await hex.click({ clickCount: 3 });
    await hex.fill('#445566');
    await hex.press('Enter');
    expect(
      await page.evaluate(() => document.querySelector('.slide.active h1').style.backgroundColor)
    ).toBe('rgb(68, 85, 102)');

    await page.locator('#wfp-editor-root .wfpe-color-clear[data-wfpe-target="bg"]').click();
    expect(
      await page.evaluate(() => document.querySelector('.slide.active h1').style.backgroundColor)
    ).toBe('');

    // One undo restores the previous explicit background-color.
    await page.keyboard.press('Control+z');
    expect(
      await page.evaluate(() => document.querySelector('.slide.active h1').style.backgroundColor)
    ).toBe('rgb(68, 85, 102)');
  });

  test('hex inputs reflect the live element colour when populated', async ({ page }) => {
    await selectByMouse(page, '.slide.active h1');
    // Apply a known colour, then reselect (re-populate) and verify the
    // hex readout matches.
    await page.evaluate(() => {
      document.querySelector('.slide.active h1').style.color = 'rgb(10, 20, 30)';
    });
    // Trigger a refresh by clicking the same element.
    await selectByMouse(page, '.slide.active h1');
    const hex = await page.evaluate(
      () => document.querySelector('#wfp-editor-root input[data-wfpe-prop="textColorHex"]').value
    );
    expect(hex.toLowerCase()).toBe('#0a141e');
  });

  test('native color picker dispatches one history entry per change event', async ({ page }) => {
    await selectByMouse(page, '.slide.active h1');
    const before = await page.evaluate(
      () => document.querySelector('.slide.active h1').style.color || ''
    );

    // Headless Chromium can't realistically open the native picker, so
    // simulate it: dispatch input then change events on the hidden
    // <input type="color"> the same way the browser would.
    await page.evaluate(() => {
      const ci = document.querySelector('#wfp-editor-root input[type="color"][data-wfpe-target="text"]');
      ci.value = '#225588';
      ci.dispatchEvent(new Event('input', { bubbles: true }));
      ci.dispatchEvent(new Event('change', { bubbles: true }));
    });

    const after = await page.evaluate(
      () => document.querySelector('.slide.active h1').style.color
    );
    expect(after).toBe('rgb(34, 85, 136)');

    // One undo brings back the original colour.
    await page.keyboard.press('Control+z');
    expect(
      await page.evaluate(() => document.querySelector('.slide.active h1').style.color || '')
    ).toBe(before);
  });

  test('hex input keystrokes do not propagate to the editor', async ({ page }) => {
    await selectByMouse(page, '.slide.active h1');
    const beforeMode = await page.evaluate(
      () => document.querySelector('#wfp-editor-root .wfpe-mode-badge').dataset.mode
    );
    expect(beforeMode).toBe('on');

    const hex = page.locator('#wfp-editor-root input[data-wfpe-prop="textColorHex"]');
    await hex.focus();
    await hex.press('e');
    const afterMode = await page.evaluate(
      () => document.querySelector('#wfp-editor-root .wfpe-mode-badge').dataset.mode
    );
    expect(afterMode).toBe('on');
  });
});
