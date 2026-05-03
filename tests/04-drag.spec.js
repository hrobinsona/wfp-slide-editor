import { test, expect } from '@playwright/test';
import { loadFixtureWithEditor } from './_helpers.js';

// Use a large viewport so the 1920x1080 deck fits at scale=1.
test.use({ viewport: { width: 2000, height: 1200 } });

async function setDeckScale(page, scale) {
  await page.evaluate((s) => {
    const deck = document.querySelector('.deck');
    deck.style.transform = `scale(${s})`;
  }, scale);
}

async function readAbsoluteOffset(page, selector) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    return { left: el.offsetLeft, top: el.offsetTop };
  }, selector);
}

async function readPosition(page, selector) {
  return page.evaluate(
    (sel) => getComputedStyle(document.querySelector(sel)).position,
    selector,
  );
}

async function viewportCenterOf(page, selector) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }, selector);
}

async function dragByViewportPx(page, fromSelector, dxViewport, dyViewport) {
  const { x, y } = await viewportCenterOf(page, fromSelector);
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dxViewport / 2, y + dyViewport / 2, { steps: 5 });
  await page.mouse.move(x + dxViewport, y + dyViewport, { steps: 5 });
  await page.mouse.up();
}

test.describe('Phase 4 — Drag', () => {
  test('drags an absolute element by exact viewport delta when scale=1', async ({ page }) => {
    await loadFixtureWithEditor(page, 'Townhall-1.html');
    await setDeckScale(page, 1);
    await page.keyboard.press('e');

    const before = await readAbsoluteOffset(page, '.slide.active .wfp-badge');
    await dragByViewportPx(page, '.slide.active .wfp-badge', 100, 50);
    const after = await readAbsoluteOffset(page, '.slide.active .wfp-badge');

    expect(after.left - before.left).toBeCloseTo(100, 0);
    expect(after.top - before.top).toBeCloseTo(50, 0);
  });

  test('scale-aware: at scale=0.5, viewport delta of 100px → 200px in slide space', async ({
    page,
  }) => {
    await loadFixtureWithEditor(page, 'Townhall-1.html');
    await setDeckScale(page, 0.5);
    await page.keyboard.press('e');

    const before = await readAbsoluteOffset(page, '.slide.active .wfp-badge');
    await dragByViewportPx(page, '.slide.active .wfp-badge', 100, 0);
    const after = await readAbsoluteOffset(page, '.slide.active .wfp-badge');

    expect(after.left - before.left).toBeCloseTo(200, 0);
  });

  test('a click without movement does not move the element (5px deadzone)', async ({
    page,
  }) => {
    await loadFixtureWithEditor(page, 'Townhall-1.html');
    await setDeckScale(page, 1);
    await page.keyboard.press('e');

    const before = await readAbsoluteOffset(page, '.slide.active .wfp-badge');

    const { x, y } = await viewportCenterOf(page, '.slide.active .wfp-badge');
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 2, y + 1, { steps: 2 }); // under deadzone
    await page.mouse.up();

    const after = await readAbsoluteOffset(page, '.slide.active .wfp-badge');
    expect(after.left).toBeCloseTo(before.left, 0);
    expect(after.top).toBeCloseTo(before.top, 0);
  });

  test('flow-positioned element is converted to absolute on first drag and shows a toast', async ({
    page,
  }) => {
    await loadFixtureWithEditor(page, 'Townhall-1.html');
    await setDeckScale(page, 1);
    await page.keyboard.press('e');

    // Find a flow-positioned text element inside the active slide.
    const tagged = await page.evaluate(() => {
      const candidates = [...document.querySelectorAll('.slide.active *')];
      const flow = candidates.find((el) => {
        const cs = getComputedStyle(el);
        if (cs.position === 'absolute' || cs.position === 'fixed') return false;
        // Must have a stable bounding rect, be visible, and have direct text.
        const r = el.getBoundingClientRect();
        if (r.width < 20 || r.height < 8) return false;
        const hasText = [...el.childNodes].some(
          (n) => n.nodeType === 3 && n.textContent.trim().length > 0,
        );
        return hasText;
      });
      if (!flow) return null;
      flow.dataset.testTarget = 'flow-drag';
      return getComputedStyle(flow).position;
    });
    expect(tagged).not.toBeNull();
    expect(tagged).not.toBe('absolute');
    expect(tagged).not.toBe('fixed');

    await dragByViewportPx(page, '[data-test-target="flow-drag"]', 30, 20);

    expect(await readPosition(page, '[data-test-target="flow-drag"]')).toBe('absolute');

    const toastVisible = await page.evaluate(() => {
      const t = document.querySelector('#wfp-editor-root .wfpe-toast');
      return !!t && /Unlocked/i.test(t.textContent || '');
    });
    expect(toastVisible).toBe(true);
  });

  test('drag preserves existing unrelated inline styles (e.g. animation-delay)', async ({
    page,
  }) => {
    await loadFixtureWithEditor(page, 'Townhall-1.html');
    await setDeckScale(page, 1);
    await page.keyboard.press('e');

    // Pin a known inline style on the WFP badge.
    await page.evaluate(() => {
      const el = document.querySelector('.slide.active .wfp-badge');
      el.style.animationDelay = '200ms';
    });

    await dragByViewportPx(page, '.slide.active .wfp-badge', 25, 0);

    const animationDelay = await page.evaluate(
      () => document.querySelector('.slide.active .wfp-badge').style.animationDelay,
    );
    expect(animationDelay).toBe('200ms');
  });

  test('mousedown on non-selectable area (the .slide background) does not start a drag', async ({
    page,
  }) => {
    await loadFixtureWithEditor(page, 'Townhall-1.html');
    await setDeckScale(page, 1);
    await page.keyboard.press('e');

    const before = await readAbsoluteOffset(page, '.slide.active .wfp-badge');

    // Mousedown on the slide itself (not a descendant); move; mouseup. Should not
    // drag any element.
    const slideRect = await page.evaluate(() => {
      const r = document.querySelector('.slide.active').getBoundingClientRect();
      return { x: r.left + 5, y: r.top + 5 };
    });
    await page.mouse.move(slideRect.x, slideRect.y);
    await page.mouse.down();
    await page.mouse.move(slideRect.x + 50, slideRect.y, { steps: 4 });
    await page.mouse.up();

    const after = await readAbsoluteOffset(page, '.slide.active .wfp-badge');
    expect(after.left).toBeCloseTo(before.left, 0);
  });
});
