import { test, expect } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { EDITOR_PATH } from './_helpers.js';

// Perf — the R2 idle selection-tracking rAF loop (40-helpers-selection-
// inspector.js) now dirty-checks bounding rects each tick and only pays for
// a full refreshSelection() when something actually moved. The tests below
// pin the R2 guarantee this loop exists for in the first place: the ring
// (and, separately, an annotation marker on a non-selected element) must
// still catch up to something that moves with NO editor event at all (e.g.
// a host-page animation), since that's exactly the case the cheap
// per-frame rect/visibility comparison has to catch.

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
