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

test.describe('v2.4.1 — Foreign-deck editing', () => {
  test('foreign decks resolve to their common slide parent and keep their own nav outside edit mode', async ({ page }) => {
    await loadDocumentWithEditor(page, 'foreign-deck.html');

    const resolved = await page.evaluate(() => {
      const root = document.querySelector('#foreign-presentation');
      return {
        hasNativeDeck: !!document.querySelector('.deck'),
        rootMarked: root?.getAttribute('data-wfp-edit-deck-root') === 'true',
        flatMarked: root?.hasAttribute('data-wfp-edit-flat-root') || false,
        directSlides: root ? root.querySelectorAll(':scope > .slide').length : 0,
        activeId: document.querySelector('.slide.active')?.id || null,
      };
    });

    expect(resolved).toEqual({
      hasNativeDeck: false,
      rootMarked: true,
      flatMarked: false,
      directSlides: 4,
      activeId: 'foreign-slide-1',
    });

    await page.keyboard.press('ArrowRight');
    await expect(page.locator('.slide.active')).toHaveAttribute('id', 'foreign-slide-2');

    await page.keyboard.press('e');
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('.slide.active')).toHaveAttribute('id', 'foreign-slide-2');
  });

  test('selects, drags, and undoes an element on a foreign slide', async ({ page }) => {
    await loadDocumentWithEditor(page, 'foreign-deck.html');
    await page.keyboard.press('e');

    const card = page.locator('.slide.active [data-testid="foreign-card"]');
    const before = await card.evaluate((el) => ({
      left: el.offsetLeft,
      top: el.offsetTop,
    }));

    await card.click();
    await expect(page.locator('#wfp-editor-root .wfpe-inspector')).toHaveAttribute('data-visible', 'true');

    const box = await card.boundingBox();
    expect(box).not.toBeNull();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 80, box.y + box.height / 2 + 30, { steps: 5 });
    await page.mouse.up();

    const moved = await card.evaluate((el) => ({
      left: el.offsetLeft,
      top: el.offsetTop,
      inlineLeft: el.style.left,
      inlineTop: el.style.top,
    }));
    expect(moved.left).toBeGreaterThanOrEqual(before.left + 75);
    expect(moved.top).toBeGreaterThanOrEqual(before.top + 25);
    expect(moved.inlineLeft).not.toBe('');
    expect(moved.inlineTop).not.toBe('');

    await page.keyboard.press('ControlOrMeta+z');
    const undone = await card.evaluate((el) => ({ left: el.offsetLeft, top: el.offsetTop }));
    expect(undone.left).toBe(before.left);
    expect(undone.top).toBe(before.top);
  });

  test('resizes and uses inspector position controls on a foreign slide', async ({ page }) => {
    await loadDocumentWithEditor(page, 'foreign-deck.html');
    await page.keyboard.press('e');

    const target = page.locator('.slide.active [data-testid="resize-target"]');
    await target.click();

    const before = await target.evaluate((el) => ({
      left: el.offsetLeft,
      width: el.offsetWidth,
      height: el.offsetHeight,
    }));

    const handle = page.locator('#wfp-editor-root .wfpe-handle-se');
    await expect(handle).not.toHaveCSS('display', 'none');
    const handleBox = await handle.boundingBox();
    expect(handleBox).not.toBeNull();
    await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(handleBox.x + handleBox.width / 2 + 60, handleBox.y + handleBox.height / 2 + 40, { steps: 4 });
    await page.mouse.up();

    const resized = await target.evaluate((el) => ({
      width: el.offsetWidth,
      height: el.offsetHeight,
    }));
    expect(resized.width).toBeGreaterThanOrEqual(before.width + 55);
    expect(resized.height).toBeGreaterThanOrEqual(before.height + 35);

    const xInput = page.locator('#wfp-editor-root input[data-wfpe-prop="x"]');
    await xInput.fill(String(before.left + 33));
    await xInput.press('Enter');
    await expect.poll(() => target.evaluate((el) => el.offsetLeft)).toBe(before.left + 33);
  });

  test('supports inline text edit and copy/paste undo on a foreign slide', async ({ page }) => {
    await loadDocumentWithEditor(page, 'foreign-deck.html');
    await page.keyboard.press('e');

    const title = page.locator('.slide.active .foreign-title');
    await title.dblclick();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.type('Updated agenda title');
    await page.keyboard.press('Escape');
    await expect(title).toHaveText('Updated agenda title');

    await page.keyboard.press('ControlOrMeta+z');
    await expect(title).toHaveText('Market day agenda');

    const note = page.locator('.slide.active .foreign-note').first();
    await note.click();
    await page.keyboard.press('ControlOrMeta+c');
    await page.keyboard.press('ControlOrMeta+v');
    await expect(page.locator('.slide.active .foreign-note')).toHaveCount(2);

    const pasted = page.locator('.slide.active .foreign-note').nth(1);
    const pastedInline = await pasted.evaluate((el) => ({
      left: el.style.left,
      top: el.style.top,
      position: el.style.position,
    }));
    expect(pastedInline.position).toBe('absolute');
    expect(pastedInline.left).not.toBe('');
    expect(pastedInline.top).not.toBe('');

    await page.keyboard.press('ControlOrMeta+z');
    await expect(page.locator('.slide.active .foreign-note')).toHaveCount(1);
  });
});
