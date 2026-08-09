import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  EDITOR_PATH,
  loadFixtureWithEditor,
  disableFsa,
  EDITOR_MARKER_ATTR_RE,
  dragResizeHandle,
} from './_helpers.js';

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
  // v2.11 — Cmd+S now prefers the save-in-place engine when the File
  // System Access API is present (real headless Chromium has it on
  // file:// and http://localhost origins). Every test using this helper
  // asserts on the legacy download the editor used to always produce, so
  // force that fallback path explicitly.
  await disableFsa(page);
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

    // Slide count comes from the loaded fixture — the resolver's contract is
    // "don't change the slide list", not "there are nine slides".
    const authoredSlides = await page.locator('.deck > .slide').count();
    expect(authoredSlides).toBeGreaterThan(0);
    expect(mode).toEqual({
      hasDeckRootMarker: true,
      hasFlatRootMarker: false,
      directSlides: authoredSlides,
      activeSlides: 1,
    });
  });

  test('native deck root markers are scrubbed from export', async ({ page }) => {
    // v2.11 — Cmd+S prefers the save-in-place engine wherever the File System
    // Access API exists (headless Chromium has it on http://localhost). This
    // assertion is about the downloaded file, so force the legacy path.
    await disableFsa(page);
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

    // Edit mode with nothing selected leaves the foreign deck's own nav in
    // charge; only a live selection reserves the arrows for the editor.
    // Full rule coverage lives in tests/v2-edit-mode-nav.spec.js.
    await page.keyboard.press('e');
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('.slide.active')).toHaveAttribute('id', 'foreign-slide-3');

    await page.locator('#foreign-slide-3 .foreign-title').click();
    await expect(page.locator('#wfp-editor-root .wfpe-inspector')).toHaveAttribute('data-visible', 'true');
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(150);
    await expect(page.locator('.slide.active')).toHaveAttribute('id', 'foreign-slide-3');
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
    await dragResizeHandle(page, 'se', 60, 40, { steps: 4 });

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

  test('foreign overview keeps transformed flex slides in stable measured thumbnail cells', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.setContent(`
      <!doctype html>
      <html>
      <head>
        <style>
          * { box-sizing: border-box; }
          body { margin: 0; overflow: hidden; background: #0a0a0c; color: white; font-family: system-ui, sans-serif; }
          .presentation { position: fixed; inset: 0; overflow: clip; background: #0a0a0c; }
          .slide {
            position: absolute;
            inset: 0;
            bottom: 64px;
            display: flex;
            flex-direction: column;
            justify-content: center;
            align-items: center;
            padding: 40px 80px;
            opacity: 0;
            pointer-events: none;
            transform: translateX(80px) scale(0.97);
          }
          .slide.active {
            opacity: 1;
            pointer-events: auto;
            transform: translateX(0) scale(1);
          }
          .content-area {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 16px;
            max-width: 1040px;
            width: 100%;
            transform: translateY(0);
          }
          .card {
            min-height: 260px;
            border: 1px solid rgba(255,255,255,0.16);
            border-radius: 20px;
            padding: 28px 24px;
          }
          .tall { min-height: 360px; }
        </style>
      </head>
      <body>
        <div class="presentation">
          ${Array.from({ length: 7 }, (_, i) => `
            <section class="slide${i === 2 ? ' active' : ''}" data-slide="${i}">
              <h2>Slide ${i + 1}</h2>
              <div class="content-area">
                <div class="card">One</div>
                <div class="card${i >= 4 ? ' tall' : ''}">Two</div>
                <div class="card">Three</div>
              </div>
            </section>
          `).join('')}
        </div>
      </body>
      </html>
    `);
    await page.addScriptTag({ path: EDITOR_PATH });
    await page.waitForFunction(() => window.__wfpEditorReady === true, null, { timeout: 10_000 });

    await page.keyboard.press('o');
    await page.waitForFunction(() => document.querySelectorAll('#wfp-editor-root .wfpe-overview-thumb').length === 7);

    const metrics = await page.evaluate(() => {
      const root = document.querySelector('.presentation');
      const rootStyle = getComputedStyle(root);
      const thumbs = [...document.querySelectorAll('#wfp-editor-root .wfpe-overview-thumb')].map((thumb) => {
        const rect = thumb.getBoundingClientRect();
        return {
          left: Math.round(rect.left),
          top: Math.round(rect.top),
          bottom: Math.round(rect.bottom),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        };
      });
      const slides = [...document.querySelectorAll('.presentation > .slide')].map((slide) => {
        const rect = slide.getBoundingClientRect();
        const cs = getComputedStyle(slide);
        return {
          display: cs.display,
          bottom: cs.bottom,
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        };
      });
      return {
        rootOverflow: rootStyle.overflow,
        slideDisplayVar: rootStyle.getPropertyValue('--wfpe-overview-slide-display').trim(),
        cellW: rootStyle.getPropertyValue('--wfpe-cell-w').trim(),
        cellH: rootStyle.getPropertyValue('--wfpe-cell-h').trim(),
        thumbs,
        slides,
      };
    });

    expect(metrics.rootOverflow).toBe('visible');
    expect(metrics.slideDisplayVar).toBe('flex');
    expect(metrics.cellW).toBe('1280px');
    expect(metrics.cellH).toBe('656px');
    expect(metrics.thumbs).toHaveLength(7);
    expect(new Set(metrics.thumbs.map((thumb) => thumb.height))).toEqual(new Set([144]));
    expect(metrics.thumbs[2].top).toBeGreaterThanOrEqual(metrics.thumbs[0].bottom + 8);
    expect(metrics.thumbs[4].top).toBeGreaterThanOrEqual(metrics.thumbs[2].bottom + 8);
    expect(new Set(metrics.slides.map((slide) => slide.display))).toEqual(new Set(['flex']));
    expect(new Set(metrics.slides.map((slide) => slide.height))).toEqual(new Set([144]));
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

  test('flat document resize can grow an element beyond stylesheet max-width', async ({ page }) => {
    await loadDocumentWithEditor(page, 'flat-document.html');
    await page.keyboard.press('e');

    const title = page.locator('.flat-title');
    await title.click();

    const before = await title.evaluate((el) => ({
      width: el.offsetWidth,
      computedMaxWidth: getComputedStyle(el).maxWidth,
    }));
    expect(before.computedMaxWidth).not.toBe('none');

    const handle = page.locator('#wfp-editor-root .wfpe-handle-e');
    await expect(handle).not.toHaveCSS('display', 'none');
    await dragResizeHandle(page, 'e', 160, 0);

    const after = await title.evaluate((el) => ({
      width: el.offsetWidth,
      inlineWidth: el.style.width,
      inlineMaxWidth: el.style.maxWidth,
      computedMaxWidth: getComputedStyle(el).maxWidth,
    }));

    expect(after.inlineWidth).not.toBe('');
    expect(after.inlineMaxWidth).toBe('none');
    expect(after.computedMaxWidth).toBe('none');
    expect(after.width).toBeGreaterThanOrEqual(before.width + 140);

    await page.keyboard.press('ControlOrMeta+z');
    const undone = await title.evaluate((el) => ({
      width: el.offsetWidth,
      inlineMaxWidth: el.style.maxWidth,
      computedMaxWidth: getComputedStyle(el).maxWidth,
    }));
    expect(undone.width).toBe(before.width);
    expect(undone.inlineMaxWidth).toBe('');
    expect(undone.computedMaxWidth).toBe(before.computedMaxWidth);
  });

  test('flat document drag keeps static grid children anchored during flow unlock', async ({ page }) => {
    await loadDocumentWithEditor(page, 'flat-document.html');
    await page.evaluate(() => {
      const root = document.querySelector('#flat-article');
      const grid = document.createElement('div');
      grid.dataset.testid = 'flow-grid';
      grid.style.cssText = [
        'display:grid',
        'grid-template-columns:repeat(3,160px)',
        'gap:16px',
        'width:512px',
        'margin:48px auto',
        'align-items:stretch',
        'transform:translateY(0)',
      ].join(';');

      ['A', 'B', 'C'].forEach((label) => {
        const cell = document.createElement('div');
        cell.dataset.testid = `flow-grid-${label.toLowerCase()}`;
        cell.textContent = label;
        cell.style.cssText = [
          'height:90px',
          'padding:18px',
          'border-radius:6px',
          'background:#eef5f7',
          'border:1px solid #d4e4ea',
          'color:#234856',
          'font-weight:750',
        ].join(';');
        grid.append(cell);
      });

      root.prepend(grid);
    });
    await page.keyboard.press('e');

    const target = page.locator('[data-testid="flow-grid-c"]');
    const first = page.locator('[data-testid="flow-grid-a"]');
    const before = await target.evaluate((el) => {
      const rect = el.getBoundingClientRect();
      return { left: rect.left, top: rect.top };
    });
    const firstBefore = await first.evaluate((el) => {
      const rect = el.getBoundingClientRect();
      return { left: rect.left, top: rect.top };
    });

    await target.click();
    const box = await target.boundingBox();
    expect(box).not.toBeNull();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2 + 24, { steps: 5 });
    await page.mouse.up();

    const after = await target.evaluate((el) => {
      const rect = el.getBoundingClientRect();
      return {
        left: rect.left,
        top: rect.top,
        inlineLeft: el.style.left,
        inlineTop: el.style.top,
      };
    });
    const firstAfter = await first.evaluate((el) => {
      const rect = el.getBoundingClientRect();
      return { left: rect.left, top: rect.top };
    });

    expect(after.left).toBeCloseTo(before.left + 60, 0);
    expect(after.top).toBeCloseTo(before.top + 24, 0);
    expect(after.inlineLeft).not.toMatch(/^-/);
    expect(after.inlineTop).not.toMatch(/^-/);
    expect(firstAfter.left).toBeCloseTo(firstBefore.left, 0);
    expect(firstAfter.top).toBeCloseTo(firstBefore.top, 0);
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

  // The editor gives a statically-positioned flat root a positioning context
  // through an editor-stylesheet rule keyed on
  // data-wfp-edit-flat-position-context. Export drops both the editor CSS and
  // the marker, so anything the unlock pinned against that root has to keep a
  // containing block some other way or it re-anchors to the viewport.
  test('flat document export keeps pinned root children anchored to the flat root', async ({ page, context }) => {
    await loadDocumentWithEditor(page, 'flat-document.html');
    await page.keyboard.press('e');

    const hero = page.locator('.flat-hero');
    // Direct child of the flat root — the unlock pins it straight against the
    // root's editor-owned positioning context (no intermediate container).
    expect(await hero.evaluate((el) => el.parentElement.id)).toBe('flat-article');

    const box = await hero.boundingBox();
    expect(box).not.toBeNull();
    // Grab inside the hero's bottom padding: clear of its text children and
    // clear of the fixed editor toolbar at the top of the viewport.
    const grabX = box.x + 30;
    const grabY = box.y + box.height - 30;
    await page.mouse.move(grabX, grabY);
    await page.mouse.down();
    await page.mouse.move(grabX + 40, grabY, { steps: 5 });
    await page.mouse.up();

    const measureHero = () => {
      const el = document.querySelector('.flat-hero');
      const root = document.querySelector('#flat-article');
      const r = el.getBoundingClientRect();
      const rootRect = root.getBoundingClientRect();
      return {
        relLeft: r.left - rootRect.left,
        relTop: r.top - rootRect.top,
        offsetParentTag: el.offsetParent ? el.offsetParent.tagName : null,
        offsetParentId: el.offsetParent ? el.offsetParent.id : null,
        rootPosition: getComputedStyle(root).position,
        inlinePosition: el.style.position,
      };
    };

    const live = await page.evaluate(measureHero);
    expect(live.inlinePosition).toBe('absolute');
    expect(live.offsetParentId).toBe('flat-article');

    const download = await triggerExport(page);
    const exported = await saveExportedHtml(download);

    // The fix persists a style property, never the marker attribute.
    expect(exported.html).not.toContain('data-wfp-edit-flat-position-context');
    // …and it stamps the CLONE only. Without this, a stamp applied to the live
    // documentElement would satisfy every other assertion here.
    expect(
      await page.evaluate(() => document.querySelector('#flat-article').getAttribute('style')),
    ).toBeNull();

    const exportedPage = await context.newPage();
    await exportedPage.goto(`file://${exported.path}`);
    const after = await exportedPage.evaluate(measureHero);
    await exportedPage.close();

    expect(after.rootPosition === 'static' && after.offsetParentId !== 'flat-article').toBe(false);
    expect(Math.abs(after.relLeft - live.relLeft)).toBeLessThanOrEqual(1);
    expect(Math.abs(after.relTop - live.relTop)).toBeLessThanOrEqual(1);
  });
});

test.describe('v2.4.4 — Cross-mode export round-trip', () => {
  test('native deck export has no adaptive residue and reloads as a clean native deck', async ({ page, context }) => {
    // See the note in v2.4.0 — this assertion needs the legacy download path.
    await disableFsa(page);
    await loadFixtureWithEditor(page, 'Townhall-1.html');
    await page.keyboard.press('o');
    await page.waitForFunction(() => document.body.dataset.wfpEditOverview === 'on');

    const download = await triggerExport(page);
    const exported = await saveExportedHtml(download);

    expect(exported.html.startsWith('<!DOCTYPE html>')).toBe(true);
    expect(exported.html).not.toMatch(EDITOR_MARKER_ATTR_RE);
    expect(exported.html).not.toContain('id="wfp-editor-root"');
    expect(exported.html).not.toMatch(/class="[^"]*\bwfpe-overview/);
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
    expect(exported.html).not.toMatch(EDITOR_MARKER_ATTR_RE);
    expect(exported.html).not.toContain('id="wfp-editor-root"');
    expect(exported.html).not.toMatch(/class="[^"]*\bwfpe-overview/);
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
    expect(exported.html).not.toMatch(EDITOR_MARKER_ATTR_RE);
    expect(exported.html).not.toContain('id="wfp-editor-root"');
    expect(exported.html).not.toMatch(/class="[^"]*\bwfpe-overview/);
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
    // The export replaces the editor-CSS positioning context with the single
    // inline declaration that reproduces it — and nothing else. The live root
    // stays pristine (asserted in the v2.4.3 marker test above).
    expect(state.rootInlineStyle).toBe('position: relative;');
    expect(state.calloutPosition).toBe('absolute');
    expect(state.calloutLeft).not.toBe('');
    expect(state.editorRoot).toBe(false);
    await exportedPage.close();
  });
});

test.describe('v2.4.5 — End-to-end checkpoint regressions', () => {
  test('foreign overview thumbnail activation hands later arrows to fresh-DOM navigation', async ({ page }) => {
    await loadDocumentWithEditor(page, 'foreign-deck.html');

    await page.keyboard.press('o');
    await page.waitForFunction(() =>
      document.querySelectorAll('#wfp-editor-root .wfpe-overview-thumb').length === 4
    );
    await page.locator(
      '#wfp-editor-root .wfpe-overview-thumb[data-wfp-edit-slide-index="2"]',
    ).click();
    await expect(page.locator('#foreign-slide-3')).toHaveClass(/active/);
    await expect(page.locator('.slide-count')).toHaveText('3 / 4');

    await page.keyboard.press('ArrowRight');
    await expect(page.locator('#foreign-slide-4')).toHaveClass(/active/);
    await expect(page.locator('.slide-count')).toHaveText('4 / 4');
  });

  test('foreign counter follows overview insert and editor-owned arrow navigation', async ({ page }) => {
    await loadDocumentWithEditor(page, 'foreign-deck.html');

    await page.evaluate(() => {
      const unrelatedStatus = document.createElement('div');
      unrelatedStatus.dataset.testid = 'unrelated-host-status';
      unrelatedStatus.textContent = '1 / 4';
      document.body.appendChild(unrelatedStatus);
    });

    await page.keyboard.press('o');
    await page.waitForFunction(() =>
      document.querySelectorAll('#wfp-editor-root .wfpe-overview-thumb').length === 4
    );
    await page.locator(
      '#wfp-editor-root .wfpe-overview-add[data-wfp-edit-insert-index="4"]',
    ).click();
    await expect(page.locator('#foreign-presentation > .slide')).toHaveCount(5);

    await page.keyboard.press('o');
    await expect(page.locator('.slide-count')).toHaveText('1 / 5');

    await page.keyboard.press('ArrowRight');
    await expect(page.locator('#foreign-slide-2')).toHaveClass(/active/);
    await expect(page.locator('.slide-count')).toHaveText('2 / 5');
    await expect(page.getByTestId('unrelated-host-status')).toHaveText('1 / 4');
  });

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
