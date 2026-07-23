import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { disableFsa } from './_helpers.js';

// v2.10 — "Ink Glass" toolbar + inspector refresh (design 3b).
//
// Runs against dev/harness.html — a committed synthetic deck that loads
// editor.js itself — so this spec stays runnable on machines without the
// private fixture set. Pins the structural/behavioural contract from the
// designer handoff: dock/fold states, corner morphs, collapse geometry,
// and the typography section's history semantics.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const HARNESS_PATH = path.join(PROJECT_ROOT, 'dev', 'harness.html');
const OUTPUT_DIR = path.join(__dirname, 'output');

const ROOT = '#wfp-editor-root';

async function loadHarness(page) {
  await page.goto(pathToFileURL(HARNESS_PATH).href);
  await page.waitForFunction(() => window.__wfpEditorReady === true, null, { timeout: 10_000 });
  // Freeze editor-chrome motion so geometry assertions read end states,
  // not mid-transition frames. The style element goes INSIDE the editor
  // root (CSS applies document-wide regardless of location) so the export
  // scrubber removes it along with the root — addStyleTag would park it
  // in <head>, where its "#wfp-editor-root" selector text would trip this
  // spec's own export-cleanliness assertions.
  await page.evaluate(() => {
    const style = document.createElement('style');
    style.textContent = '#wfp-editor-root * { transition: none !important; }';
    document.getElementById('wfp-editor-root').appendChild(style);
  });
}

async function clickToSelect(page, selector) {
  await page.evaluate((sel) => {
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

async function deselect(page) {
  // Click an empty corner of the active slide (bottom-left is bare in
  // every harness slide).
  await page.evaluate(() => {
    const slide = document.querySelector('.slide.active');
    const r = slide.getBoundingClientRect();
    slide.dispatchEvent(
      new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
        view: window,
        clientX: r.left + 30,
        clientY: r.bottom - 30,
      }),
    );
  });
}

function chrome(page) {
  return page.evaluate(() => {
    const root = document.getElementById('wfp-editor-root');
    const bar = root.querySelector('.wfpe-toolbar');
    const dock = root.querySelector('.wfpe-inspector-dock');
    const insp = root.querySelector('.wfpe-inspector');
    const barR = bar.getBoundingClientRect();
    const inspR = insp.getBoundingClientRect();
    return {
      barWidth: barR.width,
      barBottom: barR.bottom,
      barRadius: getComputedStyle(bar).borderRadius,
      collapsed: bar.dataset.collapsed,
      docked: bar.dataset.docked,
      dockVisible: dock.dataset.visible,
      dockTop: dock.getBoundingClientRect().top,
      inspTop: inspR.top,
      inspWidth: inspR.width,
      inspVisibility: getComputedStyle(insp).visibility,
      inspRadius: getComputedStyle(insp).borderRadius,
      inspShadow: getComputedStyle(insp).boxShadow,
      inspState: insp.dataset.state,
      headerHeight: root.querySelector('.wfpe-inspector-header').getBoundingClientRect().height,
      foldRows: getComputedStyle(root.querySelector('.wfpe-inspector-fold')).gridTemplateRows,
    };
  });
}

test.describe('v2.10 — ink-glass instrument states', () => {
  test('at rest the bar is a fully rounded 246px capsule and the inspector is hidden', async ({ page }) => {
    await loadHarness(page);
    const c = await chrome(page);
    expect(c.barWidth).toBe(246);
    expect(c.barRadius).toBe('12px');
    expect(c.collapsed).toBe('false');
    expect(c.docked).toBe('false');
    expect(c.dockVisible).toBe('false');
    expect(c.inspVisibility).toBe('hidden');
  });

  test('selection docks the inspector: 1px seam, squared shared corners, no outer drop shadow', async ({ page }) => {
    await loadHarness(page);
    await page.keyboard.press('e');
    await clickToSelect(page, '.s1 .headline');

    const c = await chrome(page);
    expect(c.dockVisible).toBe('true');
    expect(c.docked).toBe('true');
    // Shared hairline: the panel's top border row overlaps the bar's
    // bottom border row (dock top 53 = 16 + 36 bar + 1px seam).
    expect(c.dockTop).toBe(53);
    expect(c.barBottom).toBe(54);
    expect(c.inspWidth).toBe(246);
    expect(c.headerHeight).toBe(36);
    // Corner morph: bar squares its bottom corners; panel mirrors on top.
    expect(c.barRadius).toBe('12px 12px 6px 6px');
    expect(c.inspRadius).toBe('6px 6px 12px 12px');
    // Depth comes from the bar — panel has only the inset sheen.
    expect(c.inspShadow).not.toMatch(/(^|,)\s*rgba?\([^)]*\)\s+0px\s+8px/);
    expect(c.inspShadow).toContain('inset');
    expect(c.inspVisibility).toBe('visible');
  });

  test('deselection returns the bar to a fully rounded capsule and hides the panel', async ({ page }) => {
    await loadHarness(page);
    await page.keyboard.press('e');
    await clickToSelect(page, '.s1 .headline');
    await deselect(page);

    const c = await chrome(page);
    expect(c.dockVisible).toBe('false');
    expect(c.docked).toBe('false');
    expect(c.barRadius).toBe('12px');
    expect(c.inspVisibility).toBe('hidden');
  });

  test('collapse chevron folds the bar to 58px and back, flipping its accessible name', async ({ page }) => {
    await loadHarness(page);

    await page.click(`${ROOT} .wfpe-toolbar-collapse`);
    let c = await chrome(page);
    expect(c.barWidth).toBe(58);
    expect(c.collapsed).toBe('true');
    await expect(page.locator(`${ROOT} .wfpe-toolbar-collapse`)).toHaveAttribute('aria-label', 'Expand toolbar');

    await page.click(`${ROOT} .wfpe-toolbar-collapse`);
    c = await chrome(page);
    expect(c.barWidth).toBe(246);
    expect(c.collapsed).toBe('false');
    await expect(page.locator(`${ROOT} .wfpe-toolbar-collapse`)).toHaveAttribute('aria-label', 'Collapse toolbar');
  });

  test('minimise folds the inspector body, leaving a 36px header symmetric with the bar', async ({ page }) => {
    await loadHarness(page);
    await page.keyboard.press('e');
    await clickToSelect(page, '.s1 .headline');

    await page.click(`${ROOT} .wfpe-inspector-minimise`);
    let c = await chrome(page);
    expect(c.inspState).toBe('minimised');
    expect(c.foldRows).toBe('0px');
    expect(c.headerHeight).toBe(36);
    // Bar (36 + 2px borders) and folded panel (36 + 2px borders) match.
    expect(c.barBottom - 16).toBeCloseTo(38, 0);
    // The folded body must leave the tab order, not just the paint.
    expect(await page.evaluate(() =>
      getComputedStyle(document.querySelector('#wfp-editor-root .wfpe-inspector-fold-inner')).visibility,
    )).toBe('hidden');

    await page.click(`${ROOT} .wfpe-inspector-minimise`);
    c = await chrome(page);
    expect(c.inspState).toBe('expanded');
    expect(c.foldRows).not.toBe('0px');
  });

  test('overview mode hides the docked inspector entirely', async ({ page }) => {
    await loadHarness(page);
    await page.keyboard.press('e');
    await clickToSelect(page, '.s1 .headline');
    await page.keyboard.press('o');

    const display = await page.evaluate(() =>
      getComputedStyle(document.querySelector('#wfp-editor-root .wfpe-inspector-dock')).display,
    );
    expect(display).toBe('none');
  });

  test('toolbar is icon-only: every button has an svg icon, an aria-label, and no visible text', async ({ page }) => {
    await loadHarness(page);
    const buttons = await page.evaluate(() => {
      return [...document.querySelectorAll('#wfp-editor-root .wfpe-toolbar button')].map((b) => ({
        action: b.dataset.action,
        hasIcon: !!b.querySelector('svg.wfpe-icon'),
        text: b.textContent.replace(/\s+/g, ' ').trim(),
        ariaLabel: b.getAttribute('aria-label'),
      }));
    });
    expect(buttons.map((b) => b.action)).toEqual([
      'edit', 'overview', 'export', 'undo', 'redo', 'toolbar-collapse',
    ]);
    for (const b of buttons) {
      expect(b.hasIcon).toBe(true);
      expect(b.text).toBe('');
      expect(b.ariaLabel).toBeTruthy();
    }
  });
});

test.describe('v2.10 — typography section', () => {
  test('weight and align segs write inline styles with one history entry per click, no-op guarded', async ({ page }) => {
    await loadHarness(page);
    await page.keyboard.press('e');
    await clickToSelect(page, '.s1 .headline');

    const styleAttr = () => page.evaluate(() => document.querySelector('.s1 .headline').getAttribute('style'));
    const segStates = () => page.evaluate(() =>
      [...document.querySelectorAll('#wfp-editor-root .wfpe-seg-item')].map(
        (b) => `${b.dataset.wfpeValue}:${b.dataset.active}`,
      ),
    );

    // Headline is stylesheet-bold (700): Bold segment lights up, left align.
    expect(await segStates()).toEqual([
      '400:false', '500:false', '700:true',
      'left:true', 'center:false', 'right:false',
    ]);

    await page.click(`${ROOT} .wfpe-seg-item[data-wfpe-value="500"]`);
    expect(await styleAttr()).toBe('font-weight: 500;');

    // Re-clicking the active segment must not add a history entry.
    await page.click(`${ROOT} .wfpe-seg-item[data-wfpe-value="500"]`);
    await page.click(`${ROOT} .wfpe-seg-item[data-wfpe-value="center"]`);
    expect(await styleAttr()).toBe('font-weight: 500; text-align: center;');

    // Undo walks back align → weight → clean, proving one entry per
    // effective click and zero for the no-op.
    await page.keyboard.press('ControlOrMeta+z');
    expect(await styleAttr()).toBe('font-weight: 500;');
    await page.keyboard.press('ControlOrMeta+z');
    expect(await styleAttr()).toBeNull();
    expect(await segStates()).toContain('700:true');
  });

  test('typography rows and their dividers render only for text-bearing selections', async ({ page }) => {
    await loadHarness(page);
    await page.keyboard.press('e');

    const typographyVisible = () => page.evaluate(() => {
      const root = document.getElementById('wfp-editor-root');
      const rows = ['font-size', 'font-weight', 'text-align'].map(
        (k) => root.querySelector(`[data-wfpe-row="${k}"]`).style.display !== 'none',
      );
      const dividers = [...root.querySelectorAll('.wfpe-inspector-divider')].map(
        (d) => d.style.display !== 'none',
      );
      return { rows, dividers };
    });

    await clickToSelect(page, '.s1 .headline');
    let t = await typographyVisible();
    expect(t.rows).toEqual([true, true, true]);
    expect(t.dividers).toEqual([true, true]);

    await clickToSelect(page, '.s1 .corner-noise');
    t = await typographyVisible();
    expect(t.rows).toEqual([false, false, false]);
    expect(t.dividers).toEqual([false, false]);
  });

  test('font row is a −/field/+ stepper with no slider', async ({ page }) => {
    await loadHarness(page);
    await page.keyboard.press('e');
    await clickToSelect(page, '.s1 .headline');

    const row = await page.evaluate(() => {
      const r = document.querySelector('#wfp-editor-root [data-wfpe-row="font-size"]');
      return {
        label: r.querySelector('.wfpe-inspector-row-label').textContent,
        childOrder: [...r.querySelector('.wfpe-font-control').children].map((c) => c.className.split(' ')[0]),
        slider: !!r.querySelector('input[type="range"]'),
        value: r.querySelector('input[data-wfpe-prop="fontSize"]').value,
      };
    });
    expect(row.label).toBe('Font');
    expect(row.childOrder).toEqual(['wfpe-font-btn', 'wfpe-inspector-field', 'wfpe-font-btn']);
    expect(row.slider).toBe(false);
    expect(row.value).toBe('64');
  });
});

test.describe('v2.10 — export stays clean', () => {
  test('exported HTML carries no editor chrome, wrappers, or typography controls', async ({ page }) => {
    // v2.11 — Cmd+S now prefers the save-in-place engine when the File
    // System Access API is present (real headless Chromium has it on
    // file:// origins). This spec is about export content cleanliness, not
    // the save engine, so force the legacy download fallback explicitly.
    await disableFsa(page);
    await loadHarness(page);
    await page.keyboard.press('e');
    await clickToSelect(page, '.s1 .headline');
    await page.click(`${ROOT} .wfpe-seg-item[data-wfpe-value="500"]`);

    const downloadPromise = page.waitForEvent('download', { timeout: 5_000 });
    await page.keyboard.press('ControlOrMeta+s');
    const download = await downloadPromise;

    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    const out = path.join(OUTPUT_DIR, download.suggestedFilename());
    await download.saveAs(out);
    const content = fs.readFileSync(out, 'utf-8');

    expect(content).not.toContain('wfpe-');
    expect(content).not.toContain('wfp-editor-root');
    expect(content).not.toContain('data-wfp-edit');
    expect(content).not.toContain('contenteditable');
    // The committed style survives in the user's own markup.
    expect(content).toMatch(/font-weight:\s*500/);
  });
});
