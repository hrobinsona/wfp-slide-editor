import { test, expect } from '@playwright/test';
import fs from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

test('author text and scoped notes, recover after reload, then share a clean copy', async ({ page }, testInfo) => {
  page.on('dialog', dialog => dialog.accept());
  async function open() {
    await page.goto('/fixtures/foreign-deck.html');
    await page.addScriptTag({ url: '/editor.js' });
    await page.waitForFunction(() => window.__wfpEditorReady);
  }
  await open();
  await page.keyboard.press('e');
  await page.getByRole('button', { name: 'Add text', exact: true }).click();
  await page.locator('[contenteditable="true"]').fill('Ready for the next planning session');
  await page.keyboard.press('Escape');
  await page.locator('#wfp-editor-root [data-action="notes"]').click();
  await page.locator('[data-action="note-deck"]').click();
  await page.locator('.wfpe-scoped-note-input').fill('Use a consistent narrative across all slides.');
  await page.locator('[data-action="scoped-note-save"]').click();
  await expect(page.locator('.wfpe-recovery-status')).toContainText('Local recovery saved');

  await open();
  await page.getByRole('button', { name: 'Restore local copy', exact: true }).click();
  await expect(page.getByText('Ready for the next planning session', { exact: true })).toBeVisible();
  await page.locator('#wfp-editor-root [data-action="notes"]').click();
  await expect(page.locator('.wfpe-notes-card[data-scope="deck"]')).toContainText('consistent narrative');

  await page.locator('#wfp-editor-root [data-action="export"]').click();
  const downloaded = page.waitForEvent('download');
  await page.locator('#wfp-editor-root [data-action="clean-copy"]').click();
  const output = testInfo.outputPath('shared-copy.html');
  await (await downloaded).saveAs(output);
  const html = await fs.readFile(output, 'utf8');
  expect(html).not.toMatch(/\sdata-wfp-(?:edit|agent)-annotation/);
  expect(html).not.toContain('id="wfp-editor-root"');
  await page.goto(pathToFileURL(output).href);
  await expect(page.getByText('Ready for the next planning session', { exact: true })).toBeVisible();
  await expect(page.locator('#wfp-editor-root')).toHaveCount(0);
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('.slide.active h1')).toHaveText('Editorial calendar');
});

test('navigation, overview and resizing the viewport leave an unedited source clean', async ({ page }) => {
  await page.goto('/fixtures/foreign-deck.html');
  await page.addScriptTag({ url: '/editor.js' });
  const status = page.locator('.wfpe-recovery-status');
  await expect(status).toContainText('Source unchanged');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('o');
  await page.locator('.wfpe-overview-thumb').nth(2).click();
  await page.setViewportSize({ width: 1100, height: 740 });
  await expect(status).toContainText('Source unchanged');
  // Cross the autosave debounce; dirty state must not appear afterwards.
  await page.waitForTimeout(500);
  await expect(status).toHaveAttribute('data-dirty', 'false');
});
