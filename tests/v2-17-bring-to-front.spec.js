// v2.17 — Bring to Front: a Front action in the inspector action row that
// bumps the selected element's z-index above every sibling in its stacking
// scope (parentElement's element children). One-way only (no send-to-back).
// Static elements get position: relative first since z-index is inert on
// position: static (no layout shift — no offsets are written).
//
// Load pattern follows tests/v2-15-unlock-hardening.spec.js.
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { EDITOR_PATH, disableFsa } from './_helpers.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = path.join(__dirname, 'output');

const ROOT = '#wfp-editor-root';
const FRONT_BTN = `${ROOT} .wfpe-inspector .wfpe-front-btn`;

async function loadDocumentWithEditor(page, fixtureName) {
  await disableFsa(page);
  await page.goto(`/fixtures/${fixtureName}`, { timeout: 30_000 });
  await page.addScriptTag({ path: EDITOR_PATH });
  await page.waitForFunction(() => window.__wfpEditorReady === true, null, { timeout: 10_000 });
}

function effectiveZ(page, selector) {
  return page.evaluate(
    (sel) => parseInt(getComputedStyle(document.querySelector(sel)).zIndex, 10) || 0,
    selector,
  );
}

test.describe('v2.17 — Front (bring to front)', () => {
  test('raises the selected element above an overlapping sibling', async ({ page }) => {
    await loadDocumentWithEditor(page, 'foreign-deck.html');
    await page.keyboard.press('e');

    // Select the card FIRST — before it gets covered — then move the later
    // (in DOM) resize-target directly on top of it. Both are absolutely-
    // positioned direct children of .slide.active, so resize-target's later
    // DOM position wins the z:auto tie and paints over the card.
    await page.locator('.slide.active .foreign-card').click();
    await expect(page.locator(`${ROOT} .wfpe-inspector`)).toHaveAttribute('data-visible', 'true');

    const overlapPoint = await page.evaluate(() => {
      const card = document.querySelector('.slide.active .foreign-card');
      const target = document.querySelector('.slide.active .resize-target');
      target.style.left = `${card.offsetLeft}px`;
      target.style.top = `${card.offsetTop}px`;
      const r = target.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });

    // Sanity: before any Front click, the later sibling wins the tie.
    expect(await page.evaluate(
      (pt) => document.elementFromPoint(pt.x, pt.y)?.closest('.resize-target') != null,
      overlapPoint,
    )).toBe(true);

    await page.locator(FRONT_BTN).click();

    expect(await page.evaluate(
      (pt) => document.elementFromPoint(pt.x, pt.y)?.closest('.foreign-card') != null,
      overlapPoint,
    )).toBe(true);

    const cardZ = await effectiveZ(page, '.slide.active .foreign-card');
    const targetZ = await effectiveZ(page, '.slide.active .resize-target');
    expect(cardZ).toBeGreaterThan(targetZ);
  });

  test('a static sibling is promoted to position: relative with no layout shift', async ({ page }) => {
    await loadDocumentWithEditor(page, 'foreign-deck.html');
    await page.keyboard.press('e');

    const chip = page.locator('.slide.active .chip-row .chip').first();
    const before = await chip.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return {
        position: getComputedStyle(el).position,
        left: r.left, top: r.top, width: r.width, height: r.height,
      };
    });
    expect(before.position).toBe('static');

    await chip.click();
    await page.locator(FRONT_BTN).click();

    const after = await chip.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return {
        position: getComputedStyle(el).position,
        inlinePosition: el.style.position,
        zIndex: getComputedStyle(el).zIndex,
        left: r.left, top: r.top, width: r.width, height: r.height,
      };
    });
    expect(after.position).toBe('relative');
    expect(after.inlinePosition).toBe('relative');
    expect(after.zIndex).not.toBe('auto');
    expect(after.left).toBeCloseTo(before.left, 0);
    expect(after.top).toBeCloseTo(before.top, 0);
    expect(after.width).toBeCloseTo(before.width, 0);
    expect(after.height).toBeCloseTo(before.height, 0);
  });

  test('a second click on an already-front element is a no-op — one undo fully restores it', async ({ page }) => {
    await loadDocumentWithEditor(page, 'foreign-deck.html');
    await page.keyboard.press('e');

    const card = page.locator('.slide.active .foreign-card');
    const before = await card.evaluate((el) => el.getAttribute('style'));

    await card.click();
    await page.locator(FRONT_BTN).click();
    const afterFirst = await card.evaluate((el) => el.getAttribute('style'));
    expect(afterFirst).not.toBe(before);
    expect(afterFirst).toContain('z-index');

    // Second click: no sibling changed in between, so this element is
    // already the sole front-most among its siblings — no-op.
    await page.locator(FRONT_BTN).click();
    const afterSecond = await card.evaluate((el) => el.getAttribute('style'));
    expect(afterSecond).toBe(afterFirst);

    // A single undo unwinds exactly the first click — proof the second
    // pushed no history entry.
    await page.keyboard.press('ControlOrMeta+z');
    expect(await card.evaluate((el) => el.getAttribute('style'))).toBe(before);
  });

  test('undo restores the pre-click style and redo reapplies the bump', async ({ page }) => {
    await loadDocumentWithEditor(page, 'foreign-deck.html');
    await page.keyboard.press('e');

    const card = page.locator('.slide.active .foreign-card');
    const before = await card.evaluate((el) => el.getAttribute('style'));

    await card.click();
    await page.locator(FRONT_BTN).click();
    const after = await card.evaluate((el) => el.getAttribute('style'));
    expect(after).toContain('z-index');

    await page.keyboard.press('ControlOrMeta+z');
    expect(await card.evaluate((el) => el.getAttribute('style'))).toBe(before);

    await page.keyboard.press('ControlOrMeta+Shift+z');
    expect(await card.evaluate((el) => el.getAttribute('style'))).toBe(after);
  });

  test('multi-select raises both above an unselected sibling and preserves their relative order', async ({ page }) => {
    await loadDocumentWithEditor(page, 'foreign-deck.html');
    await page.keyboard.press('e');

    // Select both BEFORE the overlap exists so the real clicks land cleanly.
    await page.locator('.slide.active .foreign-card').click();
    await page.locator('.slide.active .resize-target').click({ modifiers: ['ControlOrMeta'] });

    const overlapPoint = await page.evaluate(() => {
      const card = document.querySelector('.slide.active .foreign-card');
      const target = document.querySelector('.slide.active .resize-target');
      const row = document.querySelector('.slide.active .chip-row');
      target.style.left = `${card.offsetLeft}px`;
      target.style.top = `${card.offsetTop}px`;
      row.style.bottom = 'auto';
      row.style.left = `${card.offsetLeft}px`;
      row.style.top = `${card.offsetTop}px`;
      const r = row.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });

    // Sanity: the unselected row (latest in DOM) currently wins the tie.
    expect(await page.evaluate(
      (pt) => document.elementFromPoint(pt.x, pt.y)?.closest('.chip-row') != null,
      overlapPoint,
    )).toBe(true);

    // The inspector (and its action row) collapses to zero height for a
    // multi-selection, so a real pointer click would fail Playwright's
    // actionability checks against the pointer-events:none dock — dispatch
    // the click event directly instead.
    await page.locator(FRONT_BTN).dispatchEvent('click');

    const cardZ = await effectiveZ(page, '.slide.active .foreign-card');
    const targetZ = await effectiveZ(page, '.slide.active .resize-target');
    const rowZ = await effectiveZ(page, '.slide.active .chip-row');
    expect(cardZ).toBeGreaterThan(rowZ);
    expect(targetZ).toBeGreaterThan(rowZ);
    // Relative order preserved: resize-target (later in DOM, tied at auto)
    // was already on top of the card before the bump and stays on top.
    expect(targetZ).toBeGreaterThan(cardZ);

    expect(await page.evaluate(
      (pt) => document.elementFromPoint(pt.x, pt.y)?.closest('.resize-target') != null,
      overlapPoint,
    )).toBe(true);
  });

  test('exported HTML keeps the z-index style with no editor residue', async ({ page, context }) => {
    await loadDocumentWithEditor(page, 'foreign-deck.html');
    await page.keyboard.press('e');

    await page.locator('.slide.active .foreign-card').click();
    await page.locator(FRONT_BTN).click();
    const liveZ = await page.evaluate(
      () => document.querySelector('.slide.active .foreign-card').style.zIndex
    );
    expect(liveZ).not.toBe('');

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

    expect(html).not.toMatch(/data-wfp-edit[-a-zA-Z]*=/);
    expect(html).not.toContain('contenteditable');
    expect(html).not.toContain('id="wfp-editor-root"');

    const exportedPage = await context.newPage();
    await exportedPage.goto(pathToFileURL(outPath).href);
    const exportedZ = await exportedPage.evaluate(
      () => document.querySelector('.foreign-card').style.zIndex
    );
    expect(exportedZ).toBe(liveZ);
    await exportedPage.close();
  });

  // Review round — C1/W4a: the no-op guard used `===` against the planned
  // z, so an element authored ABOVE what a fresh plan would compute (e.g.
  // z-index: 30 among all-auto siblings, plan = 1) got DEMOTED to the
  // lower plan value instead of being left alone, and pushed a spurious
  // history entry. The guard must treat "already higher than required" as
  // a no-op too.
  test('an element already above its siblings is a no-op even when its z-index exceeds the plan value (C1 / W4a)', async ({ page }) => {
    await loadDocumentWithEditor(page, 'foreign-deck.html');
    await page.keyboard.press('e');

    // A real, unrelated edit first, so undo has a known entry to unwind.
    const chip = page.locator('.slide.active .chip-row .chip').first();
    const chipBefore = await chip.evaluate((el) => el.getAttribute('style'));
    await chip.click();
    await page.locator(FRONT_BTN).click();
    const chipAfterFront = await chip.evaluate((el) => el.getAttribute('style'));
    expect(chipAfterFront).not.toBe(chipBefore);

    // Author a z-index well above what a fresh plan would compute (its
    // siblings are all z: auto, so the plan would only ask for 1).
    const card = page.locator('.slide.active .foreign-card');
    await card.evaluate((el) => { el.style.zIndex = '30'; });
    const cardBefore = await card.evaluate((el) => el.getAttribute('style'));

    await card.click();
    await page.locator(FRONT_BTN).click();
    // No demotion, no spurious write.
    expect(await card.evaluate((el) => el.getAttribute('style'))).toBe(cardBefore);

    // One undo unwinds exactly the chip's earlier Front bump — proof the
    // card's no-op click pushed nothing.
    await page.keyboard.press('ControlOrMeta+z');
    expect(await chip.evaluate((el) => el.getAttribute('style'))).toBe(chipBefore);
    expect(await card.evaluate((el) => el.getAttribute('style'))).toBe(cardBefore);
  });

  // Review round — W1/W4b: siblingMaxZIndex excluded only the element
  // itself, not its co-targets, so a multi-select's OWN just-bumped z fed
  // back into the next click's base (e.g. {1,2} -> {3,4} -> {5,6} on
  // repeated clicks), each pushing its own history entry. A second click
  // with no other sibling change must be a full no-op.
  test('repeated multi-select clicks do not inflate z-index further (W1 / W4b)', async ({ page }) => {
    await loadDocumentWithEditor(page, 'foreign-deck.html');
    await page.keyboard.press('e');

    await page.locator('.slide.active .foreign-card').click();
    await page.locator('.slide.active .resize-target').click({ modifiers: ['ControlOrMeta'] });

    const readStyles = () => page.evaluate(() => ({
      card: document.querySelector('.slide.active .foreign-card').getAttribute('style'),
      target: document.querySelector('.slide.active .resize-target').getAttribute('style'),
    }));

    const before = await readStyles();
    await page.locator(FRONT_BTN).dispatchEvent('click');
    const afterFirst = await readStyles();
    expect(afterFirst).not.toEqual(before);

    await page.locator(FRONT_BTN).dispatchEvent('click');
    const afterSecond = await readStyles();
    // No growth: identical inline styles after the second click.
    expect(afterSecond).toEqual(afterFirst);

    // One undo unwinds the whole first-click entry — proof the second
    // click pushed nothing.
    await page.keyboard.press('ControlOrMeta+z');
    expect(await readStyles()).toEqual(before);
  });

  // Review round — W2: effectiveZIndex ignored position, but z-index is
  // inert on position: static. Two consequences, both exercised here:
  //   (a) a STATIC target with an authored (inert) z-index must not read
  //       as "already front" — the click must still take effect.
  //   (b) a STATIC sibling's inert z-index must not inflate the plan's
  //       base for an unrelated (real) target.
  test('static elements ignore inert z-index on both sides of the computation (W2)', async ({ page }) => {
    await loadDocumentWithEditor(page, 'foreign-deck.html');
    await page.keyboard.press('e');

    // (b) An inert z-index on a STATIC sibling must not count toward the
    // scope's max.
    await page.evaluate(() => {
      const title = document.querySelector('.slide.active .foreign-title');
      title.style.position = 'static';
      title.style.zIndex = '100';
    });
    await page.locator('.slide.active .foreign-card').click();
    await page.locator(FRONT_BTN).click();
    const cardZ = await effectiveZ(page, '.slide.active .foreign-card');
    expect(cardZ).toBe(1); // not inflated by the inert z-index: 100 sibling

    // (a) A STATIC element's own authored (inert) z-index must not read as
    // "already front" — the click must still promote it to position:
    // relative and give it a real, effective z-index.
    const chip = page.locator('.slide.active .chip-row .chip').nth(1);
    await chip.evaluate((el) => { el.style.zIndex = '1'; }); // inert while static
    await chip.click();
    await page.locator(FRONT_BTN).click();
    const chipState = await chip.evaluate((el) => ({
      position: getComputedStyle(el).position,
      zIndex: getComputedStyle(el).zIndex,
    }));
    expect(chipState.position).toBe('relative');
    expect(chipState.zIndex).not.toBe('auto');
  });

  // Review round — C2: four buttons (~250px of content) in the inspector's
  // 218px content box (246px panel - 2*13px padding), under a row with no
  // wrap and an ancestor (.wfpe-inspector) with overflow: hidden, clipped
  // the last button's label mid-word ("Fro" instead of "Front"). Measured
  // rather than eyeballed: every action button's box must sit fully
  // inside the inspector's clipping boundary.
  test('action-row buttons are not clipped by the inspector\'s overflow boundary (C2)', async ({ page }) => {
    await loadDocumentWithEditor(page, 'foreign-deck.html');
    await page.keyboard.press('e');

    await page.locator('.slide.active .foreign-card').click();
    await expect(page.locator(`${ROOT} .wfpe-inspector`)).toHaveAttribute('data-visible', 'true');

    const measurements = await page.evaluate((rootSel) => {
      const inspector = document.querySelector(`${rootSel} .wfpe-inspector`);
      const clip = inspector.getBoundingClientRect();
      const buttons = [...document.querySelectorAll(`${rootSel} .wfpe-action-row .wfpe-action-btn`)];
      return buttons.map((btn) => {
        const r = btn.getBoundingClientRect();
        const label = btn.querySelector('span')?.textContent || '';
        return {
          label,
          left: r.left, right: r.right,
          clipLeft: clip.left, clipRight: clip.right,
          // scrollWidth > clientWidth would mean the button's OWN box is
          // too small for its content (a second, independent clip path).
          selfClipped: btn.scrollWidth > btn.clientWidth + 1,
        };
      });
    }, ROOT);

    expect(measurements.map((m) => m.label)).toEqual(['Duplicate', 'Delete', 'Reset', 'Front']);
    for (const m of measurements) {
      expect(m.selfClipped).toBe(false);
      // Full pixel epsilon-tolerant containment inside the panel's own
      // clip boundary — a button hanging past clipRight is the exact
      // "Fro" truncation the review caught.
      expect(m.left).toBeGreaterThanOrEqual(m.clipLeft - 0.5);
      expect(m.right).toBeLessThanOrEqual(m.clipRight + 0.5);
    }
  });
});
