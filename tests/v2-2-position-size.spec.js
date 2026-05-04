import { test, expect } from '@playwright/test';
import { loadFixtureWithEditor } from './_helpers.js';

// v2.2 — position/size two-way binding + dimension bubble. Strict TDD:
// these tests are written before the implementation and must pass once
// the inspector body wires up X/Y/W/H readouts, commit-on-Enter, and
// the floating W × H chip above the selection ring.

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

async function dragByViewportPx(page, selector, dxView, dyView) {
  const center = await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }, selector);
  await page.mouse.move(center.x, center.y);
  await page.mouse.down();
  await page.mouse.move(center.x + dxView / 2, center.y + dyView / 2, { steps: 5 });
  await page.mouse.move(center.x + dxView, center.y + dyView, { steps: 5 });
  await page.mouse.up();
}

async function readInputs(page) {
  return page.evaluate(() => {
    const ins = document.querySelector('#wfp-editor-root .wfpe-inspector');
    const get = (n) => ins.querySelector(`input[data-wfpe-prop="${n}"]`)?.value ?? null;
    return { x: get('x'), y: get('y'), w: get('w'), h: get('h') };
  });
}

test.describe('v2.2 — position/size binding + dimension bubble', () => {
  test.beforeEach(async ({ page }) => {
    await loadFixtureWithEditor(page, 'Townhall-1.html');
    await page.evaluate(() => { document.querySelector('.deck').style.transform = 'scale(1)'; });
    await page.keyboard.press('e');
  });

  test('inspector body shows X/Y and W/H inputs when an element is selected', async ({ page }) => {
    await selectByMouse(page, '.slide.active .wfp-badge');
    const ids = await page.evaluate(() => {
      // Filter to position/size props only — phases v2.3+ add other
      // inputs (font-size, colour) to the same panel.
      return [...document.querySelectorAll('#wfp-editor-root .wfpe-inspector input[data-wfpe-prop]')]
        .map((i) => i.dataset.wfpeProp)
        .filter((p) => ['x', 'y', 'w', 'h'].includes(p));
    });
    expect(ids).toEqual(['x', 'y', 'w', 'h']);
  });

  test('inputs reflect the selected element\'s offsetLeft / offsetTop / offsetWidth / offsetHeight', async ({ page }) => {
    await selectByMouse(page, '.slide.active .wfp-badge');
    const expected = await page.evaluate(() => {
      const el = document.querySelector('.slide.active .wfp-badge');
      return { x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight };
    });
    const inputs = await readInputs(page);
    expect(Number(inputs.x)).toBe(expected.x);
    expect(Number(inputs.y)).toBe(expected.y);
    expect(Number(inputs.w)).toBe(expected.w);
    expect(Number(inputs.h)).toBe(expected.h);
  });

  test('dragging the element updates X and Y inputs live', async ({ page }) => {
    // Use the H1 (centre-left of the slide), not the WFP badge — the
    // inspector's footprint covers the top-right region by design.
    await selectByMouse(page, '.slide.active h1');
    const before = await readInputs(page);
    await dragByViewportPx(page, '.slide.active h1', 60, 30);
    const after = await readInputs(page);
    expect(Number(after.x) - Number(before.x)).toBeCloseTo(60, 0);
    expect(Number(after.y) - Number(before.y)).toBeCloseTo(30, 0);
    // Width/height untouched during a pure drag.
    expect(after.w).toBe(before.w);
    expect(after.h).toBe(before.h);
  });

  test('typing into X and pressing Enter commits one history entry that moves the element', async ({ page }) => {
    await selectByMouse(page, '.slide.active .wfp-badge');
    // Force the badge onto absolute positioning so an X edit is meaningful.
    // Easiest: a no-op drag triggers the unlock-on-flow path if needed; for
    // .wfp-badge it's already absolute in the fixture, but be defensive.
    const before = await page.evaluate(() => {
      const el = document.querySelector('.slide.active .wfp-badge');
      return { left: el.offsetLeft, historyLen: window.__wfpEditorState?.history?.length ?? null };
    });

    const input = page.locator('#wfp-editor-root .wfpe-inspector input[data-wfpe-prop="x"]');
    await input.click({ clickCount: 3 });
    await input.fill(String(before.left + 50));
    await input.press('Enter');

    const after = await page.evaluate(() => {
      const el = document.querySelector('.slide.active .wfp-badge');
      return { left: el.offsetLeft, inlineLeft: el.style.left };
    });
    expect(after.left).toBeCloseTo(before.left + 50, 0);
    expect(after.inlineLeft).toBe(`${before.left + 50}px`);

    // One undo entry restores the original left.
    await page.keyboard.press('Control+z');
    const undone = await page.evaluate(() => document.querySelector('.slide.active .wfp-badge').offsetLeft);
    expect(undone).toBe(before.left);
  });

  test('typing into W and blurring commits the change', async ({ page }) => {
    await selectByMouse(page, '.slide.active .wfp-badge');
    const before = await page.evaluate(() => document.querySelector('.slide.active .wfp-badge').offsetWidth);

    const input = page.locator('#wfp-editor-root .wfpe-inspector input[data-wfpe-prop="w"]');
    await input.click({ clickCount: 3 });
    await input.fill(String(before + 25));
    // Blur by tabbing or clicking elsewhere on the inspector.
    await input.evaluate((el) => el.blur());

    const after = await page.evaluate(() => document.querySelector('.slide.active .wfp-badge').offsetWidth);
    expect(after).toBe(before + 25);
  });

  test('typing without committing (no Enter, no blur) does not change the element', async ({ page }) => {
    await selectByMouse(page, '.slide.active .wfp-badge');
    const before = await page.evaluate(() => document.querySelector('.slide.active .wfp-badge').offsetWidth);

    const input = page.locator('#wfp-editor-root .wfpe-inspector input[data-wfpe-prop="w"]');
    await input.focus();
    await input.fill(String(before + 100));

    const mid = await page.evaluate(() => document.querySelector('.slide.active .wfp-badge').offsetWidth);
    expect(mid).toBe(before);
  });

  test('dimension bubble renders the W × H chip above the selection ring', async ({ page }) => {
    await selectByMouse(page, '.slide.active .wfp-badge');
    const bubble = await page.evaluate(() => {
      const b = document.querySelector('#wfp-editor-root .wfpe-dim-bubble');
      const r = document.querySelector('#wfp-editor-root .wfpe-selection-ring');
      const el = document.querySelector('.slide.active .wfp-badge');
      const expectedText = `${el.offsetWidth} × ${el.offsetHeight}`;
      return {
        present: !!b,
        display: b && getComputedStyle(b).display,
        text: b?.textContent?.trim(),
        bubbleBottom: b ? Math.round(b.getBoundingClientRect().bottom) : null,
        ringTop: Math.round(r.getBoundingClientRect().top),
        expectedText,
      };
    });
    expect(bubble.present).toBe(true);
    expect(bubble.display).not.toBe('none');
    // px strings format consistently regardless of locale.
    expect(bubble.text).toContain('×');
    expect(bubble.text).toBe(bubble.expectedText);
    // Bubble sits above the ring (bottom of bubble <= top of ring + 1px tolerance).
    expect(bubble.bubbleBottom).toBeLessThanOrEqual(bubble.ringTop + 1);
  });

  test('dimension bubble updates live during resize', async ({ page }) => {
    // Select the WFP badge first, then minimise the inspector so its
    // top-right footprint stops covering the badge's SE handle.
    await selectByMouse(page, '.slide.active .wfp-badge');
    await page.locator('#wfp-editor-root .wfpe-inspector-minimise').click();

    const before = await page.evaluate(() =>
      document.querySelector('#wfp-editor-root .wfpe-dim-bubble').textContent.trim()
    );
    // SE handle drag: 30px right, 20px down → +30 W, +20 H.
    const seHandle = await page.evaluate(() => {
      const h = document.querySelector('#wfp-editor-root .wfpe-handle-se');
      const r = h.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });
    await page.mouse.move(seHandle.x, seHandle.y);
    await page.mouse.down();
    await page.mouse.move(seHandle.x + 30, seHandle.y + 20, { steps: 5 });
    await page.mouse.up();

    const after = await page.evaluate(() =>
      document.querySelector('#wfp-editor-root .wfpe-dim-bubble').textContent.trim()
    );
    expect(after).not.toBe(before);
    const beforeNums = before.match(/\d+/g).map(Number);
    const afterNums = after.match(/\d+/g).map(Number);
    expect(afterNums[0] - beforeNums[0]).toBeCloseTo(30, 0);
    expect(afterNums[1] - beforeNums[1]).toBeCloseTo(20, 0);
  });

  test('dimension bubble hides during inline text edit (mirrors the ring)', async ({ page }) => {
    await page.evaluate(() => document.querySelector('.slide.active h1').click());
    const beforeBubble = await page.evaluate(() =>
      getComputedStyle(document.querySelector('#wfp-editor-root .wfpe-dim-bubble')).display
    );
    expect(beforeBubble).not.toBe('none');

    await page.evaluate(() => document.querySelector('.slide.active h1').dispatchEvent(new MouseEvent('dblclick', { bubbles: true })));
    const duringEdit = await page.evaluate(() => ({
      bubble: getComputedStyle(document.querySelector('#wfp-editor-root .wfpe-dim-bubble')).display,
      ring: document.querySelector('#wfp-editor-root .wfpe-selection-ring').style.display,
    }));
    expect(duringEdit.ring).toBe('none');
    expect(duringEdit.bubble).toBe('none');
  });

  test('inspector input commits do not deselect the element', async ({ page }) => {
    await selectByMouse(page, '.slide.active .wfp-badge');
    const input = page.locator('#wfp-editor-root .wfpe-inspector input[data-wfpe-prop="x"]');
    await input.click({ clickCount: 3 });
    await input.fill('500');
    await input.press('Enter');

    const stillSelected = await page.evaluate(() => {
      const r = document.querySelector('#wfp-editor-root .wfpe-selection-ring');
      return r.style.display;
    });
    expect(stillSelected).toBe('block');
  });
});
