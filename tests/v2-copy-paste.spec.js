import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadFixtureWithEditor, disableFsa } from './_helpers.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = path.join(__dirname, 'output');

test.use({ viewport: { width: 2000, height: 1200 } });

async function loadReady(page) {
  await loadFixtureWithEditor(page, 'Townhall-1.html');
  await page.evaluate(() => { document.querySelector('.deck').style.transform = 'scale(1)'; });
  await page.keyboard.press('e');
}

async function selectByMouse(page, selector) {
  const center = await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }, selector);
  await page.mouse.move(center.x, center.y);
  await page.mouse.down();
  await page.mouse.up();
}

async function copySelected(page) {
  await page.keyboard.press('ControlOrMeta+c');
}

async function pasteClipboard(page) {
  await page.keyboard.press('ControlOrMeta+v');
}

async function readBadgeSnapshot(page) {
  return page.evaluate(() => {
    const badges = [...document.querySelectorAll('.slide.active .wfp-badge')];
    const last = badges.at(-1);
    return {
      count: badges.length,
      lastLeft: last?.offsetLeft ?? null,
      lastTop: last?.offsetTop ?? null,
      lastStyle: last?.getAttribute('style') ?? '',
      selectedIsLast:
        !!last &&
        document.querySelector('#wfp-editor-root .wfpe-selection-ring').style.display === 'block' &&
        Math.abs(last.getBoundingClientRect().left - parseFloat(document.querySelector('#wfp-editor-root .wfpe-selection-ring').style.left)) <= 1,
    };
  });
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

test.describe('v2 copy/paste/duplicate', () => {
  test('copying an element and pasting on the same slide inserts an offset selected clone', async ({ page }) => {
    await loadReady(page);

    await selectByMouse(page, '.slide.active .wfp-badge');
    const before = await page.evaluate(() => {
      const el = document.querySelector('.slide.active .wfp-badge');
      return { count: document.querySelectorAll('.slide.active .wfp-badge').length, left: el.offsetLeft, top: el.offsetTop };
    });

    await copySelected(page);
    await pasteClipboard(page);

    const after = await readBadgeSnapshot(page);
    expect(after.count).toBe(before.count + 1);
    expect(after.lastLeft).toBeCloseTo(before.left + 20, 0);
    expect(after.lastTop).toBeCloseTo(before.top + 20, 0);
    expect(after.selectedIsLast).toBe(true);
  });

  test('copied element can be pasted onto another active slide', async ({ page }) => {
    await loadReady(page);

    await selectByMouse(page, '.slide.active .wfp-badge');
    const source = await page.evaluate(() => {
      const el = document.querySelector('.slide.active .wfp-badge');
      return { left: el.offsetLeft, top: el.offsetTop };
    });
    await copySelected(page);

    await page.evaluate(() => {
      document.querySelectorAll('.deck > .slide').forEach((slide, i) => {
        slide.classList.toggle('active', i === 2);
      });
    });
    await pasteClipboard(page);

    const dest = await page.evaluate(() => {
      const slide = document.querySelector('.slide.active');
      const badges = [...slide.querySelectorAll('.wfp-badge')];
      const last = badges.at(-1);
      return { activeId: slide.id, count: badges.length, left: last.offsetLeft, top: last.offsetTop };
    });
    expect(dest.activeId).toBe('s2');
    expect(dest.count).toBe(2);
    expect(dest.left).toBeCloseTo(source.left + 20, 0);
    expect(dest.top).toBeCloseTo(source.top + 20, 0);
  });

  test('inspector Duplicate button creates the same offset clone', async ({ page }) => {
    await loadReady(page);

    await selectByMouse(page, '.slide.active .wfp-badge');
    const before = await page.evaluate(() => {
      const el = document.querySelector('.slide.active .wfp-badge');
      return { count: document.querySelectorAll('.slide.active .wfp-badge').length, left: el.offsetLeft, top: el.offsetTop };
    });

    await page.locator('#wfp-editor-root .wfpe-duplicate-btn').click();

    const after = await readBadgeSnapshot(page);
    expect(after.count).toBe(before.count + 1);
    expect(after.lastLeft).toBeCloseTo(before.left + 20, 0);
    expect(after.lastTop).toBeCloseTo(before.top + 20, 0);
    expect(after.selectedIsLast).toBe(true);
  });

  test('duplicating a content-box element with padding preserves rendered size', async ({ page }) => {
    await loadReady(page);

    await page.evaluate(() => {
      const card = document.createElement('div');
      card.className = 'copy-size-probe';
      card.textContent = 'Padded card';
      Object.assign(card.style, {
        position: 'absolute',
        left: '240px',
        top: '300px',
        width: '320px',
        minHeight: '120px',
        boxSizing: 'content-box',
        padding: '32px',
        border: '4px solid rgb(217, 226, 239)',
        background: 'white',
        fontSize: '36px',
        lineHeight: '1.2',
        zIndex: '9999',
      });
      document.querySelector('.slide.active').appendChild(card);
    });
    await selectByMouse(page, '.copy-size-probe');
    const before = await page.evaluate(() => {
      const r = document.querySelector('.copy-size-probe').getBoundingClientRect();
      return { width: r.width, height: r.height };
    });

    await page.locator('#wfp-editor-root .wfpe-duplicate-btn').click();

    const after = await page.evaluate(() => {
      const cards = [...document.querySelectorAll('.copy-size-probe')];
      const r = cards.at(-1).getBoundingClientRect();
      return { count: cards.length, width: r.width, height: r.height };
    });
    expect(after.count).toBe(2);
    expect(after.width).toBeCloseTo(before.width, 0);
    expect(after.height).toBeCloseTo(before.height, 0);
  });

  test('Backspace deletes the selected element and undo restores it selected', async ({ page }) => {
    await loadReady(page);

    await selectByMouse(page, '.slide.active .wfp-badge');
    await page.keyboard.press('Backspace');

    await expect(page.locator('.slide.active .wfp-badge')).toHaveCount(0);
    await expect(page.locator('#wfp-editor-root .wfpe-selection-ring')).toBeHidden();

    await page.keyboard.press('ControlOrMeta+z');
    await expect(page.locator('.slide.active .wfp-badge')).toHaveCount(1);
    const restoredSelected = await page.evaluate(() => {
      const badge = document.querySelector('.slide.active .wfp-badge');
      const ring = document.querySelector('#wfp-editor-root .wfpe-selection-ring');
      return (
        ring.style.display === 'block' &&
        Math.abs(badge.getBoundingClientRect().left - parseFloat(ring.style.left)) <= 1
      );
    });
    expect(restoredSelected).toBe(true);
  });

  test('inspector Delete button removes the selected element as one undoable action', async ({ page }) => {
    await loadReady(page);

    await selectByMouse(page, '.slide.active .wfp-badge');
    await page.locator('#wfp-editor-root .wfpe-delete-btn').click();
    await expect(page.locator('.slide.active .wfp-badge')).toHaveCount(0);

    await page.keyboard.press('ControlOrMeta+z');
    await expect(page.locator('.slide.active .wfp-badge')).toHaveCount(1);

    await page.keyboard.press('ControlOrMeta+Shift+z');
    await expect(page.locator('.slide.active .wfp-badge')).toHaveCount(0);
  });

  test('inspector Duplicate commits an open text edit before cloning with undo order intact', async ({ page }) => {
    await loadReady(page);

    await selectByMouse(page, '.slide.active h1');
    const beforeHtml = await page.evaluate(() => document.querySelector('.slide.active h1').innerHTML);
    await page.locator('.slide.active h1').dblclick();
    await page.evaluate(() => {
      document.querySelector('.slide.active h1').appendChild(document.createTextNode(' DUPLICATED'));
    });

    await page.locator('#wfp-editor-root .wfpe-duplicate-btn').click();

    const duplicated = await page.evaluate(() => {
      const headings = [...document.querySelectorAll('.slide.active h1')];
      return {
        count: headings.length,
        firstEditable: headings[0].getAttribute('contenteditable'),
        lastEditable: headings.at(-1).getAttribute('contenteditable'),
        firstHtml: headings[0].innerHTML,
        lastHtml: headings.at(-1).innerHTML,
      };
    });
    expect(duplicated.count).toBe(2);
    expect(duplicated.firstEditable === null || duplicated.firstEditable === 'false').toBe(true);
    expect(duplicated.lastEditable === null || duplicated.lastEditable === 'false').toBe(true);
    expect(duplicated.firstHtml).toContain('DUPLICATED');
    expect(duplicated.lastHtml).toContain('DUPLICATED');

    await page.keyboard.press('ControlOrMeta+z');
    await expect(page.locator('.slide.active h1')).toHaveCount(1);
    await expect(page.locator('.slide.active h1')).toContainText('DUPLICATED');

    await page.keyboard.press('ControlOrMeta+z');
    expect(await page.evaluate(() => document.querySelector('.slide.active h1').innerHTML)).toBe(beforeHtml);
  });

  test('inspector Delete commits an open text edit before removing with undo order intact', async ({ page }) => {
    await loadReady(page);

    await selectByMouse(page, '.slide.active h1');
    const beforeHtml = await page.evaluate(() => document.querySelector('.slide.active h1').innerHTML);
    await page.locator('.slide.active h1').dblclick();
    await page.evaluate(() => {
      document.querySelector('.slide.active h1').appendChild(document.createTextNode(' DELETED'));
    });

    await page.locator('#wfp-editor-root .wfpe-delete-btn').click();
    await expect(page.locator('.slide.active h1')).toHaveCount(0);

    await page.keyboard.press('ControlOrMeta+z');
    await expect(page.locator('.slide.active h1')).toHaveCount(1);
    await expect(page.locator('.slide.active h1')).toContainText('DELETED');
    expect(
      await page.evaluate(() => document.querySelector('.slide.active h1').getAttribute('contenteditable'))
    ).toBe(null);

    await page.keyboard.press('ControlOrMeta+z');
    expect(await page.evaluate(() => document.querySelector('.slide.active h1').innerHTML)).toBe(beforeHtml);
  });

  test('undo removes the pasted element and reselects the original; redo restores the clone', async ({ page }) => {
    await loadReady(page);

    await selectByMouse(page, '.slide.active .wfp-badge');
    const before = await page.evaluate(() => {
      const el = document.querySelector('.slide.active .wfp-badge');
      return { count: document.querySelectorAll('.slide.active .wfp-badge').length, left: el.offsetLeft, top: el.offsetTop };
    });
    await copySelected(page);
    await pasteClipboard(page);
    const pasted = await readBadgeSnapshot(page);

    await page.keyboard.press('ControlOrMeta+z');
    const undone = await page.evaluate(() => {
      const badges = [...document.querySelectorAll('.slide.active .wfp-badge')];
      const ring = document.querySelector('#wfp-editor-root .wfpe-selection-ring');
      const first = badges[0];
      return {
        count: badges.length,
        selectedOriginal:
          ring.style.display === 'block' &&
          Math.abs(first.getBoundingClientRect().left - parseFloat(ring.style.left)) <= 1,
      };
    });
    expect(undone.count).toBe(before.count);
    expect(undone.selectedOriginal).toBe(true);

    await page.keyboard.press('ControlOrMeta+Shift+z');
    const redone = await readBadgeSnapshot(page);
    expect(redone.count).toBe(before.count + 1);
    expect(redone.lastLeft).toBeCloseTo(pasted.lastLeft, 0);
    expect(redone.lastTop).toBeCloseTo(pasted.lastTop, 0);
  });

  test('Cmd/Ctrl+C inside a contenteditable text edit falls through to browser copy', async ({ page }) => {
    await loadReady(page);

    await page.locator('.slide.active h1').dblclick();
    await page.evaluate(() => {
      const el = document.querySelector('.slide.active h1');
      const textNode = [...el.childNodes].find((node) => node.nodeType === Node.TEXT_NODE && node.textContent.trim());
      const range = document.createRange();
      range.selectNodeContents(textNode || el);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      window.__wfpeCopyEvent = null;
      document.addEventListener('copy', (event) => {
        window.__wfpeCopyEvent = {
          defaultPrevented: event.defaultPrevented,
          selection: window.getSelection().toString(),
        };
      }, { once: true });
    });
    await page.keyboard.press('ControlOrMeta+c');
    const copyEvent = await page.evaluate(() => window.__wfpeCopyEvent);
    expect(copyEvent.defaultPrevented).toBe(false);
    expect(copyEvent.selection).toContain('From research curiosity');

    await page.keyboard.press('Escape');
    await pasteClipboard(page);

    const h1Count = await page.locator('.slide.active h1').count();
    expect(h1Count).toBe(1);
  });

  test('Cmd/Ctrl+V while overview is active is a no-op for element paste', async ({ page }) => {
    await loadReady(page);

    await selectByMouse(page, '.slide.active .wfp-badge');
    await copySelected(page);
    const before = await page.locator('.slide.active .wfp-badge').count();

    await page.keyboard.press('o');
    await page.waitForFunction(() => document.body.dataset.wfpEditOverview === 'on');
    await pasteClipboard(page);

    const after = await page.locator('.slide.active .wfp-badge').count();
    expect(after).toBe(before);
  });

  test('export after paste includes the clone but no editor markers', async ({ page }) => {
    // v2.11 — force the legacy download fallback; Cmd+S would otherwise
    // prefer the save-in-place engine on real headless Chromium (file://
    // and http://localhost both expose showSaveFilePicker).
    await disableFsa(page);
    await loadReady(page);

    await page.evaluate(() => {
      document.querySelector('.slide.active .wfp-badge').dataset.wfpEditFrozen = 'true';
    });
    await selectByMouse(page, '.slide.active .wfp-badge');
    await copySelected(page);
    await pasteClipboard(page);

    const download = await triggerExport(page);
    const content = await readDownloadAsString(download);

    expect(content.match(/class="[^"]*\bwfp-badge\b/g)?.length ?? 0).toBe(10);
    expect(content).not.toMatch(/data-wfp-edit[-a-zA-Z]*\s*=/);
    expect(content).not.toContain('contenteditable=');
  });

  test('pasted element keeps the source inline style while gaining paste positioning', async ({ page }) => {
    await loadReady(page);

    await selectByMouse(page, '.slide.active h1');
    await copySelected(page);
    await pasteClipboard(page);

    const style = await page.evaluate(() => {
      const headings = [...document.querySelectorAll('.slide.active h1')];
      return headings.at(-1).getAttribute('style') || '';
    });
    expect(style).toContain('animation-delay');
    expect(style).toContain('position: absolute');
    expect(style).toContain('left:');
    expect(style).toContain('top:');
  });
});
