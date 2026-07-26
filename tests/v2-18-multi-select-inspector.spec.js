// v2.18 — Multi-select Inspector: the inspector dock now shows (with a
// reduced control surface) whenever getSelectedElements().length >= 1,
// instead of hiding for anything but a single selection. Multi mode gets
// data-multi="true" on the dock; geometry/annotation stay hidden, font
// size + opacity + colour rows + Front/Reset remain live and write to
// every selected member in one history entry, Duplicate/Delete are
// visible-but-disabled (their functions already no-op on multi-selection).
//
// Load pattern follows tests/v2-17-bring-to-front.spec.js.
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { EDITOR_PATH, disableFsa } from './_helpers.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = path.join(__dirname, 'output');

const ROOT = '#wfp-editor-root';
const DOCK = `${ROOT} .wfpe-inspector-dock`;
const INSPECTOR = `${ROOT} .wfpe-inspector`;
const TITLE = `${ROOT} .wfpe-inspector-title`;
const POSITION_ROW = `${ROOT} [data-wfpe-row="position"]`;
const SIZE_ROW = `${ROOT} [data-wfpe-row="size"]`;
const ANNOTATION_ROW = `${ROOT} [data-wfpe-row="annotation"]`;
const DUPLICATE_BTN = `${ROOT} .wfpe-duplicate-btn`;
const DELETE_BTN = `${ROOT} .wfpe-delete-btn`;
const FRONT_BTN = `${ROOT} .wfpe-front-btn`;
const RESET_BTN = `${ROOT} .wfpe-reset-btn`;
const FONT_INPUT = `${ROOT} input[data-wfpe-prop="fontSize"]`;
const FONT_PLUS = `${ROOT} [data-action="font-plus"]`;
const OPACITY_INPUT = `${ROOT} input[data-wfpe-prop="opacity"]`;
const OPACITY_SLIDER = `${ROOT} input[data-wfpe-prop="opacitySlider"]`;

async function loadDocumentWithEditor(page, fixtureName) {
  await disableFsa(page);
  await page.goto(`/fixtures/${fixtureName}`, { timeout: 30_000 });
  await page.addScriptTag({ path: EDITOR_PATH });
  await page.waitForFunction(() => window.__wfpEditorReady === true, null, { timeout: 10_000 });
}

function fontSizeOf(page, selector) {
  return page.evaluate(
    (sel) => parseFloat(getComputedStyle(document.querySelector(sel)).fontSize),
    selector,
  );
}

function styleAttrOf(page, selector) {
  return page.evaluate((sel) => document.querySelector(sel).getAttribute('style'), selector);
}

async function selectTitleAndResizeTarget(page) {
  await page.locator('.slide.active .foreign-title').click();
  await page.locator('.slide.active .resize-target').click({ modifiers: ['ControlOrMeta'] });
}

// Mousedown/set-value/input/mouseup on the slider — the mousedown→input→
// mouseup session path (beginOpacitySession/endOpacityDrag), as opposed to
// the separate keyboard-driven lazily-opened session. Follows the same
// dispatchEvent pattern as tests/v2-9-opacity.spec.js rather than a real
// pointer drag: native <input type=range> thumb hit-testing over a real
// mouse move is unreliable across platforms/headless Chromium, especially
// on the inspector's short (246px panel) track.
async function dragOpacitySlider(page, targetPct) {
  await page.locator(OPACITY_SLIDER).evaluate((slider, pct) => {
    slider.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    slider.value = String(pct);
    slider.dispatchEvent(new Event('input', { bubbles: true }));
    slider.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  }, targetPct);
}

test.describe('v2.18 — multi-select inspector', () => {
  test('a 2-element selection shows a reduced inspector surface', async ({ page }) => {
    await loadDocumentWithEditor(page, 'foreign-deck.html');
    await page.keyboard.press('e');

    await selectTitleAndResizeTarget(page);

    await expect(page.locator(DOCK)).toHaveAttribute('data-visible', 'true');
    await expect(page.locator(DOCK)).toHaveAttribute('data-multi', 'true');
    await expect(page.locator(TITLE)).toHaveText('2 elements');

    await expect(page.locator(POSITION_ROW)).not.toBeVisible();
    await expect(page.locator(SIZE_ROW)).not.toBeVisible();
    await expect(page.locator(ANNOTATION_ROW)).not.toBeVisible();

    await expect(page.locator(DUPLICATE_BTN)).toBeDisabled();
    await expect(page.locator(DELETE_BTN)).toBeDisabled();
    // Front/Reset stay enabled and reachable for a multi-selection.
    await expect(page.locator(FRONT_BTN)).toBeEnabled();
    await expect(page.locator(RESET_BTN)).toBeEnabled();
  });

  test('a single selection keeps the full surface (regression guard)', async ({ page }) => {
    await loadDocumentWithEditor(page, 'foreign-deck.html');
    await page.keyboard.press('e');

    await page.locator('.slide.active .foreign-title').click();

    await expect(page.locator(DOCK)).toHaveAttribute('data-visible', 'true');
    await expect(page.locator(DOCK)).toHaveAttribute('data-multi', 'false');
    await expect(page.locator(TITLE)).toHaveText('Inspector');
    await expect(page.locator(POSITION_ROW)).toBeVisible();
    await expect(page.locator(SIZE_ROW)).toBeVisible();
    await expect(page.locator(DUPLICATE_BTN)).toBeEnabled();
    await expect(page.locator(DELETE_BTN)).toBeEnabled();
  });

  test('font + stepper steps two differently-sized text members by the same delta, preserving hierarchy, in one undo', async ({ page }) => {
    await loadDocumentWithEditor(page, 'foreign-deck.html');
    await page.keyboard.press('e');

    await selectTitleAndResizeTarget(page);
    const titleBefore = await fontSizeOf(page, '.slide.active .foreign-title');
    const targetBefore = await fontSizeOf(page, '.slide.active .resize-target');
    expect(titleBefore).not.toBeCloseTo(targetBefore, 0);

    await page.locator(FONT_PLUS).click();

    const titleAfter = await fontSizeOf(page, '.slide.active .foreign-title');
    const targetAfter = await fontSizeOf(page, '.slide.active .resize-target');
    expect(titleAfter).toBeCloseTo(titleBefore + 1, 0);
    expect(targetAfter).toBeCloseTo(targetBefore + 1, 0);

    // One undo restores both — proof the click pushed exactly one entry.
    await page.keyboard.press('ControlOrMeta+z');
    expect(await fontSizeOf(page, '.slide.active .foreign-title')).toBeCloseTo(titleBefore, 0);
    expect(await fontSizeOf(page, '.slide.active .resize-target')).toBeCloseTo(targetBefore, 0);
  });

  test('typed font size applies the same absolute value to every text member and skips a non-text member', async ({ page }) => {
    await loadDocumentWithEditor(page, 'foreign-deck.html');
    await page.keyboard.press('e');

    // .foreign-card has no direct text child node (only <strong>/<span>
    // descendants), so isTextBearing(card) is false — it's the non-text
    // member the font-size write must skip.
    await page.locator('.slide.active .foreign-card').click();
    await page.locator('.slide.active .foreign-title').click({ modifiers: ['ControlOrMeta'] });
    const cardStyleBefore = await styleAttrOf(page, '.slide.active .foreign-card');

    await page.locator(FONT_INPUT).fill('30');
    await page.locator(FONT_INPUT).press('Enter');

    expect(await fontSizeOf(page, '.slide.active .foreign-title')).toBeCloseTo(30, 0);
    expect(await styleAttrOf(page, '.slide.active .foreign-card')).toBe(cardStyleBefore);
  });

  test('opacity write applies to every member in one entry; mixed values show a Mixed placeholder', async ({ page }) => {
    await loadDocumentWithEditor(page, 'foreign-deck.html');
    await page.keyboard.press('e');

    await page.evaluate(() => {
      document.querySelector('.slide.active .foreign-card').style.opacity = '0.5';
    });

    await page.locator('.slide.active .foreign-card').click();
    await page.locator('.slide.active .foreign-title').click({ modifiers: ['ControlOrMeta'] });

    await expect(page.locator(OPACITY_INPUT)).toHaveValue('');
    await expect(page.locator(OPACITY_INPUT)).toHaveAttribute('placeholder', 'Mixed');

    await page.locator(OPACITY_INPUT).fill('40');
    await page.locator(OPACITY_INPUT).press('Enter');

    const opacities = await page.evaluate(() => ({
      card: getComputedStyle(document.querySelector('.slide.active .foreign-card')).opacity,
      title: getComputedStyle(document.querySelector('.slide.active .foreign-title')).opacity,
    }));
    expect(parseFloat(opacities.card)).toBeCloseTo(0.4, 1);
    expect(parseFloat(opacities.title)).toBeCloseTo(0.4, 1);

    // One undo restores both.
    await page.keyboard.press('ControlOrMeta+z');
    const restored = await page.evaluate(() => ({
      card: getComputedStyle(document.querySelector('.slide.active .foreign-card')).opacity,
      title: getComputedStyle(document.querySelector('.slide.active .foreign-title')).opacity,
    }));
    expect(parseFloat(restored.card)).toBeCloseTo(0.5, 1);
    expect(parseFloat(restored.title)).toBeCloseTo(1, 1);
  });

  test('a real click on Front raises a multi-selection above an unselected sibling', async ({ page }) => {
    await loadDocumentWithEditor(page, 'foreign-deck.html');
    await page.keyboard.press('e');

    await page.locator('.slide.active .foreign-card').click();
    await page.locator('.slide.active .resize-target').click({ modifiers: ['ControlOrMeta'] });

    await expect(page.locator(FRONT_BTN)).toBeVisible();
    await page.locator(FRONT_BTN).click();

    const z = await page.evaluate(() => ({
      card: parseInt(getComputedStyle(document.querySelector('.slide.active .foreign-card')).zIndex, 10) || 0,
      target: parseInt(getComputedStyle(document.querySelector('.slide.active .resize-target')).zIndex, 10) || 0,
      row: parseInt(getComputedStyle(document.querySelector('.slide.active .chip-row')).zIndex, 10) || 0,
    }));
    expect(z.card).toBeGreaterThan(z.row);
    expect(z.target).toBeGreaterThan(z.row);
  });

  test('Reset restores every edited member in one entry', async ({ page }) => {
    await loadDocumentWithEditor(page, 'foreign-deck.html');
    await page.keyboard.press('e');

    // Edit each element individually first so state.originalStyles records
    // a pristine baseline for both.
    await page.locator('.slide.active .foreign-title').click();
    await page.locator(FONT_PLUS).click();
    const titleBefore = await styleAttrOf(page, '.slide.active .foreign-title');

    await page.locator('.slide.active .resize-target').click();
    await page.locator(FONT_PLUS).click();
    const targetBefore = await styleAttrOf(page, '.slide.active .resize-target');

    await selectTitleAndResizeTarget(page);
    await page.locator(RESET_BTN).click();

    const titleReset = await page.evaluate(() => document.querySelector('.slide.active .foreign-title').getAttribute('style'));
    const targetReset = await page.evaluate(() => document.querySelector('.slide.active .resize-target').getAttribute('style'));
    expect(titleReset).not.toBe(titleBefore);
    expect(targetReset).not.toBe(targetBefore);

    // One undo restores exactly the pre-Reset (post-font-bump) state for
    // both — proof Reset pushed a single entry covering both members.
    await page.keyboard.press('ControlOrMeta+z');
    expect(await styleAttrOf(page, '.slide.active .foreign-title')).toBe(titleBefore);
    expect(await styleAttrOf(page, '.slide.active .resize-target')).toBe(targetBefore);
  });

  test('export after multi edits is clean and keeps the written styles', async ({ page, context }) => {
    await loadDocumentWithEditor(page, 'foreign-deck.html');
    await page.keyboard.press('e');

    await selectTitleAndResizeTarget(page);
    await page.locator(FONT_PLUS).click();
    await page.locator(OPACITY_INPUT).fill('80');
    await page.locator(OPACITY_INPUT).press('Enter');

    const liveStyles = await page.evaluate(() => ({
      title: document.querySelector('.slide.active .foreign-title').getAttribute('style'),
      target: document.querySelector('.slide.active .resize-target').getAttribute('style'),
    }));
    expect(liveStyles.title).toContain('opacity');
    expect(liveStyles.target).toContain('opacity');

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
    const exportedStyles = await exportedPage.evaluate(() => ({
      title: document.querySelector('.foreign-title').getAttribute('style'),
      target: document.querySelector('.resize-target').getAttribute('style'),
    }));
    expect(exportedStyles.title).toBe(liveStyles.title);
    expect(exportedStyles.target).toBe(liveStyles.target);
    await exportedPage.close();
  });

  // Code review C1: the opacity SLIDER drag session (mousedown → input →
  // mouseup, distinct from the typed-value path already covered above)
  // used to write only state.selected — the dock would then repopulate
  // "Mixed" for the other member(s) right after a drag that claimed to
  // edit the whole set. One real mouse drag must land every member at the
  // same value, in exactly one history entry.
  test('opacity slider drag applies to every member in one entry', async ({ page }) => {
    await loadDocumentWithEditor(page, 'foreign-deck.html');
    await page.keyboard.press('e');

    await selectTitleAndResizeTarget(page);
    const before = await page.evaluate(() => ({
      title: getComputedStyle(document.querySelector('.slide.active .foreign-title')).opacity,
      target: getComputedStyle(document.querySelector('.slide.active .resize-target')).opacity,
    }));

    await dragOpacitySlider(page, 45);

    const after = await page.evaluate(() => ({
      title: getComputedStyle(document.querySelector('.slide.active .foreign-title')).opacity,
      target: getComputedStyle(document.querySelector('.slide.active .resize-target')).opacity,
    }));
    expect(parseFloat(after.title)).toBeCloseTo(0.45, 1);
    expect(parseFloat(after.target)).toBeCloseTo(0.45, 1);

    // One undo restores BOTH — proof the drag pushed a single entry
    // covering every member, not just the one dragged from.
    await page.keyboard.press('ControlOrMeta+z');
    const restored = await page.evaluate(() => ({
      title: getComputedStyle(document.querySelector('.slide.active .foreign-title')).opacity,
      target: getComputedStyle(document.querySelector('.slide.active .resize-target')).opacity,
    }));
    expect(restored.title).toBe(before.title);
    expect(restored.target).toBe(before.target);
  });

  test('a Mixed field focused and blurred without typing writes nothing', async ({ page }) => {
    await loadDocumentWithEditor(page, 'foreign-deck.html');
    await page.keyboard.press('e');

    await page.evaluate(() => {
      document.querySelector('.slide.active .foreign-card').style.opacity = '0.5';
    });
    await page.locator('.slide.active .foreign-card').click();
    await page.locator('.slide.active .foreign-title').click({ modifiers: ['ControlOrMeta'] });
    await expect(page.locator(OPACITY_INPUT)).toHaveValue('');

    const before = await page.evaluate(() => ({
      card: document.querySelector('.slide.active .foreign-card').getAttribute('style'),
      title: document.querySelector('.slide.active .foreign-title').getAttribute('style'),
    }));

    await page.locator(OPACITY_INPUT).focus();
    await page.locator(OPACITY_INPUT).blur();

    const after = await page.evaluate(() => ({
      card: document.querySelector('.slide.active .foreign-card').getAttribute('style'),
      title: document.querySelector('.slide.active .foreign-title').getAttribute('style'),
    }));
    expect(after).toEqual(before);

    // No history entry was pushed — Cmd+Z must be a no-op here (the
    // opacity write from the earlier evaluate() call is not editor
    // history, only the focus/blur cycle under test is).
    await page.keyboard.press('ControlOrMeta+z');
    const afterUndo = await page.evaluate(() => ({
      card: document.querySelector('.slide.active .foreign-card').getAttribute('style'),
      title: document.querySelector('.slide.active .foreign-title').getAttribute('style'),
    }));
    expect(afterUndo).toEqual(before);
  });

  test('data-multi lifecycle: multi to single to deselect', async ({ page }) => {
    await loadDocumentWithEditor(page, 'foreign-deck.html');
    await page.keyboard.press('e');

    await selectTitleAndResizeTarget(page);
    await expect(page.locator(DOCK)).toHaveAttribute('data-visible', 'true');
    await expect(page.locator(DOCK)).toHaveAttribute('data-multi', 'true');

    await page.locator('.slide.active .foreign-title').click();
    await expect(page.locator(DOCK)).toHaveAttribute('data-visible', 'true');
    await expect(page.locator(DOCK)).toHaveAttribute('data-multi', 'false');

    // Escape rather than a fixed-coordinate background click: .foreign-title
    // is wide enough that the dock's overlap-avoidance can flip it to the
    // left edge, and a hardcoded "empty" point would then land on the
    // dock itself (swallowed by isPointInsidePassiveEditorSurface) instead
    // of deselecting.
    await page.keyboard.press('Escape');
    await expect(page.locator(DOCK)).toHaveAttribute('data-visible', 'false');
    await expect(page.locator(DOCK)).toHaveAttribute('data-multi', 'false');
  });
});
