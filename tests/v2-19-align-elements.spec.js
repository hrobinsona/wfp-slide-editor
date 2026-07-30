// v2.19 — Align Elements: with 2+ elements selected, an Align row in the
// multi-mode inspector surface (six buttons: left/center-h/right/top/
// middle-v/bottom) moves every member relative to the SELECTION BOUNDING
// BOX (union of member rects) — standard design-tool alignment semantics.
// Movement is a positional move exactly like drag: flow members are
// unlocked to absolute through the SAME path drag uses (unlockToAbsolute,
// which also pins flex/grid siblings so the promotion doesn't reflow),
// viewport-space deltas are divided by getCanvasScale() before any style
// write, and one click is one txn / one history entry covering every moved
// member plus any unlock side-effects.
//
// Load pattern follows tests/v2-18-multi-select-inspector.spec.js and
// tests/v2-17-bring-to-front.spec.js.
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { EDITOR_PATH, disableFsa, EDITOR_MARKER_ATTR_RE } from './_helpers.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = path.join(__dirname, 'output');

const ROOT = '#wfp-editor-root';
const DOCK = `${ROOT} .wfpe-inspector-dock`;
const ALIGN_ROW = `${ROOT} [data-wfpe-row="align-elements"]`;
const alignBtn = (mode) => `${ROOT} [data-align="${mode}"]`;

async function loadDocumentWithEditor(page, fixtureName) {
  await disableFsa(page);
  await page.goto(`/fixtures/${fixtureName}`, { timeout: 30_000 });
  await page.addScriptTag({ path: EDITOR_PATH });
  await page.waitForFunction(() => window.__wfpEditorReady === true, null, { timeout: 10_000 });
}

// Three direct, absolutely-positioned children of the active slide with
// distinct rects — the standard multi-member set for alignment assertions.
async function selectThreeAbsoluteMembers(page) {
  await page.locator('.slide.active .foreign-card').click();
  await page.locator('.slide.active .foreign-title').click({ modifiers: ['ControlOrMeta'] });
  await page.locator('.slide.active .resize-target').click({ modifiers: ['ControlOrMeta'] });
}

function rectOf(page, selector) {
  return page.evaluate((sel) => {
    const r = document.querySelector(sel).getBoundingClientRect();
    return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
  }, selector);
}

function threeRects(page) {
  return page.evaluate(() => {
    const read = (sel) => {
      const r = document.querySelector(`.slide.active ${sel}`).getBoundingClientRect();
      return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
    };
    return { card: read('.foreign-card'), title: read('.foreign-title'), target: read('.resize-target') };
  });
}

function threeStyles(page) {
  return page.evaluate(() => ({
    card: document.querySelector('.slide.active .foreign-card').getAttribute('style'),
    title: document.querySelector('.slide.active .foreign-title').getAttribute('style'),
    target: document.querySelector('.slide.active .resize-target').getAttribute('style'),
  }));
}

test.describe('v2.19 — Align elements', () => {
  test('the Align row is hidden for a single selection and shows six buttons for a multi-selection', async ({ page }) => {
    await loadDocumentWithEditor(page, 'foreign-deck.html');
    await page.keyboard.press('e');

    await page.locator('.slide.active .foreign-title').click();
    await expect(page.locator(DOCK)).toHaveAttribute('data-multi', 'false');
    await expect(page.locator(ALIGN_ROW)).not.toBeVisible();

    await page.locator('.slide.active .resize-target').click({ modifiers: ['ControlOrMeta'] });
    await expect(page.locator(DOCK)).toHaveAttribute('data-multi', 'true');
    await expect(page.locator(ALIGN_ROW)).toBeVisible();

    for (const mode of ['left', 'center-h', 'right', 'top', 'middle-v', 'bottom']) {
      await expect(page.locator(alignBtn(mode))).toBeVisible();
    }
  });

  test('Align Left moves every member\'s left edge to the selection bbox left; tops stay put', async ({ page }) => {
    await loadDocumentWithEditor(page, 'foreign-deck.html');
    await page.keyboard.press('e');
    await selectThreeAbsoluteMembers(page);

    const before = await threeRects(page);
    const bboxLeft = Math.min(before.card.left, before.title.left, before.target.left);

    await page.locator(alignBtn('left')).click();

    const after = await threeRects(page);
    for (const key of ['card', 'title', 'target']) {
      expect(after[key].left).toBeCloseTo(bboxLeft, 0);
      expect(after[key].top).toBeCloseTo(before[key].top, 0);
    }
  });

  test('Align Center-H centers every member on the bbox midline', async ({ page }) => {
    await loadDocumentWithEditor(page, 'foreign-deck.html');
    await page.keyboard.press('e');
    await selectThreeAbsoluteMembers(page);

    await page.locator(alignBtn('center-h')).click();

    const after = await threeRects(page);
    const centers = ['card', 'title', 'target'].map((k) => (after[k].left + after[k].right) / 2);
    for (const c of centers) expect(c).toBeCloseTo(centers[0], 0);
  });

  test('Align Bottom lands every member\'s bottom edge flush', async ({ page }) => {
    await loadDocumentWithEditor(page, 'foreign-deck.html');
    await page.keyboard.press('e');
    await selectThreeAbsoluteMembers(page);

    await page.locator(alignBtn('bottom')).click();

    const after = await threeRects(page);
    const bottoms = ['card', 'title', 'target'].map((k) => after[k].bottom);
    for (const b of bottoms) expect(b).toBeCloseTo(bottoms[0], 0);
  });

  test('a flow-positioned member is unlocked to absolute (same path drag uses), aligns exactly, does not shift an unselected sibling, and undo restores flow + unpins it', async ({ page }) => {
    await loadDocumentWithEditor(page, 'foreign-deck.html');
    await page.keyboard.press('e');

    const chip0 = page.locator('.slide.active .chip-row .chip').nth(0);
    const chip1 = page.locator('.slide.active .chip-row .chip').nth(1);
    const chip2 = page.locator('.slide.active .chip-row .chip').nth(2); // stays unselected

    expect(await chip0.evaluate((el) => getComputedStyle(el).position)).toBe('static');
    const chip2RectBefore = await chip2.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return { left: r.left, top: r.top, width: r.width, height: r.height };
    });
    const rowStyleBefore = await page.evaluate(
      () => document.querySelector('.slide.active .chip-row').getAttribute('style'),
    );
    const chip0StyleBefore = await chip0.evaluate((el) => el.getAttribute('style'));

    await chip0.click();
    await chip1.click({ modifiers: ['ControlOrMeta'] });
    await page.locator('.slide.active .resize-target').click({ modifiers: ['ControlOrMeta'] });

    await page.locator(alignBtn('left')).click();

    expect(await chip0.evaluate((el) => getComputedStyle(el).position)).toBe('absolute');
    expect(await chip1.evaluate((el) => getComputedStyle(el).position)).toBe('absolute');

    // Exact alignment (not just "close"): the unlock path's own integer-
    // offset pinning must not leave a residual the no-op guard then hides
    // from a corrective second click — every left edge matches within the
    // same 0.5 slide-px contract the brief sets for the already-absolute
    // case (code review follow-up on the initial cut of this test).
    const lefts = await page.evaluate(() => ({
      target: document.querySelector('.slide.active .resize-target').getBoundingClientRect().left,
      chip0: document.querySelectorAll('.slide.active .chip-row .chip')[0].getBoundingClientRect().left,
      chip1: document.querySelectorAll('.slide.active .chip-row .chip')[1].getBoundingClientRect().left,
    }));
    expect(Math.abs(lefts.chip0 - lefts.target)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(lefts.chip1 - lefts.target)).toBeLessThanOrEqual(0.5);

    // The unselected third chip is only a MECHANICAL pin (its container was
    // frozen so its selected siblings could be promoted) — not a deliberate
    // edit. Its visual rect must be pixel-stable across the whole gesture,
    // mirroring the flex-freeze guarantee tests/04b-flex-freeze.spec.js
    // checks for drag.
    const chip2RectAfter = await chip2.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return { left: r.left, top: r.top, width: r.width, height: r.height };
    });
    expect(chip2RectAfter.left).toBeCloseTo(chip2RectBefore.left, 0);
    expect(chip2RectAfter.top).toBeCloseTo(chip2RectBefore.top, 0);
    expect(chip2RectAfter.width).toBeCloseTo(chip2RectBefore.width, 0);
    expect(chip2RectAfter.height).toBeCloseTo(chip2RectBefore.height, 0);

    // Brief item 5: one undo restores every member's rect AND any unlock
    // side-effects — the flow member returns to flow (position: static)
    // and the container's flex-freeze pin/markers are gone, not just the
    // already-absolute members' left/top.
    await page.keyboard.press('ControlOrMeta+z');
    expect(await chip0.evaluate((el) => getComputedStyle(el).position)).toBe('static');
    expect(await chip1.evaluate((el) => getComputedStyle(el).position)).toBe('static');
    expect(await chip0.evaluate((el) => el.getAttribute('style'))).toBe(chip0StyleBefore);
    expect(await page.evaluate(
      () => document.querySelector('.slide.active .chip-row').getAttribute('style'),
    )).toBe(rowStyleBefore);
    expect(await page.evaluate(
      () => document.querySelectorAll('.slide.active [data-wfp-edit-flex-frozen="true"]').length,
    )).toBe(0);
  });

  test('scaled deck: Align Right lands every right edge flush in viewport space', async ({ page }) => {
    await loadDocumentWithEditor(page, 'foreign-deck.html');
    // foreign-deck.html has no .deck wrapper (it's a "foreign" doc, resolved
    // via resolveForeignDeckRoot to .presentation) and so no scale transform
    // by default — inject one in-page after the editor marks its resolved
    // root, per the brief's "also cover the scaled case".
    await page.evaluate(() => {
      document.querySelector('[data-wfp-edit-deck-root="true"]').style.transform = 'scale(0.8)';
    });
    await page.keyboard.press('e');
    await selectThreeAbsoluteMembers(page);

    await page.locator(alignBtn('right')).click();

    const after = await threeRects(page);
    const rights = ['card', 'title', 'target'].map((k) => after[k].right);
    for (const r of rights) expect(Math.abs(r - rights[0])).toBeLessThanOrEqual(1);
  });

  test('one click is one history entry: a single undo restores every member, redo re-aligns, selection survives', async ({ page }) => {
    await loadDocumentWithEditor(page, 'foreign-deck.html');
    await page.keyboard.press('e');
    await selectThreeAbsoluteMembers(page);

    const before = await threeStyles(page);
    await page.locator(alignBtn('top')).click();
    const after = await threeStyles(page);
    expect(after).not.toEqual(before);

    await page.keyboard.press('ControlOrMeta+z');
    expect(await threeStyles(page)).toEqual(before);
    // Selection must survive undo — no detached DOM (CLAUDE.md gotcha).
    await expect(page.locator(DOCK)).toHaveAttribute('data-multi', 'true');

    await page.keyboard.press('ControlOrMeta+Shift+z');
    expect(await threeStyles(page)).toEqual(after);
    await expect(page.locator(DOCK)).toHaveAttribute('data-multi', 'true');
  });

  test('a second identical click is a no-op — one undo fully restores the pre-click state', async ({ page }) => {
    await loadDocumentWithEditor(page, 'foreign-deck.html');
    await page.keyboard.press('e');
    await selectThreeAbsoluteMembers(page);

    const before = await threeStyles(page);
    await page.locator(alignBtn('left')).click();
    const afterFirst = await threeStyles(page);
    expect(afterFirst).not.toEqual(before);

    await page.locator(alignBtn('left')).click();
    const afterSecond = await threeStyles(page);
    expect(afterSecond).toEqual(afterFirst);

    // One undo unwinds exactly the first click — proof the second pushed
    // no history entry.
    await page.keyboard.press('ControlOrMeta+z');
    expect(await threeStyles(page)).toEqual(before);
  });

  test('export after align is clean and keeps the written positions', async ({ page, context }) => {
    await loadDocumentWithEditor(page, 'foreign-deck.html');
    await page.keyboard.press('e');
    await selectThreeAbsoluteMembers(page);
    await page.locator(alignBtn('top')).click();

    const liveStyles = await threeStyles(page);

    const downloadPromise = page.waitForEvent('download', { timeout: 8_000 });
    await page.keyboard.press('ControlOrMeta+s');
    const download = await downloadPromise;
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    const outPath = path.join(
      OUTPUT_DIR,
      `${Date.now()}-${Math.random().toString(16).slice(2)}-${download.suggestedFilename()}`,
    );
    await download.saveAs(outPath);
    const html = fs.readFileSync(outPath, 'utf-8');

    expect(html).not.toMatch(EDITOR_MARKER_ATTR_RE);
    expect(html).not.toContain('contenteditable');
    expect(html).not.toContain('id="wfp-editor-root"');

    const exportedPage = await context.newPage();
    await exportedPage.goto(pathToFileURL(outPath).href);
    // Exported doc has no .slide.active bookkeeping script re-run yet at
    // this point (module code runs on load and re-marks slide 1 active
    // regardless), so plain class selectors resolve to the first (still
    // slide-1) matches — same convention as v2-18's export test.
    const exportedStyles = await exportedPage.evaluate(() => ({
      card: document.querySelector('.foreign-card').getAttribute('style'),
      title: document.querySelector('.foreign-title').getAttribute('style'),
      target: document.querySelector('.resize-target').getAttribute('style'),
    }));
    expect(exportedStyles).toEqual(liveStyles);
    await exportedPage.close();
  });
});
