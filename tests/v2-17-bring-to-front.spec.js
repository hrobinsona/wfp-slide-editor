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
import { EDITOR_PATH, disableFsa, EDITOR_MARKER_ATTR_RE } from './_helpers.js';

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

    // v2.18 — the inspector dock now renders (with a reduced control
    // surface, Front included) for a multi-selection too, so the button is
    // a real, reachable pointer target here.
    await page.locator(FRONT_BTN).click();

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

    expect(html).not.toMatch(EDITOR_MARKER_ATTR_RE);
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

  // Review round — W1/W4b: the required-z scan excluded only the element
  // itself, not its co-targets, so a multi-select's OWN just-bumped z fed
  // back into the next click's base (e.g. {1,2} -> {3,4} -> {5,6} on
  // repeated clicks), each pushing its own history entry. A second click
  // with nothing else on the slide changed must be a full no-op.
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
    await page.locator(FRONT_BTN).click();
    const afterFirst = await readStyles();
    expect(afterFirst).not.toEqual(before);

    await page.locator(FRONT_BTN).click();
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
  //   (b) a STATIC competitor's inert z-index must not inflate the plan's
  //       required base for an unrelated (real) target.
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

// ---------------------------------------------------------------------------
// v2.17.1 — the shipped v2.17 computed the required z from the target's
// SIBLINGS. z-order does not compete among siblings: it competes inside the
// nearest stacking-context ancestor, and every intermediate stacking context
// caps what a descendant's z-index can reach. Three shapes from real decks
// (reproduced with a standalone probe against the shipped editor.js) made
// Front visibly do nothing:
//
//   B — the competitor lives in a LATER container carrying z-index: 5.
//   C — the target's ancestor has a transform (a stacking-context cap; WFP
//       entrance animations do this constantly), so no z on the target can
//       escape it.
//   D — the competitor is a non-sibling elsewhere in the slide with z-index: 2.
//
// Case A (plain overlapping siblings) is the baseline the describe block
// above already covers and must keep passing unchanged.
// ---------------------------------------------------------------------------
test.describe('v2.17.1 — cross-container stacking', () => {
  // Ported verbatim from the repro probe. In every case .pA is the target and
  // .pB the competitor, .pB covers .pA's centre, and .pA's top-left corner is
  // left clear so a real pointer click can select it.
  const CASE_B = `
    <div class="wrapA" style="position:absolute;left:300px;top:300px;">
      <div class="pA" style="position:absolute;left:0;top:0;width:200px;height:100px;background:#c33"></div>
    </div>
    <div class="wrapB" style="position:absolute;left:340px;top:330px;z-index:5;">
      <div class="pB" style="position:absolute;left:0;top:0;width:200px;height:100px;background:#33c"></div>
    </div>`;

  const CASE_C = `
    <div class="wrapA" style="position:absolute;left:300px;top:300px;transform:translateZ(0);">
      <div class="pA" style="position:absolute;left:0;top:0;width:200px;height:100px;background:#c33"></div>
    </div>
    <div class="pB" style="position:absolute;left:340px;top:330px;width:200px;height:100px;background:#33c"></div>`;

  const CASE_D = `
    <div class="wrapA" style="position:absolute;left:300px;top:300px;">
      <div class="pA" style="position:absolute;left:0;top:0;width:200px;height:100px;background:#c33"></div>
    </div>
    <div class="pB" style="position:absolute;left:340px;top:330px;width:200px;height:100px;background:#33c;z-index:2"></div>`;

  async function buildCase(page, markup) {
    await loadDocumentWithEditor(page, 'foreign-deck.html');
    await page.keyboard.press('e');
    await page.evaluate(
      (html) => document.querySelector('.slide.active').insertAdjacentHTML('beforeend', html),
      markup,
    );
    // The competitor covers the centre; the target's top-left corner is clear.
    await page.locator('.slide.active .pA').click({ position: { x: 8, y: 8 } });
    await expect(page.locator(`${ROOT} .wfpe-inspector`)).toHaveAttribute('data-visible', 'true');
    // .pA overlaps the fixture's own card, so "something got selected" is not
    // enough — pin the selection to .pA via the ring's box before the Front
    // click, or a mis-selected element turns into a confusing assertion
    // failure three lines later.
    await expect.poll(() => page.evaluate((rootSel) => {
      const ring = document.querySelector(`${rootSel} .wfpe-selection-ring`).getBoundingClientRect();
      const pa = document.querySelector('.slide.active .pA').getBoundingClientRect();
      return Math.abs(ring.left - pa.left) < 4 && Math.abs(ring.top - pa.top) < 4
        && Math.abs(ring.width - pa.width) < 8 && Math.abs(ring.height - pa.height) < 8;
    }, ROOT)).toBe(true);
  }

  function overlapPoint(page) {
    return page.evaluate(() => {
      const ra = document.querySelector('.slide.active .pA').getBoundingClientRect();
      const rb = document.querySelector('.slide.active .pB').getBoundingClientRect();
      return {
        x: (Math.max(ra.left, rb.left) + Math.min(ra.right, rb.right)) / 2,
        y: (Math.max(ra.top, rb.top) + Math.min(ra.bottom, rb.bottom)) / 2,
      };
    });
  }

  function paintsOnTop(page, pt, selector) {
    return page.evaluate(
      ([p, sel]) => document.elementFromPoint(p.x, p.y)?.closest(sel) != null,
      [pt, selector],
    );
  }

  test('B — out-stacks a competitor nested in a later container with z-index: 5', async ({ page }) => {
    await buildCase(page, CASE_B);
    const pt = await overlapPoint(page);
    expect(await paintsOnTop(page, pt, '.pB')).toBe(true);

    await page.locator(FRONT_BTN).click();

    expect(await paintsOnTop(page, pt, '.pA')).toBe(true);
    // The container's z-index, not the (auto) competitor's own, is what has
    // to be beaten — a sibling-scoped plan only ever asked for 1.
    expect(await effectiveZ(page, '.slide.active .pA')).toBeGreaterThan(5);
  });

  test('C — climbs to the capping ancestor when a transform traps the z-index', async ({ page }) => {
    await buildCase(page, CASE_C);
    const pt = await overlapPoint(page);
    expect(await paintsOnTop(page, pt, '.pB')).toBe(true);

    const before = await page.evaluate(() => ({
      pA: document.querySelector('.slide.active .pA').getAttribute('style'),
      wrapA: document.querySelector('.slide.active .wrapA').getAttribute('style'),
    }));

    await page.locator(FRONT_BTN).click();

    expect(await paintsOnTop(page, pt, '.pA')).toBe(true);
    // The transformed ancestor is a stacking context, so it had to be raised
    // too — a z on the target alone can never escape it.
    expect(await page.evaluate(
      () => document.querySelector('.slide.active .wrapA').style.zIndex,
    )).not.toBe('');

    // Both writes landed in ONE transaction: a single undo unwinds the target
    // AND the ancestor.
    await page.keyboard.press('ControlOrMeta+z');
    expect(await page.evaluate(() => ({
      pA: document.querySelector('.slide.active .pA').getAttribute('style'),
      wrapA: document.querySelector('.slide.active .wrapA').getAttribute('style'),
    }))).toEqual(before);
  });

  test('D — out-stacks a non-sibling flat competitor with z-index: 2', async ({ page }) => {
    await buildCase(page, CASE_D);
    const pt = await overlapPoint(page);
    expect(await paintsOnTop(page, pt, '.pB')).toBe(true);

    await page.locator(FRONT_BTN).click();

    expect(await paintsOnTop(page, pt, '.pA')).toBe(true);
    expect(await effectiveZ(page, '.slide.active .pA')).toBeGreaterThan(2);
  });

  // The no-op guard must be PAINT truth, not a z-index comparison. Here the
  // target already carries z-index: 30 — far above anything a plan would ask
  // for — yet it is buried, because its transformed ancestor caps it. A
  // z-comparison guard returns early and does nothing; the paint-truth guard
  // has to see the occlusion and climb.
  test('the no-op guard is paint truth, not z-index comparison', async ({ page }) => {
    await buildCase(page, CASE_C);
    await page.evaluate(() => { document.querySelector('.slide.active .pA').style.zIndex = '30'; });
    const pt = await overlapPoint(page);
    expect(await paintsOnTop(page, pt, '.pB')).toBe(true);

    await page.locator(FRONT_BTN).click();

    expect(await paintsOnTop(page, pt, '.pA')).toBe(true);
    expect(await page.evaluate(
      () => document.querySelector('.slide.active .wrapA').style.zIndex,
    )).not.toBe('');
    // No demotion: an element authored above the plan value keeps its own z.
    expect(await page.evaluate(
      () => document.querySelector('.slide.active .pA').style.zIndex,
    )).toBe('30');
  });

  test('a second click after a climb writes nothing and pushes no history entry', async ({ page }) => {
    await buildCase(page, CASE_C);
    const readStyles = () => page.evaluate(() => ({
      pA: document.querySelector('.slide.active .pA').getAttribute('style'),
      wrapA: document.querySelector('.slide.active .wrapA').getAttribute('style'),
    }));

    const before = await readStyles();
    await page.locator(FRONT_BTN).click();
    const afterFirst = await readStyles();
    expect(afterFirst).not.toEqual(before);

    await page.locator(FRONT_BTN).click();
    expect(await readStyles()).toEqual(afterFirst);

    // One undo unwinds the whole first click — proof the second pushed nothing.
    await page.keyboard.press('ControlOrMeta+z');
    expect(await readStyles()).toEqual(before);
  });

  // Review round — the climb may raise ANY ancestor, and "position: relative
  // costs nothing" (true for the element's own box, and the basis of the
  // static fix-up on the target) stops being true there: promoting a STATIC
  // ancestor re-anchors every absolutely-positioned descendant that used to
  // resolve against a higher containing block, moving real slide content and
  // baking the move into the export. Stacking-context triggers that are not
  // also containing-block triggers — opacity < 1 here, plus isolation,
  // mix-blend-mode, will-change: opacity — are exactly the dangerous set.
  // Front leaving an occlusion unresolved is far cheaper than a silent
  // relayout, so the climb must skip such an ancestor.
  test('the climb never re-anchors content by positioning a static ancestor', async ({ page }) => {
    await loadDocumentWithEditor(page, 'foreign-deck.html');
    await page.keyboard.press('e');
    // margin-top gives the wrapper a static position well away from the
    // slide's origin, so a re-anchor shows up as a large, unmistakable shift.
    await page.evaluate(() => document.querySelector('.slide.active').insertAdjacentHTML('beforeend', `
      <div class="fadeWrap" style="opacity:0.9;margin-top:120px;">
        <div class="pA" style="position:absolute;left:20px;top:20px;width:200px;height:100px;background:#c33"></div>
      </div>
      <div class="pB" style="position:absolute;left:60px;top:50px;width:200px;height:100px;background:#33c;z-index:2"></div>`));

    const rectBefore = await page.evaluate(() => {
      const r = document.querySelector('.slide.active .pA').getBoundingClientRect();
      return { x: r.x, y: r.y };
    });
    await page.locator('.slide.active .pA').click({ position: { x: 8, y: 8 } });
    await expect(page.locator(`${ROOT} .wfpe-inspector`)).toHaveAttribute('data-visible', 'true');

    await page.locator(FRONT_BTN).click();

    const after = await page.evaluate(() => {
      const r = document.querySelector('.slide.active .pA').getBoundingClientRect();
      const wrap = document.querySelector('.slide.active .fadeWrap');
      return {
        rect: { x: r.x, y: r.y },
        wrapPosition: wrap.style.position,
        wrapZIndex: wrap.style.zIndex,
      };
    });
    expect(after.rect).toEqual(rectBefore);
    expect(after.wrapPosition).toBe('');
    expect(after.wrapZIndex).toBe('');
  });

  // Review round — brief step 6 requires a second click to be a full no-op
  // "including for multi-target plans". Excluding co-targets and their
  // descendants is not enough: an ancestor raised by one target's climb is
  // not a descendant of any target, so it fed back in as a competitor of the
  // OTHER target and inflated the next plan. Co-targets' ancestors have to be
  // out of scope too — their z is already accounted for through the chain max
  // of whatever else lives inside them.
  test('repeat multi-select clicks stay stable when a co-target sits inside a raised ancestor', async ({ page }) => {
    await loadDocumentWithEditor(page, 'foreign-deck.html');
    await page.keyboard.press('e');
    await page.evaluate(() => document.querySelector('.slide.active').insertAdjacentHTML('beforeend', `
      <div class="wrapA" style="position:absolute;left:20px;top:20px;width:200px;height:100px;transform:translateZ(0);">
        <div class="tA" style="position:absolute;left:0;top:0;width:200px;height:100px;background:#c33"></div>
      </div>
      <div class="tB" style="position:absolute;left:40px;top:40px;width:200px;height:100px;background:#3c3"></div>
      <div class="pB" style="position:absolute;left:60px;top:60px;width:200px;height:100px;background:#33c;z-index:2"></div>`));

    await page.locator('.slide.active .tA').click({ position: { x: 8, y: 8 } });
    await page.locator('.slide.active .tB').click({ position: { x: 8, y: 8 }, modifiers: ['ControlOrMeta'] });

    const readStyles = () => page.evaluate(() => ({
      tA: document.querySelector('.slide.active .tA').getAttribute('style'),
      tB: document.querySelector('.slide.active .tB').getAttribute('style'),
      wrapA: document.querySelector('.slide.active .wrapA').getAttribute('style'),
    }));

    const before = await readStyles();
    // v2.18 — the inspector dock renders a reduced control surface (Front
    // included) for a multi-selection, so Front is a real pointer target
    // here; a synthetic dispatchEvent would hide a regression in which the
    // button is present but unclickable.
    await page.locator(FRONT_BTN).click();
    const afterFirst = await readStyles();
    expect(afterFirst).not.toEqual(before);

    await page.locator(FRONT_BTN).click();
    expect(await readStyles()).toEqual(afterFirst);

    // One undo unwinds the whole first click — target, co-target and the
    // ancestor the climb raised.
    await page.keyboard.press('ControlOrMeta+z');
    expect(await readStyles()).toEqual(before);
  });

  // Review round — C1 (multi-target convergence). The climb ran once per
  // target, in sequence, and never looked back: raising a LATER target's
  // capping ancestor carries that container's whole subtree forward,
  // including NON-target children, which can bury an EARLIER target that the
  // same pass had already verified as front-most. Measured against the
  // pre-fix build, one click left .tA behind .occ (elementFromPoint at their
  // overlap still returned .occ) and it took a second click — with a second
  // history entry — to converge. One click has to reach the fixpoint: every
  // target painting on top, and an immediately repeated click writing
  // nothing.
  //
  // Shape: two targets, each trapped inside its own transformed (stacking-
  // context) wrapper. .tB's wrapper also holds .occ, an unselected element
  // overlapping .tA — so the raise that frees .tB is exactly what re-buries
  // .tA.
  test('one click converges for multi-target climbs whose containers re-occlude each other (C1)', async ({ page }) => {
    await loadDocumentWithEditor(page, 'foreign-deck.html');
    await page.keyboard.press('e');
    await page.evaluate(() => document.querySelector('.slide.active').insertAdjacentHTML('beforeend', `
      <div class="wrapA" style="position:absolute;left:400px;top:120px;width:220px;height:300px;transform:translateZ(0);">
        <div class="tA" style="position:absolute;left:0;top:0;width:200px;height:100px;background:#c33"></div>
      </div>
      <div class="wrapB" style="position:absolute;left:480px;top:140px;width:200px;height:260px;transform:translateZ(0);">
        <div class="occ" style="position:absolute;left:0;top:0;width:120px;height:60px;background:#39f"></div>
        <div class="tB" style="position:absolute;left:0;top:160px;width:160px;height:80px;background:#3c3"></div>
      </div>
      <div class="pB" style="position:absolute;left:500px;top:320px;width:200px;height:100px;background:#333;z-index:2"></div>`));

    // Overlap centres: .tA vs .occ, and .tB vs .pB. Both sit clear of the
    // fixture's own card, so only the injected elements compete there.
    const points = await page.evaluate(() => {
      const box = (sel) => document.querySelector(`.slide.active ${sel}`).getBoundingClientRect();
      const centre = (a, b) => ({
        x: (Math.max(a.left, b.left) + Math.min(a.right, b.right)) / 2,
        y: (Math.max(a.top, b.top) + Math.min(a.bottom, b.bottom)) / 2,
      });
      return { a: centre(box('.tA'), box('.occ')), b: centre(box('.tB'), box('.pB')) };
    });
    // Which of a pair paints above the other at `pt`: walk the hit stack
    // (topmost first, editor chrome skipped) and report whichever turns up
    // first. That is the contract's comparison — "the target paints above
    // its COMPETITOR" — not "the target is topmost". A third element in
    // between is neither's loss, and one is expected here: the climb raises
    // .wrapA, a transparent container whose box happens to span this point,
    // above .wrapB. It hides nothing (no background) and is excluded from
    // both targets' competitor sets by design, being a co-target's ancestor.
    const paintOrder = (pt, sels) => page.evaluate(([p, s]) => {
      for (const node of document.elementsFromPoint(p.x, p.y)) {
        if (node.closest('#wfp-editor-root')) continue;
        const hit = s.find((sel) => node.closest(sel) != null);
        if (hit) return hit;
      }
      return null;
    }, [pt, sels]);

    // Sanity: both targets start buried, each by a different mechanism —
    // .tA by a later sibling container's subtree, .tB by a flat z-index: 2.
    expect(await paintOrder(points.a, ['.tA', '.occ'])).toBe('.occ');
    expect(await paintOrder(points.b, ['.tB', '.pB'])).toBe('.pB');

    // Click clear of every occluder: .tA's top-right corner is above .occ and
    // right of the fixture card; .tB's top-left corner is above .pB.
    await page.locator('.slide.active .tA').click({ position: { x: 160, y: 8 } });
    await page.locator('.slide.active .tB').click({ position: { x: 8, y: 8 }, modifiers: ['ControlOrMeta'] });
    // Both injected targets overlap other slide content, so "two things are
    // selected" is not enough — pin the selection to .tA and .tB through the
    // multi-outline boxes, or a mis-selection turns into a confusing paint
    // assertion failure further down.
    await expect.poll(() => page.evaluate((rootSel) => {
      const outlines = [...document.querySelectorAll(`${rootSel} .wfpe-multi-outline`)]
        .map((o) => o.getBoundingClientRect());
      if (outlines.length !== 2) return false;
      return ['.tA', '.tB'].every((sel) => {
        const r = document.querySelector(`.slide.active ${sel}`).getBoundingClientRect();
        return outlines.some((o) => Math.abs(o.left - r.left) < 4 && Math.abs(o.top - r.top) < 4
          && Math.abs(o.width - r.width) < 8 && Math.abs(o.height - r.height) < 8);
      });
    }, ROOT)).toBe(true);

    const readStyles = () => page.evaluate(() => {
      const style = (sel) => document.querySelector(`.slide.active ${sel}`).getAttribute('style');
      return {
        tA: style('.tA'), wrapA: style('.wrapA'),
        tB: style('.tB'), wrapB: style('.wrapB'),
        occ: style('.occ'), pB: style('.pB'),
      };
    });

    const before = await readStyles();
    await page.locator(FRONT_BTN).click();
    const afterFirst = await readStyles();
    expect(afterFirst).not.toEqual(before);

    // (a) ONE click: both targets paint above their occluders. Pre-fix, .tA
    // failed here — wrapB's raise carried .occ back over it.
    expect(await paintOrder(points.a, ['.tA', '.occ'])).toBe('.tA');
    expect(await paintOrder(points.b, ['.tB', '.pB'])).toBe('.tB');

    // (c) The retry re-plans ALL targets together, so the z ASSIGNMENT keeps
    // the plan's order: .tB sorted after .tA (both z:auto, .tB later in DOM)
    // and still gets the higher z. Escalating only the target that needed
    // another climb — the obvious cheaper retry — inverts this.
    //
    // Note this is the assignment, not paint order, and in THIS shape the two
    // genuinely part company: .occ must end below .tA, .occ lives in wrapB,
    // so wrapA must out-stack wrapB — which lifts .tA's whole container above
    // .tB's. The containers make (a) and (c) mutually exclusive here and the
    // brief makes paint truth decisive, so (a) wins. It costs nothing
    // visually (the targets do not overlap) and it is where the pre-fix
    // build's own second click landed too. Paint-order preservation is
    // covered where it is actually satisfiable, on flat siblings: see
    // 'multi-select raises both above an unselected sibling and preserves
    // their relative order'.
    const zA = await effectiveZ(page, '.slide.active .tA');
    const zB = await effectiveZ(page, '.slide.active .tB');
    expect(zB).toBeGreaterThan(zA);

    // (b) Fixpoint: the second click recomputes the same plan, writes
    // nothing, and pushes no history entry.
    await page.locator(FRONT_BTN).click();
    expect(await readStyles()).toEqual(afterFirst);
    expect(await paintOrder(points.a, ['.tA', '.occ'])).toBe('.tA');
    expect(await paintOrder(points.b, ['.tB', '.pB'])).toBe('.tB');

    // Undo depth is the proof: one undo unwinds the whole first click, so
    // the second click cannot have pushed an entry of its own.
    await page.keyboard.press('ControlOrMeta+z');
    expect(await readStyles()).toEqual(before);
  });

  test('exported HTML keeps both the target and the climbed ancestor z-index', async ({ page, context }) => {
    await buildCase(page, CASE_C);
    await page.locator(FRONT_BTN).click();

    const live = await page.evaluate(() => ({
      pA: document.querySelector('.slide.active .pA').style.zIndex,
      wrapA: document.querySelector('.slide.active .wrapA').style.zIndex,
    }));
    expect(live.wrapA).not.toBe('');

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
    expect(await exportedPage.evaluate(() => ({
      pA: document.querySelector('.pA').style.zIndex,
      wrapA: document.querySelector('.wrapA').style.zIndex,
    }))).toEqual(live);
    await exportedPage.close();
  });
});
