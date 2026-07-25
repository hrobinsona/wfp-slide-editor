// v2.15 — Unlock hardening: resize deadzone + direct-child sibling pinning.
//
// Two interaction bugs in the drag/resize/flow-unlock engine:
//
// 1. A zero-movement mousedown+mouseup on a resize handle must be a no-op.
//    Historically `startResize` did everything at mousedown — beginTxn, the
//    "lock in current dimensions" inline writes for absolute elements, and
//    the FULL flow-unlock cascade (sibling freeze, container pin, toast) for
//    flow elements — so a plain click on a handle silently converted
//    responsive stylesheet sizing to fixed px and pushed a wasted history
//    entry. The fix mirrors the drag engine's DRAG_DEADZONE_PX gate.
//
// 2. Unlocking a DIRECT child of the slide/flat root must protect siblings.
//    `unlockToAbsolute` pinned only ancestors strictly BETWEEN the element
//    and the slide root; for a direct child there are none, so siblings
//    reflowed (flat-document: the first .flat-section jumped up by the
//    hero's full height). The fix pins the root's children the way
//    `pinContainerChildren` pins a container's — without mutating the root
//    element itself.
//
// Load pattern follows tests/v2-4-modes.spec.js (public fixtures served by
// the dev server, editor injected via addScriptTag).
import { test, expect } from '@playwright/test';
import { EDITOR_PATH, disableFsa } from './_helpers.js';

const ROOT = '#wfp-editor-root';
const RESET_BTN = `${ROOT} .wfpe-inspector .wfpe-reset-btn`;

async function loadDocumentWithEditor(page, fixtureName) {
  await disableFsa(page);
  await page.goto(`/fixtures/${fixtureName}`, { timeout: 30_000 });
  await page.addScriptTag({ path: EDITOR_PATH });
  await page.waitForFunction(() => window.__wfpEditorReady === true, null, { timeout: 10_000 });
}

async function dragBySelector(page, selector, dx, dy) {
  const center = await page.evaluate((sel) => {
    const r = document.querySelector(sel).getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }, selector);
  await page.mouse.move(center.x, center.y);
  await page.mouse.down();
  await page.mouse.move(center.x + dx, center.y + dy, { steps: 6 });
  await page.mouse.up();
}

// mousedown+mouseup on a resize handle at the exact same point.
async function zeroMoveHandleClick(page, handleClass) {
  const handle = page.locator(`${ROOT} .${handleClass}`);
  await expect(handle).not.toHaveCSS('display', 'none');
  const box = await handle.boundingBox();
  expect(box).not.toBeNull();
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.up();
}

test.describe('v2.15 — zero-move resize handle click is a no-op', () => {
  test('absolute element: style attribute unchanged, no history entry', async ({ page }) => {
    await loadDocumentWithEditor(page, 'foreign-deck.html');
    await page.keyboard.press('e');

    // One real edit first so undo has a known prior state to unwind: drag
    // the (already absolute) foreign card.
    const card = page.locator('.slide.active [data-testid="foreign-card"]');
    const cardBefore = await card.evaluate((el) => ({ left: el.offsetLeft, top: el.offsetTop }));
    await card.click();
    await dragBySelector(page, '.slide.active [data-testid="foreign-card"]', 40, 20);
    const cardDragged = await card.evaluate((el) => ({ left: el.offsetLeft, top: el.offsetTop }));
    expect(cardDragged.left).toBeGreaterThanOrEqual(cardBefore.left + 35);

    // The target is stylesheet-positioned absolute with NO inline style.
    const target = page.locator('.slide.active [data-testid="resize-target"]');
    await target.click();
    expect(await target.evaluate((el) => el.getAttribute('style'))).toBeNull();

    await zeroMoveHandleClick(page, 'wfpe-handle-se');

    // No mutation: still no inline style (responsive stylesheet sizing is
    // NOT silently locked in as fixed px), no freeze marker.
    expect(await target.evaluate((el) => ({
      style: el.getAttribute('style'),
      frozen: el.getAttribute('data-wfp-edit-frozen'),
    }))).toEqual({ style: null, frozen: null });

    // The release must not deselect the element.
    await expect(page.locator(`${ROOT} .wfpe-inspector`)).toHaveAttribute('data-visible', 'true');

    // No history entry: one undo unwinds exactly the earlier card drag.
    await page.keyboard.press('ControlOrMeta+z');
    expect(await card.evaluate((el) => ({ left: el.offsetLeft, top: el.offsetTop }))).toEqual(cardBefore);
    expect(await target.evaluate((el) => el.getAttribute('style'))).toBeNull();
  });

  test('flow element: no unlock cascade — no inline styles, no freeze markers, no toast', async ({ page }) => {
    await loadDocumentWithEditor(page, 'foreign-deck.html');
    await page.keyboard.press('e');

    const chip = page.locator('.slide.active .chip-row .chip').first();
    await chip.click();
    await expect(page.locator(`${ROOT} .wfpe-inspector`)).toHaveAttribute('data-visible', 'true');

    await zeroMoveHandleClick(page, 'wfpe-handle-se');

    const state = await page.evaluate(() => {
      const row = document.querySelector('.slide.active .chip-row');
      return {
        chipStyle: row.querySelector('.chip').getAttribute('style'),
        rowStyle: row.getAttribute('style'),
        rowFlexFrozen: row.getAttribute('data-wfp-edit-flex-frozen'),
        frozenInRow: row.querySelectorAll('[data-wfp-edit-frozen]').length,
        toastCount: document.querySelectorAll('#wfp-editor-root .wfpe-toast').length,
      };
    });
    expect(state).toEqual({
      chipStyle: null,
      rowStyle: null,
      rowFlexFrozen: null,
      frozenInRow: 0,
      toastCount: 0,
    });

    // Nothing to undo either: the chip stays untouched after Ctrl+Z.
    await page.keyboard.press('ControlOrMeta+z');
    expect(await chip.evaluate((el) => el.getAttribute('style'))).toBeNull();
  });

  test('a real resize still works and is exactly one undo step', async ({ page }) => {
    await loadDocumentWithEditor(page, 'foreign-deck.html');
    await page.keyboard.press('e');

    const target = page.locator('.slide.active [data-testid="resize-target"]');
    await target.click();
    const before = await target.evaluate((el) => ({
      width: el.offsetWidth,
      height: el.offsetHeight,
    }));

    const handle = page.locator(`${ROOT} .wfpe-handle-se`);
    await expect(handle).not.toHaveCSS('display', 'none');
    const box = await handle.boundingBox();
    expect(box).not.toBeNull();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2 + 40, { steps: 4 });
    await page.mouse.up();

    const resized = await target.evaluate((el) => ({
      width: el.offsetWidth,
      height: el.offsetHeight,
    }));
    expect(resized.width).toBeGreaterThanOrEqual(before.width + 55);
    expect(resized.height).toBeGreaterThanOrEqual(before.height + 35);

    // Exactly one history entry: a single undo restores the pristine
    // attribute-less element (a second entry would leave the mousedown
    // "lock-in" styles behind).
    await page.keyboard.press('ControlOrMeta+z');
    expect(await target.evaluate((el) => ({
      style: el.getAttribute('style'),
      width: el.offsetWidth,
      height: el.offsetHeight,
    }))).toEqual({ style: null, width: before.width, height: before.height });
  });
});
