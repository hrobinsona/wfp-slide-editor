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
