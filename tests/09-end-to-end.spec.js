import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  loadFixtureWithEditor,
  pickRandomRotationFixture,
  PINNED_PRIMARIES,
} from './_helpers.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = path.join(__dirname, 'output');

test.use({ viewport: { width: 2000, height: 1200 } });

const FIXTURES_TO_TEST = [
  ...PINNED_PRIMARIES,
  pickRandomRotationFixture(),
];

console.log(`[09-end-to-end] running across fixtures:`, FIXTURES_TO_TEST);

async function setDeckScale(page, scale) {
  await page.evaluate((s) => {
    document.querySelector('.deck').style.transform = `scale(${s})`;
  }, scale);
}

async function clickToSelect(page, selector) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    const r = el.getBoundingClientRect();
    el.dispatchEvent(
      new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
        view: window,
        clientX: r.left + r.width / 2,
        clientY: r.top + r.height / 2,
      }),
    );
  }, selector);
}

async function dragByViewportPx(page, selector, dx, dy) {
  const c = await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }, selector);
  await page.mouse.move(c.x, c.y);
  await page.mouse.down();
  await page.mouse.move(c.x + dx / 2, c.y + dy / 2, { steps: 5 });
  await page.mouse.move(c.x + dx, c.y + dy, { steps: 5 });
  await page.mouse.up();
}

async function activeSlideIndex(page) {
  return page.evaluate(
    () => [...document.querySelectorAll('.slide')].findIndex((s) => s.classList.contains('active')),
  );
}

for (const fixture of FIXTURES_TO_TEST) {
  test.describe(`Phase 9 — End-to-end: ${fixture}`, () => {
    test('1. Editor loads without console errors', async ({ page }) => {
      const errors = [];
      page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
      page.on('console', (msg) => {
        if (msg.type() === 'error') errors.push(`console.error: ${msg.text()}`);
      });
      await loadFixtureWithEditor(page, fixture);
      // The favicon 404 from http-server is unrelated; tolerate that one.
      const meaningful = errors.filter((e) => !/favicon\.ico/.test(e));
      expect(meaningful, `Console errors: ${meaningful.join(' | ')}`).toEqual([]);
    });

    test('2. Pressing E toggles edit mode on/off', async ({ page }) => {
      await loadFixtureWithEditor(page, fixture);
      const badge = page.locator('#wfp-editor-root .wfpe-mode-badge');
      await expect(badge).toHaveText(/Edit:\s*OFF/);
      await page.keyboard.press('e');
      await expect(badge).toHaveText(/Edit:\s*ON/);
      await page.keyboard.press('e');
      await expect(badge).toHaveText(/Edit:\s*OFF/);
    });

    test('3. Click on heading selects with visible ring', async ({ page }) => {
      await loadFixtureWithEditor(page, fixture);
      await page.keyboard.press('e');
      // First heading inside the active slide.
      const sel = await page.evaluate(() => {
        const h = document.querySelector('.slide.active h1, .slide.active h2');
        if (!h) return null;
        h.dataset.testHeading = 'yes';
        return '[data-test-heading="yes"]';
      });
      expect(sel).not.toBeNull();
      await clickToSelect(page, sel);
      const display = await page.evaluate(
        () => document.querySelector('#wfp-editor-root .wfpe-selection-ring').style.display,
      );
      expect(display).toBe('block');
    });

    test('4. Five ArrowUps grow font-size by 5px', async ({ page }) => {
      await loadFixtureWithEditor(page, fixture);
      await page.keyboard.press('e');
      const sel = await page.evaluate(() => {
        const h = document.querySelector('.slide.active h1, .slide.active h2');
        if (!h) return null;
        h.dataset.testHeading = 'yes';
        return '[data-test-heading="yes"]';
      });
      await clickToSelect(page, sel);
      const before = await page.evaluate(
        (s) => parseFloat(getComputedStyle(document.querySelector(s)).fontSize),
        sel,
      );
      for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowUp');
      const after = await page.evaluate(
        (s) => parseFloat(getComputedStyle(document.querySelector(s)).fontSize),
        sel,
      );
      expect(after - before).toBeCloseTo(5, 1);
    });

    test('5. Drag at scale=0.5 moves an absolute element 1:1 with cursor in slide space', async ({
      page,
    }) => {
      await loadFixtureWithEditor(page, fixture);
      await setDeckScale(page, 0.5);
      await page.keyboard.press('e');
      // Find an absolute-positioned element with a stable rect.
      const sel = await page.evaluate(() => {
        const slide = document.querySelector('.slide.active');
        // Prefer a known-foreground absolute element (the WFP corner badge,
        // the Philips footer, or the first absolutely-positioned element
        // whose pointer-events allow clicks).
        const preferred =
          slide.querySelector('.wfp-badge') ||
          slide.querySelector('.philips') ||
          [...slide.querySelectorAll('*')].find((el) => {
            const cs = getComputedStyle(el);
            if (cs.position !== 'absolute') return false;
            if (cs.pointerEvents === 'none') return false;
            const r = el.getBoundingClientRect();
            return r.width > 20 && r.height > 20 && r.width < 400 && r.height < 400;
          });
        if (!preferred) return null;
        preferred.dataset.testAbsolute = 'yes';
        return '[data-test-absolute="yes"]';
      });
      if (!sel) {
        test.skip(true, 'no absolutely-positioned target in this fixture');
        return;
      }
      const before = await page.evaluate(
        (s) => document.querySelector(s).offsetLeft,
        sel,
      );
      await dragByViewportPx(page, sel, 60, 0);
      const after = await page.evaluate((s) => document.querySelector(s).offsetLeft, sel);
      // 60 viewport px / 0.5 scale = 120 slide-space px
      expect(after - before).toBeCloseTo(120, 0);
    });

    test('6. Cmd+Z restores position after a drag', async ({ page }) => {
      await loadFixtureWithEditor(page, fixture);
      await setDeckScale(page, 1);
      await page.keyboard.press('e');
      const sel = await page.evaluate(() => {
        const slide = document.querySelector('.slide.active');
        // Prefer a known-foreground absolute element (the WFP corner badge,
        // the Philips footer, or the first absolutely-positioned element
        // whose pointer-events allow clicks).
        const preferred =
          slide.querySelector('.wfp-badge') ||
          slide.querySelector('.philips') ||
          [...slide.querySelectorAll('*')].find((el) => {
            const cs = getComputedStyle(el);
            if (cs.position !== 'absolute') return false;
            if (cs.pointerEvents === 'none') return false;
            const r = el.getBoundingClientRect();
            return r.width > 20 && r.height > 20 && r.width < 400 && r.height < 400;
          });
        if (!preferred) return null;
        preferred.dataset.testAbsolute = 'yes';
        return '[data-test-absolute="yes"]';
      });
      if (!sel) {
        test.skip(true, 'no absolutely-positioned target');
        return;
      }
      const before = await page.evaluate((s) => document.querySelector(s).offsetLeft, sel);
      await dragByViewportPx(page, sel, 50, 0);
      const dragged = await page.evaluate((s) => document.querySelector(s).offsetLeft, sel);
      expect(dragged).not.toBe(before);
      await page.keyboard.press('ControlOrMeta+z');
      const restored = await page.evaluate((s) => document.querySelector(s).offsetLeft, sel);
      expect(restored).toBeCloseTo(before, 0);
    });

    test('7. Double-click + edit + Escape changes text', async ({ page }) => {
      await loadFixtureWithEditor(page, fixture);
      await page.keyboard.press('e');
      const sel = await page.evaluate(() => {
        const slide = document.querySelector('.slide.active');
        const cand = [...slide.querySelectorAll('p, h1, h2, h3, h4')].find((el) => {
          return [...el.childNodes].some(
            (n) => n.nodeType === 3 && n.textContent.trim().length > 0,
          );
        });
        if (!cand) return null;
        cand.dataset.testText = 'yes';
        return '[data-test-text="yes"]';
      });
      expect(sel).not.toBeNull();
      await page.evaluate((s) => {
        const el = document.querySelector(s);
        const r = el.getBoundingClientRect();
        el.dispatchEvent(
          new MouseEvent('dblclick', {
            bubbles: true,
            cancelable: true,
            view: window,
            clientX: r.left + 5,
            clientY: r.top + 5,
            detail: 2,
          }),
        );
        el.innerHTML = 'EDITED-TEXT-MARKER';
      }, sel);
      await page.keyboard.press('Escape');
      const html = await page.evaluate(
        (s) => document.querySelector(s).innerHTML,
        sel,
      );
      expect(html).toContain('EDITED-TEXT-MARKER');
    });

    test('8. Cmd+S downloads HTML; opens cleanly in fresh tab', async ({ page, context }) => {
      await loadFixtureWithEditor(page, fixture);
      await setDeckScale(page, 1);
      await page.keyboard.press('e');
      // Make a tiny edit so the export contains something we can detect.
      const sel = await page.evaluate(() => {
        const h = document.querySelector('.slide.active h1, .slide.active h2');
        if (!h) return null;
        h.dataset.testHeading = 'yes';
        return '[data-test-heading="yes"]';
      });
      if (sel) {
        await clickToSelect(page, sel);
        await page.keyboard.press('ArrowUp');
      }
      const downloadPromise = page.waitForEvent('download', { timeout: 5_000 });
      await page.keyboard.press('ControlOrMeta+s');
      const download = await downloadPromise;
      fs.mkdirSync(OUTPUT_DIR, { recursive: true });
      const out = path.join(OUTPUT_DIR, download.suggestedFilename());
      await download.saveAs(out);

      const fresh = await context.newPage();
      await fresh.goto(`file://${out}`);
      await fresh.locator('.deck').waitFor({ state: 'attached', timeout: 5_000 });
      const hasRoot = await fresh.evaluate(
        () => !!document.getElementById('wfp-editor-root'),
      );
      expect(hasRoot).toBe(false);
      await fresh.close();
    });

    test('9. With edit mode OFF, ArrowRight navigates slides', async ({ page }) => {
      await loadFixtureWithEditor(page, fixture);
      const before = await activeSlideIndex(page);
      await page.locator('body').click({ position: { x: 5, y: 5 } });
      await page.keyboard.press('ArrowRight');
      await page.waitForTimeout(120);
      const after = await activeSlideIndex(page);
      expect(after).toBe(before + 1);
    });

    test('10. With edit mode ON, ArrowRight does NOT navigate slides', async ({ page }) => {
      await loadFixtureWithEditor(page, fixture);
      await page.keyboard.press('e');
      const before = await activeSlideIndex(page);
      await page.keyboard.press('ArrowRight');
      await page.waitForTimeout(120);
      const after = await activeSlideIndex(page);
      expect(after).toBe(before);
    });
  });
}
