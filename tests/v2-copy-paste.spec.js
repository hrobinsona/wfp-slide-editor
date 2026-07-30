import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadFixtureWithEditor, disableFsa, requireAbsoluteTarget, hitPointFor, EDITOR_MARKER_ATTR_RE } from './_helpers.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = path.join(__dirname, 'output');

test.use({ viewport: { width: 2000, height: 1200 } });

const HEADING_SEL = '[data-test-heading="yes"]';

// Returns the discovered target instead of stashing it in module scope:
// specs run fully parallel, so per-test state cannot be shared.
async function loadReady(page) {
  await loadFixtureWithEditor(page, 'Townhall-1.html');
  const target = await requireAbsoluteTarget(page);
  await page.evaluate(() => { document.querySelector('.deck').style.transform = 'scale(1)'; });
  await page.keyboard.press('e');
  return target;
}

// Real dblclick at a point that hit-tests to the element itself — locator
// .dblclick() aims at the geometric centre, which in the current decks is
// often covered by an accent span inside the headline.
async function dblclickElement(page, selector) {
  const c = await hitPointFor(page, selector);
  await page.mouse.dblclick(c.x, c.y);
}

// A text-bearing element on the active slide, identified the way the deck
// itself would be navigated rather than by a class this deck happens to use.
async function headingSelector(page) {
  const sel = await page.evaluate(() => {
    const slide = document.querySelector('.slide.active');
    const el = [...slide.querySelectorAll('h1, h2, h3, p')].find((n) => {
      const r = n.getBoundingClientRect();
      return (
        r.width > 40 &&
        r.height > 16 &&
        [...n.childNodes].some((c) => c.nodeType === 3 && c.textContent.trim())
      );
    });
    if (!el) return null;
    el.dataset.testHeading = 'yes';
    return '[data-test-heading="yes"]';
  });
  test.skip(!sel, 'no text-bearing heading on this fixture\'s active slide');
  return sel;
}

async function selectByMouse(page, selector) {
  const center = await hitPointFor(page, selector);
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

async function readBadgeSnapshot(page, target) {
  return page.evaluate((sel) => {
    const badges = [...document.querySelectorAll(sel)];
    const last = badges.at(-1);
    const rect = last?.getBoundingClientRect();
    return {
      count: badges.length,
      lastLeft: rect ? Math.round(rect.left) : null,
      lastTop: rect ? Math.round(rect.top) : null,
      lastStyle: last?.getAttribute('style') ?? '',
      selectedIsLast:
        !!last &&
        document.querySelector('#wfp-editor-root .wfpe-selection-ring').style.display === 'block' &&
        Math.abs(last.getBoundingClientRect().left - parseFloat(document.querySelector('#wfp-editor-root .wfpe-selection-ring').style.left)) <= 1,
    };
  }, target);
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
    const target = await loadReady(page);

    await selectByMouse(page, target);
    const before = await page.evaluate((sel) => {
      const r = document.querySelector(sel).getBoundingClientRect();
      return {
        count: document.querySelectorAll(sel).length,
        left: Math.round(r.left),
        top: Math.round(r.top),
      };
    }, target);

    await copySelected(page);
    await pasteClipboard(page);

    const after = await readBadgeSnapshot(page, target);
    expect(after.count).toBe(before.count + 1);
    expect(after.lastLeft).toBeCloseTo(before.left + 20, 0);
    expect(after.lastTop).toBeCloseTo(before.top + 20, 0);
    expect(after.selectedIsLast).toBe(true);
  });

  test('copied element can be pasted onto another active slide', async ({ page }) => {
    const target = await loadReady(page);

    await selectByMouse(page, target);
    const source = await page.evaluate((sel) => {
      const r = document.querySelector(sel).getBoundingClientRect();
      return { left: Math.round(r.left), top: Math.round(r.top) };
    }, target);
    await copySelected(page);

    await page.evaluate(() => {
      document.querySelectorAll('.deck > .slide').forEach((slide, i) => {
        slide.classList.toggle('active', i === 2);
      });
    });
    await pasteClipboard(page);

    const dest = await page.evaluate((sel) => {
      const slide = document.querySelector('.slide.active');
      const badges = [...slide.querySelectorAll(sel.replace('.slide.active ', ''))];
      const last = badges.at(-1);
      // Slide ids are a per-deck authoring choice; assert on position in the
      // deck, which every deck has.
      const index = [...document.querySelectorAll('.deck > .slide')].indexOf(slide);
      const r = last.getBoundingClientRect();
      return { index, count: badges.length, left: Math.round(r.left), top: Math.round(r.top) };
    }, target);
    expect(dest.index).toBe(2);
    expect(dest.count).toBe(1);
    expect(dest.left).toBeCloseTo(source.left + 20, 0);
    expect(dest.top).toBeCloseTo(source.top + 20, 0);
  });

  test('inspector Duplicate button creates the same offset clone', async ({ page }) => {
    const target = await loadReady(page);

    await selectByMouse(page, target);
    const before = await page.evaluate((sel) => {
      const r = document.querySelector(sel).getBoundingClientRect();
      return {
        count: document.querySelectorAll(sel).length,
        left: Math.round(r.left),
        top: Math.round(r.top),
      };
    }, target);

    await page.locator('#wfp-editor-root .wfpe-duplicate-btn').click();

    const after = await readBadgeSnapshot(page, target);
    expect(after.count).toBe(before.count + 1);
    expect(after.lastLeft).toBeCloseTo(before.left + 20, 0);
    expect(after.lastTop).toBeCloseTo(before.top + 20, 0);
    expect(after.selectedIsLast).toBe(true);
  });

  test('duplicating a content-box element with padding preserves rendered size', async ({ page }) => {
    const target = await loadReady(page);

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
    const target = await loadReady(page);

    await selectByMouse(page, target);
    await page.keyboard.press('Backspace');

    await expect(page.locator(target)).toHaveCount(0);
    await expect(page.locator('#wfp-editor-root .wfpe-selection-ring')).toBeHidden();

    await page.keyboard.press('ControlOrMeta+z');
    await expect(page.locator(target)).toHaveCount(1);
    const restoredSelected = await page.evaluate((sel) => {
      const badge = document.querySelector(sel);
      const ring = document.querySelector('#wfp-editor-root .wfpe-selection-ring');
      return (
        ring.style.display === 'block' &&
        Math.abs(badge.getBoundingClientRect().left - parseFloat(ring.style.left)) <= 1
      );
    }, target);
    expect(restoredSelected).toBe(true);
  });

  test('inspector Delete button removes the selected element as one undoable action', async ({ page }) => {
    const target = await loadReady(page);

    await selectByMouse(page, target);
    await page.locator('#wfp-editor-root .wfpe-delete-btn').click();
    await expect(page.locator(target)).toHaveCount(0);

    await page.keyboard.press('ControlOrMeta+z');
    await expect(page.locator(target)).toHaveCount(1);

    await page.keyboard.press('ControlOrMeta+Shift+z');
    await expect(page.locator(target)).toHaveCount(0);
  });

  test('inspector Duplicate commits an open text edit before cloning with undo order intact', async ({ page }) => {
    const target = await loadReady(page);
    const heading = await headingSelector(page);

    await selectByMouse(page, heading);
    const beforeHtml = await page.evaluate(() => document.querySelector('[data-test-heading="yes"]').innerHTML);
    await dblclickElement(page, heading);
    await page.evaluate(() => {
      document.querySelector('[data-test-heading="yes"]').appendChild(document.createTextNode(' DUPLICATED'));
    });

    await page.locator('#wfp-editor-root .wfpe-duplicate-btn').click();

    const duplicated = await page.evaluate(() => {
      const headings = [...document.querySelectorAll('[data-test-heading="yes"]')];
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
    await expect(page.locator(heading)).toHaveCount(1);
    await expect(page.locator(heading)).toContainText('DUPLICATED');

    await page.keyboard.press('ControlOrMeta+z');
    expect(await page.evaluate(() => document.querySelector('[data-test-heading="yes"]').innerHTML)).toBe(beforeHtml);
  });

  test('inspector Delete commits an open text edit before removing with undo order intact', async ({ page }) => {
    const target = await loadReady(page);
    const heading = await headingSelector(page);

    await selectByMouse(page, heading);
    const beforeHtml = await page.evaluate(() => document.querySelector('[data-test-heading="yes"]').innerHTML);
    await dblclickElement(page, heading);
    await page.evaluate(() => {
      document.querySelector('[data-test-heading="yes"]').appendChild(document.createTextNode(' DELETED'));
    });

    await page.locator('#wfp-editor-root .wfpe-delete-btn').click();
    await expect(page.locator(heading)).toHaveCount(0);

    await page.keyboard.press('ControlOrMeta+z');
    await expect(page.locator(heading)).toHaveCount(1);
    await expect(page.locator(heading)).toContainText('DELETED');
    expect(
      await page.evaluate(() => document.querySelector('[data-test-heading="yes"]').getAttribute('contenteditable'))
    ).toBe(null);

    await page.keyboard.press('ControlOrMeta+z');
    expect(await page.evaluate(() => document.querySelector('[data-test-heading="yes"]').innerHTML)).toBe(beforeHtml);
  });

  test('undo removes the pasted element and reselects the original; redo restores the clone', async ({ page }) => {
    const target = await loadReady(page);

    await selectByMouse(page, target);
    const before = await page.evaluate((sel) => {
      const r = document.querySelector(sel).getBoundingClientRect();
      return {
        count: document.querySelectorAll(sel).length,
        left: Math.round(r.left),
        top: Math.round(r.top),
      };
    }, target);
    await copySelected(page);
    await pasteClipboard(page);
    const pasted = await readBadgeSnapshot(page, target);

    await page.keyboard.press('ControlOrMeta+z');
    const undone = await page.evaluate((sel) => {
      const badges = [...document.querySelectorAll(sel)];
      const ring = document.querySelector('#wfp-editor-root .wfpe-selection-ring');
      const first = badges[0];
      return {
        count: badges.length,
        selectedOriginal:
          ring.style.display === 'block' &&
          Math.abs(first.getBoundingClientRect().left - parseFloat(ring.style.left)) <= 1,
      };
    }, target);
    expect(undone.count).toBe(before.count);
    expect(undone.selectedOriginal).toBe(true);

    await page.keyboard.press('ControlOrMeta+Shift+z');
    const redone = await readBadgeSnapshot(page, target);
    expect(redone.count).toBe(before.count + 1);
    expect(redone.lastLeft).toBeCloseTo(pasted.lastLeft, 0);
    expect(redone.lastTop).toBeCloseTo(pasted.lastTop, 0);
  });

  test('Cmd/Ctrl+C inside a contenteditable text edit falls through to browser copy', async ({ page }) => {
    const target = await loadReady(page);
    const heading = await headingSelector(page);

    await dblclickElement(page, heading);
    await page.evaluate(() => {
      const el = document.querySelector('[data-test-heading="yes"]');
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
    // Derived from the fixture: assert the browser copied the heading's own
    // text, not a phrase only the retired deck happened to contain.
    const headingWords = await page.evaluate((sel) => {
      const el = document.querySelector(sel);
      const node = [...el.childNodes].find((n) => n.nodeType === 3 && n.textContent.trim());
      return (node || el).textContent.trim().split(/\s+/).slice(0, 3).join(' ');
    }, HEADING_SEL);
    expect(copyEvent.selection).toContain(headingWords);

    await page.keyboard.press('Escape');
    await pasteClipboard(page);

    const h1Count = await page.locator(heading).count();
    expect(h1Count).toBe(1);
  });

  test('Cmd/Ctrl+V while overview is active is a no-op for element paste', async ({ page }) => {
    const target = await loadReady(page);

    await selectByMouse(page, target);
    await copySelected(page);
    const before = await page.locator(target).count();

    await page.keyboard.press('o');
    await page.waitForFunction(() => document.body.dataset.wfpEditOverview === 'on');
    await pasteClipboard(page);

    const after = await page.locator(target).count();
    expect(after).toBe(before);
  });

  test('export after paste includes the clone but no editor markers', async ({ page }) => {
    // v2.11 — force the legacy download fallback; Cmd+S would otherwise
    // prefer the save-in-place engine on real headless Chromium (file://
    // and http://localhost both expose showSaveFilePicker).
    await disableFsa(page);
    const target = await loadReady(page);

    await page.evaluate((sel) => {
      document.querySelector(sel).dataset.wfpEditFrozen = 'true';
    }, target);
    const beforeCount = await page.locator(`.deck ${target.split('.').pop().replace(/^/, '.')}`).count();
    await selectByMouse(page, target);
    await copySelected(page);
    await pasteClipboard(page);

    const download = await triggerExport(page);
    const content = await readDownloadAsString(download);

    // Derived from the fixture rather than pinned to one deck's element
    // count: whatever the target class was before the paste, the export must
    // carry exactly one more.
    const cls = target.split('.').pop();
    const occurrences = content.match(new RegExp(`class="[^"]*\\b${cls}\\b`, 'g'))?.length ?? 0;
    expect(occurrences).toBe(beforeCount + 1);
    expect(content).not.toMatch(EDITOR_MARKER_ATTR_RE);
    expect(content).not.toContain('contenteditable=');
  });

  test('pasted element keeps the source inline style while gaining paste positioning', async ({ page }) => {
    const target = await loadReady(page);
    const heading = await headingSelector(page);

    // Seed a known unrelated inline style rather than assuming the deck
    // authored one (the retired fixture happened to carry animation-delay).
    await page.evaluate((sel) => {
      document.querySelector(sel).style.animationDelay = '200ms';
    }, HEADING_SEL);
    await selectByMouse(page, heading);
    await copySelected(page);
    await pasteClipboard(page);

    const style = await page.evaluate(() => {
      const headings = [...document.querySelectorAll('[data-test-heading="yes"]')];
      return headings.at(-1).getAttribute('style') || '';
    });
    expect(style).toContain('animation-delay');
    expect(style).toContain('position: absolute');
    expect(style).toContain('left:');
    expect(style).toContain('top:');
  });
});
