import { test, expect } from '@playwright/test';
import { loadFixtureWithEditor } from './_helpers.js';

test.use({ viewport: { width: 1600, height: 1000 } });

// v2.25 — inline formatting runs are text, not boxes.
//
// Cmd/Ctrl+B during an inline text edit hands the keystroke to the browser,
// which wraps the selected words in <b>. Every element in the active slide
// was a selectable target, so the next click on the bold words selected the
// <b> itself: a ring around one run of text, its own X/Y/W/H, and a drag
// that pulled the run out of the paragraph's flow as position: absolute
// while the paragraph got dimension-pinned around it. To the user that reads
// as "bolding created a new text box and shifted the words next to it".
//
// A run of inline formatting that sits among its parent's own text (<b>,
// <strong>, <em>, <a>, a colour <span>) now resolves to the nearest ancestor
// that is not such a run, so click, drag and double-click all address the
// paragraph. Inline elements that are NOT mixed into text — a <strong> stat
// sitting alone in a card, a <span> chip — stay selectable exactly as before.

const FIXTURE = 'pointer-nav-deck.html';
const NOTE = '#pointer-slide-1 .deck-note';

const rect = (page, selector) =>
  page.evaluate((s) => {
    const r = document.querySelector(s).getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
  }, selector);

const ringRect = (page) =>
  page.evaluate(() => {
    const ring = document.querySelector('#wfp-editor-root .wfpe-selection-ring');
    const r = ring.getBoundingClientRect();
    return { display: ring.style.display, x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
  });

const center = (r) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });

async function dblclickAt(page, selector) {
  await page.evaluate((s) => {
    const el = document.querySelector(s);
    const r = el.getBoundingClientRect();
    el.dispatchEvent(new MouseEvent('dblclick', {
      bubbles: true, cancelable: true, view: window,
      clientX: r.left + 4, clientY: r.top + r.height / 2, detail: 2,
    }));
  }, selector);
}

// Bold one word of the note the way a user does: inline edit, select the
// word, Ctrl+B (the browser's own bold), commit.
async function boldWordViaKeyboard(page, word) {
  await dblclickAt(page, NOTE);
  await page.evaluate(([s, w]) => {
    const p = document.querySelector(s);
    const t = p.firstChild;
    const i = t.textContent.indexOf(w);
    const r = document.createRange();
    r.setStart(t, i);
    r.setEnd(t, i + w.length);
    const sel = getSelection();
    sel.removeAllRanges();
    sel.addRange(r);
  }, [NOTE, word]);
  await page.keyboard.press('Control+b');
  await page.keyboard.press('Escape');
  const html = await page.evaluate((s) => document.querySelector(s).innerHTML, NOTE);
  expect(html).toContain(`<b>${word}</b>`);
}

test.describe('v2.25 — inline text runs resolve to their text block', () => {
  test('clicking a word bolded with Ctrl+B selects the paragraph, not the <b>', async ({ page }) => {
    await loadFixtureWithEditor(page, FIXTURE);
    await page.keyboard.press('e');
    await boldWordViaKeyboard(page, 'synthetic');

    const pRect = await rect(page, NOTE);
    const bRect = await rect(page, `${NOTE} b`);
    expect(bRect.w).toBeLessThan(pRect.w); // the run really is narrower than its block

    await page.mouse.click(center(bRect).x, center(bRect).y);

    const ring = await ringRect(page);
    expect(ring.display).toBe('block');
    expect(ring.w).toBe(pRect.w);
    expect(ring.h).toBe(pRect.h);
    expect(ring.x).toBe(pRect.x);
  });

  test('dragging the bolded word moves the paragraph and leaves the <b> in flow', async ({ page }) => {
    await loadFixtureWithEditor(page, FIXTURE);
    await page.keyboard.press('e');
    await boldWordViaKeyboard(page, 'synthetic');

    const before = await rect(page, NOTE);
    const bRect = await rect(page, `${NOTE} b`);
    const c = center(bRect);
    await page.mouse.move(c.x, c.y);
    await page.mouse.down();
    await page.mouse.move(c.x + 20, c.y + 10, { steps: 4 });
    await page.mouse.move(c.x + 40, c.y + 20, { steps: 4 });
    await page.mouse.up();

    const after = await page.evaluate((s) => {
      const p = document.querySelector(s);
      const b = p.querySelector('b');
      return {
        pMoved: p.style.left !== '' && p.style.top !== '',
        bStyle: b.getAttribute('style'),
        bFrozen: b.getAttribute('data-wfp-edit-frozen'),
        html: p.innerHTML,
        rect: (({ x, y }) => ({ x: Math.round(x), y: Math.round(y) }))(p.getBoundingClientRect()),
      };
    }, NOTE);

    expect(after.pMoved).toBe(true); // the paragraph is what the drag moved
    expect(after.bStyle).toBeNull(); // the run is untouched…
    expect(after.bFrozen).toBeNull(); // …and never pinned
    expect(after.html).toBe('A <b>synthetic</b> deck whose visible slide is marked with is-active.');
    expect(after.rect.x).toBeGreaterThan(before.x + 20);
    expect(after.rect.y).toBeGreaterThan(before.y + 10);
  });

  test('double-clicking the bolded word edits the whole paragraph', async ({ page }) => {
    await loadFixtureWithEditor(page, FIXTURE);
    await page.keyboard.press('e');
    await boldWordViaKeyboard(page, 'synthetic');

    await dblclickAt(page, `${NOTE} b`);
    const editing = await page.evaluate((s) => ({
      p: document.querySelector(s).getAttribute('contenteditable'),
      b: document.querySelector(`${s} b`).getAttribute('contenteditable'),
    }), NOTE);
    expect(editing.p).toBe('true');
    expect(editing.b).toBeNull();
    await page.keyboard.press('Escape');
  });

  test('nested runs climb to the block; inline elements not mixed into text stay selectable', async ({ page }) => {
    await loadFixtureWithEditor(page, FIXTURE);
    // Author-shaped markup the fixture does not carry: a paragraph with a
    // nested run, and a wrapper whose only child is an inline element.
    await page.evaluate(() => {
      const slide = document.querySelector('#pointer-slide-1');
      const p = document.createElement('p');
      p.className = 'probe-mixed';
      p.style.cssText = 'position:absolute;left:120px;top:820px;font-size:28px;margin:0';
      p.innerHTML = 'Lead <strong>bold <em>and italic</em></strong> tail';
      const wrap = document.createElement('div');
      wrap.className = 'probe-wrap';
      wrap.style.cssText = 'position:absolute;left:900px;top:820px;font-size:28px';
      wrap.innerHTML = '<span class="probe-solo">Solo span</span>';
      slide.append(p, wrap);
    });
    await page.keyboard.press('e');

    const em = await rect(page, '.probe-mixed em');
    await page.mouse.click(center(em).x, center(em).y);
    const pRect = await rect(page, '.probe-mixed');
    const ring1 = await ringRect(page);
    expect([ring1.x, ring1.w, ring1.h]).toEqual([pRect.x, pRect.w, pRect.h]);

    const solo = await rect(page, '.probe-solo');
    await page.mouse.click(center(solo).x, center(solo).y);
    const ring2 = await ringRect(page);
    expect([ring2.x, ring2.w, ring2.h]).toEqual([solo.x, solo.w, solo.h]);
  });
});
