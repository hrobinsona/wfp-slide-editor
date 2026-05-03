import { test, expect } from '@playwright/test';
import { loadFixtureWithEditor } from './_helpers.js';

test.use({ viewport: { width: 2000, height: 1200 } });

async function setDeckScale(page, scale) {
  await page.evaluate((s) => {
    document.querySelector('.deck').style.transform = `scale(${s})`;
  }, scale);
}

async function dblclickElement(page, selector) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    const r = el.getBoundingClientRect();
    const x = r.left + Math.max(2, r.width / 2);
    const y = r.top + Math.max(2, r.height / 2);
    el.dispatchEvent(
      new MouseEvent('dblclick', {
        bubbles: true,
        cancelable: true,
        view: window,
        clientX: x,
        clientY: y,
        detail: 2,
      }),
    );
  }, selector);
}

async function readEditState(page, selector) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    return {
      contenteditable: el.getAttribute('contenteditable'),
      isContentEditable: el.isContentEditable,
      innerHTML: el.innerHTML,
      hasFocus: document.activeElement === el,
    };
  }, selector);
}

test.describe('Phase 7 — Inline text edit', () => {
  test('double-click on text-bearing element enables contenteditable and focuses it', async ({
    page,
  }) => {
    await loadFixtureWithEditor(page, 'Townhall-1.html');
    await setDeckScale(page, 1);
    await page.keyboard.press('e');

    await dblclickElement(page, '.slide.active h1');

    const s = await readEditState(page, '.slide.active h1');
    expect(s.contenteditable).toBe('true');
    expect(s.isContentEditable).toBe(true);
    expect(s.hasFocus).toBe(true);
  });

  test('selection ring is hidden during text edit', async ({ page }) => {
    await loadFixtureWithEditor(page, 'Townhall-1.html');
    await setDeckScale(page, 1);
    await page.keyboard.press('e');

    await dblclickElement(page, '.slide.active h1');

    const ringDisplay = await page.evaluate(
      () => document.querySelector('#wfp-editor-root .wfpe-selection-ring').style.display,
    );
    expect(ringDisplay).toBe('none');

    const handleDisplays = await page.evaluate(() =>
      [...document.querySelectorAll('#wfp-editor-root .wfpe-handle')].map(
        (h) => h.style.display,
      ),
    );
    handleDisplays.forEach((d) => expect(d).toBe('none'));
  });

  test('Escape exits text edit and clears contenteditable', async ({ page }) => {
    await loadFixtureWithEditor(page, 'Townhall-1.html');
    await setDeckScale(page, 1);
    await page.keyboard.press('e');

    await dblclickElement(page, '.slide.active h1');
    expect((await readEditState(page, '.slide.active h1')).contenteditable).toBe('true');

    await page.keyboard.press('Escape');

    const s = await readEditState(page, '.slide.active h1');
    expect(s.contenteditable).toBeNull();
    expect(s.isContentEditable).toBe(false);
  });

  test('Tab exits text edit', async ({ page }) => {
    await loadFixtureWithEditor(page, 'Townhall-1.html');
    await setDeckScale(page, 1);
    await page.keyboard.press('e');

    await dblclickElement(page, '.slide.active h1');
    await page.keyboard.press('Tab');

    expect((await readEditState(page, '.slide.active h1')).contenteditable).toBeNull();
  });

  test('clicking outside the editing element exits text edit', async ({ page }) => {
    await loadFixtureWithEditor(page, 'Townhall-1.html');
    await setDeckScale(page, 1);
    await page.keyboard.press('e');

    await dblclickElement(page, '.slide.active h1');
    expect((await readEditState(page, '.slide.active h1')).contenteditable).toBe('true');

    // Click a slide background area (no descendants there to select).
    await page.evaluate(() => {
      const slide = document.querySelector('.slide.active');
      slide.dispatchEvent(
        new MouseEvent('mousedown', {
          bubbles: true,
          cancelable: true,
          view: window,
          clientX: 1,
          clientY: 1,
          button: 0,
        }),
      );
      slide.dispatchEvent(
        new MouseEvent('mouseup', {
          bubbles: true,
          cancelable: true,
          view: window,
          clientX: 1,
          clientY: 1,
          button: 0,
        }),
      );
    });

    expect((await readEditState(page, '.slide.active h1')).contenteditable).toBeNull();
  });

  test('typing replaces text and is preserved after exit', async ({ page }) => {
    await loadFixtureWithEditor(page, 'Townhall-1.html');
    await setDeckScale(page, 1);
    await page.keyboard.press('e');

    await dblclickElement(page, '.slide.active h1');
    // Programmatically replace innerHTML to simulate typing
    await page.evaluate(() => {
      const el = document.querySelector('.slide.active h1');
      el.innerHTML = 'New title text';
    });
    await page.keyboard.press('Escape');

    const s = await readEditState(page, '.slide.active h1');
    expect(s.contenteditable).toBeNull();
    expect(s.innerHTML).toBe('New title text');
  });

  test('Cmd+Z undoes a text change', async ({ page }) => {
    await loadFixtureWithEditor(page, 'Townhall-1.html');
    await setDeckScale(page, 1);
    await page.keyboard.press('e');

    const original = await page.evaluate(
      () => document.querySelector('.slide.active h1').innerHTML,
    );

    await dblclickElement(page, '.slide.active h1');
    await page.evaluate(() => {
      document.querySelector('.slide.active h1').innerHTML = 'Replaced';
    });
    await page.keyboard.press('Escape');

    expect(
      await page.evaluate(() => document.querySelector('.slide.active h1').innerHTML),
    ).toBe('Replaced');

    await page.keyboard.press('ControlOrMeta+z');

    const restored = await page.evaluate(
      () => document.querySelector('.slide.active h1').innerHTML,
    );
    expect(restored).toBe(original);
  });

  test('preserves existing inline HTML (e.g. <br>) through edit', async ({ page }) => {
    await loadFixtureWithEditor(page, 'Townhall-1.html');
    await setDeckScale(page, 1);
    await page.keyboard.press('e');

    // Inject a <br> into the heading so we can verify it survives.
    await page.evaluate(() => {
      const el = document.querySelector('.slide.active h1');
      el.innerHTML = 'Line one<br>Line two';
    });

    await dblclickElement(page, '.slide.active h1');
    // Edit only the first line by replacing innerHTML while preserving the <br>.
    await page.evaluate(() => {
      const el = document.querySelector('.slide.active h1');
      el.innerHTML = 'Line ONE<br>Line two';
    });
    await page.keyboard.press('Tab');

    const html = await page.evaluate(
      () => document.querySelector('.slide.active h1').innerHTML,
    );
    expect(html).toContain('<br>');
    expect(html).toContain('Line ONE');
    expect(html).toContain('Line two');
  });

  test('does not enter text edit on a non-text-bearing container', async ({ page }) => {
    await loadFixtureWithEditor(page, 'Townhall-1.html');
    await setDeckScale(page, 1);
    await page.keyboard.press('e');

    // Find a container with no direct text node.
    const sel = await page.evaluate(() => {
      const slide = document.querySelector('.slide.active');
      const cand = [...slide.querySelectorAll('*')].find((el) => {
        const hasDirectText = [...el.childNodes].some(
          (n) => n.nodeType === 3 && n.textContent.trim().length > 0,
        );
        if (hasDirectText) return false;
        const r = el.getBoundingClientRect();
        return r.width > 30 && r.height > 10 && el.children.length >= 1;
      });
      if (!cand) return null;
      cand.dataset.testNonText = 'yes';
      return '[data-test-non-text="yes"]';
    });
    if (!sel) {
      test.skip(true, 'No non-text container found');
      return;
    }

    await dblclickElement(page, sel);
    expect((await readEditState(page, sel)).contenteditable).toBeNull();
  });

  test('text edit does not leave editor in a stuck state when ring is hidden', async ({
    page,
  }) => {
    await loadFixtureWithEditor(page, 'Townhall-1.html');
    await setDeckScale(page, 1);
    await page.keyboard.press('e');

    await dblclickElement(page, '.slide.active h1');
    await page.keyboard.press('Escape');

    // After exiting, selecting another element should re-show the ring.
    await page.evaluate(() => {
      const target = document.querySelector('.slide.active .wfp-badge');
      const r = target.getBoundingClientRect();
      target.dispatchEvent(
        new MouseEvent('click', {
          bubbles: true,
          cancelable: true,
          view: window,
          clientX: r.left + r.width / 2,
          clientY: r.top + r.height / 2,
        }),
      );
    });

    const ringDisplay = await page.evaluate(
      () => document.querySelector('#wfp-editor-root .wfpe-selection-ring').style.display,
    );
    expect(ringDisplay).toBe('block');
  });
});
