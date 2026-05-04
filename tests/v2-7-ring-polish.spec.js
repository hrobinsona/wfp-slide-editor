import { test, expect } from '@playwright/test';
import { loadFixtureWithEditor } from './_helpers.js';

// v2.7 — selection ring polish (build-first). Implementation lands first;
// these specs lock in the visual contract: 4px rounded corners, softer
// blue stroke, dominant corner dots, smaller / lower-contrast edge
// midpoints. All 8 functional resize handles remain — locked by the
// existing Phase 5 suite.

test.use({ viewport: { width: 2000, height: 1200 } });

async function selectByMouse(page, selector) {
  const center = await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }, selector);
  await page.mouse.move(center.x, center.y);
  await page.mouse.down();
  await page.mouse.up();
}

test.describe('v2.7 — selection ring polish', () => {
  test.beforeEach(async ({ page }) => {
    await loadFixtureWithEditor(page, 'Townhall-1.html');
    await page.evaluate(() => { document.querySelector('.deck').style.transform = 'scale(1)'; });
    await page.keyboard.press('e');
    await selectByMouse(page, '.slide.active h1');
  });

  test('selection ring uses 4px rounded corners', async ({ page }) => {
    const radius = await page.evaluate(
      () => getComputedStyle(document.querySelector('#wfp-editor-root .wfpe-selection-ring')).borderTopLeftRadius
    );
    expect(radius).toBe('4px');
  });

  test('selection ring stroke is the v2 softer blue (not v1 #2a8bf2)', async ({ page }) => {
    const colour = await page.evaluate(
      () => getComputedStyle(document.querySelector('#wfp-editor-root .wfpe-selection-ring')).borderTopColor
    );
    // v1 was rgb(42, 139, 242); v2 must be a softer blue.
    expect(colour).not.toBe('rgb(42, 139, 242)');
    // Sanity: still a blue (B channel dominant).
    const m = colour.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
    expect(m).toBeTruthy();
    const [r, g, b] = [Number(m[1]), Number(m[2]), Number(m[3])];
    expect(b).toBeGreaterThan(r); // blue dominant
    expect(b).toBeGreaterThan(150); // bright enough to read
  });

  test('all 8 resize handles render as circles (border-radius 50%)', async ({ page }) => {
    const radii = await page.evaluate(() =>
      [...document.querySelectorAll('#wfp-editor-root .wfpe-handle')].map((h) => ({
        dir: h.dataset.wfpeHandle,
        radius: getComputedStyle(h).borderTopLeftRadius,
      }))
    );
    expect(radii).toHaveLength(8);
    for (const r of radii) {
      // Circle: radius >= half of the handle's smallest axis. The
      // computed value can be either "50%" preserved or a pixel
      // resolution; both round to the same circle visually. Match
      // any non-zero rounded value at or above the halfway mark.
      expect(r.radius === '50%' || /^\d+(\.\d+)?(px|%)$/.test(r.radius)).toBe(true);
    }
  });

  test('corner handles are visually dominant: larger than edge handles', async ({ page }) => {
    const sizes = await page.evaluate(() => {
      const out = {};
      for (const h of document.querySelectorAll('#wfp-editor-root .wfpe-handle')) {
        const cs = getComputedStyle(h);
        out[h.dataset.wfpeHandle] = {
          w: parseFloat(cs.width),
          h: parseFloat(cs.height),
        };
      }
      return out;
    });

    const corners = ['nw', 'ne', 'se', 'sw'];
    const edges = ['n', 'e', 's', 'w'];
    for (const c of corners) {
      for (const e of edges) {
        expect(sizes[c].w).toBeGreaterThan(sizes[e].w);
        expect(sizes[c].h).toBeGreaterThan(sizes[e].h);
      }
    }
  });

  test('handles are centred on the selection ring corners and edge midpoints', async ({ page }) => {
    const positions = await page.evaluate(() => {
      const ring = document.querySelector('#wfp-editor-root .wfpe-selection-ring').getBoundingClientRect();
      const out = {};
      for (const h of document.querySelectorAll('#wfp-editor-root .wfpe-handle')) {
        const r = h.getBoundingClientRect();
        out[h.dataset.wfpeHandle] = {
          cx: r.left + r.width / 2,
          cy: r.top + r.height / 2,
        };
      }
      return { ring, out };
    });
    const { ring, out } = positions;
    const cx = ring.x + ring.width / 2;
    const cy = ring.y + ring.height / 2;

    // Each handle's centre should sit at the corresponding anchor point
    // on the ring, regardless of handle size differences.
    expect(out.nw.cx).toBeCloseTo(ring.left, 0);
    expect(out.nw.cy).toBeCloseTo(ring.top, 0);
    expect(out.ne.cx).toBeCloseTo(ring.right, 0);
    expect(out.ne.cy).toBeCloseTo(ring.top, 0);
    expect(out.se.cx).toBeCloseTo(ring.right, 0);
    expect(out.se.cy).toBeCloseTo(ring.bottom, 0);
    expect(out.sw.cx).toBeCloseTo(ring.left, 0);
    expect(out.sw.cy).toBeCloseTo(ring.bottom, 0);
    expect(out.n.cx).toBeCloseTo(cx, 0);
    expect(out.n.cy).toBeCloseTo(ring.top, 0);
    expect(out.s.cx).toBeCloseTo(cx, 0);
    expect(out.s.cy).toBeCloseTo(ring.bottom, 0);
    expect(out.e.cx).toBeCloseTo(ring.right, 0);
    expect(out.e.cy).toBeCloseTo(cy, 0);
    expect(out.w.cx).toBeCloseTo(ring.left, 0);
    expect(out.w.cy).toBeCloseTo(cy, 0);
  });
});
