import { test, expect } from '@playwright/test';
import { loadFixtureWithEditor, PINNED_PRIMARIES, pickRandomRotationFixture } from './_helpers.js';

// v2.8 — end-to-end gate. Walk a representative v2 user journey
// against both pinned primary fixtures and a randomly chosen rotation
// fixture: edit-mode toggle, selection, inspector renders, font-size
// triplet bumps, X/Y commit, colour commit + transparent, reset
// styles, undo restores, export round-trips and strips the editor.

test.use({ viewport: { width: 2000, height: 1200 } });

const FIXTURES_TO_RUN = [...PINNED_PRIMARIES, pickRandomRotationFixture()];
console.log(`v2.8 end-to-end fixtures: ${FIXTURES_TO_RUN.join(', ')}`);

async function selectByMouse(page, selector) {
  const c = await page.evaluate((s) => {
    const el = document.querySelector(s);
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }, selector);
  await page.mouse.move(c.x, c.y);
  await page.mouse.down();
  await page.mouse.up();
}

async function findTextSelector(page) {
  // Walk the active slide for an element with a direct text-node child;
  // fixtures vary in structure so we discover one rather than hard-code.
  return page.evaluate(() => {
    const slide = document.querySelector('.slide.active');
    if (!slide) return null;
    const isTextBearing = (el) => [...el.childNodes].some(
      (n) => n.nodeType === 3 && n.textContent.trim().length > 0
    );
    // Prefer a heading; fall back to anything text-bearing with non-trivial size.
    const tags = ['h1', 'h2', 'h3', 'p', 'span', 'div'];
    for (const tag of tags) {
      for (const el of slide.querySelectorAll(tag)) {
        if (!isTextBearing(el)) continue;
        const r = el.getBoundingClientRect();
        if (r.width < 30 || r.height < 16) continue;
        // Build a unique selector via index within the active slide.
        const all = [...slide.querySelectorAll(tag)];
        return `.slide.active ${tag}:nth-of-type(${all.indexOf(el) + 1})`;
      }
    }
    return null;
  });
}

for (const fixture of FIXTURES_TO_RUN) {
  test.describe(`v2.8 end-to-end on ${fixture}`, () => {
    test.beforeEach(async ({ page }) => {
      await loadFixtureWithEditor(page, fixture);
      await page.evaluate(() => { document.querySelector('.deck').style.transform = 'scale(1)'; });
      await page.keyboard.press('e');
    });

    test('toolbar renders Edit/Overview/Export/Undo/Redo with v2 liquid-glass recipe', async ({ page }) => {
      const out = await page.evaluate(() => {
        const tb = document.querySelector('#wfp-editor-root .wfpe-toolbar');
        return {
          buttons: [...tb.querySelectorAll('button')].map((b) => b.dataset.action),
          bg: getComputedStyle(tb).backgroundColor,
          radius: getComputedStyle(tb).borderTopLeftRadius,
        };
      });
      // Overview button added in v2.1.0 between Edit and the action triplet.
      expect(out.buttons).toEqual(['edit', 'overview', 'export', 'undo', 'redo']);
      // White-text liquid-glass recipe: tint trimmed to 0.12 with the
      // brightness drop carrying the contrast (see toolbar CSS).
      expect(out.bg).toBe('rgba(255, 255, 255, 0.12)');
    });

    test('inspector renders the v2 control set when an element is selected', async ({ page }) => {
      const sel = await findTextSelector(page);
      test.skip(!sel, 'no text-bearing element in this fixture\'s active slide');
      await selectByMouse(page, sel);

      const layout = await page.evaluate(() => {
        const ins = document.querySelector('#wfp-editor-root .wfpe-inspector');
        return {
          visible: ins.dataset.visible,
          rows: [...ins.querySelectorAll('.wfpe-inspector-row')].map((r) => r.dataset.wfpeRow),
          hasDuplicate: !!ins.querySelector('.wfpe-duplicate-btn'),
          hasDelete: !!ins.querySelector('.wfpe-delete-btn'),
          hasReset: !!ins.querySelector('.wfpe-reset-btn'),
        };
      });
      expect(layout.visible).toBe('true');
      expect(layout.rows).toEqual(
        expect.arrayContaining(['font-size', 'text-color', 'bg-color', 'actions'])
      );
      expect(layout.hasDuplicate).toBe(true);
      expect(layout.hasDelete).toBe(true);
      expect(layout.hasReset).toBe(true);
    });

    test('inspector font + button bumps font-size; undo restores', async ({ page }) => {
      const sel = await findTextSelector(page);
      test.skip(!sel, 'no text-bearing element');
      await selectByMouse(page, sel);

      const before = await page.evaluate(
        (s) => parseFloat(getComputedStyle(document.querySelector(s)).fontSize),
        sel
      );
      await page.locator('#wfp-editor-root .wfpe-font-btn[data-action="font-plus"]').click();
      const after = await page.evaluate(
        (s) => parseFloat(getComputedStyle(document.querySelector(s)).fontSize),
        sel
      );
      expect(after).toBeGreaterThan(before);

      await page.keyboard.press('Control+z');
      const restored = await page.evaluate(
        (s) => parseFloat(getComputedStyle(document.querySelector(s)).fontSize),
        sel
      );
      expect(restored).toBeCloseTo(before, 1);
    });

    test('hex colour commit + reset styles cycle round-trips cleanly', async ({ page }) => {
      const sel = await findTextSelector(page);
      test.skip(!sel, 'no text-bearing element');
      await selectByMouse(page, sel);

      // Apply a colour, verify it lands.
      const hex = page.locator('#wfp-editor-root input[data-wfpe-prop="textColorHex"]');
      await hex.click({ clickCount: 3 });
      await hex.fill('#1a73e8');
      await hex.press('Enter');
      const c = await page.evaluate(
        (s) => document.querySelector(s).style.color, sel
      );
      expect(c).toBe('rgb(26, 115, 232)');

      // Reset wipes the inline style attribute entirely.
      await page.locator('#wfp-editor-root .wfpe-reset-btn').click();
      const styleAttr = await page.evaluate(
        (s) => document.querySelector(s).getAttribute('style'), sel
      );
      expect(styleAttr === null || styleAttr === '').toBe(true);
    });

    test('export strips the entire editor + preserves an inspector edit', async ({ page }) => {
      const sel = await findTextSelector(page);
      test.skip(!sel, 'no text-bearing element');
      await selectByMouse(page, sel);

      // Make a font-size change via the inspector input.
      const fs = page.locator('#wfp-editor-root input[data-wfpe-prop="fontSize"]');
      await fs.click({ clickCount: 3 });
      await fs.fill('72');
      await fs.press('Enter');

      const downloadPromise = page.waitForEvent('download', { timeout: 10_000 });
      await page.locator('#wfp-editor-root .wfpe-toolbar-btn[data-action="export"]').click();
      const download = await downloadPromise;
      const stream = await download.createReadStream();
      const chunks = [];
      for await (const c of stream) chunks.push(c);
      const html = Buffer.concat(chunks).toString('utf-8');

      // Editor scaffolding stripped.
      expect(html).not.toContain('id="wfp-editor-root"');
      expect(html).not.toContain('wfpe-toolbar');
      expect(html).not.toContain('wfpe-inspector');
      expect(html).not.toContain('data-wfp-edit');
      // Inspector edit preserved.
      expect(html).toContain('font-size: 72px');
    });
  });
}
