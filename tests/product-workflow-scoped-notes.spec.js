import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { EDITOR_PATH, disableFsa } from './_helpers.js';

const panel = '#wfp-editor-root';
const cards = `${panel} .wfpe-notes-card`;
const input = `${panel} .wfpe-scoped-note-input`;
const save = `${panel} [data-action="scoped-note-save"]`;
const remove = `${panel} [data-action="scoped-note-delete"]`;

async function ready(page) {
  await disableFsa(page);
  await page.goto('/fixtures/foreign-deck.html');
  await page.addScriptTag({ path: EDITOR_PATH });
  await page.waitForFunction(() => window.__wfpEditorReady);
  await page.locator(`${panel} [data-action="notes"]`).click();
}
async function note(page, scope, text) {
  await page.locator(`${panel} [data-action="note-${scope}"]`).click();
  await page.locator(input).fill(text);
  await page.locator(save).click();
}
async function downloadHtml(page, clean = false) {
  const downloaded = page.waitForEvent('download', { timeout: 15000 });
  await page.locator(`${panel} [data-action="export"]`).click();
  await page.locator(`${panel} [data-action="${clean ? 'clean-copy' : 'save-in-place'}"]`).click();
  return fs.readFileSync(await (await downloaded).path(), 'utf8');
}
async function reopen(page, html, name) {
  const filename = path.resolve('tests/output', name + '.html');
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  fs.writeFileSync(filename, html);
  await page.goto('/tests/output/' + name + '.html');
  await page.addScriptTag({ path: EDITOR_PATH });
  await page.waitForFunction(() => window.__wfpEditorReady);
  await page.locator(`${panel} [data-action="notes"]`).click();
}

test('slide and deck notes author without element selection, edit/delete and undo in Overview', async ({ page }) => {
  await ready(page);
  await note(page, 'deck', 'Unify the story across the deck.');
  await page.locator(`${panel} [data-action="overview"]`).click();
  await note(page, 'slide', 'Clarify this whole slide.');
  await expect(page.locator(`${cards}[data-scope="deck"]`)).toContainText('Whole deck');
  await expect(page.locator(`${cards}[data-scope="slide"]`)).toContainText('Whole slide');
  await expect(page.locator('.slide').first()).toHaveAttribute('data-wfp-edit-annotation-scope', 'slide');
  await expect(page.locator('.slide [data-wfp-edit-annotation-id]')).toHaveCount(0);
  await page.locator(input).fill('Give this slide a stronger argument.');
  await page.locator(save).click();
  await page.locator(remove).click();
  await expect(page.locator(cards)).toHaveCount(1);
  await page.locator(`${panel} [data-action="undo"]`).click();
  await expect(page.locator(cards)).toHaveCount(2);
  await expect(page.locator(input)).toHaveValue('Give this slide a stronger argument.');
  await page.locator(`${panel} [data-action="undo"]`).click();
  await expect(page.locator(input)).toHaveValue('Clarify this whole slide.');
  await page.locator(`${panel} [data-action="redo"]`).click();
  await expect(page.locator(input)).toHaveValue('Give this slide a stronger argument.');
});

test('handoff scopes, reimport, agent replies and clean export round-trip', async ({ page }) => {
  await ready(page);
  await note(page, 'deck', 'Deck request');
  await note(page, 'slide', 'Slide request');
  const html = await downloadHtml(page);
  const payload = await page.evaluate((text) => {
    const doc = new DOMParser().parseFromString(text, 'text/html');
    return JSON.parse(doc.querySelector('script[data-wfp-agent-annotations]').textContent);
  }, html);
  expect(payload.annotations.map((a) => a.scope)).toEqual(['deck', 'slide']);
  expect(payload.annotations.every((a) => !a.box)).toBe(true);
  await reopen(page, html, 'scoped-note-roundtrip');
  await expect(page.locator(cards)).toHaveCount(2);
  await page.locator(`${cards}[data-scope="deck"]`).click();
  await expect(page.locator(input)).toHaveValue('Deck request');
  const resultHtml = html.replace('</body>', `<script type="application/json" data-wfp-agent-results>${JSON.stringify({results: payload.annotations.map((a) => ({id:a.id,status:a.scope === 'deck' ? 'needs-input' : 'done',note:'Which audience?'}))})}</script></body>`);
  await reopen(page, resultHtml, 'scoped-note-results');
  await expect(page.locator(cards)).toHaveCount(1);
  await expect(page.locator(cards)).toContainText('Agent needs input: Which audience?');
  const again = await downloadHtml(page);
  await reopen(page, again, 'scoped-note-replies');
  await expect(page.locator(cards)).toContainText('Agent needs input: Which audience?');
  const clean = await downloadHtml(page, true);
  expect(clean).not.toContain('data-wfp-agent-annotation-id');
  expect(clean).not.toContain('data-wfp-agent-annotations');
  expect(clean).not.toMatch(/\sdata-wfp-edit-annotation-/);
  await reopen(page, clean, 'scoped-note-clean');
  await expect(page.locator(cards)).toHaveCount(0);
});

test('slide deletion removes its scoped note and undo restores the anchor; cards jump after navigation', async ({ page }) => {
  await ready(page);
  await note(page, 'slide', 'Keep this slide together.');
  await page.locator(`${panel} [data-action="overview"]`).click();
  await page.locator(`${panel} .wfpe-overview-delete`).first().click();
  await expect(page.locator(cards)).toHaveCount(0);
  await page.locator(`${panel} [data-action="undo"]`).click();
  await expect(page.locator(cards)).toHaveCount(1);
  await expect(page.locator('.slide').first()).toHaveAttribute('data-wfp-edit-annotation-scope', 'slide');
  await page.locator(cards).click();
  await expect(page.locator(input)).toHaveValue('Keep this slide together.');
  await expect(page.locator('body')).not.toHaveAttribute('data-wfp-edit-overview', 'on');
  await page.locator(`${panel} [data-action="scoped-note-close"]`).click();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('.slide').nth(1)).toHaveClass(/active/);
  await page.locator(cards).click();
  await expect(page.locator('.slide').first()).toHaveClass(/active/);
});

test('legacy element handoffs still import; skipped scoped results survive editing undo', async ({ page }) => {
  await ready(page);
  await note(page, 'deck', 'Change overall emphasis');
  let html = await downloadHtml(page);
  html = await page.evaluate((source) => {
    const doc = new DOMParser().parseFromString(source, 'text/html');
    const script = doc.querySelector('script[data-wfp-agent-annotations]');
    const payload = JSON.parse(script.textContent);
    const target = [...doc.querySelector('.slide').querySelectorAll('*')].find((el) => el.textContent.trim() && !el.children.length);
    target.setAttribute('data-wfp-agent-annotation-id', 'legacy-element');
    payload.annotations.push({id:'legacy-element', instruction:'Legacy element request', slideIndex:0});
    script.textContent = JSON.stringify(payload);
    const result = doc.createElement('script');
    result.type = 'application/json';
    result.setAttribute('data-wfp-agent-results', '');
    result.textContent = JSON.stringify({results:[{id:payload.annotations[0].id,status:'skipped',note:'Awaiting revised outline'}]});
    doc.body.appendChild(result);
    return '<!doctype html>' + doc.documentElement.outerHTML;
  }, html);
  await reopen(page, html, 'scoped-note-legacy');
  await expect(page.locator(cards)).toHaveCount(2);
  await expect(page.locator(`${cards}[data-scope="element"]`)).toContainText('Legacy element request');
  await page.locator(`${cards}[data-scope="element"]`).click();
  await expect(page.locator(`${panel} .wfpe-annotation-input`)).toHaveValue('Legacy element request');
  await page.locator(`${cards}[data-scope="deck"]`).click();
  await expect(page.locator(`${panel} .wfpe-scoped-note-reply`)).toContainText('Awaiting revised outline');
  await page.locator(input).fill('Use the revised outline');
  await page.locator(save).click();
  await expect(page.locator(`${cards}[data-scope="deck"]`)).not.toHaveAttribute('data-status', 'skipped');
  await page.locator(`${panel} [data-action="undo"]`).click();
  await expect(page.locator(`${cards}[data-scope="deck"]`)).toContainText('Agent skipped: Awaiting revised outline');
});

test('flat documents retain element notes without deck or slide authoring controls', async ({ page }) => {
  await disableFsa(page);
  await page.goto('/fixtures/flat-document.html');
  await page.addScriptTag({path:EDITOR_PATH});
  await page.waitForFunction(() => window.__wfpEditorReady);
  await page.locator(`${panel} [data-action="notes"]`).click();
  await expect(page.locator(`${panel} [data-action="note-slide"]`)).toHaveCount(0);
  await expect(page.locator(`${panel} [data-action="note-deck"]`)).toHaveCount(0);
});

test('keyboard note cycling includes scopes and Shift+Enter saves without navigating slides', async ({ page }) => {
  await ready(page);
  await note(page, 'deck', 'Global keyboard note');
  await page.locator(`${panel} [data-action="note-slide"]`).click();
  await page.locator(input).fill('Slide keyboard note');
  await page.keyboard.press('Shift+Enter');
  await expect(page.locator(cards)).toHaveCount(2);
  await page.keyboard.press('Escape'); // textarea reverts and blurs
  await page.keyboard.press('n');
  await expect(page.locator(input)).toHaveValue('Global keyboard note');
  await page.keyboard.press('Shift+N');
  await expect(page.locator(input)).toHaveValue('Slide keyboard note');
  await expect(page.locator('.slide').first()).toHaveClass(/active/);
});
