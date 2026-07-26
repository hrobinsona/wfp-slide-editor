import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { EDITOR_PATH, disableFsa } from './_helpers.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = path.join(__dirname, 'output');

test.use({ viewport: { width: 2000, height: 1200 } });

// v2.20 — blob-backed assets in exports.
//
// Self-extracting bundled decks mint session-scoped blob: URLs at load time
// for their packed assets (Chart.js, custom-element components, images) and
// wire them into the live DOM as <script src="blob:..."> / <img src="blob:...">.
// Serializing those references verbatim produces a download that reopens
// broken: blob URLs die with the minting document, so the scripts never run
// and the images never load. The export must instead capture each blob's
// payload while the session (and therefore the URL) is still alive — scripts
// become inline <script> text, other assets become data: URIs.
//
// The fixture below mimics the bundle loader: it mints the blob URLs, wires
// them up, then removes its own boot script — exactly like the real loader,
// whose packed payload is replaced by the expanded document and therefore
// cannot re-mint anything when the export is reopened.

// 1x1 transparent PNG.
const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

function writeBlobFixture() {
  const dir = path.join(OUTPUT_DIR, 'blob-asset-fixture');
  fs.mkdirSync(dir, { recursive: true });
  const pagePath = path.join(dir, 'blob-page.html');
  fs.writeFileSync(
    pagePath,
    `<!DOCTYPE html>
    <html>
    <head>
      <style>
        .deck { width: 320px; height: 180px; }
        .slide { display: none; }
        .slide.active { display: block; }
      </style>
    </head>
    <body>
      <div class="deck">
        <div class="slide active" id="s0">
          <h1 id="title">Blob deck</h1>
          <img id="blob-img" alt="blob image">
          <img id="data-srcset-img" alt="data srcset"
            srcset="data:image/png;base64,${PNG_BASE64} 1x, missing.png 2x">
          <img id="blob-srcset-img" alt="blob srcset">
        </div>
      </div>
      <script>
        (function () {
          // The lib source deliberately contains the HTML sequences that can
          // break an inlined script at parse time (each assembled by
          // concatenation so it terminates neither THIS script nor the
          // fixture markup): a literal script-close tag, and a comment-open
          // followed by a script-open — the pair that flips the HTML
          // tokenizer into script-data-double-escaped state, where an
          // unescaped close tag no longer terminates the element.
          const libSource =
            'window.__blobLib = { marker: "</scr' + 'ipt>",' +
            ' esc: "<!' + '--", open: "<scr' + 'ipt>" };\\n' +
            'window.__blobLibReady = true;';
          const libUrl = URL.createObjectURL(
            new Blob([libSource], { type: 'text/javascript' }),
          );
          const s = document.createElement('script');
          s.src = libUrl;
          document.head.appendChild(s);

          const bytes = Uint8Array.from(atob('${PNG_BASE64}'), (c) => c.charCodeAt(0));
          const imgUrl = URL.createObjectURL(new Blob([bytes], { type: 'image/png' }));
          document.getElementById('blob-img').src = imgUrl;
          document.getElementById('blob-srcset-img').srcset = imgUrl + ' 1x';

          document.currentScript.remove();
        })();
      </script>
    </body>
    </html>`,
  );
  return pagePath;
}

async function loadBlobFixtureWithEditor(page) {
  const pagePath = writeBlobFixture();
  await page.goto(pathToFileURL(pagePath).href);
  await page.waitForFunction(() => window.__blobLibReady === true);
  await page.waitForFunction(
    () => document.getElementById('blob-img').complete &&
      document.getElementById('blob-img').naturalWidth > 0,
  );
  await page.addScriptTag({ path: EDITOR_PATH });
  await page.waitForFunction(() => window.__wfpEditorReady === true);
}

async function triggerExport(page) {
  const downloadPromise = page.waitForEvent('download', { timeout: 5_000 });
  await page.keyboard.press('ControlOrMeta+s');
  return downloadPromise;
}

async function readDownloadAsString(download) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const out = path.join(OUTPUT_DIR, download.suggestedFilename());
  await download.saveAs(out);
  return { path: out, content: fs.readFileSync(out, 'utf-8') };
}

test.describe('v2.20 — blob-backed assets survive export', () => {
  test.beforeEach(async ({ page }) => {
    await disableFsa(page);
  });

  test('exported HTML contains no blob: URLs', async ({ page }) => {
    await loadBlobFixtureWithEditor(page);
    await page.keyboard.press('e');

    const download = await triggerExport(page);
    const { content } = await readDownloadAsString(download);

    expect(content).not.toContain('blob:');
  });

  test('reopened export re-runs the blob-loaded script and renders the blob image', async ({
    page,
    context,
  }) => {
    await loadBlobFixtureWithEditor(page);
    await page.keyboard.press('e');

    const download = await triggerExport(page);
    const { path: outPath } = await readDownloadAsString(download);

    const fresh = await context.newPage();
    await fresh.goto(pathToFileURL(outPath).href);
    await fresh.locator('.deck').waitFor({ state: 'attached', timeout: 5_000 });

    // The lib must have executed from inline text — including its literal
    // script-close tag and the comment-open + script-open pair, which proves
    // the inlining escaped every parse-breaking sequence correctly.
    await fresh.waitForFunction(() => window.__blobLibReady === true, null, {
      timeout: 5_000,
    });
    const lib = await fresh.evaluate(() => window.__blobLib);
    expect(lib.marker).toBe('</script>');
    expect(lib.esc).toBe('<!--');
    expect(lib.open).toBe('<script>');

    // The image must load from a self-contained data: URI.
    await fresh.waitForFunction(
      () => document.getElementById('blob-img').complete,
      null,
      { timeout: 5_000 },
    );
    const img = await fresh.evaluate(() => ({
      naturalWidth: document.getElementById('blob-img').naturalWidth,
      srcScheme: document.getElementById('blob-img').src.split(':')[0],
    }));
    expect(img.naturalWidth).toBe(1);
    expect(img.srcScheme).toBe('data');

    await fresh.close();
  });

  test('srcset rewrites are surgical — blob candidates become data: URIs, existing data: URIs survive intact', async ({
    page,
    context,
  }) => {
    await loadBlobFixtureWithEditor(page);
    await page.keyboard.press('e');

    const download = await triggerExport(page);
    const { path: outPath, content } = await readDownloadAsString(download);
    expect(content).not.toContain('blob:');

    const fresh = await context.newPage();
    await fresh.goto(pathToFileURL(outPath).href);
    await fresh.locator('.deck').waitFor({ state: 'attached', timeout: 5_000 });

    const srcsets = await fresh.evaluate((png) => ({
      // A pre-existing data: URI srcset must come through byte-identical —
      // in particular with no space injected after the base64 comma.
      dataIntact:
        document.getElementById('data-srcset-img').getAttribute('srcset') ===
        `data:image/png;base64,${png} 1x, missing.png 2x`,
      blobSrcset: document.getElementById('blob-srcset-img').getAttribute('srcset'),
    }), PNG_BASE64);
    expect(srcsets.dataIntact).toBe(true);
    expect(srcsets.blobSrcset).toMatch(/^data:image\/png;base64,/);
    expect(srcsets.blobSrcset).toMatch(/ 1x$/);

    // Both srcset images must actually resolve and render.
    await fresh.waitForFunction(
      () =>
        document.getElementById('data-srcset-img').naturalWidth === 1 &&
        document.getElementById('blob-srcset-img').naturalWidth === 1,
      null,
      { timeout: 5_000 },
    );
    await fresh.close();
  });

  test('handoff export inlines blob assets too', async ({ page }) => {
    await loadBlobFixtureWithEditor(page);
    await page.keyboard.press('e');

    // Annotate the title so Cmd+S (FSA disabled → download fallback) takes
    // the handoff export path instead of the clean one.
    await page.evaluate(() => {
      const el = document.getElementById('title');
      el.setAttribute('data-wfp-edit-annotation-id', 'note-1');
      el.setAttribute('data-wfp-edit-annotation-text', 'Make it bigger');
    });

    const download = await triggerExport(page);
    const { content } = await readDownloadAsString(download);

    expect(download.suggestedFilename()).toContain('-agent-handoff');
    expect(content).not.toContain('blob:');
    expect(content).toContain('data-wfp-agent-annotations');
  });

  test('export leaves the live document untouched — blob URLs stay live in the session', async ({
    page,
  }) => {
    await loadBlobFixtureWithEditor(page);
    await page.keyboard.press('e');

    const download = await triggerExport(page);
    await readDownloadAsString(download);

    const live = await page.evaluate(() => ({
      imgScheme: document.getElementById('blob-img').src.split(':')[0],
      libScriptCount: [...document.querySelectorAll('script')].filter((s) =>
        (s.src || '').startsWith('blob:'),
      ).length,
      libStillWorks: window.__blobLibReady === true,
    }));
    expect(live.imgScheme).toBe('blob');
    expect(live.libScriptCount).toBe(1);
    expect(live.libStillWorks).toBe(true);
  });
});
