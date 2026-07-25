import { test, expect } from '@playwright/test';
import { loadFixtureWithEditor } from './_helpers.js';

test.use({ viewport: { width: 2000, height: 1200 } });

async function setDeckScale(page, scale) {
  await page.evaluate((s) => {
    document.querySelector('.deck').style.transform = `scale(${s})`;
  }, scale);
}

// Find a flex/grid container inside the active slide that has at least 2
// flow-positioned children. Tag the container + first child for the test.
async function tagFlexTarget(page) {
  return page.evaluate(() => {
    const cs = (el) => getComputedStyle(el);
    const isFlex = (el) => {
      const d = cs(el).display;
      return d === 'flex' || d === 'inline-flex' || d === 'grid' || d === 'inline-grid';
    };
    const slide = document.querySelector('.slide.active');
    const containers = [...slide.querySelectorAll('*')].filter(
      (el) => isFlex(el) && el.children.length >= 2,
    );
    const cand = containers.find((c) =>
      [...c.children].every(
        (ch) => cs(ch).position !== 'absolute' && !ch.dataset.wfpEditFrozen,
      ),
    );
    if (!cand) return null;
    cand.dataset.testFlexParent = 'yes';
    cand.children[0].dataset.testFlexChild = 'first';
    return { childCount: cand.children.length };
  });
}

async function findFlexTargetSweepingSlides(page) {
  let target = await tagFlexTarget(page);
  let attempts = 0;
  while (!target && attempts < 8) {
    attempts++;
    await page.evaluate((i) => window.goTo && window.goTo(i), attempts);
    await page.waitForTimeout(50);
    target = await tagFlexTarget(page);
  }
  return target;
}

test.describe('Flex/grid sibling freeze on first grab', () => {
  test('dragging a flex child does not shift its siblings', async ({ page }) => {
    await loadFixtureWithEditor(page, 'Townhall-1.html');
    await setDeckScale(page, 1);
    await page.keyboard.press('e');

    const target = await findFlexTargetSweepingSlides(page);
    expect(target, 'no flex container with multiple flow children found in any slide').not.toBeNull();

    // Snapshot every sibling's pre-drag rect.
    const beforeRects = await page.evaluate(() => {
      const parent = document.querySelector('[data-test-flex-parent="yes"]');
      return [...parent.children].map((c, i) => {
        const r = c.getBoundingClientRect();
        return { i, top: r.top, left: r.left, width: r.width, height: r.height };
      });
    });
    expect(beforeRects.length).toBeGreaterThanOrEqual(2);

    // Drag from the first child by 40 viewport px right.
    const center = await page.evaluate(() => {
      const c = document.querySelector('[data-test-flex-child="first"]');
      const r = c.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });
    await page.mouse.move(center.x, center.y);
    await page.mouse.down();
    await page.mouse.move(center.x + 20, center.y, { steps: 4 });
    await page.mouse.move(center.x + 40, center.y, { steps: 4 });
    await page.mouse.up();

    // Siblings (indexes 1+) must not have shifted. The dragged child's own
    // rect can change (the deeper mousedown target moved).
    const afterRects = await page.evaluate(() => {
      const parent = document.querySelector('[data-test-flex-parent="yes"]');
      return [...parent.children].map((c, i) => {
        const r = c.getBoundingClientRect();
        return { i, top: r.top, left: r.left, width: r.width, height: r.height };
      });
    });
    for (let i = 1; i < beforeRects.length; i++) {
      expect(afterRects[i].top).toBeCloseTo(beforeRects[i].top, 0);
      expect(afterRects[i].left).toBeCloseTo(beforeRects[i].left, 0);
      expect(afterRects[i].width).toBeCloseTo(beforeRects[i].width, 0);
      expect(afterRects[i].height).toBeCloseTo(beforeRects[i].height, 0);
    }
  });

  test('dragging a flex child marks at least one ancestor flex container as frozen', async ({
    page,
  }) => {
    await loadFixtureWithEditor(page, 'Townhall-1.html');
    await setDeckScale(page, 1);
    await page.keyboard.press('e');

    const target = await findFlexTargetSweepingSlides(page);
    expect(target).not.toBeNull();

    const center = await page.evaluate(() => {
      const c = document.querySelector('[data-test-flex-child="first"]');
      const r = c.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });
    await page.mouse.move(center.x, center.y);
    await page.mouse.down();
    await page.mouse.move(center.x + 30, center.y, { steps: 4 });
    await page.mouse.up();

    const frozenCount = await page.evaluate(
      () => document.querySelectorAll('[data-wfp-edit-flex-frozen="true"]').length,
    );
    expect(frozenCount).toBeGreaterThanOrEqual(1);

    // Every direct child of every frozen container should be marked
    // data-wfp-edit-frozen, since freezing snapshots them all — except the
    // children no pin path may touch: non-rendered elements (v2.15; inline
    // styles on <script> and friends would survive export) and editor DOM.
    const allChildrenStamped = await page.evaluate(() => {
      const skipTags = ['SCRIPT', 'STYLE', 'LINK', 'META', 'NOSCRIPT', 'TEMPLATE'];
      const editorRoot = document.getElementById('wfp-editor-root');
      const parents = [...document.querySelectorAll('[data-wfp-edit-flex-frozen="true"]')];
      return parents.every((p) =>
        [...p.children]
          .filter((c) => !skipTags.includes(c.tagName) && !(editorRoot && editorRoot.contains(c)))
          .every((c) => c.dataset.wfpEditFrozen === 'true'),
      );
    });
    expect(allChildrenStamped).toBe(true);
  });

  test('block-layout siblings do not shift when one child is dragged', async ({ page }) => {
    await loadFixtureWithEditor(page, 'boilerplate.html');
    await setDeckScale(page, 1);
    await page.keyboard.press('e');

    // boilerplate slide 3 has a block-flow container (.s3-header) holding a
    // label, h2, and date. Dragging the h2 used to leave the label/date
    // free to reflow and the h2 itself to shrink to content-width.
    await page.evaluate(() => window.goTo && window.goTo(2));
    await page.waitForTimeout(80);
    await page.evaluate(() => window.goTo && window.goTo(3));
    await page.waitForTimeout(80);

    const targetSel = await page.evaluate(() => {
      const slide = document.querySelector('.slide.active');
      // Find any block-layout container inside the active slide whose
      // direct children are flow-positioned and there are at least 2.
      const cs = (el) => getComputedStyle(el);
      const cand = [...slide.querySelectorAll('*')].find((c) => {
        if (c.children.length < 2) return false;
        const display = cs(c).display;
        if (display === 'flex' || display === 'grid' || display === 'inline-flex' || display === 'inline-grid') {
          return false; // reserve flex/grid for the other tests
        }
        return [...c.children].every((ch) => {
          const p = cs(ch).position;
          return p !== 'absolute' && p !== 'fixed';
        });
      });
      if (!cand) return null;
      cand.dataset.testBlockParent = 'yes';
      cand.children[0].dataset.testBlockChild = 'first';
      return '[data-test-block-child="first"]';
    });
    if (!targetSel) {
      test.skip(true, 'no block-flow parent with multiple flow children found');
      return;
    }

    // Use offset* (layout-only, transform-free) so in-flight scaleIn
    // animations don't taint the comparison. The freeze pins layout
    // positions; transforms are a separate visual layer.
    const beforeSiblings = await page.evaluate(() => {
      const parent = document.querySelector('[data-test-block-parent="yes"]');
      return [...parent.children].slice(1).map((c) => ({
        offsetTop: c.offsetTop,
        offsetLeft: c.offsetLeft,
        offsetWidth: c.offsetWidth,
        offsetHeight: c.offsetHeight,
      }));
    });
    const beforeFirstWidth = await page.evaluate(
      (s) => document.querySelector(s).offsetWidth,
      targetSel,
    );

    const center = await page.evaluate((s) => {
      const r = document.querySelector(s).getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }, targetSel);
    await page.mouse.move(center.x, center.y);
    await page.mouse.down();
    await page.mouse.move(center.x + 30, center.y, { steps: 4 });
    await page.mouse.move(center.x + 60, center.y, { steps: 4 });
    await page.mouse.up();

    // Bug B: siblings (children[1+]) must not have shifted in layout.
    const afterSiblings = await page.evaluate(() => {
      const parent = document.querySelector('[data-test-block-parent="yes"]');
      return [...parent.children].slice(1).map((c) => ({
        offsetTop: c.offsetTop,
        offsetLeft: c.offsetLeft,
        offsetWidth: c.offsetWidth,
        offsetHeight: c.offsetHeight,
      }));
    });
    for (let i = 0; i < beforeSiblings.length; i++) {
      expect(afterSiblings[i].offsetTop).toBeCloseTo(beforeSiblings[i].offsetTop, 0);
      expect(afterSiblings[i].offsetLeft).toBeCloseTo(beforeSiblings[i].offsetLeft, 0);
      expect(afterSiblings[i].offsetWidth).toBeCloseTo(beforeSiblings[i].offsetWidth, 0);
      expect(afterSiblings[i].offsetHeight).toBeCloseTo(beforeSiblings[i].offsetHeight, 0);
    }

    // Bug A: the dragged child's width must NOT have shrunk to content-fit.
    const afterFirstWidth = await page.evaluate(
      (s) => document.querySelector(s).offsetWidth,
      targetSel,
    );
    expect(afterFirstWidth).toBeCloseTo(beforeFirstWidth, 0);
  });

  test('a second drag inside the same already-frozen container does not re-pin its children', async ({
    page,
  }) => {
    await loadFixtureWithEditor(page, 'Townhall-1.html');
    await setDeckScale(page, 1);
    await page.keyboard.press('e');

    const target = await findFlexTargetSweepingSlides(page);
    expect(target).not.toBeNull();

    // First drag: triggers freeze on the tagged parent.
    const c1 = await page.evaluate(() => {
      const c = document.querySelector('[data-test-flex-child="first"]');
      const r = c.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });
    await page.mouse.move(c1.x, c1.y);
    await page.mouse.down();
    await page.mouse.move(c1.x + 30, c1.y, { steps: 4 });
    await page.mouse.up();

    // Capture inline left/top of every direct child of the TAGGED parent
    // (the outer, first-frozen flex container). These should remain stable
    // across subsequent drags because the parent's freeze guard short-
    // circuits when it sees data-wfp-edit-flex-frozen="true".
    const beforeSecond = await page.evaluate(() => {
      const parent = document.querySelector('[data-test-flex-parent="yes"]');
      return [...parent.children].map((c) => ({
        left: c.style.left,
        top: c.style.top,
        width: c.style.width,
        height: c.style.height,
      }));
    });

    // Drag a different direct child of the tagged parent.
    const move = await page.evaluate(() => {
      const parent = document.querySelector('[data-test-flex-parent="yes"]');
      const c = parent.children[1];
      const r = c.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });
    await page.mouse.move(move.x, move.y);
    await page.mouse.down();
    await page.mouse.move(move.x - 25, move.y, { steps: 4 });
    await page.mouse.up();

    // Every direct child of the tagged parent should still have the SAME
    // inline left/top/width/height as after the first drag. The dragged
    // mousedown target may be a deeper descendant, so the direct children
    // themselves shouldn't move.
    const afterSecond = await page.evaluate(() => {
      const parent = document.querySelector('[data-test-flex-parent="yes"]');
      return [...parent.children].map((c) => ({
        left: c.style.left,
        top: c.style.top,
        width: c.style.width,
        height: c.style.height,
      }));
    });
    expect(afterSecond).toEqual(beforeSecond);
  });
});
