import { test, expect } from '@playwright/test';
import { loadFixtureWithEditor } from './_helpers.js';

test.describe('Phase 1 — Editor bootstrap', () => {
  test('mounts the editor root and shows an "Edit" badge in the off state', async ({ page }) => {
    await loadFixtureWithEditor(page, 'Townhall-1.html');

    const root = page.locator('#wfp-editor-root');
    await expect(root).toHaveCount(1);

    const badge = page.locator('#wfp-editor-root .wfpe-mode-badge');
    await expect(badge).toBeVisible();
    await expect(badge).toHaveText(/^\s*Edit\s*$/);
    await expect(badge).toHaveAttribute('data-mode', 'off');
  });

  test('logs a ready message on load', async ({ page }) => {
    const messages = [];
    page.on('console', (msg) => messages.push(msg.text()));
    await loadFixtureWithEditor(page, 'Townhall-1.html');
    expect(messages.some((m) => /\[wfp-editor\] ready/.test(m))).toBe(true);
  });

  test('pressing E toggles the badge between ON and OFF', async ({ page }) => {
    await loadFixtureWithEditor(page, 'Townhall-1.html');
    const badge = page.locator('#wfp-editor-root .wfpe-mode-badge');

    await expect(badge).toHaveAttribute('data-mode', 'off');

    await page.keyboard.press('e');
    await expect(badge).toHaveAttribute('data-mode', 'on');

    await page.keyboard.press('e');
    await expect(badge).toHaveAttribute('data-mode', 'off');
  });

  test('does not toggle edit mode when typing in an input', async ({ page }) => {
    await loadFixtureWithEditor(page, 'Townhall-1.html');
    const badge = page.locator('#wfp-editor-root .wfpe-mode-badge');

    await page.evaluate(() => {
      const input = document.createElement('input');
      input.id = 'spec-input';
      document.body.appendChild(input);
      input.focus();
    });

    await page.keyboard.type('e');
    await expect(badge).toHaveAttribute('data-mode', 'off');
  });

  test('does not break slide navigation when edit mode is off', async ({ page }) => {
    await loadFixtureWithEditor(page, 'Townhall-1.html');

    const initialActive = await page.evaluate(() => {
      const slides = [...document.querySelectorAll('.slide')];
      return slides.findIndex((s) => s.classList.contains('active'));
    });

    await page.locator('body').click({ position: { x: 5, y: 5 } });
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(150);

    const nextActive = await page.evaluate(() => {
      const slides = [...document.querySelectorAll('.slide')];
      return slides.findIndex((s) => s.classList.contains('active'));
    });

    expect(nextActive).toBeGreaterThan(initialActive);
  });
});
