import { test, expect } from '@playwright/test';
import { loadFixtureWithEditor } from './_helpers.js';

// v2.1.0 — Activation + toolbar Overview button.
// - Hotkey `O` toggles overview from any state (edit on or off).
// - Toolbar click on the Overview button does the same.
// - Escape exits overview when on; no-op when off.
// - Mutual exclusion: entering overview clears state.selected but does
//   NOT change state.editMode.
// - Hotkey `O` is suppressed inside typing targets and inside an open
//   inline text edit (typed `o` flows to the caret, doesn't toggle).

const overviewBtnSel = '#wfp-editor-root .wfpe-toolbar [data-action="overview"]';
const editBadgeSel = '#wfp-editor-root .wfpe-mode-badge';
const ringSel = '#wfp-editor-root .wfpe-selection-ring';

test.describe('v2.1.0 — Overview activation', () => {
  test('toolbar gains an Overview icon button between Edit and Export, defaulting to off', async ({ page }) => {
    await loadFixtureWithEditor(page, 'Townhall-1.html');

    const buttons = await page.evaluate(() => {
      const tb = document.querySelector('#wfp-editor-root .wfpe-toolbar');
      return [...tb.querySelectorAll('button')].map((b) => ({
        action: b.dataset.action,
        hasIcon: !!b.querySelector('svg.wfpe-icon'),
        text: b.textContent.replace(/\s+/g, ' ').trim(),
      }));
    });

    expect(buttons.map((b) => b.action)).toEqual(['edit', 'overview', 'export', 'undo', 'redo']);
    const overview = buttons.find((b) => b.action === 'overview');
    expect(overview.hasIcon).toBe(true);
    expect(overview.text).toBe('Overview');

    await expect(page.locator(overviewBtnSel)).toHaveAttribute('data-mode', 'off');
  });

  test('pressing O toggles overview mode on/off', async ({ page }) => {
    await loadFixtureWithEditor(page, 'Townhall-1.html');
    const button = page.locator(overviewBtnSel);

    await expect(button).toHaveAttribute('data-mode', 'off');
    await page.keyboard.press('o');
    await expect(button).toHaveAttribute('data-mode', 'on');
    await page.keyboard.press('o');
    await expect(button).toHaveAttribute('data-mode', 'off');
  });

  test('clicking the Overview button toggles overview mode (same as hotkey)', async ({ page }) => {
    await loadFixtureWithEditor(page, 'Townhall-1.html');
    const button = page.locator(overviewBtnSel);

    await expect(button).toHaveAttribute('data-mode', 'off');
    await button.click();
    await expect(button).toHaveAttribute('data-mode', 'on');
    await button.click();
    await expect(button).toHaveAttribute('data-mode', 'off');
  });

  test('Escape exits overview when on; no-op when off', async ({ page }) => {
    await loadFixtureWithEditor(page, 'Townhall-1.html');
    const button = page.locator(overviewBtnSel);

    // No-op when off.
    await page.keyboard.press('Escape');
    await expect(button).toHaveAttribute('data-mode', 'off');

    await page.keyboard.press('o');
    await expect(button).toHaveAttribute('data-mode', 'on');

    await page.keyboard.press('Escape');
    await expect(button).toHaveAttribute('data-mode', 'off');
  });

  test('entering overview clears the current selection but leaves edit mode unchanged', async ({ page }) => {
    await loadFixtureWithEditor(page, 'Townhall-1.html');
    const editBadge = page.locator(editBadgeSel);
    const overviewBtn = page.locator(overviewBtnSel);

    // Turn edit mode on and select an element on the active slide.
    await page.keyboard.press('e');
    await expect(editBadge).toHaveAttribute('data-mode', 'on');

    const target = page.locator('.slide.active h1, .slide.active h2, .slide.active p').first();
    await target.click();
    await expect(page.locator(ringSel)).not.toHaveCSS('display', 'none');

    // Enter overview.
    await page.keyboard.press('o');
    await expect(overviewBtn).toHaveAttribute('data-mode', 'on');

    // Selection ring is hidden — selection was cleared.
    await expect(page.locator(ringSel)).toHaveCSS('display', 'none');

    // Edit mode badge is still on.
    await expect(editBadge).toHaveAttribute('data-mode', 'on');
  });

  test('overview can be entered with edit mode off and does not turn edit mode on', async ({ page }) => {
    await loadFixtureWithEditor(page, 'Townhall-1.html');
    const editBadge = page.locator(editBadgeSel);
    const overviewBtn = page.locator(overviewBtnSel);

    await expect(editBadge).toHaveAttribute('data-mode', 'off');
    await page.keyboard.press('o');
    await expect(overviewBtn).toHaveAttribute('data-mode', 'on');
    await expect(editBadge).toHaveAttribute('data-mode', 'off');
  });

  test('hotkey O does not toggle overview while typing in an input', async ({ page }) => {
    await loadFixtureWithEditor(page, 'Townhall-1.html');
    const overviewBtn = page.locator(overviewBtnSel);

    await page.evaluate(() => {
      const input = document.createElement('input');
      input.id = 'spec-input';
      document.body.appendChild(input);
      input.focus();
    });
    await page.keyboard.type('o');
    await expect(overviewBtn).toHaveAttribute('data-mode', 'off');
  });

  test('hotkey O does not toggle overview while an inline text edit is open', async ({ page }) => {
    await loadFixtureWithEditor(page, 'Townhall-1.html');
    await page.keyboard.press('e');

    const target = page.locator('.slide.active h1, .slide.active h2, .slide.active p').first();
    await target.dblclick();

    const overviewBtn = page.locator(overviewBtnSel);
    await page.keyboard.type('o');

    await expect(overviewBtn).toHaveAttribute('data-mode', 'off');
  });
});

// v2.1.1 — Grid layout. Build-first phase; tests lock the visual contract
// after manual verification. Strategy: pure-CSS overrides keyed off
// body[data-wfp-edit-overview="on"] (no slide DOM mutation), with an
// overlay layer in #wfp-editor-root for slide-number badges + the
// active-slide highlight (anchored via getBoundingClientRect; doesn't
// scale with the 0.22 transform).

test.describe('v2.1.1 — Overview grid layout', () => {
  test('entering overview marks the body and flips .deck to a 4-column grid', async ({ page }) => {
    await loadFixtureWithEditor(page, 'Townhall-1.html');
    await page.keyboard.press('o');

    const state = await page.evaluate(() => {
      const deck = document.querySelector('.deck');
      const cs = getComputedStyle(deck);
      return {
        bodyAttr: document.body.getAttribute('data-wfp-edit-overview'),
        display: cs.display,
        cols: cs.gridTemplateColumns.split(' ').filter(Boolean).length,
      };
    });
    expect(state.bodyAttr).toBe('on');
    expect(state.display).toBe('grid');
    expect(state.cols).toBe(4);
  });

  test('every .slide is visible in the grid (display !== none)', async ({ page }) => {
    await loadFixtureWithEditor(page, 'Townhall-1.html');
    await page.keyboard.press('o');

    const visibility = await page.evaluate(() => {
      return [...document.querySelectorAll('.slide')].map((s) => getComputedStyle(s).display);
    });
    expect(visibility.length).toBeGreaterThan(1);
    for (const d of visibility) expect(d).not.toBe('none');
  });

  test('each slide gets a numbered overlay badge in render order', async ({ page }) => {
    await loadFixtureWithEditor(page, 'Townhall-1.html');
    await page.keyboard.press('o');

    // Wait for the deferred RAF that builds the overlay after the grid
    // layout settles.
    await page.waitForFunction(() => {
      return document.querySelectorAll('#wfp-editor-root .wfpe-overview-thumb').length > 0;
    });

    const labels = await page.evaluate(() => {
      return [...document.querySelectorAll('#wfp-editor-root .wfpe-overview-thumb .wfpe-overview-badge')]
        .map((b) => b.textContent);
    });
    const slideCount = await page.locator('.slide').count();
    expect(labels.length).toBe(slideCount);
    expect(labels).toEqual(labels.map((_, i) => String(i + 1)));
  });

  test('active-slide highlight is applied to the thumb of the slide that was active before entering overview', async ({ page }) => {
    await loadFixtureWithEditor(page, 'Townhall-1.html');
    // Force a non-first slide to be active so the test would catch a
    // hard-coded "always thumb 0" bug.
    await page.evaluate(() => {
      document.querySelectorAll('.slide').forEach((sl, i) => sl.classList.toggle('active', i === 2));
    });
    await page.keyboard.press('o');
    await page.waitForFunction(() => {
      return document.querySelectorAll('#wfp-editor-root .wfpe-overview-thumb').length > 0;
    });

    const activeIndices = await page.evaluate(() => {
      return [...document.querySelectorAll('#wfp-editor-root .wfpe-overview-thumb')]
        .map((t, i) => (t.dataset.active === 'true' ? i : null))
        .filter((v) => v !== null);
    });
    expect(activeIndices).toEqual([2]);
  });

  test('overlay thumbs are anchored to each slide\'s on-screen rect', async ({ page }) => {
    await loadFixtureWithEditor(page, 'Townhall-1.html');
    await page.keyboard.press('o');
    await page.waitForFunction(() => {
      return document.querySelectorAll('#wfp-editor-root .wfpe-overview-thumb').length > 0;
    });

    const aligned = await page.evaluate(() => {
      const slides = [...document.querySelectorAll('.deck > .slide')];
      const thumbs = [...document.querySelectorAll('#wfp-editor-root .wfpe-overview-thumb')];
      return slides.every((s, i) => {
        const sr = s.getBoundingClientRect();
        const t = thumbs[i];
        const tr = t.getBoundingClientRect();
        // Allow ±1px slack for sub-pixel rounding.
        return (
          Math.abs(sr.top - tr.top) <= 1 &&
          Math.abs(sr.left - tr.left) <= 1 &&
          Math.abs(sr.width - tr.width) <= 1 &&
          Math.abs(sr.height - tr.height) <= 1
        );
      });
    });
    expect(aligned).toBe(true);
  });

  test('exiting overview removes the body marker and restores normal slide rendering', async ({ page }) => {
    await loadFixtureWithEditor(page, 'Townhall-1.html');

    // Snapshot the original .deck transform + display before we touch anything.
    const before = await page.evaluate(() => {
      const deck = document.querySelector('.deck');
      const cs = getComputedStyle(deck);
      return { display: cs.display, hadAttr: document.body.hasAttribute('data-wfp-edit-overview') };
    });
    expect(before.hadAttr).toBe(false);
    expect(before.display).toBe('block');

    await page.keyboard.press('o');
    await page.waitForFunction(() => document.body.dataset.wfpEditOverview === 'on');
    await page.keyboard.press('o');

    const after = await page.evaluate(() => {
      const deck = document.querySelector('.deck');
      const cs = getComputedStyle(deck);
      return {
        bodyAttr: document.body.getAttribute('data-wfp-edit-overview'),
        deckDisplay: cs.display,
        thumbCount: document.querySelectorAll('#wfp-editor-root .wfpe-overview-thumb').length,
        overlayVisible: document.querySelector('#wfp-editor-root .wfpe-overview-overlay').dataset.visible,
      };
    });
    expect(after.bodyAttr).toBe(null);
    expect(after.deckDisplay).toBe('block');
    expect(after.thumbCount).toBe(0);
    expect(after.overlayVisible).toBe('false');
  });

  test('overview hides the inspector even if a selection was open before entering', async ({ page }) => {
    await loadFixtureWithEditor(page, 'Townhall-1.html');
    await page.keyboard.press('e');

    // Select something so the inspector is visible.
    const target = page.locator('.slide.active h1, .slide.active h2, .slide.active p').first();
    await target.click();
    const inspector = page.locator('#wfp-editor-root .wfpe-inspector');
    await expect(inspector).toHaveAttribute('data-visible', 'true');

    await page.keyboard.press('o');

    // Selection cleared (inspector data-visible flips), and CSS rule on
    // body[data-wfp-edit-overview="on"] also forces the panel hidden.
    await expect(inspector).toHaveAttribute('data-visible', 'false');
    await expect(inspector).toHaveCSS('display', 'none');
  });

  test('clicks inside the deck during overview do NOT select an element (v2.1.2 owns thumb clicks)', async ({ page }) => {
    await loadFixtureWithEditor(page, 'Townhall-1.html');
    await page.keyboard.press('e');
    await page.keyboard.press('o');
    await page.waitForFunction(() => document.body.dataset.wfpEditOverview === 'on');

    // Click somewhere on a slide thumb. Selection ring should remain hidden.
    const slide = page.locator('.deck > .slide').first();
    await slide.click({ position: { x: 50, y: 50 }, force: true });

    const ring = page.locator('#wfp-editor-root .wfpe-selection-ring');
    await expect(ring).toHaveCSS('display', 'none');
  });

  test('toggling overview off within one frame of toggling it on leaves no overlay in the DOM', async ({ page }) => {
    // Regression for the rAF race: enterOverview rAF-defers the overlay
    // build so getBoundingClientRect reads against the post-grid layout.
    // If exitOverview can't cancel that pending rAF, the build runs
    // after the body marker has been removed and strands fixed-position
    // thumbs over the normally-rendered slides.
    await loadFixtureWithEditor(page, 'Townhall-1.html');

    // Press O twice synchronously without yielding to rAF in between.
    await page.evaluate(() => {
      // Two real keydowns reach the editor's capture-phase listener; both
      // resolve setOverviewMode synchronously, but only the first queues
      // the build rAF. The second call exits before that rAF fires.
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'o' }));
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'o' }));
    });

    // Wait two animation frames so any leaked rAF would have fired by now.
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

    const trace = await page.evaluate(() => {
      return {
        bodyAttr: document.body.getAttribute('data-wfp-edit-overview'),
        thumbCount: document.querySelectorAll('#wfp-editor-root .wfpe-overview-thumb').length,
        overlayVisible: document.querySelector('#wfp-editor-root .wfpe-overview-overlay').dataset.visible,
      };
    });
    expect(trace.bodyAttr).toBe(null);
    expect(trace.thumbCount).toBe(0);
    expect(trace.overlayVisible).toBe('false');
  });

  test('without the editor loaded, the fixture renders identically to baseline', async ({ page }) => {
    // Load the fixture WITHOUT injecting editor.js. Confirm the deck
    // renders in normal stack-of-slides mode (not grid) — guard against
    // an overview style accidentally leaking into the fixture's own CSS
    // payload.
    await page.goto('/fixtures/Townhall-1.html');
    await page.locator('.deck').first().waitFor({ state: 'attached' });

    const state = await page.evaluate(() => {
      const deck = document.querySelector('.deck');
      const cs = getComputedStyle(deck);
      return {
        display: cs.display,
        bodyAttr: document.body.getAttribute('data-wfp-edit-overview'),
        editorRoot: !!document.getElementById('wfp-editor-root'),
        activeCount: document.querySelectorAll('.slide.active').length,
      };
    });
    expect(state.editorRoot).toBe(false);
    expect(state.bodyAttr).toBe(null);
    expect(state.display).toBe('block');
    expect(state.activeCount).toBe(1);
  });
});
