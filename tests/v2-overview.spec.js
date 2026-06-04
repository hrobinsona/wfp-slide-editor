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
  test('entering overview marks the body and flips .deck to a responsive grid', async ({ page }) => {
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
    expect(state.cols).toBeGreaterThan(0);
  });

  test('overview grid reflows across viewports without horizontal overflow', async ({ page }) => {
    const viewports = [
      { width: 360, height: 700 },
      { width: 700, height: 800 },
      { width: 1280, height: 800 },
      { width: 1792, height: 1120 },
      { width: 2048, height: 900 },
    ];
    const results = [];

    for (const viewport of viewports) {
      await page.setViewportSize(viewport);
      await loadFixtureWithEditor(page, 'Townhall-1.html');
      await page.keyboard.press('o');
      await page.waitForFunction(() => {
        return document.querySelectorAll('#wfp-editor-root .wfpe-overview-thumb').length > 0;
      });

      const metrics = await page.evaluate(() => {
        const deck = document.querySelector('.deck');
        const deckRect = deck.getBoundingClientRect();
        const slideRects = [...document.querySelectorAll('.deck > .slide')]
          .map((slide) => slide.getBoundingClientRect())
          .filter((rect) => rect.width > 0 && rect.height > 0);
        const cs = getComputedStyle(deck);
        return {
          viewportWidth: window.innerWidth,
          scrollWidth: document.documentElement.scrollWidth,
          deckLeft: deckRect.left,
          minSlideLeft: Math.min(...slideRects.map((rect) => rect.left)),
          maxSlideRight: Math.max(...slideRects.map((rect) => rect.right)),
          maxSlideWidth: Math.max(...slideRects.map((rect) => rect.width)),
          computedMarginLeft: cs.marginLeft,
          columns: cs.gridTemplateColumns.split(' ').filter(Boolean).length,
        };
      });

      results.push(metrics);
      expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.viewportWidth + 1);
      expect(Math.abs(metrics.deckLeft)).toBeLessThanOrEqual(1);
      expect(metrics.minSlideLeft).toBeGreaterThanOrEqual(-1);
      expect(metrics.maxSlideRight).toBeLessThanOrEqual(metrics.viewportWidth + 1);
      expect(metrics.computedMarginLeft).toBe('0px');
      if (viewport.width < 760) {
        expect(metrics.maxSlideWidth).toBeLessThan(422);
      }
    }

    expect(new Set(results.map((result) => result.columns)).size).toBeGreaterThan(1);
  });

  test('overview remains aligned when the viewport changes while open', async ({ page }) => {
    await page.setViewportSize({ width: 1792, height: 1120 });
    await loadFixtureWithEditor(page, 'Townhall-1.html');
    await page.keyboard.press('o');
    await page.waitForFunction(() => {
      return document.querySelectorAll('#wfp-editor-root .wfpe-overview-thumb').length > 0;
    });

    await page.setViewportSize({ width: 700, height: 800 });
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

    const metrics = await page.evaluate(() => {
      const slides = [...document.querySelectorAll('.deck > .slide')];
      const thumbs = [...document.querySelectorAll('#wfp-editor-root .wfpe-overview-thumb')];
      const slideRects = slides.map((slide) => slide.getBoundingClientRect());
      const thumbRects = thumbs.map((thumb) => thumb.getBoundingClientRect());
      return {
        viewportWidth: window.innerWidth,
        scrollWidth: document.documentElement.scrollWidth,
        maxSlideRight: Math.max(...slideRects.map((rect) => rect.right)),
        aligned: slideRects.every((slideRect, i) => {
          const thumbRect = thumbRects[i];
          return (
            thumbRect &&
            Math.abs(slideRect.top - thumbRect.top) <= 1 &&
            Math.abs(slideRect.left - thumbRect.left) <= 1 &&
            Math.abs(slideRect.width - thumbRect.width) <= 1 &&
            Math.abs(slideRect.height - thumbRect.height) <= 1
          );
        }),
      };
    });

    expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.viewportWidth + 1);
    expect(metrics.maxSlideRight).toBeLessThanOrEqual(metrics.viewportWidth + 1);
    expect(metrics.aligned).toBe(true);
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

});

// v2.1.2 — Click to navigate. Strict TDD.
// Click a thumbnail → set that slide as .slide.active and exit overview.
// Clicks outside any slide are no-ops. The toolbar Overview button still
// toggles via its own handler (not via the navigate path).

test.describe('v2.1.2 — Click to navigate', () => {
  test('clicking a thumbnail makes that slide active and exits overview', async ({ page }) => {
    await loadFixtureWithEditor(page, 'Townhall-1.html');
    // Slide 0 is active by default.
    await page.keyboard.press('o');
    await page.waitForFunction(() => document.body.dataset.wfpEditOverview === 'on');

    // Click slide 3 (index 2) — pick a slide that wasn't active before.
    const targetSlide = page.locator('.deck > .slide').nth(2);
    await targetSlide.click({ force: true });

    const after = await page.evaluate(() => {
      return {
        bodyAttr: document.body.getAttribute('data-wfp-edit-overview'),
        activeIds: [...document.querySelectorAll('.slide.active')].map((s) => s.id),
        overviewBtnMode: document.querySelector('#wfp-editor-root [data-action="overview"]').dataset.mode,
      };
    });
    expect(after.bodyAttr).toBe(null);
    expect(after.activeIds).toEqual(['s2']);
    expect(after.overviewBtnMode).toBe('off');
  });

  test('clicking the first thumbnail navigates to slide 0 from a non-zero start', async ({ page }) => {
    await loadFixtureWithEditor(page, 'Townhall-1.html');
    await page.evaluate(() => {
      document.querySelectorAll('.slide').forEach((s, i) => s.classList.toggle('active', i === 4));
    });
    await page.keyboard.press('o');
    await page.waitForFunction(() => document.body.dataset.wfpEditOverview === 'on');

    await page.locator('.deck > .slide').first().click({ force: true });

    const activeIds = await page.evaluate(() =>
      [...document.querySelectorAll('.slide.active')].map((s) => s.id)
    );
    expect(activeIds).toEqual(['s0']);
  });

  test('clicking the last thumbnail navigates to the last slide', async ({ page }) => {
    await loadFixtureWithEditor(page, 'Townhall-1.html');
    await page.keyboard.press('o');
    await page.waitForFunction(() => document.body.dataset.wfpEditOverview === 'on');

    const slideCount = await page.locator('.deck > .slide').count();
    await page.locator('.deck > .slide').nth(slideCount - 1).scrollIntoViewIfNeeded();
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

    const lastThumb = page.locator('#wfp-editor-root .wfpe-overview-thumb').nth(slideCount - 1);
    await lastThumb.click();

    const activeIds = await page.evaluate(() =>
      [...document.querySelectorAll('.slide.active')].map((s) => s.id)
    );
    expect(activeIds.length).toBe(1);
    // s0..s8 — last is s(slideCount-1).
    expect(activeIds[0]).toBe(`s${slideCount - 1}`);
  });

  test('clicking a lower thumbnail after scrolling overview restores slide view to the top', async ({ page }) => {
    await loadFixtureWithEditor(page, 'Townhall-1.html');
    await page.keyboard.press('o');
    await page.waitForFunction(() => {
      return document.querySelectorAll('#wfp-editor-root .wfpe-overview-thumb').length > 0;
    });

    const slideCount = await page.locator('.deck > .slide').count();
    const targetIndex = slideCount - 1;
    await page.locator('.deck > .slide').nth(targetIndex).scrollIntoViewIfNeeded();
    await page.waitForFunction(() => window.scrollY > 0);
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

    await page.locator('#wfp-editor-root .wfpe-overview-thumb').nth(targetIndex).click();
    await page.waitForFunction(() => !document.body.hasAttribute('data-wfp-edit-overview'));

    const after = await page.evaluate(() => {
      const active = document.querySelector('.slide.active');
      const scrollingElement = document.scrollingElement || document.documentElement;
      const rect = active.getBoundingClientRect();
      return {
        activeId: active.id,
        bodyAttr: document.body.getAttribute('data-wfp-edit-overview'),
        scrollY: window.scrollY,
        scrollTop: scrollingElement.scrollTop,
        activeTop: rect.top,
        activeBottom: rect.bottom,
        viewportHeight: window.innerHeight,
      };
    });
    expect(after.bodyAttr).toBe(null);
    expect(after.activeId).toBe(`s${targetIndex}`);
    expect(after.scrollY).toBe(0);
    expect(after.scrollTop).toBe(0);
    expect(after.activeTop).toBeGreaterThanOrEqual(-1);
    expect(after.activeBottom).toBeLessThanOrEqual(after.viewportHeight + 1);
  });

  test('exactly one slide carries .active after navigation', async ({ page }) => {
    await loadFixtureWithEditor(page, 'Townhall-1.html');
    await page.keyboard.press('o');
    await page.waitForFunction(() => document.body.dataset.wfpEditOverview === 'on');

    await page.locator('.deck > .slide').nth(3).click({ force: true });

    const count = await page.locator('.slide.active').count();
    expect(count).toBe(1);
  });

  test('clicking the toolbar Overview button while in overview just toggles overview off (does not navigate)', async ({ page }) => {
    await loadFixtureWithEditor(page, 'Townhall-1.html');
    const initialActive = await page.evaluate(() =>
      document.querySelector('.slide.active')?.id || null
    );
    await page.keyboard.press('o');
    await page.waitForFunction(() => document.body.dataset.wfpEditOverview === 'on');

    await page.locator('#wfp-editor-root [data-action="overview"]').click();

    const after = await page.evaluate(() => ({
      bodyAttr: document.body.getAttribute('data-wfp-edit-overview'),
      activeId: document.querySelector('.slide.active')?.id || null,
    }));
    expect(after.bodyAttr).toBe(null);
    // Active slide unchanged — the toolbar click toggled overview off
    // through its own handler, not the navigate path.
    expect(after.activeId).toBe(initialActive);
  });

  test('clicking on the editor toolbar/inspector inside overview does not navigate or exit overview', async ({ page }) => {
    await loadFixtureWithEditor(page, 'Townhall-1.html');
    const initialActive = await page.evaluate(() =>
      document.querySelector('.slide.active')?.id || null
    );
    await page.keyboard.press('o');
    await page.waitForFunction(() => document.body.dataset.wfpEditOverview === 'on');

    // Click on the Edit button (different from Overview button). The
    // editor-root exemption in onOverviewClick must let this click flow
    // to the badge's own bubble handler — overview stays on, no slide
    // navigation occurs.
    await page.locator('#wfp-editor-root .wfpe-mode-badge').click();

    const after = await page.evaluate(() => ({
      activeId: document.querySelector('.slide.active')?.id || null,
      bodyAttr: document.body.getAttribute('data-wfp-edit-overview'),
    }));
    expect(after.activeId).toBe(initialActive);
    // Overview still on — proves onOverviewClick exempted the editor-root
    // click rather than no-op'ing because it failed to find a slide ancestor.
    expect(after.bodyAttr).toBe('on');
  });
});

// v2.1.3 — Drag to reorder. Strict TDD.
// Hand-rolled HTML5 native DnD on the overlay thumbs (no slide DOM
// mutation, no Sortable.js). On drop, the dragged slide is moved in
// .deck via a single insertBefore. Active slide tracking is automatic
// (the .active class moves with the DOM node). One drag = one history
// entry. The history entry shape is extended with `slideOps` alongside
// the existing per-element `changes` array — extension only.

async function simulateDragDrop(page, sourceIdx, targetIdx, position = 'before') {
  return page.evaluate(({ srcIdx, tgtIdx, pos }) => {
    const thumbs = document.querySelectorAll('#wfp-editor-root .wfpe-overview-thumb');
    const src = thumbs[srcIdx];
    const tgt = thumbs[tgtIdx];
    if (!src || !tgt) throw new Error(`thumbs missing src=${!!src} tgt=${!!tgt}`);
    const tgtRect = tgt.getBoundingClientRect();
    const x = pos === 'before' ? tgtRect.left + 4 : tgtRect.right - 4;
    const y = tgtRect.top + tgtRect.height / 2;
    const dt = new DataTransfer();
    src.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt }));
    tgt.dispatchEvent(new DragEvent('dragenter', { bubbles: true, cancelable: true, clientX: x, clientY: y, dataTransfer: dt }));
    tgt.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, clientX: x, clientY: y, dataTransfer: dt }));
    tgt.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, clientX: x, clientY: y, dataTransfer: dt }));
    src.dispatchEvent(new DragEvent('dragend', { bubbles: true, cancelable: true, dataTransfer: dt }));
  }, { srcIdx: sourceIdx, tgtIdx: targetIdx, pos: position });
}

async function getSlideOrder(page) {
  return page.evaluate(() =>
    [...document.querySelectorAll('.deck > .slide')].map((s) => s.id)
  );
}

test.describe('v2.1.3 — Drag to reorder', () => {
  test('overview thumbs are draggable while overview is on', async ({ page }) => {
    await loadFixtureWithEditor(page, 'Townhall-1.html');
    await page.keyboard.press('o');
    await page.waitForFunction(() => {
      return document.querySelectorAll('#wfp-editor-root .wfpe-overview-thumb').length > 0;
    });

    const states = await page.evaluate(() =>
      [...document.querySelectorAll('#wfp-editor-root .wfpe-overview-thumb')]
        .map((t) => t.draggable)
    );
    expect(states.length).toBeGreaterThan(0);
    for (const d of states) expect(d).toBe(true);
  });

  test('dragging slide 3 to before slide 1 reorders the deck', async ({ page }) => {
    await loadFixtureWithEditor(page, 'Townhall-1.html');
    await page.keyboard.press('o');
    await page.waitForFunction(() => {
      return document.querySelectorAll('#wfp-editor-root .wfpe-overview-thumb').length > 0;
    });

    const before = await getSlideOrder(page);
    expect(before[0]).toBe('s0');
    expect(before[2]).toBe('s2');

    // Drag thumb at index 2 (slide s2) onto thumb at index 0 (slide s0),
    // dropping in the LEFT half so it inserts before s0.
    await simulateDragDrop(page, 2, 0, 'before');

    const after = await getSlideOrder(page);
    // s2 moved to position 0; s0 and s1 shift right.
    expect(after[0]).toBe('s2');
    expect(after[1]).toBe('s0');
    expect(after[2]).toBe('s1');
    // Tail unchanged.
    expect(after.slice(3)).toEqual(before.slice(3));
  });

  test('dropping in the right half of a target inserts after it', async ({ page }) => {
    await loadFixtureWithEditor(page, 'Townhall-1.html');
    await page.keyboard.press('o');
    await page.waitForFunction(() => {
      return document.querySelectorAll('#wfp-editor-root .wfpe-overview-thumb').length > 0;
    });

    // Drag s0 onto right half of s3 → insert after s3 → [s1, s2, s3, s0, s4, ...]
    await simulateDragDrop(page, 0, 3, 'after');

    const after = await getSlideOrder(page);
    expect(after.slice(0, 4)).toEqual(['s1', 's2', 's3', 's0']);
  });

  test('the active slide stays active in its new position after a drag', async ({ page }) => {
    await loadFixtureWithEditor(page, 'Townhall-1.html');
    // Make slide 2 (s2) active before entering overview.
    await page.evaluate(() => {
      document.querySelectorAll('.slide').forEach((s, i) => s.classList.toggle('active', i === 2));
    });
    await page.keyboard.press('o');
    await page.waitForFunction(() => {
      return document.querySelectorAll('#wfp-editor-root .wfpe-overview-thumb').length > 0;
    });

    // Drag s2 (idx 2) to before s0 (idx 0). After: [s2 active, s0, s1, s3, ...]
    await simulateDragDrop(page, 2, 0, 'before');

    const result = await page.evaluate(() => {
      const slides = [...document.querySelectorAll('.deck > .slide')];
      return {
        firstId: slides[0].id,
        firstIsActive: slides[0].classList.contains('active'),
        activeIds: slides.filter((s) => s.classList.contains('active')).map((s) => s.id),
      };
    });
    expect(result.firstId).toBe('s2');
    expect(result.firstIsActive).toBe(true);
    expect(result.activeIds).toEqual(['s2']);
  });

  test('one drag = one history entry; Cmd+Z restores the original order', async ({ page }) => {
    await loadFixtureWithEditor(page, 'Townhall-1.html');
    await page.keyboard.press('o');
    await page.waitForFunction(() => {
      return document.querySelectorAll('#wfp-editor-root .wfpe-overview-thumb').length > 0;
    });

    const original = await getSlideOrder(page);
    await simulateDragDrop(page, 4, 0, 'before');
    const reordered = await getSlideOrder(page);
    expect(reordered).not.toEqual(original);

    // Cmd+Z (or Ctrl+Z) — fixture-agnostic via metaKey on Mac, ctrlKey elsewhere.
    await page.keyboard.press('Meta+z');

    const restored = await getSlideOrder(page);
    expect(restored).toEqual(original);
  });

  test('Cmd+Shift+Z re-applies the reorder', async ({ page }) => {
    await loadFixtureWithEditor(page, 'Townhall-1.html');
    await page.keyboard.press('o');
    await page.waitForFunction(() => {
      return document.querySelectorAll('#wfp-editor-root .wfpe-overview-thumb').length > 0;
    });

    const original = await getSlideOrder(page);
    await simulateDragDrop(page, 4, 0, 'before');
    const afterDrag = await getSlideOrder(page);

    await page.keyboard.press('Meta+z'); // undo
    expect(await getSlideOrder(page)).toEqual(original);

    await page.keyboard.press('Meta+Shift+z'); // redo
    expect(await getSlideOrder(page)).toEqual(afterDrag);
  });

  test('dropping a slide on itself is a no-op (no DOM change, no history entry)', async ({ page }) => {
    await loadFixtureWithEditor(page, 'Townhall-1.html');
    await page.keyboard.press('o');
    await page.waitForFunction(() => {
      return document.querySelectorAll('#wfp-editor-root .wfpe-overview-thumb').length > 0;
    });

    const before = await getSlideOrder(page);
    await simulateDragDrop(page, 3, 3, 'before');
    const after = await getSlideOrder(page);
    expect(after).toEqual(before);

    // Cmd+Z should be a no-op (no entry to undo). Order should still be `before`.
    await page.keyboard.press('Meta+z');
    expect(await getSlideOrder(page)).toEqual(before);
  });

  test('overview stays on after a reorder (drag does not exit overview)', async ({ page }) => {
    await loadFixtureWithEditor(page, 'Townhall-1.html');
    await page.keyboard.press('o');
    await page.waitForFunction(() => document.body.dataset.wfpEditOverview === 'on');

    await simulateDragDrop(page, 2, 0, 'before');

    const stillOn = await page.evaluate(() => document.body.dataset.wfpEditOverview === 'on');
    expect(stillOn).toBe(true);
  });

  test('overlay rebuilds after a reorder so badge numbers reflect the new positions', async ({ page }) => {
    await loadFixtureWithEditor(page, 'Townhall-1.html');
    await page.keyboard.press('o');
    await page.waitForFunction(() => {
      return document.querySelectorAll('#wfp-editor-root .wfpe-overview-thumb').length > 0;
    });

    await simulateDragDrop(page, 4, 0, 'before');
    // Wait for the rebuild rAF (or synchronous rebuild) to settle.
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

    const labelOrder = await page.evaluate(() => {
      // Map each thumb's badge label (1-based) back to the slide id at
      // that position — they should be 1..N matching the new DOM order.
      return [...document.querySelectorAll('#wfp-editor-root .wfpe-overview-thumb')]
        .map((t) => ({
          label: t.querySelector('.wfpe-overview-badge').textContent,
          idx: t.dataset.wfpEditSlideIndex,
        }));
    });
    // Numbers must increment 1..N regardless of which slide is in which slot.
    expect(labelOrder.map((x) => x.label)).toEqual(labelOrder.map((_, i) => String(i + 1)));
    expect(labelOrder.map((x) => x.idx)).toEqual(labelOrder.map((_, i) => String(i)));
  });
});

// v2.1.4 — Delete slide. Strict TDD for logic; build-first for the
// hover-revealed × button visual. Each thumb carries a Liquid-Glass
// styled × button in its top-right corner. Clicking × deletes the
// corresponding slide; Backspace / Delete while a thumb is hovered
// (or focused) does the same. Last-slide guard with a toast. Active
// fallback per BRIEF. One delete = one history entry, undoable via
// the existing slideOps machinery (extends with type 'delete').

const deleteBtnSel = '#wfp-editor-root .wfpe-overview-delete';

// Keep this helper even though the overview grid is now responsive: some
// interactions run after scroll/resize and should target the live thumb rect.
async function hoverThumb(page, idx) {
  const thumb = page.locator('#wfp-editor-root .wfpe-overview-thumb').nth(idx);
  await thumb.scrollIntoViewIfNeeded();
  await thumb.hover();
  return thumb;
}

async function deleteThumbViaButton(page, idx) {
  const thumb = await hoverThumb(page, idx);
  const btn = thumb.locator('.wfpe-overview-delete');
  await btn.waitFor({ state: 'visible' });
  await btn.click();
}

test.describe('v2.1.4 — Delete slide', () => {
  // Widen this describe so real hover/click can land on every thumb in
  // the deck without vertical scrolling becoming part of the assertion.
  test.use({ viewport: { width: 1920, height: 1080 } });

  test('each thumb has a × button (hidden by default, revealed on hover)', async ({ page }) => {
    await loadFixtureWithEditor(page, 'Townhall-1.html');
    await page.keyboard.press('o');
    await page.waitForFunction(() => {
      return document.querySelectorAll('#wfp-editor-root .wfpe-overview-thumb').length > 0;
    });

    const slideCount = await page.locator('.deck > .slide').count();
    const buttonCount = await page.locator(deleteBtnSel).count();
    expect(buttonCount).toBe(slideCount);

    // Default state: hidden.
    const firstBtnDisplay = await page.locator(deleteBtnSel).first().evaluate((el) => getComputedStyle(el).display);
    expect(firstBtnDisplay).toBe('none');

    // Hover a thumb → its × becomes visible.
    const hovered = await hoverThumb(page, 2);
    const hoveredBtnDisplay = await hovered
      .locator('.wfpe-overview-delete')
      .evaluate((el) => getComputedStyle(el).display);
    expect(hoveredBtnDisplay).not.toBe('none');
  });

  test('clicking × deletes the slide and rebuilds the overlay', async ({ page }) => {
    await loadFixtureWithEditor(page, 'Townhall-1.html');
    await page.keyboard.press('o');
    await page.waitForFunction(() => {
      return document.querySelectorAll('#wfp-editor-root .wfpe-overview-thumb').length > 0;
    });

    const beforeCount = await page.locator('.deck > .slide').count();
    const beforeIds = await getSlideOrder(page);

    await deleteThumbViaButton(page, 2);
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

    const afterCount = await page.locator('.deck > .slide').count();
    const afterIds = await getSlideOrder(page);
    const overlayCount = await page.locator('#wfp-editor-root .wfpe-overview-thumb').count();

    expect(afterCount).toBe(beforeCount - 1);
    expect(beforeIds).toContain('s2');
    expect(afterIds).not.toContain('s2');
    expect(overlayCount).toBe(afterCount);
  });

  test('Backspace while hovering a thumb deletes that slide', async ({ page }) => {
    await loadFixtureWithEditor(page, 'Townhall-1.html');
    await page.keyboard.press('o');
    await page.waitForFunction(() => {
      return document.querySelectorAll('#wfp-editor-root .wfpe-overview-thumb').length > 0;
    });

    await hoverThumb(page, 4);
    await page.keyboard.press('Backspace');

    const ids = await getSlideOrder(page);
    expect(ids).not.toContain('s4');
  });

  test('Delete key while hovering a thumb deletes that slide', async ({ page }) => {
    await loadFixtureWithEditor(page, 'Townhall-1.html');
    await page.keyboard.press('o');
    await page.waitForFunction(() => {
      return document.querySelectorAll('#wfp-editor-root .wfpe-overview-thumb').length > 0;
    });

    await hoverThumb(page, 1);
    await page.keyboard.press('Delete');

    const ids = await getSlideOrder(page);
    expect(ids).not.toContain('s1');
  });

  test('last-slide guard: deleting when only one slide remains is a no-op + toast appears', async ({ page }) => {
    await loadFixtureWithEditor(page, 'Townhall-1.html');

    // Trim the deck to exactly one slide before entering overview.
    await page.evaluate(() => {
      const deck = document.querySelector('.deck');
      const slides = [...deck.querySelectorAll(':scope > .slide')];
      for (let i = 1; i < slides.length; i++) deck.removeChild(slides[i]);
      slides[0].classList.add('active');
    });

    await page.keyboard.press('o');
    await page.waitForFunction(() => {
      return document.querySelectorAll('#wfp-editor-root .wfpe-overview-thumb').length > 0;
    });

    const beforeCount = await page.locator('.deck > .slide').count();
    expect(beforeCount).toBe(1);

    await deleteThumbViaButton(page, 0);

    const afterCount = await page.locator('.deck > .slide').count();
    expect(afterCount).toBe(1);

    const toastText = await page.locator('#wfp-editor-root .wfpe-toast').textContent();
    expect(toastText).toBe("Can't delete the last slide.");
  });

  test('active-slide fallback (mid-deck): deleting the active slide promotes the next slide to active', async ({ page }) => {
    await loadFixtureWithEditor(page, 'Townhall-1.html');
    // Slide s2 active, then delete it → s3 (which now occupies index 2) becomes active.
    await page.evaluate(() => {
      document.querySelectorAll('.slide').forEach((s, i) => s.classList.toggle('active', i === 2));
    });
    await page.keyboard.press('o');
    await page.waitForFunction(() => {
      return document.querySelectorAll('#wfp-editor-root .wfpe-overview-thumb').length > 0;
    });

    await deleteThumbViaButton(page, 2);

    const activeIds = await page.evaluate(() =>
      [...document.querySelectorAll('.slide.active')].map((s) => s.id)
    );
    expect(activeIds).toEqual(['s3']);
  });

  test('active-slide fallback (last in deck): falls back to the new last slide', async ({ page }) => {
    await loadFixtureWithEditor(page, 'Townhall-1.html');
    const slideCount = await page.locator('.deck > .slide').count();
    await page.evaluate((n) => {
      document.querySelectorAll('.slide').forEach((s, i) => s.classList.toggle('active', i === n - 1));
    }, slideCount);
    const expectedFallbackId = `s${slideCount - 2}`;

    await page.keyboard.press('o');
    await page.waitForFunction(() => {
      return document.querySelectorAll('#wfp-editor-root .wfpe-overview-thumb').length > 0;
    });

    await deleteThumbViaButton(page, slideCount - 1);

    const activeIds = await page.evaluate(() =>
      [...document.querySelectorAll('.slide.active')].map((s) => s.id)
    );
    expect(activeIds).toEqual([expectedFallbackId]);
  });

  test('one delete = one history entry; Cmd+Z restores the slide at its original position', async ({ page }) => {
    await loadFixtureWithEditor(page, 'Townhall-1.html');
    await page.keyboard.press('o');
    await page.waitForFunction(() => {
      return document.querySelectorAll('#wfp-editor-root .wfpe-overview-thumb').length > 0;
    });

    const original = await getSlideOrder(page);
    // Use nth(2) instead of nth(3) — slide 4's thumb sits in the
    // top-right corner where the toolbar physically overlaps the ×.
    await deleteThumbViaButton(page, 2);
    const afterDelete = await getSlideOrder(page);
    expect(afterDelete).not.toEqual(original);
    expect(afterDelete).not.toContain('s2');

    await page.keyboard.press('Meta+z');

    const restored = await getSlideOrder(page);
    expect(restored).toEqual(original);
  });

  test('Cmd+Shift+Z re-deletes the slide', async ({ page }) => {
    await loadFixtureWithEditor(page, 'Townhall-1.html');
    await page.keyboard.press('o');
    await page.waitForFunction(() => {
      return document.querySelectorAll('#wfp-editor-root .wfpe-overview-thumb').length > 0;
    });

    await deleteThumbViaButton(page, 2);
    const afterDelete = await getSlideOrder(page);

    await page.keyboard.press('Meta+z');
    await page.keyboard.press('Meta+Shift+z');

    expect(await getSlideOrder(page)).toEqual(afterDelete);
  });

  test('overview stays on after a delete (only thumb click exits)', async ({ page }) => {
    await loadFixtureWithEditor(page, 'Townhall-1.html');
    await page.keyboard.press('o');
    await page.waitForFunction(() => document.body.dataset.wfpEditOverview === 'on');

    await deleteThumbViaButton(page, 2);

    const stillOn = await page.evaluate(() => document.body.dataset.wfpEditOverview === 'on');
    expect(stillOn).toBe(true);
  });
});

// v2.1.0 hotfix regressions — the WFP fixture's own keydown handler
// caches `slides` (via document.querySelectorAll) and `cur` at script
// load time. After overview reorder/delete, that cache is stale:
// forward nav lands on the wrong slide (reorder), or sets .active on
// an orphan node leaving every in-DOM slide display:none → black
// screen (delete). Editor takes over arrow nav once deckMutated.

test.describe('v2.1.0 hotfix — post-mutation arrow nav uses live DOM', () => {
  test.use({ viewport: { width: 1920, height: 1080 } });

  test('after a reorder + exit, ArrowRight advances to the new live-order successor (not the fixture\'s cached one)', async ({ page }) => {
    await loadFixtureWithEditor(page, 'Townhall-1.html');
    // Lock the deck transform so the fixture's resize handler doesn't
    // re-set anything mid-test.
    await page.evaluate(() => { document.querySelector('.deck').style.transform = 'scale(1)'; });

    await page.keyboard.press('o');
    await page.waitForFunction(() => document.body.dataset.wfpEditOverview === 'on');

    // Move s4 to position 0. Live order becomes [s4,s0,s1,s2,s3,s5,...].
    // s0 stays active (active follows the slide that was active, not
    // the position).
    await simulateDragDrop(page, 4, 0, 'before');
    await page.keyboard.press('o'); // exit overview
    await page.waitForFunction(() => !document.body.hasAttribute('data-wfp-edit-overview'));

    // s0 is the active slide (per BRIEF "active follows the moved slide").
    // s0 is at LIVE position 1. ArrowRight should advance to live position
    // 2, which is s1.
    await page.keyboard.press('ArrowRight');

    const activeId = await page.evaluate(() => document.querySelector('.slide.active').id);
    expect(activeId).toBe('s1');
  });

  test('after a delete + exit, ArrowRight never lands .active on an orphan (no black-screen state)', async ({ page }) => {
    await loadFixtureWithEditor(page, 'Townhall-1.html');
    await page.evaluate(() => { document.querySelector('.deck').style.transform = 'scale(1)'; });

    await page.keyboard.press('o');
    await page.waitForFunction(() => {
      return document.querySelectorAll('#wfp-editor-root .wfpe-overview-thumb').length > 0;
    });

    // Delete slide 3 (s2). After: live deck = [s0,s1,s3,s4,s5,...].
    const thumb = page.locator('#wfp-editor-root .wfpe-overview-thumb').nth(2);
    await thumb.scrollIntoViewIfNeeded();
    await thumb.hover();
    await page.keyboard.press('Backspace');

    // Exit overview.
    await page.keyboard.press('o');
    await page.waitForFunction(() => !document.body.hasAttribute('data-wfp-edit-overview'));

    // Walk forward through every remaining slide. With the fixture's
    // stale handler, the third ArrowRight would call
    // slides[2].classList.add('active') on the orphan s2 → no in-DOM
    // .active → black screen. Editor's takeover keeps .active in the
    // live deck on every step.
    const liveCount = await page.locator('.deck > .slide').count();
    for (let i = 1; i < liveCount; i++) {
      await page.keyboard.press('ArrowRight');
      const state = await page.evaluate(() => {
        const slides = [...document.querySelectorAll('.deck > .slide')];
        const inDomActive = slides.filter((s) => s.classList.contains('active'));
        const orphanActive = [...document.querySelectorAll('.slide.active')]
          .filter((s) => !document.contains(s));
        return {
          inDomActiveCount: inDomActive.length,
          orphanActiveCount: orphanActive.length,
          activeId: inDomActive[0] ? inDomActive[0].id : null,
        };
      });
      expect(state.inDomActiveCount).toBe(1);
      expect(state.orphanActiveCount).toBe(0);
      expect(state.activeId).not.toBe('s2'); // s2 was deleted; never visible again
    }
  });

  test('with no overview mutation, the fixture\'s own arrow nav still owns ArrowRight (deckMutated stays off)', async ({ page }) => {
    await loadFixtureWithEditor(page, 'Townhall-1.html');
    await page.evaluate(() => { document.querySelector('.deck').style.transform = 'scale(1)'; });

    // Enter+exit overview WITHOUT any mutation.
    await page.keyboard.press('o');
    await page.waitForFunction(() => document.body.dataset.wfpEditOverview === 'on');
    await page.keyboard.press('o');
    await page.waitForFunction(() => !document.body.hasAttribute('data-wfp-edit-overview'));

    // ArrowRight should still flow to the fixture's own handler. Since
    // s0 is active by default, the fixture should advance to s1 via
    // its own goTo(1).
    await page.keyboard.press('ArrowRight');
    const activeId = await page.evaluate(() => document.querySelector('.slide.active').id);
    expect(activeId).toBe('s1');
  });
});

// v2.1.5 — Export round-trip. Strict TDD.
// Reorders + deletes persist in exported HTML. Overview UI is stripped
// from the export (no data-wfp-edit-overview attribute, no editor root,
// no overview CSS classes leaked onto slides). The exported HTML opens
// in normal slide view (overview mode is editor-only — not preserved
// by the v1 export contract).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirnameV215 = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR_V215 = path.join(__dirnameV215, 'output');

async function triggerExport(page) {
  const downloadPromise = page.waitForEvent('download', { timeout: 8_000 });
  await page.keyboard.press('ControlOrMeta+s');
  return downloadPromise;
}

async function readExportedHtml(download) {
  fs.mkdirSync(OUTPUT_DIR_V215, { recursive: true });
  const out = path.join(
    OUTPUT_DIR_V215,
    `${Date.now()}-${Math.random().toString(16).slice(2)}-${download.suggestedFilename()}`,
  );
  await download.saveAs(out);
  return fs.readFileSync(out, 'utf-8');
}

function extractSlideIdsFromHtml(html) {
  // Pull slide ids in document order from the exported HTML. The
  // fixtures use id="s0" through "s8" on each .slide.
  const ids = [];
  const re = /<div\s+class="slide(?:\s+active)?"\s+id="(s\d+)"/g;
  let m;
  while ((m = re.exec(html)) !== null) ids.push(m[1]);
  return ids;
}

function extractActiveSlideIdsFromHtml(html) {
  const ids = [];
  const re = /<div\s+class="([^"]*\bslide\b[^"]*)"[^>]*id="(s\d+)"/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const classes = m[1].split(/\s+/);
    if (classes.includes('active')) ids.push(m[2]);
  }
  return ids;
}

test.describe('v2.1.5 — Export round-trip', () => {
  test.use({ viewport: { width: 1920, height: 1080 } });

  test('reorder persists in the exported HTML (slides appear in the new order)', async ({ page }) => {
    await loadFixtureWithEditor(page, 'Townhall-1.html');
    await page.keyboard.press('o');
    await page.waitForFunction(() => {
      return document.querySelectorAll('#wfp-editor-root .wfpe-overview-thumb').length > 0;
    });

    // Move s4 to position 0.
    await simulateDragDrop(page, 4, 0, 'before');
    const liveOrder = await getSlideOrder(page);

    const download = await triggerExport(page);
    const html = await readExportedHtml(download);

    const exportedOrder = extractSlideIdsFromHtml(html);
    expect(exportedOrder).toEqual(liveOrder);
    // Sanity: s4 is now at position 0 in the exported file.
    expect(exportedOrder[0]).toBe('s4');
    expect(extractActiveSlideIdsFromHtml(html)).toEqual(['s4']);
  });

  test('delete persists in the exported HTML (deleted slide is gone)', async ({ page }) => {
    await loadFixtureWithEditor(page, 'Townhall-1.html');
    await page.keyboard.press('o');
    await page.waitForFunction(() => {
      return document.querySelectorAll('#wfp-editor-root .wfpe-overview-thumb').length > 0;
    });

    await deleteThumbViaButton(page, 2);
    const liveOrder = await getSlideOrder(page);

    const download = await triggerExport(page);
    const html = await readExportedHtml(download);

    const exportedOrder = extractSlideIdsFromHtml(html);
    expect(exportedOrder).toEqual(liveOrder);
    expect(exportedOrder).not.toContain('s2');
    expect(exportedOrder.length).toBe(liveOrder.length);
  });

  test('exported HTML carries no overview chrome (no body data-wfp-edit-overview, no editor root, no wfpe-* classes on slides)', async ({ page }) => {
    await loadFixtureWithEditor(page, 'Townhall-1.html');
    await page.keyboard.press('o');
    await page.waitForFunction(() => {
      return document.querySelectorAll('#wfp-editor-root .wfpe-overview-thumb').length > 0;
    });

    const download = await triggerExport(page);
    const html = await readExportedHtml(download);

    // Body marker stripped.
    expect(html).not.toMatch(/<body[^>]*data-wfp-edit-overview/);
    expect(html).not.toMatch(/data-wfp-edit-overview/);
    // No editor root.
    expect(html).not.toContain('id="wfp-editor-root"');
    // No overview overlay markers.
    expect(html).not.toContain('wfpe-overview-thumb');
    expect(html).not.toContain('wfpe-overview-overlay');
    expect(html).not.toContain('wfpe-overview-delete');
    expect(html).not.toContain('wfpe-overview-badge');
    expect(html).not.toContain('wfpe-overview-drop-indicator');
    // No data-wfp-edit-* anywhere.
    expect(html).not.toMatch(/data-wfp-edit/);
  });

  test('exported HTML preserves the original .deck rendering (no overview override leaks)', async ({ page }) => {
    await loadFixtureWithEditor(page, 'Townhall-1.html');
    await page.keyboard.press('o');
    await page.waitForFunction(() => document.body.dataset.wfpEditOverview === 'on');

    const download = await triggerExport(page);
    const html = await readExportedHtml(download);

    // The fixture's own .deck { transform-origin: top left; } is
    // declared in the fixture CSS — should still be there. Our
    // overview override `transform: none !important` lived in the
    // editor's style tag, which is removed with the editor root.
    expect(html).toMatch(/transform-origin\s*:\s*top\s+left/);
    // Slides themselves never received the overview transform — but
    // be defensive: there shouldn't be a runaway "scale(0.22)" inline
    // style on any slide in the export.
    expect(html).not.toMatch(/<div[^>]*class="slide[^"]*"[^>]*style="[^"]*scale\(0\.22\)/);
  });

  test('export-while-overview produces the same slide-id order as export-after-exit-overview', async ({ page }) => {
    await loadFixtureWithEditor(page, 'Townhall-1.html');
    await page.keyboard.press('o');
    await page.waitForFunction(() => {
      return document.querySelectorAll('#wfp-editor-root .wfpe-overview-thumb').length > 0;
    });

    // Reorder + delete to make a non-trivial diff. Use idx 2 for the
    // delete — idx 3 (top-row col 4) sits under the toolbar at 1920px.
    await simulateDragDrop(page, 4, 0, 'before');
    await deleteThumbViaButton(page, 2);

    const inOverviewDownload = await triggerExport(page);
    const inOverviewHtml = await readExportedHtml(inOverviewDownload);
    const inOverviewIds = extractSlideIdsFromHtml(inOverviewHtml);

    // Exit overview, export again. Edit mode hasn't been turned on
    // (export Cmd+S works in overview per v2.1.3 gate widening).
    await page.keyboard.press('o');
    await page.waitForFunction(() => !document.body.hasAttribute('data-wfp-edit-overview'));
    // Toggle edit mode on so Cmd+S export still fires (post-overview gate).
    await page.keyboard.press('e');

    const outOverviewDownload = await triggerExport(page);
    const outOverviewHtml = await readExportedHtml(outOverviewDownload);
    const outOverviewIds = extractSlideIdsFromHtml(outOverviewHtml);

    expect(inOverviewIds).toEqual(outOverviewIds);
  });

  test('undoing a delete then exporting includes the restored slide in the right position', async ({ page }) => {
    await loadFixtureWithEditor(page, 'Townhall-1.html');
    await page.keyboard.press('o');
    await page.waitForFunction(() => {
      return document.querySelectorAll('#wfp-editor-root .wfpe-overview-thumb').length > 0;
    });

    const original = await getSlideOrder(page);
    await deleteThumbViaButton(page, 2);
    await page.keyboard.press('Meta+z'); // undo the delete

    const liveOrder = await getSlideOrder(page);
    expect(liveOrder).toEqual(original);

    const download = await triggerExport(page);
    const html = await readExportedHtml(download);
    const exportedOrder = extractSlideIdsFromHtml(html);
    expect(exportedOrder).toEqual(original);
  });
});

test.describe('v2.1.1 — Overview grid layout (no-editor baseline)', () => {
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
