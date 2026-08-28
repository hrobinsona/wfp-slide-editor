import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect } from '@playwright/test';
import { pathToFileURL } from 'node:url';
import { loadFixtureWithEditor, disableFsa, EDITOR_PATH, PROJECT_ROOT } from './_helpers.js';

const OUTPUT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'output');

// foreign-deck.html roots on `.presentation`, not `.deck`, so it cannot go
// through loadFixtureWithEditor (which waits on `.deck`). Same recipe as
// tests/v2-0-toolbar.spec.js.
async function loadForeignDeck(page) {
  const file = path.join(PROJECT_ROOT, 'fixtures', CONTROL);
  await page.goto(pathToFileURL(file).href);
  await page.locator('.slide.active').first().waitFor({ state: 'attached', timeout: 10_000 });
  await page.addScriptTag({ path: EDITOR_PATH });
  await page.waitForFunction(() => window.__wfpEditorReady === true, null, { timeout: 10_000 });
}

// v2.23 — host deck compatibility.
//
// `fixtures/pointer-nav-deck.html` reproduces the two traits of a real deck
// the editor could not edit at all:
//
//   1. the visible slide is marked `is-active`, not `active`
//   2. the deck pages on `pointerup`, which fires BEFORE `click`
//
// Trait 2 dominates trait 1: with the deck still paging out from under the
// gesture, recognising the token changes nothing observable. Both are covered
// here, plus the `.active` control so the fix stays additive.

const FIXTURE = 'pointer-nav-deck.html';
const CONTROL = 'foreign-deck.html';

// The deck's own state, read through its own token — never the editor's.
async function visibleSlideIndex(page, token = 'is-active') {
  return page.evaluate(
    (t) => [...document.querySelectorAll('.deck > .slide, .presentation > .slide')]
      .findIndex((s) => s.classList.contains(t)),
    token,
  );
}

async function ringDisplay(page) {
  return page.evaluate(() => {
    const ring = document.querySelector('#wfp-editor-root .wfpe-selection-ring');
    return ring ? ring.style.display || 'none' : 'missing';
  });
}

// A real pointer gesture — pointerdown/pointerup/click — on the centre of a
// visible element. A synthetic MouseEvent('click') would never fire pointerup
// and so would not exercise the defect at all.
async function realClickOn(page, selector) {
  const box = await page.locator(selector).boundingBox();
  if (!box) throw new Error(`No box for ${selector}`);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

test.describe('v2.23 — deck marks its active slide `is-active`', () => {
  test('clicking an element on the visible slide selects it in edit mode', async ({ page }) => {
    await loadFixtureWithEditor(page, FIXTURE);
    await page.keyboard.press('e');

    await realClickOn(page, '#pointer-slide-1 .deck-title');

    expect(await ringDisplay(page)).toBe('block');
  });

  test('the inspector opens for the selected element', async ({ page }) => {
    await loadFixtureWithEditor(page, FIXTURE);
    await page.keyboard.press('e');

    await realClickOn(page, '#pointer-slide-1 .deck-title');

    await expect(
      page.locator('#wfp-editor-root .wfpe-inspector-dock'),
    ).toHaveAttribute('data-visible', 'true');
  });
});

test.describe('v2.23 — deck pages on pointerup', () => {
  test('an edit-mode click does not advance the deck', async ({ page }) => {
    await loadFixtureWithEditor(page, FIXTURE);
    await page.keyboard.press('e');
    const before = await visibleSlideIndex(page);

    await realClickOn(page, '#pointer-slide-1 .deck-title');

    expect(await visibleSlideIndex(page)).toBe(before);
  });

  test('a drag in edit mode does not advance the deck', async ({ page }) => {
    await loadFixtureWithEditor(page, FIXTURE);
    await page.keyboard.press('e');
    await realClickOn(page, '#pointer-slide-1 .deck-title');
    const before = await visibleSlideIndex(page);

    const box = await page.locator('#pointer-slide-1 .deck-title').boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 80, box.y + box.height / 2 + 60, { steps: 8 });
    await page.mouse.up();

    expect(await visibleSlideIndex(page)).toBe(before);
  });

  test('with edit mode OFF the deck still pages on click', async ({ page }) => {
    await loadFixtureWithEditor(page, FIXTURE);
    // Right half advances; the fixture wraps, so slide 0 -> slide 1.
    const box = await page.locator('#pointer-slide-1 .deck-title').boundingBox();
    const x = Math.max(box.x + box.width / 2, page.viewportSize().width / 2 + 40);

    await page.mouse.click(x, box.y + box.height / 2);

    expect(await visibleSlideIndex(page)).toBe(1);
  });

  test('leaving edit mode hands pointer navigation back to the deck', async ({ page }) => {
    await loadFixtureWithEditor(page, FIXTURE);
    await page.keyboard.press('e');
    await page.keyboard.press('e');

    const box = await page.locator('#pointer-slide-1 .deck-title').boundingBox();
    const x = Math.max(box.x + box.width / 2, page.viewportSize().width / 2 + 40);
    await page.mouse.click(x, box.y + box.height / 2);

    expect(await visibleSlideIndex(page)).toBe(1);
  });
});

test.describe('v2.23 — editor slide writes use the deck\'s own token', () => {
  test('an overview thumbnail click changes the VISIBLE slide', async ({ page }) => {
    await loadFixtureWithEditor(page, FIXTURE);
    await page.keyboard.press('o');
    await page.waitForFunction(
      () => document.querySelectorAll('#wfp-editor-root .wfpe-overview-thumb').length === 4,
    );

    await page
      .locator('#wfp-editor-root .wfpe-overview-thumb[data-wfp-edit-slide-index="2"]')
      .click();

    expect(await visibleSlideIndex(page)).toBe(2);
  });

  test('the editor does not stamp a foreign `active` class on the deck', async ({ page }) => {
    await loadFixtureWithEditor(page, FIXTURE);
    await page.keyboard.press('o');
    await page.waitForFunction(
      () => document.querySelectorAll('#wfp-editor-root .wfpe-overview-thumb').length === 4,
    );
    await page
      .locator('#wfp-editor-root .wfpe-overview-thumb[data-wfp-edit-slide-index="2"]')
      .click();

    const strays = await page.evaluate(
      () => [...document.querySelectorAll('.deck > .slide')]
        .filter((s) => s.classList.contains('active')).length,
    );
    expect(strays).toBe(0);
  });

  test('export normalizes to the first slide using the deck\'s own token', async ({ page }) => {
    await disableFsa(page);
    await loadFixtureWithEditor(page, FIXTURE);
    await page.keyboard.press('e');
    // Move the deck off slide 1 with its own control before exporting.
    await page.evaluate(() => window.pointerFixtureShow(2));
    expect(await visibleSlideIndex(page)).toBe(2);

    const downloadPromise = page.waitForEvent('download', { timeout: 10_000 });
    await page.keyboard.press('ControlOrMeta+s');
    const download = await downloadPromise;

    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    const out = path.join(
      OUTPUT_DIR,
      `${Date.now()}-${Math.random().toString(16).slice(2)}-${download.suggestedFilename()}`,
    );
    await download.saveAs(out);
    const content = fs.readFileSync(out, 'utf8');

    // Exactly one slide element carries the deck's token, and it is slide 1.
    // Counting raw occurrences would also match the fixture's CSS rule and its
    // own navigation script, so match slide tags specifically.
    const slideTags = content.match(/<section[^>]*\bclass="slide[^"]*"[^>]*>/g) || [];
    expect(slideTags).toHaveLength(4);
    expect(slideTags.filter((t) => /\bis-active\b/.test(t))).toHaveLength(1);
    expect(slideTags[0]).toContain('id="pointer-slide-1"');
    expect(slideTags[0]).toContain('is-active');
    // And no foreign `active` token was stamped on any slide.
    expect(slideTags.filter((t) => /\bactive\b/.test(t.replace(/is-active/g, '')))).toHaveLength(0);

    // The live deck is untouched by the export.
    expect(await visibleSlideIndex(page)).toBe(2);
  });
});

test.describe('v2.23 — overview on a deck that wraps its canvas', () => {
  // The fixture mounts <main class="stage"><section class="deck">, matching
  // the real deck. Overview hid every body-level sibling of the deck root,
  // which caught the wrapper and collapsed the whole deck to 0x0.
  test('the deck still has layout in overview mode', async ({ page }) => {
    await loadFixtureWithEditor(page, FIXTURE);
    await page.keyboard.press('o');
    await page.waitForFunction(
      () => document.querySelectorAll('#wfp-editor-root .wfpe-overview-thumb').length === 4,
    );

    const size = await page.evaluate(() => {
      const deck = document.querySelector('[data-wfp-edit-deck-root]');
      const r = deck.getBoundingClientRect();
      return { w: r.width, h: r.height };
    });

    expect(size.w).toBeGreaterThan(0);
    expect(size.h).toBeGreaterThan(0);
  });

  test('every thumbnail is actually clickable, not zero-sized', async ({ page }) => {
    await loadFixtureWithEditor(page, FIXTURE);
    await page.keyboard.press('o');
    await page.waitForFunction(
      () => document.querySelectorAll('#wfp-editor-root .wfpe-overview-thumb').length === 4,
    );

    for (let i = 0; i < 4; i += 1) {
      await expect(
        page.locator(`#wfp-editor-root .wfpe-overview-thumb[data-wfp-edit-slide-index="${i}"]`),
      ).toBeVisible();
    }
  });

  test('the wrapper marker never reaches the export', async ({ page }) => {
    await disableFsa(page);
    await loadFixtureWithEditor(page, FIXTURE);
    await page.keyboard.press('e');

    const downloadPromise = page.waitForEvent('download', { timeout: 10_000 });
    await page.keyboard.press('ControlOrMeta+s');
    const download = await downloadPromise;

    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    const out = path.join(
      OUTPUT_DIR,
      `${Date.now()}-${Math.random().toString(16).slice(2)}-${download.suggestedFilename()}`,
    );
    await download.saveAs(out);
    const content = fs.readFileSync(out, 'utf8');

    expect(content).not.toContain('data-wfp-edit-deck-ancestor');
    expect(/<[^>]*\sdata-wfp-edit[-a-zA-Z]*\s*=/.test(content)).toBe(false);
  });
});

// v2.24 — entrance animations in overview.
//
// The fixture gates `.reveal` on `.slide.is-active`, like the real deck. Only
// one slide is ever active, so in a grid every other thumbnail renders empty
// unless the deck's own rule is made to fire. The WFP template opts out via
// `body[data-wfp-edit-overview="on"]`, but that is a convention, not a
// contract — the editor must not depend on the host cooperating.
test.describe('v2.24 — entrance-gated content renders in overview', () => {
  async function openOverview(page) {
    await page.keyboard.press('o');
    await page.waitForFunction(
      () => document.querySelectorAll('#wfp-editor-root .wfpe-overview-thumb').length === 4,
    );
    // Entrance rules are transitions; give them time to land.
    await page.waitForTimeout(600);
  }

  const revealOpacities = (page) => page.evaluate(
    () => [...document.querySelectorAll('.deck > .slide')].map((slide) => [
      ...new Set([...slide.querySelectorAll('.reveal')].map((el) => getComputedStyle(el).opacity)),
    ]),
  );

  test('reveal-gated content is visible on EVERY thumbnail, not just the active slide', async ({ page }) => {
    await loadFixtureWithEditor(page, FIXTURE);
    await openOverview(page);

    const perSlide = await revealOpacities(page);
    expect(perSlide).toHaveLength(4);
    for (const opacities of perSlide) {
      expect(opacities).toEqual(['1']);
    }
  });

  test('leaving overview restores the entrance gating to the active slide alone', async ({ page }) => {
    await loadFixtureWithEditor(page, FIXTURE);
    await openOverview(page);
    await page.keyboard.press('o');
    await page.waitForFunction(() => !document.body.hasAttribute('data-wfp-edit-overview'));
    await page.waitForTimeout(400);

    const state = await page.evaluate(() => {
      const slides = [...document.querySelectorAll('.deck > .slide')];
      // Count what the entrance element actually holds. A selector-text
      // pattern would miss any emission that does not match the pattern.
      const entranceEl = document.querySelector(
        '#wfp-editor-root style[data-wfp-edit-style="overview-entrance"]',
      );
      const injectedRules = entranceEl && entranceEl.sheet
        ? entranceEl.sheet.cssRules.length
        : -1;
      return {
        activeCount: slides.filter((s) => s.classList.contains('is-active')).length,
        activeIndex: slides.findIndex((s) => s.classList.contains('is-active')),
        injectedRules,
        hiddenReveals: slides.slice(1).flatMap((s) =>
          [...s.querySelectorAll('.reveal')].map((el) => getComputedStyle(el).opacity)),
      };
    });
    expect(state.activeCount).toBe(1);
    expect(state.activeIndex).toBe(0);
    expect(state.injectedRules).toBe(0);
    expect(new Set(state.hiddenReveals)).toEqual(new Set(['0']));
  });

  // The regression that killed the first attempt at this fix: lending the
  // deck's own active class to every slide drives cooperative decks' own
  // navigation (Townhall's observeDeck() calls activate() on any external
  // .active it sees). Whatever mechanism renders the thumbnails, it must not
  // touch slide classes at all.
  test('overview does not mutate any slide class', async ({ page }) => {
    await loadFixtureWithEditor(page, FIXTURE);

    // Sampling before/after would miss a transient stamp that a host observer
    // reacts to and reverts — which is exactly how the rejected approach
    // failed. Record every class mutation across the whole cycle instead.
    await page.evaluate(() => {
      window.__slideClassMutations = [];
      new MutationObserver((records) => {
        for (const r of records) window.__slideClassMutations.push(r.target.id || '?');
      }).observe(document.querySelector('.deck'), {
        subtree: true, attributes: true, attributeFilter: ['class'],
      });
    });

    await openOverview(page);
    await page.keyboard.press('o');
    await page.waitForFunction(() => !document.body.hasAttribute('data-wfp-edit-overview'));

    const mutations = await page.evaluate(() => window.__slideClassMutations);
    expect(mutations).toEqual([]);
  });

  test('a thumbnail click still activates the slide that was clicked', async ({ page }) => {
    await loadFixtureWithEditor(page, FIXTURE);
    await openOverview(page);

    await page
      .locator('#wfp-editor-root .wfpe-overview-thumb[data-wfp-edit-slide-index="2"]')
      .click();
    await page.waitForFunction(() => !document.body.hasAttribute('data-wfp-edit-overview'));

    const state = await page.evaluate(() => {
      const slides = [...document.querySelectorAll('.deck > .slide')];
      return {
        activeIndex: slides.findIndex((s) => s.classList.contains('is-active')),
        activeCount: slides.filter((s) => s.classList.contains('is-active')).length,
      };
    });
    expect(state.activeIndex).toBe(2);
    expect(state.activeCount).toBe(1);
  });

  test('an export taken while overview is open still starts on the first slide', async ({ page }) => {
    await disableFsa(page);
    await loadFixtureWithEditor(page, FIXTURE);
    await page.keyboard.press('e');
    await page.evaluate(() => window.pointerFixtureShow(2));
    await openOverview(page);

    const downloadPromise = page.waitForEvent('download', { timeout: 10_000 });
    await page.keyboard.press('ControlOrMeta+s');
    const download = await downloadPromise;

    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    const out = path.join(
      OUTPUT_DIR,
      `${Date.now()}-${Math.random().toString(16).slice(2)}-${download.suggestedFilename()}`,
    );
    await download.saveAs(out);
    const content = fs.readFileSync(out, 'utf8');

    const slideTags = content.match(/<section[^>]*\bclass="slide[^"]*"[^>]*>/g) || [];
    expect(slideTags).toHaveLength(4);
    expect(slideTags.filter((t) => /\bis-active\b/.test(t))).toHaveLength(1);
    expect(slideTags[0]).toContain('is-active');
    // The re-scoped entrance rules are editor chrome and must not ship.
    expect(content).not.toContain('data-wfp-edit-overview="on"] .slide');
  });
});

test.describe('v2.23 — `.active` decks are unaffected', () => {
  test('selection still works on a deck that uses `active`', async ({ page }) => {
    await loadForeignDeck(page);
    await page.keyboard.press('e');

    await realClickOn(page, '#foreign-slide-1 .foreign-title');

    expect(await ringDisplay(page)).toBe('block');
  });

  test('overview navigation still works on a deck that uses `active`', async ({ page }) => {
    await loadForeignDeck(page);
    await page.keyboard.press('o');
    await page.waitForFunction(
      () => document.querySelectorAll('#wfp-editor-root .wfpe-overview-thumb').length === 4,
    );

    await page
      .locator('#wfp-editor-root .wfpe-overview-thumb[data-wfp-edit-slide-index="2"]')
      .click();

    expect(await visibleSlideIndex(page, 'active')).toBe(2);
  });
});
