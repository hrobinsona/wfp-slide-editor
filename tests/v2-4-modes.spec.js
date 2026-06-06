import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EDITOR_PATH, loadFixtureWithEditor } from './_helpers.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = path.join(__dirname, 'output');

async function triggerExport(page) {
  const downloadPromise = page.waitForEvent('download', { timeout: 8_000 });
  await page.keyboard.press('ControlOrMeta+s');
  return downloadPromise;
}

async function readExportedHtml(download) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const out = path.join(
    OUTPUT_DIR,
    `${Date.now()}-${Math.random().toString(16).slice(2)}-${download.suggestedFilename()}`,
  );
  await download.saveAs(out);
  return fs.readFileSync(out, 'utf-8');
}

async function loadDocumentWithEditor(page, fixtureName) {
  await page.goto(`/fixtures/${fixtureName}`, { timeout: 30_000 });
  await page.addScriptTag({ path: EDITOR_PATH });
  await page.waitForFunction(() => window.__wfpEditorReady === true, null, { timeout: 10_000 });
}

test.describe('v2.4.0 — Deck-root resolver', () => {
  test('native decks are resolved and marked without changing the slide list', async ({ page }) => {
    await loadFixtureWithEditor(page, 'Townhall-1.html');

    const mode = await page.evaluate(() => {
      const deck = document.querySelector('.deck');
      return {
        hasDeckRootMarker: deck?.getAttribute('data-wfp-edit-deck-root') === 'true',
        hasFlatRootMarker: deck?.hasAttribute('data-wfp-edit-flat-root') || false,
        directSlides: deck ? deck.querySelectorAll(':scope > .slide').length : 0,
        activeSlides: deck ? deck.querySelectorAll(':scope > .slide.active').length : 0,
      };
    });

    expect(mode).toEqual({
      hasDeckRootMarker: true,
      hasFlatRootMarker: false,
      directSlides: 9,
      activeSlides: 1,
    });
  });

  test('native deck root markers are scrubbed from export', async ({ page }) => {
    await loadFixtureWithEditor(page, 'Townhall-1.html');

    const liveHasMarker = await page.evaluate(() =>
      document.querySelector('.deck')?.hasAttribute('data-wfp-edit-deck-root') || false
    );
    expect(liveHasMarker).toBe(true);

    await page.keyboard.press('e');
    const download = await triggerExport(page);
    const html = await readExportedHtml(download);

    expect(html).not.toContain('data-wfp-edit-deck-root');
    expect(html).not.toContain('data-wfp-edit-flat-root');
  });
});
