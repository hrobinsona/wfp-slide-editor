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
    await page.locator('.deck > .slide').nth(slideCount - 1).click({ force: true });

    const activeIds = await page.evaluate(() =>
      [...document.querySelectorAll('.slide.active')].map((s) => s.id)
    );
    expect(activeIds.length).toBe(1);
    // s0..s8 — last is s(slideCount-1).
    expect(activeIds[0]).toBe(`s${slideCount - 1}`);
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
