import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadFixtureWithEditor } from './_helpers.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = path.join(__dirname, 'output');

test.use({ viewport: { width: 2000, height: 1200 } });

async function setDeckScale(page, scale) {
  await page.evaluate((s) => {
    document.querySelector('.deck').style.transform = `scale(${s})`;
  }, scale);
}

async function addTargets(page) {
  await page.evaluate(() => {
    const slide = document.querySelector('.slide.active');
    const makeAbs = (name, left, top) => {
      const el = document.createElement('div');
      el.dataset[name] = 'true';
      el.textContent = name;
      el.style.cssText = [
        'position:absolute',
        `left:${left}px`,
        `top:${top}px`,
        'width:90px',
        'height:42px',
        'box-sizing:border-box',
        'padding:8px',
        'background:#eaf3ff',
        'border:1px solid #5b9bd9',
        'font-size:16px',
        'z-index:20',
      ].join(';');
      slide.appendChild(el);
      return el;
    };
    makeAbs('msA', 100, 120);
    makeAbs('msB', 260, 180);
    makeAbs('msC', 430, 220);

    const wrap = document.createElement('div');
    wrap.dataset.msFlowWrap = 'true';
    wrap.style.cssText = [
      'position:absolute',
      'left:620px',
      'top:140px',
      'width:320px',
      'height:78px',
      'display:flex',
      'gap:12px',
      'align-items:flex-start',
      'z-index:20',
    ].join(';');
    const flow = document.createElement('div');
    flow.dataset.msFlow = 'true';
    flow.textContent = 'flow';
    flow.style.cssText = [
      'padding:10px',
      'width:110px',
      'height:44px',
      'box-sizing:border-box',
      'background:#fff7ed',
      'border:1px solid #f97316',
    ].join(';');
    const sibling = document.createElement('div');
    sibling.textContent = 'sibling';
    sibling.style.cssText = [
      'padding:10px',
      'width:110px',
      'height:44px',
      'box-sizing:border-box',
      'background:#f8fafc',
      'border:1px solid #94a3b8',
    ].join(';');
    wrap.append(flow, sibling);
    slide.appendChild(wrap);
  });
}

async function setup(page, scale = 1) {
  await loadFixtureWithEditor(page, 'Townhall-1.html');
  await setDeckScale(page, scale);
  await page.keyboard.press('e');
  await addTargets(page);
}

async function mouseSequence(page, selector, options = {}) {
  await page.evaluate(({ sel, opts }) => {
    const el = document.querySelector(sel);
    if (!el) throw new Error(`No element matching ${sel}`);
    const r = el.getBoundingClientRect();
    const base = {
      bubbles: true,
      cancelable: true,
      view: window,
      clientX: r.left + r.width / 2,
      clientY: r.top + r.height / 2,
      button: 0,
      metaKey: !!opts.metaKey,
      ctrlKey: !!opts.ctrlKey,
    };
    el.dispatchEvent(new MouseEvent('mousedown', { ...base, buttons: 1 }));
    el.dispatchEvent(new MouseEvent('mouseup', { ...base, buttons: 0 }));
    el.dispatchEvent(new MouseEvent('click', { ...base, buttons: 0 }));
  }, { sel: selector, opts: options });
}

async function commandClick(page, selector) {
  await mouseSequence(page, selector, { metaKey: true });
}

async function ctrlClick(page, selector) {
  await mouseSequence(page, selector, { ctrlKey: true });
}

async function readUiState(page) {
  return page.evaluate(() => {
    const root = document.querySelector('#wfp-editor-root');
    return {
      groupDisplay: root.querySelector('.wfpe-multi-box').style.display,
      outlines: root.querySelectorAll('.wfpe-multi-outline').length,
      inspectorVisible: root.querySelector('.wfpe-inspector').dataset.visible,
      ringDisplay: root.querySelector('.wfpe-selection-ring').style.display,
      dimDisplay: root.querySelector('.wfpe-dim-bubble').style.display,
      visibleHandles: [...root.querySelectorAll('.wfpe-handle')]
        .filter((h) => h.style.display !== 'none').length,
    };
  });
}

async function readOffsets(page) {
  return page.evaluate(() => {
    const read = (sel) => {
      const el = document.querySelector(sel);
      return { left: el.offsetLeft, top: el.offsetTop };
    };
    return {
      a: read('[data-ms-a]'),
      b: read('[data-ms-b]'),
      c: read('[data-ms-c]'),
      flow: read('[data-ms-flow]'),
    };
  });
}

async function viewportCenterOf(page, selector) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }, selector);
}

async function dragByViewportPx(page, selector, dxViewport, dyViewport) {
  const { x, y } = await viewportCenterOf(page, selector);
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dxViewport / 2, y + dyViewport / 2, { steps: 4 });
  await page.mouse.move(x + dxViewport, y + dyViewport, { steps: 4 });
  await page.mouse.up();
}

async function triggerExport(page) {
  const downloadPromise = page.waitForEvent('download', { timeout: 5_000 });
  await page.keyboard.press('ControlOrMeta+s');
  return downloadPromise;
}

async function readDownloadAsString(download) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const out = path.join(OUTPUT_DIR, download.suggestedFilename());
  await download.saveAs(out);
  return fs.readFileSync(out, 'utf-8');
}

test.describe('v2.x multi-select move', () => {
  test('Cmd/Ctrl-click toggles elements into and out of a group', async ({ page }) => {
    await setup(page);

    await commandClick(page, '[data-ms-a]');
    let ui = await readUiState(page);
    expect(ui.groupDisplay).toBe('none');
    expect(ui.ringDisplay).toBe('block');
    expect(ui.inspectorVisible).toBe('true');

    await ctrlClick(page, '[data-ms-b]');
    ui = await readUiState(page);
    expect(ui.groupDisplay).toBe('block');
    expect(ui.outlines).toBe(2);
    expect(ui.inspectorVisible).toBe('false');
    expect(ui.ringDisplay).toBe('none');
    expect(ui.dimDisplay).toBe('none');
    expect(ui.visibleHandles).toBe(0);

    await commandClick(page, '[data-ms-a]');
    ui = await readUiState(page);
    expect(ui.groupDisplay).toBe('none');
    expect(ui.ringDisplay).toBe('block');
    expect(ui.inspectorVisible).toBe('true');
  });

  test('plain click resets a group to a single selection', async ({ page }) => {
    await setup(page);
    await commandClick(page, '[data-ms-a]');
    await commandClick(page, '[data-ms-b]');
    expect((await readUiState(page)).groupDisplay).toBe('block');

    await mouseSequence(page, '[data-ms-c]');
    const ui = await readUiState(page);
    expect(ui.groupDisplay).toBe('none');
    expect(ui.ringDisplay).toBe('block');
    expect(ui.inspectorVisible).toBe('true');
  });

  test('canvas click, edit-mode off, overview entry, and slide change clear a group', async ({ page }) => {
    await setup(page);
    await commandClick(page, '[data-ms-a]');
    await commandClick(page, '[data-ms-b]');

    await page.evaluate(() => {
      const slide = document.querySelector('.slide.active');
      slide.dispatchEvent(new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
        view: window,
        clientX: 5,
        clientY: 5,
      }));
    });
    expect((await readUiState(page)).groupDisplay).toBe('none');

    await commandClick(page, '[data-ms-a]');
    await commandClick(page, '[data-ms-b]');
    await page.keyboard.press('e');
    expect((await readUiState(page)).groupDisplay).toBe('none');

    await page.keyboard.press('e');
    await commandClick(page, '[data-ms-a]');
    await commandClick(page, '[data-ms-b]');
    await page.keyboard.press('o');
    expect((await readUiState(page)).groupDisplay).toBe('none');

    await page.keyboard.press('o');
    await commandClick(page, '[data-ms-a]');
    await commandClick(page, '[data-ms-b]');
    await page.evaluate(() => {
      const slides = [...document.querySelectorAll('.deck > .slide')];
      slides[0].classList.remove('active');
      slides[1].classList.add('active');
    });
    await page.waitForFunction(() => {
      return document.querySelector('#wfp-editor-root .wfpe-multi-box').style.display === 'none';
    });
  });

  test('group drag moves all selected elements with scale-aware deltas', async ({ page }) => {
    await setup(page, 0.5);
    await commandClick(page, '[data-ms-a]');
    await commandClick(page, '[data-ms-b]');
    const before = await readOffsets(page);

    await dragByViewportPx(page, '[data-ms-a]', 100, 50);
    const after = await readOffsets(page);

    expect(after.a.left - before.a.left).toBeCloseTo(200, 0);
    expect(after.a.top - before.a.top).toBeCloseTo(100, 0);
    expect(after.b.left - before.b.left).toBeCloseTo(200, 0);
    expect(after.b.top - before.b.top).toBeCloseTo(100, 0);
    expect((await readUiState(page)).groupDisplay).toBe('block');
  });

  test('group drag respects the deadzone', async ({ page }) => {
    await setup(page);
    await commandClick(page, '[data-ms-a]');
    await commandClick(page, '[data-ms-b]');
    const before = await readOffsets(page);

    const { x, y } = await viewportCenterOf(page, '[data-ms-a]');
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 2, y + 1, { steps: 2 });
    await page.mouse.up();

    expect(await readOffsets(page)).toEqual(before);
  });

  test('dragging an unselected element resets from group drag to single drag', async ({ page }) => {
    await setup(page);
    await commandClick(page, '[data-ms-a]');
    await commandClick(page, '[data-ms-b]');
    const before = await readOffsets(page);

    await dragByViewportPx(page, '[data-ms-c]', 40, 20);
    const after = await readOffsets(page);
    const ui = await readUiState(page);

    expect(after.a).toEqual(before.a);
    expect(after.b).toEqual(before.b);
    expect(after.c.left - before.c.left).toBeCloseTo(40, 0);
    expect(after.c.top - before.c.top).toBeCloseTo(20, 0);
    expect(ui.groupDisplay).toBe('none');
    expect(ui.inspectorVisible).toBe('true');
  });

  test('mixed flow and absolute selections move together and undo in one step', async ({ page }) => {
    await setup(page);
    await commandClick(page, '[data-ms-flow]');
    await commandClick(page, '[data-ms-a]');
    const before = await readOffsets(page);

    await dragByViewportPx(page, '[data-ms-flow]', 30, 20);
    const moved = await readOffsets(page);
    expect(moved.flow.left - before.flow.left).toBeCloseTo(30, 0);
    expect(moved.flow.top - before.flow.top).toBeCloseTo(20, 0);
    expect(moved.a.left - before.a.left).toBeCloseTo(30, 0);
    expect(moved.a.top - before.a.top).toBeCloseTo(20, 0);

    const flowPosition = await page.evaluate(
      () => getComputedStyle(document.querySelector('[data-ms-flow]')).position,
    );
    expect(flowPosition).toBe('absolute');

    await page.keyboard.press('ControlOrMeta+z');
    expect(await readOffsets(page)).toEqual(before);

    await page.keyboard.press('ControlOrMeta+Shift+z');
    expect(await readOffsets(page)).toEqual(moved);

    const download = await triggerExport(page);
    const html = await readDownloadAsString(download);
    expect(html).not.toMatch(/data-wfp-edit[-a-zA-Z]*\s*=/);
    expect(html).toContain('data-ms-flow="true"');
    expect(html).toMatch(new RegExp(`data-ms-flow="true"[^>]*left:\\s*${moved.flow.left}px`));
    expect(html).toMatch(new RegExp(`data-ms-flow="true"[^>]*top:\\s*${moved.flow.top}px`));
    expect(html).toMatch(new RegExp(`data-ms-a="true"[^>]*left:\\s*${moved.a.left}px`));
    expect(html).toMatch(new RegExp(`data-ms-a="true"[^>]*top:\\s*${moved.a.top}px`));
  });

  test('ancestor and descendant cannot both remain selected; latest click wins', async ({ page }) => {
    await setup(page);
    await page.evaluate(() => {
      const parent = document.createElement('div');
      parent.dataset.msParent = 'true';
      parent.style.cssText = [
        'position:absolute',
        'left:980px',
        'top:120px',
        'width:180px',
        'height:100px',
        'background:#eef2ff',
        'z-index:20',
      ].join(';');
      const child = document.createElement('div');
      child.dataset.msChild = 'true';
      child.textContent = 'child';
      child.style.cssText = 'width:90px;height:40px;background:#c7d2fe;margin:20px;';
      parent.appendChild(child);
      document.querySelector('.slide.active').appendChild(parent);
    });

    await commandClick(page, '[data-ms-parent]');
    await commandClick(page, '[data-ms-a]');
    expect((await readUiState(page)).outlines).toBe(2);

    await commandClick(page, '[data-ms-child]');
    const ui = await readUiState(page);
    expect(ui.groupDisplay).toBe('block');
    expect(ui.outlines).toBe(2);
  });

  test('group delete and copy do not act on only the primary element', async ({ page }) => {
    await setup(page);

    await mouseSequence(page, '[data-ms-c]');
    await page.keyboard.press('ControlOrMeta+c');

    await commandClick(page, '[data-ms-a]');
    await commandClick(page, '[data-ms-b]');
    await page.keyboard.press('Delete');
    let counts = await page.evaluate(() => ({
      a: document.querySelectorAll('[data-ms-a]').length,
      b: document.querySelectorAll('[data-ms-b]').length,
      c: document.querySelectorAll('[data-ms-c]').length,
    }));
    expect(counts).toEqual({ a: 1, b: 1, c: 1 });
    expect((await readUiState(page)).groupDisplay).toBe('block');

    await page.keyboard.press('ControlOrMeta+c');
    await page.keyboard.press('ControlOrMeta+v');
    counts = await page.evaluate(() => ({
      a: document.querySelectorAll('[data-ms-a]').length,
      b: document.querySelectorAll('[data-ms-b]').length,
      c: document.querySelectorAll('[data-ms-c]').length,
    }));
    expect(counts).toEqual({ a: 1, b: 1, c: 2 });
  });

  test('font-size arrow keys are consumed but do not mutate a multi-selection', async ({ page }) => {
    await setup(page);
    await commandClick(page, '[data-ms-a]');
    await commandClick(page, '[data-ms-b]');

    const before = await page.evaluate(() => {
      window.__msArrowBubbleCount = 0;
      document.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowUp') window.__msArrowBubbleCount += 1;
      });
      return parseFloat(getComputedStyle(document.querySelector('[data-ms-a]')).fontSize);
    });

    await page.keyboard.press('ArrowUp');

    const after = await page.evaluate(() => ({
      fontSize: parseFloat(getComputedStyle(document.querySelector('[data-ms-a]')).fontSize),
      bubbles: window.__msArrowBubbleCount,
      groupDisplay: document.querySelector('#wfp-editor-root .wfpe-multi-box').style.display,
    }));
    expect(after.fontSize).toBeCloseTo(before, 0);
    expect(after.bubbles).toBe(0);
    expect(after.groupDisplay).toBe('block');
  });

  test('export after group move preserves positions and strips multi-select chrome', async ({ page }) => {
    await setup(page);
    await commandClick(page, '[data-ms-a]');
    await commandClick(page, '[data-ms-b]');
    await dragByViewportPx(page, '[data-ms-a]', 40, 20);

    const download = await triggerExport(page);
    const html = await readDownloadAsString(download);

    expect(html).not.toContain('id="wfp-editor-root"');
    expect(html).not.toContain('wfpe-multi-box');
    expect(html).not.toContain('wfpe-multi-outline');
    expect(html).toMatch(/data-ms-a="true"[^>]*left:\s*140px/);
    expect(html).toMatch(/data-ms-b="true"[^>]*left:\s*300px/);
  });
});
