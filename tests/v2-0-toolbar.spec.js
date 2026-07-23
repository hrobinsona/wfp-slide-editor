import { test, expect } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { EDITOR_PATH } from './_helpers.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const FIXTURE_PATH = path.join(PROJECT_ROOT, 'fixtures', 'foreign-deck.html');

// v2.0 toolbar contract, restyled by v2.10 "Ink Glass" (design 3b):
// icon-only 36px bar, dark-tinted glass identical in both colour schemes,
// button order Edit · Overview · Export · Handoff · Undo · Redo · collapse
// chevron. Behavioural parity with v1 is covered by the existing v1 suite;
// these tests pin the visual contract from the designer handoff
// (feature-briefs/v2-ink-glass-ui.md).

async function loadToolbarFixture(page) {
  await page.goto(pathToFileURL(FIXTURE_PATH).href);
  await page.locator('.slide.active').first().waitFor({ state: 'attached', timeout: 10_000 });
  await page.addScriptTag({ path: EDITOR_PATH });
  await page.waitForFunction(() => window.__wfpEditorReady === true, null, { timeout: 10_000 });
}

test.describe('v2.0/v2.10 — ink-glass toolbar', () => {
  test('toolbar buttons render in order Edit · Overview · Export · Handoff · Undo · Redo · collapse, icon-only with aria-labels', async ({ page }) => {
    await loadToolbarFixture(page);

    const buttons = await page.evaluate(() => {
      const tb = document.querySelector('#wfp-editor-root .wfpe-toolbar');
      return [...tb.querySelectorAll('button')].map((b) => ({
        action: b.dataset.action,
        hasIcon: !!b.querySelector('svg.wfpe-icon'),
        text: b.textContent.replace(/\s+/g, ' ').trim(),
        ariaLabel: b.getAttribute('aria-label'),
        title: b.title,
      }));
    });

    expect(buttons.map((b) => b.action)).toEqual([
      'edit', 'overview', 'export', 'handoff', 'undo', 'redo', 'toolbar-collapse',
    ]);
    for (const b of buttons) {
      expect(b.hasIcon).toBe(true);
      // Ink-glass is icon-only: tooltips + aria carry the names.
      expect(b.text).toBe('');
      expect(b.ariaLabel).toBeTruthy();
      expect(b.title).toBeTruthy();
    }
  });

  test('toolbar ink-glass recipe matches the designer handoff', async ({ page }) => {
    await loadToolbarFixture(page);
    await page.emulateMedia({ colorScheme: 'light' });

    const recipe = await page.evaluate(() => {
      const tb = document.querySelector('#wfp-editor-root .wfpe-toolbar');
      const cs = getComputedStyle(tb);
      return {
        background: cs.backgroundColor,
        backgroundImage: cs.backgroundImage,
        borderColor: cs.borderTopColor,
        borderWidth: cs.borderTopWidth,
        backdropFilter: cs.backdropFilter || cs.webkitBackdropFilter,
        boxShadow: cs.boxShadow,
        color: cs.color,
        radius: cs.borderRadius,
        width: tb.getBoundingClientRect().width,
      };
    });

    // Dark-tinted "ink" glass: white type stays readable over any page.
    expect(recipe.background).toBe('rgba(22, 25, 31, 0.32)');
    expect(recipe.backgroundImage).toMatch(/linear-gradient/);
    expect(recipe.borderColor).toBe('rgba(255, 255, 255, 0.22)');
    expect(recipe.borderWidth).toBe('1px');
    expect(recipe.backdropFilter).toMatch(/blur\(24px\)/);
    expect(recipe.backdropFilter).toMatch(/saturate\((1\.7|170%)\)/);
    expect(recipe.boxShadow).toContain('8px 22px');
    expect(recipe.boxShadow).toContain('inset');
    expect(recipe.color).toBe('rgb(255, 255, 255)');
    expect(recipe.radius).toBe('12px');
    expect(recipe.width).toBe(246);
  });

  test('ink glass is scheme-invariant: identical surface under prefers-color-scheme dark', async ({ page }) => {
    await loadToolbarFixture(page);
    await page.emulateMedia({ colorScheme: 'dark' });

    const recipe = await page.evaluate(() => {
      const tb = document.querySelector('#wfp-editor-root .wfpe-toolbar');
      const cs = getComputedStyle(tb);
      return { background: cs.backgroundColor, color: cs.color };
    });

    expect(recipe.background).toBe('rgba(22, 25, 31, 0.32)');
    expect(recipe.color).toBe('rgb(255, 255, 255)');
  });

  test('Edit pill renders the coral active state when edit mode is on', async ({ page }) => {
    await loadToolbarFixture(page);
    await page.keyboard.press('e');

    const pill = await page.evaluate(() => {
      const b = document.querySelector('#wfp-editor-root .wfpe-mode-badge');
      const cs = getComputedStyle(b);
      return {
        mode: b.dataset.mode,
        backgroundImage: cs.backgroundImage,
        color: cs.color,
      };
    });

    expect(pill.mode).toBe('on');
    // Coral linear-gradient (#ff9e8c → #f0685b → #e55a4e) signals active.
    expect(pill.backgroundImage).toMatch(/linear-gradient/);
    expect(pill.backgroundImage).toMatch(/240,\s*104,\s*91/);
    expect(pill.color).toBe('rgb(255, 255, 255)');
  });

  test('all toolbar buttons remain visible regardless of edit mode', async ({ page }) => {
    await loadToolbarFixture(page);

    const visibilityOff = await page.evaluate(() => {
      return [...document.querySelectorAll('#wfp-editor-root .wfpe-toolbar button')]
        .map((b) => ({ action: b.dataset.action, display: getComputedStyle(b).display }));
    });

    expect(visibilityOff.every((b) => b.display !== 'none')).toBe(true);

    await page.keyboard.press('e');

    const visibilityOn = await page.evaluate(() => {
      return [...document.querySelectorAll('#wfp-editor-root .wfpe-toolbar button')]
        .map((b) => ({ action: b.dataset.action, display: getComputedStyle(b).display }));
    });

    expect(visibilityOn.every((b) => b.display !== 'none')).toBe(true);
    expect(visibilityOn.map((b) => b.action)).toEqual([
      'edit', 'overview', 'export', 'handoff', 'undo', 'redo', 'toolbar-collapse',
    ]);
  });

  test('icons are single-stroke (fill: none, stroke: currentColor) at 15px in the bar', async ({ page }) => {
    await loadToolbarFixture(page);

    const iconStats = await page.evaluate(() => {
      return [...document.querySelectorAll(
        '#wfp-editor-root .wfpe-toolbar-btn svg.wfpe-icon, #wfp-editor-root .wfpe-mode-badge svg.wfpe-icon',
      )].map((s) => {
        const cs = getComputedStyle(s);
        return { width: cs.width, height: cs.height, fill: cs.fill, stroke: cs.stroke };
      });
    });

    expect(iconStats).toHaveLength(6);
    for (const s of iconStats) {
      expect(s.width).toBe('15px');
      expect(s.height).toBe('15px');
      expect(s.fill).toBe('none');
      // currentColor cascades to a real rgb() in computed style — what matters
      // is that the stroke isn't `none`.
      expect(s.stroke).not.toBe('none');
    }
  });

  test('collapse chevron is 13px and rotates via CSS transform when collapsed', async ({ page }) => {
    await loadToolbarFixture(page);

    const rest = await page.evaluate(() => {
      const icon = document.querySelector('#wfp-editor-root .wfpe-toolbar-collapse svg.wfpe-icon');
      const cs = getComputedStyle(icon);
      return { width: cs.width, transform: cs.transform };
    });
    expect(rest.width).toBe('13px');
    expect(rest.transform).toBe('none');

    await page.click('#wfp-editor-root .wfpe-toolbar-collapse');
    // rotate(180deg) === matrix(-1, 0, 0, -1, 0, 0)
    await expect
      .poll(async () => page.evaluate(() => {
        const icon = document.querySelector('#wfp-editor-root .wfpe-toolbar-collapse svg.wfpe-icon');
        return getComputedStyle(icon).transform;
      }))
      .toBe('matrix(-1, 0, 0, -1, 0, 0)');
  });
});
