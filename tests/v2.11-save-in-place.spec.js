import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { EDITOR_PATH, disableFsa } from './_helpers.js';

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

// Real Chromium (even headless) implements showSaveFilePicker on file:// and
// http://localhost, so canSaveInPlace() is true by default in these tests
// unless explicitly disabled. Legacy-destination tests exercise the
// no-FSA/Safari-Firefox fallback path on purpose, so they force the API away
// — matching the "no File System Access API" test below — rather than
// accidentally hitting the real (headless, dialog-less) picker, which
// synchronously aborts. See disableFsa in _helpers.js.

async function readDownloadAsString(download) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const unique = `${Date.now()}-${Math.random().toString(36).slice(2)}-${download.suggestedFilename()}`;
  const out = path.join(OUTPUT_DIR, unique);
  await download.saveAs(out);
  return { path: out, content: fs.readFileSync(out, 'utf-8') };
}

// Installs a controllable fake File System Access API. Must be registered
// before page.goto. Modes: 'ok' (default), 'abort' (picker throws
// AbortError), 'stale-once' (first createWritable throws NotFoundError).
async function installFsaStub(page) {
  await page.addInitScript(() => {
    window.__fsa = { pickerCalls: [], written: [], mode: 'ok', permission: 'granted', requestCalls: 0, staleUsed: false };
    window.showSaveFilePicker = async (opts) => {
      window.__fsa.pickerCalls.push((opts && opts.suggestedName) || null);
      if (window.__fsa.mode === 'abort') {
        const err = new Error('user cancelled');
        err.name = 'AbortError';
        throw err;
      }
      return {
        name: (opts && opts.suggestedName) || 'stub.html',
        queryPermission: async () => window.__fsa.permission,
        requestPermission: async () => {
          window.__fsa.requestCalls += 1;
          window.__fsa.permission = 'granted';
          return 'granted';
        },
        createWritable: async () => {
          if (window.__fsa.mode === 'stale-once' && !window.__fsa.staleUsed) {
            window.__fsa.staleUsed = true;
            const err = new Error('file moved');
            err.name = 'NotFoundError';
            throw err;
          }
          let buf = '';
          return {
            write: async (data) => { buf += String(data); },
            close: async () => { window.__fsa.written.push(buf); },
          };
        },
      };
    };
  });
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
    await disableFsa(page);
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
    await disableFsa(page);
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

test.describe('v2.11 — save-in-place engine', () => {
  test('Cmd+S writes the clean document over the source file via the picker', async ({ page }) => {
    await installFsaStub(page);
    await loadReady(page);
    await page.keyboard.press('Meta+s');
    await page.waitForFunction(() => window.__fsa.written.length === 1);
    const fsa = await page.evaluate(() => window.__fsa);
    expect(fsa.pickerCalls).toEqual(['foreign-deck.html']);
    expect(fsa.written[0].startsWith('<!DOCTYPE html>')).toBe(true);
    expect(fsa.written[0]).not.toContain('data-wfp-edit');
    expect(fsa.written[0]).not.toContain('wfp-editor-root');
    expect(fsa.written[0]).not.toContain('data-wfp-agent-annotations');
  });

  test('second save is silent — no second picker call', async ({ page }) => {
    await installFsaStub(page);
    await loadReady(page);
    await page.keyboard.press('Meta+s');
    await page.waitForFunction(() => window.__fsa.written.length === 1);
    await page.keyboard.press('Meta+s');
    await page.waitForFunction(() => window.__fsa.written.length === 2);
    expect(await page.evaluate(() => window.__fsa.pickerCalls.length)).toBe(1);
  });

  test('annotated save writes handoff metadata and toasts the note count', async ({ page }) => {
    await installFsaStub(page);
    await loadReady(page);
    await addNote(page, 'SAVE ENGINE NOTE');
    await page.keyboard.press('Meta+s');
    await page.waitForFunction(() => window.__fsa.written.length === 1);
    const written = await page.evaluate(() => window.__fsa.written[0]);
    expect(written).toContain('data-wfp-agent-annotations');
    expect(written).toContain('SAVE ENGINE NOTE');
    await expect(page.locator('#wfp-editor-root .wfpe-toast').last()).toHaveText('Saved foreign-deck.html — 1 agent note');
  });

  test('cancelled picker saves nothing and recovers on retry', async ({ page }) => {
    await installFsaStub(page);
    await loadReady(page);
    await page.evaluate(() => { window.__fsa.mode = 'abort'; });
    await page.keyboard.press('Meta+s');
    await expect(page.locator('#wfp-editor-root .wfpe-toast')).toHaveText('Save cancelled.');
    expect(await page.evaluate(() => window.__fsa.written.length)).toBe(0);
    await page.evaluate(() => { window.__fsa.mode = 'ok'; });
    await page.keyboard.press('Meta+s');
    await page.waitForFunction(() => window.__fsa.written.length === 1);
    expect(await page.evaluate(() => window.__fsa.pickerCalls.length)).toBe(2);
  });

  test('permission re-grant path: prompt state triggers requestPermission, not a picker', async ({ page }) => {
    await installFsaStub(page);
    await loadReady(page);
    await page.keyboard.press('Meta+s');
    await page.waitForFunction(() => window.__fsa.written.length === 1);
    await page.evaluate(() => { window.__fsa.permission = 'prompt'; });
    await page.keyboard.press('Meta+s');
    await page.waitForFunction(() => window.__fsa.written.length === 2);
    const fsa = await page.evaluate(() => window.__fsa);
    expect(fsa.requestCalls).toBe(1);
    expect(fsa.pickerCalls.length).toBe(1);
  });

  test('stale handle re-opens the picker and retries the write', async ({ page }) => {
    await installFsaStub(page);
    await loadReady(page);
    await page.keyboard.press('Meta+s');
    await page.waitForFunction(() => window.__fsa.written.length === 1);
    await page.evaluate(() => { window.__fsa.mode = 'stale-once'; });
    await page.keyboard.press('Meta+s');
    await page.waitForFunction(() => window.__fsa.written.length === 2);
    expect(await page.evaluate(() => window.__fsa.pickerCalls.length)).toBe(2);
  });

  test('no File System Access API: Cmd+S falls back to the legacy download', async ({ page }) => {
    await disableFsa(page);
    await loadReady(page);
    await page.locator(exportBtnSel).click();
    await expect(page.locator(`${primarySel} .wfpe-export-menu-sub`)).toHaveText('Edits only — Downloads');
    await page.keyboard.press('Escape');

    const downloadPromise = page.waitForEvent('download', { timeout: 5_000 });
    await page.keyboard.press('Meta+s');
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe('foreign-deck-edited.html');
  });

  test('menu Enter and clean-copy row behave with the engine active', async ({ page }) => {
    await installFsaStub(page);
    await loadReady(page);
    await page.locator(exportBtnSel).click();
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => window.__fsa.written.length === 1);
    await page.locator(exportBtnSel).click();
    const downloadPromise = page.waitForEvent('download', { timeout: 5_000 });
    await page.locator(cleanSel).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe('foreign-deck-edited.html');
    expect(await page.evaluate(() => window.__fsa.written.length)).toBe(1);
  });
});
