import { test, expect } from '@playwright/test';
import { loadFixtureWithEditor, requireAbsoluteTarget, hitPointFor } from './_helpers.js';

// v2.1 — inspector scaffold + minimise. The body is intentionally empty
// in this phase; subsequent phases populate font / colour / position /
// size / reset controls. These tests pin the visibility, structure, and
// minimise behaviour the brief specifies. Restyled by v2.10 "Ink Glass"
// (design 3b): the panel lives inside a .wfpe-inspector-dock wrapper that
// folds open/shut on selection (grid-template-rows), and minimise folds
// .wfpe-inspector-fold instead of display-toggling the body.

test.use({ viewport: { width: 2000, height: 1200 } });

// Freeze editor-chrome motion so computed-style assertions read end
// states, not mid-transition frames (dock/fold/corner morphs are 340-380ms).
async function freezeMotion(page) {
  await page.addStyleTag({ content: '#wfp-editor-root * { transition: none !important; }' });
}

async function selectByMouse(page, selector) {
  const center = await hitPointFor(page, selector);
  await page.mouse.move(center.x, center.y);
  await page.mouse.down();
  await page.mouse.up();
}

test.describe('v2.1 — inspector scaffold + minimise', () => {
  test('inspector is hidden by default and on initial editor load', async ({ page }) => {
    await loadFixtureWithEditor(page, 'Townhall-1.html');
    await freezeMotion(page);
    const state = await page.evaluate(() => {
      const ins = document.querySelector('#wfp-editor-root .wfpe-inspector');
      const dock = document.querySelector('#wfp-editor-root .wfpe-inspector-dock');
      return {
        present: !!ins,
        visible: ins.dataset.visible,
        dockVisible: dock.dataset.visible,
        visibility: getComputedStyle(ins).visibility,
      };
    });
    expect(state.present).toBe(true);
    expect(state.visible).toBe('false');
    expect(state.dockVisible).toBe('false');
    expect(state.visibility).toBe('hidden');
  });

  test('inspector appears when an element is selected and hides when selection clears', async ({ page }) => {
    await loadFixtureWithEditor(page, 'Townhall-1.html');
    const target = await requireAbsoluteTarget(page);
    await page.evaluate(() => { document.querySelector('.deck').style.transform = 'scale(1)'; });
    await page.keyboard.press('e');
    await selectByMouse(page, target);

    await freezeMotion(page);
    const onSelect = await page.evaluate(() => ({
      visible: document.querySelector('.wfpe-inspector').dataset.visible,
      dockVisible: document.querySelector('.wfpe-inspector-dock').dataset.visible,
      visibility: getComputedStyle(document.querySelector('.wfpe-inspector')).visibility,
      docked: document.querySelector('.wfpe-toolbar').dataset.docked,
    }));
    expect(onSelect.visible).toBe('true');
    expect(onSelect.dockVisible).toBe('true');
    expect(onSelect.visibility).toBe('visible');
    expect(onSelect.docked).toBe('true');

    // Clicking the active slide background deselects.
    await page.evaluate(() => document.querySelector('.slide.active').click());
    const onDeselect = await page.evaluate(() => ({
      visible: document.querySelector('.wfpe-inspector').dataset.visible,
      dockVisible: document.querySelector('.wfpe-inspector-dock').dataset.visible,
      visibility: getComputedStyle(document.querySelector('.wfpe-inspector')).visibility,
      docked: document.querySelector('.wfpe-toolbar').dataset.docked,
    }));
    expect(onDeselect.visible).toBe('false');
    expect(onDeselect.dockVisible).toBe('false');
    expect(onDeselect.visibility).toBe('hidden');
    expect(onDeselect.docked).toBe('false');
  });

  test('inspector hides when edit mode is toggled off', async ({ page }) => {
    await loadFixtureWithEditor(page, 'Townhall-1.html');
    const target = await requireAbsoluteTarget(page);
    await page.evaluate(() => { document.querySelector('.deck').style.transform = 'scale(1)'; });
    await page.keyboard.press('e');
    await selectByMouse(page, target);
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
    const target = await requireAbsoluteTarget(page);
    await page.evaluate(() => { document.querySelector('.deck').style.transform = 'scale(1)'; });
    await page.keyboard.press('e');
    await selectByMouse(page, target);

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

  test('clicking minimise folds the body, rotates the chevron via CSS, and updates the affordance label', async ({ page }) => {
    await loadFixtureWithEditor(page, 'Townhall-1.html');
    const target = await requireAbsoluteTarget(page);
    await page.evaluate(() => { document.querySelector('.deck').style.transform = 'scale(1)'; });
    await page.keyboard.press('e');
    await selectByMouse(page, target);
    await freezeMotion(page);

    await page.locator('#wfp-editor-root .wfpe-inspector-minimise').click();
    const minimised = await page.evaluate(() => ({
      state: document.querySelector('.wfpe-inspector').dataset.state,
      foldRows: getComputedStyle(document.querySelector('.wfpe-inspector-fold')).gridTemplateRows,
      btnTitle: document.querySelector('.wfpe-inspector-minimise').title,
      // Single chevron-up polyline, rotated 180° by CSS in this state.
      iconPath: document.querySelector('.wfpe-inspector-minimise polyline').getAttribute('points'),
      iconTransform: getComputedStyle(document.querySelector('.wfpe-inspector-minimise svg')).transform,
    }));
    expect(minimised.state).toBe('minimised');
    expect(minimised.foldRows).toBe('0px');
    expect(minimised.btnTitle).toBe('Expand');
    expect(minimised.iconPath).toBe('18 15 12 9 6 15');
    expect(minimised.iconTransform).toBe('matrix(-1, 0, 0, -1, 0, 0)');

    await page.locator('#wfp-editor-root .wfpe-inspector-minimise').click();
    const expanded = await page.evaluate(() => ({
      state: document.querySelector('.wfpe-inspector').dataset.state,
      foldRows: getComputedStyle(document.querySelector('.wfpe-inspector-fold')).gridTemplateRows,
      bodyDisplay: getComputedStyle(document.querySelector('.wfpe-inspector-body')).display,
      btnTitle: document.querySelector('.wfpe-inspector-minimise').title,
    }));
    expect(expanded.state).toBe('expanded');
    expect(expanded.foldRows).not.toBe('0px');
    expect(expanded.bodyDisplay).toBe('flex');
    expect(expanded.btnTitle).toBe('Minimise');
  });

  test('minimised preference persists across selection changes within the session', async ({ page }) => {
    await loadFixtureWithEditor(page, 'Townhall-1.html');
    const target = await requireAbsoluteTarget(page);
    await page.evaluate(() => { document.querySelector('.deck').style.transform = 'scale(1)'; });
    await page.keyboard.press('e');
    await selectByMouse(page, target);
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
    const target = await requireAbsoluteTarget(page);
    await page.evaluate(() => { document.querySelector('.deck').style.transform = 'scale(1)'; });
    await page.keyboard.press('e');
    await selectByMouse(page, target);

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

  test('inspector applies the same ink-glass recipe as the toolbar, minus the outer drop shadow', async ({ page }) => {
    await loadFixtureWithEditor(page, 'Townhall-1.html');
    const target = await requireAbsoluteTarget(page);
    await page.emulateMedia({ colorScheme: 'light' });
    await page.evaluate(() => { document.querySelector('.deck').style.transform = 'scale(1)'; });
    await page.keyboard.press('e');
    await selectByMouse(page, target);

    const recipe = await page.evaluate(() => {
      const cs = getComputedStyle(document.querySelector('.wfpe-inspector'));
      return {
        bg: cs.backgroundColor,
        border: cs.borderTopColor,
        backdrop: cs.backdropFilter || cs.webkitBackdropFilter,
        shadow: cs.boxShadow,
        color: cs.color,
        radius: cs.borderRadius,
      };
    });
    // Ink glass: dark tint under a white sheen gradient, same surface as
    // the bar. Depth comes from the bar's shadow — the panel carries only
    // the inset top sheen (an outer drop would be clipped by the dock
    // fold wrapper and smudge the corners).
    expect(recipe.bg).toBe('rgba(22, 25, 31, 0.32)');
    expect(recipe.border).toBe('rgba(255, 255, 255, 0.22)');
    expect(recipe.backdrop).toMatch(/blur\(24px\)/);
    expect(recipe.backdrop).toMatch(/saturate\((1\.7|170%)\)/);
    expect(recipe.shadow).toContain('inset');
    expect(recipe.shadow).not.toContain('8px 22px');
    expect(recipe.color).toBe('rgb(255, 255, 255)');
    expect(recipe.radius).toBe('6px 6px 12px 12px');
  });

  test('ink glass is scheme-invariant: identical surface under prefers-color-scheme: dark', async ({ page }) => {
    await loadFixtureWithEditor(page, 'Townhall-1.html');
    const target = await requireAbsoluteTarget(page);
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.evaluate(() => { document.querySelector('.deck').style.transform = 'scale(1)'; });
    await page.keyboard.press('e');
    await selectByMouse(page, target);

    const recipe = await page.evaluate(() => {
      const cs = getComputedStyle(document.querySelector('.wfpe-inspector'));
      return { bg: cs.backgroundColor, color: cs.color };
    });
    // Same ink-glass recipe in both schemes — the dark tint keeps white
    // text readable regardless of host preference.
    expect(recipe.bg).toBe('rgba(22, 25, 31, 0.32)');
    expect(recipe.color).toBe('rgb(255, 255, 255)');
  });

  test('inspector hides when slide changes (selection clears with the slide)', async ({ page }) => {
    await loadFixtureWithEditor(page, 'Townhall-1.html');
    const target = await requireAbsoluteTarget(page);
    await page.evaluate(() => { document.querySelector('.deck').style.transform = 'scale(1)'; });
    await page.keyboard.press('e');
    await selectByMouse(page, target);
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
