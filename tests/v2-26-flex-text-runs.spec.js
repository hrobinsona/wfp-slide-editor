import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EDITOR_PATH, EDITOR_MARKER_ATTR_RE, disableFsa } from './_helpers.js';

const OUTPUT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'output');

test.use({ viewport: { width: 1600, height: 1000 } });

// v2.26 — formatting inside a flex/grid host must not split the text run.
//
// A deck bullet is commonly `li { display: flex }` with a `::before` dot.
// The item's text is one anonymous flex item. Cmd/Ctrl+B during an inline
// edit is the browser's native bold, which wraps the words in <b> — and in a
// flex container every element child is its own flex item, so the DOM
// becomes two items side by side: the bold word in one column and the rest
// of the sentence stacked beside it, wrapping under itself instead of under
// the bullet. In a block-flow paragraph the same <b> is inline and harmless.
//
// The editor now wraps each text run of a flex/grid host in a
// <span data-wfp-text-run> for the duration of the edit, so formatting
// lands inside a single item, and removes any wrapper that ends the edit
// carrying nothing but text. A wrapper that holds formatting stays, marker
// included (outside the data-wfp-edit-* namespace so export keeps it): it
// counts as the host's own text for the inspector and is never a selection
// target of its own. Block hosts are untouched; author element children (a
// dot <span>) keep their own item. History stays wrapper-neutral.

const FIXTURE = 'pointer-nav-deck.html';
const FLEX_CSS =
  '.deck-list{list-style:none;padding:0;margin:0;width:700px}' +
  '.deck-list li{display:flex;gap:14px;align-items:flex-start;font-size:28px;line-height:1.3}' +
  '.deck-list li::before{content:"";width:12px;height:12px;border-radius:50%;background:#7a3fa0;flex:none;margin-top:12px}';
const BLOCK_CSS =
  '.deck-list{padding-left:30px;margin:0;width:700px}' +
  '.deck-list li{font-size:28px;line-height:1.3}';
const SENTENCE = 'Rethink the whole workflow and test against how it works today.';

async function loadWithList(page, css, itemHtml) {
  await page.goto(`/fixtures/${FIXTURE}`);
  await page.evaluate(([css, itemHtml]) => {
    const st = document.createElement('style');
    st.textContent = css;
    document.head.appendChild(st);
    const slide = document.querySelector('#pointer-slide-1');
    const ul = document.createElement('ul');
    ul.className = 'deck-list';
    ul.style.cssText = 'position:absolute;left:120px;top:760px';
    ul.innerHTML = `<li>${itemHtml}</li>`;
    slide.appendChild(ul);
  }, [css, itemHtml]);
  await page.addScriptTag({ path: EDITOR_PATH });
  await page.waitForFunction(() => window.__wfpEditorReady === true);
  await page.keyboard.press('e');
}

const LI = '.deck-list li';

// Left edge of every line the item's TEXT occupies, top to bottom. Measured
// from text nodes only, so element boxes (a wrapper spanning both lines)
// never count as a line of their own.
const lineLefts = (page) =>
  page.evaluate((s) => {
    const li = document.querySelector(s);
    const walker = document.createTreeWalker(li, NodeFilter.SHOW_TEXT);
    const lines = []; // [{ top, left }]
    let t;
    while ((t = walker.nextNode())) {
      const r = document.createRange();
      r.selectNodeContents(t);
      for (const b of r.getClientRects()) {
        if (b.width === 0) continue;
        const line = lines.find((l) => Math.abs(l.top - b.top) < 4);
        if (line) line.left = Math.min(line.left, b.left);
        else lines.push({ top: b.top, left: b.left });
      }
    }
    return lines.sort((a, b) => a.top - b.top).map((l) => Math.round(l.left));
  }, LI);

const html = (page) => page.evaluate((s) => document.querySelector(s).innerHTML, LI);

async function startEdit(page) {
  await page.evaluate((s) => {
    const el = document.querySelector(s);
    const r = el.getBoundingClientRect();
    el.dispatchEvent(new MouseEvent('dblclick', {
      bubbles: true, cancelable: true, view: window,
      clientX: r.left + 40, clientY: r.top + 10, detail: 2,
    }));
  }, LI);
}

// Select `word` inside the item's text (wherever the edit has put it) and
// press the browser's own bold shortcut.
async function boldWord(page, word) {
  await page.evaluate(([s, w]) => {
    const li = document.querySelector(s);
    const walker = document.createTreeWalker(li, NodeFilter.SHOW_TEXT);
    let t;
    while ((t = walker.nextNode())) {
      const i = t.textContent.indexOf(w);
      if (i < 0) continue;
      const r = document.createRange();
      r.setStart(t, i);
      r.setEnd(t, i + w.length);
      const sel = getSelection();
      sel.removeAllRanges();
      sel.addRange(r);
      return;
    }
    throw new Error(`word not found: ${w}`);
  }, [LI, word]);
  await page.keyboard.press('Control+b');
}

test.describe('v2.26 — formatting inside a flex host keeps one text run', () => {
  test('bolding a word in a flex bullet keeps the sentence wrapping under the bullet', async ({ page }) => {
    await loadWithList(page, FLEX_CSS, SENTENCE);
    const before = await lineLefts(page);
    expect(before.length).toBe(2);
    expect(before[1]).toBe(before[0]); // second line wraps back to the left edge

    await startEdit(page);
    await boldWord(page, 'Rethink');
    await page.keyboard.press('Escape');

    const after = await lineLefts(page);
    expect(after.length).toBe(2);
    expect(after[1]).toBe(before[0]); // still wraps to the left edge, not beside the bold word

    const shape = await page.evaluate((s) => {
      const li = document.querySelector(s);
      const b = li.querySelector('b');
      return {
        text: li.textContent,
        bIsDirectChild: b.parentElement === li,
        bDisplay: getComputedStyle(b).display,
        itemChildren: li.children.length,
        markers: li.querySelectorAll('[data-wfp-text-run]').length,
        editMarkers: li.querySelectorAll('[data-wfp-edit-text-run], [contenteditable]').length,
      };
    }, LI);
    expect(shape.text).toBe(SENTENCE);
    expect(shape.bIsDirectChild).toBe(false); // the bold sits inside the run, not beside it
    expect(shape.bDisplay).toBe('inline');
    expect(shape.itemChildren).toBe(1); // exactly one flex item carries the text
    expect(shape.markers).toBe(1); // the kept wrapper stays recognisable
    expect(shape.editMarkers).toBe(0);
  });

  test('a plain edit in a flex bullet leaves no wrapper behind', async ({ page }) => {
    await loadWithList(page, FLEX_CSS, SENTENCE);
    await startEdit(page);
    await page.evaluate((s) => {
      const li = document.querySelector(s);
      const walker = document.createTreeWalker(li, NodeFilter.SHOW_TEXT);
      const t = walker.nextNode();
      const r = document.createRange();
      r.setStart(t, t.textContent.length);
      r.collapse(true);
      const sel = getSelection();
      sel.removeAllRanges();
      sel.addRange(r);
    }, LI);
    await page.keyboard.type(' Really.');
    await page.keyboard.press('Escape');
    expect(await html(page)).toBe(`${SENTENCE} Really.`);
  });

  test('an untouched flex bullet is restored byte-for-byte and records no history', async ({ page }) => {
    await loadWithList(page, FLEX_CSS, SENTENCE);
    // A deliberate prior edit: select the bullet and nudge its font size,
    // so exactly one history entry exists before the text edit opens.
    await page.locator(LI).click();
    await page.keyboard.press('ArrowUp');
    const nudged = await page.evaluate((s) => document.querySelector(s).getAttribute('style'), LI);
    expect(nudged).toContain('font-size');

    await startEdit(page);
    const during = await page.evaluate((s) => {
      const li = document.querySelector(s);
      const sel = getSelection();
      return {
        wrapped: li.querySelectorAll('[data-wfp-text-run]').length,
        caretInside: !!sel.anchorNode && li.contains(sel.anchorNode),
      };
    }, LI);
    expect(during.wrapped).toBe(1); // wrapped for the edit…
    expect(during.caretInside).toBe(true); // …with the caret placed inside it
    await page.keyboard.press('Escape');
    expect(await html(page)).toBe(SENTENCE); // …and gone again

    // One undo must reach the font-size nudge: the untouched edit recorded
    // nothing in between.
    await page.keyboard.press('Control+z');
    expect(await page.evaluate((s) => document.querySelector(s).getAttribute('style'), LI)).toBeNull();
    expect(await html(page)).toBe(SENTENCE);
  });

  test('inspector text controls still apply to the flex host during the edit', async ({ page }) => {
    await loadWithList(page, FLEX_CSS, SENTENCE);
    await page.locator(LI).click(); // select first, as a user does — shows the inspector
    await startEdit(page);
    // The wrapper moved the host's text nodes; the host must still count as
    // text-bearing or every inspector text control silently no-ops.
    const bold = page.locator('#wfp-editor-root .wfpe-seg-item[data-wfpe-value="700"]');
    await expect(bold).toBeVisible();
    await bold.click();
    // Focus is on the inspector button now, where Escape means "revert the
    // field", so commit the way a user does: click empty canvas.
    await page.mouse.click(1500, 950);
    const after = await page.evaluate((s) => {
      const li = document.querySelector(s);
      return { style: li.getAttribute('style'), html: li.innerHTML };
    }, LI);
    expect(after.style).toContain('font-weight: 700');
    expect(after.html).toBe(SENTENCE); // the plain wrapper is gone…

    // …and the mid-edit commit recorded exactly one entry, wrapper-free:
    // one undo removes the weight and leaves the markup pristine.
    await page.keyboard.press('Control+z');
    const undone = await page.evaluate((s) => {
      const li = document.querySelector(s);
      return { style: li.getAttribute('style'), html: li.innerHTML };
    }, LI);
    expect(undone.style).toBeNull();
    expect(undone.html).toBe(SENTENCE);
  });

  test('clicking the bold word after a formatted edit selects the bullet, not the wrapper', async ({ page }) => {
    await loadWithList(page, FLEX_CSS, SENTENCE);
    await startEdit(page);
    await boldWord(page, 'Rethink');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape'); // drop the selection left by the edit

    const b = await page.evaluate((s) => document.querySelector(`${s} b`).getBoundingClientRect().toJSON(), LI);
    await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
    const geometry = await page.evaluate((s) => {
      const li = document.querySelector(s).getBoundingClientRect();
      const ring = document.querySelector('#wfp-editor-root .wfpe-selection-ring').getBoundingClientRect();
      return { li: [Math.round(li.x), Math.round(li.width)], ring: [Math.round(ring.x), Math.round(ring.width)] };
    }, LI);
    expect(geometry.ring).toEqual(geometry.li);

    // And the bullet is still editable as a whole: double-clicking the bold
    // word edits the <li>, not the wrapper.
    await page.evaluate((s) => {
      const el = document.querySelector(`${s} b`);
      const r = el.getBoundingClientRect();
      el.dispatchEvent(new MouseEvent('dblclick', {
        bubbles: true, cancelable: true, view: window,
        clientX: r.left + 4, clientY: r.top + r.height / 2, detail: 2,
      }));
    }, LI);
    expect(await page.evaluate((s) => document.querySelector(s).getAttribute('contenteditable'), LI)).toBe('true');
    await page.keyboard.press('Escape');
  });

  test('export keeps the formatted wrapper and sweeps every editor marker', async ({ page }) => {
    await disableFsa(page);
    await loadWithList(page, FLEX_CSS, SENTENCE);
    await startEdit(page);
    await boldWord(page, 'Rethink');
    await page.keyboard.press('Escape');

    const downloadPromise = page.waitForEvent('download', { timeout: 5_000 });
    await page.keyboard.press('ControlOrMeta+s');
    const download = await downloadPromise;
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    const out = path.join(OUTPUT_DIR, `${Date.now()}-${Math.random().toString(16).slice(2)}-${download.suggestedFilename()}`);
    await download.saveAs(out);
    const exported = fs.readFileSync(out, 'utf8');

    expect(exported).toContain(`<span data-wfp-text-run="true"><b>Rethink</b>${SENTENCE.slice('Rethink'.length)}</span>`);
    expect(exported).not.toMatch(EDITOR_MARKER_ATTR_RE);
    expect(exported).not.toContain('contenteditable');
  });

  test('an author dot element keeps its own flex item; only the text run is wrapped', async ({ page }) => {
    const DOT_CSS = FLEX_CSS.replace('.deck-list li::before', '.deck-list li .nope') +
      '.dot{width:12px;height:12px;border-radius:50%;background:#7a3fa0;flex:none;margin-top:12px}';
    await loadWithList(page, DOT_CSS, `<span class="dot"></span>${SENTENCE}`);
    const before = await lineLefts(page);
    await startEdit(page);
    await boldWord(page, 'Rethink');
    await page.keyboard.press('Escape');

    const after = await lineLefts(page);
    expect(after[1]).toBe(before[1]);
    const shape = await page.evaluate((s) => {
      const li = document.querySelector(s);
      return {
        first: li.firstElementChild.className,
        items: li.children.length,
        dotIsDirect: li.querySelector('.dot').parentElement === li,
        bInsideRun: li.querySelector('b').parentElement !== li,
      };
    }, LI);
    expect(shape.first).toBe('dot');
    expect(shape.items).toBe(2); // dot + one text item
    expect(shape.dotIsDirect).toBe(true);
    expect(shape.bInsideRun).toBe(true);
  });

  test('a block-flow bullet is never wrapped', async ({ page }) => {
    await loadWithList(page, BLOCK_CSS, SENTENCE);
    await startEdit(page);
    const wrapped = await page.evaluate((s) => document.querySelector(s).querySelectorAll('[data-wfp-text-run]').length, LI);
    expect(wrapped).toBe(0);
    await boldWord(page, 'Rethink');
    await page.keyboard.press('Escape');
    expect(await html(page)).toBe(`<b>Rethink</b>${SENTENCE.slice('Rethink'.length)}`);
  });

  test('undo after a bold in a flex bullet restores the original markup', async ({ page }) => {
    await loadWithList(page, FLEX_CSS, SENTENCE);
    await startEdit(page);
    await boldWord(page, 'Rethink');
    await page.keyboard.press('Escape');
    expect(await html(page)).toContain('<b>Rethink</b>');
    await page.keyboard.press('Control+z');
    expect(await html(page)).toBe(SENTENCE);
  });
});
