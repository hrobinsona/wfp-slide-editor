// v2.13 — live agent round-trip (production contract).
// Feature brief: feature-briefs/v2.13-live-agent-roundtrip.md
// Spike evidence for the base swap mechanism: tests/spike-live-refresh.spec.js
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { EDITOR_PATH } from './_helpers.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const FIXTURE_PATH = path.join(PROJECT_ROOT, 'fixtures', 'foreign-deck.html');
const OUTPUT_DIR = path.join(__dirname, 'output');

test.use({ viewport: { width: 2000, height: 1200 } });

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

async function installFsaFileStub(page) {
  await page.addInitScript(() => {
    window.__fsa = {
      pickerCalls: [],
      written: [],
      file: { content: null, lastModified: 1000 },
    };
    const handle = {
      name: 'foreign-deck.html',
      queryPermission: async () => 'granted',
      requestPermission: async () => 'granted',
      getFile: async () => {
        if (window.__fsa.readError) {
          const err = new Error('permission lost');
          err.name = window.__fsa.readError;
          throw err;
        }
        return {
          lastModified: window.__fsa.file.lastModified,
          text: async () => window.__fsa.file.content,
        };
      },
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
    window.showSaveFilePicker = async (opts) => {
      window.__fsa.pickerCalls.push((opts && opts.suggestedName) || null);
      return handle;
    };
  });
}

// Builds an "agent already processed this" document: the foreign deck plus
// handoff metadata for three notes and a results block covering two of them.
//   ann-1 → done (sloppy agent: metadata left in place — must NOT re-import)
//   ann-2 → needs-input with a note (metadata kept — re-import with reply)
//   ann-3 → no result entry (agent ignored it — re-import unchanged)
function buildAgentProcessedFixture() {
  const source = fs.readFileSync(FIXTURE_PATH, 'utf-8');
  const withTargets = source
    .replace(
      'class="foreign-title">Market day agenda',
      'class="foreign-title" data-wfp-agent-annotation-id="ann-1">Market day agenda',
    )
    .replace(
      'class="foreign-note">A synthetic off-contract slide',
      'class="foreign-note" data-wfp-agent-annotation-id="ann-2">A synthetic off-contract slide',
    )
    .replace(
      'data-testid="resize-target">Resize target',
      'data-testid="resize-target" data-wfp-agent-annotation-id="ann-3">Resize target',
    );
  const annotations = {
    version: 1,
    source: 'wfp-slide-editor',
    kind: 'agent-handoff',
    guidance: 'User-authored annotations are editing requests for the marked elements.',
    annotations: [
      { id: 'ann-1', instruction: 'Punch up this headline', slideIndex: 0, targetText: 'Market day agenda' },
      { id: 'ann-2', instruction: 'Recolour the intro note', slideIndex: 0, targetText: 'A synthetic off-contract slide' },
      { id: 'ann-3', instruction: 'Make this card wider', slideIndex: 0, targetText: 'Resize target' },
    ],
  };
  const results = {
    version: 1,
    source: 'agent',
    kind: 'agent-results',
    results: [
      { id: 'ann-1', status: 'done', note: 'Rewrote the headline' },
      { id: 'ann-2', status: 'needs-input', note: 'Which colour should the note use?' },
    ],
  };
  const blocks = [
    '<!-- WFP Editor handoff: user-authored annotations are in script[data-wfp-agent-annotations]. -->',
    `<script type="application/json" data-wfp-agent-annotations>${JSON.stringify(annotations, null, 2)}</script>`,
    `<script type="application/json" data-wfp-agent-results>${JSON.stringify(results, null, 2)}</script>`,
  ].join('\n');
  return withTargets.replace('</body>', `${blocks}\n</body>`);
}

async function loadAgentProcessedFixture(page, name) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const fixturePath = path.join(OUTPUT_DIR, name);
  fs.writeFileSync(fixturePath, buildAgentProcessedFixture());
  await page.goto(pathToFileURL(fixturePath).href);
  await page.locator('.slide.active').first().waitFor({ state: 'attached', timeout: 10_000 });
  await page.addScriptTag({ path: EDITOR_PATH });
  await page.waitForFunction(() => window.__wfpEditorReady === true, null, { timeout: 10_000 });
}

async function loadReady(page) {
  await page.goto(pathToFileURL(FIXTURE_PATH).href);
  await page.locator('.slide.active').first().waitFor({ state: 'attached', timeout: 10_000 });
  await page.addScriptTag({ path: EDITOR_PATH });
  await page.waitForFunction(() => window.__wfpEditorReady === true, null, { timeout: 10_000 });
  await page.keyboard.press('e');
  await expect(page.locator('#wfp-editor-root .wfpe-toolbar')).toHaveAttribute('data-mode', 'on');
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

function simulateAgentImplementation(html, fromTitle, toTitle) {
  return html
    .replace(fromTitle, toTitle)
    .replace(/<!--[^<]*WFP Editor handoff[\s\S]*?-->/, '')
    .replace(/<script type="application\/json" data-wfp-agent-annotations[\s\S]*?<\/script>/, '')
    .replace(/\sdata-wfp-agent-annotation-id="[^"]*"/g, '');
}

async function agentRewritesFile(page, newHtml) {
  await page.evaluate((content) => {
    window.__fsa.file.content = content;
    window.__fsa.file.lastModified += 1000;
  }, newHtml);
}

function editorGeneration(page) {
  return page.evaluate(() => window.__wfpEditorGeneration).catch(() => null);
}

async function waitForGeneration(page, n) {
  await expect.poll(() => editorGeneration(page), { timeout: 20_000 }).toBe(n);
}

// ---------------------------------------------------------------------------
// Results reconciliation (strict TDD)
// ---------------------------------------------------------------------------

test.describe('v2.13 — agent results reconciliation', () => {
  test('done results resolve their annotations even when the agent left the metadata in place', async ({ page }) => {
    await installFsaFileStub(page);
    await loadAgentProcessedFixture(page, 'reconcile-done.html');

    // ann-1 was marked done: not re-imported, despite surviving metadata.
    const h1 = page.locator('#foreign-slide-1 h1');
    await expect(h1).not.toHaveAttribute('data-wfp-edit-annotation-id');
    await expect(h1).not.toHaveAttribute('data-wfp-edit-annotation-text');

    // ann-3 had no result entry: re-imported unchanged (backward compatible).
    const card = page.locator('#foreign-slide-1 .resize-target');
    await expect(card).toHaveAttribute('data-wfp-edit-annotation-id', 'ann-3');
    await expect(card).toHaveAttribute('data-wfp-edit-annotation-text', 'Make this card wider');
    await expect(card).not.toHaveAttribute('data-wfp-edit-annotation-status');

    // Open-note count reflects reconciliation: ann-2 + ann-3 only.
    await expect(page.locator('#wfp-editor-root .wfpe-export-badge')).toHaveAttribute('data-count', '2');

    // All handoff artifacts are gone from the live DOM, results block included.
    const residue = await page.evaluate(() => ({
      annotationsScript: document.querySelectorAll('script[data-wfp-agent-annotations]').length,
      resultsScript: document.querySelectorAll('script[data-wfp-agent-results]').length,
      targetAttrs: document.querySelectorAll('[data-wfp-agent-annotation-id]').length,
    }));
    expect(residue).toEqual({ annotationsScript: 0, resultsScript: 0, targetAttrs: 0 });
  });

  test('skipped/needs-input results re-import as open notes carrying the agent reply, and the summary is toasted', async ({ page }) => {
    await installFsaFileStub(page);
    await loadAgentProcessedFixture(page, 'reconcile-needs-input.html');

    const note = page.locator('#foreign-slide-1 .foreign-note');
    await expect(note).toHaveAttribute('data-wfp-edit-annotation-id', 'ann-2');
    await expect(note).toHaveAttribute('data-wfp-edit-annotation-text', 'Recolour the intro note');
    await expect(note).toHaveAttribute('data-wfp-edit-annotation-status', 'needs-input');
    await expect(note).toHaveAttribute('data-wfp-edit-annotation-reply', 'Which colour should the note use?');

    await expect(page.locator('#wfp-editor-root .wfpe-toast').last()).toHaveText('Agent update: 1 done, 1 needs input.');
  });

  test('exports strip the results block and reply attrs while the guidance documents the contract', async ({ page }) => {
    await installFsaFileStub(page);
    await loadAgentProcessedFixture(page, 'reconcile-export.html');

    await page.keyboard.press('e');
    await expect(page.locator('#wfp-editor-root .wfpe-toolbar')).toHaveAttribute('data-mode', 'on');
    await page.keyboard.press('Meta+s');
    await page.waitForFunction(() => window.__fsa.written.length === 1);
    const written = await page.evaluate(() => window.__fsa.written[0]);

    // Still-open notes travel; the resolved one does not.
    expect(written).toContain('"ann-2"');
    expect(written).toContain('"ann-3"');
    expect(written).not.toContain('"ann-1"');

    // No results script, no editor status/reply attrs in the exported file.
    expect(/<script[^>]+data-wfp-agent-results/.test(written)).toBe(false);
    expect(written).not.toContain('data-wfp-edit-annotation-status');
    expect(written).not.toContain('data-wfp-edit-annotation-reply');

    // The embedded guidance documents the results contract for the agent.
    expect(written).toContain('data-wfp-agent-results');
    expect(written).toContain('needs-input');
  });
});

// ---------------------------------------------------------------------------
// Status/reply behaviour
// ---------------------------------------------------------------------------

test.describe('v2.13 — status/reply on annotations', () => {
  test('saving a new instruction clears the agent status and reply, undoably', async ({ page }) => {
    await installFsaFileStub(page);
    await loadAgentProcessedFixture(page, 'reply-clear.html');
    await page.keyboard.press('e');
    await expect(page.locator('#wfp-editor-root .wfpe-toolbar')).toHaveAttribute('data-mode', 'on');

    await page.evaluate(() => {
      const el = document.querySelector('#foreign-slide-1 .foreign-note');
      const r = el.getBoundingClientRect();
      el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 }));
    });
    await expect(page.locator('#wfp-editor-root .wfpe-annotation-input')).toHaveValue('Recolour the intro note');

    // A new instruction supersedes the agent's reply to the old one.
    await page.locator('#wfp-editor-root .wfpe-annotation-input').fill('Use coral instead');
    await page.locator('#wfp-editor-root .wfpe-annotation-save-btn').click();
    const note = page.locator('#foreign-slide-1 .foreign-note');
    await expect(note).toHaveAttribute('data-wfp-edit-annotation-id', 'ann-2');
    await expect(note).toHaveAttribute('data-wfp-edit-annotation-text', 'Use coral instead');
    await expect(note).not.toHaveAttribute('data-wfp-edit-annotation-status');
    await expect(note).not.toHaveAttribute('data-wfp-edit-annotation-reply');

    // Undo restores the old instruction together with the agent's reply.
    await page.keyboard.press('Meta+z');
    await expect(note).toHaveAttribute('data-wfp-edit-annotation-text', 'Recolour the intro note');
    await expect(note).toHaveAttribute('data-wfp-edit-annotation-status', 'needs-input');
    await expect(note).toHaveAttribute('data-wfp-edit-annotation-reply', 'Which colour should the note use?');
  });

  test('needs-input badges carry the status and the inspector shows the agent reply', async ({ page }) => {
    await installFsaFileStub(page);
    await loadAgentProcessedFixture(page, 'reply-ui.html');
    await page.keyboard.press('e');
    await expect(page.locator('#wfp-editor-root .wfpe-toolbar')).toHaveAttribute('data-mode', 'on');

    // Marker variants: the replied note is status-tinted, the untouched one is not.
    const repliedBadge = page.locator('#wfp-editor-root .wfpe-annotation-badge[data-annotation-id="ann-2"]');
    await expect(repliedBadge).toHaveAttribute('data-status', 'needs-input');
    await expect(repliedBadge).toHaveAttribute('title', 'Recolour the intro note — Agent: Which colour should the note use?');
    await expect(page.locator('#wfp-editor-root .wfpe-annotation-badge[data-annotation-id="ann-3"]')).not.toHaveAttribute('data-status');

    // Inspector reply line for the selected replied note.
    await page.evaluate(() => {
      const el = document.querySelector('#foreign-slide-1 .foreign-note');
      const r = el.getBoundingClientRect();
      el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 }));
    });
    const reply = page.locator('#wfp-editor-root .wfpe-annotation-reply');
    await expect(reply).toBeVisible();
    await expect(reply).toHaveText('Agent needs input: Which colour should the note use?');
    await expect(reply).toHaveAttribute('data-status', 'needs-input');
  });
});

// ---------------------------------------------------------------------------
// Watch hardening (strict TDD)
// ---------------------------------------------------------------------------

test.describe('v2.13 — watch hardening', () => {
  test('refresh is deferred while a text edit is open and applies after commit', async ({ page }) => {
    await installFsaFileStub(page);
    await loadReady(page);
    await addNote(page, 'DEFER NOTE');
    await page.keyboard.press('Meta+s');
    await page.waitForFunction(() => window.__fsa.written.length === 1);
    const handoff = await page.evaluate(() => window.__fsa.written[0]);

    // Open a text edit on the annotated headline, then let the agent write.
    await page.locator('.slide.active h1').dblclick();
    expect(await page.evaluate(() => document.querySelector('.slide.active h1').hasAttribute('contenteditable'))).toBe(true);
    await agentRewritesFile(page, simulateAgentImplementation(handoff, 'Market day agenda', 'Deferred agenda'));

    // Two-plus watcher ticks pass without a swap while the edit is open.
    await page.waitForTimeout(3200);
    expect(await editorGeneration(page)).toBe(1);
    await expect(page.locator('#foreign-slide-1 h1')).toHaveText('Market day agenda');

    // Committing the edit releases the deferred refresh.
    await page.keyboard.press('Escape');
    await waitForGeneration(page, 2);
    await expect(page.locator('#foreign-slide-1 h1')).toHaveText('Deferred agenda');
    await expect(page.locator('#wfp-editor-root .wfpe-toolbar')).toHaveAttribute('data-mode', 'on');
  });

  test('watch goes dormant once on permission loss and re-links on the next save', async ({ page }) => {
    await installFsaFileStub(page);
    await loadReady(page);
    await addNote(page, 'DORMANT NOTE');
    await page.keyboard.press('Meta+s');
    await page.waitForFunction(() => window.__fsa.written.length === 1);

    await page.evaluate(() => { window.__fsa.readError = 'NotAllowedError'; });
    const pausedToast = page.locator('#wfp-editor-root .wfpe-toast', { hasText: 'Live updates paused — file access needed. Save to re-link.' });
    await pausedToast.first().waitFor({ state: 'visible', timeout: 5_000 });

    // The paused toast fires once, not on every failing tick.
    await page.waitForTimeout(2600);
    await expect(pausedToast).toHaveCount(0);

    // A successful save re-links the watch and says so.
    await page.evaluate(() => { window.__fsa.readError = null; });
    await page.keyboard.press('Meta+s');
    await page.waitForFunction(() => window.__fsa.written.length === 2);
    await expect(page.locator('#wfp-editor-root .wfpe-toast', { hasText: 'Live updates resumed.' }).first()).toBeVisible();

    // And the loop works again end to end.
    const second = await page.evaluate(() => window.__fsa.written[1]);
    await agentRewritesFile(page, simulateAgentImplementation(second, 'Market day agenda', 'Relinked agenda'));
    await waitForGeneration(page, 2);
    await expect(page.locator('#foreign-slide-1 h1')).toHaveText('Relinked agenda');
  });

  test('flat documents refresh without gaining an active class on the flat root', async ({ page }) => {
    const FLAT_PATH = path.join(PROJECT_ROOT, 'fixtures', 'flat-document.html');
    await installFsaFileStub(page);
    await page.goto(pathToFileURL(FLAT_PATH).href);
    await page.locator('#flat-article').waitFor({ state: 'attached', timeout: 10_000 });
    await page.addScriptTag({ path: EDITOR_PATH });
    await page.waitForFunction(() => window.__wfpEditorReady === true, null, { timeout: 10_000 });
    await page.keyboard.press('e');
    await expect(page.locator('#wfp-editor-root .wfpe-toolbar')).toHaveAttribute('data-mode', 'on');

    await page.keyboard.press('Meta+s');
    await page.waitForFunction(() => window.__fsa.written.length === 1);
    const written = await page.evaluate(() => window.__fsa.written[0]);
    await agentRewritesFile(page, written.replace('A practical guide to planning', 'An agent-refreshed guide to planning'));
    await waitForGeneration(page, 2);

    await expect(page.locator('#flat-article h1')).toHaveText('An agent-refreshed guide to planning a community archive');
    await expect(page.locator('#wfp-editor-root .wfpe-toolbar')).toHaveAttribute('data-mode', 'on');
    // The fixture has no `active` class anywhere; the slide-restore step
    // must not invent one on the flat root (it would leak into exports).
    expect(await page.evaluate(() => document.querySelectorAll('.active').length)).toBe(0);
  });

  test('inspector minimised and toolbar collapsed survive the refresh', async ({ page }) => {
    await installFsaFileStub(page);
    await loadReady(page);
    await addNote(page, 'STATE NOTE');

    await page.locator('#wfp-editor-root .wfpe-inspector-minimise').click();
    await expect(page.locator('#wfp-editor-root .wfpe-inspector')).toHaveAttribute('data-state', 'minimised');
    await page.locator('#wfp-editor-root .wfpe-toolbar-collapse').click();
    await expect(page.locator('#wfp-editor-root .wfpe-toolbar')).toHaveAttribute('data-collapsed', 'true');

    await page.keyboard.press('Meta+s');
    await page.waitForFunction(() => window.__fsa.written.length === 1);
    const handoff = await page.evaluate(() => window.__fsa.written[0]);
    await agentRewritesFile(page, simulateAgentImplementation(handoff, 'Market day agenda', 'State agenda'));
    await waitForGeneration(page, 2);

    await expect(page.locator('#wfp-editor-root .wfpe-toolbar')).toHaveAttribute('data-collapsed', 'true');
    await page.evaluate(() => {
      const el = document.querySelector('.slide.active h1');
      const r = el.getBoundingClientRect();
      el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 }));
    });
    await expect(page.locator('#wfp-editor-root .wfpe-inspector')).toHaveAttribute('data-state', 'minimised');
  });
});
