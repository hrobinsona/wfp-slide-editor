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
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  EDITOR_PATH,
  disableFsa,
  EDITOR_MARKER_ATTR_RE,
  pressResizeHandle,
  moveResizeGesture,
  releaseResizeGesture,
  dragResizeHandle,
} from './_helpers.js';

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

// mousedown+mouseup on a resize handle at the exact same point — no
// mousemove in between, so the deadzone never opens. Race-free grab via
// the resize-gesture helpers (see the note in tests/_helpers.js).
async function zeroMoveHandleClick(page, dir) {
  const start = await pressResizeHandle(page, dir);
  await releaseResizeGesture(page, start);
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

    await zeroMoveHandleClick(page, 'se');

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

    await zeroMoveHandleClick(page, 'se');

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
    await dragResizeHandle(page, 'se', 60, 40, { steps: 4 });

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
//
// `padded: false` removes the root's padding and moves the blocks' margins
// to the vertical axis, so the children's margins COLLAPSE THROUGH the root
// (see the padding-less describe block below).
async function loadHeaderMainFooterPage(page, { padded = true } = {}) {
  await disableFsa(page);
  await page.setContent(`
    <!doctype html>
    <html>
    <head><style>
      * { box-sizing: border-box; }
      body { margin: 0; font-family: system-ui, sans-serif; }
      header { height: 80px; background: rgb(221, 232, 240); }
      main { position: relative; ${padded ? 'padding: 20px;' : ''} background: rgb(251, 252, 253); }
      .doc-block { height: 120px; margin: ${padded ? '0 0 20px' : '24px 0'}; background: rgb(228, 236, 248); }
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

// Cmd+S with the FSA API disabled (see disableFsa) → legacy download.
async function saveExportedHtml(page) {
  const downloadPromise = page.waitForEvent('download', { timeout: 8_000 });
  await page.keyboard.press('ControlOrMeta+s');
  const download = await downloadPromise;
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const outPath = path.join(
    OUTPUT_DIR,
    `${Date.now()}-${Math.random().toString(16).slice(2)}-${download.suggestedFilename()}`,
  );
  await download.saveAs(outPath);
  return { outPath, html: fs.readFileSync(outPath, 'utf-8') };
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
    expect(html).not.toMatch(EDITOR_MARKER_ATTR_RE);
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

// ---------------------------------------------------------------------------
// Review round — a PADDING-LESS flat root. With no padding or border on the
// root, the children's vertical margins collapse THROUGH it: the first
// child's top margin is the root's top margin and the last child's bottom
// margin is its bottom margin. Pinning the children absolute deletes both,
// so holding the root's border-box height left content below it ~48px high
// (24px of collapsed top margin + 24px of bottom margin that an explicit
// height also stops collapsing). The held height must preserve the position
// of what FOLLOWS the root, not the root's own border box.
// ---------------------------------------------------------------------------

test.describe('v2.15 — a padding-less flat root holds following content in place', () => {
  test('a direct-child drag leaves the footer and the pinned sibling pixel-stable', async ({ page }) => {
    await loadHeaderMainFooterPage(page, { padded: false });

    const before = await page.evaluate(() => ({
      footerTop: document.querySelector('[data-testid="page-footer"]').getBoundingClientRect().top,
      siblingTop: document.querySelector('[data-testid="doc-block-1"]').getBoundingClientRect().top,
    }));

    await page.locator('[data-testid="doc-block-0"]').click();
    await dragBySelector(page, '[data-testid="doc-block-0"]', 40, 20);

    const after = await page.evaluate(() => {
      const main = document.querySelector('#doc-main');
      return {
        footerTop: document.querySelector('[data-testid="page-footer"]').getBoundingClientRect().top,
        siblingTop: document.querySelector('[data-testid="doc-block-1"]').getBoundingClientRect().top,
        mainInlineStyle: main.getAttribute('style'),
        heldHeight: parseFloat(main.getAttribute('data-wfp-edit-flat-root-height')),
        borderBoxHeight: main.getBoundingClientRect().height,
      };
    });

    // Content BELOW the root does not move — the whole point of the hold.
    expect(Math.abs(after.footerTop - before.footerTop)).toBeLessThan(2);
    // …nor does the pinned sibling INSIDE it (margin-collapse re-anchoring).
    expect(Math.abs(after.siblingTop - before.siblingTop)).toBeLessThan(2);
    // The held height exceeds the pre-pin border box precisely because it
    // absorbs the margins that used to collapse through the root.
    expect(after.heldHeight).toBeGreaterThan(264 + 40);
    expect(after.borderBoxHeight).toBeCloseTo(after.heldHeight, 0);
    // The live root is still inline-untouched.
    expect(after.mainInlineStyle).toBeNull();

    // Undo releases the hold and restores the collapsed-margin layout.
    await page.keyboard.press('ControlOrMeta+z');
    const undone = await page.evaluate(() => ({
      footerTop: document.querySelector('[data-testid="page-footer"]').getBoundingClientRect().top,
      heightMarker: document.querySelector('#doc-main').getAttribute('data-wfp-edit-flat-root-height'),
      blockStyle: document.querySelector('[data-testid="doc-block-0"]').getAttribute('style'),
    }));
    expect(Math.abs(undone.footerTop - before.footerTop)).toBeLessThan(2);
    expect(undone.heightMarker).toBeNull();
    expect(undone.blockStyle).toBeNull();
  });

  test('the corrected height is what the export persists', async ({ page, context }) => {
    await loadHeaderMainFooterPage(page, { padded: false });

    const footerBefore = await getFooterTop(page);
    await page.locator('[data-testid="doc-block-0"]').click();
    await dragBySelector(page, '[data-testid="doc-block-0"]', 40, 20);

    const { outPath, html } = await saveExportedHtml(page);
    expect(html).not.toMatch(EDITOR_MARKER_ATTR_RE);

    const exportedPage = await context.newPage();
    await exportedPage.goto(`file://${outPath}`);
    const exportedFooterTop = await exportedPage.evaluate(
      () => document.querySelector('[data-testid="page-footer"]').getBoundingClientRect().top
    );
    expect(Math.abs(exportedFooterTop - footerBefore)).toBeLessThan(2);
    await exportedPage.close();
  });
});

// ---------------------------------------------------------------------------
// Review round — resize anchors are applied at first-move, not mousedown, so
// they must be read then too: a layout shift between the press and the first
// move past the deadzone must not snap the element back to a stale anchor.
// ---------------------------------------------------------------------------

test.describe('v2.15 — resize anchors are fresh at deadzone activation', () => {
  test('a layout shift between mousedown and first move does not snap the element back', async ({ page }) => {
    await loadDocumentWithEditor(page, 'foreign-deck.html');
    await page.keyboard.press('e');

    const target = page.locator('.slide.active [data-testid="resize-target"]');
    await target.click();
    const before = await target.evaluate((el) => ({
      left: el.offsetLeft,
      width: el.offsetWidth,
    }));

    const handle = page.locator(`${ROOT} .wfpe-handle-se`);
    await expect(handle).not.toHaveCSS('display', 'none');
    const start = await pressResizeHandle(page, 'se');

    // Mid-gesture, before the pointer has left the deadzone, something else
    // moves the element (simulating a late layout shift).
    await target.evaluate((el) => {
      el.style.left = `${el.offsetLeft + 40}px`;
    });

    const end = { x: start.x + 30, y: start.y + 20 };
    await moveResizeGesture(page, start, end, { steps: 4 });
    await releaseResizeGesture(page, end);

    const after = await target.evaluate((el) => ({
      left: el.offsetLeft,
      width: el.offsetWidth,
    }));
    // A south-east resize never writes `left`, so the element must stay at
    // its SHIFTED position — a stale mousedown-time anchor would snap it
    // back to the original left.
    expect(after.left).toBe(before.left + 40);
    expect(after.width).toBeGreaterThanOrEqual(before.width + 25);
  });
});

// ---------------------------------------------------------------------------
// Review round — static non-flat root fallback. A computed-static .slide
// cannot anchor absolute children without a write, so it deliberately takes
// the ordinary container pin (inline position:relative plus dimension
// locks — the documented tradeoff in DESIGN.md). This exercises that branch,
// which no public fixture reaches (foreign-deck slides are absolute).
// ---------------------------------------------------------------------------

async function loadStaticSlideDeck(page) {
  await disableFsa(page);
  await page.setContent(`
    <!doctype html>
    <html>
    <head><style>
      * { box-sizing: border-box; }
      body { margin: 0; font-family: system-ui, sans-serif; }
      #static-pres { width: 100vw; }
      .slide { padding: 24px; background: rgb(247, 248, 251); }
      .slide:not(.active) { display: none; }
      .slide h2 { margin: 0 0 16px; }
      .stack-item { height: 110px; margin: 0 0 14px; background: rgb(226, 236, 244); }
    </style></head>
    <body>
      <div id="static-pres">
        <section class="slide active">
          <h2 data-testid="static-heading">Static slide</h2>
          <div class="stack-item" data-testid="stack-item-0">Item 0</div>
          <div class="stack-item" data-testid="stack-item-1">Item 1</div>
          <script data-testid="slide-script">window.__slideScriptRan = true;</script>
        </section>
        <section class="slide"><h2>Second</h2></section>
      </div>
    </body>
    </html>
  `);
  await page.addScriptTag({ path: EDITOR_PATH });
  await page.waitForFunction(() => window.__wfpEditorReady === true, null, { timeout: 10_000 });
  // Sanity: resolved as a (foreign) deck whose active slide is static.
  expect(await page.evaluate(() => ({
    rootMarked: document.querySelector('#static-pres')?.getAttribute('data-wfp-edit-deck-root'),
    slidePosition: getComputedStyle(document.querySelector('.slide.active')).position,
  }))).toEqual({ rootMarked: 'true', slidePosition: 'static' });
  await page.keyboard.press('e');
}

test.describe('v2.15 — static non-flat slide root falls back to the container pin', () => {
  test('dragging a direct child of a static slide pins siblings via the inline container fallback and undoes cleanly', async ({ page }) => {
    await loadStaticSlideDeck(page);

    const headingBefore = await page.locator('[data-testid="static-heading"]').evaluate((el) => {
      const r = el.getBoundingClientRect();
      return { left: r.left, top: r.top };
    });

    await page.locator('[data-testid="stack-item-0"]').click();
    await dragBySelector(page, '[data-testid="stack-item-0"]', 45, 25);

    const after = await page.evaluate(() => {
      const slide = document.querySelector('.slide.active');
      const heading = document.querySelector('[data-testid="static-heading"]');
      const headingRect = heading.getBoundingClientRect();
      return {
        slideInline: slide.getAttribute('style') || '',
        slideFlexFrozen: slide.getAttribute('data-wfp-edit-flex-frozen'),
        headingFrozen: heading.getAttribute('data-wfp-edit-frozen'),
        headingLeft: headingRect.left,
        headingTop: headingRect.top,
      };
    });

    // The documented fallback: the static slide takes the ordinary container
    // pin — inline positioning context plus dimension locks…
    expect(after.slideInline).toContain('position: relative');
    expect(after.slideInline).toMatch(/width: \d/);
    expect(after.slideInline).toMatch(/height: \d/);
    expect(after.slideFlexFrozen).toBe('true');
    // …and the sibling heading holds its place.
    expect(after.headingFrozen).toBe('true');
    expect(Math.abs(after.headingLeft - headingBefore.left)).toBeLessThan(2);
    expect(Math.abs(after.headingTop - headingBefore.top)).toBeLessThan(2);

    // One undo unwinds the entire fallback pin, slide included.
    await page.keyboard.press('ControlOrMeta+z');
    expect(await page.evaluate(() => {
      const slide = document.querySelector('.slide.active');
      return {
        slideInline: slide.getAttribute('style'),
        slideFlexFrozen: slide.getAttribute('data-wfp-edit-flex-frozen'),
        headingStyle: document.querySelector('[data-testid="static-heading"]').getAttribute('style'),
        itemStyle: document.querySelector('[data-testid="stack-item-0"]').getAttribute('style'),
      };
    })).toEqual({
      slideInline: null,
      slideFlexFrozen: null,
      headingStyle: null,
      itemStyle: null,
    });
  });

  // The container pin path must honour the same non-rendered/editor-DOM
  // exclusions the root path does. A <script> child of the static slide used
  // to be pinned as `position: absolute; ... width: 0px; height: 0px`, and
  // that inline style survived export — the scrubber only removes
  // data-wfp-edit-* attributes.
  test('a script child of the static slide is never inline-styled, live or in the export', async ({ page }) => {
    await loadStaticSlideDeck(page);

    await page.locator('[data-testid="stack-item-0"]').click();
    await dragBySelector(page, '[data-testid="stack-item-0"]', 45, 25);

    // Sanity: the drag really did take the container pin path.
    expect(await page.evaluate(
      () => document.querySelector('.slide.active').getAttribute('data-wfp-edit-flex-frozen')
    )).toBe('true');

    expect(await page.locator('[data-testid="slide-script"]').evaluate((el) => ({
      style: el.getAttribute('style'),
      frozen: el.getAttribute('data-wfp-edit-frozen'),
    }))).toEqual({ style: null, frozen: null });

    const { html } = await saveExportedHtml(page);
    expect(html).not.toMatch(/<script[^>]*\sstyle=/i);
    expect(html).toContain('window.__slideScriptRan');
  });
});

// ---------------------------------------------------------------------------
// Review round — a stale flex-frozen latch on the root. A PARTIAL group Reset
// keeps the root latched (one deliberately-edited child holds the container
// record) while restoring its other children to flow. The latch then no
// longer describes reality, and a later direct-child unlock that trusted it
// skipped sibling pinning altogether: the restored siblings collapsed
// upwards by a full block height.
// ---------------------------------------------------------------------------

// `padded: false` lets the blocks' margins collapse through the root (the
// height-hold cases below); `rootTransform` scales the root itself, which
// must not affect any layout-space measurement the hold makes.
async function loadPartialResetPage(page, { padded = true, rootTransform = '' } = {}) {
  await disableFsa(page);
  await page.setContent(`
    <!doctype html>
    <html>
    <head><style>
      * { box-sizing: border-box; }
      body { margin: 0; font-family: system-ui, sans-serif; }
      header { height: 40px; background: rgb(221, 232, 240); }
      main { position: relative; ${padded ? 'padding: 16px;' : ''} ${rootTransform} background: rgb(251, 252, 253); }
      .doc-block { height: 90px; margin: ${padded ? '0 0 16px' : '24px 0'}; background: rgb(228, 236, 248); }
      footer { height: 40px; background: rgb(204, 216, 224); }
    </style></head>
    <body>
      <header>Page header</header>
      <main id="doc-main">
        <div class="doc-block" data-testid="doc-block-0">Block 0</div>
        <div class="doc-block" data-testid="doc-block-1">Block 1</div>
        <div class="doc-block" data-testid="doc-block-2">Block 2</div>
        <div class="doc-block" data-testid="doc-block-3">Block 3</div>
      </main>
      <footer data-testid="page-footer">Page footer</footer>
    </body>
    </html>
  `);
  await page.addScriptTag({ path: EDITOR_PATH });
  await page.waitForFunction(() => window.__wfpEditorReady === true, null, { timeout: 10_000 });
  await page.keyboard.press('e');
}

function getRootChildTops(page) {
  return page.evaluate(() =>
    [...document.querySelectorAll('#doc-main > *')].map(
      (el) => el.getBoundingClientRect().top
    )
  );
}

test.describe('v2.15 — a stale root latch does not disable sibling pinning', () => {
  test('a direct-child unlock after a PARTIAL group Reset still pins the siblings left in flow', async ({ page }) => {
    await loadPartialResetPage(page);

    // 1. Unlock block 0 — pins all four children and latches the root.
    await page.locator('[data-testid="doc-block-0"]').click();
    await dragBySelector(page, '[data-testid="doc-block-0"]', 30, 15);

    // 2. Deliberately move an already-pinned sibling so Reset must retain it.
    await page.locator('[data-testid="doc-block-2"]').click();
    await dragBySelector(page, '[data-testid="doc-block-2"]', 20, 10);

    // 3. Reset block 0. Block 2's retained edit keeps the root's record (and
    //    so its latch) while blocks 0, 1 and 3 go back into flow.
    await page.locator('[data-testid="doc-block-0"]').click();
    await page.locator(RESET_BTN).click();
    const afterReset = await page.evaluate(() => {
      const main = document.querySelector('#doc-main');
      return {
        rootFlexFrozen: main.getAttribute('data-wfp-edit-flex-frozen'),
        restoredToFlow: ['doc-block-0', 'doc-block-1', 'doc-block-3'].map(
          (id) => document.querySelector(`[data-testid="${id}"]`).getAttribute('style')
        ),
        retained: document.querySelector('[data-testid="doc-block-2"]').getAttribute('data-wfp-edit-frozen'),
      };
    });
    expect(afterReset.rootFlexFrozen).toBe('true');
    expect(afterReset.restoredToFlow).toEqual([null, null, null]);
    expect(afterReset.retained).toBe('true');

    // 4. Unlock one of the siblings that returned to flow. The stale latch
    //    must not suppress the pin: nothing else may move.
    const topsBefore = await getRootChildTops(page);
    const retainedStyleBefore = await page.evaluate(
      () => document.querySelector('[data-testid="doc-block-2"]').getAttribute('style')
    );
    await page.locator('[data-testid="doc-block-1"]').click();
    await dragBySelector(page, '[data-testid="doc-block-1"]', 40, 20);
    const topsAfter = await getRootChildTops(page);

    for (const index of [0, 2, 3]) {
      expect(Math.abs(topsAfter[index] - topsBefore[index])).toBeLessThan(2);
    }
    // The dragged block followed the pointer, and the siblings that were in
    // flow got pinned; the retained one keeps its own edit untouched.
    expect(topsAfter[1] - topsBefore[1]).toBeCloseTo(20, 0);
    expect(await page.evaluate(() => ({
      block0: document.querySelector('[data-testid="doc-block-0"]').getAttribute('data-wfp-edit-frozen'),
      block3: document.querySelector('[data-testid="doc-block-3"]').getAttribute('data-wfp-edit-frozen'),
      block2Style: document.querySelector('[data-testid="doc-block-2"]').getAttribute('style'),
    }))).toEqual({
      block0: 'true',
      block3: 'true',
      block2Style: retainedStyleBefore,
    });
  });
});

// ---------------------------------------------------------------------------
// Review round 4 — the height hold is DERIVED state, valid only for the set
// of children pinned right now. Two ways a one-shot measurement went wrong:
//
//   1. A partial Reset returns some children to flow, which re-enables the
//      margin collapse-through the hold was compensating for. The stale hold
//      pushed following content down by the collapsed margin — and the wrong
//      value reached the exported file.
//   2. Reading the anchor through getBoundingClientRect and dividing by the
//      canvas scale overshoots by 1/scale when the flat root ITSELF carries
//      transform: scale() — a transform does not move a following sibling,
//      because it does not affect layout. Anchors are layout-space
//      (offsetTop) reads instead, so no scale conversion is involved at all.
// ---------------------------------------------------------------------------

// Drag block 0 (pins every child), deliberately move block 2 so a Reset must
// retain it, then Reset block 0 — leaving one pinned child and three back in
// flow. Returns the footer's viewport top from before any editing.
async function partiallyResetPaddinglessRoot(page) {
  await loadPartialResetPage(page, { padded: false });
  const footerBefore = await getFooterTop(page);

  await page.locator('[data-testid="doc-block-0"]').click();
  await dragBySelector(page, '[data-testid="doc-block-0"]', 30, 15);
  const heldWhileFullyPinned = await page.evaluate(
    () => document.querySelector('#doc-main').getAttribute('data-wfp-edit-flat-root-height')
  );

  await page.locator('[data-testid="doc-block-2"]').click();
  await dragBySelector(page, '[data-testid="doc-block-2"]', 20, 10);

  await page.locator('[data-testid="doc-block-0"]').click();
  await page.locator(RESET_BTN).click();

  return { footerBefore, heldWhileFullyPinned };
}

test.describe('v2.15 — the flat-root hold is re-derived when the pinned set changes', () => {
  test('a partial Reset re-derives the hold, and undo/redo round-trip it', async ({ page }) => {
    const { footerBefore, heldWhileFullyPinned } = await partiallyResetPaddinglessRoot(page);

    const afterReset = await page.evaluate(() => {
      const main = document.querySelector('#doc-main');
      return {
        footerTop: document.querySelector('[data-testid="page-footer"]').getBoundingClientRect().top,
        held: main.getAttribute('data-wfp-edit-flat-root-height'),
        offsetHeight: main.offsetHeight,
        inlineStyle: main.getAttribute('style'),
        pinnedChildren: [...main.children].filter(
          (c) => c.getAttribute('data-wfp-edit-frozen') === 'true'
        ).length,
      };
    });

    // The partial Reset really did leave one pinned child among three that
    // went back into flow…
    expect(afterReset.pinnedChildren).toBe(1);
    // …following content did not move…
    expect(Math.abs(afterReset.footerTop - footerBefore)).toBeLessThan(2);
    // …because the hold was re-derived rather than left at its pin-time
    // value (which is now too tall by the re-enabled collapsed margin)…
    expect(afterReset.held).not.toBe(heldWhileFullyPinned);
    expect(afterReset.offsetHeight).toBeCloseTo(parseFloat(afterReset.held), 0);
    // …and the live root is still inline-untouched.
    expect(afterReset.inlineStyle).toBeNull();

    // Undo returns to the fully-pinned state (hold back at its old value),
    // redo returns to the corrected one. Following content is stable at
    // every step — the re-derivation rides inside the Reset's own entry.
    await page.keyboard.press('ControlOrMeta+z');
    const undone = await page.evaluate(() => ({
      footerTop: document.querySelector('[data-testid="page-footer"]').getBoundingClientRect().top,
      held: document.querySelector('#doc-main').getAttribute('data-wfp-edit-flat-root-height'),
      pinnedChildren: [...document.querySelector('#doc-main').children].filter(
        (c) => c.getAttribute('data-wfp-edit-frozen') === 'true'
      ).length,
    }));
    expect(undone.pinnedChildren).toBe(4);
    expect(undone.held).toBe(heldWhileFullyPinned);
    expect(Math.abs(undone.footerTop - footerBefore)).toBeLessThan(2);

    await page.keyboard.press('ControlOrMeta+Shift+z');
    const redone = await page.evaluate(() => ({
      footerTop: document.querySelector('[data-testid="page-footer"]').getBoundingClientRect().top,
      held: document.querySelector('#doc-main').getAttribute('data-wfp-edit-flat-root-height'),
    }));
    expect(redone.held).toBe(afterReset.held);
    expect(Math.abs(redone.footerTop - footerBefore)).toBeLessThan(2);
  });

  test('the export after a partial Reset carries the re-derived hold, not the stale one', async ({ page, context }) => {
    const { footerBefore, heldWhileFullyPinned } = await partiallyResetPaddinglessRoot(page);
    const held = await page.evaluate(
      () => document.querySelector('#doc-main').getAttribute('data-wfp-edit-flat-root-height')
    );

    const { outPath, html } = await saveExportedHtml(page);
    expect(html).not.toMatch(EDITOR_MARKER_ATTR_RE);

    const exportedPage = await context.newPage();
    await exportedPage.goto(`file://${outPath}`);
    const exported = await exportedPage.evaluate(() => ({
      footerTop: document.querySelector('[data-testid="page-footer"]').getBoundingClientRect().top,
      mainInlineHeight: document.querySelector('#doc-main').style.height,
    }));
    expect(exported.mainInlineHeight).toBe(`${held}px`);
    expect(exported.mainInlineHeight).not.toBe(`${heldWhileFullyPinned}px`);
    expect(Math.abs(exported.footerTop - footerBefore)).toBeLessThan(2);
    await exportedPage.close();
  });

  test('a flat root that carries its own transform: scale() holds the right height', async ({ page }) => {
    await loadPartialResetPage(page, {
      padded: false,
      rootTransform: 'transform: scale(0.5); transform-origin: top left;',
    });

    const before = await page.evaluate(() => ({
      footerTop: document.querySelector('[data-testid="page-footer"]').getBoundingClientRect().top,
      footerOffsetTop: document.querySelector('[data-testid="page-footer"]').offsetTop,
    }));

    await page.locator('[data-testid="doc-block-0"]').click();
    await dragBySelector(page, '[data-testid="doc-block-0"]', 30, 15);

    const after = await page.evaluate(() => {
      const main = document.querySelector('#doc-main');
      const footer = document.querySelector('[data-testid="page-footer"]');
      return {
        footerTop: footer.getBoundingClientRect().top,
        footerOffsetTop: footer.offsetTop,
        held: parseFloat(main.getAttribute('data-wfp-edit-flat-root-height')),
        offsetHeight: main.offsetHeight,
      };
    });

    // The scale is a transform: it changes nothing about where the footer
    // sits in layout, so the hold must be the same value it would be at
    // scale 1 — a residual divided by the root's own scale overshoots.
    expect(Math.abs(after.footerOffsetTop - before.footerOffsetTop)).toBeLessThan(2);
    expect(Math.abs(after.footerTop - before.footerTop)).toBeLessThan(2);
    expect(after.offsetHeight).toBeCloseTo(after.held, 0);
  });
});

// A full Reset releases the hold target along with the marker. Undoing that
// Reset brings every pin back from a history snapshot — with no target to
// re-derive against — so the reconcile that runs after undo/redo has to
// re-adopt one. Without it the NEXT partial Reset has nothing to solve
// towards and silently reproduces the stale-hold shift.
test.describe('v2.15 — the hold survives an undo of a full Reset', () => {
  test('a partial Reset after undoing a full Reset still holds following content', async ({ page }) => {
    await loadPartialResetPage(page, { padded: false });
    const footerBefore = await getFooterTop(page);

    await page.locator('[data-testid="doc-block-0"]').click();
    await dragBySelector(page, '[data-testid="doc-block-0"]', 30, 15);
    await page.locator(RESET_BTN).click();
    expect(await page.evaluate(
      () => document.querySelector('#doc-main').getAttribute('data-wfp-edit-flat-root-height')
    )).toBeNull();

    await page.keyboard.press('ControlOrMeta+z');
    const restored = await page.evaluate(() => ({
      held: document.querySelector('#doc-main').getAttribute('data-wfp-edit-flat-root-height'),
      pinned: [...document.querySelector('#doc-main').children].filter(
        (c) => c.getAttribute('data-wfp-edit-frozen') === 'true'
      ).length,
    }));
    expect(restored.pinned).toBe(4);
    expect(restored.held).not.toBeNull();

    // Deliberate edit on a sibling, then a partial Reset of the original.
    await page.locator('[data-testid="doc-block-2"]').click();
    await dragBySelector(page, '[data-testid="doc-block-2"]', 20, 10);
    await page.locator('[data-testid="doc-block-0"]').click();
    await page.locator(RESET_BTN).click();

    const after = await page.evaluate(() => ({
      footerTop: document.querySelector('[data-testid="page-footer"]').getBoundingClientRect().top,
      held: document.querySelector('#doc-main').getAttribute('data-wfp-edit-flat-root-height'),
      pinned: [...document.querySelector('#doc-main').children].filter(
        (c) => c.getAttribute('data-wfp-edit-frozen') === 'true'
      ).length,
    }));
    expect(after.pinned).toBe(1);
    expect(after.held).not.toBe(restored.held);
    expect(Math.abs(after.footerTop - footerBefore)).toBeLessThan(2);
  });
});

// ---------------------------------------------------------------------------
// Merge-gate review — element DELETE is a pinned-set transition too. Unlocking
// a flat root's children and then deleting them (inspector button or
// Backspace/Delete) took the pinned set to zero without re-deriving the hold:
// the marker and its !important rule stayed at the pre-delete value, propping
// an emptied root open — and the stale height was baked into the EXPORTED
// file. Insert (paste/duplicate) funnels through the same history entry point.
// ---------------------------------------------------------------------------

async function unlockThenSelect(page, testid) {
  await page.locator('[data-testid="doc-block-0"]').click();
  await dragBySelector(page, '[data-testid="doc-block-0"]', 30, 15);
  await page.locator(`[data-testid="${testid}"]`).click();
}

function readHoldState(page) {
  return page.evaluate(() => {
    const main = document.querySelector('#doc-main');
    return {
      held: main.getAttribute('data-wfp-edit-flat-root-height'),
      offsetHeight: main.offsetHeight,
      childCount: main.children.length,
      footerTop: document.querySelector('[data-testid="page-footer"]').getBoundingClientRect().top,
    };
  });
}

test.describe('v2.15 — deleting pinned children releases the flat-root hold', () => {
  test('deleting every pinned child collapses the root live AND in the export', async ({ page, context }) => {
    await loadPartialResetPage(page, { padded: false });
    const emptyFooterTop = await page.evaluate(() => {
      // Where the footer sits with an empty root: the invariant an emptied
      // document must land on, measured before any editing.
      const main = document.querySelector('#doc-main');
      const kept = [...main.children];
      kept.forEach((c) => c.remove());
      const top = document.querySelector('[data-testid="page-footer"]').getBoundingClientRect().top;
      kept.forEach((c) => main.appendChild(c));
      return top;
    });

    await unlockThenSelect(page, 'doc-block-0');
    expect((await readHoldState(page)).held).not.toBeNull();

    // Delete every child: the first via the inspector button, the rest via
    // the Backspace shortcut — both route through deleteSelectedElement.
    await page.locator(`${ROOT} .wfpe-inspector .wfpe-delete-btn`).click();
    for (const id of ['doc-block-1', 'doc-block-2', 'doc-block-3']) {
      await page.locator(`[data-testid="${id}"]`).click();
      await page.keyboard.press('Backspace');
    }

    const emptied = await readHoldState(page);
    expect(emptied.childCount).toBe(0);
    // The hold is released, so the emptied root is not propped open…
    expect(emptied.held).toBeNull();
    expect(emptied.offsetHeight).toBeLessThan(20);
    expect(Math.abs(emptied.footerTop - emptyFooterTop)).toBeLessThan(2);

    // …and the export agrees with the live document.
    const { outPath, html } = await saveExportedHtml(page);
    expect(html).not.toMatch(EDITOR_MARKER_ATTR_RE);
    const exportedPage = await context.newPage();
    await exportedPage.goto(`file://${outPath}`);
    const exported = await exportedPage.evaluate(() => ({
      inlineHeight: document.querySelector('#doc-main').style.height,
      footerTop: document.querySelector('[data-testid="page-footer"]').getBoundingClientRect().top,
    }));
    expect(exported.inlineHeight).toBe('');
    expect(Math.abs(exported.footerTop - emptied.footerTop)).toBeLessThan(2);
    await exportedPage.close();
  });

  test('undoing the delete re-derives the hold instead of leaving the root collapsed', async ({ page }) => {
    await loadPartialResetPage(page, { padded: false });
    const footerBefore = await getFooterTop(page);

    await unlockThenSelect(page, 'doc-block-0');
    const pinned = await readHoldState(page);
    const blockTops = await getRootChildTops(page);

    // Delete all four, then undo all four deletes.
    await page.locator(`${ROOT} .wfpe-inspector .wfpe-delete-btn`).click();
    for (const id of ['doc-block-1', 'doc-block-2', 'doc-block-3']) {
      await page.locator(`[data-testid="${id}"]`).click();
      await page.keyboard.press('Backspace');
    }
    expect((await readHoldState(page)).held).toBeNull();

    for (let i = 0; i < 4; i++) await page.keyboard.press('ControlOrMeta+z');

    const restored = await readHoldState(page);
    expect(restored.childCount).toBe(4);
    // The hold came back — the re-attached children are pinned again, so the
    // root must hold its box open exactly as before the deletes.
    expect(restored.held).toBe(pinned.held);
    expect(Math.abs(restored.footerTop - footerBefore)).toBeLessThan(2);
    expect(await getRootChildTops(page)).toEqual(blockTops);
  });

  test('pasting into a held root leaves the hold and following content alone', async ({ page }) => {
    await loadPartialResetPage(page, { padded: false });
    const footerBefore = await getFooterTop(page);

    await unlockThenSelect(page, 'doc-block-1');
    const held = (await readHoldState(page)).held;

    await page.keyboard.press('ControlOrMeta+c');
    await page.keyboard.press('ControlOrMeta+v');

    const after = await readHoldState(page);
    expect(after.childCount).toBe(5);
    expect(after.held).toBe(held);
    expect(Math.abs(after.footerTop - footerBefore)).toBeLessThan(2);
  });
});

// ---------------------------------------------------------------------------
// Merge-gate review — the v2.13 live refresh replaces the whole document
// (document.open/write/close) and re-injects the editor, so a new editor
// closure gets fresh module state and the old editor root — including the
// dynamic height rule's <style> — is destroyed with the old document. This
// asserts that end state rather than trusting it: no marker and no rule may
// survive into the new generation, and the refreshed document must still
// export clean.
// ---------------------------------------------------------------------------

const FLAT_FIXTURE_PATH = path.join(
  path.resolve(__dirname, '..'), 'fixtures', 'flat-document.html'
);

async function installFlatFsaStub(page) {
  await page.addInitScript(() => {
    window.__fsa = { written: [], file: { content: null, lastModified: 1000 } };
    const handle = {
      name: 'flat-document.html',
      queryPermission: async () => 'granted',
      requestPermission: async () => 'granted',
      getFile: async () => ({
        lastModified: window.__fsa.file.lastModified,
        text: async () => window.__fsa.file.content,
      }),
      createWritable: async () => {
        let buf = '';
        return {
          write: async (data) => { buf += String(data); },
          close: async () => {
            window.__fsa.file.content = buf;
            window.__fsa.file.lastModified += 1000;
            window.__fsa.written.push(buf);
          },
        };
      },
    };
    window.showSaveFilePicker = async () => handle;
  });
}

async function saveInPlace(page, expectedWrites) {
  await page.keyboard.press('ControlOrMeta+s');
  await page.waitForFunction((n) => window.__fsa.written.length === n, expectedWrites);
  return page.evaluate(() => window.__fsa.written[window.__fsa.written.length - 1]);
}

test.describe('v2.15 — a live refresh carries no hold residue into the new generation', () => {
  test('the refreshed document has no marker, no rule, and exports clean', async ({ page }) => {
    await installFlatFsaStub(page);
    await page.goto(pathToFileURL(FLAT_FIXTURE_PATH).href);
    await page.addScriptTag({ path: EDITOR_PATH });
    await page.waitForFunction(() => window.__wfpEditorReady === true, null, { timeout: 10_000 });
    await page.keyboard.press('e');

    await selectAndDragHero(page, 60, 30);
    expect(await page.evaluate(
      () => document.querySelector('#flat-article').getAttribute('data-wfp-edit-flat-root-height')
    )).not.toBeNull();

    // The saved file carries the geometry as inline height (the documented
    // export persistence) and no editor markers.
    const saved = await saveInPlace(page, 1);
    expect(saved).not.toMatch(EDITOR_MARKER_ATTR_RE);
    expect(saved).toMatch(/<main id="flat-article"[^>]*style="[^"]*height:/);

    // An "agent" rewrites the same file; the editor swaps it in place.
    await page.evaluate((content) => {
      window.__fsa.file.content = content;
      window.__fsa.file.lastModified += 1000;
    }, saved.replace('A practical guide', 'A revised guide'));
    await expect
      .poll(() => page.evaluate(() => window.__wfpEditorGeneration).catch(() => null),
        { timeout: 20_000 })
      .toBe(2);
    await page.waitForFunction(() => window.__wfpEditorReady === true, null, { timeout: 10_000 });

    const refreshed = await page.evaluate(() => {
      const editorRoot = document.getElementById('wfp-editor-root');
      return {
        markers: document.querySelectorAll('[data-wfp-edit-flat-root-height]').length,
        frozen: document.querySelectorAll('[data-wfp-edit-frozen]').length,
        // No editor-owned stylesheet may still be holding a height.
        holdRules: [...(editorRoot ? editorRoot.querySelectorAll('style') : [])].filter(
          (s) => (s.textContent || '').includes('flat-root-height')
        ).length,
        contentSwapped: document.body.textContent.includes('A revised guide'),
        inlineHeight: document.querySelector('#flat-article').style.height,
      };
    });
    expect(refreshed.contentSwapped).toBe(true);
    expect(refreshed.markers).toBe(0);
    expect(refreshed.frozen).toBe(0);
    expect(refreshed.holdRules).toBe(0);
    // The height the previous generation persisted rides in the file itself.
    expect(refreshed.inlineHeight).not.toBe('');

    // Saving the refreshed document is still clean.
    const resaved = await saveInPlace(page, 2);
    expect(resaved).not.toMatch(EDITOR_MARKER_ATTR_RE);
    expect(resaved).not.toContain('id="wfp-editor-root"');
  });
});
