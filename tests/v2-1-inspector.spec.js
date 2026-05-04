import { test, expect } from '@playwright/test';
import { loadFixtureWithEditor } from './_helpers.js';

// v2.1 — inspector scaffold + minimise. The body is intentionally empty
// in this phase; subsequent phases populate font / colour / position /
// size / reset controls. These tests pin the visibility, structure, and
// minimise behaviour the brief specifies.

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

test.describe('v2.1 — inspector scaffold + minimise', () => {
  test('inspector is hidden by default and on initial editor load', async ({ page }) => {
    await loadFixtureWithEditor(page, 'Townhall-1.html');
    const state = await page.evaluate(() => {
      const ins = document.querySelector('#wfp-editor-root .wfpe-inspector');
      return {
        present: !!ins,
        visible: ins.dataset.visible,
        display: getComputedStyle(ins).display,
      };
    });
    expect(state.present).toBe(true);
    expect(state.visible).toBe('false');
    expect(state.display).toBe('none');
  });

  test('inspector appears when an element is selected and hides when selection clears', async ({ page }) => {
    await loadFixtureWithEditor(page, 'Townhall-1.html');
    await page.evaluate(() => { document.querySelector('.deck').style.transform = 'scale(1)'; });
    await page.keyboard.press('e');
    await selectByMouse(page, '.slide.active .wfp-badge');

    const onSelect = await page.evaluate(() => ({
      visible: document.querySelector('.wfpe-inspector').dataset.visible,
      display: getComputedStyle(document.querySelector('.wfpe-inspector')).display,
    }));
    expect(onSelect.visible).toBe('true');
    expect(onSelect.display).toBe('flex');

    // Clicking the active slide background deselects.
    await page.evaluate(() => document.querySelector('.slide.active').click());
    const onDeselect = await page.evaluate(() => ({
      visible: document.querySelector('.wfpe-inspector').dataset.visible,
      display: getComputedStyle(document.querySelector('.wfpe-inspector')).display,
    }));
    expect(onDeselect.visible).toBe('false');
    expect(onDeselect.display).toBe('none');
  });

  test('inspector hides when edit mode is toggled off', async ({ page }) => {
    await loadFixtureWithEditor(page, 'Townhall-1.html');
    await page.evaluate(() => { document.querySelector('.deck').style.transform = 'scale(1)'; });
    await page.keyboard.press('e');
    await selectByMouse(page, '.slide.active .wfp-badge');
    expect(
      await page.evaluate(() => document.querySelector('.wfpe-inspector').dataset.visible)
    ).toBe('true');

    await page.keyboard.press('e');
    expect(
      await page.evaluate(() => document.querySelector('.wfpe-inspector').dataset.visible)
    ).toBe('false');
  });

  test('inspector header has a minimise control with chevron-up icon when expanded', async ({ page }) => {
    await loadFixtureWithEditor(page, 'Townhall-1.html');
    await page.evaluate(() => { document.querySelector('.deck').style.transform = 'scale(1)'; });
    await page.keyboard.press('e');
    await selectByMouse(page, '.slide.active .wfp-badge');

    const header = await page.evaluate(() => {
      const h = document.querySelector('.wfpe-inspector-header');
      const btn = h.querySelector('.wfpe-inspector-minimise');
      return {
        hasTitle: !!h.querySelector('.wfpe-inspector-title'),
        hasMinimise: !!btn,
        title: btn.title,
        hasIcon: !!btn.querySelector('svg.wfpe-icon'),
        iconPath: btn.querySelector('svg.wfpe-icon polyline')?.getAttribute('points'),
      };
    });
    expect(header.hasTitle).toBe(true);
    expect(header.hasMinimise).toBe(true);
    expect(header.title).toBe('Minimise');
    expect(header.hasIcon).toBe(true);
    // Chevron-up: top-down V shape pointing up
    expect(header.iconPath).toBe('18 15 12 9 6 15');
  });

  test('clicking minimise collapses the body, swaps icon to chevron-down, and updates the affordance label', async ({ page }) => {
    await loadFixtureWithEditor(page, 'Townhall-1.html');
    await page.evaluate(() => { document.querySelector('.deck').style.transform = 'scale(1)'; });
    await page.keyboard.press('e');
    await selectByMouse(page, '.slide.active .wfp-badge');

    await page.locator('#wfp-editor-root .wfpe-inspector-minimise').click();
    const minimised = await page.evaluate(() => ({
      state: document.querySelector('.wfpe-inspector').dataset.state,
      bodyDisplay: getComputedStyle(document.querySelector('.wfpe-inspector-body')).display,
      btnTitle: document.querySelector('.wfpe-inspector-minimise').title,
      iconPath: document.querySelector('.wfpe-inspector-minimise polyline').getAttribute('points'),
    }));
    expect(minimised.state).toBe('minimised');
    expect(minimised.bodyDisplay).toBe('none');
    expect(minimised.btnTitle).toBe('Expand');
    expect(minimised.iconPath).toBe('6 9 12 15 18 9');

    await page.locator('#wfp-editor-root .wfpe-inspector-minimise').click();
    const expanded = await page.evaluate(() => ({
      state: document.querySelector('.wfpe-inspector').dataset.state,
      bodyDisplay: getComputedStyle(document.querySelector('.wfpe-inspector-body')).display,
      btnTitle: document.querySelector('.wfpe-inspector-minimise').title,
    }));
    expect(expanded.state).toBe('expanded');
    expect(expanded.bodyDisplay).toBe('flex');
    expect(expanded.btnTitle).toBe('Minimise');
  });

  test('minimised preference persists across selection changes within the session', async ({ page }) => {
    await loadFixtureWithEditor(page, 'Townhall-1.html');
    await page.evaluate(() => { document.querySelector('.deck').style.transform = 'scale(1)'; });
    await page.keyboard.press('e');
    await selectByMouse(page, '.slide.active .wfp-badge');
    await page.locator('#wfp-editor-root .wfpe-inspector-minimise').click();
    expect(
      await page.evaluate(() => document.querySelector('.wfpe-inspector').dataset.state)
    ).toBe('minimised');

    // Switch selection to a different element.
    await page.evaluate(() => document.querySelector('.slide.active h1').click());

    const after = await page.evaluate(() => ({
      visible: document.querySelector('.wfpe-inspector').dataset.visible,
      state: document.querySelector('.wfpe-inspector').dataset.state,
    }));
    expect(after.visible).toBe('true');
    expect(after.state).toBe('minimised');
  });

  test('inspector clicks do not steal selection (inspector is treated as editor-internal)', async ({ page }) => {
    await loadFixtureWithEditor(page, 'Townhall-1.html');
    await page.evaluate(() => { document.querySelector('.deck').style.transform = 'scale(1)'; });
    await page.keyboard.press('e');
    await selectByMouse(page, '.slide.active .wfp-badge');

    const ringBefore = await page.evaluate(() => {
      const r = document.querySelector('.wfpe-selection-ring');
      return { display: r.style.display, top: r.style.top };
    });

    // Click somewhere on the inspector header (NOT a button) and confirm
    // the selection ring is unaffected.
    await page.locator('#wfp-editor-root .wfpe-inspector-title').click();
    const ringAfter = await page.evaluate(() => {
      const r = document.querySelector('.wfpe-selection-ring');
      return { display: r.style.display, top: r.style.top };
    });
    expect(ringAfter.display).toBe(ringBefore.display);
    expect(ringAfter.top).toBe(ringBefore.top);
  });

  test('inspector applies the same liquid-glass recipe as the toolbar', async ({ page }) => {
    await loadFixtureWithEditor(page, 'Townhall-1.html');
    await page.emulateMedia({ colorScheme: 'light' });
    await page.evaluate(() => { document.querySelector('.deck').style.transform = 'scale(1)'; });
    await page.keyboard.press('e');
    await selectByMouse(page, '.slide.active .wfp-badge');

    const recipe = await page.evaluate(() => {
      const cs = getComputedStyle(document.querySelector('.wfpe-inspector'));
      return {
        bg: cs.backgroundColor,
        border: cs.borderTopColor,
        backdrop: cs.backdropFilter || cs.webkitBackdropFilter,
        shadow: cs.boxShadow,
        color: cs.color,
      };
    });
    // Inspector now uses the same white-text liquid-glass recipe as the
    // toolbar — tint trimmed and brightness(0.78) doing the contrast lift.
    expect(recipe.bg).toBe('rgba(255, 255, 255, 0.12)');
    expect(recipe.border).toBe('rgba(255, 255, 255, 0.24)');
    expect(recipe.backdrop).toMatch(/blur\(20px\)/);
    expect(recipe.backdrop).toMatch(/saturate\((1\.8|180%)\)/);
    expect(recipe.backdrop).toMatch(/brightness\(0\.78\)/);
    expect(recipe.shadow).toContain('rgba(0, 0, 0, 0.25)');
    expect(recipe.shadow).toContain('8px 24px');
    expect(recipe.color).toBe('rgb(255, 255, 255)');
  });

  test('inspector switches to dark glass under prefers-color-scheme: dark', async ({ page }) => {
    await loadFixtureWithEditor(page, 'Townhall-1.html');
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.evaluate(() => { document.querySelector('.deck').style.transform = 'scale(1)'; });
    await page.keyboard.press('e');
    await selectByMouse(page, '.slide.active .wfp-badge');

    const recipe = await page.evaluate(() => {
      const cs = getComputedStyle(document.querySelector('.wfpe-inspector'));
      return { bg: cs.backgroundColor, color: cs.color };
    });
    // Same dark-glass recipe in both schemes (white text needs the
    // brightness drop regardless of host preference).
    expect(recipe.bg).toBe('rgba(255, 255, 255, 0.12)');
    expect(recipe.color).toBe('rgb(255, 255, 255)');
  });

  test('inspector hides when slide changes (selection clears with the slide)', async ({ page }) => {
    await loadFixtureWithEditor(page, 'Townhall-1.html');
    await page.evaluate(() => { document.querySelector('.deck').style.transform = 'scale(1)'; });
    await page.keyboard.press('e');
    await selectByMouse(page, '.slide.active .wfp-badge');
    expect(
      await page.evaluate(() => document.querySelector('.wfpe-inspector').dataset.visible)
    ).toBe('true');

    // Move the .active class to a different slide. The slide observer
    // should clear selection and hide the inspector.
    await page.evaluate(() => {
      const slides = document.querySelectorAll('.slide');
      slides[0].classList.remove('active');
      slides[1].classList.add('active');
    });
    // Allow the MutationObserver to fire.
    await page.waitForFunction(
      () => document.querySelector('.wfpe-inspector').dataset.visible === 'false'
    );
  });
});
