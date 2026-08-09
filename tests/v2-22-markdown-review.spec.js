import { test, expect } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { EDITOR_PATH } from './_helpers.js';
import { renderMarkdown, scanBlocks } from '../src/md/render.js';
import { applyMarkdownWriteback, serializeCallout } from '../src/md/writeback.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const HOST_PAGE = path.join(PROJECT_ROOT, 'tools', 'md-review.html');

const SAMPLE = `# Plan

The revenue target is **$4M** for Q3.

## Steps

- first item
- second item

Final paragraph.
`;

// ── Pure layer: render + writeback run in Node, no browser needed ───────────

test.describe('v2.22 — markdown render layer', () => {
  test('every block carries its exact source line range', () => {
    const { blocks } = renderMarkdown(SAMPLE);
    expect(blocks.map((b) => [b.type, b.start, b.end])).toEqual([
      ['heading', 0, 0],
      ['paragraph', 2, 2],
      ['heading', 4, 4],
      ['list', 6, 7],
      ['paragraph', 9, 9],
    ]);
  });

  test('callouts are lifted out of content and bound to the preceding block', () => {
    const withNote = SAMPLE.replace(
      'The revenue target is **$4M** for Q3.\n',
      'The revenue target is **$4M** for Q3.\n\n> [!HARRY] stale figure\n> status: needs-input\n> reply: which model?\n',
    );
    const { html, notes, blocks } = renderMarkdown(withNote);
    expect(html).not.toContain('blockquote');
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({
      text: 'stale figure',
      status: 'needs-input',
      reply: 'which model?',
      anchorLine: 2,
      anchorEnd: 2,
    });
    expect(blocks.map((b) => b.type)).toEqual(['heading', 'paragraph', 'heading', 'list', 'paragraph']);
  });

  test('inline markup renders and unsafe URLs are made inert', () => {
    const { html } = renderMarkdown('A [safe](https://x.com) and [bad](javascript:alert(1)) link.\n');
    expect(html).toContain('<a href="https://x.com">safe</a>');
    // The rejected link survives as literal text — so assert on what makes it
    // dangerous (a live href), not on the substring, which is expected here.
    expect(html).not.toMatch(/href="\s*javascript:/i);
    expect(html).toContain('[bad](javascript:alert(1))');

    const image = renderMarkdown('![x](data:image/png;base64,AAA)\n').html;
    expect(image).not.toContain('<img');

    const allowed = renderMarkdown('[m](mailto:a@b.com) and [r](./other.md)\n').html;
    expect(allowed).toContain('href="mailto:a@b.com"');
    expect(allowed).toContain('href="./other.md"');
  });

  test('code spans are never parsed as emphasis', () => {
    const { html } = renderMarkdown('Use `a * b * c` here.\n');
    expect(html).toContain('<code>a * b * c</code>');
    expect(html).not.toContain('<em>');
  });
});

test.describe('v2.22 — markdown writeback', () => {
  test('a file with no note changes round-trips byte-identically', () => {
    const { notes } = renderMarkdown(SAMPLE);
    const out = applyMarkdownWriteback(SAMPLE, { sourceNotes: notes, notes: [], edits: [] });
    expect(out.text).toBe(SAMPLE);
  });

  test('multiple notes in one save land on the right blocks', () => {
    const { blocks } = renderMarkdown(SAMPLE);
    const out = applyMarkdownWriteback(SAMPLE, {
      sourceNotes: [],
      notes: [
        { text: 'stale figure', anchorEnd: blocks[1].end, noteStart: null },
        { text: 'still the order?', anchorEnd: blocks[3].end, noteStart: null },
      ],
      edits: [],
    });
    expect(out.inserted).toBe(2);
    const reparsed = renderMarkdown(out.text);
    expect(reparsed.notes.map((n) => n.text)).toEqual(['stale figure', 'still the order?']);
    // Bound to the same blocks they were written against.
    expect(reparsed.blocks[1].type).toBe('paragraph');
    expect(reparsed.notes[0].anchorLine).toBe(reparsed.blocks[1].start);
    expect(reparsed.notes[1].anchorLine).toBe(reparsed.blocks[3].start);
    // Content is untouched.
    expect(reparsed.blocks.map((b) => b.type)).toEqual(['heading', 'paragraph', 'heading', 'list', 'paragraph']);
  });

  test('two notes on one block keep their order', () => {
    const { blocks } = renderMarkdown(SAMPLE);
    const out = applyMarkdownWriteback(SAMPLE, {
      sourceNotes: [],
      notes: [
        { text: 'first note', anchorEnd: blocks[1].end, noteStart: null },
        { text: 'second note', anchorEnd: blocks[1].end, noteStart: null },
      ],
      edits: [],
    });
    expect(renderMarkdown(out.text).notes.map((n) => n.text)).toEqual(['first note', 'second note']);
  });

  test('editing and deleting notes does not accumulate blank lines', () => {
    const { blocks } = renderMarkdown(SAMPLE);
    const first = applyMarkdownWriteback(SAMPLE, {
      sourceNotes: [],
      notes: [
        { text: 'note A', anchorEnd: blocks[1].end, noteStart: null },
        { text: 'note B', anchorEnd: blocks[3].end, noteStart: null },
      ],
      edits: [],
    });
    const parsed = renderMarkdown(first.text);
    const live = parsed.notes.map((n) => ({ ...n }));
    live[0].text = 'note A edited';
    const second = applyMarkdownWriteback(first.text, {
      sourceNotes: parsed.notes,
      notes: [live[0]],
      edits: [],
    });
    expect(second.updated).toBe(1);
    expect(second.removed).toBe(1);
    expect(renderMarkdown(second.text).notes.map((n) => n.text)).toEqual(['note A edited']);
    expect(second.text).not.toMatch(/\n\n\n\n/);
    // Removing the last note restores the original file exactly.
    const third = applyMarkdownWriteback(second.text, {
      sourceNotes: renderMarkdown(second.text).notes,
      notes: [],
      edits: [],
    });
    expect(third.text).toBe(SAMPLE);
  });

  test('text edits preserve heading syntax and leave other blocks alone', () => {
    const { blocks } = renderMarkdown(SAMPLE);
    const out = applyMarkdownWriteback(SAMPLE, {
      sourceNotes: [],
      notes: [],
      edits: [
        { start: blocks[0].start, end: blocks[0].end, kind: 'heading', level: 1, text: 'Revised plan' },
        { start: blocks[4].start, end: blocks[4].end, kind: 'paragraph', text: 'Rewritten ending.' },
      ],
    });
    expect(out.text).toContain('# Revised plan');
    expect(out.text).toContain('Rewritten ending.');
    expect(out.text).toContain('- first item');
    expect(scanBlocks(out.text.split('\n')).map((b) => b.type)).toEqual([
      'heading', 'paragraph', 'heading', 'list', 'paragraph',
    ]);
  });

  test('callout serialization carries the agent channel back', () => {
    expect(serializeCallout({ text: 'fix this', status: 'needs-input', reply: 'how?' })).toEqual([
      '> [!HARRY] fix this',
      '> status: needs-input',
      '> reply: how?',
    ]);
  });
});

// ── Browser layer: the host page + the editor's markdown mode ───────────────

async function loadHost(page, markdown) {
  await page.goto(pathToFileURL(HOST_PAGE).href);
  await page.waitForFunction(() => !!window.__wfpMarkdownHost, null, { timeout: 10_000 });
  await page.evaluate((md) => window.__wfpMarkdownHost.renderInto(md), markdown);
  await page.evaluate(() => { document.documentElement.dataset.wfpMarkdown = 'true'; });
  await page.addScriptTag({ path: EDITOR_PATH });
  await page.waitForFunction(() => window.__wfpEditorReady === true, null, { timeout: 10_000 });
  // No 'e' press: markdown mode enters edit mode on its own, and pressing it
  // here would toggle it straight back off.
  await page.waitForFunction(
    () => document.querySelector('#wfp-editor-root .wfpe-toolbar')?.dataset.mode === 'on',
    null,
    { timeout: 5_000 },
  );
}

test.describe('v2.22 — markdown mode in the browser', () => {
  test('edit mode is already on — the surface exists only to annotate', async ({ page }) => {
    await loadHost(page, SAMPLE);
    await expect(page.locator('#wfp-editor-root .wfpe-toolbar')).toHaveAttribute('data-mode', 'on');
    // And a block is immediately selectable without any mode toggle.
    await page.locator('#md-doc p').first().click();
    await expect(page.locator('#wfp-editor-root [data-wfpe-row="annotation"]')).toBeVisible();
  });

  test('the folder controls are present and the file list stays hidden until used', async ({ page }) => {
    await page.goto(pathToFileURL(HOST_PAGE).href);
    await page.waitForFunction(() => !!window.__wfpMarkdownHost, null, { timeout: 10_000 });
    await expect(page.locator('#md-open-dir')).toBeVisible();
    await expect(page.locator('#md-open')).toBeVisible();
    await expect(page.locator('#md-files')).toBeHidden();
    await expect(page.locator('#md-status')).toContainText('Open a folder');
  });

  test('rendered markdown becomes an annotatable flat document', async ({ page }) => {
    await loadHost(page, SAMPLE);
    const state = await page.evaluate(() => ({
      blocks: document.querySelectorAll('#md-doc [data-md-line]').length,
      firstLine: document.querySelector('#md-doc p').dataset.mdLine,
    }));
    expect(state.blocks).toBeGreaterThan(4);
    expect(state.firstLine).toBe('2');
  });

  test('geometry controls and handles are gated off; the note row survives', async ({ page }) => {
    await loadHost(page, SAMPLE);
    await page.locator('#md-doc p').first().click();
    await expect(page.locator('#wfp-editor-root .wfpe-inspector-dock')).toHaveAttribute('data-visible', 'true');
    await expect(page.locator('#wfp-editor-root [data-wfpe-row="annotation"]')).toBeVisible();
    for (const row of [
      'position', 'size', 'text-color', 'bg-color', 'opacity',
      'font-size', 'font-weight', 'text-align', 'actions',
    ]) {
      await expect(page.locator(`#wfp-editor-root [data-wfpe-row="${row}"]`)).toBeHidden();
    }
    // Row keys are easy to guess wrong; prove each selector matched a real row.
    const rowCount = await page.locator('#wfp-editor-root .wfpe-inspector-body [data-wfpe-row]').count();
    expect(rowCount).toBeGreaterThanOrEqual(9);
    const handlesVisible = await page.evaluate(() =>
      [...document.querySelectorAll('#wfp-editor-root .wfpe-handle')]
        .some((h) => getComputedStyle(h).display !== 'none'));
    expect(handlesVisible).toBe(false);
  });

  test('dragging a block writes no inline style', async ({ page }) => {
    await loadHost(page, SAMPLE);
    const target = page.locator('#md-doc p').first();
    await target.click();
    const box = await target.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 80, box.y + box.height / 2 + 40, { steps: 5 });
    await page.mouse.up();
    expect(await target.getAttribute('style')).toBeFalsy();
  });

  test('a note added in the editor writes back as a callout', async ({ page }) => {
    await loadHost(page, SAMPLE);
    await page.locator('#md-doc p').first().click();
    await page.locator('#wfp-editor-root .wfpe-annotation-input').fill('this figure is from the old model');
    await page.locator('#wfp-editor-root .wfpe-annotation-save-btn').click();

    const out = await page.evaluate(() => window.__wfpMarkdownHost.writeback());
    expect(out.inserted).toBe(1);
    expect(out.text).toContain('> [!HARRY] this figure is from the old model');
    // The paragraph it annotates is untouched.
    expect(out.text).toContain('The revenue target is **$4M** for Q3.');
  });

  test('saved callouts reappear as annotations, not as content', async ({ page }) => {
    const withNote = `${SAMPLE}\n> [!HARRY] check this ending\n`;
    await loadHost(page, withNote);
    const state = await page.evaluate(() => ({
      blockquotes: document.querySelectorAll('#md-doc blockquote').length,
      annotated: document.querySelectorAll('#md-doc [data-wfp-edit-annotation-id]').length,
      text: document.querySelector('#md-doc [data-wfp-edit-annotation-text]')
        ?.getAttribute('data-wfp-edit-annotation-text'),
    }));
    expect(state.blockquotes).toBe(0);
    expect(state.annotated).toBe(1);
    expect(state.text).toBe('check this ending');
    // And the notes panel lists it.
    await page.locator('#wfp-editor-root button[data-action="notes"]').click();
    await expect(page.locator('#wfp-editor-root .wfpe-notes-card')).toHaveCount(1);
  });

  test('text editing moves from one block to the next without leaving edit mode', async ({ page }) => {
    await loadHost(page, 'First paragraph.\n\nSecond paragraph.\n\nThird paragraph.\n');
    const paragraphs = page.locator('#md-doc p');

    await paragraphs.nth(0).dblclick();
    await expect(paragraphs.nth(0)).toHaveAttribute('contenteditable', 'true');

    // The mousedown that opens the next edit must first commit the open one.
    // onMouseDown owns that teardown, so any early return placed ahead of it
    // strands state.editingText and every later block becomes uneditable.
    await paragraphs.nth(1).dblclick();
    await expect(paragraphs.nth(1)).toHaveAttribute('contenteditable', 'true');
    await expect(paragraphs.nth(0)).not.toHaveAttribute('contenteditable', 'true');

    await paragraphs.nth(2).dblclick();
    await expect(paragraphs.nth(2)).toHaveAttribute('contenteditable', 'true');
    expect(await page.locator('#md-doc [contenteditable="true"]').count()).toBe(1);
  });

  test('clicking a different block after a text edit still selects it', async ({ page }) => {
    await loadHost(page, 'First paragraph.\n\nSecond paragraph.\n');
    await page.locator('#md-doc p').nth(0).dblclick();
    await page.locator('#md-doc p').nth(1).click();
    await expect(page.locator('#wfp-editor-root [data-wfpe-row="annotation"]')).toBeVisible();
    expect(await page.locator('#md-doc [contenteditable="true"]').count()).toBe(0);
  });

  test('editing a formatted block never flattens its markdown syntax', async ({ page }) => {
    await loadHost(page, SAMPLE);
    // Retyping the paragraph destroys the <strong> in the DOM. The skip
    // decision must come from the SOURCE, or the bold would be silently lost.
    const result = await page.evaluate(() => {
      const p = document.querySelector('#md-doc p[data-md-line="2"]');
      p.textContent = 'The revenue target is 4 million for Q3.';
      const collected = window.__wfpMarkdownHost.collectEdits();
      return { collected, out: window.__wfpMarkdownHost.writeback().text };
    });
    expect(result.collected.edits).toHaveLength(0);
    expect(result.collected.skipped).toHaveLength(1);
    expect(result.out).toContain('The revenue target is **$4M** for Q3.');
    expect(result.out).not.toContain('4 million');
  });

  test('editing a plain heading rewrites its source line and keeps the hashes', async ({ page }) => {
    await loadHost(page, SAMPLE);
    const out = await page.evaluate(() => {
      document.querySelector('#md-doc h2').textContent = 'Revised steps';
      return window.__wfpMarkdownHost.writeback();
    });
    expect(out.edited).toBe(1);
    expect(out.text).toContain('## Revised steps');
    expect(out.text).not.toContain('## Steps');
  });

  test('the notes panel lists every note across the document', async ({ page }) => {
    await loadHost(page, SAMPLE);
    await page.locator('#md-doc p').first().click();
    await page.locator('#wfp-editor-root .wfpe-annotation-input').fill('first note');
    await page.locator('#wfp-editor-root .wfpe-annotation-save-btn').click();
    await page.locator('#md-doc li').first().click();
    await page.locator('#wfp-editor-root .wfpe-annotation-input').fill('second note');
    await page.locator('#wfp-editor-root .wfpe-annotation-save-btn').click();

    await page.locator('#wfp-editor-root button[data-action="notes"]').click();
    await expect(page.locator('#wfp-editor-root .wfpe-notes-card')).toHaveCount(2);
    const out = await page.evaluate(() => window.__wfpMarkdownHost.writeback());
    expect(out.inserted).toBe(2);
    expect(renderMarkdownCount(out.text)).toBe(2);

    function renderMarkdownCount(text) {
      return (text.match(/\[!HARRY\]/g) || []).length;
    }
  });
});
