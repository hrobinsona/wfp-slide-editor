import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadFixtureWithEditor } from './_helpers.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = path.join(__dirname, 'output');

test.use({ viewport: { width: 2000, height: 1200 } });

async function setDeckScale(page, scale) {
  await page.evaluate((s) => {
    document.querySelector('.deck').style.transform = `scale(${s})`;
  }, scale);
}

async function clickToSelect(page, selector) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    const r = el.getBoundingClientRect();
    el.dispatchEvent(
      new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
        view: window,
        clientX: r.left + r.width / 2,
        clientY: r.top + r.height / 2,
      }),
    );
  }, selector);
}

async function triggerExport(page) {
  const downloadPromise = page.waitForEvent('download', { timeout: 5_000 });
  await page.keyboard.press('ControlOrMeta+s');
  return downloadPromise;
}

async function readDownloadAsString(download) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const out = path.join(OUTPUT_DIR, download.suggestedFilename());
  await download.saveAs(out);
  return { path: out, content: fs.readFileSync(out, 'utf-8') };
}

test.describe('Phase 8 — Export', () => {
  test('Cmd+S downloads a file with the original basename + -edited.html', async ({
    page,
  }) => {
    await loadFixtureWithEditor(page, 'Townhall-1.html');
    await setDeckScale(page, 1);
    await page.keyboard.press('e');

    const download = await triggerExport(page);
    expect(download.suggestedFilename()).toBe('Townhall-1-edited.html');
  });

  test('exported HTML starts with <!DOCTYPE html>', async ({ page }) => {
    await loadFixtureWithEditor(page, 'Townhall-1.html');
    await setDeckScale(page, 1);
    await page.keyboard.press('e');

    const download = await triggerExport(page);
    const { content } = await readDownloadAsString(download);
    expect(content.startsWith('<!DOCTYPE html>')).toBe(true);
  });

  test('exported HTML contains no editor DOM, script, or markers', async ({ page }) => {
    await loadFixtureWithEditor(page, 'Townhall-1.html');
    await setDeckScale(page, 1);
    await page.keyboard.press('e');

    // Make a few edits that will leave the data-wfp-edit-* markers.
    await clickToSelect(page, '.slide.active h1');
    await page.keyboard.press('ArrowUp');

    const download = await triggerExport(page);
    const { content } = await readDownloadAsString(download);

    expect(content).not.toContain('id="wfp-editor-root"');
    expect(content).not.toContain('editor.js');
    expect(content).not.toMatch(/data-wfp-edit[-a-zA-Z]*\s*=/);
    expect(content).not.toContain('contenteditable=');
  });

  test('exported HTML preserves the font-size change made via the editor', async ({
    page,
  }) => {
    await loadFixtureWithEditor(page, 'Townhall-1.html');
    await setDeckScale(page, 1);
    await page.keyboard.press('e');

    await clickToSelect(page, '.slide.active h1');
    const before = await page.evaluate(
      () => parseFloat(getComputedStyle(document.querySelector('.slide.active h1')).fontSize),
    );
    for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowUp');
    const after = await page.evaluate(
      () => parseFloat(getComputedStyle(document.querySelector('.slide.active h1')).fontSize),
    );
    expect(after).toBeCloseTo(before + 5, 1);

    const download = await triggerExport(page);
    const { content } = await readDownloadAsString(download);

    // The exact font-size value should appear in an inline style somewhere.
    const expectedPx = `${after}px`;
    expect(content).toContain(`font-size: ${expectedPx}`);
  });

  test('exported HTML preserves a drag position change', async ({ page }) => {
    await loadFixtureWithEditor(page, 'Townhall-1.html');
    await setDeckScale(page, 1);
    await page.keyboard.press('e');

    // Drag the WFP badge 60px right.
    const center = await page.evaluate(() => {
      const el = document.querySelector('.slide.active .wfp-badge');
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });
    await page.mouse.move(center.x, center.y);
    await page.mouse.down();
    await page.mouse.move(center.x + 30, center.y, { steps: 4 });
    await page.mouse.move(center.x + 60, center.y, { steps: 4 });
    await page.mouse.up();

    const newLeft = await page.evaluate(
      () => document.querySelector('.slide.active .wfp-badge').style.left,
    );
    expect(newLeft).not.toBe('');

    const download = await triggerExport(page);
    const { content } = await readDownloadAsString(download);

    // The new inline left value should be present in the exported HTML.
    expect(content).toContain(`left: ${newLeft}`);
  });

  test('exported HTML preserves an inline text edit', async ({ page }) => {
    await loadFixtureWithEditor(page, 'Townhall-1.html');
    await setDeckScale(page, 1);
    await page.keyboard.press('e');

    await page.evaluate(() => {
      const h1 = document.querySelector('.slide.active h1');
      const r = h1.getBoundingClientRect();
      h1.dispatchEvent(
        new MouseEvent('dblclick', {
          bubbles: true,
          cancelable: true,
          view: window,
          clientX: r.left + 10,
          clientY: r.top + 10,
          detail: 2,
        }),
      );
      h1.innerHTML = 'EXPORTED HEADLINE TEXT';
    });
    await page.keyboard.press('Escape');

    const download = await triggerExport(page);
    const { content } = await readDownloadAsString(download);

    expect(content).toContain('EXPORTED HEADLINE TEXT');
  });

  test('shows a "Exported to ..." toast after a successful export', async ({ page }) => {
    await loadFixtureWithEditor(page, 'Townhall-1.html');
    await setDeckScale(page, 1);
    await page.keyboard.press('e');

    const downloadPromise = page.waitForEvent('download', { timeout: 5_000 });
    await page.keyboard.press('ControlOrMeta+s');
    await downloadPromise;

    // The toast is added to #wfp-editor-root with text "Exported to <name>".
    const toastText = await page.locator('#wfp-editor-root .wfpe-toast').textContent();
    expect(toastText).toMatch(/^Exported to .+\.html$/);
  });

  test('exported file can be reloaded in a fresh browser without editor JS', async ({
    page,
    context,
  }) => {
    await loadFixtureWithEditor(page, 'Townhall-1.html');
    await setDeckScale(page, 1);
    await page.keyboard.press('e');

    await clickToSelect(page, '.slide.active h1');
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('ArrowUp');

    const download = await triggerExport(page);
    const { path: outPath } = await readDownloadAsString(download);

    const fresh = await context.newPage();
    await fresh.goto(`file://${outPath}`);

    // Slide deck should render and the active slide visible.
    await fresh.locator('.deck').waitFor({ state: 'attached', timeout: 5_000 });
    const activeSlideId = await fresh.evaluate(() => {
      const s = document.querySelector('.slide.active');
      return s ? s.id : null;
    });
    expect(activeSlideId).toBeTruthy();

    // Editor UI must be absent.
    const hasRoot = await fresh.evaluate(
      () => !!document.getElementById('wfp-editor-root'),
    );
    expect(hasRoot).toBe(false);

    await fresh.close();
  });

  test('export does not mutate the live DOM (editor still runs after export)', async ({
    page,
  }) => {
    await loadFixtureWithEditor(page, 'Townhall-1.html');
    await setDeckScale(page, 1);
    await page.keyboard.press('e');

    const download = await triggerExport(page);
    await readDownloadAsString(download);

    // After export, the editor root and badge must still be in the live DOM.
    const stillThere = await page.evaluate(() => ({
      root: !!document.getElementById('wfp-editor-root'),
      badge: !!document.querySelector('#wfp-editor-root .wfpe-mode-badge'),
      editMode: !!document.querySelector('.wfpe-mode-badge[data-mode="on"]'),
    }));
    expect(stillThere.root).toBe(true);
    expect(stillThere.badge).toBe(true);
    expect(stillThere.editMode).toBe(true);
  });
});
