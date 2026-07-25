import { test, expect } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// v2.12 — adaptive inspector (design 7 + smart overlap gate).
//
// Any live manipulation (drag, resize, font scrub/steppers, opacity slider,
// weight/align commit, inline text edit) fades the inspector to a whisper —
// but ONLY when the selection's bounding box actually intersects the
// inspector's rectangle. The coral value tag pinned to the selection shows
// either way. Runs against dev/harness.html like the v2-10 ink-glass spec
// so it stays runnable without the private fixture pool.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const HARNESS_PATH = path.join(PROJECT_ROOT, 'dev', 'harness.html');

const ROOT = '#wfp-editor-root';
const TAG = `${ROOT} .wfpe-scrub-tag`;
const INSPECTOR = `${ROOT} .wfpe-inspector`;
const FONT_FIELD = `${ROOT} .wfpe-inspector-row[data-wfpe-row="font-size"] .wfpe-inspector-field`;

async function loadHarness(page) {
  await page.goto(pathToFileURL(HARNESS_PATH).href);
  await page.waitForFunction(() => window.__wfpEditorReady === true, null, { timeout: 10_000 });
  // Freeze chrome CSS motion so state assertions read end states. The JS
  // restore timer (380ms) is real time and is awaited via waitForFunction.
  await page.evaluate(() => {
    const style = document.createElement('style');
    style.textContent = '#wfp-editor-root * { transition: none !important; }';
    document.getElementById('wfp-editor-root').appendChild(style);
  });
}

// Real-mouse selection so the mousedown/mouseup/click cycle matches user
// behaviour (synthetic clicks skip the drag-deadzone path).
async function selectByMouse(page, selector, offset = null) {
  const p = await page.evaluate(
    ({ sel, off }) => {
      const r = document.querySelector(sel).getBoundingClientRect();
      return off
        ? { x: r.left + off.x, y: r.top + off.y }
        : { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    },
    { sel: selector, off: offset },
  );
  await page.mouse.click(p.x, p.y);
}

// Snapshot of the adaptive-fade chrome plus a live overlap computation for
// the given element so assertions never hardcode harness geometry.
function fadeState(page, selector) {
  return page.evaluate((sel) => {
    const root = document.getElementById('wfp-editor-root');
    const insp = root.querySelector('.wfpe-inspector');
    const tag = root.querySelector('.wfpe-scrub-tag');
    const bubble = root.querySelector('.wfpe-dim-bubble');
    let overlap = null;
    if (sel) {
      const a = document.querySelector(sel).getBoundingClientRect();
      const b = insp.getBoundingClientRect();
      overlap = a.right > b.left && a.left < b.right && a.bottom > b.top && a.top < b.bottom;
    }
    return {
      faded: insp.dataset.fade === 'true',
      tagShown: !!tag && tag.dataset.show === 'true',
      tagText: tag ? tag.textContent.trim() : null,
      bubbleDisplay: bubble.style.display,
      bubbleText: bubble.textContent.trim(),
      dockVisible: root.querySelector('.wfpe-inspector-dock').dataset.visible,
      overlap,
    };
  }, selector);
}

async function waitForRestore(page) {
  await page.waitForFunction(() => {
    const root = document.getElementById('wfp-editor-root');
    const insp = root.querySelector('.wfpe-inspector');
    const tag = root.querySelector('.wfpe-scrub-tag');
    return insp.dataset.fade !== 'true' && tag.dataset.show !== 'true';
  }, null, { timeout: 3000 });
}

// Reposition an (already absolutely positioned) harness element so its box
// spans both legal dock sides. This exercises the deliberate fallback path
// while leaving ordinary one-sided selections free to trigger auto-placement.
async function moveUnderInspector(page, selector, _left = 700, top = 40) {
  await page.evaluate(
    ({ sel, t }) => {
      const el = document.querySelector(sel);
      el.style.left = '0';
      el.style.top = `${t}px`;
      el.style.width = '1280px';
    },
    { sel: selector, t: top },
  );
}

function elCenter(page, selector) {
  return page.evaluate((sel) => {
    const r = document.querySelector(sel).getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }, selector);
}

test.describe('v2.12 — adaptive inspector fade', () => {
  test('rest-state dock avoids a top-right selection, tracks geometry, and falls back without fading the toolbar', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await loadHarness(page);
    await page.keyboard.press('e');

    await selectByMouse(page, '.s1 .corner-noise', { x: 300, y: 40 });
    await page.waitForFunction(() =>
      document.querySelector('#wfp-editor-root .wfpe-stack')?.dataset.side === 'left');

    let state = await page.evaluate(() => {
      const selection = document.querySelector('.s1 .corner-noise').getBoundingClientRect();
      const inspector = document.querySelector('#wfp-editor-root .wfpe-inspector').getBoundingClientRect();
      const stack = document.querySelector('#wfp-editor-root .wfpe-stack');
      return {
        side: stack.dataset.side,
        overlaps: selection.right > inspector.left && selection.left < inspector.right &&
          selection.bottom > inspector.top && selection.top < inspector.bottom,
      };
    });
    expect(state.side).toBe('left');
    expect(state.overlaps).toBe(false);

    // Selection tracking re-evaluates geometry at rest and returns to the
    // opposite side only once the current side becomes blocked.
    await page.evaluate(() => {
      const el = document.querySelector('.s1 .corner-noise');
      el.style.right = 'auto';
      el.style.left = '0';
      el.style.width = '420px';
    });
    await page.waitForFunction(() =>
      document.querySelector('#wfp-editor-root .wfpe-stack')?.dataset.side === 'right');

    // A viewport-spanning selection blocks both sides. The panel becomes
    // non-obstructive, while the toolbar remains fully opaque.
    await page.evaluate(() => {
      const el = document.querySelector('.s1 .corner-noise');
      el.style.left = '0';
      el.style.right = '0';
      el.style.width = 'auto';
    });
    await page.waitForFunction(() =>
      document.querySelector('#wfp-editor-root .wfpe-inspector')?.dataset.avoidance === 'overlap');
    state = await page.evaluate(() => {
      const inspector = document.querySelector('#wfp-editor-root .wfpe-inspector');
      const toolbar = document.querySelector('#wfp-editor-root .wfpe-toolbar');
      return {
        avoidance: inspector.dataset.avoidance,
        inspectorOpacity: Number(getComputedStyle(inspector).opacity),
        toolbarOpacity: Number(getComputedStyle(toolbar).opacity),
      };
    });
    expect(state.avoidance).toBe('overlap');
    expect(state.inspectorOpacity).toBeLessThanOrEqual(0.2);
    expect(state.toolbarOpacity).toBe(1);
  });

  test('fallback reveal is predictable for mouse, keyboard, and first-touch activation', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await loadHarness(page);
    await page.keyboard.press('e');
    await moveUnderInspector(page, '.s1 .headline');
    await selectByMouse(page, '.s1 .headline', { x: 20, y: 15 });

    const inspector = page.locator(INSPECTOR);
    const minimise = page.locator(`${ROOT} .wfpe-inspector-minimise`);
    await expect(inspector).toHaveAttribute('data-avoidance', 'overlap');
    await expect(inspector).toHaveAttribute('data-revealed', 'false');

    // Mouse hover reveals the whole panel before its first click; that click
    // is therefore an intentional control activation.
    await minimise.hover();
    await expect(inspector).toHaveAttribute('data-revealed', 'true');
    await minimise.click();
    await expect(inspector).toHaveAttribute('data-state', 'minimised');
    await minimise.click();
    await expect(inspector).toHaveAttribute('data-state', 'expanded');
    await page.evaluate(() => document.activeElement?.blur());
    await page.mouse.move(640, 690);
    await expect(inspector).toHaveAttribute('data-revealed', 'false');

    // Keyboard focus reveals before the focused control can be operated and
    // remains revealed while focus advances within the panel.
    await minimise.focus();
    await expect(inspector).toHaveAttribute('data-revealed', 'true');
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() =>
      document.querySelector('#wfp-editor-root .wfpe-inspector').contains(document.activeElement)
    )).toBe(true);
    await expect(inspector).toHaveAttribute('data-revealed', 'true');
    await page.locator(`${ROOT} .wfpe-mode-badge`).focus();
    await expect(inspector).toHaveAttribute('data-revealed', 'false');

    // Touch has no hover preview: the first contact is consumed as reveal,
    // and only a second contact activates the nearly-invisible control.
    await page.evaluate(() => {
      const button = document.querySelector('#wfp-editor-root .wfpe-inspector-minimise');
      button.dispatchEvent(new PointerEvent('pointerdown', {
        bubbles: true,
        cancelable: true,
        pointerType: 'touch',
      }));
      button.dispatchEvent(new PointerEvent('pointerup', {
        bubbles: true,
        cancelable: true,
        pointerType: 'touch',
      }));
      button.click();
    });
    await expect(inspector).toHaveAttribute('data-revealed', 'true');
    await expect(inspector).toHaveAttribute('data-state', 'expanded');

    await page.evaluate(() => {
      const button = document.querySelector('#wfp-editor-root .wfpe-inspector-minimise');
      button.dispatchEvent(new PointerEvent('pointerdown', {
        bubbles: true,
        cancelable: true,
        pointerType: 'touch',
      }));
      button.dispatchEvent(new PointerEvent('pointerup', {
        bubbles: true,
        cancelable: true,
        pointerType: 'touch',
      }));
      button.click();
    });
    await expect(inspector).toHaveAttribute('data-state', 'minimised');
  });

  test('placement state responds to resize, minimise, export suppression, and Overview transitions', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await loadHarness(page);
    await page.keyboard.press('e');
    await moveUnderInspector(page, '.s1 .headline');
    await selectByMouse(page, '.s1 .headline', { x: 20, y: 15 });

    const inspector = page.locator(INSPECTOR);
    const dock = page.locator(`${ROOT} .wfpe-inspector-dock`);
    const toolbar = page.locator(`${ROOT} .wfpe-toolbar`);
    await expect(inspector).toHaveAttribute('data-avoidance', 'overlap');

    // The same selection no longer blocks either edge in a wider viewport.
    await page.setViewportSize({ width: 1800, height: 720 });
    await expect(inspector).toHaveAttribute('data-avoidance', 'clear');

    const expandedHeight = await inspector.evaluate((el) => el.getBoundingClientRect().height);
    await page.locator(`${ROOT} .wfpe-inspector-minimise`).click();
    await expect(inspector).toHaveAttribute('data-state', 'minimised');
    const minimisedHeight = await inspector.evaluate((el) => el.getBoundingClientRect().height);
    expect(minimisedHeight).toBeLessThan(expandedHeight);
    await page.locator(`${ROOT} .wfpe-inspector-minimise`).click();
    await expect(inspector).toHaveAttribute('data-state', 'expanded');

    await page.locator(`${ROOT} button[data-action="export"]`).click();
    await expect(inspector).toHaveAttribute('data-suppressed', 'true');
    await expect(toolbar).toHaveCSS('opacity', '1');
    await page.locator(`${ROOT} button[data-action="export"]`).click();
    await expect(inspector).toHaveAttribute('data-suppressed', 'false');

    await page.keyboard.press('o');
    await expect(dock).toHaveAttribute('data-visible', 'false');
    await expect(inspector).toHaveAttribute('data-avoidance', 'clear');
    await page.keyboard.press('o');
    await expect(dock).toHaveAttribute('data-visible', 'false');
  });

  test('live drag holds the chosen side, then reconciles placement after drop', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await loadHarness(page);
    await page.keyboard.press('e');
    await selectByMouse(page, '.s1 .headline');

    const stack = page.locator(`${ROOT} .wfpe-stack`);
    await expect(stack).toHaveAttribute('data-side', 'right');
    const start = await elCenter(page, '.s1 .headline');
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x + 470, start.y, { steps: 8 });

    const during = await fadeState(page, '.s1 .headline');
    expect(during.overlap).toBe(true);
    expect(during.faded).toBe(true);
    await expect(stack).toHaveAttribute('data-side', 'right');

    await page.mouse.up();
    await expect(stack).toHaveAttribute('data-side', 'left');
  });

  test('drag fades the panel only while the element is under it, re-tested per move', async ({ page }) => {
    await loadHarness(page);
    await page.keyboard.press('e');
    await selectByMouse(page, '.s1 .headline');

    let s = await fadeState(page, '.s1 .headline');
    expect(s.dockVisible).toBe('true');
    expect(s.faded).toBe(false);
    expect(s.tagShown).toBe(false);

    const start = await elCenter(page, '.s1 .headline');
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();

    // Stage 1 — small move, element still clear of the panel: tag shows
    // live X/Y, panel stays solid (smart gate).
    await page.mouse.move(start.x + 60, start.y + 10, { steps: 4 });
    s = await fadeState(page, '.s1 .headline');
    expect(s.overlap).toBe(false);
    expect(s.faded).toBe(false);
    expect(s.tagShown).toBe(true);
    const xy = await page.evaluate(() => {
      const el = document.querySelector('.s1 .headline');
      return { x: el.offsetLeft, y: el.offsetTop };
    });
    const m = s.tagText.match(/X\s*(-?\d+)\D+Y\s*(-?\d+)/);
    expect(m, `tag text "${s.tagText}" should carry X/Y`).not.toBeNull();
    expect(Number(m[1])).toBe(xy.x);
    expect(Number(m[2])).toBe(xy.y);
    // The coral tag supersedes the dim bubble while it shows.
    expect(s.bubbleDisplay).toBe('none');

    // Stage 2 — drag right until the element's box passes under the panel:
    // fade flips on mid-gesture.
    await page.mouse.move(start.x + 470, start.y + 10, { steps: 6 });
    s = await fadeState(page, '.s1 .headline');
    expect(s.overlap).toBe(true);
    expect(s.faded).toBe(true);
    expect(s.tagShown).toBe(true);

    // Stage 3 — drag back out: fade releases the moment the boxes separate.
    await page.mouse.move(start.x + 40, start.y + 10, { steps: 6 });
    s = await fadeState(page, '.s1 .headline');
    expect(s.overlap).toBe(false);
    expect(s.faded).toBe(false);
    expect(s.tagShown).toBe(true);

    // Drop — chrome restores after the settle timer.
    await page.mouse.up();
    await waitForRestore(page);
    s = await fadeState(page, '.s1 .headline');
    expect(s.faded).toBe(false);
    expect(s.tagShown).toBe(false);
    expect(s.bubbleDisplay).toBe('block');
  });

  test('font stepper shows the value tag without fading when there is no overlap', async ({ page }) => {
    await loadHarness(page);
    await page.keyboard.press('e');
    await selectByMouse(page, '.s1 .headline');

    await page.locator(`${ROOT} .wfpe-font-btn[data-action="font-plus"]`).click();
    const s = await fadeState(page, '.s1 .headline');
    expect(s.overlap).toBe(false);
    expect(s.faded).toBe(false);
    expect(s.tagShown).toBe(true);
    const px = await page.evaluate(() =>
      Math.round(parseFloat(getComputedStyle(document.querySelector('.s1 .headline')).fontSize)));
    expect(s.tagText).toMatch(new RegExp(`^${px}\\s*px$`));
    await waitForRestore(page);
  });

  test('font stepper fades the panel when the selection sits beneath it', async ({ page }) => {
    await loadHarness(page);
    await page.keyboard.press('e');
    await moveUnderInspector(page, '.s1 .headline');
    await selectByMouse(page, '.s1 .headline', { x: 20, y: 15 });

    let s = await fadeState(page, '.s1 .headline');
    expect(s.dockVisible).toBe('true');
    expect(s.overlap).toBe(true);
    expect(s.faded).toBe(false); // selection alone doesn't fade — gestures do

    await page.locator(`${ROOT} .wfpe-font-btn[data-action="font-plus"]`).click();
    s = await fadeState(page, '.s1 .headline');
    expect(s.faded).toBe(true);
    expect(s.tagShown).toBe(true);

    await waitForRestore(page);
    s = await fadeState(page, '.s1 .headline');
    expect(s.faded).toBe(false);
    expect(s.tagShown).toBe(false);
  });

  test('dragging the font field scrubs ~1px per 3px and lands one history entry', async ({ page }) => {
    await loadHarness(page);
    await page.keyboard.press('e');
    await selectByMouse(page, '.s1 .headline');

    const before = await page.evaluate(() =>
      Math.round(parseFloat(getComputedStyle(document.querySelector('.s1 .headline')).fontSize)));

    const field = await elCenter(page, FONT_FIELD);
    await page.mouse.move(field.x, field.y);
    await page.mouse.down();
    await page.mouse.move(field.x + 9, field.y, { steps: 3 });
    let px = await page.evaluate(() =>
      Math.round(parseFloat(getComputedStyle(document.querySelector('.s1 .headline')).fontSize)));
    expect(px).toBe(before + 3);
    let s = await fadeState(page, '.s1 .headline');
    expect(s.tagShown).toBe(true);
    expect(s.tagText).toMatch(new RegExp(`^${px}\\s*px$`));
    expect(s.faded).toBe(false); // headline is far from the panel

    await page.mouse.move(field.x + 30, field.y, { steps: 4 });
    px = await page.evaluate(() =>
      Math.round(parseFloat(getComputedStyle(document.querySelector('.s1 .headline')).fontSize)));
    expect(px).toBe(before + 10);
    // The inspector input mirrors the scrub live.
    const inputValue = await page.evaluate(() =>
      document.querySelector('#wfp-editor-root input[data-wfpe-prop="fontSize"]').value);
    expect(Number(inputValue)).toBe(before + 10);

    await page.mouse.up();
    await waitForRestore(page);

    // One gesture = one history entry.
    await page.keyboard.press('ControlOrMeta+z');
    px = await page.evaluate(() =>
      Math.round(parseFloat(getComputedStyle(document.querySelector('.s1 .headline')).fontSize)));
    expect(px).toBe(before);
  });

  test('a plain click on the font field still focuses the input for typed commits', async ({ page }) => {
    await loadHarness(page);
    await page.keyboard.press('e');
    await selectByMouse(page, '.s1 .headline');

    const field = await elCenter(page, FONT_FIELD);
    await page.mouse.click(field.x, field.y);
    const focused = await page.evaluate(() =>
      document.activeElement === document.querySelector('#wfp-editor-root input[data-wfpe-prop="fontSize"]'));
    expect(focused).toBe(true);

    await page.keyboard.type('30');
    await page.keyboard.press('Enter');
    const px = await page.evaluate(() =>
      Math.round(parseFloat(getComputedStyle(document.querySelector('.s1 .headline')).fontSize)));
    expect(px).toBe(30);
  });

  test('inline text edit fades an occluded element for the whole edit, blips included', async ({ page }) => {
    await loadHarness(page);
    await page.keyboard.press('e');
    await moveUnderInspector(page, '.s1 .headline');
    await selectByMouse(page, '.s1 .headline', { x: 20, y: 15 });

    const p = await page.evaluate(() => {
      const r = document.querySelector('.s1 .headline').getBoundingClientRect();
      return { x: r.left + 20, y: r.top + 15 };
    });
    await page.mouse.dblclick(p.x, p.y);
    let s = await fadeState(page, '.s1 .headline');
    expect(s.faded).toBe(true);
    expect(s.tagShown).toBe(false); // typing gets fade only, no tag

    // A stepper blip mid-edit must not restore the panel — the edit holds it.
    await page.locator(`${ROOT} .wfpe-font-btn[data-action="font-plus"]`).click();
    await page.waitForFunction(() => {
      const tag = document.querySelector('#wfp-editor-root .wfpe-scrub-tag');
      return tag.dataset.show !== 'true';
    }, null, { timeout: 3000 });
    s = await fadeState(page, '.s1 .headline');
    expect(s.faded).toBe(true);

    // Refocus the editing element — keydowns from a focused inspector
    // control are deliberately left to the inspector (v2.6 contract).
    await page.mouse.click(p.x, p.y);
    await page.keyboard.press('Escape'); // commit the edit
    await waitForRestore(page);
    s = await fadeState(page, '.s1 .headline');
    expect(s.faded).toBe(false);
  });

  test('inline text edit away from the panel does not fade it', async ({ page }) => {
    await loadHarness(page);
    await page.keyboard.press('e');
    await selectByMouse(page, '.s1 .standfirst');
    const p = await elCenter(page, '.s1 .standfirst');
    await page.mouse.dblclick(p.x, p.y);

    const s = await fadeState(page, '.s1 .standfirst');
    expect(s.overlap).toBe(false);
    expect(s.faded).toBe(false);
  });

  test('opacity slider fades under overlap and tags the percentage', async ({ page }) => {
    await loadHarness(page);
    await page.keyboard.press('e');
    await moveUnderInspector(page, '.s1 .headline');
    await selectByMouse(page, '.s1 .headline', { x: 20, y: 15 });

    await page.evaluate(() => {
      const slider = document.querySelector('#wfp-editor-root .wfpe-opacity-slider');
      slider.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      slider.value = '60';
      slider.dispatchEvent(new Event('input', { bubbles: true }));
    });
    let s = await fadeState(page, '.s1 .headline');
    expect(s.faded).toBe(true);
    expect(s.tagShown).toBe(true);
    expect(s.tagText).toMatch(/^60\s*%$/);

    await page.evaluate(() => {
      const slider = document.querySelector('#wfp-editor-root .wfpe-opacity-slider');
      slider.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      slider.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await waitForRestore(page);
    const opacity = await page.evaluate(() =>
      getComputedStyle(document.querySelector('.s1 .headline')).opacity);
    expect(Number(opacity)).toBeCloseTo(0.6, 5);
  });

  test('weight seg commit blips the fade; re-clicking the active weight does not', async ({ page }) => {
    await loadHarness(page);
    await page.keyboard.press('e');
    await moveUnderInspector(page, '.s1 .headline');
    await selectByMouse(page, '.s1 .headline', { x: 20, y: 15 });

    // h1 is already bold — clicking Bold is a no-op and must not blip.
    await page.locator(`${ROOT} .wfpe-seg-item[data-wfpe-value="700"]`).click();
    let s = await fadeState(page, '.s1 .headline');
    expect(s.faded).toBe(false);
    expect(s.tagShown).toBe(false);

    await page.locator(`${ROOT} .wfpe-seg-item[data-wfpe-value="500"]`).click();
    s = await fadeState(page, '.s1 .headline');
    expect(s.faded).toBe(true);
    expect(s.tagShown).toBe(true);
    expect(s.tagText).toBe('Med');
    await waitForRestore(page);
  });

  test('resize shows the W × H tag and supersedes the dim bubble, gate stays smart', async ({ page }) => {
    await loadHarness(page);
    await page.keyboard.press('e');
    await selectByMouse(page, '.s1 .headline');

    const se = await page.evaluate(() => {
      const h = document.querySelector('#wfp-editor-root .wfpe-handle-se');
      const r = h.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });
    await page.mouse.move(se.x, se.y);
    await page.mouse.down();
    await page.mouse.move(se.x + 30, se.y + 20, { steps: 5 });

    const dims = await page.evaluate(() => {
      const el = document.querySelector('.s1 .headline');
      return { w: el.offsetWidth, h: el.offsetHeight };
    });
    let s = await fadeState(page, '.s1 .headline');
    expect(s.tagShown).toBe(true);
    expect(s.tagText).toBe(`${dims.w} × ${dims.h}`);
    // Bubble stays hidden while the tag owns the readout, but its text keeps
    // tracking (the v2-2 contract reads it right after mouseup).
    expect(s.bubbleDisplay).toBe('none');
    expect(s.bubbleText).toBe(`${dims.w} × ${dims.h}`);
    // Headline's box is nowhere near the panel — the smart gate holds.
    expect(s.overlap).toBe(false);
    expect(s.faded).toBe(false);

    await page.mouse.up();
    await waitForRestore(page);
    s = await fadeState(page, '.s1 .headline');
    expect(s.tagShown).toBe(false);
    expect(s.bubbleDisplay).toBe('block');
  });

  test('multi-select drag shows no tag and never fades (dock is closed)', async ({ page }) => {
    await loadHarness(page);
    await page.keyboard.press('e');
    await selectByMouse(page, '.s1 .headline');
    const p2 = await elCenter(page, '.s1 .standfirst');
    await page.keyboard.down('ControlOrMeta');
    await page.mouse.click(p2.x, p2.y);
    await page.keyboard.up('ControlOrMeta');

    const start = await elCenter(page, '.s1 .headline');
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x + 200, start.y + 10, { steps: 5 });

    const s = await fadeState(page, null);
    expect(s.dockVisible).toBe('false');
    expect(s.faded).toBe(false);
    expect(s.tagShown).toBe(false);
    await page.mouse.up();
  });
});
