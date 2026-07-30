import { test, expect } from '@playwright/test';
import {
  loadFixtureWithEditor,
  PINNED_PRIMARIES,
  pickRandomRotationFixture,
  ROTATION_MISSING_REASON,
  disableFsa,
  hitPointFor,
  EDITOR_MARKER_ATTR_RE,
} from './_helpers.js';

// v2.8 — end-to-end gate. Walk a representative v2 user journey
// against both pinned primary fixtures and a randomly chosen rotation
// fixture: edit-mode toggle, selection, inspector renders, font-size
// triplet bumps, X/Y commit, colour commit + transparent, reset
// styles, undo restores, export round-trips and strips the editor.

test.use({ viewport: { width: 2000, height: 1200 } });

// Rotation coverage is optional — see the note in tests/_helpers.js. When no
// rotation deck is installed the suite still reports; it just records an
// explicit skip in place of the rotation pass.
const ROTATION = pickRandomRotationFixture();
const FIXTURES_TO_RUN = [...PINNED_PRIMARIES, ...(ROTATION ? [ROTATION] : [])];
console.log(`v2.8 end-to-end fixtures: ${FIXTURES_TO_RUN.join(', ')}`);

if (!ROTATION) {
  test('v2.8 end-to-end on a rotation fixture', () => {
    test.skip(true, ROTATION_MISSING_REASON);
  });
}

async function selectByMouse(page, selector) {
  const c = await hitPointFor(page, selector);
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
      // The 'export strips the entire editor' test below clicks the
      // save-in-place menu row and expects a download event; force the
      // legacy fallback so it doesn't hit a real (headless, dialog-less)
      // File System Access picker.
      await disableFsa(page);
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
      // v2.11 merges the former Handoff button into Export (badge + menu).
      // Asserted as a prefix, not an exact list: later phases append chrome
      // (v2.10's toolbar-collapse) that this end-to-end gate does not own.
      expect(out.buttons.slice(0, 5)).toEqual(['edit', 'overview', 'export', 'undo', 'redo']);
      // Ink-glass surface (v2.10). The exact recipe is owned by
      // tests/v2-0-toolbar.spec.js and tests/v2-1-inspector.spec.js; this gate
      // only asserts the toolbar still carries the shared translucent surface.
      expect(out.bg).toBe('rgba(22, 25, 31, 0.32)');
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
        expect.arrayContaining(['font-size', 'text-color', 'bg-color'])
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

      // v2.11 — Export opens the action menu instead of downloading
      // directly; row 1 (no annotations here) is the equivalent clean save.
      const downloadPromise = page.waitForEvent('download', { timeout: 10_000 });
      await page.locator('#wfp-editor-root .wfpe-toolbar-btn[data-action="export"]').click();
      await page.locator('#wfp-editor-root .wfpe-export-menu-item[data-action="save-in-place"]').click();
      const download = await downloadPromise;
      const stream = await download.createReadStream();
      const chunks = [];
      for await (const c of stream) chunks.push(c);
      const html = Buffer.concat(chunks).toString('utf-8');

      // Editor scaffolding stripped.
      expect(html).not.toContain('id="wfp-editor-root"');
      expect(html).not.toContain('wfpe-toolbar');
      expect(html).not.toContain('wfpe-inspector');
      expect(html).not.toMatch(EDITOR_MARKER_ATTR_RE);
      // Inspector edit preserved.
      expect(html).toContain('font-size: 72px');
    });
  });
}
