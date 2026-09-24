import { test, expect } from '@playwright/test';
import { EDITOR_PATH } from './_helpers.js';

const status = '#wfp-editor-root .wfpe-recovery-status';
const panel = '#wfp-editor-root .wfpe-recovery-panel';
async function boot(page) {
  await page.goto('/fixtures/foreign-deck.html');
  await page.addScriptTag({ path: EDITOR_PATH });
  await page.waitForFunction(() => window.__wfpEditorReady);
}
async function selectHeading(page) {
  await page.keyboard.press('e');
  await page.locator('.slide.active h1').click();
}

test('edit, undo and redo reflect source state and survive reload with notes', async ({ page }) => {
  await boot(page);
  await expect(page.locator(status)).toContainText('Source unchanged');
  await selectHeading(page);
  await page.keyboard.press('ArrowUp');
  await expect(page.locator(status)).toContainText('Unsaved');
  await page.keyboard.press('ControlOrMeta+z');
  await expect(page.locator(status)).toContainText('Source unchanged');
  await page.keyboard.press('ControlOrMeta+Shift+z');
  await page.locator('.wfpe-annotation-input').fill('Keep this recovered note');
  await page.locator('.wfpe-annotation-save-btn').click();
  await expect(page.locator(status)).toContainText('Local recovery saved');
  const font = await page.locator('.slide.active h1').evaluate(el => el.style.fontSize);
  await boot(page);
  await expect(page.locator(panel)).toContainText('Restore');
  await page.getByRole('button', { name: 'Restore local copy', exact: true }).click();
  await expect(page.locator('.slide.active h1')).toHaveAttribute('data-wfp-edit-annotation-text', 'Keep this recovered note');
  await expect(page.locator('.slide.active h1')).toHaveCSS('font-size', font);
  await expect(page.locator(status)).toContainText('Unsaved');
  await expect(page.locator('body')).not.toHaveAttribute('data-wfp-edit-overview', 'on');
});

async function installFile(page) {
  await page.addInitScript(() => {
    window.__file = { html: '', time: 1000, writes: 0, abort: false, delayClose: false, reads: 0 };
    const handle = {
      name: 'working.html',
      queryPermission: async () => 'granted',
      getFile: async () => {
        window.__file.reads++;
        if (window.__file.externalOnRead === window.__file.reads) {
          window.__file.time++;
          window.__file.html = window.__file.html.replace('Market day agenda', 'Agent race version');
        }
        return { lastModified: window.__file.time, text: async () => window.__file.html };
      },
      createWritable: async () => {
        let html;
        return {
          write: async value => { html = value; },
          close: async () => {
            if (window.__file.delayClose) await new Promise(resolve => { window.__releaseSave = resolve; });
            window.__file.html = html;
            window.__file.time++;
            window.__file.writes++;
          },
        };
      },
    };
    window.showSaveFilePicker = async () => {
      if (window.__file.abort) throw new DOMException('Cancelled', 'AbortError');
      return handle;
    };
  });
}
async function save(page) {
  await page.keyboard.press('Escape');
  await page.locator('#wfp-editor-root [data-action="export"]').click();
  await page.locator('#wfp-editor-root [data-action="save-in-place"]').click();
}
async function externalChange(page, title = 'Agent updated title') {
  await page.evaluate(title => {
    const doc = new DOMParser().parseFromString(window.__file.html, 'text/html');
    doc.querySelector('h1').textContent = title;
    window.__file.html = '<!DOCTYPE html>' + doc.documentElement.outerHTML;
    window.__file.time++;
  }, title);
}

test.beforeEach(async ({ page }) => { page.on('dialog', dialog => dialog.accept()); });

test('cancelled save stays dirty; successful save and undo track saved source', async ({ page }) => {
  await installFile(page);
  await boot(page);
  await selectHeading(page);
  await page.keyboard.press('ArrowUp');
  await page.evaluate(() => { window.__file.abort = true; });
  await save(page);
  await expect(page.locator('.wfpe-toast').last()).toHaveText('Save cancelled.');
  await expect(page.locator(status)).toContainText('Unsaved');
  expect(await page.evaluate(() => window.__file.writes)).toBe(0);
  await page.evaluate(() => { window.__file.abort = false; });
  await save(page);
  await expect(page.locator(status)).toContainText('Saved to source');
  await page.keyboard.press('ControlOrMeta+z');
  await expect(page.locator(status)).toContainText('Unsaved');
  await page.keyboard.press('ControlOrMeta+Shift+z');
  await expect(page.locator(status)).toContainText('Saved to source');
});

test('external change holds local work, blocks save, downloads and applies with a recoverable prior copy', async ({ page }) => {
  await installFile(page);
  await boot(page);
  await save(page);
  await expect(page.locator(status)).toContainText('Saved to source');
  await selectHeading(page);
  await page.keyboard.press('ArrowUp');
  const localFont = await page.locator('.slide.active h1').evaluate(el => el.style.fontSize);
  await externalChange(page);
  await expect(page.locator(panel)).toContainText('newer file', { timeout: 8000 });
  await expect(page.locator('.slide.active h1')).toHaveText('Market day agenda');
  await page.getByRole('button', { name: 'Keep local work', exact: true }).click();
  await save(page);
  expect(await page.evaluate(() => window.__file.writes)).toBe(1);
  await expect(page.locator(panel)).toBeVisible();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download local copy', exact: true }).click();
  expect((await download).suggestedFilename()).toContain('local-working-copy');
  await page.getByRole('button', { name: 'Apply newer file', exact: true }).click();
  await expect(page.locator('.slide.active h1')).toHaveText('Agent updated title');
  await expect(page.locator(panel)).toContainText('Previous local work');
  await page.getByRole('button', { name: 'Restore local copy', exact: true }).click();
  await expect(page.locator('.slide.active h1')).toHaveText('Market day agenda');
  await expect(page.locator('.slide.active h1')).toHaveCSS('font-size', localFont);
  await expect(page.locator(status)).toContainText('Save blocked');
});

test('save checks an external update before the watcher polls', async ({ page }) => {
  await installFile(page);
  await boot(page);
  await save(page);
  await expect(page.locator(status)).toContainText('Saved to source');
  await externalChange(page, 'Unpolled agent title');
  await save(page);
  await expect(page.locator(status)).toContainText('Save blocked');
  expect(await page.evaluate(() => window.__file.writes)).toBe(1);
});

test('save rechecks the disk after the HTML build', async ({ page }) => {
  await installFile(page);
  await boot(page);
  await save(page);
  await expect(page.locator(status)).toContainText('Saved to source');
  await page.evaluate(() => { window.__file.externalOnRead = window.__file.reads + 2; });
  await save(page);
  await expect(page.locator(status)).toContainText('Save blocked');
  expect(await page.evaluate(() => window.__file.writes)).toBe(1);
});

test('edits during a delayed write stay unsaved and concurrent save is ignored', async ({ page }) => {
  await installFile(page);
  await boot(page);
  await save(page);
  await expect(page.locator(status)).toContainText('Saved to source');
  await page.evaluate(() => { window.__file.delayClose = true; });
  await save(page);
  await page.waitForFunction(() => window.__releaseSave);
  await selectHeading(page);
  await page.keyboard.press('ArrowUp');
  await save(page);
  await page.evaluate(() => { window.__file.delayClose = false; window.__releaseSave(); });
  await expect(page.locator(status)).toContainText('Unsaved');
  await expect.poll(() => page.evaluate(() => window.__file.writes)).toBe(2);
  const serialized = await page.evaluate(() => new DOMParser().parseFromString(window.__file.html, 'text/html').querySelector('h1').style.fontSize);
  const current = await page.locator('.slide.active h1').evaluate(el => el.style.fontSize);
  expect(current).not.toBe(serialized);
});

test('discard removes the offered snapshot without changing the source', async ({ page }) => {
  await boot(page);
  await selectHeading(page);
  await page.keyboard.press('ArrowUp');
  await expect(page.locator(status)).toContainText('Local recovery saved');
  await boot(page);
  await page.getByRole('button', { name: 'Discard local copy', exact: true }).click();
  await expect(page.locator(panel)).toBeHidden();
  await expect(page.locator(status)).toContainText('Source unchanged');
  await boot(page);
  await expect(page.locator(panel)).toBeHidden();
});

test('source changes are signalled on reload and stale restoration blocks save', async ({ page }) => {
  await boot(page);
  await selectHeading(page);
  await page.keyboard.press('ArrowUp');
  await expect(page.locator(status)).toContainText('Local recovery saved');
  await page.route('**/fixtures/foreign-deck.html', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: (await response.text()).replace('Market day agenda', 'New source on reload') });
  });
  await boot(page);
  await expect(page.locator(panel)).toContainText('source has changed');
  await page.getByRole('button', { name: 'Restore local copy', exact: true }).click();
  await expect(page.locator('.slide.active h1')).toHaveText('Market day agenda');
  await expect(page.locator(status)).toContainText('Save blocked');
});

test('storage failure is visible and does not prevent editing or saving', async ({ page }) => {
  await installFile(page);
  await page.addInitScript(() => {
    const open = IDBFactory.prototype.open;
    IDBFactory.prototype.open = function(name, ...args) {
      if (name === 'wfp-editor-recovery') throw new DOMException('Quota exceeded', 'QuotaExceededError');
      return open.call(this, name, ...args);
    };
  });
  await boot(page);
  await selectHeading(page);
  await page.keyboard.press('ArrowUp');
  await expect(page.locator(status)).toContainText('Local recovery unavailable');
  await save(page);
  await expect(page.locator(status)).toContainText('Saved to source');
  expect(await page.evaluate(() => window.__file.writes)).toBe(1);
});

test('snapshots larger than localStorage quota restore image content', async ({ page }) => {
  await boot(page);
  const source = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><!--' + 'x'.repeat(6 * 1024 * 1024) + '--></svg>');
  await page.evaluate(src => {
    const img = document.createElement('img');
    img.setAttribute('src', src);
    document.querySelector('.slide').appendChild(img);
  }, source);
  await expect(page.locator(status)).toContainText('Local recovery saved', { timeout: 15000 });
  await boot(page);
  await page.getByRole('button', { name: 'Restore local copy', exact: true }).click();
  await expect.poll(() => page.locator('.slide img').last().getAttribute('src'), { timeout: 15000 }).toBe(source);
});

test('an external write immediately after save close blocks the next save', async ({ page }) => {
  await installFile(page);
  await boot(page);
  // Two pre-write reads, then the post-close verification read.
  await page.evaluate(() => { window.__file.externalOnRead = window.__file.reads + 3; });
  await save(page);
  await expect(page.locator(status)).toContainText('Save blocked');
  await expect(page.locator('.slide.active h1')).toHaveText('Market day agenda');
  await save(page);
  expect(await page.evaluate(() => window.__file.writes)).toBe(1);
  expect(await page.evaluate(() => window.__file.html)).toContain('Agent race version');
});

test('keep local work stays dismissed across watcher polls', async ({ page }) => {
  await installFile(page);
  await boot(page);
  await save(page);
  await expect(page.locator(status)).toContainText('Saved to source');
  await selectHeading(page);
  await page.keyboard.press('ArrowUp');
  await externalChange(page);
  await page.getByRole('button', { name: 'Keep local work', exact: true }).click();
  const reads = await page.evaluate(() => window.__file.reads);
  await expect.poll(() => page.evaluate(() => window.__file.reads), { timeout: 8000 }).toBeGreaterThan(reads + 1);
  await expect(page.locator(panel)).toBeHidden();
  await expect(page.locator(status)).toContainText('Save blocked');
});

test('an unsaved scoped note defers external refresh even after closing the draft', async ({ page }) => {
  await installFile(page);
  await boot(page);
  await save(page);
  await expect(page.locator(status)).toContainText('Saved to source');
  await page.keyboard.press('e');
  await page.locator('#wfp-editor-root [data-action="notes"]').click();
  await page.getByRole('button', { name: 'Whole deck note', exact: true }).click();
  await page.locator('.wfpe-scoped-note-input').fill('Keep my unfinished thought');
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await externalChange(page);
  const reads = await page.evaluate(() => window.__file.reads);
  await expect.poll(() => page.evaluate(() => window.__file.reads), { timeout: 8000 }).toBeGreaterThan(reads + 1);
  await expect(page.locator('.slide.active h1')).toHaveText('Market day agenda');
  await page.getByRole('button', { name: 'Whole deck note', exact: true }).click();
  await expect(page.locator('.wfpe-scoped-note-input')).toHaveValue('Keep my unfinished thought');
  await page.getByRole('button', { name: 'Save note', exact: true }).click();
  await expect(page.locator(status)).toContainText('Save blocked', { timeout: 8000 });
});
