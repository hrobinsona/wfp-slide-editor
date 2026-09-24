import fs from 'node:fs/promises';
import { test, expect } from '@playwright/test';
import { EDITOR_PATH, disableFsa } from './_helpers.js';

async function boot(page, scale = 1) {
  await disableFsa(page);
  await page.goto('/fixtures/foreign-deck.html');
  await page.evaluate(scale => {
    const slide = document.querySelector('.slide.active');
    slide.innerHTML = '<div id="item-a">First box</div><div id="item-b">Second box</div><div id="item-c">Third box</div>';
    slide.style.cssText = 'position:absolute;inset:0;width:900px;height:600px;';
    slide.parentElement.style.cssText = 'position:relative;width:900px;height:600px;transform-origin:top left;transform:scale(' + scale + ')';
    for (const [i, el] of [...slide.children].entries()) el.style.cssText = `position:absolute;left:${100 + i * 180}px;top:150px;width:110px;height:60px;background:#abc;color:#123;font:18px system-ui`;
  }, scale);
  await page.addScriptTag({ path: EDITOR_PATH });
  await page.waitForFunction(() => window.__wfpEditorReady);
  await page.keyboard.press('e');
}
async function rectangle(page, x1, y1, x2, y2) {
  await page.mouse.move(x1, y1);
  await page.mouse.down();
  await page.mouse.move(x2, y2, { steps: 8 });
  await page.mouse.up();
}
const outlines = '#wfp-editor-root .wfpe-multi-outline';

for (const scale of [1, .6]) {
  test(`rectangle selects enclosed boxes and moves them at scale ${scale}`, async ({ page }) => {
    await boot(page, scale);
    await rectangle(page, 80 * scale, 120 * scale, 410 * scale, 230 * scale);
    await expect(page.locator(outlines)).toHaveCount(2);
    const before = await page.locator('#item-a').boundingBox();
    const second = await page.locator('#item-b').boundingBox();
    await page.mouse.move(before.x + 20, before.y + 20);
    await page.mouse.down();
    await page.mouse.move(before.x + 50, before.y + 40, { steps: 5 });
    await page.mouse.up();
    const after = await page.locator('#item-a').boundingBox();
    expect(after.x - before.x).toBeCloseTo(30, 0);
    expect((await page.locator('#item-b').boundingBox()).x - second.x).toBeCloseTo(30, 0);
    await page.keyboard.press('ControlOrMeta+z');
    expect((await page.locator('#item-a').boundingBox()).x).toBeCloseTo(before.x, 0);
  });
}

test('additive rectangle, reverse direction and Escape preserve a useful selection', async ({ page }) => {
  await boot(page);
  await page.locator('#item-c').click();
  await page.keyboard.down('ControlOrMeta');
  await rectangle(page, 410, 230, 80, 120);
  await page.keyboard.up('ControlOrMeta');
  await expect(page.locator(outlines)).toHaveCount(3);
  await page.mouse.move(20, 40);
  await page.mouse.down();
  await page.mouse.move(60, 90, { steps: 4 });
  await expect(page.locator('.wfpe-marquee')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await expect(page.locator('.wfpe-marquee')).toBeHidden();
  await expect(page.locator(outlines)).toHaveCount(3);
});

test('Shift-drag over content selects boxes without moving the starting element', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => {
    const cover = document.createElement('div');
    cover.id = 'canvas-cover';
    cover.style.cssText = 'position:absolute;inset:0;z-index:-1';
    document.querySelector('.slide.active').prepend(cover);
  });
  const before = await page.locator('#item-a').getAttribute('style');
  await page.keyboard.down('Shift');
  await rectangle(page, 80, 120, 410, 230);
  await page.keyboard.up('Shift');
  await expect(page.locator(outlines)).toHaveCount(2);
  await expect(page.locator('#item-a')).toHaveAttribute('style', before);
});

async function groupNote(page, text) {
  await page.getByRole('button', {name:/Note selected items/}).click();
  await page.locator('.wfpe-group-note-input').fill(text);
  await page.getByRole('button', {name:'Save group note',exact:true}).click();
}
async function download(page, clean = false) {
  await page.locator('#wfp-editor-root [data-action=export]').click();
  const ready = page.waitForEvent('download');
  await page.locator(`#wfp-editor-root [data-action=${clean ? 'clean-copy' : 'save-in-place'}]`).click();
  return fs.readFile(await (await ready).path(), 'utf8');
}

test('shared note preserves individual notes, exports both members and deletes atomically', async ({page}) => {
  await boot(page);
  await page.locator('#item-a').click();
  await page.locator('.wfpe-annotation-input').fill('Keep the first item blue');
  await page.locator('.wfpe-annotation-save-btn').click();
  await rectangle(page, 80, 120, 410, 230);
  await expect(page.locator(outlines)).toHaveCount(2);
  await groupNote(page, 'Align these two boxes');
  await expect(page.locator('.wfpe-notes-card[data-scope=group]')).toHaveCount(1);
  await expect(page.locator('#item-a')).toHaveAttribute('data-wfp-edit-annotation-text','Keep the first item blue');
  const html = await download(page);
  const payload = await page.evaluate(html => JSON.parse(new DOMParser().parseFromString(html,'text/html').querySelector('script[data-wfp-agent-annotations]').textContent), html);
  expect(payload.annotations).toHaveLength(2);
  const group = payload.annotations.find(note => note.scope === 'group');
  expect(group.instruction).toBe('Align these two boxes');
  expect(group.memberIds).toHaveLength(2);
  expect(group.targets).toHaveLength(2);
  await page.locator('#wfp-editor-root [data-action=notes]').click();
  await page.getByRole('button',{name:'Delete group note',exact:true}).click();
  await expect(page.locator('.wfpe-notes-card[data-scope=group]')).toHaveCount(0);
  await page.locator('#wfp-editor-root [data-action=undo]').click();
  await expect(page.locator('.wfpe-notes-card[data-scope=group]')).toHaveCount(1);
  const clean = await download(page, true);
  expect(clean).not.toContain('data-wfp-agent-group');
  expect(clean).not.toContain('data-wfp-edit-annotation');
  expect(clean).not.toContain('Align these two boxes');
});

test('group-only handoff reimports replies and missing membership without overwriting individual notes', async ({page}) => {
  await boot(page);
  await rectangle(page, 80, 120, 410, 230);
  await groupNote(page, 'Match these items as one group');
  const html = await download(page);
  const processed = await page.evaluate(html => {
    const doc = new DOMParser().parseFromString(html,'text/html');
    const payload = JSON.parse(doc.querySelector('script[data-wfp-agent-annotations]').textContent);
    const group = payload.annotations[0];
    doc.querySelector('#item-b').remove();
    const results = doc.createElement('script');
    results.type = 'application/json'; results.setAttribute('data-wfp-agent-results','');
    results.textContent = JSON.stringify({results:[{id:group.id,status:'needs-input',note:'One item is missing'}]});
    doc.body.append(results);
    return '<!DOCTYPE html>' + doc.documentElement.outerHTML;
  }, html);
  await page.route('**/group-note-reopen.html', route => route.fulfill({contentType:'text/html',body:processed}));
  await page.goto('/group-note-reopen.html');
  await page.addScriptTag({path:EDITOR_PATH});
  await page.locator('#wfp-editor-root [data-action=notes]').click();
  const card = page.locator('.wfpe-notes-card[data-scope=group]');
  await expect(card).toContainText('1 missing');
  await expect(card).toContainText('One item is missing');
  await card.click();
  await expect(page.locator('.wfpe-group-note-input')).toHaveValue('Match these items as one group');
  const again = await download(page);
  const group = await page.evaluate(html => JSON.parse(new DOMParser().parseFromString(html,'text/html').querySelector('script[data-wfp-agent-annotations]').textContent).annotations[0], again);
  expect(group.memberIds).toHaveLength(2);
  expect(group.missingMemberIds).toHaveLength(1);
});

test('group-only recovery survives reload and deleting the final group returns to unchanged source', async ({page}) => {
  page.on('dialog', dialog => dialog.accept());
  await boot(page);
  await rectangle(page, 80, 120, 410, 230);
  await groupNote(page, 'Recover this group');
  await expect(page.locator('.wfpe-recovery-status')).toContainText('Local recovery saved');
  await page.getByRole('button',{name:'Delete group note',exact:true}).click();
  await expect(page.locator('.wfpe-recovery-status')).toContainText('Source unchanged');
  await page.locator('#wfp-editor-root [data-action=undo]').click();
  await expect(page.locator('.wfpe-recovery-status')).toContainText('Local recovery saved');
  await boot(page);
  await page.getByRole('button',{name:'Restore local copy',exact:true}).click();
  await page.locator('#wfp-editor-root [data-action=notes]').click();
  await expect(page.locator('.wfpe-notes-card[data-scope=group]')).toContainText('Recover this group');
});

test('overlapping groups remain independent and deleting a member can be undone', async ({page}) => {
  await boot(page);
  await rectangle(page, 80, 120, 410, 230);
  await groupNote(page, 'First pair');
  await page.getByRole('button',{name:'Close group note',exact:true}).click();
  await rectangle(page, 260, 120, 590, 230);
  await groupNote(page, 'Second pair');
  await expect(page.locator('.wfpe-notes-card[data-scope=group]')).toHaveCount(2);
  await page.getByRole('button',{name:'Delete group note',exact:true}).click();
  await expect(page.locator('.wfpe-notes-card[data-scope=group]')).toHaveCount(1);
  await expect(page.locator('#item-b')).toHaveAttribute('data-wfp-edit-annotation-target-id', /.+/);
  await expect(page.locator('#item-c')).not.toHaveAttribute('data-wfp-edit-annotation-target-id');
  await page.locator('#item-b').click();
  await page.keyboard.press('Delete');
  await expect(page.locator('.wfpe-notes-card[data-scope=group]')).toContainText('1 missing');
  await page.locator('#wfp-editor-root [data-action=undo]').click();
  await expect(page.locator('.wfpe-notes-card[data-scope=group]')).not.toContainText('missing');
});

test('rectangle excludes transparent descendants and cancels immediately on a host slide change', async ({page}) => {
  await boot(page);
  await page.evaluate(() => {
    const hidden = document.createElement('div');
    hidden.style.cssText = 'opacity:0;position:absolute;left:100px;top:100px;width:60px;height:30px';
    hidden.innerHTML = '<span style="display:block;width:50px;height:20px">Invisible</span>';
    document.querySelector('.slide.active').append(hidden);
  });
  await rectangle(page, 80, 80, 410, 230);
  await expect(page.locator(outlines)).toHaveCount(2);
  await page.mouse.move(20,40); await page.mouse.down(); await page.mouse.move(60,90);
  await expect(page.locator('.wfpe-marquee')).toBeVisible();
  await page.evaluate(() => {
    document.querySelector('.slide.active').classList.remove('active');
    document.querySelectorAll('.slide')[1].classList.add('active');
  });
  await expect(page.locator('.wfpe-marquee')).toHaveCount(0);
  await page.mouse.up();
  await expect(page.locator(outlines)).toHaveCount(0);
});

test('note cycling switches between group and element notes without losing the cursor', async ({page}) => {
  await boot(page);
  await page.locator('#item-a').click();
  await page.locator('.wfpe-annotation-input').fill('Individual instruction');
  await page.locator('.wfpe-annotation-save-btn').click();
  await rectangle(page, 80, 120, 410, 230);
  await groupNote(page, 'Shared instruction');
  await page.locator('.wfpe-notes-card[data-scope=group]').click();
  await page.keyboard.press('n');
  await expect(page.locator('.wfpe-group-note-editor')).toBeHidden();
  await expect(page.locator('.wfpe-notes-card[data-scope=element]')).toHaveAttribute('data-active','true');
  await page.keyboard.press('n');
  await expect(page.locator('.wfpe-group-note-editor')).toBeVisible();
  await expect(page.locator('.wfpe-notes-card[data-scope=group]')).toHaveAttribute('data-active','true');
});

test('a group draft keeps its original targets when the canvas selection changes', async ({page}) => {
  await boot(page);
  await rectangle(page, 80, 120, 410, 230);
  await page.getByRole('button',{name:/Note selected items/}).click();
  await page.locator('.wfpe-group-note-input').fill('Apply only to the original pair');
  await page.locator('#item-c').click();
  await page.getByRole('button',{name:'Save group note',exact:true}).click();
  await expect(page.locator('#item-a')).toHaveAttribute('data-wfp-edit-annotation-target-id',/.+/);
  await expect(page.locator('#item-b')).toHaveAttribute('data-wfp-edit-annotation-target-id',/.+/);
  await expect(page.locator('#item-c')).not.toHaveAttribute('data-wfp-edit-annotation-target-id');
});

test('done results resolve only the group and duplicated slides do not inherit group identities', async ({page}) => {
  await boot(page);
  await page.locator('#item-a').click();
  await page.locator('.wfpe-annotation-input').fill('Individual survives');
  await page.locator('.wfpe-annotation-save-btn').click();
  await rectangle(page, 80, 120, 410, 230);
  await groupNote(page, 'Completed group');
  const html = await download(page);
  await page.locator('#wfp-editor-root [data-action=overview]').click();
  await page.getByRole('button',{name:'Duplicate slide 1',exact:true}).click();
  await expect(page.locator('.slide').nth(1)).not.toHaveAttribute('data-wfp-edit-annotation-groups');
  await expect(page.locator('.slide').nth(1).locator('[data-wfp-edit-annotation-target-id]')).toHaveCount(0);
  const processed = await page.evaluate(html => {
    const doc = new DOMParser().parseFromString(html,'text/html');
    const data = JSON.parse(doc.querySelector('script[data-wfp-agent-annotations]').textContent);
    const result = doc.createElement('script');
    result.type='application/json'; result.setAttribute('data-wfp-agent-results','');
    result.textContent=JSON.stringify({results:[{id:data.annotations.find(note=>note.scope==='group').id,status:'done'}]});
    doc.body.append(result);
    return '<!DOCTYPE html>'+doc.documentElement.outerHTML;
  },html);
  await page.route('**/group-done.html',route=>route.fulfill({contentType:'text/html',body:processed}));
  await page.goto('/group-done.html');
  await page.addScriptTag({path:EDITOR_PATH});
  await page.locator('#wfp-editor-root [data-action=notes]').click();
  await expect(page.locator('.wfpe-notes-card[data-scope=group]')).toHaveCount(0);
  await expect(page.locator('.wfpe-notes-card[data-scope=element]')).toContainText('Individual survives');
});

test('group notes and inspector stay reachable in a short desktop window', async ({page}) => {
  await page.setViewportSize({width:1024,height:640});
  await boot(page);
  await rectangle(page, 80, 120, 410, 230);
  await groupNote(page, 'Keep all group controls reachable');
  await page.locator('#wfp-editor-root').evaluate(async el => {
    await Promise.all(el.getAnimations({subtree:true}).map(animation => animation.finished.catch(() => {})));
  });
  const inspector = await page.locator('.wfpe-inspector').boundingBox();
  expect(inspector.y + inspector.height).toBeLessThanOrEqual(624);
  await page.getByRole('button',{name:'Discard group draft',exact:true}).scrollIntoViewIfNeeded();
  await page.getByRole('button',{name:'Discard group draft',exact:true}).click();
  await expect(page.locator('.wfpe-group-note-editor')).toBeHidden();
  await page.getByRole('button',{name:/Note selected items/}).scrollIntoViewIfNeeded();
  await page.getByRole('button',{name:/Note selected items/}).click();
  await expect(page.locator('.wfpe-group-note-input')).toHaveValue('Keep all group controls reachable');
});
