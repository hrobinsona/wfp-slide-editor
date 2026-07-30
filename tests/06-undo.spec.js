import { test, expect } from '@playwright/test';
import { loadFixtureWithEditor, requireAbsoluteTarget, hitPointFor } from './_helpers.js';

test.use({ viewport: { width: 2000, height: 1200 } });

async function setDeckScale(page, scale) {
  await page.evaluate((s) => {
    document.querySelector('.deck').style.transform = `scale(${s})`;
  }, scale);
}

async function clickToSelect(page, selector) {
  return page.evaluate((sel) => {
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

async function readBox(page, selector) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    return {
      left: el.offsetLeft,
      top: el.offsetTop,
      width: el.offsetWidth,
      height: el.offsetHeight,
      fontSize: parseFloat(getComputedStyle(el).fontSize),
      inlineLeft: el.style.left,
      inlineTop: el.style.top,
      inlineWidth: el.style.width,
      inlineHeight: el.style.height,
    };
  }, selector);
}

async function viewportCenter(page, selector) {
  return hitPointFor(page, selector);
}

async function dragByViewportPx(page, selector, dx, dy) {
  const c = await viewportCenter(page, selector);
  await page.mouse.move(c.x, c.y);
  await page.mouse.down();
  await page.mouse.move(c.x + dx / 2, c.y + dy / 2, { steps: 5 });
  await page.mouse.move(c.x + dx, c.y + dy, { steps: 5 });
  await page.mouse.up();
}

test.describe('Phase 6 — Undo/redo', () => {
  test('Cmd+Z restores the position after a drag', async ({ page }) => {
    await loadFixtureWithEditor(page, 'Townhall-1.html');
    const target = await requireAbsoluteTarget(page);
    await setDeckScale(page, 1);
    await page.keyboard.press('e');

    const before = await readBox(page, target);
    await dragByViewportPx(page, target, 80, 40);
    const dragged = await readBox(page, target);
    expect(dragged.left - before.left).toBeCloseTo(80, 0);

    await page.keyboard.press('ControlOrMeta+z');
    const restored = await readBox(page, target);
    expect(restored.left).toBeCloseTo(before.left, 0);
    expect(restored.top).toBeCloseTo(before.top, 0);
  });

  test('Cmd+Shift+Z (redo) reapplies the dragged position', async ({ page }) => {
    await loadFixtureWithEditor(page, 'Townhall-1.html');
    const target = await requireAbsoluteTarget(page);
    await setDeckScale(page, 1);
    await page.keyboard.press('e');

    const before = await readBox(page, target);
    await dragByViewportPx(page, target, 60, 0);
    const dragged = await readBox(page, target);

    await page.keyboard.press('ControlOrMeta+z');
    const undone = await readBox(page, target);
    expect(undone.left).toBeCloseTo(before.left, 0);

    await page.keyboard.press('ControlOrMeta+Shift+z');
    const redone = await readBox(page, target);
    expect(redone.left).toBeCloseTo(dragged.left, 0);
    expect(redone.top).toBeCloseTo(dragged.top, 0);
  });

  test('Cmd+Y is an alias for redo', async ({ page }) => {
    await loadFixtureWithEditor(page, 'Townhall-1.html');
    const target = await requireAbsoluteTarget(page);
    await setDeckScale(page, 1);
    await page.keyboard.press('e');

    const before = await readBox(page, target);
    await dragByViewportPx(page, target, 50, 0);
    const dragged = await readBox(page, target);
    await page.keyboard.press('ControlOrMeta+z');
    expect((await readBox(page, target)).left).toBeCloseTo(
      before.left,
      0,
    );
    await page.keyboard.press('ControlOrMeta+y');
    expect((await readBox(page, target)).left).toBeCloseTo(
      dragged.left,
      0,
    );
  });

  test('each font-size keystroke is its own history entry', async ({ page }) => {
    await loadFixtureWithEditor(page, 'Townhall-1.html');
    await setDeckScale(page, 1);
    await page.keyboard.press('e');

    await clickToSelect(page, '.slide.active h1');
    const before = await readBox(page, '.slide.active h1');

    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('ArrowUp');
    expect((await readBox(page, '.slide.active h1')).fontSize).toBeCloseTo(
      before.fontSize + 3,
      1,
    );

    await page.keyboard.press('ControlOrMeta+z');
    expect((await readBox(page, '.slide.active h1')).fontSize).toBeCloseTo(
      before.fontSize + 2,
      1,
    );

    await page.keyboard.press('ControlOrMeta+z');
    expect((await readBox(page, '.slide.active h1')).fontSize).toBeCloseTo(
      before.fontSize + 1,
      1,
    );

    await page.keyboard.press('ControlOrMeta+z');
    expect((await readBox(page, '.slide.active h1')).fontSize).toBeCloseTo(
      before.fontSize,
      1,
    );
  });

  test('a drag on a flow element undoes both the unlock and the position change', async ({
    page,
  }) => {
    await loadFixtureWithEditor(page, 'Townhall-1.html');
    await setDeckScale(page, 1);
    await page.keyboard.press('e');

    // Find a flow-positioned element with direct text in the active slide,
    // sweeping slides if necessary.
    let tagged = await page.evaluate(() => {
      const slide = document.querySelector('.slide.active');
      const el = [...slide.querySelectorAll('*')].find((c) => {
        const cs = getComputedStyle(c);
        if (cs.position === 'absolute' || cs.position === 'fixed') return false;
        const r = c.getBoundingClientRect();
        if (r.width < 30 || r.height < 10) return false;
        return [...c.childNodes].some(
          (n) => n.nodeType === 3 && n.textContent.trim().length > 0,
        );
      });
      if (!el) return null;
      el.dataset.testFlow = 'yes';
      return getComputedStyle(el).position;
    });
    let attempts = 0;
    while (!tagged && attempts < 8) {
      attempts++;
      await page.evaluate((i) => window.goTo && window.goTo(i), attempts);
      await page.waitForTimeout(50);
      tagged = await page.evaluate(() => {
        const slide = document.querySelector('.slide.active');
        const el = [...slide.querySelectorAll('*')].find((c) => {
          const cs = getComputedStyle(c);
          if (cs.position === 'absolute' || cs.position === 'fixed') return false;
          const r = c.getBoundingClientRect();
          if (r.width < 30 || r.height < 10) return false;
          return [...c.childNodes].some(
            (n) => n.nodeType === 3 && n.textContent.trim().length > 0,
          );
        });
        if (!el) return null;
        el.dataset.testFlow = 'yes';
        return getComputedStyle(el).position;
      });
    }
    expect(tagged).not.toBeNull();
    expect(tagged).not.toBe('absolute');

    await dragByViewportPx(page, '[data-test-flow="yes"]', 30, 20);

    // Verify drag promoted the element.
    const afterDrag = await page.evaluate(
      () => getComputedStyle(document.querySelector('[data-test-flow="yes"]')).position,
    );
    expect(afterDrag).toBe('absolute');

    await page.keyboard.press('ControlOrMeta+z');

    // After undo, the element should be back to its pre-drag state — no inline
    // position style remains.
    const undoneState = await page.evaluate(() => {
      const el = document.querySelector('[data-test-flow="yes"]');
      return {
        inlinePosition: el.style.position,
        computedPosition: getComputedStyle(el).position,
        inlineLeft: el.style.left,
        inlineTop: el.style.top,
        inlineWidth: el.style.width,
        inlineHeight: el.style.height,
      };
    });
    expect(undoneState.inlinePosition).toBe('');
    expect(undoneState.inlineLeft).toBe('');
    expect(undoneState.inlineTop).toBe('');
    expect(undoneState.computedPosition).not.toBe('absolute');
  });

  test('undo after flow unlock does not leave inspector bound to a detached selection', async ({
    page,
  }) => {
    await loadFixtureWithEditor(page, 'Townhall-1.html');
    await setDeckScale(page, 1);
    await page.keyboard.press('e');

    await page.evaluate(() => {
      const slide = document.querySelector('.slide.active');
      const container = document.createElement('div');
      container.dataset.testFlowContainer = 'yes';
      container.style.cssText = [
        'position:absolute',
        'left:260px',
        'top:280px',
        'width:360px',
        'padding:16px',
        'display:flex',
        'flex-direction:column',
        'gap:8px',
        'font-size:24px',
        'background:rgba(255,255,255,0.01)',
      ].join(';');

      const child = document.createElement('p');
      child.dataset.testFlowChild = 'yes';
      child.textContent = 'Flow child for undo';
      child.style.cssText = 'margin:0';

      const sibling = document.createElement('p');
      sibling.textContent = 'Sibling';
      sibling.style.cssText = 'margin:0';

      container.append(child, sibling);
      slide.appendChild(container);
      window.__testFlowChildRef = child;
    });

    await dragByViewportPx(page, '[data-test-flow-child="yes"]', 40, 20);

    await page.keyboard.press('ControlOrMeta+z');

    const undoUi = await page.evaluate(() => {
      const ring = document.querySelector('#wfp-editor-root .wfpe-selection-ring');
      const inspector = document.querySelector('#wfp-editor-root .wfpe-inspector');
      const live = document.querySelector('[data-test-flow-child="yes"]');
      return {
        ringDisplay: ring.style.display,
        inspectorVisible: inspector.dataset.visible,
        oldReferenceConnected: window.__testFlowChildRef.isConnected,
        liveExists: !!live,
      };
    });

    expect(undoUi.liveExists).toBe(true);
    expect(undoUi.ringDisplay === 'block' || undoUi.inspectorVisible === 'false').toBe(
      true,
    );

    const beforeArrow = await page.evaluate(() => {
      return {
        oldReferenceConnected: window.__testFlowChildRef.isConnected,
        oldReferenceInlineFontSize: window.__testFlowChildRef.style.fontSize,
      };
    });

    await page.keyboard.press('ArrowUp');

    const afterArrow = await page.evaluate(() => {
      return {
        oldReferenceConnected: window.__testFlowChildRef.isConnected,
        oldReferenceInlineFontSize: window.__testFlowChildRef.style.fontSize,
      };
    });

    expect(
      afterArrow.oldReferenceConnected ||
        afterArrow.oldReferenceInlineFontSize === beforeArrow.oldReferenceInlineFontSize,
    ).toBe(true);
  });

  test('history caps at 50 entries; older entries drop off', async ({ page }) => {
    await loadFixtureWithEditor(page, 'Townhall-1.html');
    await setDeckScale(page, 1);
    await page.keyboard.press('e');

    await clickToSelect(page, '.slide.active h1');

    // Make 60 font-size nudges. The first 10 should fall off the 50-entry cap.
    for (let i = 0; i < 60; i++) {
      await page.keyboard.press('ArrowUp');
    }
    const big = (await readBox(page, '.slide.active h1')).fontSize;

    // 50 undos should restore as far back as the cap allows. The remaining
    // 10 entries beyond the cap are gone, so the font-size should not return
    // all the way to the original value.
    for (let i = 0; i < 50; i++) {
      await page.keyboard.press('ControlOrMeta+z');
    }
    const small = (await readBox(page, '.slide.active h1')).fontSize;

    // After 50 undos, font is bigger than original (because the oldest 10
    // nudges weren't recorded).
    expect(big - small).toBeCloseTo(50, 0);
    expect(small).toBeGreaterThan(big - 60);

    // Spamming additional Cmd+Z is a no-op, not an error.
    for (let i = 0; i < 5; i++) {
      await page.keyboard.press('ControlOrMeta+z');
    }
    const stillSmall = (await readBox(page, '.slide.active h1')).fontSize;
    expect(stillSmall).toBeCloseTo(small, 1);
  });

  test('a new change after partial undo clears the redo stack', async ({ page }) => {
    await loadFixtureWithEditor(page, 'Townhall-1.html');
    await setDeckScale(page, 1);
    await page.keyboard.press('e');

    await clickToSelect(page, '.slide.active h1');
    const before = (await readBox(page, '.slide.active h1')).fontSize;

    await page.keyboard.press('ArrowUp'); // +1
    await page.keyboard.press('ArrowUp'); // +2
    await page.keyboard.press('ArrowUp'); // +3

    await page.keyboard.press('ControlOrMeta+z'); // back to +2
    expect((await readBox(page, '.slide.active h1')).fontSize).toBeCloseTo(
      before + 2,
      1,
    );

    // New change here should clear the redo stack.
    await page.keyboard.press('ArrowDown'); // +1 (was +2, -1)
    expect((await readBox(page, '.slide.active h1')).fontSize).toBeCloseTo(
      before + 1,
      1,
    );

    // Redo should now do nothing — the +3 entry is gone.
    await page.keyboard.press('ControlOrMeta+Shift+z');
    expect((await readBox(page, '.slide.active h1')).fontSize).toBeCloseTo(
      before + 1,
      1,
    );
  });
});
