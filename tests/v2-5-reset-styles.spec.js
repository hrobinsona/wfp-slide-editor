import { test, expect } from '@playwright/test';
import { loadFixtureWithEditor } from './_helpers.js';

// v2.5 — reset styles. Clears the entire inline style attribute on the
// selected element ("reset overrides" semantics from BRIEF "Decisions
// baked in" #2). One history entry. Element returns to its stylesheet-
// defined rendering.

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

test.describe('v2.5 — reset styles', () => {
  test.beforeEach(async ({ page }) => {
    await loadFixtureWithEditor(page, 'Townhall-1.html');
    await page.evaluate(() => { document.querySelector('.deck').style.transform = 'scale(1)'; });
    await page.keyboard.press('e');
  });

  test('reset button renders inside the inspector for any selection', async ({ page }) => {
    await selectByMouse(page, '.slide.active h1');
    const present = await page.evaluate(
      () => !!document.querySelector('#wfp-editor-root .wfpe-inspector .wfpe-reset-btn')
    );
    expect(present).toBe(true);

    // And for non-text-bearing elements too.
    const found = await page.evaluate(() => {
      const slide = document.querySelector('.slide.active');
      const isTextBearing = (el) => [...el.childNodes].some(
        (n) => n.nodeType === 3 && n.textContent.trim().length > 0
      );
      let nonText = null;
      for (const el of slide.querySelectorAll('*')) {
        if (!isTextBearing(el) && el.children.length > 0) { nonText = el; break; }
      }
      if (!nonText) return { found: false };
      nonText.click();
      return {
        found: true,
        present: !!document.querySelector('#wfp-editor-root .wfpe-inspector .wfpe-reset-btn'),
      };
    });
    expect(found.found).toBe(true);
    expect(found.present).toBe(true);
  });

  test('reset clears the entire inline style attribute as one history entry', async ({ page }) => {
    await selectByMouse(page, '.slide.active h1');

    // Apply several inline edits via the inspector (font-size + colour
    // + width) so the style attribute carries multiple properties.
    await page.evaluate(() => {
      const el = document.querySelector('.slide.active h1');
      // The fixture H1 already has an inline animation-delay; adding
      // editor-driven properties on top exercises the "reset clears
      // EVERYTHING" semantics — including the original animation-delay.
      el.style.fontSize = '120px';
      el.style.color = 'rgb(10, 20, 30)';
      el.style.width = '900px';
    });
    const beforeStyle = await page.evaluate(
      () => document.querySelector('.slide.active h1').getAttribute('style')
    );
    expect(beforeStyle).toBeTruthy();

    // Click reset — one click → entire inline style cleared.
    await page.locator('#wfp-editor-root .wfpe-reset-btn').click();
    const afterStyle = await page.evaluate(
      () => document.querySelector('.slide.active h1').getAttribute('style')
    );
    expect(afterStyle === null || afterStyle === '').toBe(true);

    // One Cmd+Z restores the entire previous inline style — confirms
    // the reset created exactly one history entry.
    await page.keyboard.press('Control+z');
    const undone = await page.evaluate(
      () => document.querySelector('.slide.active h1').getAttribute('style')
    );
    expect(undone).toBe(beforeStyle);
  });

  test('reset on an element with no inline style is a no-op (no history entry, no DOM mutation)', async ({ page }) => {
    await selectByMouse(page, '.slide.active h1');

    // Seed a known inline-style baseline outside the editor's txn
    // pipeline so the inspector commit captures it as BEFORE.
    await page.evaluate(() => {
      const el = document.querySelector('.slide.active h1');
      el.removeAttribute('style');
      el.style.fontSize = '99px';
    });
    // Make one real history entry via the inspector. Its BEFORE
    // snapshot is "font-size: 99px"; its AFTER is "font-size: 77px".
    const input = page.locator('#wfp-editor-root .wfpe-inspector input[data-wfpe-prop="fontSize"]');
    await input.click({ clickCount: 3 });
    await input.fill('77');
    await input.press('Enter');

    // Clear the inline style outside the editor so the reset button
    // has nothing to do.
    await page.evaluate(() => document.querySelector('.slide.active h1').removeAttribute('style'));

    // Use a MutationObserver to confirm the reset click does not write
    // to the style attribute when there's nothing to clear.
    await page.evaluate(() => {
      window.__resetMutations = 0;
      const obs = new MutationObserver((muts) => {
        for (const m of muts) {
          if (m.attributeName === 'style') window.__resetMutations++;
        }
      });
      obs.observe(document.querySelector('.slide.active h1'), { attributes: true });
      window.__resetObserver = obs;
    });
    await page.locator('#wfp-editor-root .wfpe-reset-btn').click();
    const muts = await page.evaluate(() => {
      window.__resetObserver.disconnect();
      return window.__resetMutations;
    });
    expect(muts).toBe(0);

    // One Cmd+Z should reverse the inspector commit (the only entry
    // that exists), restoring its BEFORE snapshot — i.e. font-size: 99px.
    // If reset had erroneously pushed an entry, undo would land us on
    // a no-style state instead.
    await page.keyboard.press('Control+z');
    const restored = await page.evaluate(
      () => document.querySelector('.slide.active h1').style.fontSize
    );
    expect(restored).toBe('99px');
  });

  test('reset re-populates inspector readouts from the stylesheet defaults', async ({ page }) => {
    await selectByMouse(page, '.slide.active h1');
    const original = await page.evaluate(() => {
      const el = document.querySelector('.slide.active h1');
      return parseFloat(getComputedStyle(el).fontSize);
    });
    // Bump font-size to a non-default value via the inspector.
    const input = page.locator('#wfp-editor-root .wfpe-inspector input[data-wfpe-prop="fontSize"]');
    await input.click({ clickCount: 3 });
    await input.fill(String(Math.round(original) + 30));
    await input.press('Enter');

    await page.locator('#wfp-editor-root .wfpe-reset-btn').click();
    const inspectorVal = await page.evaluate(
      () => Number(document.querySelector('#wfp-editor-root input[data-wfpe-prop="fontSize"]').value)
    );
    const liveVal = await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('.slide.active h1')).fontSize));
    expect(inspectorVal).toBe(Math.round(liveVal));
    // Confirm the live value snapped back to the original (or close to it).
    expect(Math.round(liveVal)).toBe(Math.round(original));
  });

  test('reset preserves the editor selection (ring stays on the element)', async ({ page }) => {
    await selectByMouse(page, '.slide.active h1');
    await page.evaluate(() => { document.querySelector('.slide.active h1').style.color = '#ff0000'; });

    await page.locator('#wfp-editor-root .wfpe-reset-btn').click();
    const ringDisplay = await page.evaluate(
      () => document.querySelector('#wfp-editor-root .wfpe-selection-ring').style.display
    );
    expect(ringDisplay).toBe('block');
  });
});
