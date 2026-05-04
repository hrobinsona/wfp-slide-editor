import { test, expect } from '@playwright/test';
import { loadFixtureWithEditor } from './_helpers.js';

// v2.6 — inspector-during-text-edit. The brief carves out two
// behaviours from v1's "click outside ends the text edit" rule:
//   1. Clicks inside the inspector panel do NOT end the text edit.
//   2. Inspector adjustments while editing apply to the element being
//      edited and produce one history entry per adjustment — exactly
//      as outside text-edit mode (the typing keeps its own entry).

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

async function startTextEdit(page, selector) {
  // Use dblclick; the v1 onDoubleClick handler turns the element into
  // contenteditable.
  await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
  }, selector);
}

test.describe('v2.6 — inspector during inline text edit', () => {
  test.beforeEach(async ({ page }) => {
    await loadFixtureWithEditor(page, 'Townhall-1.html');
    await page.evaluate(() => { document.querySelector('.deck').style.transform = 'scale(1)'; });
    await page.keyboard.press('e');
  });

  test('clicking inside the inspector does NOT end an open text edit', async ({ page }) => {
    await selectByMouse(page, '.slide.active h1');
    await startTextEdit(page, '.slide.active h1');

    // Confirm we are in text-edit mode.
    const editingBefore = await page.evaluate(() =>
      document.querySelector('.slide.active h1').getAttribute('contenteditable')
    );
    expect(editingBefore).toBe('true');

    // Click somewhere inside the inspector body (the empty padding
    // around the rows is fine — pick the inspector wrapper itself).
    await page.locator('#wfp-editor-root .wfpe-inspector-title').click();

    const editingAfter = await page.evaluate(() =>
      document.querySelector('.slide.active h1').getAttribute('contenteditable')
    );
    expect(editingAfter).toBe('true');
  });

  test('clicking a different slide element ends the text edit (preserves v1 outside-click semantics)', async ({ page }) => {
    await selectByMouse(page, '.slide.active h1');
    await startTextEdit(page, '.slide.active h1');
    expect(
      await page.evaluate(() => document.querySelector('.slide.active h1').getAttribute('contenteditable'))
    ).toBe('true');

    // Mousedown on a different slide element — simulate by dispatching
    // a real event on the WFP badge (which sits outside the inspector
    // footprint of the H1's vicinity).
    await page.evaluate(() => {
      const el = document.querySelector('.slide.active .wfp-badge');
      const r = el.getBoundingClientRect();
      el.dispatchEvent(new MouseEvent('mousedown', {
        bubbles: true, cancelable: true,
        clientX: r.left + 1, clientY: r.top + 1, button: 0,
      }));
    });

    const editingAfter = await page.evaluate(() =>
      document.querySelector('.slide.active h1').getAttribute('contenteditable')
    );
    // contenteditable was either removed or set to "false" — both
    // mean "no longer in edit mode".
    expect(editingAfter === null || editingAfter === 'false').toBe(true);
  });

  test('font-size adjustment during text-edit applies to the editing element as one history entry, separate from the typing', async ({ page }) => {
    await selectByMouse(page, '.slide.active h1');
    const beforeFs = await page.evaluate(
      () => parseFloat(getComputedStyle(document.querySelector('.slide.active h1')).fontSize)
    );
    const beforeHtml = await page.evaluate(
      () => document.querySelector('.slide.active h1').innerHTML
    );

    await startTextEdit(page, '.slide.active h1');
    // Type content into the editing element. We append a text node
    // directly so we don't have to rely on Playwright's keyboard
    // routing through contenteditable focus.
    await page.evaluate(() => {
      const el = document.querySelector('.slide.active h1');
      el.appendChild(document.createTextNode(' XYZ'));
    });

    // Use the inspector + button to bump font-size while edit is open.
    await page.locator('#wfp-editor-root .wfpe-font-btn[data-action="font-plus"]').click();

    // Then end the text edit by pressing Escape (caught by the editor's
    // global keydown handler when text-edit is open).
    await page.evaluate(() => {
      // Escape is suppressed inside inspector inputs; make sure focus
      // is back on the editing element.
      document.querySelector('.slide.active h1').focus();
    });
    await page.keyboard.press('Escape');

    const afterFs = await page.evaluate(
      () => parseFloat(getComputedStyle(document.querySelector('.slide.active h1')).fontSize)
    );
    const afterHtml = await page.evaluate(
      () => document.querySelector('.slide.active h1').innerHTML
    );
    expect(afterFs).toBeGreaterThan(beforeFs); // + button applied
    expect(afterHtml).toContain('XYZ'); // typing committed

    // Two undos — one for the typing, one for the font-size bump —
    // should leave the element exactly as it was before either edit.
    await page.keyboard.press('Control+z');
    await page.keyboard.press('Control+z');

    const restoredFs = await page.evaluate(
      () => parseFloat(getComputedStyle(document.querySelector('.slide.active h1')).fontSize)
    );
    const restoredHtml = await page.evaluate(
      () => document.querySelector('.slide.active h1').innerHTML
    );
    expect(restoredFs).toBeCloseTo(beforeFs, 1);
    expect(restoredHtml).toBe(beforeHtml);
  });

  test('colour adjustment during text-edit applies to the editing element', async ({ page }) => {
    await selectByMouse(page, '.slide.active h1');
    await startTextEdit(page, '.slide.active h1');

    // Apply text colour via hex input. The inspector input shouldn't
    // commit the text-edit (which would tear down contenteditable).
    const hex = page.locator('#wfp-editor-root input[data-wfpe-prop="textColorHex"]');
    await hex.click({ clickCount: 3 });
    await hex.fill('#225588');
    await hex.press('Enter');

    // The colour change should have applied to the H1.
    expect(
      await page.evaluate(() => document.querySelector('.slide.active h1').style.color)
    ).toBe('rgb(34, 85, 136)');
    // The H1 should still be in text-edit mode — the inspector commit
    // doesn't tear down contenteditable.
    expect(
      await page.evaluate(() => document.querySelector('.slide.active h1').getAttribute('contenteditable'))
    ).toBe('true');
  });

  test('typing into an inspector input does NOT route keystrokes to the text-edit target', async ({ page }) => {
    await selectByMouse(page, '.slide.active h1');
    await startTextEdit(page, '.slide.active h1');

    const beforeHtml = await page.evaluate(
      () => document.querySelector('.slide.active h1').innerHTML
    );

    // Focus an inspector input and type a few characters.
    const xInput = page.locator('#wfp-editor-root input[data-wfpe-prop="x"]');
    await xInput.focus();
    await page.keyboard.type('123');

    const afterHtml = await page.evaluate(
      () => document.querySelector('.slide.active h1').innerHTML
    );
    // The H1 content must be unchanged — the keystrokes went to the
    // input, not the contenteditable.
    expect(afterHtml).toBe(beforeHtml);
    // And the input received the value.
    expect(await xInput.inputValue()).toContain('123');
  });

  test('typing after a hex-colour commit during text-edit still produces its own undoable entry', async ({ page }) => {
    await selectByMouse(page, '.slide.active h1');
    const beforeHtml = await page.evaluate(
      () => document.querySelector('.slide.active h1').innerHTML
    );

    await startTextEdit(page, '.slide.active h1');
    // Type, commit hex colour, type again. Each user-driven action
    // must be its own undo entry: typing-1 / colour / typing-2.
    await page.evaluate(() => {
      document.querySelector('.slide.active h1').appendChild(document.createTextNode(' first'));
    });

    const hex = page.locator('#wfp-editor-root input[data-wfpe-prop="textColorHex"]');
    await hex.click({ clickCount: 3 });
    await hex.fill('#990033');
    await hex.press('Enter');

    await page.evaluate(() => {
      document.querySelector('.slide.active h1').focus();
      document.querySelector('.slide.active h1').appendChild(document.createTextNode(' second'));
    });
    await page.keyboard.press('Escape');

    // Sanity: all three changes landed.
    expect(await page.evaluate(() =>
      document.querySelector('.slide.active h1').innerHTML
    )).toContain('first');
    expect(await page.evaluate(() =>
      document.querySelector('.slide.active h1').innerHTML
    )).toContain('second');
    expect(await page.evaluate(() =>
      document.querySelector('.slide.active h1').style.color
    )).toBe('rgb(153, 0, 51)');

    // Three undos walk back exactly to the pre-edit state.
    await page.keyboard.press('Control+z'); // typing-2 (' second')
    await page.keyboard.press('Control+z'); // colour change
    await page.keyboard.press('Control+z'); // typing-1 (' first')

    expect(await page.evaluate(() =>
      document.querySelector('.slide.active h1').innerHTML
    )).toBe(beforeHtml);
    expect(await page.evaluate(() =>
      document.querySelector('.slide.active h1').style.color
    )).toBe('');
  });

  test('inspector stays visible during text-edit', async ({ page }) => {
    await selectByMouse(page, '.slide.active h1');
    expect(
      await page.evaluate(() => document.querySelector('.wfpe-inspector').dataset.visible)
    ).toBe('true');
    await startTextEdit(page, '.slide.active h1');
    expect(
      await page.evaluate(() => document.querySelector('.wfpe-inspector').dataset.visible)
    ).toBe('true');
    expect(
      await page.evaluate(() => getComputedStyle(document.querySelector('.wfpe-inspector')).display)
    ).not.toBe('none');
  });
});
