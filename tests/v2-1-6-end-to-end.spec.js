import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadFixtureWithEditor, pickRandomRotationFixture, PINNED_PRIMARIES } from './_helpers.js';

// v2.1.6 — End-to-end pass for the v2.1 Overview release.
//
// Per feature-briefs/v2-overview.md: "Run on both fixtures (Townhall-1.html and
// boilerplate.html). All v1 done criteria still pass. All v2.0 inspector
// tests still pass. v2.1 spec passes."
//
// The full v1 suite + v2.0 inspector suite + v2.1 feature specs run on
// every CI invocation; this spec pins the v2.1 feature contract end-to-
// end across BOTH pinned primaries plus one randomly chosen rotation
// fixture, mirroring the v2.0 cadence in v2-8-end-to-end.spec.js. If a
// fixture-specific quirk breaks Overview, this spec catches it.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = path.join(__dirname, 'output');

const ROTATION = pickRandomRotationFixture();
const FIXTURES = [...PINNED_PRIMARIES, ROTATION];

console.log(`[v2.1.6] rotation fixture this run: ${ROTATION}`);

async function triggerExport(page) {
  const dl = page.waitForEvent('download', { timeout: 8_000 });
  await page.keyboard.press('ControlOrMeta+s');
  return dl;
}

async function readDownloadAsString(download) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const out = path.join(OUTPUT_DIR, download.suggestedFilename());
  await download.saveAs(out);
  return fs.readFileSync(out, 'utf-8');
}

async function getSlideOrder(page) {
  return page.evaluate(() =>
    [...document.querySelectorAll('.deck > .slide')].map((s) => s.id || `_unnamed_${[...document.querySelectorAll('.deck > .slide')].indexOf(s)}`)
  );
}

async function dispatchOverlayDrag(page, srcIdx, tgtIdx, position = 'before') {
  return page.evaluate(({ srcIdx, tgtIdx, pos }) => {
    const thumbs = document.querySelectorAll('#wfp-editor-root .wfpe-overview-thumb');
    const src = thumbs[srcIdx];
    const tgt = thumbs[tgtIdx];
    if (!src || !tgt) throw new Error(`thumbs missing src=${!!src} tgt=${!!tgt}`);
    const tgtRect = tgt.getBoundingClientRect();
    const x = pos === 'before' ? tgtRect.left + 4 : tgtRect.right - 4;
    const y = tgtRect.top + tgtRect.height / 2;
    const dt = new DataTransfer();
    src.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt }));
    tgt.dispatchEvent(new DragEvent('dragenter', { bubbles: true, cancelable: true, clientX: x, clientY: y, dataTransfer: dt }));
    tgt.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, clientX: x, clientY: y, dataTransfer: dt }));
    tgt.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, clientX: x, clientY: y, dataTransfer: dt }));
    src.dispatchEvent(new DragEvent('dragend', { bubbles: true, cancelable: true, dataTransfer: dt }));
  }, { srcIdx, tgtIdx, pos: position });
}

// Wide viewport so all overview thumbs are reachable for hover/click.
test.use({ viewport: { width: 1920, height: 1080 } });

for (const fixture of FIXTURES) {
  test.describe(`v2.1.6 — Overview end-to-end on ${fixture}`, () => {
    test.beforeEach(async ({ page }) => {
      await loadFixtureWithEditor(page, fixture);
      // Lock deck scale to 1 so coordinate-dependent assertions (drag
      // thumb math, getBoundingClientRect comparisons) match the
      // unscaled slide coordinate system.
      await page.evaluate(() => {
        document.querySelector('.deck').style.transform = 'scale(1)';
      });
    });

    test('overview activates and renders a 4-column grid with one thumb per slide', async ({ page }) => {
      const slideCount = await page.locator('.deck > .slide').count();
      expect(slideCount).toBeGreaterThan(0);

      await page.keyboard.press('o');
      await page.waitForFunction(() =>
        document.querySelectorAll('#wfp-editor-root .wfpe-overview-thumb').length > 0
      );

      const state = await page.evaluate(() => {
        const deck = document.querySelector('.deck');
        const cs = getComputedStyle(deck);
        return {
          bodyAttr: document.body.getAttribute('data-wfp-edit-overview'),
          deckDisplay: cs.display,
          gridColCount: cs.gridTemplateColumns.split(' ').filter(Boolean).length,
          thumbCount: document.querySelectorAll('#wfp-editor-root .wfpe-overview-thumb').length,
          badgeText: [...document.querySelectorAll('#wfp-editor-root .wfpe-overview-badge')]
            .map((b) => b.textContent),
        };
      });
      expect(state.bodyAttr).toBe('on');
      expect(state.deckDisplay).toBe('grid');
      expect(state.gridColCount).toBe(4);
      expect(state.thumbCount).toBe(slideCount);
      expect(state.badgeText).toEqual(state.badgeText.map((_, i) => String(i + 1)));
    });

    test('clicking a thumb navigates to that slide and exits overview', async ({ page }) => {
      const slideCount = await page.locator('.deck > .slide').count();
      // Pick an inside-the-grid slide that's not slide 0 (which is
      // typically already active).
      const targetIdx = Math.min(2, slideCount - 1);
      const targetId = (await getSlideOrder(page))[targetIdx];

      await page.keyboard.press('o');
      await page.waitForFunction(() =>
        document.querySelectorAll('#wfp-editor-root .wfpe-overview-thumb').length > 0
      );

      const thumb = page.locator('#wfp-editor-root .wfpe-overview-thumb').nth(targetIdx);
      await thumb.scrollIntoViewIfNeeded();
      await thumb.click({ force: true });

      const after = await page.evaluate(() => ({
        bodyAttr: document.body.getAttribute('data-wfp-edit-overview'),
        activeIds: [...document.querySelectorAll('.slide.active')].map((s) => s.id),
      }));
      expect(after.bodyAttr).toBe(null);
      expect(after.activeIds.length).toBe(1);
      // The active slide should be the one we clicked (its id may or
      // may not be present depending on the fixture, but it should be
      // the slide at our target position).
      const finalActiveIdx = await page.evaluate(() => {
        const slides = [...document.querySelectorAll('.deck > .slide')];
        return slides.findIndex((s) => s.classList.contains('active'));
      });
      expect(finalActiveIdx).toBe(targetIdx);
      // If the slide had an id, it should match.
      if (targetId && !targetId.startsWith('_unnamed_')) {
        expect(after.activeIds[0]).toBe(targetId);
      }
    });

    test('drag-to-reorder + Cmd+Z restores the original order', async ({ page }) => {
      const slideCount = await page.locator('.deck > .slide').count();
      test.skip(slideCount < 3, `${fixture} has fewer than 3 slides; reorder is moot`);

      await page.keyboard.press('o');
      await page.waitForFunction(() =>
        document.querySelectorAll('#wfp-editor-root .wfpe-overview-thumb').length > 0
      );

      const original = await getSlideOrder(page);
      // Move slide at idx 2 to position 0.
      await dispatchOverlayDrag(page, 2, 0, 'before');
      const reordered = await getSlideOrder(page);
      expect(reordered).not.toEqual(original);
      expect(reordered[0]).toBe(original[2]);

      await page.keyboard.press('Meta+z');
      const restored = await getSlideOrder(page);
      expect(restored).toEqual(original);
    });

    test('delete removes a slide; Cmd+Z restores it; export reflects the live order', async ({ page }) => {
      const slideCount = await page.locator('.deck > .slide').count();
      test.skip(slideCount < 3, `${fixture} has fewer than 3 slides; delete edge cases are moot`);

      const original = await getSlideOrder(page);
      const targetIdx = 2;
      const targetId = original[targetIdx];

      await page.keyboard.press('o');
      await page.waitForFunction(() =>
        document.querySelectorAll('#wfp-editor-root .wfpe-overview-thumb').length > 0
      );

      // Delete via keyboard so we don't depend on toolbar overlap geometry.
      const thumb = page.locator('#wfp-editor-root .wfpe-overview-thumb').nth(targetIdx);
      await thumb.scrollIntoViewIfNeeded();
      await thumb.hover();
      await page.keyboard.press('Backspace');

      const afterDelete = await getSlideOrder(page);
      expect(afterDelete.length).toBe(original.length - 1);
      if (targetId && !targetId.startsWith('_unnamed_')) {
        expect(afterDelete).not.toContain(targetId);
      }

      // Export — should reflect the deleted state.
      const dl1 = await triggerExport(page);
      const html1 = await readDownloadAsString(dl1);
      // No editor chrome leaks.
      expect(html1).not.toContain('id="wfp-editor-root"');
      expect(html1).not.toMatch(/data-wfp-edit/);
      // No overview chrome leaks.
      expect(html1).not.toContain('wfpe-overview');
      // Slide count in exported HTML matches live (post-delete) count.
      const exportedSlideCount = (html1.match(/<div\s+class="slide(?:\s+[^"]*)?"/g) || []).length;
      expect(exportedSlideCount).toBe(afterDelete.length);

      // Undo restores the slide.
      await page.keyboard.press('Meta+z');
      const restored = await getSlideOrder(page);
      expect(restored).toEqual(original);
    });

    test('last-slide guard prevents deleting the only remaining slide and shows the toast', async ({ page }) => {
      // Trim the deck to a single slide before entering overview.
      await page.evaluate(() => {
        const deck = document.querySelector('.deck');
        const slides = [...deck.querySelectorAll(':scope > .slide')];
        for (let i = 1; i < slides.length; i++) deck.removeChild(slides[i]);
        slides[0].classList.add('active');
      });

      await page.keyboard.press('o');
      await page.waitForFunction(() =>
        document.querySelectorAll('#wfp-editor-root .wfpe-overview-thumb').length > 0
      );

      const thumb = page.locator('#wfp-editor-root .wfpe-overview-thumb').first();
      await thumb.scrollIntoViewIfNeeded();
      await thumb.hover();
      await page.keyboard.press('Backspace');

      const after = await page.locator('.deck > .slide').count();
      expect(after).toBe(1);
      const toast = await page.locator('#wfp-editor-root .wfpe-toast').textContent();
      expect(toast).toBe("Can't delete the last slide.");
    });

    test('v1 selection + font-size keyboard nudge still works after toggling overview on/off', async ({ page }) => {
      // Sanity that v2.1 didn't regress the v1 contract on a fixture-
      // by-fixture basis. Toggle overview on and off, then run an edit-
      // mode interaction.
      await page.keyboard.press('o');
      await page.waitForFunction(() => document.body.dataset.wfpEditOverview === 'on');
      await page.keyboard.press('o');
      await page.waitForFunction(() => !document.body.hasAttribute('data-wfp-edit-overview'));

      await page.keyboard.press('e');
      // Find a text-bearing element on the active slide.
      const target = page.locator('.slide.active h1, .slide.active h2, .slide.active p').first();
      const initialPx = await target.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
      await target.click({ force: true });
      await page.keyboard.press('ArrowUp');
      const nudged = await target.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
      expect(nudged).toBe(initialPx + 1);
    });
  });
}
