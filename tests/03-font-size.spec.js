import { test, expect } from '@playwright/test';
import { loadFixtureWithEditor } from './_helpers.js';

async function selectAndReadFontSize(page, selector) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) throw new Error(`No element matching ${sel}`);
    const r = el.getBoundingClientRect();
    el.dispatchEvent(
      new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
        view: window,
        clientX: r.left + Math.max(2, r.width / 2),
        clientY: r.top + Math.max(2, r.height / 2),
      }),
    );
    return parseFloat(getComputedStyle(el).fontSize);
  }, selector);
}

async function readFontSize(page, selector) {
  return page.evaluate(
    (sel) => parseFloat(getComputedStyle(document.querySelector(sel)).fontSize),
    selector,
  );
}

async function readInlineFontSize(page, selector) {
  return page.evaluate((sel) => document.querySelector(sel).style.fontSize, selector);
}

test.describe('Phase 3 — Font-size keyboard nudge', () => {
  test('ArrowUp increases font-size by 1px on selected text element', async ({ page }) => {
    await loadFixtureWithEditor(page, 'Townhall-1.html');
    await page.keyboard.press('e');

    const before = await selectAndReadFontSize(page, '.slide.active h1');
    await page.keyboard.press('ArrowUp');
    const after = await readFontSize(page, '.slide.active h1');

    expect(after).toBeCloseTo(before + 1, 1);
    expect(await readInlineFontSize(page, '.slide.active h1')).toMatch(/^\d+(\.\d+)?px$/);
  });

  test('ArrowDown decreases font-size by 1px', async ({ page }) => {
    await loadFixtureWithEditor(page, 'Townhall-1.html');
    await page.keyboard.press('e');

    const before = await selectAndReadFontSize(page, '.slide.active h1');
    await page.keyboard.press('ArrowDown');
    const after = await readFontSize(page, '.slide.active h1');

    expect(after).toBeCloseTo(before - 1, 1);
  });

  test('Five ArrowUp presses increase font-size by 5px', async ({ page }) => {
    await loadFixtureWithEditor(page, 'Townhall-1.html');
    await page.keyboard.press('e');

    const before = await selectAndReadFontSize(page, '.slide.active h1');
    for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowUp');
    const after = await readFontSize(page, '.slide.active h1');

    expect(after).toBeCloseTo(before + 5, 1);
  });

  test('Shift+ArrowUp jumps font-size by 5px', async ({ page }) => {
    await loadFixtureWithEditor(page, 'Townhall-1.html');
    await page.keyboard.press('e');

    const before = await selectAndReadFontSize(page, '.slide.active h1');
    await page.keyboard.press('Shift+ArrowUp');
    const after = await readFontSize(page, '.slide.active h1');

    expect(after).toBeCloseTo(before + 5, 1);
  });

  test('Shift+ArrowDown jumps font-size down by 5px', async ({ page }) => {
    await loadFixtureWithEditor(page, 'Townhall-1.html');
    await page.keyboard.press('e');

    const before = await selectAndReadFontSize(page, '.slide.active h1');
    await page.keyboard.press('Shift+ArrowDown');
    const after = await readFontSize(page, '.slide.active h1');

    expect(after).toBeCloseTo(before - 5, 1);
  });

  test('font-size cannot go below 8px (clamped)', async ({ page }) => {
    await loadFixtureWithEditor(page, 'Townhall-1.html');
    await page.keyboard.press('e');

    // Manually set the heading's font-size to 9px (via inline style) so we can
    // step down predictably without spamming hundreds of ArrowDowns.
    await page.evaluate(() => {
      const el = document.querySelector('.slide.active h1');
      el.style.fontSize = '9px';
    });
    const before = await selectAndReadFontSize(page, '.slide.active h1');
    expect(before).toBeCloseTo(9, 1);

    await page.keyboard.press('ArrowDown'); // → 8
    expect(await readFontSize(page, '.slide.active h1')).toBeCloseTo(8, 1);

    await page.keyboard.press('ArrowDown'); // would-be 7, clamped to 8
    expect(await readFontSize(page, '.slide.active h1')).toBeCloseTo(8, 1);

    await page.keyboard.press('Shift+ArrowDown'); // would-be 3, clamped to 8
    expect(await readFontSize(page, '.slide.active h1')).toBeCloseTo(8, 1);
  });

  test('arrows do nothing when no element is selected', async ({ page }) => {
    await loadFixtureWithEditor(page, 'Townhall-1.html');
    await page.keyboard.press('e');

    const slidesBefore = await page.evaluate(
      () => [...document.querySelectorAll('.slide')].findIndex((s) => s.classList.contains('active')),
    );
    const beforeAll = await page.evaluate(() =>
      [...document.querySelectorAll('.slide.active *')].map((el) => el.style.fontSize),
    );

    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('ArrowDown');

    const afterAll = await page.evaluate(() =>
      [...document.querySelectorAll('.slide.active *')].map((el) => el.style.fontSize),
    );
    const slidesAfter = await page.evaluate(
      () => [...document.querySelectorAll('.slide')].findIndex((s) => s.classList.contains('active')),
    );

    // No element changed inline font-size, and the active slide didn't move
    // (capture-phase suppression keeps fixture nav from firing on ArrowUp/Down,
    // but Phase 3's spec only cares that font-sizes don't change).
    expect(afterAll).toEqual(beforeAll);
    expect(slidesAfter).toBe(slidesBefore);
  });

  test('arrows do nothing when edit mode is OFF', async ({ page }) => {
    await loadFixtureWithEditor(page, 'Townhall-1.html');

    // Don't press E. Try to "select" by clicking, but the editor should ignore.
    const before = await selectAndReadFontSize(page, '.slide.active h1');
    await page.keyboard.press('ArrowUp');
    const after = await readFontSize(page, '.slide.active h1');
    expect(after).toBeCloseTo(before, 1);
  });

  test('arrows do not nudge font on a non-text-bearing container', async ({ page }) => {
    await loadFixtureWithEditor(page, 'Townhall-1.html');
    await page.keyboard.press('e');

    // .deck and .slide are not selectable, but the WFP coral badge contains a
    // text node ("WFP") so it IS text-bearing — pick something that is purely
    // structural. The easiest portable target: the H1's parent container which
    // typically holds the H1 plus other children with no direct text node.
    const target = await page.evaluate(() => {
      const h1 = document.querySelector('.slide.active h1');
      // Walk up looking for an ancestor with NO direct text node child.
      let p = h1?.parentElement;
      while (p && p.classList && !p.classList.contains('slide')) {
        const hasDirectText = [...p.childNodes].some(
          (n) => n.nodeType === 3 && n.textContent.trim().length > 0,
        );
        if (!hasDirectText) {
          // Tag the element so we can click it.
          p.dataset.testTarget = 'non-text';
          return true;
        }
        p = p.parentElement;
      }
      return false;
    });

    if (!target) {
      test.skip(true, 'No non-text-bearing container found in this fixture');
      return;
    }

    const before = await selectAndReadFontSize(page, '[data-test-target="non-text"]');
    await page.keyboard.press('ArrowUp');
    const after = await readFontSize(page, '[data-test-target="non-text"]');
    expect(after).toBeCloseTo(before, 1);
  });
});
