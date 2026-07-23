import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { EDITOR_PATH } from './_helpers.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = path.join(path.resolve(__dirname, '..'), 'fixtures', 'foreign-deck.html');
const OUTPUT_DIR = path.join(__dirname, 'output');

const exportBtnSel = '#wfp-editor-root button[data-action="export"]';
const badgeSel = '#wfp-editor-root .wfpe-export-badge';
const menuSel = '#wfp-editor-root .wfpe-export-menu';
const primarySel = '#wfp-editor-root .wfpe-export-menu-item[data-action="save-in-place"]';
const cleanSel = '#wfp-editor-root .wfpe-export-menu-item[data-action="clean-copy"]';

test.use({ viewport: { width: 2000, height: 1200 } });

async function loadReady(page) {
  await page.goto(pathToFileURL(FIXTURE_PATH).href);
  await page.locator('.slide.active').first().waitFor({ state: 'attached', timeout: 10_000 });
  await page.addScriptTag({ path: EDITOR_PATH });
  await page.waitForFunction(() => window.__wfpEditorReady === true, null, { timeout: 10_000 });
  await page.keyboard.press('e');
}

async function addNote(page, note) {
  await page.evaluate(() => {
    const el = document.querySelector('.slide.active h1');
    const r = el.getBoundingClientRect();
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 }));
  });
  await page.locator('#wfp-editor-root .wfpe-annotation-input').fill(note);
  await page.locator('#wfp-editor-root .wfpe-annotation-save-btn').click();
}

async function readDownloadAsString(download) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const unique = `${Date.now()}-${Math.random().toString(36).slice(2)}-${download.suggestedFilename()}`;
  const out = path.join(OUTPUT_DIR, unique);
  await download.saveAs(out);
  return { path: out, content: fs.readFileSync(out, 'utf-8') };
}

test.describe('v2.11 — export action menu (legacy destinations)', () => {
  test('no handoff button; badge hidden at zero', async ({ page }) => {
    await loadReady(page);

    await expect(page.locator('#wfp-editor-root button[data-action="handoff"]')).toHaveCount(0);
    await expect(page.locator(badgeSel)).toHaveAttribute('data-count', '0');
    await expect(page.locator(badgeSel)).not.toBeVisible();
  });

  test('export button toggles the menu; escape and click-away close it', async ({ page }) => {
    await loadReady(page);

    await page.click(exportBtnSel);
    await expect(page.locator(menuSel)).toHaveAttribute('data-open', 'true');
    await expect(page.locator(menuSel)).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page.locator(menuSel)).toHaveAttribute('data-open', 'false');
    await expect(page.locator(menuSel)).toBeHidden();

    await page.click(exportBtnSel);
    await expect(page.locator(menuSel)).toHaveAttribute('data-open', 'true');

    await page.mouse.click(600, 600);
    await expect(page.locator(menuSel)).toHaveAttribute('data-open', 'false');
    await expect(page.locator(menuSel)).toBeHidden();
  });

  test('labels and badge track annotation count', async ({ page }) => {
    await loadReady(page);

    await page.click(exportBtnSel);
    await expect(page.locator(`${primarySel} .wfpe-export-menu-label`)).toHaveText('Save');
    await expect(page.locator(`${primarySel} .wfpe-export-menu-sub`)).toHaveText('Edits only');
    await page.keyboard.press('Escape');

    await addNote(page, 'MENU TEST NOTE');

    await expect(page.locator(badgeSel)).toBeVisible();
    await expect(page.locator(badgeSel)).toHaveText('1');

    await page.click(exportBtnSel);
    await expect(page.locator(`${primarySel} .wfpe-export-menu-label`)).toHaveText('Annotated handoff');
    await expect(page.locator(`${primarySel} .wfpe-export-menu-sub`)).toHaveText('Includes 1 agent note');
  });

  test('Enter while open runs the primary action', async ({ page }) => {
    await loadReady(page);

    await page.click(exportBtnSel);
    await expect(page.locator(menuSel)).toHaveAttribute('data-open', 'true');

    const downloadPromise = page.waitForEvent('download', { timeout: 5_000 });
    await page.keyboard.press('Enter');
    const download = await downloadPromise;

    expect(download.suggestedFilename()).toBe('foreign-deck-edited.html');
    await expect(page.locator(menuSel)).toHaveAttribute('data-open', 'false');
  });

  test('Cmd+S dispatches primary without opening the menu', async ({ page }) => {
    await loadReady(page);
    await addNote(page, 'CMD S NOTE');
    await expect(page.locator(menuSel)).toHaveAttribute('data-open', 'false');

    const downloadPromise = page.waitForEvent('download', { timeout: 5_000 });
    await page.keyboard.press('Meta+s');
    const download = await downloadPromise;

    expect(download.suggestedFilename()).toBe('foreign-deck-agent-handoff.html');
    await expect(page.locator(menuSel)).toHaveAttribute('data-open', 'false');
  });

  test('clean copy row downloads -edited even with notes', async ({ page }) => {
    await loadReady(page);
    await addNote(page, 'CLEAN COPY NOTE');

    await page.click(exportBtnSel);
    await expect(page.locator(menuSel)).toHaveAttribute('data-open', 'true');

    const downloadPromise = page.waitForEvent('download', { timeout: 5_000 });
    await page.click(cleanSel);
    const download = await downloadPromise;

    expect(download.suggestedFilename()).toBe('foreign-deck-edited.html');
    const { content } = await readDownloadAsString(download);
    expect(content).not.toContain('wfpe-export-menu');
    expect(content).not.toContain('data-wfp-edit');
  });
});
