import { test, expect } from '@playwright/test';
import { loadFixtureWithEditor, hitPointFor } from './_helpers.js';

// v2.6 — inspector-during-text-edit. The brief carves out two
// behaviours from v1's "click outside ends the text edit" rule:
//   1. Clicks inside the inspector panel do NOT end the text edit.
//   2. Inspector adjustments while editing apply to the element being
//      edited and produce one history entry per adjustment — exactly
//      as outside text-edit mode (the typing keeps its own entry).

test.use({ viewport: { width: 2000, height: 1200 } });

async function selectByMouse(page, selector) {
  const center = await hitPointFor(page, selector);
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

async function selectTextRange(page, selector, text) {
  await page.evaluate(({ selector: sel, text: needle }) => {
    const el = document.querySelector(sel);
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node && !node.textContent.includes(needle)) node = walker.nextNode();
    if (!node) throw new Error(`Text not found: ${needle}`);
    const start = node.textContent.indexOf(needle);
    const range = document.createRange();
    range.setStart(node, start);
    range.setEnd(node, start + needle.length);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
  }, { selector, text });
}

async function collapseTextSelection(page, selector) {
  await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    const textNode = [...el.childNodes].find((node) => node.nodeType === Node.TEXT_NODE);
    const range = document.createRange();
    range.setStart(textNode, 0);
    range.collapse(true);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
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

    // Mousedown on a DIFFERENT slide element. Discovered from the fixture
    // rather than named: the element only has to be another selectable node on
    // the active slide, outside the H1.
    const other = await page.evaluate(() => {
      const slide = document.querySelector('.slide.active');
      const h1 = slide.querySelector('h1');
      const el = [...slide.querySelectorAll('*')].find((n) => {
        if (h1 && (n === h1 || h1.contains(n) || n.contains(h1))) return false;
        const r = n.getBoundingClientRect();
        return r.width > 20 && r.height > 12;
      });
      if (!el) return null;
      el.dataset.testOther = 'yes';
      return '[data-test-other="yes"]';
    });
    test.skip(!other, 'no second selectable element on this fixture\'s active slide');
    await page.evaluate((sel) => {
      const el = document.querySelector(sel);
      const r = el.getBoundingClientRect();
      el.dispatchEvent(new MouseEvent('mousedown', {
        bubbles: true, cancelable: true,
        clientX: r.left + 1, clientY: r.top + 1, button: 0,
      }));
    }, other);

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

  test('text colour applies to a selected word inside a plain title', async ({ page }) => {
    await selectByMouse(page, '.slide.active h1');
    await page.evaluate(() => {
      document.querySelector('.slide.active h1').innerHTML = 'Alpha Beta Gamma';
    });
    await startTextEdit(page, '.slide.active h1');
    await selectTextRange(page, '.slide.active h1', 'Beta');

    const hex = page.locator('#wfp-editor-root input[data-wfpe-prop="textColorHex"]');
    await hex.click({ clickCount: 3 });
    await hex.fill('#ff3344');
    await hex.press('Enter');

    const result = await page.evaluate(() => {
      const h1 = document.querySelector('.slide.active h1');
      const spans = [...h1.querySelectorAll('span')].map((span) => ({
        text: span.textContent,
        color: span.style.color,
      }));
      return { text: h1.textContent, elementColor: h1.style.color, spans };
    });
    expect(result.text).toBe('Alpha Beta Gamma');
    expect(result.elementColor).toBe('');
    expect(result.spans).toEqual([{ text: 'Beta', color: 'rgb(255, 51, 68)' }]);
  });

  test('inspector focus preserves the saved text range before text colour commit', async ({ page }) => {
    await selectByMouse(page, '.slide.active h1');
    await page.evaluate(() => {
      document.querySelector('.slide.active h1').innerHTML = 'Alpha Beta Gamma';
    });
    await startTextEdit(page, '.slide.active h1');
    await selectTextRange(page, '.slide.active h1', 'Beta');

    await page.locator('#wfp-editor-root .wfpe-inspector-title').click();
    const hex = page.locator('#wfp-editor-root input[data-wfpe-prop="textColorHex"]');
    await hex.click({ clickCount: 3 });
    await hex.fill('#225588');
    await hex.press('Enter');

    expect(await page.evaluate(() =>
      document.querySelector('.slide.active h1 span').outerHTML
    )).toBe('<span style="color: rgb(34, 85, 136);">Beta</span>');
  });

  test('focusing and blurring text colour without changing it does not wrap the saved range', async ({ page }) => {
    await selectByMouse(page, '.slide.active h1');
    await page.evaluate(() => {
      document.querySelector('.slide.active h1').innerHTML = 'Alpha Beta Gamma';
    });
    await startTextEdit(page, '.slide.active h1');
    await selectTextRange(page, '.slide.active h1', 'Beta');

    const hex = page.locator('#wfp-editor-root input[data-wfpe-prop="textColorHex"]');
    await hex.focus();
    await page.locator('#wfp-editor-root .wfpe-inspector-title').click();

    expect(await page.evaluate(() =>
      document.querySelector('.slide.active h1').innerHTML
    )).toBe('Alpha Beta Gamma');
  });

  test('recolouring the same selected word updates one span and refreshes the colour readout', async ({ page }) => {
    await selectByMouse(page, '.slide.active h1');
    await page.evaluate(() => {
      document.querySelector('.slide.active h1').innerHTML = 'Alpha Beta Gamma';
    });
    await startTextEdit(page, '.slide.active h1');
    await selectTextRange(page, '.slide.active h1', 'Beta');

    const hex = page.locator('#wfp-editor-root input[data-wfpe-prop="textColorHex"]');
    await hex.click({ clickCount: 3 });
    await hex.fill('#111111');
    await hex.press('Enter');
    await hex.click({ clickCount: 3 });
    await hex.fill('#225588');
    await hex.press('Enter');

    expect(await page.evaluate(() => {
      const h1 = document.querySelector('.slide.active h1');
      return [...h1.querySelectorAll('span')].map((span) => ({
        html: span.outerHTML,
        color: span.style.color,
      }));
    })).toEqual([{
      html: '<span style="color: rgb(34, 85, 136);">Beta</span>',
      color: 'rgb(34, 85, 136)',
    }]);
    expect(await page.evaluate(() =>
      document.querySelector('#wfp-editor-root input[type="color"][data-wfpe-target="text"]').value
    )).toBe('#225588');
  });

  test('native picker range colour updates one span and creates one undo entry', async ({ page }) => {
    await selectByMouse(page, '.slide.active h1');
    await page.evaluate(() => {
      document.querySelector('.slide.active h1').innerHTML = 'Alpha Beta Gamma';
    });
    await startTextEdit(page, '.slide.active h1');
    await selectTextRange(page, '.slide.active h1', 'Beta');

    await page.evaluate(() => {
      const input = document.querySelector('#wfp-editor-root input[type="color"][data-wfpe-target="text"]');
      input.value = '#111111';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.value = '#225588';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });

    expect(await page.evaluate(() => {
      const h1 = document.querySelector('.slide.active h1');
      return [...h1.querySelectorAll('span')].map((span) => ({
        text: span.textContent,
        color: span.style.color,
      }));
    })).toEqual([{ text: 'Beta', color: 'rgb(34, 85, 136)' }]);

    await page.keyboard.press('Escape');
    await page.keyboard.press('ControlOrMeta+z');
    expect(await page.evaluate(() =>
      document.querySelector('.slide.active h1').innerHTML
    )).toBe('Alpha Beta Gamma');
  });

  test('text colour falls back to the whole element when no text range is selected', async ({ page }) => {
    await selectByMouse(page, '.slide.active h1');
    await page.evaluate(() => {
      document.querySelector('.slide.active h1').innerHTML = 'Alpha Beta Gamma';
    });
    await startTextEdit(page, '.slide.active h1');
    await collapseTextSelection(page, '.slide.active h1');

    const hex = page.locator('#wfp-editor-root input[data-wfpe-prop="textColorHex"]');
    await hex.click({ clickCount: 3 });
    await hex.fill('#990033');
    await hex.press('Enter');

    expect(await page.evaluate(() =>
      document.querySelector('.slide.active h1').style.color
    )).toBe('rgb(153, 0, 51)');
    expect(await page.evaluate(() =>
      document.querySelectorAll('.slide.active h1 span').length
    )).toBe(0);
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

  test('typing before and after a range colour edit keeps separate undo entries', async ({ page }) => {
    await selectByMouse(page, '.slide.active h1');
    await page.evaluate(() => {
      document.querySelector('.slide.active h1').innerHTML = 'Alpha Beta Gamma';
    });
    const beforeHtml = await page.evaluate(
      () => document.querySelector('.slide.active h1').innerHTML
    );

    await startTextEdit(page, '.slide.active h1');
    await page.evaluate(() => {
      document.querySelector('.slide.active h1').appendChild(document.createTextNode(' first'));
    });
    await selectTextRange(page, '.slide.active h1', 'Beta');

    const hex = page.locator('#wfp-editor-root input[data-wfpe-prop="textColorHex"]');
    await hex.click({ clickCount: 3 });
    await hex.fill('#225588');
    await hex.press('Enter');

    await page.evaluate(() => {
      document.querySelector('.slide.active h1').focus();
      document.querySelector('.slide.active h1').appendChild(document.createTextNode(' second'));
    });
    await page.keyboard.press('Escape');

    expect(await page.evaluate(() =>
      document.querySelector('.slide.active h1').innerHTML
    )).toContain('second');
    expect(await page.evaluate(() =>
      document.querySelector('.slide.active h1 span').style.color
    )).toBe('rgb(34, 85, 136)');

    await page.keyboard.press('ControlOrMeta+z');
    expect(await page.evaluate(() =>
      document.querySelector('.slide.active h1').innerHTML
    )).not.toContain('second');

    await page.keyboard.press('ControlOrMeta+z');
    expect(await page.evaluate(() =>
      document.querySelectorAll('.slide.active h1 span').length
    )).toBe(0);

    await page.keyboard.press('ControlOrMeta+z');
    expect(await page.evaluate(() =>
      document.querySelector('.slide.active h1').innerHTML
    )).toBe(beforeHtml);
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
    // Ink-glass 3b: visibility is driven by the dock fold, not display.
    expect(
      await page.evaluate(() => getComputedStyle(document.querySelector('.wfpe-inspector')).visibility)
    ).toBe('visible');
    expect(
      await page.evaluate(() => document.querySelector('.wfpe-inspector-dock').dataset.visible)
    ).toBe('true');
  });
});
