import { test, expect } from '@playwright/test';
import { EDITOR_PATH } from './_helpers.js';

// Edit mode no longer confiscates the deck's navigation keys outright.
// ArrowLeft / ArrowRight / Space belong to the deck unless the editor
// actually has something bound to them: Overview mode, a live selection,
// or an open text edit. See feature-briefs/edit-mode-slide-navigation.md.

async function loadForeignDeck(page) {
  await page.goto('/fixtures/foreign-deck.html', { timeout: 30_000 });
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
    src.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
    tgt.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: x, clientY: y }));
    tgt.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: x, clientY: y }));
    src.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: dt }));
  }, { srcIdx: sourceIdx, tgtIdx: targetIdx, pos: position });
}

test.describe('Edit mode + no selection — navigation keys reach the deck', () => {
  test('ArrowRight advances the slide with edit mode on and nothing selected', async ({ page }) => {
    await loadForeignDeck(page);
    await page.keyboard.press('e');
    await expect(page.locator('#wfp-editor-root .wfpe-toolbar')).toHaveAttribute('data-mode', 'on');

    await page.keyboard.press('ArrowRight');

    await expect(page.locator('#foreign-slide-2')).toHaveClass(/active/);
    await expect(page.locator('.slide-count')).toHaveText('2 / 4');
    // Navigating must not knock the editor out of edit mode.
    await expect(page.locator('#wfp-editor-root .wfpe-toolbar')).toHaveAttribute('data-mode', 'on');
  });

  test('ArrowLeft goes back a slide with edit mode on and nothing selected', async ({ page }) => {
    await loadForeignDeck(page);
    await page.keyboard.press('e');
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('#foreign-slide-2')).toHaveClass(/active/);

    await page.keyboard.press('ArrowLeft');

    await expect(page.locator('#foreign-slide-1')).toHaveClass(/active/);
    await expect(page.locator('.slide-count')).toHaveText('1 / 4');
  });

  test('Space advances the slide with edit mode on and nothing selected', async ({ page }) => {
    await loadForeignDeck(page);
    await page.keyboard.press('e');

    await page.keyboard.press(' ');

    await expect(page.locator('#foreign-slide-2')).toHaveClass(/active/);
    await expect(page.locator('.slide-count')).toHaveText('2 / 4');
  });

  test('deselecting an element hands the navigation keys back', async ({ page }) => {
    await loadForeignDeck(page);
    await page.keyboard.press('e');
    await page.locator('.slide.active [data-testid="foreign-card"]').click();
    await expect(page.locator('#wfp-editor-root .wfpe-inspector')).toHaveAttribute('data-visible', 'true');

    // Click empty slide background to clear the selection.
    await page.mouse.click(20, 20);
    await expect(page.locator('#wfp-editor-root .wfpe-inspector')).toHaveAttribute('data-visible', 'false');

    await page.keyboard.press('ArrowRight');
    await expect(page.locator('#foreign-slide-2')).toHaveClass(/active/);
  });

  test('Space after clicking the Edit button navigates without toggling edit mode off', async ({ page }) => {
    await loadForeignDeck(page);
    // Mouse-first flow: the clicked button keeps focus, so Space's native
    // default action would activate it a second time.
    await page.locator('#wfp-editor-root button[data-action="edit"]').click();
    const toolbar = page.locator('#wfp-editor-root .wfpe-toolbar');
    await expect(toolbar).toHaveAttribute('data-mode', 'on');

    await page.keyboard.press(' ');

    await expect(page.locator('#foreign-slide-2')).toHaveClass(/active/);
    await expect(toolbar).toHaveAttribute('data-mode', 'on');
  });

  test('an element on the newly active slide selects cleanly after navigating', async ({ page }) => {
    await loadForeignDeck(page);
    await page.keyboard.press('e');
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('#foreign-slide-2')).toHaveClass(/active/);

    // The slide-class observer is what keeps editor state honest across a
    // host-driven navigation: selection on the new slide must bind normally.
    const heading = page.locator('#foreign-slide-2 .foreign-title').first();
    await heading.click();
    await expect(page.locator('#wfp-editor-root .wfpe-inspector')).toHaveAttribute('data-visible', 'true');
    await expect(page.locator('#wfp-editor-root .wfpe-selection-ring')).toHaveCSS('display', 'block');
    const boundToNewSlide = await page.evaluate(() => {
      const ring = document.querySelector('#wfp-editor-root .wfpe-selection-ring').getBoundingClientRect();
      const target = document.querySelector('#foreign-slide-2 .foreign-title').getBoundingClientRect();
      return Math.abs(ring.top - target.top) < 4 && Math.abs(ring.left - target.left) < 4;
    });
    expect(boundToNewSlide).toBe(true);
  });

  test('a multi-selection blocks the navigation keys too', async ({ page }) => {
    await loadForeignDeck(page);
    await page.keyboard.press('e');
    await page.locator('.slide.active [data-testid="foreign-card"]').click();
    await page.locator('.slide.active [data-testid="resize-target"]').click({ modifiers: ['ControlOrMeta'] });
    const multi = await page.evaluate(() => ({
      boxDisplay: document.querySelector('#wfp-editor-root .wfpe-multi-box').style.display,
      outlines: document.querySelectorAll('#wfp-editor-root .wfpe-multi-outline').length,
    }));
    expect(multi.boxDisplay).toBe('block');
    expect(multi.outlines).toBeGreaterThan(1);

    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(150);

    await expect(page.locator('#foreign-slide-1')).toHaveClass(/active/);
    await expect(page.locator('.slide-count')).toHaveText('1 / 4');
  });

  test('navigation follows live DOM order after an Overview reorder', async ({ page }) => {
    await loadForeignDeck(page);
    await page.keyboard.press('o');
    await page.waitForFunction(() =>
      document.querySelectorAll('#wfp-editor-root .wfpe-overview-thumb').length === 4
    );

    await simulateOverviewDragDrop(page, 0, 2, 'after');
    await expect.poll(() => page.evaluate(() =>
      [...document.querySelectorAll('#foreign-presentation > .slide')].map((slide) => slide.id)
    )).toEqual(['foreign-slide-2', 'foreign-slide-3', 'foreign-slide-1', 'foreign-slide-4']);

    await page.keyboard.press('o');
    await expect(page.locator('.slide.active')).toHaveAttribute('id', 'foreign-slide-1');

    // Edit mode on, nothing selected: the editor-owned fresh-DOM path runs,
    // not the host deck's stale cached cursor.
    await page.keyboard.press('e');
    await expect(page.locator('#wfp-editor-root .wfpe-toolbar')).toHaveAttribute('data-mode', 'on');
    await page.keyboard.press('ArrowRight');

    await expect(page.locator('.slide.active')).toHaveAttribute('id', 'foreign-slide-4');
  });
});

test.describe('Flat documents', () => {
  test('Space scrolls a flat document with edit mode on and nothing selected', async ({ page }) => {
    await page.goto('/fixtures/flat-document.html', { timeout: 30_000 });
    await page.addScriptTag({ path: EDITOR_PATH });
    await page.waitForFunction(() => window.__wfpEditorReady === true, null, { timeout: 10_000 });
    await page.keyboard.press('e');
    expect(await page.evaluate(() => window.scrollY)).toBe(0);

    // A flat document has no slides to navigate; the same rule hands Space
    // back to its normal meaning, which here is page scroll.
    await page.keyboard.press(' ');
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
  });

  test('a selected element still keeps Space from scrolling a flat document', async ({ page }) => {
    await page.goto('/fixtures/flat-document.html', { timeout: 30_000 });
    await page.addScriptTag({ path: EDITOR_PATH });
    await page.waitForFunction(() => window.__wfpEditorReady === true, null, { timeout: 10_000 });
    await page.keyboard.press('e');
    await page.locator('#flat-article h1, #flat-article h2').first().click();
    await expect(page.locator('#wfp-editor-root .wfpe-inspector')).toHaveAttribute('data-visible', 'true');

    await page.keyboard.press(' ');
    await page.waitForTimeout(200);

    expect(await page.evaluate(() => window.scrollY)).toBe(0);
  });
});

test.describe('Editor-owned states still keep the navigation keys', () => {
  test('a selected element blocks ArrowRight and survives the press', async ({ page }) => {
    await loadForeignDeck(page);
    await page.keyboard.press('e');
    const card = page.locator('.slide.active [data-testid="foreign-card"]');
    await card.click();
    await expect(page.locator('#wfp-editor-root .wfpe-inspector')).toHaveAttribute('data-visible', 'true');

    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(150);

    await expect(page.locator('#foreign-slide-1')).toHaveClass(/active/);
    await expect(page.locator('.slide-count')).toHaveText('1 / 4');
    await expect(page.locator('#wfp-editor-root .wfpe-inspector')).toHaveAttribute('data-visible', 'true');
  });

  test('an open text edit keeps arrows for the caret', async ({ page }) => {
    await loadForeignDeck(page);
    await page.keyboard.press('e');
    await page.locator('.slide.active .foreign-title').first().dblclick();
    await expect(page.locator('.slide.active .foreign-title').first())
      .toHaveAttribute('contenteditable', 'true');

    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(150);

    await expect(page.locator('#foreign-slide-1')).toHaveClass(/active/);
    await expect(page.locator('.slide.active .foreign-title').first())
      .toHaveAttribute('contenteditable', 'true');
  });

  test('an open export menu keeps the deck from moving behind it', async ({ page }) => {
    await loadForeignDeck(page);
    await page.keyboard.press('e');
    await page.locator('#wfp-editor-root button[data-action="export"]').click();
    await expect(page.locator('#wfp-editor-root .wfpe-export-dock')).toHaveAttribute('data-visible', 'true');

    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(150);

    await expect(page.locator('#foreign-slide-1')).toHaveClass(/active/);
    await expect(page.locator('.slide-count')).toHaveText('1 / 4');
  });

  test('Overview mode still swallows the navigation keys', async ({ page }) => {
    await loadForeignDeck(page);
    await page.keyboard.press('o');
    await page.waitForFunction(() =>
      document.querySelectorAll('#wfp-editor-root .wfpe-overview-thumb').length === 4
    );

    await page.keyboard.press('ArrowRight');
    await page.keyboard.press(' ');
    await page.waitForTimeout(150);

    await expect(page.locator('#foreign-slide-1')).toHaveClass(/active/);
    await expect(page.locator('.slide-count')).toHaveText('1 / 4');
  });
});
