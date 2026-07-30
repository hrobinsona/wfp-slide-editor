import { test, expect } from '@playwright/test';
import { loadFixtureWithEditor, requireAbsoluteTarget } from './_helpers.js';

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

async function ringAndTargetState(page, selector) {
  return page.evaluate((sel) => {
    window.dispatchEvent(new Event('scroll'));
    const ring = document.querySelector('#wfp-editor-root .wfpe-selection-ring');
    const target = document.querySelector(sel).getBoundingClientRect();
    return {
      ring: {
        display: ring.style.display,
        top: parseFloat(ring.style.top || '0'),
        left: parseFloat(ring.style.left || '0'),
        width: parseFloat(ring.style.width || '0'),
        height: parseFloat(ring.style.height || '0'),
      },
      target: {
        top: target.top,
        left: target.left,
        width: target.width,
        height: target.height,
      },
    };
  }, selector);
}

async function waitForAnimationFrames(page, count = 2) {
  await page.evaluate((frames) => {
    return new Promise((resolve) => {
      function tick(remaining) {
        if (remaining <= 0) {
          resolve();
          return;
        }
        requestAnimationFrame(() => tick(remaining - 1));
      }
      tick(frames);
    });
  }, count);
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
    const { ring: state, target } = await ringAndTargetState(page, '.slide.active h1');

    expect(state.display).toBe('block');
    expect(state.top).toBeCloseTo(target.top, 0);
    expect(state.left).toBeCloseTo(target.left, 0);
    expect(state.width).toBeCloseTo(target.width, 0);
    expect(state.height).toBeCloseTo(target.height, 0);
  });

  test('selection ring follows a selected element after late layout movement', async ({ page }) => {
    await loadFixtureWithEditor(page, 'Townhall-1.html');
    await page.keyboard.press('e');

    await page.evaluate(() => {
      const slide = document.querySelector('.slide.active');
      const el = document.createElement('div');
      el.dataset.testMovingSelection = 'yes';
      el.textContent = 'Moving selection target';
      el.style.cssText = [
        'position:absolute',
        'left:220px',
        'top:180px',
        'width:260px',
        'height:42px',
        'font-size:24px',
      ].join(';');
      slide.appendChild(el);
    });

    await clickElement(page, '[data-test-moving-selection="yes"]');

    await page.evaluate(() => {
      const el = document.querySelector('[data-test-moving-selection="yes"]');
      el.style.top = '212px';
    });
    await waitForAnimationFrames(page, 2);

    const state = await ringState(page);
    const target = await rectOf(page, '[data-test-moving-selection="yes"]');

    expect(state.display).toBe('block');
    expect(state.top).toBeCloseTo(target.top, 0);
    expect(state.left).toBeCloseTo(target.left, 0);
    expect(state.width).toBeCloseTo(target.width, 0);
    expect(state.height).toBeCloseTo(target.height, 0);
  });

  test('selecting another element moves the ring', async ({ page }) => {
    await loadFixtureWithEditor(page, 'Townhall-1.html');
    const target = await requireAbsoluteTarget(page);
    await page.keyboard.press('e');

    await clickElement(page, '.slide.active h1');
    const first = await ringState(page);

    await clickElement(page, target);
    const second = await ringState(page);
    const second_target = await rectOf(page, target);

    expect(second.display).toBe('block');
    expect(second.left).toBeCloseTo(second_target.left, 0);
    expect(second.left).not.toBeCloseTo(first.left, 0);
  });

  test('clicking the editor toolbar (non-button area) does NOT change selection', async ({ page }) => {
    await loadFixtureWithEditor(page, 'Townhall-1.html');
    await page.keyboard.press('e');

    await clickElement(page, '.slide.active h1');

    // Click the toolbar wrapper itself (not a button). The capture-phase
    // onClick must short-circuit for any editor-root target so the H1
    // selection isn't replaced by the toolbar.
    await clickElement(page, '#wfp-editor-root .wfpe-toolbar');
    const { ring: after, target } = await ringAndTargetState(page, '.slide.active h1');

    expect(after.display).toBe('block');
    expect(after.left).toBeCloseTo(target.left, 0);
    expect(after.top).toBeCloseTo(target.top, 0);
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

    // Advance the deck the way the editor's own overview does: move `.active`
    // to the next slide. A global goTo() was an artefact of the retired
    // fixtures, not part of the deck contract in DESIGN.md.
    await page.evaluate(() => {
      const slides = [...document.querySelectorAll('.deck > .slide')];
      const current = slides.findIndex((s) => s.classList.contains('active'));
      const next = slides[current + 1] || slides[0];
      slides.forEach((s) => {
        if (s !== next) s.classList.remove('active', 'visible');
      });
      next.classList.add('active');
    });
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
