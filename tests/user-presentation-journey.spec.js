import {test, expect} from '@playwright/test';
import fs from 'node:fs/promises';
import {disableFsa} from './_helpers.js';

test('polish a generated three-card slide: select cards, move, undo, annotate and reopen clean export', async ({page}, testInfo) => {
  await disableFsa(page);
  const errors=[];
  page.on('pageerror', error=>errors.push(error.message));
  await page.goto('/dev/harness.html');
  await page.waitForFunction(()=>window.__wfpEditorReady);
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('e');
  const row=await page.locator('.slide.active .cols').boundingBox();
  const cards=page.locator('.slide.active .col');
  const before=await cards.evaluateAll(els=>els.map(el=>({x:el.getBoundingClientRect().x,y:el.getBoundingClientRect().y})));
  await page.mouse.move(row.x-8,row.y-8); await page.mouse.down();
  await page.mouse.move(row.x+row.width+8,row.y+row.height+8,{steps:10}); await page.mouse.up();
  await expect(page.locator('.wfpe-multi-outline')).toHaveCount(3);
  await expect(page.getByRole('button',{name:'Note selected items (3)',exact:true})).toBeVisible();
  // Grab card padding rather than text: move the selected visible boxes together.
  await page.mouse.move(before[0].x+8,before[0].y+8); await page.mouse.down();
  await page.mouse.move(before[0].x+28,before[0].y+48,{steps:8}); await page.mouse.up();
  const after=await cards.evaluateAll(els=>els.map(el=>({x:el.getBoundingClientRect().x,y:el.getBoundingClientRect().y})));
  for(let i=0;i<3;i++){expect(after[i].x-before[i].x).toBeCloseTo(20,0);expect(after[i].y-before[i].y).toBeCloseTo(40,0);}
  await page.getByRole('button',{name:'Undo',exact:true}).click();
  const restored=await cards.evaluateAll(els=>els.map(el=>({x:el.getBoundingClientRect().x,y:el.getBoundingClientRect().y})));
  for(let i=0;i<3;i++){expect(restored[i].x).toBeCloseTo(before[i].x,0);expect(restored[i].y).toBeCloseTo(before[i].y,0);}
  await page.getByRole('button',{name:'Note selected items (3)',exact:true}).click();
  await page.locator('.wfpe-group-note-input').fill('Give these three priorities equal visual weight.');
  await page.getByRole('button',{name:'Save group note',exact:true}).click();
  await expect(page.locator('.wfpe-notes-card[data-scope=group]')).toContainText('Group of 3 items');
  await page.getByRole('button',{name:'Export',exact:true}).click();
  // The notes dock folds closed as the export dock opens. Wait for the row
  // to be fully exposed, as a person would, rather than clicking its clipped
  // sliver while scrollIntoView is still moving the animated container.
  const cleanCopy = page.locator('[data-action=clean-copy]');
  await expect.poll(()=>cleanCopy.evaluate(el=>{
    const row=el.getBoundingClientRect();
    const clip=el.closest('.wfpe-export-dock-inner').getBoundingClientRect();
    return row.top >= clip.top && row.bottom <= clip.bottom;
  })).toBe(true);
  const downloaded=page.waitForEvent('download');
  await cleanCopy.click();
  const html=await fs.readFile(await (await downloaded).path(),'utf8');
  const file=testInfo.outputPath('polished-deck.html'); await fs.writeFile(file,html);
  await page.goto('file://'+file);
  await expect(page.locator('#wfp-editor-root')).toHaveCount(0);
  await expect(page.locator('[data-wfp-edit-annotation-groups]')).toHaveCount(0);
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('.slide.active .col')).toHaveCount(3);
  expect(errors).toEqual([]);
});

test('opening the generated presentation starts with an unchanged source', async ({page}) => {
  await page.goto('/dev/harness.html');
  await page.waitForFunction(()=>window.__wfpEditorReady);
  await expect(page.locator('.wfpe-recovery-status')).toContainText('Source unchanged');
});

test('cancelling rectangle selection preserves an unfinished individual note', async ({page}) => {
  await page.goto('/dev/harness.html');
  await page.waitForFunction(()=>window.__wfpEditorReady);
  await page.keyboard.press('e');
  await page.locator('.slide.active h1').click();
  const note=page.locator('.wfpe-annotation-input');
  await note.fill('Keep this unfinished instruction');
  const slide=await page.locator('.slide.active').boundingBox();
  await page.mouse.move(slide.x+5,slide.y+5); await page.mouse.down();
  await page.mouse.move(slide.x+40,slide.y+40,{steps:5});
  await page.keyboard.press('Escape'); await page.mouse.up();
  await expect(note).toHaveValue('Keep this unfinished instruction');
  await expect(page.locator('.wfpe-annotation-status')).toHaveText('Unsaved');
  await page.locator('.wfpe-annotation-save-btn').click();
  await expect(page.locator('.slide.active h1')).toHaveAttribute('data-wfp-edit-annotation-text','Keep this unfinished instruction');
});

for (const appearance of ['background: red', 'background: black', 'background: transparent; border: 2px solid black']) {
  test(`rectangle recognises visible empty cards with ${appearance}`, async ({page}) => {
    await page.goto('/dev/harness.html');
    await page.waitForFunction(()=>window.__wfpEditorReady);
    await page.keyboard.press('ArrowRight');
    await page.locator('.slide.active .col').evaluateAll((cards, appearance)=>{
      cards.forEach(card=>{card.textContent='';card.style.cssText=appearance+';height:100px';});
    },appearance);
    await page.keyboard.press('e');
    const row=await page.locator('.slide.active .cols').boundingBox();
    await page.mouse.move(row.x-8,row.y-8); await page.mouse.down();
    await page.mouse.move(row.x+row.width+8,row.y+row.height+8,{steps:8}); await page.mouse.up();
    await expect(page.locator('.wfpe-multi-outline')).toHaveCount(3);
  });
}
