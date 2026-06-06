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

async function saveExportedHtml(download) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const out = path.join(
    OUTPUT_DIR,
    `${Date.now()}-${Math.random().toString(16).slice(2)}-${download.suggestedFilename()}`,
  );
  await download.saveAs(out);
  return {
    path: out,
    html: fs.readFileSync(out, 'utf-8'),
  };
}

async function loadDocumentWithEditor(page, fixtureName) {
  await page.goto(`/fixtures/${fixtureName}`, { timeout: 30_000 });
  await page.addScriptTag({ path: EDITOR_PATH });
  await page.waitForFunction(() => window.__wfpEditorReady === true, null, { timeout: 10_000 });
}

async function simulateOverviewDragDrop(page, sourceIdx, targetIdx, position = 'before') {
  await page.evaluate(({ srcIdx, tgtIdx, pos }) => {
    const thumbs = document.querySelectorAll('#wfp-editor-root .wfpe-overview-thumb');
    const src = thumbs[srcIdx];
    const tgt = thumbs[tgtIdx];
    if (!src || !tgt) throw new Error(`Missing overview thumb src=${srcIdx} target=${tgtIdx}`);
    const rect = tgt.getBoundingClientRect();
    const x = pos === 'before' ? rect.left + 4 : rect.right - 4;
    const y = rect.top + rect.height / 2;
    const dt = new DataTransfer();
    src.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt }));
    tgt.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, clientX: x, clientY: y, dataTransfer: dt }));
    tgt.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, clientX: x, clientY: y, dataTransfer: dt }));
    src.dispatchEvent(new DragEvent('dragend', { bubbles: true, cancelable: true, dataTransfer: dt }));
  }, { srcIdx: sourceIdx, tgtIdx: targetIdx, pos: position });
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

test.describe('v2.4.2 — Foreign-deck Overview with measured cells', () => {
  test('native overview still uses 1920 by 1080 design cells', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await loadFixtureWithEditor(page, 'Townhall-1.html');

    await page.keyboard.press('o');
    await page.waitForFunction(() => document.querySelectorAll('#wfp-editor-root .wfpe-overview-thumb').length > 0);

    const metrics = await page.evaluate(() => {
      const deck = document.querySelector('.deck');
      const thumb = document.querySelector('#wfp-editor-root .wfpe-overview-thumb');
      const rect = thumb.getBoundingClientRect();
      const cs = getComputedStyle(deck);
      return {
        cellW: cs.getPropertyValue('--wfpe-cell-w').trim(),
        cellH: cs.getPropertyValue('--wfpe-cell-h').trim(),
        thumbW: Math.round(rect.width),
        thumbH: Math.round(rect.height),
      };
    });

    expect(metrics.cellW).toBe('1920px');
    expect(metrics.cellH).toBe('1080px');
    expect(metrics.thumbW).toBe(422);
    expect(metrics.thumbH).toBe(238);
  });

  test('foreign overview measures viewport-sized cells and makes opacity-hidden slides visible', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await loadDocumentWithEditor(page, 'foreign-deck.html');

    await page.keyboard.press('o');
    await page.waitForFunction(() => document.querySelectorAll('#wfp-editor-root .wfpe-overview-thumb').length === 4);

    const metrics = await page.evaluate(() => {
      const root = document.querySelector('#foreign-presentation');
      const slides = [...root.querySelectorAll(':scope > .slide')];
      const thumbs = [...document.querySelectorAll('#wfp-editor-root .wfpe-overview-thumb')];
      return {
        display: getComputedStyle(root).display,
        cellW: getComputedStyle(root).getPropertyValue('--wfpe-cell-w').trim(),
        cellH: getComputedStyle(root).getPropertyValue('--wfpe-cell-h').trim(),
        opacities: slides.map((slide) => getComputedStyle(slide).opacity),
        transitions: slides.map((slide) => getComputedStyle(slide).transitionDuration),
        thumbRects: thumbs.map((thumb) => {
          const rect = thumb.getBoundingClientRect();
          return { width: Math.round(rect.width), height: Math.round(rect.height) };
        }),
        overflowX: document.documentElement.scrollWidth - window.innerWidth,
      };
    });

    expect(metrics.display).toBe('grid');
    expect(metrics.cellW).toBe('1280px');
    expect(metrics.cellH).toBe('720px');
    expect(metrics.opacities).toEqual(['1', '1', '1', '1']);
    expect(metrics.transitions).toEqual(['0s', '0s', '0s', '0s']);
    expect(metrics.overflowX).toBeLessThanOrEqual(1);
    for (const rect of metrics.thumbRects) {
      expect(rect.width).toBe(282);
      expect(rect.height).toBe(158);
    }
  });

  test('foreign overview reorders, deletes, inserts, and exports cleanly', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await loadDocumentWithEditor(page, 'foreign-deck.html');

    await page.keyboard.press('o');
    await page.waitForFunction(() => document.querySelectorAll('#wfp-editor-root .wfpe-overview-thumb').length === 4);

    await simulateOverviewDragDrop(page, 0, 2, 'after');
    await expect.poll(() => page.evaluate(() =>
      [...document.querySelectorAll('#foreign-presentation > .slide')].map((slide) => slide.id)
    )).toEqual(['foreign-slide-2', 'foreign-slide-3', 'foreign-slide-1', 'foreign-slide-4']);

    const deleteThumb = page.locator('#wfp-editor-root .wfpe-overview-thumb[data-wfp-edit-slide-index="1"]');
    await deleteThumb.hover();
    await deleteThumb.locator('.wfpe-overview-delete').click();
    await expect.poll(() => page.evaluate(() =>
      [...document.querySelectorAll('#foreign-presentation > .slide')].map((slide) => slide.id)
    )).toEqual(['foreign-slide-2', 'foreign-slide-1', 'foreign-slide-4']);

    await page.locator('#wfp-editor-root .wfpe-overview-add[data-wfp-edit-insert-index="1"]').click();
    await expect.poll(() => page.locator('#foreign-presentation > .slide').count()).toBe(4);
    await expect(page.locator('#foreign-presentation > .slide').nth(1)).toHaveAttribute('id', 's5');

    const download = await triggerExport(page);
    const html = await readExportedHtml(download);

    expect(html).toContain('id="s5"');
    expect(html).not.toContain('id="wfp-editor-root"');
    expect(html).not.toContain('wfpe-overview');
    expect(html).not.toContain('data-wfp-edit-deck-root');
    expect(html).not.toContain('data-wfp-edit-overview');
    expect(html).not.toContain('--wfpe-cell-w: 1280px');
  });
});

test.describe('v2.4.3 — Flat document mode', () => {
  test('flat documents resolve main as the implicit page and disable Overview', async ({ page }) => {
    await loadDocumentWithEditor(page, 'flat-document.html');

    const resolved = await page.evaluate(() => {
      const root = document.querySelector('#flat-article');
      const overviewBtn = document.querySelector('#wfp-editor-root [data-action="overview"]');
      return {
        hasDeck: !!document.querySelector('.deck'),
        slideCount: document.querySelectorAll('.slide').length,
        rootMarked: root?.getAttribute('data-wfp-edit-deck-root') === 'true',
        flatMarked: root?.getAttribute('data-wfp-edit-flat-root') === 'true',
        overviewHidden: !!overviewBtn && (overviewBtn.hidden || getComputedStyle(overviewBtn).display === 'none'),
        overviewDisabled: !!overviewBtn && overviewBtn.disabled,
      };
    });

    expect(resolved).toEqual({
      hasDeck: false,
      slideCount: 0,
      rootMarked: true,
      flatMarked: true,
      overviewHidden: true,
      overviewDisabled: true,
    });

    await page.keyboard.press('o');
    const overviewState = await page.evaluate(() => ({
      bodyAttr: document.body.getAttribute('data-wfp-edit-overview'),
      thumbCount: document.querySelectorAll('#wfp-editor-root .wfpe-overview-thumb').length,
    }));
    expect(overviewState).toEqual({ bodyAttr: null, thumbCount: 0 });
  });

  test('flat root gets an editor-owned positioning context without inline root mutation', async ({ page }) => {
    await loadDocumentWithEditor(page, 'flat-document.html');

    const rootState = await page.evaluate(() => {
      const root = document.querySelector('#flat-article');
      return {
        inlineStyle: root.getAttribute('style'),
        computedPosition: getComputedStyle(root).position,
        positionMarker: root.getAttribute('data-wfp-edit-flat-position-context'),
      };
    });

    expect(rootState).toEqual({
      inlineStyle: null,
      computedPosition: 'relative',
      positionMarker: 'true',
    });
  });

  test('flat document elements can be selected, dragged, undone, and refreshed while scrolling', async ({ page }) => {
    await loadDocumentWithEditor(page, 'flat-document.html');
    await page.keyboard.press('e');

    const callout = page.locator('[data-testid="flat-callout"]');
    await callout.scrollIntoViewIfNeeded();
    const before = await callout.evaluate((el) => {
      const rect = el.getBoundingClientRect();
      return {
        left: rect.left,
        top: rect.top,
        scrollY: window.scrollY,
      };
    });

    await callout.click();
    await expect(page.locator('#wfp-editor-root .wfpe-selection-ring')).not.toHaveCSS('display', 'none');

    const box = await callout.boundingBox();
    expect(box).not.toBeNull();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 70, box.y + box.height / 2 + 45, { steps: 5 });
    await page.mouse.up();

    const moved = await callout.evaluate((el) => ({
      left: el.getBoundingClientRect().left,
      top: el.getBoundingClientRect().top,
      inlineLeft: el.style.left,
      inlineTop: el.style.top,
      rootInlineStyle: document.querySelector('#flat-article').getAttribute('style'),
    }));
    expect(moved.left).toBeGreaterThanOrEqual(before.left + 65);
    expect(moved.top).toBeGreaterThanOrEqual(before.top + 40);
    expect(moved.inlineLeft).not.toBe('');
    expect(moved.inlineTop).not.toBe('');
    expect(moved.rootInlineStyle).toBeNull();

    const ringTopBeforeScroll = await page.locator('#wfp-editor-root .wfpe-selection-ring').evaluate((el) =>
      Math.round(el.getBoundingClientRect().top)
    );
    await page.mouse.wheel(0, 240);
    await expect.poll(() => page.locator('#wfp-editor-root .wfpe-selection-ring').evaluate((el) =>
      Math.round(el.getBoundingClientRect().top)
    )).not.toBe(ringTopBeforeScroll);

    await page.evaluate((scrollY) => window.scrollTo(0, scrollY), before.scrollY);
    await page.keyboard.press('ControlOrMeta+z');
    const undone = await callout.evaluate((el) => {
      const rect = el.getBoundingClientRect();
      return { left: Math.round(rect.left), top: Math.round(rect.top) };
    });
    expect(undone.left).toBe(Math.round(before.left));
    expect(undone.top).toBe(Math.round(before.top));
  });

  test('flat document export preserves edits and strips mode residue', async ({ page }) => {
    await loadDocumentWithEditor(page, 'flat-document.html');
    await page.keyboard.press('e');

    const title = page.locator('.flat-title');
    await title.dblclick();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.type('Updated flat document title');
    await page.keyboard.press('Escape');
    await expect(title).toHaveText('Updated flat document title');

    const download = await triggerExport(page);
    const html = await readExportedHtml(download);

    expect(html).toContain('Updated flat document title');
    expect(html).not.toContain('id="wfp-editor-root"');
    expect(html).not.toContain('data-wfp-edit-deck-root');
    expect(html).not.toContain('data-wfp-edit-flat-root');
    expect(html).not.toContain('data-wfp-edit-flat-position-context');
    expect(html).not.toContain('contenteditable=');
    expect(html).not.toContain('wfpe-overview');
  });
});

test.describe('v2.4.4 — Cross-mode export round-trip', () => {
  test('native deck export has no adaptive residue and reloads as a clean native deck', async ({ page, context }) => {
    await loadFixtureWithEditor(page, 'Townhall-1.html');
    await page.keyboard.press('o');
    await page.waitForFunction(() => document.body.dataset.wfpEditOverview === 'on');

    const download = await triggerExport(page);
    const exported = await saveExportedHtml(download);

    expect(exported.html.startsWith('<!DOCTYPE html>')).toBe(true);
    expect(exported.html).not.toMatch(/data-wfp-edit[-a-zA-Z]*=/);
    expect(exported.html).not.toContain('id="wfp-editor-root"');
    expect(exported.html).not.toContain('wfpe-overview');
    expect(exported.html).not.toContain('contenteditable=');

    const exportedPage = await context.newPage();
    await exportedPage.goto(`file://${exported.path}`);
    await expect(exportedPage.locator('.deck')).toHaveCount(1);
    await expect(exportedPage.locator('.deck > .slide')).toHaveCount(9);
    await expect(exportedPage.locator('.deck > .slide.active')).toHaveCount(1);
    await expect(exportedPage.locator('#wfp-editor-root')).toHaveCount(0);
    await exportedPage.close();
  });

  test('foreign deck export preserves off-contract root/order and strips adaptive residue', async ({ page, context }) => {
    await loadDocumentWithEditor(page, 'foreign-deck.html');
    await page.keyboard.press('o');
    await page.waitForFunction(() => document.querySelectorAll('#wfp-editor-root .wfpe-overview-thumb').length === 4);

    await simulateOverviewDragDrop(page, 0, 2, 'after');
    await expect.poll(() => page.evaluate(() =>
      [...document.querySelectorAll('#foreign-presentation > .slide')].map((slide) => slide.id)
    )).toEqual(['foreign-slide-2', 'foreign-slide-3', 'foreign-slide-1', 'foreign-slide-4']);

    const download = await triggerExport(page);
    const exported = await saveExportedHtml(download);

    expect(exported.html.startsWith('<!DOCTYPE html>')).toBe(true);
    expect(exported.html).not.toMatch(/data-wfp-edit[-a-zA-Z]*=/);
    expect(exported.html).not.toContain('id="wfp-editor-root"');
    expect(exported.html).not.toContain('wfpe-overview');
    expect(exported.html).not.toContain('--wfpe-cell-w');
    expect(exported.html).not.toContain('contenteditable=');

    const exportedPage = await context.newPage();
    await exportedPage.goto(`file://${exported.path}`);
    const state = await exportedPage.evaluate(() => ({
      hasDeck: !!document.querySelector('.deck'),
      rootExists: !!document.querySelector('#foreign-presentation'),
      order: [...document.querySelectorAll('#foreign-presentation > .slide')].map((slide) => slide.id),
      activeCount: document.querySelectorAll('#foreign-presentation > .slide.active').length,
      editorRoot: !!document.querySelector('#wfp-editor-root'),
    }));
    expect(state).toEqual({
      hasDeck: false,
      rootExists: true,
      order: ['foreign-slide-2', 'foreign-slide-3', 'foreign-slide-1', 'foreign-slide-4'],
      activeCount: 1,
      editorRoot: false,
    });
    await exportedPage.close();
  });

  test('flat document export preserves long-form structure and strips adaptive residue', async ({ page, context }) => {
    await loadDocumentWithEditor(page, 'flat-document.html');
    await page.keyboard.press('e');

    const callout = page.locator('[data-testid="flat-callout"]');
    await callout.scrollIntoViewIfNeeded();
    await callout.click();
    const box = await callout.boundingBox();
    expect(box).not.toBeNull();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 50, box.y + box.height / 2 + 25, { steps: 4 });
    await page.mouse.up();

    const download = await triggerExport(page);
    const exported = await saveExportedHtml(download);

    expect(exported.html.startsWith('<!DOCTYPE html>')).toBe(true);
    expect(exported.html).not.toMatch(/data-wfp-edit[-a-zA-Z]*=/);
    expect(exported.html).not.toContain('id="wfp-editor-root"');
    expect(exported.html).not.toContain('wfpe-overview');
    expect(exported.html).not.toContain('contenteditable=');

    const exportedPage = await context.newPage();
    await exportedPage.goto(`file://${exported.path}`);
    const state = await exportedPage.evaluate(() => {
      const root = document.querySelector('#flat-article');
      const calloutEl = document.querySelector('[data-testid="flat-callout"]');
      return {
        hasDeck: !!document.querySelector('.deck'),
        slideCount: document.querySelectorAll('.slide').length,
        rootExists: !!root,
        rootInlineStyle: root?.getAttribute('style') || null,
        calloutPosition: calloutEl?.style.position || '',
        calloutLeft: calloutEl?.style.left || '',
        editorRoot: !!document.querySelector('#wfp-editor-root'),
      };
    });
    expect(state.hasDeck).toBe(false);
    expect(state.slideCount).toBe(0);
    expect(state.rootExists).toBe(true);
    expect(state.rootInlineStyle).toBeNull();
    expect(state.calloutPosition).toBe('absolute');
    expect(state.calloutLeft).not.toBe('');
    expect(state.editorRoot).toBe(false);
    await exportedPage.close();
  });
});

test.describe('v2.4.5 — End-to-end checkpoint regressions', () => {
  test('foreign deck arrow navigation follows live DOM order after overview reorder', async ({ page }) => {
    await loadDocumentWithEditor(page, 'foreign-deck.html');

    await page.keyboard.press('o');
    await page.waitForFunction(() => document.querySelectorAll('#wfp-editor-root .wfpe-overview-thumb').length === 4);

    await simulateOverviewDragDrop(page, 0, 2, 'after');
    await expect.poll(() => page.evaluate(() =>
      [...document.querySelectorAll('#foreign-presentation > .slide')].map((slide) => slide.id)
    )).toEqual(['foreign-slide-2', 'foreign-slide-3', 'foreign-slide-1', 'foreign-slide-4']);

    await page.keyboard.press('o');
    await expect(page.locator('.slide.active')).toHaveAttribute('id', 'foreign-slide-1');

    await page.keyboard.press('ArrowRight');
    await expect(page.locator('.slide.active')).toHaveAttribute('id', 'foreign-slide-4');
  });
});
