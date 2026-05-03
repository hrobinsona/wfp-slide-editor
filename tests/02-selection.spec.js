import { test, expect } from '@playwright/test';
import { loadFixtureWithEditor } from './_helpers.js';

async function clickElement(page, selector) {
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
    const el = document.querySelector(sel);
    const r = el.getBoundingClientRect();
    return { top: r.top, left: r.left, width: r.width, height: r.height };
  }, selector);
}

test.describe('Phase 2 — Selection', () => {
  test('does not select anything when edit mode is OFF', async ({ page }) => {
    await loadFixtureWithEditor(page, 'Townhall-1.html');
    await clickElement(page, '.slide.active h1');
    const state = await ringState(page);
    expect(state.display).toBe('none');
  });

  test('clicking inside .slide.active shows the ring on the clicked element', async ({ page }) => {
    await loadFixtureWithEditor(page, 'Townhall-1.html');
    await page.keyboard.press('e');

    await clickElement(page, '.slide.active h1');
    const state = await ringState(page);
    const target = await rectOf(page, '.slide.active h1');

    expect(state.display).toBe('block');
    expect(state.top).toBeCloseTo(target.top, 0);
    expect(state.left).toBeCloseTo(target.left, 0);
    expect(state.width).toBeCloseTo(target.width, 0);
    expect(state.height).toBeCloseTo(target.height, 0);
  });

  test('selecting another element moves the ring', async ({ page }) => {
    await loadFixtureWithEditor(page, 'Townhall-1.html');
    await page.keyboard.press('e');

    await clickElement(page, '.slide.active h1');
    const first = await ringState(page);

    await clickElement(page, '.slide.active .wfp-badge');
    const second = await ringState(page);
    const second_target = await rectOf(page, '.slide.active .wfp-badge');

    expect(second.display).toBe('block');
    expect(second.left).toBeCloseTo(second_target.left, 0);
    expect(second.left).not.toBeCloseTo(first.left, 0);
  });

  test('clicking the editor badge does NOT change selection', async ({ page }) => {
    await loadFixtureWithEditor(page, 'Townhall-1.html');
    await page.keyboard.press('e');

    await clickElement(page, '.slide.active h1');
    const before = await ringState(page);

    await clickElement(page, '#wfp-editor-root .wfpe-mode-badge');
    const after = await ringState(page);

    expect(after.display).toBe('block');
    expect(after.left).toBeCloseTo(before.left, 0);
    expect(after.top).toBeCloseTo(before.top, 0);
  });

  test('clicking .slide.active itself deselects', async ({ page }) => {
    await loadFixtureWithEditor(page, 'Townhall-1.html');
    await page.keyboard.press('e');

    await clickElement(page, '.slide.active h1');
    expect((await ringState(page)).display).toBe('block');

    // Dispatch a click whose target is the .slide element directly.
    await page.evaluate(() => {
      const slide = document.querySelector('.slide.active');
      slide.dispatchEvent(
        new MouseEvent('click', {
          bubbles: true,
          cancelable: true,
          view: window,
          clientX: 1,
          clientY: 1,
        }),
      );
    });
    expect((await ringState(page)).display).toBe('none');
  });

  test('clicking .deck does not select the deck', async ({ page }) => {
    await loadFixtureWithEditor(page, 'Townhall-1.html');
    await page.keyboard.press('e');

    await page.evaluate(() => {
      const deck = document.querySelector('.deck');
      deck.dispatchEvent(
        new MouseEvent('click', {
          bubbles: true,
          cancelable: true,
          view: window,
          clientX: 1,
          clientY: 1,
        }),
      );
    });
    expect((await ringState(page)).display).toBe('none');
  });

  test('advancing the active slide clears selection', async ({ page }) => {
    await loadFixtureWithEditor(page, 'Townhall-1.html');
    await page.keyboard.press('e');

    await clickElement(page, '.slide.active h1');
    expect((await ringState(page)).display).toBe('block');

    // Advance via the fixture's own goTo() helper to mimic a real slide change.
    await page.evaluate(() => window.goTo(1));
    // MutationObserver runs as a microtask; await one tick.
    await page.waitForFunction(() => {
      const ring = document.querySelector('#wfp-editor-root .wfpe-selection-ring');
      return ring.style.display === 'none';
    }, null, { timeout: 1_000 });

    expect((await ringState(page)).display).toBe('none');
  });

  test('toggling edit mode OFF clears selection', async ({ page }) => {
    await loadFixtureWithEditor(page, 'Townhall-1.html');
    await page.keyboard.press('e');

    await clickElement(page, '.slide.active h1');
    expect((await ringState(page)).display).toBe('block');

    await page.keyboard.press('e');
    expect((await ringState(page)).display).toBe('none');
  });
});
