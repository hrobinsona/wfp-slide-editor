import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  EDITOR_PATH,
  disableFsa,
  skipIfFixtureMissing,
  EDITOR_MARKER_ATTR_RE,
} from './_helpers.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const OUTPUT_DIR = path.join(__dirname, 'output');
const FIXTURE_NAME = 'foreign-deck.html';
const FIXTURE_PATH = path.join(PROJECT_ROOT, 'fixtures', FIXTURE_NAME);

const NOTE_SLIDE_1 = 'NOTES PANEL TEST: rewrite this headline for a general audience.';
const NOTE_SLIDE_3 = 'NOTES PANEL TEST: make this target twice as prominent.';

const notesBtnSel = '#wfp-editor-root button[data-action="notes"]';
const notesBadgeSel = '#wfp-editor-root .wfpe-notes-badge';
const notesDockSel = '#wfp-editor-root .wfpe-notes-dock';
const notesPanelSel = '#wfp-editor-root .wfpe-notes-panel';
const cardSel = '#wfp-editor-root .wfpe-notes-card';
const activeCardSel = '#wfp-editor-root .wfpe-notes-card[data-active="true"]';
const prevBtnSel = '#wfp-editor-root .wfpe-notes-nav-btn[data-action="notes-prev"]';
const nextBtnSel = '#wfp-editor-root .wfpe-notes-nav-btn[data-action="notes-next"]';
const closeBtnSel = '#wfp-editor-root .wfpe-notes-nav-btn[data-action="notes-close"]';
const textareaSel = '#wfp-editor-root .wfpe-annotation-input';
const saveBtnSel = '#wfp-editor-root .wfpe-annotation-save-btn';
const deleteBtnSel = '#wfp-editor-root .wfpe-annotation-delete-btn';
const inspectorDockSel = '#wfp-editor-root .wfpe-inspector-dock';
const markerSel = '#wfp-editor-root .wfpe-annotation-badge';
const exportBtnSel = '#wfp-editor-root button[data-action="export"]';
const exportCleanSel = '#wfp-editor-root .wfpe-export-menu-item[data-action="clean-copy"]';
const exportMenuSel = '#wfp-editor-root .wfpe-export-menu';

test.use({ viewport: { width: 2000, height: 1200 } });

async function loadReady(page) {
  await disableFsa(page);
  await page.goto(pathToFileURL(FIXTURE_PATH).href);
  await page.locator('.slide.active').first().waitFor({ state: 'attached', timeout: 10_000 });
  await page.addScriptTag({ path: EDITOR_PATH });
  await page.waitForFunction(() => window.__wfpEditorReady === true, null, { timeout: 10_000 });
  await page.keyboard.press('e');
}

async function clickToSelect(page, selector) {
  await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    const r = el.getBoundingClientRect();
    el.dispatchEvent(
      new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
        view: window,
        clientX: r.left + r.width / 2,
        clientY: r.top + r.height / 2,
      }),
    );
  }, selector);
}

async function saveNoteOnActiveSlide(page, selector, note) {
  await clickToSelect(page, selector);
  await page.locator(textareaSel).fill(note);
  await page.locator(saveBtnSel).click();
  // Deselect so the arrow keys below stay with slide navigation.
  await page.keyboard.press('Escape');
}

// foreign-deck.html deliberately wraps its slides in `.presentation`, not
// `.deck` (it exists to prove editor tolerance of non-standard containers),
// so index by the slide class alone.
function activeSlideIndex(page) {
  return page.evaluate(() =>
    [...document.querySelectorAll('.slide')].findIndex((s) => s.classList.contains('active')),
  );
}

// One note on slide 1 (the headline) and one on slide 3 (its resize
// target), authored through the real inspector flow, finishing back on
// slide 1 with nothing selected.
async function seedTwoNotes(page) {
  await saveNoteOnActiveSlide(page, '.slide.active h1', NOTE_SLIDE_1);
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => activeSlideIndex(page)).toBe(2);
  await saveNoteOnActiveSlide(page, '.slide.active .resize-target', NOTE_SLIDE_3);
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  await expect.poll(() => activeSlideIndex(page)).toBe(0);
}

async function readDownloadAsString(download) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const unique = `${Date.now()}-${Math.random().toString(36).slice(2)}-${download.suggestedFilename()}`;
  const out = path.join(OUTPUT_DIR, unique);
  await download.saveAs(out);
  return fs.readFileSync(out, 'utf-8');
}

test.describe('v2.21 — agent notes panel', () => {
  test.beforeEach(async ({ page }) => {
    skipIfFixtureMissing(FIXTURE_NAME);
    await loadReady(page);
  });

  test('toolbar toggle opens and closes the dock; badge tracks note count', async ({ page }) => {
    // Zero notes: badge hidden, dock folded.
    await expect(page.locator(notesBadgeSel)).toHaveAttribute('data-count', '0');
    await expect(page.locator(notesBadgeSel)).toBeHidden();
    await expect(page.locator(notesDockSel)).toHaveAttribute('data-visible', 'false');

    await seedTwoNotes(page);
    await expect(page.locator(notesBadgeSel)).toHaveAttribute('data-count', '2');
    await expect(page.locator(notesBadgeSel)).toBeVisible();

    await page.locator(notesBtnSel).click();
    await expect(page.locator(notesDockSel)).toHaveAttribute('data-visible', 'true');
    await expect(page.locator(notesBtnSel)).toHaveAttribute('aria-expanded', 'true');

    await page.locator(closeBtnSel).click();
    await expect(page.locator(notesDockSel)).toHaveAttribute('data-visible', 'false');
    await expect(page.locator(notesBtnSel)).toHaveAttribute('aria-expanded', 'false');
  });

  test('cards list every note across slides, in slide order, with slide chips', async ({ page }) => {
    await seedTwoNotes(page);
    await page.locator(notesBtnSel).click();

    const cards = page.locator(cardSel);
    await expect(cards).toHaveCount(2);
    await expect(cards.nth(0).locator('.wfpe-notes-card-chip')).toHaveText('1');
    await expect(cards.nth(0).locator('.wfpe-notes-card-instruction')).toHaveText(NOTE_SLIDE_1);
    await expect(cards.nth(1).locator('.wfpe-notes-card-chip')).toHaveText('3');
    await expect(cards.nth(1).locator('.wfpe-notes-card-instruction')).toHaveText(NOTE_SLIDE_3);
    // Snippet carries the target's own text so the card is identifiable.
    await expect(cards.nth(1).locator('.wfpe-notes-card-snippet')).toContainText('Third resize target');
  });

  test('agent status and reply render on the card', async ({ page }) => {
    await seedTwoNotes(page);
    await page.evaluate(() => {
      const el = [...document.querySelectorAll('[data-wfp-edit-annotation-id]')].find((n) =>
        n.classList.contains('resize-target'),
      );
      el.setAttribute('data-wfp-edit-annotation-status', 'needs-input');
      el.setAttribute('data-wfp-edit-annotation-reply', 'Prominent how — size or colour?');
    });
    // Opening the panel runs the full fan-out, so out-of-band attribute
    // changes (the agent-reimport shape) are picked up here.
    await page.locator(notesBtnSel).click();

    const statusCard = page.locator(`${cardSel}[data-status="needs-input"]`);
    await expect(statusCard).toHaveCount(1);
    await expect(statusCard.locator('.wfpe-notes-card-reply')).toHaveText(
      'Agent needs input: Prominent how — size or colour?',
    );
  });

  test('clicking a card jumps across slides: activates, selects, opens the note', async ({ page }) => {
    await seedTwoNotes(page);
    await page.locator(notesBtnSel).click();

    await page.locator(cardSel).nth(1).click();

    await expect.poll(() => activeSlideIndex(page)).toBe(2);
    await expect(page.locator(inspectorDockSel)).toHaveAttribute('data-visible', 'true');
    await expect(page.locator(textareaSel)).toHaveValue(NOTE_SLIDE_3);
    await expect(page.locator(`${markerSel}[data-selected="true"]`)).toHaveCount(1);
    await expect(page.locator(activeCardSel).locator('.wfpe-notes-card-instruction')).toHaveText(
      NOTE_SLIDE_3,
    );
    // The panel is a browsing surface: it stays open after the jump.
    await expect(page.locator(notesDockSel)).toHaveAttribute('data-visible', 'true');
  });

  test('N flicks forward with wraparound, Shift+N backward; typing keeps the key', async ({ page }) => {
    await seedTwoNotes(page);

    // First press opens the panel and lands on the first note.
    await page.keyboard.press('n');
    await expect(page.locator(notesDockSel)).toHaveAttribute('data-visible', 'true');
    await expect(page.locator(activeCardSel).locator('.wfpe-notes-card-instruction')).toHaveText(
      NOTE_SLIDE_1,
    );

    await page.keyboard.press('n');
    await expect.poll(() => activeSlideIndex(page)).toBe(2);
    await expect(page.locator(textareaSel)).toHaveValue(NOTE_SLIDE_3);

    // Wraparound forward: 2nd note → 1st.
    await page.keyboard.press('n');
    await expect.poll(() => activeSlideIndex(page)).toBe(0);
    await expect(page.locator(textareaSel)).toHaveValue(NOTE_SLIDE_1);

    // Backward from the 1st wraps to the 2nd.
    await page.keyboard.press('Shift+N');
    await expect.poll(() => activeSlideIndex(page)).toBe(2);
    await expect(page.locator(textareaSel)).toHaveValue(NOTE_SLIDE_3);

    // Typing guard: with the note textarea focused, N types instead of
    // jumping.
    await page.locator(textareaSel).focus();
    await page.keyboard.press('n');
    await expect(page.locator(textareaSel)).toHaveValue(`${NOTE_SLIDE_3}n`);
    await expect.poll(() => activeSlideIndex(page)).toBe(2);
  });

  test('escape closes the panel only after the selection is released', async ({ page }) => {
    await seedTwoNotes(page);
    await page.keyboard.press('n'); // open + jump (selects the first note)

    // First Escape releases the selection; the panel stays.
    await page.keyboard.press('Escape');
    await expect(page.locator(inspectorDockSel)).toHaveAttribute('data-visible', 'false');
    await expect(page.locator(notesDockSel)).toHaveAttribute('data-visible', 'true');

    // Second Escape closes the panel.
    await page.keyboard.press('Escape');
    await expect(page.locator(notesDockSel)).toHaveAttribute('data-visible', 'false');
  });

  test('card list tracks delete and undo', async ({ page }) => {
    await seedTwoNotes(page);
    await page.locator(notesBtnSel).click();
    await expect(page.locator(cardSel)).toHaveCount(2);

    await page.locator(cardSel).nth(0).click();
    await page.locator(deleteBtnSel).click();
    await expect(page.locator(cardSel)).toHaveCount(1);
    await expect(page.locator(notesBadgeSel)).toHaveAttribute('data-count', '1');

    await page.keyboard.press('Escape'); // release selection so undo targets history
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z');
    await expect(page.locator(cardSel)).toHaveCount(2);
    await expect(page.locator(notesBadgeSel)).toHaveAttribute('data-count', '2');
  });

  test('panel UI leaks nothing into a clean export', async ({ page }) => {
    await seedTwoNotes(page);
    await page.locator(notesBtnSel).click();
    await expect(page.locator(cardSel)).toHaveCount(2);

    const downloadPromise = page.waitForEvent('download', { timeout: 5_000 });
    await page.locator(exportBtnSel).click();
    await page.locator(exportCleanSel).click();
    const html = await readDownloadAsString(await downloadPromise);

    expect(html).not.toContain('wfpe-notes');
    expect(html).not.toContain('wfp-editor-root');
    expect(html).not.toMatch(EDITOR_MARKER_ATTR_RE);
  });

  test('arrow navigation continues from the jumped-to slide', async ({ page }) => {
    await seedTwoNotes(page);
    await page.locator(notesBtnSel).click();
    await page.locator(cardSel).nth(1).click(); // jump to slide 3
    await expect.poll(() => activeSlideIndex(page)).toBe(2);

    await page.keyboard.press('Escape'); // release selection; arrows return to nav
    await page.keyboard.press('ArrowRight');
    await expect.poll(() => activeSlideIndex(page)).toBe(3);
  });

  test('export menu and notes panel are mutually exclusive middle segments', async ({ page }) => {
    await seedTwoNotes(page);
    await page.locator(notesBtnSel).click();
    await expect(page.locator(notesDockSel)).toHaveAttribute('data-visible', 'true');

    await page.locator(exportBtnSel).click();
    await expect(page.locator(exportMenuSel)).toHaveAttribute('data-open', 'true');
    await expect(page.locator(notesDockSel)).toHaveAttribute('data-visible', 'false');

    await page.locator(notesBtnSel).click();
    await expect(page.locator(notesDockSel)).toHaveAttribute('data-visible', 'true');
    await expect(page.locator(exportMenuSel)).toHaveAttribute('data-open', 'false');
  });

  test('toolbar fold is not clipped by the sixth button', async ({ page }) => {
    // v2.21 added the Notes button; the bar's fixed width must fit it —
    // a clipped fold silently hides the divider and squares Redo's pill.
    const fold = await page.evaluate(() => {
      const inner = document.querySelector('#wfp-editor-root .wfpe-toolbar-fold-inner');
      return { scrollWidth: inner.scrollWidth, clientWidth: inner.clientWidth };
    });
    expect(fold.scrollWidth).toBeLessThanOrEqual(fold.clientWidth);
  });

  test('empty state renders when the panel is open with no notes', async ({ page }) => {
    await page.locator(notesBtnSel).click();
    await expect(page.locator(notesDockSel)).toHaveAttribute('data-visible', 'true');
    await expect(page.locator('#wfp-editor-root .wfpe-notes-empty')).toBeVisible();
    await expect(page.locator(cardSel)).toHaveCount(0);
    // Prev/next have nothing to cycle.
    await expect(page.locator(prevBtnSel)).toBeDisabled();
    await expect(page.locator(nextBtnSel)).toBeDisabled();
  });
});

test.describe('v2.21 — agent notes panel (flat document)', () => {
  const FLAT_FIXTURE = 'flat-document.html';

  test('cards render chipless and N jumps by scrolling, not slide activation', async ({ page }) => {
    skipIfFixtureMissing(FLAT_FIXTURE);
    await disableFsa(page);
    await page.goto(pathToFileURL(path.join(PROJECT_ROOT, 'fixtures', FLAT_FIXTURE)).href);
    await page.addScriptTag({ path: EDITOR_PATH });
    await page.waitForFunction(() => window.__wfpEditorReady === true, null, { timeout: 10_000 });
    await page.keyboard.press('e');

    // Annotate a heading near the bottom of the document via the real flow.
    const target = await page.evaluate(() => {
      const els = [...document.querySelectorAll('h1, h2, h3, p')].filter(
        (el) => !el.closest('#wfp-editor-root') && el.textContent.trim(),
      );
      const el = els[els.length - 1];
      el.id = el.id || 'wfp-test-flat-target';
      return `#${el.id}`;
    });
    await clickToSelect(page, target);
    await page.locator(textareaSel).fill('NOTES PANEL FLAT: tighten this section.');
    await page.locator(saveBtnSel).click();
    await page.keyboard.press('Escape');
    await page.evaluate(() => window.scrollTo(0, 0));

    await page.keyboard.press('n');
    await expect(page.locator(notesDockSel)).toHaveAttribute('data-visible', 'true');
    const card = page.locator(cardSel);
    await expect(card).toHaveCount(1);
    await expect(card.locator('.wfpe-notes-card-chip')).toHaveCount(0); // no slide chip
    await expect(page.locator(textareaSel)).toHaveValue('NOTES PANEL FLAT: tighten this section.');
    // The jump scrolled the annotated element into view.
    const inView = await page.evaluate((sel) => {
      const r = document.querySelector(sel).getBoundingClientRect();
      return r.bottom > 0 && r.top < window.innerHeight;
    }, target);
    expect(inView).toBe(true);
  });
});
