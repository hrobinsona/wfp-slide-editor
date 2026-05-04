import { test, expect } from '@playwright/test';
import { loadFixtureWithEditor } from './_helpers.js';

// v2.0 — toolbar refresh: liquid-glass recipe values, inline SVG icons,
// button order Edit · Export · Undo · Redo. Behavioural parity with v1
// is covered by the existing v1 suite; these tests pin the v2 visual
// contract that the brief calls out as authoritative.

test.describe('v2.0 — toolbar refresh', () => {
  test('toolbar buttons render in order Edit · Export · Undo · Redo, each with an inline SVG icon and a label', async ({ page }) => {
    await loadFixtureWithEditor(page, 'Townhall-1.html');

    const buttons = await page.evaluate(() => {
      const tb = document.querySelector('#wfp-editor-root .wfpe-toolbar');
      return [...tb.querySelectorAll('button')].map((b) => ({
        action: b.dataset.action,
        hasIcon: !!b.querySelector('svg.wfpe-icon'),
        text: b.textContent.replace(/\s+/g, ' ').trim(),
      }));
    });

    expect(buttons.map((b) => b.action)).toEqual(['edit', 'export', 'undo', 'redo']);
    for (const b of buttons) expect(b.hasIcon).toBe(true);
    expect(buttons[0].text).toBe('Edit');
    expect(buttons[1].text).toBe('Export');
    expect(buttons[2].text).toBe('Undo');
    expect(buttons[3].text).toBe('Redo');
  });

  test('toolbar liquid-glass recipe matches BRIEF-v2-inspector.md (light variant)', async ({ page }) => {
    await loadFixtureWithEditor(page, 'Townhall-1.html');
    // Pin the variant we're asserting against. Headless Chromium defaults to
    // light, but make it explicit so the test is deterministic regardless
    // of host OS preferences.
    await page.emulateMedia({ colorScheme: 'light' });

    const recipe = await page.evaluate(() => {
      const tb = document.querySelector('#wfp-editor-root .wfpe-toolbar');
      const cs = getComputedStyle(tb);
      return {
        background: cs.backgroundColor,
        borderColor: cs.borderTopColor,
        borderWidth: cs.borderTopWidth,
        backdropFilter: cs.backdropFilter || cs.webkitBackdropFilter,
        boxShadow: cs.boxShadow,
        color: cs.color,
      };
    });

    // Liquid-glass luminance rule: white-text surfaces drop brightness so
    // contrast survives over pale backgrounds. The white tint is kept for
    // aesthetic, but brightness(0.78) does the heavy lifting.
    expect(recipe.background).toBe('rgba(255, 255, 255, 0.12)');
    expect(recipe.borderColor).toBe('rgba(255, 255, 255, 0.24)');
    expect(recipe.borderWidth).toBe('1px');
    expect(recipe.backdropFilter).toMatch(/blur\(20px\)/);
    expect(recipe.backdropFilter).toMatch(/saturate\((1\.8|180%)\)/);
    expect(recipe.backdropFilter).toMatch(/brightness\(0\.78\)/);
    expect(recipe.boxShadow).toContain('rgba(0, 0, 0, 0.25)');
    expect(recipe.boxShadow).toContain('8px 24px');
    expect(recipe.color).toBe('rgb(255, 255, 255)');
  });

  test('toolbar liquid-glass recipe switches to dark variant under prefers-color-scheme: dark', async ({ page }) => {
    await loadFixtureWithEditor(page, 'Townhall-1.html');
    await page.emulateMedia({ colorScheme: 'dark' });

    const recipe = await page.evaluate(() => {
      const tb = document.querySelector('#wfp-editor-root .wfpe-toolbar');
      const cs = getComputedStyle(tb);
      return {
        background: cs.backgroundColor,
        color: cs.color,
      };
    });

    expect(recipe.background).toBe('rgba(255, 255, 255, 0.12)');
    expect(recipe.color).toBe('rgb(255, 255, 255)');
  });

  test('Edit pill renders the coral active state when edit mode is on', async ({ page }) => {
    await loadFixtureWithEditor(page, 'Townhall-1.html');
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
    // Peach radial-gradient is the visual signal for the active state.
    expect(pill.backgroundImage).toMatch(/radial-gradient/);
    expect(pill.backgroundImage).toMatch(/244,\s*132,\s*123/);
    expect(pill.color).toBe('rgb(255, 255, 255)');
  });

  test('all four toolbar buttons remain visible regardless of edit mode', async ({ page }) => {
    await loadFixtureWithEditor(page, 'Townhall-1.html');

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
    expect(visibilityOn.map((b) => b.action)).toEqual(['edit', 'export', 'undo', 'redo']);
  });

  test('icons are single-stroke (fill: none, stroke: currentColor) and 18px in the stacked layout', async ({ page }) => {
    await loadFixtureWithEditor(page, 'Townhall-1.html');

    const iconStats = await page.evaluate(() => {
      return [...document.querySelectorAll('#wfp-editor-root .wfpe-toolbar svg.wfpe-icon')].map((s) => {
        const cs = getComputedStyle(s);
        return {
          width: cs.width,
          height: cs.height,
          fill: cs.fill,
          stroke: cs.stroke,
        };
      });
    });

    expect(iconStats).toHaveLength(4);
    for (const s of iconStats) {
      expect(s.width).toBe('18px');
      expect(s.height).toBe('18px');
      expect(s.fill).toBe('none');
      // currentColor cascades to a real rgb() in computed style — what matters
      // is that the stroke isn't `none`.
      expect(s.stroke).not.toBe('none');
    }
  });
});
