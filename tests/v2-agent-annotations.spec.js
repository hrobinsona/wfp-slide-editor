import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { EDITOR_PATH } from './_helpers.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const OUTPUT_DIR = path.join(__dirname, 'output');
const FIXTURE_PATH = path.join(PROJECT_ROOT, 'fixtures', 'foreign-deck.html');
const NOTE = 'ANNOTATION TEST UNIQUE: review this rewritten subsection for clarity.';
const NOTE_EDITED = 'ANNOTATION TEST UNIQUE: make this sharper and call out the missing point.';

const rowSel = '#wfp-editor-root .wfpe-inspector-row[data-wfpe-row="annotation"]';
const textareaSel = '#wfp-editor-root .wfpe-annotation-input';
const saveSel = '#wfp-editor-root .wfpe-annotation-save-btn';
const deleteSel = '#wfp-editor-root .wfpe-annotation-delete-btn';
// v2.11 — the standalone Handoff button was merged into Export (badge +
// action menu). "handoffDisabled" below is kept as a field name for
// minimal diff, but now reflects the export badge's zero/non-zero count
// (row 1 is never actually disabled post-merge — it degrades to a plain
// save at zero annotations).
const exportBtnSel = '#wfp-editor-root button[data-action="export"]';
const exportPrimarySel = '#wfp-editor-root .wfpe-export-menu-item[data-action="save-in-place"]';
const exportCleanSel = '#wfp-editor-root .wfpe-export-menu-item[data-action="clean-copy"]';
const exportBadgeSel = '#wfp-editor-root .wfpe-export-badge';
const markerSel = '#wfp-editor-root .wfpe-annotation-badge';
const statusSel = '#wfp-editor-root .wfpe-annotation-status';

test.use({ viewport: { width: 2000, height: 1200 } });

async function loadReady(page) {
  await page.goto(pathToFileURL(FIXTURE_PATH).href);
  await page.locator('.slide.active').first().waitFor({ state: 'attached', timeout: 10_000 });
  await page.addScriptTag({ path: EDITOR_PATH });
  await page.waitForFunction(() => window.__wfpEditorReady === true, null, { timeout: 10_000 });
  await page.keyboard.press('e');
}

async function clickToSelect(page, selector, modifiers = {}) {
  await page.evaluate(({ selector: sel, modifiers: mods }) => {
    const el = document.querySelector(sel);
    const r = el.getBoundingClientRect();
    el.dispatchEvent(
      new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
        view: window,
        clientX: r.left + r.width / 2,
        clientY: r.top + r.height / 2,
        metaKey: !!mods.metaKey,
        ctrlKey: !!mods.ctrlKey,
      }),
    );
  }, { selector, modifiers });
}

async function saveNote(page, selector, note) {
  await clickToSelect(page, selector);
  await page.locator(textareaSel).fill(note);
  await page.locator(saveSel).click();
}

async function readAnnotation(page, selector = '.slide.active h1') {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    return {
      id: el?.getAttribute('data-wfp-edit-annotation-id') || '',
      text: el?.getAttribute('data-wfp-edit-annotation-text') || '',
      annotatedCount: document.querySelectorAll('[data-wfp-edit-annotation-id]').length,
      handoffDisabled: (document.querySelector('#wfp-editor-root .wfpe-export-badge')?.dataset.count || '0') === '0',
      markerCount: document.querySelectorAll('#wfp-editor-root .wfpe-annotation-badge').length,
      rowDirty: document.querySelector('#wfp-editor-root .wfpe-inspector-row[data-wfpe-row="annotation"]')?.dataset.dirty || '',
      rowHasNote: document.querySelector('#wfp-editor-root .wfpe-inspector-row[data-wfpe-row="annotation"]')?.dataset.hasNote || '',
      status: document.querySelector('#wfp-editor-root .wfpe-annotation-status')?.textContent || '',
      textarea: document.querySelector('#wfp-editor-root .wfpe-annotation-input')?.value || '',
    };
  }, selector);
}

async function readDownloadAsString(download) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const unique = `${Date.now()}-${Math.random().toString(36).slice(2)}-${download.suggestedFilename()}`;
  const out = path.join(OUTPUT_DIR, unique);
  await download.saveAs(out);
  return { path: out, content: fs.readFileSync(out, 'utf-8') };
}

// v2.11 — Cmd/Ctrl+S is now a macro for the export menu's row 1 (the
// "primary"/recommended action), which performs the *handoff* save when
// annotations exist (see triggerPrimaryExport in editor.js). A guaranteed
// clean/no-annotations export is therefore row 2 ("Clean copy") in the
// menu, not the keyboard shortcut — both existing call sites below fire
// while an annotation is present, so they're rerouted through the menu.
async function triggerNormalExport(page) {
  const downloadPromise = page.waitForEvent('download', { timeout: 5_000 });
  await page.locator(exportBtnSel).click();
  await page.locator(exportCleanSel).click();
  return downloadPromise;
}

async function triggerHandoffExport(page) {
  const downloadPromise = page.waitForEvent('download', { timeout: 5_000 });
  await page.locator(exportBtnSel).click();
  await page.locator(exportPrimarySel).click();
  return downloadPromise;
}

function extractHandoffPayload(html) {
  const match = html.match(/<script type="application\/json" data-wfp-agent-annotations="">([\s\S]*?)<\/script>/);
  if (!match) throw new Error('Handoff payload not found');
  return JSON.parse(match[1]);
}

test.describe('v2.5 — agent handoff annotations', () => {
  test('annotation row visibility follows single selection, multi-select, and Overview', async ({ page }) => {
    await loadReady(page);

    expect(await page.locator('#wfp-editor-root .wfpe-inspector').getAttribute('data-visible')).toBe('false');
    await expect(page.locator(exportBadgeSel)).toHaveAttribute('data-count', '0');
    await expect(page.locator(markerSel)).toHaveCount(0);

    await clickToSelect(page, '.slide.active h1');
    await expect(page.locator('#wfp-editor-root .wfpe-inspector')).toHaveAttribute('data-visible', 'true');
    await expect(page.locator(rowSel)).toBeVisible();
    await expect(page.locator(textareaSel)).toHaveValue('');

    await clickToSelect(page, '.slide.active .foreign-note', { metaKey: true });
    await expect(page.locator('#wfp-editor-root .wfpe-inspector')).toHaveAttribute('data-visible', 'false');

    await page.keyboard.press('o');
    await expect(page.locator('#wfp-editor-root .wfpe-inspector')).toHaveAttribute('data-visible', 'false');
  });

  test('save, edit, delete, empty-save delete, and unchanged-save no-op are undoable', async ({ page }) => {
    await loadReady(page);

    await saveNote(page, '.slide.active h1', NOTE);
    let state = await readAnnotation(page);
    expect(state.id).toMatch(/^ann-/);
    expect(state.text).toBe(NOTE);
    expect(state.handoffDisabled).toBe(false);
    expect(state.markerCount).toBe(1);
    expect(state.rowHasNote).toBe('true');
    expect(state.rowDirty).toBe('false');
    expect(state.status).toBe('Saved');
    await expect(page.locator(markerSel)).toHaveText('');
    await expect(page.locator(markerSel)).toHaveAttribute('aria-label', 'Agent note');
    await expect(page.locator(statusSel)).toHaveText('Saved');

    const markerStyle = await page.locator(markerSel).evaluate((el) => {
      const cs = getComputedStyle(el);
      const tail = getComputedStyle(el, '::after');
      return {
        width: cs.width,
        height: cs.height,
        radius: cs.borderTopLeftRadius,
        background: cs.backgroundImage,
        tailContent: tail.content,
      };
    });
    expect(markerStyle.width).toBe('16px');
    expect(markerStyle.height).toBe('16px');
    expect(markerStyle.radius).toBe('50%');
    expect(markerStyle.background).toMatch(/radial-gradient/);
    expect(markerStyle.background).toMatch(/244,\s*132,\s*123/);
    expect(markerStyle.tailContent).toBe('none');

    await page.locator(textareaSel).fill(NOTE_EDITED);
    await expect(page.locator(statusSel)).toHaveText('Unsaved');
    await page.locator(saveSel).click();
    state = await readAnnotation(page);
    expect(state.text).toBe(NOTE_EDITED);
    expect(state.markerCount).toBe(1);
    expect(state.status).toBe('Saved');

    await page.locator(saveSel).click();
    await page.keyboard.press('ControlOrMeta+z');
    state = await readAnnotation(page);
    expect(state.text).toBe(NOTE);
    expect(state.markerCount).toBe(1);

    await page.locator(deleteSel).click();
    state = await readAnnotation(page);
    expect(state.text).toBe('');
    expect(state.handoffDisabled).toBe(true);
    expect(state.markerCount).toBe(0);

    await page.keyboard.press('ControlOrMeta+z');
    state = await readAnnotation(page);
    expect(state.text).toBe(NOTE);
    expect(state.handoffDisabled).toBe(false);
    expect(state.markerCount).toBe(1);

    await page.locator(textareaSel).fill('   ');
    await expect(page.locator(textareaSel)).toHaveValue('   ');
    await expect(page.locator(statusSel)).toHaveText('Will delete');
    await page.locator(saveSel).click();
    state = await readAnnotation(page);
    expect(state.text).toBe('');
    expect(state.handoffDisabled).toBe(true);
    expect(state.markerCount).toBe(0);

    await page.keyboard.press('ControlOrMeta+z');
    state = await readAnnotation(page);
    expect(state.text).toBe(NOTE);
    expect(state.markerCount).toBe(1);

    await page.keyboard.press('ControlOrMeta+y');
    state = await readAnnotation(page);
    expect(state.text).toBe('');
    expect(state.handoffDisabled).toBe(true);
    expect(state.markerCount).toBe(0);
  });

  test('annotation marker selects the annotated element and reloads its note', async ({ page }) => {
    await loadReady(page);
    await saveNote(page, '.slide.active h1', NOTE);

    await clickToSelect(page, '.slide.active .foreign-note');
    await expect(page.locator(textareaSel)).toHaveValue('');
    await page.locator(markerSel).click();
    await expect(page.locator(textareaSel)).toHaveValue(NOTE);
    await expect(page.locator(statusSel)).toHaveText('Saved');
  });

  test('unsaved annotation draft is discarded when selecting another element', async ({ page }) => {
    await loadReady(page);

    await clickToSelect(page, '.slide.active h1');
    await page.locator(textareaSel).fill(NOTE);
    await expect(page.locator(statusSel)).toHaveText('Unsaved');

    await clickToSelect(page, '.slide.active .foreign-note');
    await expect(page.locator(textareaSel)).toHaveValue('');
    await expect(page.locator(statusSel)).toHaveText('');

    const state = await page.evaluate(() => ({
      headingId: document.querySelector('.slide.active h1')?.getAttribute('data-wfp-edit-annotation-id') || '',
      headingText: document.querySelector('.slide.active h1')?.getAttribute('data-wfp-edit-annotation-text') || '',
      noteText: document.querySelector('.slide.active .foreign-note')?.getAttribute('data-wfp-edit-annotation-text') || '',
      rowDirty: document.querySelector('#wfp-editor-root .wfpe-inspector-row[data-wfpe-row="annotation"]')?.dataset.dirty || '',
      rowHasNote: document.querySelector('#wfp-editor-root .wfpe-inspector-row[data-wfpe-row="annotation"]')?.dataset.hasNote || '',
    }));

    expect(state.headingId).toBe('');
    expect(state.headingText).toBe('');
    expect(state.noteText).toBe('');
    expect(state.rowDirty).toBe('false');
    expect(state.rowHasNote).toBe('false');
  });

  test('can add annotations to multiple selected elements', async ({ page }) => {
    await loadReady(page);
    await saveNote(page, '.slide.active h1', NOTE);
    await saveNote(page, '.slide.active .foreign-note', NOTE_EDITED);

    const state = await page.evaluate(() => ({
      annotatedCount: document.querySelectorAll('[data-wfp-edit-annotation-id]').length,
      markerCount: document.querySelectorAll('#wfp-editor-root .wfpe-annotation-badge').length,
      headingNote: document.querySelector('.slide.active h1')?.getAttribute('data-wfp-edit-annotation-text') || '',
      paragraphNote: document.querySelector('.slide.active .foreign-note')?.getAttribute('data-wfp-edit-annotation-text') || '',
      handoffDisabled: (document.querySelector('#wfp-editor-root .wfpe-export-badge')?.dataset.count || '0') === '0',
    }));

    expect(state.annotatedCount).toBe(2);
    expect(state.markerCount).toBe(2);
    expect(state.headingNote).toBe(NOTE);
    expect(state.paragraphNote).toBe(NOTE_EDITED);
    expect(state.handoffDisabled).toBe(false);
  });

  test('inspector annotation controls stay above selection handles', async ({ page }) => {
    await loadReady(page);
    await clickToSelect(page, '.slide.active .foreign-note');
    await expect(page.locator(rowSel)).toBeVisible();

    const layers = await page.evaluate(() => {
      // Ink-glass 3b: the inspector's stacking stratum lives on its dock
      // wrapper — the panel itself is z-index:auto inside the dock.
      const inspectorDock = document.querySelector('#wfp-editor-root .wfpe-inspector-dock');
      const toolbar = document.querySelector('#wfp-editor-root .wfpe-toolbar');
      const annotationLayer = document.querySelector('#wfp-editor-root .wfpe-annotation-layer');
      const handle = document.querySelector('#wfp-editor-root .wfpe-handle');
      return {
        inspector: Number(getComputedStyle(inspectorDock).zIndex),
        toolbar: Number(getComputedStyle(toolbar).zIndex),
        annotationLayer: Number(getComputedStyle(annotationLayer).zIndex),
        handle: Number(getComputedStyle(handle).zIndex),
      };
    });

    expect(layers.inspector).toBeGreaterThan(layers.handle);
    expect(layers.toolbar).toBeGreaterThan(layers.handle);
    expect(layers.annotationLayer).toBeGreaterThan(layers.handle);

    await page.locator(textareaSel).fill(NOTE_EDITED);
    await expect(page.locator(statusSel)).toHaveText('Unsaved');
    await page.locator(saveSel).focus();
    await page.evaluate(() => window.dispatchEvent(new Event('resize')));
    await expect(page.locator(textareaSel)).toHaveValue(NOTE_EDITED);
    await page.locator(saveSel).click();

    const state = await readAnnotation(page, '.slide.active .foreign-note');
    expect(state.text).toBe(NOTE_EDITED);
    expect(state.markerCount).toBe(1);
    expect(state.status).toBe('Saved');
  });

  test('duplicate and explicit copy/paste do not copy annotation markers to clones', async ({ page }) => {
    await loadReady(page);
    await saveNote(page, '.slide.active h1', NOTE);
    expect((await readAnnotation(page)).text).toBe(NOTE);

    await page.locator('#wfp-editor-root .wfpe-duplicate-btn').click();
    const state = await page.evaluate(() => {
      const headings = [...document.querySelectorAll('.slide.active h1')];
      const clone = headings[headings.length - 1];
      return {
        annotatedCount: document.querySelectorAll('[data-wfp-edit-annotation-id]').length,
        cloneId: clone?.getAttribute('data-wfp-edit-annotation-id') || '',
        cloneText: clone?.getAttribute('data-wfp-edit-annotation-text') || '',
        textarea: document.querySelector('#wfp-editor-root .wfpe-annotation-input')?.value || '',
      };
    });

    expect(state.annotatedCount).toBe(1);
    expect(state.cloneId).toBe('');
    expect(state.cloneText).toBe('');
    expect(state.textarea).toBe('');

    await clickToSelect(page, '.slide.active h1');
    await page.keyboard.press('ControlOrMeta+c');
    await page.keyboard.press('ControlOrMeta+v');

    const pasted = await page.evaluate(() => {
      const headings = [...document.querySelectorAll('.slide.active h1')];
      const clone = headings[headings.length - 1];
      return {
        annotatedCount: document.querySelectorAll('[data-wfp-edit-annotation-id]').length,
        cloneId: clone?.getAttribute('data-wfp-edit-annotation-id') || '',
        cloneText: clone?.getAttribute('data-wfp-edit-annotation-text') || '',
        cloneHandoffId: clone?.getAttribute('data-wfp-agent-annotation-id') || '',
        textarea: document.querySelector('#wfp-editor-root .wfpe-annotation-input')?.value || '',
      };
    });

    expect(pasted.annotatedCount).toBe(1);
    expect(pasted.cloneId).toBe('');
    expect(pasted.cloneText).toBe('');
    expect(pasted.cloneHandoffId).toBe('');
    expect(pasted.textarea).toBe('');
  });

  test('normal export strips annotation and handoff metadata', async ({ page }) => {
    await loadReady(page);
    await saveNote(page, '.slide.active h1', NOTE);

    const download = await triggerNormalExport(page);
    expect(download.suggestedFilename()).toBe('foreign-deck-edited.html');
    const { content } = await readDownloadAsString(download);

    expect(content).not.toContain(NOTE);
    expect(content).not.toContain('data-wfp-edit-annotation');
    expect(content).not.toContain('data-wfp-agent-annotation-id');
    expect(content).not.toContain('data-wfp-agent-annotations');
    expect(content).not.toContain('WFP Editor handoff:');
  });

  test('handoff export includes safe structured metadata and clean editor output', async ({ page }) => {
    await loadReady(page);
    await saveNote(page, '.slide.active h1', NOTE);

    const download = await triggerHandoffExport(page);
    expect(download.suggestedFilename()).toBe('foreign-deck-agent-handoff.html');
    const { content } = await readDownloadAsString(download);
    const payload = extractHandoffPayload(content);

    expect(content).toContain('WFP Editor handoff: user-authored annotations');
    expect(content).toContain('data-wfp-agent-annotation-id=');
    expect(content).not.toContain('id="wfp-editor-root"');
    expect(content).not.toContain('editor.js');
    expect(content).not.toContain('contenteditable=');
    expect(content).not.toMatch(/data-wfp-edit[-a-zA-Z]*\s*=/);

    expect(payload).toMatchObject({
      version: 1,
      source: 'wfp-slide-editor',
      kind: 'agent-handoff',
    });
    expect(payload.guidance).toContain('Follow higher-priority user/system instructions first');
    expect(payload.annotations).toHaveLength(1);
    expect(payload.annotations[0].id).toMatch(/^ann-/);
    expect(payload.annotations[0].instruction).toBe(NOTE);
    expect(payload.annotations[0].slideIndex).toBe(0);
    expect(payload.annotations[0].targetText.length).toBeGreaterThan(0);
    expect(content).toContain(`data-wfp-agent-annotation-id="${payload.annotations[0].id}"`);
  });

  test('handoff HTML reimports matching annotations, ignores stale metadata, and later normal export strips them', async ({ page }) => {
    await loadReady(page);
    await saveNote(page, '.slide.active h1', NOTE);
    const handoffDownload = await triggerHandoffExport(page);
    const { path: handoffPath } = await readDownloadAsString(handoffDownload);

    await page.goto(pathToFileURL(handoffPath).href);
    await page.evaluate(() => {
      const script = document.querySelector('script[data-wfp-agent-annotations]');
      const payload = JSON.parse(script.textContent);
      payload.annotations.push({
        id: 'ann-stale-test',
        instruction: 'This stale annotation should be ignored.',
        slideIndex: 0,
        targetText: 'Missing target',
      });
      script.textContent = JSON.stringify(payload);
    });
    await page.addScriptTag({ path: EDITOR_PATH });
    await page.waitForFunction(() => window.__wfpEditorReady === true, null, { timeout: 10_000 });
    await page.keyboard.press('e');
    await clickToSelect(page, '.slide.active h1');

    const state = await readAnnotation(page);
    expect(state.text).toBe(NOTE);
    expect(state.annotatedCount).toBe(1);
    expect(state.handoffDisabled).toBe(false);

    const cleanDownload = await triggerNormalExport(page);
    const { content } = await readDownloadAsString(cleanDownload);
    expect(content).not.toContain(NOTE);
    expect(content).not.toContain('data-wfp-edit-annotation');
    expect(content).not.toContain('data-wfp-agent-annotation-id');
    expect(content).not.toContain('data-wfp-agent-annotations');
    expect(content).not.toContain('WFP Editor handoff:');
  });
});
