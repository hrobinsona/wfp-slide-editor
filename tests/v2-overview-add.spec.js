import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadFixtureWithEditor, disableFsa, requireAbsoluteTarget, hitPointFor } from './_helpers.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = path.join(__dirname, 'output');
const addSel = '#wfp-editor-root .wfpe-overview-add';

test.use({ viewport: { width: 2000, height: 1200 } });

async function loadOverview(page) {
  await loadFixtureWithEditor(page, 'Townhall-1.html');
  await page.evaluate(() => { document.querySelector('.deck').style.transform = 'scale(1)'; });
  await page.keyboard.press('o');
  await page.waitForFunction(() => document.querySelectorAll('#wfp-editor-root .wfpe-overview-thumb').length > 0);
}

async function loadEditReady(page) {
  await loadFixtureWithEditor(page, 'Townhall-1.html');
  await page.evaluate(() => { document.querySelector('.deck').style.transform = 'scale(1)'; });
  await page.keyboard.press('e');
}

async function getSlideOrder(page) {
  return page.evaluate(() => [...document.querySelectorAll('.deck > .slide')].map((s) => s.id));
}

async function clickAddAt(page, index) {
  const button = page.locator(`${addSel}[data-wfp-edit-insert-index="${index}"]`);
  await button.scrollIntoViewIfNeeded();
  await button.click();
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
}

async function clickAddAtVisibleCenter(page, index) {
  const center = await page.evaluate((targetIndex) => {
    const button = document.querySelector(
      `#wfp-editor-root .wfpe-overview-add[data-wfp-edit-insert-index="${targetIndex}"]`,
    );
    if (!button) return null;
    const r = button.getBoundingClientRect();
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    const hit = document.elementFromPoint(x, y);
    return {
      x,
      y,
      hitIndex: hit?.getAttribute('data-wfp-edit-insert-index'),
    };
  }, String(index));
  expect(center).not.toBe(null);
  expect(center.hitIndex).toBe(String(index));
  await page.mouse.click(center.x, center.y);
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
}

async function triggerExport(page) {
  const downloadPromise = page.waitForEvent('download', { timeout: 5_000 });
  await page.keyboard.press('ControlOrMeta+s');
  return downloadPromise;
}

async function readDownloadAsString(download) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const out = path.join(OUTPUT_DIR, `${Date.now()}-${Math.random().toString(16).slice(2)}-${download.suggestedFilename()}`);
  await download.saveAs(out);
  return fs.readFileSync(out, 'utf-8');
}

async function selectByMouse(page, selector) {
  const center = await hitPointFor(page, selector);
  await page.mouse.move(center.x, center.y);
  await page.mouse.down();
  await page.mouse.up();
}

test.describe('v2 overview add slide', () => {
  test('overview renders one add button for every insertion point', async ({ page }) => {
    await loadOverview(page);

    const slideCount = await page.locator('.deck > .slide').count();
    const buttons = await page.evaluate(() =>
      [...document.querySelectorAll('#wfp-editor-root .wfpe-overview-add')]
        .map((b) => Number(b.dataset.wfpEditInsertIndex))
    );
    expect(buttons).toEqual(Array.from({ length: slideCount + 1 }, (_, i) => i));
  });

  test('clicking plus between slides 2 and 3 inserts a blank slide at index 3', async ({ page }) => {
    await loadOverview(page);
    const before = await getSlideOrder(page);

    await clickAddAt(page, 2);

    const after = await getSlideOrder(page);
    expect(after.length).toBe(before.length + 1);
    expect(after[0]).toBe(before[0]);
    expect(after[1]).toBe(before[1]);
    expect(after[3]).toBe(before[2]);
    expect(after[2]).not.toBe(before[2]);

    const blank = await page.evaluate(() => {
      const slide = document.querySelectorAll('.deck > .slide')[2];
      return { id: slide.id, html: slide.innerHTML, active: slide.classList.contains('active') };
    });
    expect(blank.id).toBe('s9');
    expect(blank.html).toBe('');
    expect(blank.active).toBe(false);
  });

  test('clicking a visible plus center inserts at that same position', async ({ page }) => {
    await loadOverview(page);
    const before = await getSlideOrder(page);

    await clickAddAtVisibleCenter(page, 2);

    const after = await getSlideOrder(page);
    expect(after.length).toBe(before.length + 1);
    expect(after[2]).toBe('s9');
    expect(after[3]).toBe(before[2]);
    await expect(page.locator('#wfp-editor-root .wfpe-overview-thumb').nth(2)).toHaveAttribute('data-empty', 'true');
  });

  test('clicking plus before slide 1 inserts a blank slide at the start', async ({ page }) => {
    await loadOverview(page);
    const before = await getSlideOrder(page);

    await clickAddAt(page, 0);

    const after = await getSlideOrder(page);
    expect(after.length).toBe(before.length + 1);
    expect(after[0]).toBe('s9');
    expect(after.slice(1)).toEqual(before);
  });

  test('clicking plus after the last slide appends a blank slide', async ({ page }) => {
    await loadOverview(page);
    const before = await getSlideOrder(page);

    await clickAddAt(page, before.length);

    const after = await getSlideOrder(page);
    expect(after.length).toBe(before.length + 1);
    expect(after.slice(0, before.length)).toEqual(before);
    expect(after.at(-1)).toBe('s9');
  });

  test('undo after add removes the slide and redo restores it at the same index', async ({ page }) => {
    await loadOverview(page);
    const before = await getSlideOrder(page);

    await clickAddAt(page, 2);
    const inserted = await getSlideOrder(page);
    expect(inserted[2]).toBe('s9');

    await page.keyboard.press('ControlOrMeta+z');
    expect(await getSlideOrder(page)).toEqual(before);
    await expect(page.locator('#wfp-editor-root .wfpe-overview-thumb')).toHaveCount(before.length);

    await page.keyboard.press('ControlOrMeta+Shift+z');
    expect(await getSlideOrder(page)).toEqual(inserted);
    await expect(page.locator('#wfp-editor-root .wfpe-overview-thumb')).toHaveCount(inserted.length);
  });

  test('clicking a new thumb exits overview and makes the blank slide active', async ({ page }) => {
    await loadOverview(page);

    await clickAddAt(page, 2);
    await page.locator('#wfp-editor-root .wfpe-overview-thumb').nth(2).click();

    const state = await page.evaluate(() => {
      const active = document.querySelector('.slide.active');
      return {
        overview: document.body.getAttribute('data-wfp-edit-overview'),
        activeId: active?.id,
        activeHtml: active?.innerHTML,
      };
    });
    expect(state.overview).toBe(null);
    expect(state.activeId).toBe('s9');
    expect(state.activeHtml).toBe('');
  });

  test('copied element can be pasted onto a newly inserted blank slide', async ({ page }) => {
    await loadEditReady(page);

    await selectByMouse(page, target);
    await page.keyboard.press('ControlOrMeta+c');
    await page.keyboard.press('o');
    await page.waitForFunction(() => document.querySelectorAll('#wfp-editor-root .wfpe-overview-thumb').length > 0);

    const count = await page.locator('.deck > .slide').count();
    await clickAddAt(page, count);
    await page.locator('#wfp-editor-root .wfpe-overview-thumb').nth(count).click();
    await page.keyboard.press('ControlOrMeta+v');

    const pasted = await page.evaluate(() => {
      const active = document.querySelector('.slide.active');
      const badge = active.querySelector('.wfp-badge');
      return { activeId: active.id, badgeCount: active.querySelectorAll('.wfp-badge').length, badgeText: badge?.textContent };
    });
    expect(pasted.activeId).toBe('s9');
    expect(pasted.badgeCount).toBe(1);
    expect(pasted.badgeText).toBe('WFP');
  });

  test('export includes the inserted blank slide without editor markers', async ({ page }) => {
    // v2.11 — force the legacy download fallback; Cmd+S would otherwise
    // prefer the save-in-place engine on real headless Chromium (file://
    // and http://localhost both expose showSaveFilePicker).
    await disableFsa(page);
    await loadOverview(page);

    await clickAddAt(page, 2);
    const download = await triggerExport(page);
    const content = await readDownloadAsString(download);

    expect(content).toContain('<div class="slide" id="s9"></div>');
    expect(content).not.toMatch(/data-wfp-edit[-a-zA-Z]*\s*=/);
    expect(content).not.toContain('id="wfp-editor-root"');
  });
});
