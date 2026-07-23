import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { EDITOR_PATH, loadFixtureWithEditor, disableFsa } from './_helpers.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = path.join(__dirname, 'output');

test.use({ viewport: { width: 2000, height: 1200 } });

// v2.11 — Cmd+S now prefers the save-in-place engine when the File System
// Access API is present (real headless Chromium has it on file:// and
// http://localhost origins). Every test in this file asserts on the legacy
// download the editor used to always produce, so force that fallback path
// explicitly, before each test's own navigation.
test.beforeEach(async ({ page }) => {
  await disableFsa(page);
});

async function setDeckScale(page, scale) {
  await page.evaluate((s) => {
    document.querySelector('.deck').style.transform = `scale(${s})`;
  }, scale);
}

async function clickToSelect(page, selector) {
  return page.evaluate((sel) => {
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

async function dblclickElement(page, selector) {
  await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    const r = el.getBoundingClientRect();
    el.dispatchEvent(
      new MouseEvent('dblclick', {
        bubbles: true,
        cancelable: true,
        view: window,
        clientX: r.left + r.width / 2,
        clientY: r.top + r.height / 2,
        detail: 2,
      }),
    );
  }, selector);
}

async function selectTextRange(page, selector, text) {
  await page.evaluate(({ selector: sel, text: needle }) => {
    const el = document.querySelector(sel);
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node && !node.textContent.includes(needle)) node = walker.nextNode();
    if (!node) throw new Error(`Text not found: ${needle}`);
    const start = node.textContent.indexOf(needle);
    const range = document.createRange();
    range.setStart(node, start);
    range.setEnd(node, start + needle.length);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
  }, { selector, text });
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

function extractActiveSlideIdsFromHtml(html) {
  const ids = [];
  const re = /<div\s+class="([^"]*\bslide\b[^"]*)"[^>]*id="([^"]+)"/g;
  let match;
  while ((match = re.exec(html)) !== null) {
    const classes = match[1].split(/\s+/);
    if (classes.includes('active')) ids.push(match[2]);
  }
  return ids;
}

function extractActiveProgressIndicesFromHtml(html) {
  const indices = [];
  const re = /<div\s+class="([^"]*\bprogress-dot\b[^"]*)"[^>]*onclick="goTo\((\d+)\)"/g;
  let match;
  while ((match = re.exec(html)) !== null) {
    const classes = match[1].split(/\s+/);
    if (classes.includes('active')) indices.push(Number(match[2]));
  }
  return indices;
}

function extractProgressDotCountFromHtml(html) {
  return (html.match(/class="[^"]*\bprogress-dot\b/g) || []).length;
}

test.describe('Phase 8 — Export', () => {
  test('Cmd+S downloads a file with the original basename + -edited.html', async ({
    page,
  }) => {
    await loadFixtureWithEditor(page, 'Townhall-1.html');
    await setDeckScale(page, 1);
    await page.keyboard.press('e');

    const download = await triggerExport(page);
    expect(download.suggestedFilename()).toBe('Townhall-1-edited.html');
  });

  test('exported HTML starts with <!DOCTYPE html>', async ({ page }) => {
    await loadFixtureWithEditor(page, 'Townhall-1.html');
    await setDeckScale(page, 1);
    await page.keyboard.press('e');

    const download = await triggerExport(page);
    const { content } = await readDownloadAsString(download);
    expect(content.startsWith('<!DOCTYPE html>')).toBe(true);
  });

  test('exported HTML contains no editor DOM, script, or markers', async ({ page }) => {
    await loadFixtureWithEditor(page, 'Townhall-1.html');
    await setDeckScale(page, 1);
    await page.keyboard.press('e');

    // Make a few edits that will leave the data-wfp-edit-* markers.
    await clickToSelect(page, '.slide.active h1');
    await page.keyboard.press('ArrowUp');

    const download = await triggerExport(page);
    const { content } = await readDownloadAsString(download);

    expect(content).not.toContain('id="wfp-editor-root"');
    expect(content).not.toContain('editor.js');
    expect(content).not.toMatch(/data-wfp-edit[-a-zA-Z]*\s*=/);
    expect(content).not.toContain('contenteditable=');
  });

  test('exported HTML preserves the font-size change made via the editor', async ({
    page,
  }) => {
    await loadFixtureWithEditor(page, 'Townhall-1.html');
    await setDeckScale(page, 1);
    await page.keyboard.press('e');

    await clickToSelect(page, '.slide.active h1');
    const before = await page.evaluate(
      () => parseFloat(getComputedStyle(document.querySelector('.slide.active h1')).fontSize),
    );
    for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowUp');
    const after = await page.evaluate(
      () => parseFloat(getComputedStyle(document.querySelector('.slide.active h1')).fontSize),
    );
    expect(after).toBeCloseTo(before + 5, 1);

    const download = await triggerExport(page);
    const { content } = await readDownloadAsString(download);

    // The exact font-size value should appear in an inline style somewhere.
    const expectedPx = `${after}px`;
    expect(content).toContain(`font-size: ${expectedPx}`);
  });

  test('exported HTML preserves a drag position change', async ({ page }) => {
    await loadFixtureWithEditor(page, 'Townhall-1.html');
    await setDeckScale(page, 1);
    await page.keyboard.press('e');

    // Drag the WFP badge 60px right.
    const center = await page.evaluate(() => {
      const el = document.querySelector('.slide.active .wfp-badge');
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });
    await page.mouse.move(center.x, center.y);
    await page.mouse.down();
    await page.mouse.move(center.x + 30, center.y, { steps: 4 });
    await page.mouse.move(center.x + 60, center.y, { steps: 4 });
    await page.mouse.up();

    const newLeft = await page.evaluate(
      () => document.querySelector('.slide.active .wfp-badge').style.left,
    );
    expect(newLeft).not.toBe('');

    const download = await triggerExport(page);
    const { content } = await readDownloadAsString(download);

    // The new inline left value should be present in the exported HTML.
    expect(content).toContain(`left: ${newLeft}`);
  });

  test('exported HTML preserves an inline text edit', async ({ page }) => {
    await loadFixtureWithEditor(page, 'Townhall-1.html');
    await setDeckScale(page, 1);
    await page.keyboard.press('e');

    await page.evaluate(() => {
      const h1 = document.querySelector('.slide.active h1');
      const r = h1.getBoundingClientRect();
      h1.dispatchEvent(
        new MouseEvent('dblclick', {
          bubbles: true,
          cancelable: true,
          view: window,
          clientX: r.left + 10,
          clientY: r.top + 10,
          detail: 2,
        }),
      );
      h1.innerHTML = 'EXPORTED HEADLINE TEXT';
    });
    await page.keyboard.press('Escape');

    const download = await triggerExport(page);
    const { content } = await readDownloadAsString(download);

    expect(content).toContain('EXPORTED HEADLINE TEXT');
  });

  test('exported HTML preserves inline text range colour', async ({ page }) => {
    await loadFixtureWithEditor(page, 'Townhall-1.html');
    await setDeckScale(page, 1);
    await page.keyboard.press('e');

    await clickToSelect(page, '.slide.active h1');
    await page.evaluate(() => {
      document.querySelector('.slide.active h1').innerHTML = 'Alpha Beta Gamma';
    });
    await dblclickElement(page, '.slide.active h1');
    await selectTextRange(page, '.slide.active h1', 'Beta');

    const hex = page.locator('#wfp-editor-root input[data-wfpe-prop="textColorHex"]');
    await hex.click({ clickCount: 3 });
    await hex.fill('#225588');
    await hex.press('Enter');
    await page.keyboard.press('Escape');

    const download = await triggerExport(page);
    const { content } = await readDownloadAsString(download);

    expect(content).toContain('<span style="color: rgb(34, 85, 136);">Beta</span>');
    expect(content).not.toContain('contenteditable=');
    expect(content).not.toMatch(/data-wfp-edit[-a-zA-Z]*\s*=/);
  });

  test('shows a "Exported to ..." toast after a successful export', async ({ page }) => {
    await loadFixtureWithEditor(page, 'Townhall-1.html');
    await setDeckScale(page, 1);
    await page.keyboard.press('e');

    const downloadPromise = page.waitForEvent('download', { timeout: 5_000 });
    await page.keyboard.press('ControlOrMeta+s');
    await downloadPromise;

    // The toast is added to #wfp-editor-root with text "Exported to <name>".
    const toastText = await page.locator('#wfp-editor-root .wfpe-toast').textContent();
    expect(toastText).toMatch(/^Exported to .+\.html$/);
  });

  test('exported file can be reloaded in a fresh browser without editor JS', async ({
    page,
    context,
  }) => {
    await loadFixtureWithEditor(page, 'Townhall-1.html');
    await setDeckScale(page, 1);
    await page.keyboard.press('e');

    await clickToSelect(page, '.slide.active h1');
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('ArrowUp');

    const download = await triggerExport(page);
    const { path: outPath } = await readDownloadAsString(download);

    const fresh = await context.newPage();
    await fresh.goto(`file://${outPath}`);

    // Slide deck should render and the active slide visible.
    await fresh.locator('.deck').waitFor({ state: 'attached', timeout: 5_000 });
    const activeSlideId = await fresh.evaluate(() => {
      const s = document.querySelector('.slide.active');
      return s ? s.id : null;
    });
    expect(activeSlideId).toBeTruthy();

    // Editor UI must be absent.
    const hasRoot = await fresh.evaluate(
      () => !!document.getElementById('wfp-editor-root'),
    );
    expect(hasRoot).toBe(false);

    await fresh.close();
  });

  test('exported HTML starts from the first slide even when exported from a later slide', async ({
    page,
    context,
  }) => {
    await loadFixtureWithEditor(page, 'Townhall-1.html');
    await setDeckScale(page, 1);

    for (let i = 0; i < 8; i++) await page.keyboard.press('ArrowRight');
    await expect
      .poll(() => page.evaluate(() => document.querySelector('.slide.active')?.id))
      .toBe('s8');

    await page.keyboard.press('e');
    const download = await triggerExport(page);
    const { path: outPath, content } = await readDownloadAsString(download);

    expect(extractActiveSlideIdsFromHtml(content)).toEqual(['s0']);
    expect(extractActiveProgressIndicesFromHtml(content)).toEqual([0]);

    const liveState = await page.evaluate(() => ({
      activeSlideIds: [...document.querySelectorAll('.slide.active')].map((s) => s.id),
      activeDotIndices: [...document.querySelectorAll('.progress-dot')]
        .map((dot, index) => (dot.classList.contains('active') ? index : null))
        .filter((index) => index !== null),
    }));
    expect(liveState).toEqual({
      activeSlideIds: ['s8'],
      activeDotIndices: [8],
    });

    const fresh = await context.newPage();
    await fresh.goto(`file://${outPath}`);
    await fresh.locator('.deck').waitFor({ state: 'attached', timeout: 5_000 });
    await fresh.keyboard.press('ArrowRight');

    const activeSlideIds = await fresh.evaluate(() =>
      [...document.querySelectorAll('.slide.active')].map((s) => s.id),
    );
    expect(activeSlideIds).toEqual(['s1']);

    await fresh.close();
  });

  test('export does not serialize runtime-generated progress dots', async ({
    page,
    context,
  }) => {
    await page.setContent(`<!DOCTYPE html>
      <html>
      <head>
        <style>
          .slide { display: none; }
          .slide.active { display: block; }
          .progress { position: fixed; bottom: 16px; }
          .progress-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; }
          .progress-dot.active { transform: scale(1.3); }
        </style>
      </head>
      <body>
        <div class="deck">
          <div class="slide active" id="s0">Slide 1</div>
          <div class="slide" id="s1">Slide 2</div>
          <div class="slide" id="s2">Slide 3</div>
        </div>
        <div class="progress" id="progress">
          <div class="progress-dot active"></div>
          <div class="progress-dot"></div>
          <div class="progress-dot"></div>
        </div>
        <script>
          const slides = document.querySelectorAll('.slide');
          const dots = document.getElementById('progress');
          let current = 0;
          slides.forEach((_, i) => {
            const dot = document.createElement('div');
            dot.className = 'progress-dot' + (i === 0 ? ' active' : '');
            dot.addEventListener('click', () => show(i));
            dots.appendChild(dot);
          });
          function show(i) {
            if (i < 0 || i >= slides.length) return;
            slides[current].classList.remove('active');
            dots.children[current].classList.remove('active');
            current = i;
            slides[current].classList.add('active');
            dots.children[current].classList.add('active');
          }
        </script>
      </body>
      </html>`);
    await page.locator('.deck').waitFor({ state: 'attached' });
    await expect
      .poll(() => page.locator('.progress-dot').count())
      .toBe(6);
    await page.addScriptTag({ path: EDITOR_PATH });
    await page.waitForFunction(() => window.__wfpEditorReady === true);

    await page.keyboard.press('e');
    const download = await triggerExport(page);
    const { path: outPath, content } = await readDownloadAsString(download);

    expect(extractProgressDotCountFromHtml(content)).toBe(0);

    const fresh = await context.newPage();
    await fresh.goto(`file://${outPath}`);
    await fresh.locator('.deck').waitFor({ state: 'attached', timeout: 5_000 });
    await expect
      .poll(() => fresh.locator('.progress-dot').count())
      .toBe(3);
    await fresh.close();
  });

  test('export resolves local relative image assets before download', async ({
    page,
    context,
  }) => {
    const assetDir = path.join(OUTPUT_DIR, 'relative-asset-fixture');
    fs.mkdirSync(assetDir, { recursive: true });

    const assetPath = path.join(assetDir, 'hero.svg');
    fs.writeFileSync(
      assetPath,
      '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><rect width="24" height="24" fill="#f4847b"/></svg>',
    );

    const pagePath = path.join(assetDir, 'asset-page.html');
    fs.writeFileSync(
      pagePath,
      `<!DOCTYPE html>
      <html>
      <head>
        <style>
          .deck { width: 320px; height: 180px; }
          .slide { display: none; }
          .slide.active { display: block; }
          .hero { width: 24px; height: 24px; background-image: url("hero.svg"); }
        </style>
      </head>
      <body>
        <div class="deck">
          <div class="slide active" id="s0">
            <img class="inline-asset" src="hero.svg" alt="asset">
            <div class="hero"></div>
          </div>
        </div>
      </body>
      </html>`,
    );

    await page.goto(pathToFileURL(pagePath).href);
    await page.locator('.deck').waitFor({ state: 'attached' });
    await page.addScriptTag({ path: EDITOR_PATH });
    await page.waitForFunction(() => window.__wfpEditorReady === true);

    await page.keyboard.press('e');
    const download = await triggerExport(page);
    const { path: outPath, content } = await readDownloadAsString(download);

    const assetUrl = pathToFileURL(assetPath).href;
    expect(content).toContain(`src="${assetUrl}"`);
    expect(content).toContain(`background-image: url("${assetUrl}")`);

    const fresh = await context.newPage();
    await fresh.goto(pathToFileURL(outPath).href);
    await fresh.locator('.deck').waitFor({ state: 'attached', timeout: 5_000 });
    await fresh.waitForFunction(() => document.querySelector('.inline-asset')?.complete);

    const loaded = await fresh.evaluate(() => ({
      width: document.querySelector('.inline-asset').naturalWidth,
      backgroundImage: getComputedStyle(document.querySelector('.hero')).backgroundImage,
    }));
    expect(loaded.width).toBe(24);
    expect(loaded.backgroundImage).toContain(assetUrl);

    await fresh.close();
  });

  test('export does not mutate the live DOM (editor still runs after export)', async ({
    page,
  }) => {
    await loadFixtureWithEditor(page, 'Townhall-1.html');
    await setDeckScale(page, 1);
    await page.keyboard.press('e');

    const download = await triggerExport(page);
    await readDownloadAsString(download);

    // After export, the editor root and badge must still be in the live DOM.
    const stillThere = await page.evaluate(() => ({
      root: !!document.getElementById('wfp-editor-root'),
      badge: !!document.querySelector('#wfp-editor-root .wfpe-mode-badge'),
      editMode: !!document.querySelector('.wfpe-mode-badge[data-mode="on"]'),
    }));
    expect(stillThere.root).toBe(true);
    expect(stillThere.badge).toBe(true);
    expect(stillThere.editMode).toBe(true);
  });
});
