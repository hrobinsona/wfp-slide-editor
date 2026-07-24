// SPIKE — live agent round-trip (see ROADMAP.md "Live Agent Round-trip").
//
// Validates the riskiest assumption behind the roadmap candidate before any
// full build: that the editor can detect an external (agent) write to the
// bound save-in-place file, swap the new document into the live page without
// a navigation, and re-boot itself with edit mode, active slide, and the
// file handle intact. Uses foreign-deck.html because its own <script>
// registers a document-level keydown nav handler with closures over the
// slide list — exactly the stale-listener hazard the swap must neutralise.
import { test, expect } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { EDITOR_PATH } from './_helpers.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = path.join(path.resolve(__dirname, '..'), 'fixtures', 'foreign-deck.html');

test.use({ viewport: { width: 2000, height: 1200 } });

// Fake File System Access handle whose backing "file" the test can rewrite,
// simulating an agent editing the saved document on disk. Same shape as the
// v2.11 stub, extended with getFile() so the live-refresh watcher can poll.
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
    window.showSaveFilePicker = async (opts) => {
      window.__fsa.pickerCalls.push((opts && opts.suggestedName) || null);
      return handle;
    };
  });
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

// What a well-behaved agent does to the handoff file: implement the
// instruction and strip the handoff metadata, per the embedded contract.
function simulateAgentImplementation(html, fromTitle, toTitle) {
  return html
    .replace(fromTitle, toTitle)
    .replace(/<!--[^<]*WFP Editor handoff[\s\S]*?-->/, '')
    .replace(/<script type="application\/json" data-wfp-agent-annotations[\s\S]*?<\/script>/, '')
    .replace(/\sdata-wfp-agent-annotation-id="[^"]*"/g, '');
}

async function saveAndCaptureHandoff(page, expectedWrites) {
  await page.keyboard.press('Meta+s');
  await page.waitForFunction((n) => window.__fsa.written.length === n, expectedWrites);
  return page.evaluate(() => window.__fsa.written[window.__fsa.written.length - 1]);
}

async function agentRewritesFile(page, newHtml) {
  await page.evaluate((content) => {
    window.__fsa.file.content = content;
    window.__fsa.file.lastModified += 1000;
  }, newHtml);
}

// Boot counter set by the 96-live-refresh fragment: initial load = 1, first
// in-place refresh = 2, second = 3. Evaluate defensively — the polling
// window can straddle the document.open() churn.
function editorGeneration(page) {
  return page.evaluate(() => window.__wfpEditorGeneration).catch(() => null);
}

async function waitForGeneration(page, n) {
  await expect.poll(() => editorGeneration(page), { timeout: 20_000 }).toBe(n);
}

test.describe('spike — live agent round-trip', () => {
  test('agent write triggers an in-place refresh: content, editor, edit mode, and slide restored', async ({ page }) => {
    await installFsaFileStub(page);
    await loadReady(page);

    // Stand-in for any listener bound to the pre-refresh document (like the
    // fixture's own nav handler): measures whether document.open() really
    // erases document-level listeners, and what happens to window-level ones.
    await page.evaluate(() => {
      window.__probe = { doc: 0, win: 0 };
      document.addEventListener('keydown', () => { window.__probe.doc += 1; });
      window.addEventListener('keydown', () => { window.__probe.win += 1; });
      window.__realmMarker = 'alive';
    });

    // Work on slide 3 of 4 so restore has something non-default to prove.
    await page.evaluate(() => window.foreignFixtureShow(2));
    await expect(page.locator('#foreign-slide-3')).toHaveClass(/active/);

    await addNote(page, 'Rename the production title');
    const handoff = await saveAndCaptureHandoff(page, 1);
    expect(handoff).toContain('data-wfp-agent-annotations');
    expect(handoff).toContain('Rename the production title');
    expect(await page.evaluate(() => window.__fsa.pickerCalls.length)).toBe(1);

    const probeBefore = await page.evaluate(() => ({ ...window.__probe }));

    const agentResult = simulateAgentImplementation(handoff, 'Production checkpoints', 'Checkpoints, renamed by agent');
    expect(agentResult).not.toContain('data-wfp-agent-annotations');
    await agentRewritesFile(page, agentResult);

    await waitForGeneration(page, 2);

    // Content refreshed, exactly one editor mounted, edit mode + slide restored.
    await expect(page.locator('#foreign-slide-3 h1')).toHaveText('Checkpoints, renamed by agent');
    expect(await page.evaluate(() => document.querySelectorAll('#wfp-editor-root').length)).toBe(1);
    await expect(page.locator('#wfp-editor-root .wfpe-toolbar')).toHaveAttribute('data-mode', 'on');
    await expect(page.locator('#foreign-slide-3')).toHaveClass(/active/);
    expect(await page.evaluate(() => document.querySelectorAll('.slide.active').length)).toBe(1);

    // The realm survived (window globals intact) — this is what lets the
    // file handle cross the refresh without a re-pick or re-grant.
    expect(await page.evaluate(() => window.__realmMarker)).toBe('alive');

    // Listener-erasure measurement: dispatch one key post-refresh, diff.
    await page.keyboard.press('x');
    const probeAfter = await page.evaluate(() => ({ ...window.__probe }));
    expect(probeAfter.doc - probeBefore.doc).toBe(0); // document-level listeners erased by document.open()
    console.log(`[spike finding] window-level keydown listener survived refresh: ${probeAfter.win - probeBefore.win > 0}`);
  });

  test('the refreshed instance keeps the file handle: new note and silent save without a re-pick', async ({ page }) => {
    await installFsaFileStub(page);
    await loadReady(page);

    await addNote(page, 'FIRST ROUND NOTE');
    const handoff = await saveAndCaptureHandoff(page, 1);
    await agentRewritesFile(page, simulateAgentImplementation(handoff, 'Market day agenda', 'Agenda v2'));
    await waitForGeneration(page, 2);
    await expect(page.locator('#foreign-slide-1 h1')).toHaveText('Agenda v2');

    // Post-refresh, the editor is fully interactive on the NEW DOM…
    await addNote(page, 'SECOND ROUND NOTE');
    const second = await saveAndCaptureHandoff(page, 2);
    expect(second).toContain('SECOND ROUND NOTE');
    // …and the save reused the adopted handle: still exactly one picker call.
    expect(await page.evaluate(() => window.__fsa.pickerCalls.length)).toBe(1);

    // The editor's own write must not self-trigger a refresh: sit through
    // two-plus watcher ticks and confirm the generation holds.
    await page.waitForTimeout(3000);
    expect(await editorGeneration(page)).toBe(2);

    // The loop repeats: a second agent write refreshes again.
    await agentRewritesFile(page, simulateAgentImplementation(second, 'Agenda v2', 'Agenda v3'));
    await waitForGeneration(page, 3);
    await expect(page.locator('#foreign-slide-1 h1')).toHaveText('Agenda v3');
    expect(await page.evaluate(() => document.querySelectorAll('#wfp-editor-root').length)).toBe(1);
  });

  test('post-refresh keyboard nav is editor-owned: exactly one slide advance per arrow key', async ({ page }) => {
    await installFsaFileStub(page);
    await loadReady(page);

    await page.evaluate(() => window.foreignFixtureShow(2));
    await addNote(page, 'NAV NOTE');
    const handoff = await saveAndCaptureHandoff(page, 1);
    await agentRewritesFile(page, simulateAgentImplementation(handoff, 'Launch readiness', 'Launch, agent-approved'));
    await waitForGeneration(page, 2);
    await expect(page.locator('#foreign-slide-3')).toHaveClass(/active/);

    // Leave edit mode; arrows must advance exactly one slide. The re-parsed
    // fixture script's closures reset to slide 0, so the editor's
    // deckMutated takeover (fresh DOM queries, capture phase) must own nav.
    await page.keyboard.press('e');
    await expect(page.locator('#wfp-editor-root .wfpe-toolbar')).toHaveAttribute('data-mode', 'off');

    await page.keyboard.press('ArrowRight');
    await expect(page.locator('#foreign-slide-4')).toHaveClass(/active/);
    expect(await page.evaluate(() => document.querySelectorAll('.slide.active').length)).toBe(1);

    await page.keyboard.press('ArrowLeft');
    await expect(page.locator('#foreign-slide-3')).toHaveClass(/active/);
    expect(await page.evaluate(() => document.querySelectorAll('.slide.active').length)).toBe(1);
  });
});
