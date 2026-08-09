import { test, expect } from '@playwright/test';
import {
  loadFixtureWithEditor,
  requireAbsoluteTarget,
  hitPointFor,
  dragResizeHandle,
} from './_helpers.js';

test.use({ viewport: { width: 2000, height: 1200 } });

async function setDeckScale(page, scale) {
  await page.evaluate((s) => {
    document.querySelector('.deck').style.transform = `scale(${s})`;
  }, scale);
}

async function selectByMouse(page, selector) {
  const center = await hitPointFor(page, selector);
  // click without movement to select
  await page.mouse.move(center.x, center.y);
  await page.mouse.down();
  await page.mouse.up();
}

// Race-free handle drag — see the resize-gesture note in tests/_helpers.js.
async function dragHandle(page, dir, dxView, dyView) {
  await dragResizeHandle(page, dir, dxView, dyView, { steps: 10 });
}

async function readBox(page, selector) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    return {
      left: el.offsetLeft,
      top: el.offsetTop,
      width: el.offsetWidth,
      height: el.offsetHeight,
    };
  }, selector);
}

test.describe('Phase 5 — Resize', () => {
  test('selecting an element shows 8 visible handles with the right cursors', async ({
    page,
  }) => {
    await loadFixtureWithEditor(page, 'Townhall-1.html');
    const target = await requireAbsoluteTarget(page);
    await setDeckScale(page, 1);
    await page.keyboard.press('e');
    await selectByMouse(page, target);

    const handles = await page.evaluate(() =>
      [...document.querySelectorAll('#wfp-editor-root .wfpe-handle')].map((h) => ({
        dir: h.dataset.wfpeHandle,
        display: h.style.display,
        cursor: h.style.cursor,
      })),
    );
    expect(handles).toHaveLength(8);
    for (const h of handles) {
      expect(h.display).toBe('block');
    }
    const cursorMap = Object.fromEntries(handles.map((h) => [h.dir, h.cursor]));
    expect(cursorMap.nw).toBe('nwse-resize');
    expect(cursorMap.ne).toBe('nesw-resize');
    expect(cursorMap.se).toBe('nwse-resize');
    expect(cursorMap.sw).toBe('nesw-resize');
    expect(cursorMap.n).toBe('ns-resize');
    expect(cursorMap.s).toBe('ns-resize');
    expect(cursorMap.e).toBe('ew-resize');
    expect(cursorMap.w).toBe('ew-resize');
  });

  test('SE handle drag at scale=1 increases width and height by exact viewport delta', async ({
    page,
  }) => {
    await loadFixtureWithEditor(page, 'Townhall-1.html');
    const target = await requireAbsoluteTarget(page);
    await setDeckScale(page, 1);
    await page.keyboard.press('e');
    await selectByMouse(page, target);

    const before = await readBox(page, target);
    await dragHandle(page, 'se', 30, 20);
    const after = await readBox(page, target);

    expect(after.width - before.width).toBeCloseTo(30, 0);
    expect(after.height - before.height).toBeCloseTo(20, 0);
    expect(after.left).toBeCloseTo(before.left, 0);
    expect(after.top).toBeCloseTo(before.top, 0);
  });

  test('SE handle drag at scale=0.5 doubles the slide-space dimensional delta', async ({
    page,
  }) => {
    await loadFixtureWithEditor(page, 'Townhall-1.html');
    const target = await requireAbsoluteTarget(page);
    await setDeckScale(page, 0.5);
    await page.keyboard.press('e');
    await selectByMouse(page, target);

    const before = await readBox(page, target);
    await dragHandle(page, 'se', 50, 25);
    const after = await readBox(page, target);

    expect(after.width - before.width).toBeCloseTo(100, 0);
    expect(after.height - before.height).toBeCloseTo(50, 0);
  });

  test('NW handle drag adjusts top, left, width, height so the SE corner stays put', async ({
    page,
  }) => {
    await loadFixtureWithEditor(page, 'Townhall-1.html');
    const target = await requireAbsoluteTarget(page);
    await setDeckScale(page, 1);
    await page.keyboard.press('e');
    await selectByMouse(page, target);

    const before = await readBox(page, target);
    await dragHandle(page, 'nw', -20, -15);
    const after = await readBox(page, target);

    // SE corner = left + width and top + height. Should be unchanged.
    expect(after.left + after.width).toBeCloseTo(before.left + before.width, 0);
    expect(after.top + after.height).toBeCloseTo(before.top + before.height, 0);
    // top/left moved NW by 20/15
    expect(after.left).toBeCloseTo(before.left - 20, 0);
    expect(after.top).toBeCloseTo(before.top - 15, 0);
    // width/height grew by 20/15
    expect(after.width).toBeCloseTo(before.width + 20, 0);
    expect(after.height).toBeCloseTo(before.height + 15, 0);
  });

  test('N edge handle changes only height (and top); width stays the same', async ({
    page,
  }) => {
    await loadFixtureWithEditor(page, 'Townhall-1.html');
    const target = await requireAbsoluteTarget(page);
    await setDeckScale(page, 1);
    await page.keyboard.press('e');
    await selectByMouse(page, target);

    const before = await readBox(page, target);
    await dragHandle(page, 'n', 0, -10);
    const after = await readBox(page, target);

    expect(after.width).toBeCloseTo(before.width, 0);
    expect(after.left).toBeCloseTo(before.left, 0);
    expect(after.height).toBeCloseTo(before.height + 10, 0);
    expect(after.top).toBeCloseTo(before.top - 10, 0);
  });

  test('E edge handle changes only width', async ({ page }) => {
    await loadFixtureWithEditor(page, 'Townhall-1.html');
    const target = await requireAbsoluteTarget(page);
    await setDeckScale(page, 1);
    await page.keyboard.press('e');
    await selectByMouse(page, target);

    const before = await readBox(page, target);
    await dragHandle(page, 'e', 25, 0);
    const after = await readBox(page, target);

    expect(after.width).toBeCloseTo(before.width + 25, 0);
    expect(after.height).toBeCloseTo(before.height, 0);
    expect(after.top).toBeCloseTo(before.top, 0);
    expect(after.left).toBeCloseTo(before.left, 0);
  });

  test('width clamps at 8px minimum (E handle dragged left more than width)', async ({
    page,
  }) => {
    await loadFixtureWithEditor(page, 'Townhall-1.html');
    const target = await requireAbsoluteTarget(page);
    await setDeckScale(page, 1);
    await page.keyboard.press('e');
    await selectByMouse(page, target);

    await dragHandle(page, 'e', -1000, 0); // way past 8px
    const after = await readBox(page, target);
    expect(after.width).toBeCloseTo(8, 0);
  });

  test('handles disappear when selection is cleared', async ({ page }) => {
    await loadFixtureWithEditor(page, 'Townhall-1.html');
    const target = await requireAbsoluteTarget(page);
    await setDeckScale(page, 1);
    await page.keyboard.press('e');
    await selectByMouse(page, target);

    const visibleBefore = await page.evaluate(
      () =>
        [...document.querySelectorAll('#wfp-editor-root .wfpe-handle')].filter(
          (h) => h.style.display !== 'none',
        ).length,
    );
    expect(visibleBefore).toBe(8);

    // Toggle edit mode off → clears selection
    await page.keyboard.press('e');

    const visibleAfter = await page.evaluate(
      () =>
        [...document.querySelectorAll('#wfp-editor-root .wfpe-handle')].filter(
          (h) => h.style.display !== 'none',
        ).length,
    );
    expect(visibleAfter).toBe(0);
  });

  test('mousedown on a handle does NOT start a drag of the underlying element', async ({
    page,
  }) => {
    await loadFixtureWithEditor(page, 'Townhall-1.html');
    const target = await requireAbsoluteTarget(page);
    await setDeckScale(page, 1);
    await page.keyboard.press('e');
    await selectByMouse(page, target);

    const before = await readBox(page, target);
    await dragHandle(page, 'se', 20, 20);
    const after = await readBox(page, target);

    // Position must NOT change; only width/height.
    expect(after.left).toBeCloseTo(before.left, 0);
    expect(after.top).toBeCloseTo(before.top, 0);
    expect(after.width).toBeCloseTo(before.width + 20, 0);
    expect(after.height).toBeCloseTo(before.height + 20, 0);
  });
});
