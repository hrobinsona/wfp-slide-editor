import { test, expect } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// v2.5 reset styles — reworked contract (2026-07). Reset restores the
// selected element's inline `style` to its pre-edit original: the value
// captured the first time an editor transaction changed the element.
// The previous "clear the whole attribute" semantics destroyed styles
// authored in the deck HTML (position/size), dropping the element to the
// slide origin with auto dimensions. Runs against dev/harness.html like
// the v2-10/v2-12 specs so it needs no private fixtures.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const HARNESS_PATH = path.join(PROJECT_ROOT, 'dev', 'harness.html');

const ROOT = '#wfp-editor-root';
const RESET_BTN = `${ROOT} .wfpe-inspector .wfpe-reset-btn`;
const FONT_INPUT = `${ROOT} .wfpe-inspector input[data-wfpe-prop="fontSize"]`;

// Mirrors how real WFP decks position elements: geometry authored as an
// inline style in the deck HTML itself.
const AUTHORED_STYLE =
  'position: absolute; left: 120px; top: 80px; width: 300px; height: 140px; background: rgb(18, 52, 86);';

test.use({ viewport: { width: 1600, height: 1000 } });

async function loadHarness(page) {
  await page.goto(pathToFileURL(HARNESS_PATH).href);
  await page.waitForFunction(() => window.__wfpEditorReady === true, null, { timeout: 10_000 });
}

async function addAuthoredElement(page) {
  await page.evaluate((styleText) => {
    const el = document.createElement('div');
    el.className = 'authored-box';
    el.setAttribute('style', styleText);
    el.textContent = 'Authored box';
    document.querySelector('.slide.active').appendChild(el);
  }, AUTHORED_STYLE);
}

async function addFlowUnlockGroup(page) {
  await page.evaluate(() => {
    const group = document.createElement('div');
    group.dataset.testFlowGroup = 'true';
    group.setAttribute(
      'style',
      'position: absolute; left: 180px; top: 520px; display: flex; gap: 20px; align-items: stretch;'
    );
    for (const label of ['Plan', 'Review', 'Publish']) {
      const item = document.createElement('div');
      item.dataset.testFlowItem = label.toLowerCase();
      item.setAttribute(
        'style',
        'box-sizing: border-box; width: 150px; min-height: 72px; padding: 18px; background: rgb(238, 241, 245);'
      );
      item.textContent = label;
      group.appendChild(item);
    }
    document.querySelector('.slide.active').appendChild(group);
  });
}

async function addNestedFlowUnlockGroup(page) {
  await page.evaluate(() => {
    const outer = document.createElement('div');
    outer.dataset.testNestedOuter = 'true';
    outer.setAttribute(
      'style',
      'position: absolute; left: 180px; top: 500px; display: flex; gap: 20px; align-items: stretch;'
    );

    const laneA = document.createElement('div');
    laneA.dataset.testNestedPart = 'lane-a';
    laneA.setAttribute(
      'style',
      'box-sizing: border-box; width: 220px; min-height: 120px; padding: 18px; background: rgb(238, 241, 245);'
    );
    laneA.textContent = 'Lane A';

    const laneB = document.createElement('div');
    laneB.dataset.testNestedPart = 'lane-b';
    laneB.setAttribute(
      'style',
      'box-sizing: border-box; width: 220px; min-height: 120px; padding: 12px; display: flex; gap: 10px; background: rgb(224, 230, 238);'
    );
    for (const label of ['B1', 'B2']) {
      const item = document.createElement('div');
      item.dataset.testNestedPart = label.toLowerCase();
      item.setAttribute(
        'style',
        'box-sizing: border-box; width: 88px; min-height: 72px; padding: 14px; background: rgb(255, 255, 255);'
      );
      item.textContent = label;
      laneB.appendChild(item);
    }

    outer.append(laneA, laneB);
    document.querySelector('.slide.active').appendChild(outer);
  });
}

async function selectByMouse(page, selector) {
  const center = await page.evaluate((sel) => {
    const r = document.querySelector(sel).getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }, selector);
  await page.mouse.move(center.x, center.y);
  await page.mouse.down();
  await page.mouse.up();
}

async function dragBy(page, selector, dx, dy) {
  const center = await page.evaluate((sel) => {
    const r = document.querySelector(sel).getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }, selector);
  await page.mouse.move(center.x, center.y);
  await page.mouse.down();
  await page.mouse.move(center.x + dx, center.y + dy, { steps: 8 });
  await page.mouse.up();
}

async function setSelectedFontSize(page, value) {
  const input = page.locator(FONT_INPUT);
  await input.click({ clickCount: 3 });
  await input.fill(String(value));
  await input.press('Enter');
}

function getStyleAttr(page, selector) {
  return page.evaluate(
    (sel) => document.querySelector(sel).getAttribute('style'),
    selector
  );
}

function getSlideRect(page, selector) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    const cs = getComputedStyle(el);
    return { left: cs.left, top: cs.top, width: cs.width, height: cs.height };
  }, selector);
}

function getFlowGroupState(page) {
  return page.evaluate(() => {
    const parent = document.querySelector('[data-test-flow-group="true"]');
    const entries = [['parent', parent]];
    for (const child of parent.children) {
      entries.push([child.dataset.testFlowItem, child]);
    }
    return Object.fromEntries(entries.map(([key, el]) => [key, {
      style: el.getAttribute('style'),
      frozen: el.getAttribute('data-wfp-edit-frozen'),
      flexFrozen: el.getAttribute('data-wfp-edit-flex-frozen'),
      connected: el.isConnected,
    }]));
  });
}

function getNestedFlowGroupState(page) {
  return page.evaluate(() => {
    const keys = ['outer', 'lane-a', 'lane-b', 'b1', 'b2'];
    const elements = [
      document.querySelector('[data-test-nested-outer="true"]'),
      ...keys.slice(1).map((key) => document.querySelector(`[data-test-nested-part="${key}"]`)),
    ];
    return Object.fromEntries(keys.map((key, index) => {
      const el = elements[index];
      return [key, {
        style: el.getAttribute('style'),
        frozen: el.getAttribute('data-wfp-edit-frozen'),
        flexFrozen: el.getAttribute('data-wfp-edit-flex-frozen'),
        connected: el.isConnected,
      }];
    }));
  });
}

function getFlowUnlockDiagnostics(page) {
  return page.evaluate(() => {
    const root = document.querySelector('#wfp-editor-root');
    return {
      groups: Number(root.dataset.flowUnlockGroupCount),
      records: Number(root.dataset.flowUnlockRecordCount),
    };
  });
}

async function expectSelectionConnected(page) {
  const selection = await page.evaluate(() => {
    const ring = document.querySelector('#wfp-editor-root .wfpe-selection-ring');
    const inspectorDock = document.querySelector('#wfp-editor-root .wfpe-inspector-dock');
    return {
      ringDisplay: ring.style.display,
      ringWidth: ring.getBoundingClientRect().width,
      inspectorVisible: inspectorDock.dataset.visible,
    };
  });
  expect(selection.ringDisplay).toBe('block');
  expect(selection.ringWidth).toBeGreaterThan(0);
  expect(selection.inspectorVisible).toBe('true');
}

test.describe('v2.5 — reset styles (restore pre-edit original)', () => {
  test.beforeEach(async ({ page }) => {
    await loadHarness(page);
    await addAuthoredElement(page);
    await page.keyboard.press('e');
  });

  test('reset after a drag restores authored inline styles, not clears them', async ({ page }) => {
    const original = await getSlideRect(page, '.authored-box');

    await selectByMouse(page, '.authored-box');
    await dragBy(page, '.authored-box', 90, 60);
    const dragged = await getStyleAttr(page, '.authored-box');
    expect(dragged).not.toBe(AUTHORED_STYLE);

    await page.locator(RESET_BTN).click();
    expect(await getStyleAttr(page, '.authored-box')).toBe(AUTHORED_STYLE);
    expect(await getSlideRect(page, '.authored-box')).toEqual(original);
  });

  test('reset after inspector edits is one history entry: undo returns the edit, redo the original', async ({ page }) => {
    await selectByMouse(page, '.authored-box');

    const input = page.locator(FONT_INPUT);
    await input.click({ clickCount: 3 });
    await input.fill('44');
    await input.press('Enter');
    const edited = await getStyleAttr(page, '.authored-box');
    expect(edited).not.toBe(AUTHORED_STYLE);

    await page.locator(RESET_BTN).click();
    expect(await getStyleAttr(page, '.authored-box')).toBe(AUTHORED_STYLE);

    // One undo → the edited state (reset was exactly one entry).
    await page.keyboard.press('Control+z');
    expect(await getStyleAttr(page, '.authored-box')).toBe(edited);

    // Redo re-applies the reset.
    await page.keyboard.press('Control+Shift+z');
    expect(await getStyleAttr(page, '.authored-box')).toBe(AUTHORED_STYLE);
  });

  test('reset on a never-edited element is a no-op (no mutation, no history entry)', async ({ page }) => {
    await selectByMouse(page, '.authored-box');

    await page.evaluate(() => {
      window.__resetMutations = 0;
      const obs = new MutationObserver((muts) => {
        for (const m of muts) {
          if (m.attributeName === 'style') window.__resetMutations++;
        }
      });
      obs.observe(document.querySelector('.authored-box'), { attributes: true });
      window.__resetObserver = obs;
    });
    await page.locator(RESET_BTN).click();
    const muts = await page.evaluate(() => {
      window.__resetObserver.disconnect();
      return window.__resetMutations;
    });
    expect(muts).toBe(0);
    expect(await getStyleAttr(page, '.authored-box')).toBe(AUTHORED_STYLE);

    // Undo must have nothing to unwind — the authored styles stay put.
    await page.keyboard.press('Control+z');
    expect(await getStyleAttr(page, '.authored-box')).toBe(AUTHORED_STYLE);
  });

  test('reset returns a stylesheet-styled element to no inline style and repopulates readouts', async ({ page }) => {
    const original = await page.evaluate(
      () => parseFloat(getComputedStyle(document.querySelector('.s1 .headline')).fontSize)
    );

    await selectByMouse(page, '.s1 .headline');
    const input = page.locator(FONT_INPUT);
    await input.click({ clickCount: 3 });
    await input.fill(String(Math.round(original) + 30));
    await input.press('Enter');

    await page.locator(RESET_BTN).click();
    expect(await getStyleAttr(page, '.s1 .headline')).toBe(null);

    const liveVal = await page.evaluate(
      () => parseFloat(getComputedStyle(document.querySelector('.s1 .headline')).fontSize)
    );
    expect(Math.round(liveVal)).toBe(Math.round(original));
    const inspectorVal = await page.evaluate(
      (sel) => Number(document.querySelector(sel).value),
      FONT_INPUT
    );
    expect(inspectorVal).toBe(Math.round(liveVal));
  });

  test('reset preserves the editor selection (ring stays on the element)', async ({ page }) => {
    await selectByMouse(page, '.authored-box');
    await dragBy(page, '.authored-box', 40, 30);

    await page.locator(RESET_BTN).click();
    const ringDisplay = await page.evaluate(
      () => document.querySelector('#wfp-editor-root .wfpe-selection-ring').style.display
    );
    expect(ringDisplay).toBe('block');
  });

  test('reset restores an unlock-frozen flow group as one atomic history entry', async ({ page }) => {
    await addFlowUnlockGroup(page);
    const original = await getFlowGroupState(page);

    await selectByMouse(page, '[data-test-flow-item="plan"]');
    await dragBy(page, '[data-test-flow-item="plan"]', 70, 35);
    const frozen = await getFlowGroupState(page);
    expect(frozen.parent.flexFrozen).toBe('true');
    for (const role of ['plan', 'review', 'publish']) {
      expect(frozen[role].frozen).toBe('true');
      expect(frozen[role].style).not.toBe(original[role].style);
    }

    await page.locator(RESET_BTN).click();
    expect(await getFlowGroupState(page)).toEqual(original);
    await expectSelectionConnected(page);

    // One undo restores the complete edited/frozen group, proving Reset
    // contributed one atomic history entry rather than one entry per member.
    await page.keyboard.press('Control+z');
    expect(await getFlowGroupState(page)).toEqual(frozen);
    await expectSelectionConnected(page);

    await page.keyboard.press('Control+Shift+z');
    expect(await getFlowGroupState(page)).toEqual(original);
    await expectSelectionConnected(page);
  });

  test('reset preserves a sibling deliberately moved after its mechanical pin', async ({ page }) => {
    await addFlowUnlockGroup(page);
    const original = await getFlowGroupState(page);

    await selectByMouse(page, '[data-test-flow-item="plan"]');
    await dragBy(page, '[data-test-flow-item="plan"]', 70, 35);
    const initiallyFrozen = await getFlowGroupState(page);

    // A later editor gesture makes Review user-authored rather than a
    // mechanical pin. Resetting Plan must not silently discard that move.
    await selectByMouse(page, '[data-test-flow-item="review"]');
    await dragBy(page, '[data-test-flow-item="review"]', 60, 20);
    const afterSiblingMove = await getFlowGroupState(page);
    expect(afterSiblingMove.review.style).not.toBe(initiallyFrozen.review.style);

    await selectByMouse(page, '[data-test-flow-item="plan"]');
    await page.locator(RESET_BTN).click();
    const reset = await getFlowGroupState(page);

    expect(reset.plan).toEqual(original.plan);
    expect(reset.publish).toEqual(original.publish);
    expect(reset.review).toEqual(afterSiblingMove.review);
    // The container pin remains necessary while Review is still absolute;
    // restoring it would change Review's containing block and visual result.
    expect(reset.parent).toEqual(afterSiblingMove.parent);
    await expectSelectionConnected(page);

    await page.keyboard.press('Control+z');
    expect(await getFlowGroupState(page)).toEqual(afterSiblingMove);
    await expectSelectionConnected(page);

    await page.keyboard.press('Control+Shift+z');
    expect(await getFlowGroupState(page)).toEqual(reset);
    await expectSelectionConnected(page);
  });

  test('an older group reset cannot remove a newer nested unlock dependency', async ({ page }) => {
    await addNestedFlowUnlockGroup(page);
    const original = await getNestedFlowGroupState(page);

    // Group 1 freezes the outer row and both lanes.
    await selectByMouse(page, '[data-test-nested-part="lane-a"]');
    await dragBy(page, '[data-test-nested-part="lane-a"]', -50, 25);

    // Group 2 overlaps Group 1 at Lane B, then freezes B1/B2 inside it.
    await selectByMouse(page, '[data-test-nested-part="b1"]');
    await dragBy(page, '[data-test-nested-part="b1"]', 25, 15);
    const nestedFrozen = await getNestedFlowGroupState(page);
    expect(nestedFrozen.outer.flexFrozen).toBe('true');
    expect(nestedFrozen['lane-b'].frozen).toBe('true');
    expect(nestedFrozen['lane-b'].flexFrozen).toBe('true');
    expect(nestedFrozen.b1.frozen).toBe('true');
    expect(nestedFrozen.b2.frozen).toBe('true');

    await selectByMouse(page, '[data-test-nested-part="lane-a"]');
    await page.locator(RESET_BTN).click();
    const resetOlderGroup = await getNestedFlowGroupState(page);

    expect(resetOlderGroup['lane-a']).toEqual(original['lane-a']);
    // Lane B is owned by the newer active group. Its style/markers and the
    // outer containing block it depends on must survive the older reset.
    expect(resetOlderGroup.outer).toEqual(nestedFrozen.outer);
    expect(resetOlderGroup['lane-b']).toEqual(nestedFrozen['lane-b']);
    expect(resetOlderGroup.b1).toEqual(nestedFrozen.b1);
    expect(resetOlderGroup.b2).toEqual(nestedFrozen.b2);

    await page.keyboard.press('Control+z');
    expect(await getNestedFlowGroupState(page)).toEqual(nestedFrozen);
  });

  test('undoing an unlock retires its group so later Reset uses the pristine original', async ({ page }) => {
    await addFlowUnlockGroup(page);
    const original = await getFlowGroupState(page);

    await selectByMouse(page, '[data-test-flow-item="plan"]');
    await setSelectedFontSize(page, 31);
    const preUnlock = await getFlowGroupState(page);
    expect(preUnlock.plan.style).not.toBe(original.plan.style);

    await dragBy(page, '[data-test-flow-item="plan"]', 70, 35);
    await page.keyboard.press('Control+z');
    expect(await getFlowGroupState(page)).toEqual(preUnlock);

    await setSelectedFontSize(page, 43);
    await page.locator(RESET_BTN).click();
    expect(await getFlowGroupState(page)).toEqual(original);
    await expectSelectionConnected(page);
  });

  test('a completed group reset retires metadata before later ordinary edits', async ({ page }) => {
    await addFlowUnlockGroup(page);
    const original = await getFlowGroupState(page);

    await selectByMouse(page, '[data-test-flow-item="plan"]');
    await setSelectedFontSize(page, 31);
    const preUnlock = await getFlowGroupState(page);

    await dragBy(page, '[data-test-flow-item="plan"]', 70, 35);
    await page.locator(RESET_BTN).click();
    expect(await getFlowGroupState(page)).toEqual(preUnlock);

    // The group reset remains a normal round-trippable history entry.
    const frozen = await page.evaluate(() => {
      const parent = document.querySelector('[data-test-flow-group="true"]');
      return parent.getAttribute('data-wfp-edit-flex-frozen');
    });
    expect(frozen).toBe(null);
    await page.keyboard.press('Control+z');
    expect((await getFlowGroupState(page)).parent.flexFrozen).toBe('true');
    await page.keyboard.press('Control+Shift+z');
    expect(await getFlowGroupState(page)).toEqual(preUnlock);

    await setSelectedFontSize(page, 43);
    await page.locator(RESET_BTN).click();
    expect(await getFlowGroupState(page)).toEqual(original);
    await expectSelectionConnected(page);
  });

  test('retired provenance is pruned after history eviction, including detached members', async ({ page }) => {
    await addFlowUnlockGroup(page);
    await selectByMouse(page, '[data-test-flow-item="plan"]');

    // 31 unlock/reset pairs plus one early delete = 63 history entries.
    // With HISTORY_MAX=50, only the newest 25 two-entry groups remain
    // reactivatable. The first group's deleted Publish member must not keep
    // that evicted group alive through its records map.
    for (let i = 0; i < 31; i++) {
      await dragBy(page, '[data-test-flow-item="plan"]', 22 + (i % 2), 12);
      await page.locator(RESET_BTN).click();

      if (i === 0) {
        await selectByMouse(page, '[data-test-flow-item="publish"]');
        await page.keyboard.press('Delete');
        expect(await page.locator('[data-test-flow-item="publish"]').count()).toBe(0);
        await selectByMouse(page, '[data-test-flow-item="plan"]');
      }
    }

    const diagnostics = await getFlowUnlockDiagnostics(page);
    expect(diagnostics.groups).toBe(25);
    expect(diagnostics.records).toBe(75);
  });

  test('redo truncation prunes abandoned groups through element and slide history', async ({ page }) => {
    await addFlowUnlockGroup(page);
    const original = await getFlowGroupState(page);
    await selectByMouse(page, '[data-test-flow-item="plan"]');

    // An ordinary element entry truncates the redoable unlock.
    await dragBy(page, '[data-test-flow-item="plan"]', 40, 20);
    await page.keyboard.press('Control+z');
    await setSelectedFontSize(page, 35);
    expect(await getFlowUnlockDiagnostics(page)).toMatchObject({ groups: 0, records: 0 });
    await page.locator(RESET_BTN).click();
    expect(await getFlowGroupState(page)).toEqual(original);

    // A slide-op entry uses a separate history-push path and must trigger the
    // same cleanup after truncating a second redoable unlock.
    await dragBy(page, '[data-test-flow-item="plan"]', 40, 20);
    await page.keyboard.press('Control+z');
    await page.keyboard.press('o');
    const beforeSlides = await page.locator('.deck > .slide').count();
    await page.locator('#wfp-editor-root .wfpe-overview-add').last().click();
    expect(await page.locator('.deck > .slide').count()).toBe(beforeSlides + 1);
    expect(await getFlowUnlockDiagnostics(page)).toMatchObject({ groups: 0, records: 0 });
    await page.keyboard.press('Escape');

    // Cleanup must not weaken latest-active ownership for later overlapping
    // groups created in the same session.
    await addNestedFlowUnlockGroup(page);
    await selectByMouse(page, '[data-test-nested-part="lane-a"]');
    await dragBy(page, '[data-test-nested-part="lane-a"]', -50, 25);
    await selectByMouse(page, '[data-test-nested-part="b1"]');
    await dragBy(page, '[data-test-nested-part="b1"]', 25, 15);
    const nestedFrozen = await getNestedFlowGroupState(page);
    await selectByMouse(page, '[data-test-nested-part="lane-a"]');
    await page.locator(RESET_BTN).click();
    const resetOlderGroup = await getNestedFlowGroupState(page);
    expect(resetOlderGroup.outer).toEqual(nestedFrozen.outer);
    expect(resetOlderGroup['lane-b']).toEqual(nestedFrozen['lane-b']);
  });
});
