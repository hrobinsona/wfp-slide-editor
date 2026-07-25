// v2.15 — Unlock hardening: resize deadzone + direct-child sibling pinning.
//
// Two interaction bugs in the drag/resize/flow-unlock engine:
//
// 1. A zero-movement mousedown+mouseup on a resize handle must be a no-op.
//    Historically `startResize` did everything at mousedown — beginTxn, the
//    "lock in current dimensions" inline writes for absolute elements, and
//    the FULL flow-unlock cascade (sibling freeze, container pin, toast) for
//    flow elements — so a plain click on a handle silently converted
//    responsive stylesheet sizing to fixed px and pushed a wasted history
//    entry. The fix mirrors the drag engine's DRAG_DEADZONE_PX gate.
//
// 2. Unlocking a DIRECT child of the slide/flat root must protect siblings.
//    `unlockToAbsolute` pinned only ancestors strictly BETWEEN the element
//    and the slide root; for a direct child there are none, so siblings
//    reflowed (flat-document: the first .flat-section jumped up by the
//    hero's full height). The fix pins the root's children the way
//    `pinContainerChildren` pins a container's — without mutating the root
//    element itself.
//
// Load pattern follows tests/v2-4-modes.spec.js (public fixtures served by
// the dev server, editor injected via addScriptTag).
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EDITOR_PATH, disableFsa } from './_helpers.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = path.join(__dirname, 'output');

const ROOT = '#wfp-editor-root';
const RESET_BTN = `${ROOT} .wfpe-inspector .wfpe-reset-btn`;

async function loadDocumentWithEditor(page, fixtureName) {
  await disableFsa(page);
  await page.goto(`/fixtures/${fixtureName}`, { timeout: 30_000 });
  await page.addScriptTag({ path: EDITOR_PATH });
  await page.waitForFunction(() => window.__wfpEditorReady === true, null, { timeout: 10_000 });
}

async function dragBySelector(page, selector, dx, dy) {
  const center = await page.evaluate((sel) => {
    const r = document.querySelector(sel).getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }, selector);
  await page.mouse.move(center.x, center.y);
  await page.mouse.down();
  await page.mouse.move(center.x + dx, center.y + dy, { steps: 6 });
  await page.mouse.up();
}

// mousedown+mouseup on a resize handle at the exact same point.
async function zeroMoveHandleClick(page, handleClass) {
  const handle = page.locator(`${ROOT} .${handleClass}`);
  await expect(handle).not.toHaveCSS('display', 'none');
  const box = await handle.boundingBox();
  expect(box).not.toBeNull();
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.up();
}

test.describe('v2.15 — zero-move resize handle click is a no-op', () => {
  test('absolute element: style attribute unchanged, no history entry', async ({ page }) => {
    await loadDocumentWithEditor(page, 'foreign-deck.html');
    await page.keyboard.press('e');

    // One real edit first so undo has a known prior state to unwind: drag
    // the (already absolute) foreign card.
    const card = page.locator('.slide.active [data-testid="foreign-card"]');
    const cardBefore = await card.evaluate((el) => ({ left: el.offsetLeft, top: el.offsetTop }));
    await card.click();
    await dragBySelector(page, '.slide.active [data-testid="foreign-card"]', 40, 20);
    const cardDragged = await card.evaluate((el) => ({ left: el.offsetLeft, top: el.offsetTop }));
    expect(cardDragged.left).toBeGreaterThanOrEqual(cardBefore.left + 35);

    // The target is stylesheet-positioned absolute with NO inline style.
    const target = page.locator('.slide.active [data-testid="resize-target"]');
    await target.click();
    expect(await target.evaluate((el) => el.getAttribute('style'))).toBeNull();

    await zeroMoveHandleClick(page, 'wfpe-handle-se');

    // No mutation: still no inline style (responsive stylesheet sizing is
    // NOT silently locked in as fixed px), no freeze marker.
    expect(await target.evaluate((el) => ({
      style: el.getAttribute('style'),
      frozen: el.getAttribute('data-wfp-edit-frozen'),
    }))).toEqual({ style: null, frozen: null });

    // The release must not deselect the element.
    await expect(page.locator(`${ROOT} .wfpe-inspector`)).toHaveAttribute('data-visible', 'true');

    // No history entry: one undo unwinds exactly the earlier card drag.
    await page.keyboard.press('ControlOrMeta+z');
    expect(await card.evaluate((el) => ({ left: el.offsetLeft, top: el.offsetTop }))).toEqual(cardBefore);
    expect(await target.evaluate((el) => el.getAttribute('style'))).toBeNull();
  });

  test('flow element: no unlock cascade — no inline styles, no freeze markers, no toast', async ({ page }) => {
    await loadDocumentWithEditor(page, 'foreign-deck.html');
    await page.keyboard.press('e');

    const chip = page.locator('.slide.active .chip-row .chip').first();
    await chip.click();
    await expect(page.locator(`${ROOT} .wfpe-inspector`)).toHaveAttribute('data-visible', 'true');

    await zeroMoveHandleClick(page, 'wfpe-handle-se');

    const state = await page.evaluate(() => {
      const row = document.querySelector('.slide.active .chip-row');
      return {
        chipStyle: row.querySelector('.chip').getAttribute('style'),
        rowStyle: row.getAttribute('style'),
        rowFlexFrozen: row.getAttribute('data-wfp-edit-flex-frozen'),
        frozenInRow: row.querySelectorAll('[data-wfp-edit-frozen]').length,
        toastCount: document.querySelectorAll('#wfp-editor-root .wfpe-toast').length,
      };
    });
    expect(state).toEqual({
      chipStyle: null,
      rowStyle: null,
      rowFlexFrozen: null,
      frozenInRow: 0,
      toastCount: 0,
    });

    // Nothing to undo either: the chip stays untouched after Ctrl+Z.
    await page.keyboard.press('ControlOrMeta+z');
    expect(await chip.evaluate((el) => el.getAttribute('style'))).toBeNull();
  });

  test('a real resize still works and is exactly one undo step', async ({ page }) => {
    await loadDocumentWithEditor(page, 'foreign-deck.html');
    await page.keyboard.press('e');

    const target = page.locator('.slide.active [data-testid="resize-target"]');
    await target.click();
    const before = await target.evaluate((el) => ({
      width: el.offsetWidth,
      height: el.offsetHeight,
    }));

    const handle = page.locator(`${ROOT} .wfpe-handle-se`);
    await expect(handle).not.toHaveCSS('display', 'none');
    const box = await handle.boundingBox();
    expect(box).not.toBeNull();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2 + 40, { steps: 4 });
    await page.mouse.up();

    const resized = await target.evaluate((el) => ({
      width: el.offsetWidth,
      height: el.offsetHeight,
    }));
    expect(resized.width).toBeGreaterThanOrEqual(before.width + 55);
    expect(resized.height).toBeGreaterThanOrEqual(before.height + 35);

    // Exactly one history entry: a single undo restores the pristine
    // attribute-less element (a second entry would leave the mousedown
    // "lock-in" styles behind).
    await page.keyboard.press('ControlOrMeta+z');
    expect(await target.evaluate((el) => ({
      style: el.getAttribute('style'),
      width: el.offsetWidth,
      height: el.offsetHeight,
    }))).toEqual({ style: null, width: before.width, height: before.height });
  });
});

// ---------------------------------------------------------------------------
// Bug 2 — unlocking a DIRECT child of the slide/flat root must pin siblings.
// fixtures/flat-document.html: the flat root `main#flat-article` has direct
// children .flat-hero + three .flat-section. Dragging the hero used to leave
// the sections in flow, so the first section jumped up by the hero's full
// height. State helpers mirror tests/v2-5-reset-styles.spec.js patterns.
// ---------------------------------------------------------------------------

// Select and drag the hero itself (not one of its children): the hero's
// padding is >=36px on every side, so a point 12px inside its top-left
// corner hits the hero element directly.
async function selectAndDragHero(page, dx, dy) {
  const point = await page.evaluate(() => {
    const r = document.querySelector('.flat-hero').getBoundingClientRect();
    return { x: r.left + 12, y: r.top + 12 };
  });
  await page.mouse.click(point.x, point.y);
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  await page.mouse.move(point.x + dx, point.y + dy, { steps: 6 });
  await page.mouse.up();
}

// Inline style + freeze markers for the flat root and each of its children.
function getFlatRootState(page) {
  return page.evaluate(() => {
    const root = document.querySelector('#flat-article');
    const describe = (el) => ({
      style: el.getAttribute('style'),
      frozen: el.getAttribute('data-wfp-edit-frozen'),
      flexFrozen: el.getAttribute('data-wfp-edit-flex-frozen'),
    });
    return {
      root: describe(root),
      children: [...root.children].map(describe),
    };
  });
}

test.describe('v2.15 — direct-child unlock pins slide/flat-root siblings', () => {
  test('dragging the flat hero keeps the first section anchored and the root inline-untouched', async ({ page }) => {
    await loadDocumentWithEditor(page, 'flat-document.html');
    await page.keyboard.press('e');

    const hero = page.locator('.flat-hero');
    const firstSection = page.locator('.flat-section').first();
    const heroBefore = await hero.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return { left: r.left, top: r.top };
    });
    const sectionBefore = await firstSection.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return { left: r.left, top: r.top };
    });

    await selectAndDragHero(page, 60, 30);

    const heroAfter = await hero.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return {
        left: r.left,
        top: r.top,
        inlineLeft: el.style.left,
        inlineTop: el.style.top,
        position: el.style.position,
      };
    });
    const sectionAfter = await firstSection.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return { left: r.left, top: r.top, frozen: el.getAttribute('data-wfp-edit-frozen') };
    });
    const rootInlineStyle = await page.evaluate(
      () => document.querySelector('#flat-article').getAttribute('style')
    );

    // The hero followed the pointer…
    expect(heroAfter.position).toBe('absolute');
    expect(heroAfter.inlineLeft).not.toBe('');
    expect(heroAfter.inlineTop).not.toBe('');
    expect(heroAfter.left).toBeCloseTo(heroBefore.left + 60, 0);
    expect(heroAfter.top).toBeCloseTo(heroBefore.top + 30, 0);

    // …the sibling section did NOT reflow into the hero's place…
    expect(Math.abs(sectionAfter.left - sectionBefore.left)).toBeLessThan(2);
    expect(Math.abs(sectionAfter.top - sectionBefore.top)).toBeLessThan(2);
    expect(sectionAfter.frozen).toBe('true');

    // …and the flat root itself was never inline-mutated.
    expect(rootInlineStyle).toBeNull();
  });

  test('undo after a direct-child unlock restores every pinned sibling and the hero', async ({ page }) => {
    await loadDocumentWithEditor(page, 'flat-document.html');
    await page.keyboard.press('e');

    const original = await getFlatRootState(page);

    await selectAndDragHero(page, 60, 30);

    // Sanity: the unlock actually pinned the whole sibling set (hero moved,
    // every sibling frozen at its captured rect) without a root style write.
    const pinned = await getFlatRootState(page);
    expect(pinned.root.style).toBeNull();
    expect(pinned.children[0].style).toContain('position: absolute');
    for (const child of pinned.children) {
      expect(child.frozen).toBe('true');
      expect(child.style).not.toBeNull();
    }

    await page.keyboard.press('ControlOrMeta+z');
    expect(await getFlatRootState(page)).toEqual(original);
  });

  test('inspector Reset after a direct-child unlock restores the whole group', async ({ page }) => {
    await loadDocumentWithEditor(page, 'flat-document.html');
    await page.keyboard.press('e');

    const original = await getFlatRootState(page);

    await selectAndDragHero(page, 60, 30);
    const pinned = await getFlatRootState(page);
    expect(pinned).not.toEqual(original);

    await page.locator(RESET_BTN).click();
    expect(await getFlatRootState(page)).toEqual(original);

    // Selection survives the group restore.
    const ringDisplay = await page.evaluate(
      () => document.querySelector('#wfp-editor-root .wfpe-selection-ring').style.display
    );
    expect(ringDisplay).toBe('block');

    // Reset was one atomic entry: a single undo returns the pinned state.
    await page.keyboard.press('ControlOrMeta+z');
    expect(await getFlatRootState(page)).toEqual(pinned);
  });
});

// ---------------------------------------------------------------------------
// Review round — body-as-flat-root hardening. resolveFlatRoot() falls back
// to document.body when no main/article exists and body has multiple
// candidate children. #wfp-editor-root and the page's <script> elements are
// then DIRECT SIBLINGS of the unlock target, and the root-child pin must
// never touch them (pinning the editor overlay kills its position:fixed and
// inline-styling script tags leaks into exports).
// ---------------------------------------------------------------------------

async function loadBodyRootPage(page, { visibleChildren, hiddenChildren = 0 }) {
  await disableFsa(page);
  const divs = Array.from({ length: visibleChildren }, (_, i) => `
    <div data-testid="body-child-${i}" style="width: 300px; height: 90px; background: rgb(${200 - i * 30}, 225, 240); margin: 12px;">Body child ${i}</div>
  `).join('');
  // Hidden body-level candidates keep body resolved as the flat root (the
  // resolver counts them) while contributing 0x0 rects at pin time.
  const hidden = Array.from({ length: hiddenChildren }, (_, i) => `
    <div data-testid="body-hidden-${i}" style="display: none;">Hidden panel ${i}</div>
  `).join('');
  await page.setContent(`
    <!doctype html>
    <html>
    <head><style>body { margin: 0; font-family: system-ui, sans-serif; }</style></head>
    <body>
      ${divs}
      ${hidden}
      <script>window.__bodyRootFixtureMarker = true;</script>
    </body>
    </html>
  `);
  await page.addScriptTag({ path: EDITOR_PATH });
  await page.waitForFunction(() => window.__wfpEditorReady === true, null, { timeout: 10_000 });
  // Sanity: body itself resolved as the flat root.
  expect(await page.evaluate(() =>
    document.body.getAttribute('data-wfp-edit-flat-root')
  )).toBe('true');
  await page.keyboard.press('e');
}

function getBodyRootPinState(page) {
  return page.evaluate(() => {
    const editorRoot = document.getElementById('wfp-editor-root');
    return {
      editorRootStyle: editorRoot.getAttribute('style'),
      editorRootFrozen: editorRoot.getAttribute('data-wfp-edit-frozen'),
      editorRootPosition: getComputedStyle(editorRoot).position,
      styledScripts: [...document.querySelectorAll('script')].filter(
        (s) => s.getAttribute('style') !== null
      ).length,
      frozenScripts: document.querySelectorAll('script[data-wfp-edit-frozen]').length,
      bodyInlineStyle: document.body.getAttribute('style'),
      bodyFlexFrozen: document.body.getAttribute('data-wfp-edit-flex-frozen'),
    };
  });
}

test.describe('v2.15 — body-as-flat-root pinning skips editor and non-rendered children', () => {
  test('dragging a direct body child never pins the editor root or script elements', async ({ page }) => {
    await loadBodyRootPage(page, { visibleChildren: 2 });

    const editorRootStyleBefore = await page.evaluate(
      () => document.getElementById('wfp-editor-root').getAttribute('style')
    );
    const siblingBefore = await page.locator('[data-testid="body-child-1"]').evaluate((el) => {
      const r = el.getBoundingClientRect();
      return { left: r.left, top: r.top };
    });

    await page.locator('[data-testid="body-child-0"]').click();
    await dragBySelector(page, '[data-testid="body-child-0"]', 50, 25);

    const state = await getBodyRootPinState(page);
    expect(state.editorRootStyle).toBe(editorRootStyleBefore);
    expect(state.editorRootFrozen).toBeNull();
    expect(state.editorRootPosition).toBe('fixed');
    expect(state.styledScripts).toBe(0);
    expect(state.frozenScripts).toBe(0);
    expect(state.bodyInlineStyle).toBeNull();

    // The real content sibling IS protected.
    const sibling = await page.locator('[data-testid="body-child-1"]').evaluate((el) => {
      const r = el.getBoundingClientRect();
      return { left: r.left, top: r.top, frozen: el.getAttribute('data-wfp-edit-frozen') };
    });
    expect(sibling.frozen).toBe('true');
    expect(Math.abs(sibling.left - siblingBefore.left)).toBeLessThan(2);
    expect(Math.abs(sibling.top - siblingBefore.top)).toBeLessThan(2);
  });

  test('a single pinnable child plus hidden and editor chrome takes the group-of-one path, not the multi-child pin', async ({ page }) => {
    // Body stays the resolved root (two resolver candidates), but only ONE
    // child is pinnable at drag time — the other is display:none (0x0).
    await loadBodyRootPage(page, { visibleChildren: 1, hiddenChildren: 1 });

    await page.locator('[data-testid="body-child-0"]').click();
    await dragBySelector(page, '[data-testid="body-child-0"]', 50, 25);

    const state = await getBodyRootPinState(page);
    // No sibling worth protecting: no root latch, no editor-root damage.
    expect(state.bodyFlexFrozen).toBeNull();
    expect(state.editorRootFrozen).toBeNull();
    expect(state.editorRootPosition).toBe('fixed');
    expect(state.styledScripts).toBe(0);

    // The hidden candidate was never styled or marked.
    expect(await page.locator('[data-testid="body-hidden-0"]').evaluate((el) => ({
      style: el.getAttribute('style'),
      frozen: el.getAttribute('data-wfp-edit-frozen'),
    }))).toEqual({ style: 'display: none;', frozen: null });

    // The dragged element itself still unlocked and moved.
    const dragged = await page.locator('[data-testid="body-child-0"]').evaluate((el) => ({
      position: el.style.position,
      frozen: el.getAttribute('data-wfp-edit-frozen'),
    }));
    expect(dragged.position).toBe('absolute');
    expect(dragged.frozen).toBe('true');
  });
});

// ---------------------------------------------------------------------------
// Review round — flat-root height persistence. Pinning every child of the
// flat root absolute collapses the root's intrinsic height, so BODY-LEVEL
// siblings of the root (header/main/footer pages) reflowed: the footer
// jumped up by the root's full content height. The height must be held
// WITHOUT inline styles on the live root, and must survive export (where
// editor CSS and data-wfp-edit-* markers are gone).
// ---------------------------------------------------------------------------

// main carries stylesheet position:relative on purpose: the exported file
// has no editor CSS, and the flat-position-context export persistence is a
// separate change (PR #14). This spec verifies HEIGHT persistence on its
// own terms, independent of that.
async function loadHeaderMainFooterPage(page) {
  await disableFsa(page);
  await page.setContent(`
    <!doctype html>
    <html>
    <head><style>
      * { box-sizing: border-box; }
      body { margin: 0; font-family: system-ui, sans-serif; }
      header { height: 80px; background: rgb(221, 232, 240); }
      main { position: relative; padding: 20px; background: rgb(251, 252, 253); }
      .doc-block { height: 120px; margin: 0 0 20px; background: rgb(228, 236, 248); }
      footer { height: 60px; background: rgb(204, 216, 224); }
    </style></head>
    <body>
      <header>Page header</header>
      <main id="doc-main">
        <div class="doc-block" data-testid="doc-block-0">Block 0</div>
        <div class="doc-block" data-testid="doc-block-1">Block 1</div>
      </main>
      <footer data-testid="page-footer">Page footer</footer>
    </body>
    </html>
  `);
  await page.addScriptTag({ path: EDITOR_PATH });
  await page.waitForFunction(() => window.__wfpEditorReady === true, null, { timeout: 10_000 });
  expect(await page.evaluate(() =>
    document.querySelector('#doc-main').getAttribute('data-wfp-edit-flat-root')
  )).toBe('true');
  await page.keyboard.press('e');
}

function getFooterTop(page) {
  return page.evaluate(() =>
    document.querySelector('[data-testid="page-footer"]').getBoundingClientRect().top
  );
}

test.describe('v2.15 — flat-root height survives direct-child pinning', () => {
  test('a direct-child drag keeps the footer anchored without inline styles on the root', async ({ page }) => {
    await loadHeaderMainFooterPage(page);

    const footerBefore = await getFooterTop(page);
    const mainAttrsBefore = await page.evaluate(() => {
      const main = document.querySelector('#doc-main');
      return { style: main.getAttribute('style'), flexFrozen: main.getAttribute('data-wfp-edit-flex-frozen') };
    });

    await page.locator('[data-testid="doc-block-0"]').click();
    await dragBySelector(page, '[data-testid="doc-block-0"]', 40, 20);

    const after = await page.evaluate(() => {
      const main = document.querySelector('#doc-main');
      return {
        footerTop: document.querySelector('[data-testid="page-footer"]').getBoundingClientRect().top,
        mainInlineStyle: main.getAttribute('style'),
        mainHeight: main.getBoundingClientRect().height,
        sibling: {
          frozen: document.querySelector('[data-testid="doc-block-1"]').getAttribute('data-wfp-edit-frozen'),
          top: document.querySelector('[data-testid="doc-block-1"]').getBoundingClientRect().top,
        },
      };
    });

    // The root's box held its pre-pin height, so the footer never moved…
    expect(Math.abs(after.footerTop - footerBefore)).toBeLessThan(2);
    expect(after.mainHeight).toBeGreaterThan(100);
    // …and the live root is still inline-untouched.
    expect(after.mainInlineStyle).toBeNull();
    expect(after.sibling.frozen).toBe('true');

    // Undo releases the held height along with the pins.
    await page.keyboard.press('ControlOrMeta+z');
    const undone = await page.evaluate(() => {
      const main = document.querySelector('#doc-main');
      return {
        footerTop: document.querySelector('[data-testid="page-footer"]').getBoundingClientRect().top,
        mainStyle: main.getAttribute('style'),
        mainFlexFrozen: main.getAttribute('data-wfp-edit-flex-frozen'),
        heightMarker: main.getAttribute('data-wfp-edit-flat-root-height'),
        blockStyle: document.querySelector('[data-testid="doc-block-0"]').getAttribute('style'),
      };
    });
    expect(Math.abs(undone.footerTop - footerBefore)).toBeLessThan(2);
    expect(undone.mainStyle).toBe(mainAttrsBefore.style);
    expect(undone.mainFlexFrozen).toBe(mainAttrsBefore.flexFrozen);
    expect(undone.heightMarker).toBeNull();
    expect(undone.blockStyle).toBeNull();
  });

  test('export after a direct-child drag preserves the footer position in the standalone file', async ({ page, context }) => {
    await loadHeaderMainFooterPage(page);

    await page.locator('[data-testid="doc-block-0"]').click();
    await dragBySelector(page, '[data-testid="doc-block-0"]', 40, 20);
    const liveFooterTop = await getFooterTop(page);

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

    // Editor residue is fully scrubbed; the held height became inline on the
    // exported root (the only element allowed to gain inline style at
    // export time, precisely because the live DOM never carries it).
    expect(html).not.toMatch(/data-wfp-edit[-a-zA-Z]*=/);
    expect(html).not.toContain('id="wfp-editor-root"');

    const exportedPage = await context.newPage();
    await exportedPage.goto(`file://${outPath}`);
    const exported = await exportedPage.evaluate(() => ({
      footerTop: document.querySelector('[data-testid="page-footer"]').getBoundingClientRect().top,
      mainInlineHeight: document.querySelector('#doc-main').style.height,
    }));
    expect(exported.mainInlineHeight).not.toBe('');
    expect(Math.abs(exported.footerTop - liveFooterTop)).toBeLessThanOrEqual(1);
    await exportedPage.close();
  });
});
