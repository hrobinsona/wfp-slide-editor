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
// <strong>, <em>, <a>, a colour <span>) now resolves to the block that owns
// the text, so click, drag and double-click all address the paragraph. The
// whole inline chain is walked first, so a run inside a run (the editor's
// own colour <span> wrapping a <b>) is still one run. Inline elements that
// are NOT mixed into text — a <strong> stat sitting alone in a card, a
// <span> chip — stay selectable exactly as before, and replaced elements
// (<img>, inline <svg>) never climb: they are boxes the user moves.

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

  test('dragging the bolded word unlocks the paragraph and leaves the <b> in flow', async ({ page }) => {
    await loadFixtureWithEditor(page, FIXTURE);
    // The fixture's note is already position: absolute, which never reaches
    // unlockToAbsolute. The harmful path needs an in-flow paragraph, so
    // author one: a static column with two paragraphs, the first bolded.
    await page.evaluate(() => {
      const slide = document.querySelector('#pointer-slide-1');
      const col = document.createElement('div');
      col.className = 'probe-col';
      col.style.cssText = 'position:absolute;left:120px;top:780px;width:700px;font-size:28px';
      col.innerHTML = '<p class="probe-flow" style="margin:0">A <b>synthetic</b> deck note in flow.</p>' +
        '<p class="probe-next" style="margin:0">The paragraph after it.</p>';
      slide.appendChild(col);
    });
    await page.keyboard.press('e');
    const FLOW = '.probe-flow';
    const before = await rect(page, FLOW);
    const nextBefore = await rect(page, '.probe-next');
    const bRect = await rect(page, `${FLOW} b`);
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
        pPosition: p.style.position,
        bStyle: b.getAttribute('style'),
        bFrozen: b.getAttribute('data-wfp-edit-frozen'),
        html: p.innerHTML,
        rect: (({ x, y }) => ({ x: Math.round(x), y: Math.round(y) }))(p.getBoundingClientRect()),
      };
    }, FLOW);
    const nextAfter = await rect(page, '.probe-next');

    expect(after.pPosition).toBe('absolute'); // the paragraph is what unlocked
    expect(after.bStyle).toBeNull(); // the run is untouched…
    expect(after.bFrozen).toBeNull(); // …and never pinned
    expect(after.html).toBe('A <b>synthetic</b> deck note in flow.');
    expect(after.rect.x).toBeGreaterThan(before.x + 20);
    expect(after.rect.y).toBeGreaterThan(before.y + 10);
    expect(nextAfter.y).toBe(nextBefore.y); // the sibling paragraph was pinned in place
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
    // Author-shaped markup the fixture does not carry.
    await page.evaluate(() => {
      const slide = document.querySelector('#pointer-slide-1');
      const add = (cls, left, html) => {
        const el = document.createElement('div');
        el.className = cls;
        el.style.cssText = `position:absolute;left:${left}px;top:820px;font-size:28px`;
        el.innerHTML = html;
        slide.appendChild(el);
      };
      // a paragraph with a run inside a run
      add('probe-mixed', 120, '<p style="margin:0">Lead <strong>bold <em>and italic</em></strong> tail</p>');
      // the editor's own colour span, then bold inside it
      add('probe-colour', 620, '<p style="margin:0">Lead <span style="color:#c33"><b>coloured bold</b></span> tail</p>');
      // a wrapper whose only child is an inline element, itself holding a run
      add('probe-wrap', 1120, '<span class="probe-chip">Solo <b>chip</b></span>');
      // an inline image sitting among text
      add('probe-img-wrap', 1400, '<p style="margin:0">Icon <img class="probe-img" width="60" height="60" alt=""> here</p>');
    });
    await page.keyboard.press('e');

    const em = await rect(page, '.probe-mixed em');
    await page.mouse.click(center(em).x, center(em).y);
    const pRect = await rect(page, '.probe-mixed p');
    const ring1 = await ringRect(page);
    expect([ring1.x, ring1.w, ring1.h]).toEqual([pRect.x, pRect.w, pRect.h]);

    const cb = await rect(page, '.probe-colour b');
    await page.mouse.click(center(cb).x, center(cb).y);
    const cp = await rect(page, '.probe-colour p');
    const ring2 = await ringRect(page);
    expect([ring2.x, ring2.w, ring2.h]).toEqual([cp.x, cp.w, cp.h]);

    const chipB = await rect(page, '.probe-chip b');
    await page.mouse.click(center(chipB).x, center(chipB).y);
    const chip = await rect(page, '.probe-chip');
    const ring3 = await ringRect(page);
    expect([ring3.x, ring3.w, ring3.h]).toEqual([chip.x, chip.w, chip.h]);

    const img = await rect(page, '.probe-img');
    await page.mouse.click(center(img).x, center(img).y);
    const ring4 = await ringRect(page);
    expect([ring4.x, ring4.w, ring4.h]).toEqual([img.x, img.w, img.h]);
  });
});
