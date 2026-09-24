import { test, expect } from '@playwright/test';
import fs from 'node:fs/promises';

const raster = { name: 'replacement.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN1sAAAAASUVORK5CYII=', 'base64') };

async function load(page, flat = false) {
  await page.goto(flat ? '/fixtures/flat-document.html' : '/fixtures/foreign-deck.html');
  await page.addScriptTag({ url: '/editor.js' });
  await expect(page.locator('#wfp-editor-root')).toBeVisible();
}
async function exportHtml(page) {
  await page.locator('#wfp-editor-root [data-action="export"]').click();
  const wait = page.waitForEvent('download');
  await page.locator('.wfpe-export-menu-item').filter({ hasText: 'Clean copy' }).click();
  return fs.readFile(await (await wait).path(), 'utf8');
}

test('duplicate slide keeps unique references, styles, history, navigation and export', async ({ page }, testInfo) => {
  await load(page);
  const before = await page.locator('.slide').count();
  await page.evaluate(() => {
    const slide = document.querySelector('.slide');
    slide.id = 'authoring-source';
    slide.setAttribute('data-wfp-edit-annotation-id', 'old-note');
    slide.setAttribute('data-wfp-edit-annotation-text', 'Do not copy me');
    slide.setAttribute('data-wfp-edit-annotation-scope', 'slide');
    const script = document.createElement('script');
    script.textContent = 'window.authoringExecutions = (window.authoringExecutions || 0) + 1';
    slide.append(script);
    slide.insertAdjacentHTML('beforeend', '<label for="authoring-field">Label</label><input id="authoring-field" aria-describedby="authoring-caption"><p id="authoring-caption">Copy reference</p><a href="#authoring-caption">Jump</a><svg><defs><linearGradient id="authoring-gradient"><stop stop-color="red"/></linearGradient></defs><rect fill="url(#authoring-gradient)" /></svg>');
    const style = document.createElement('style');
    style.textContent = '#authoring-source #authoring-caption { color: rgb(9, 81, 144) }';
    document.head.append(style);
  });
  await page.locator('#wfp-editor-root [title="Overview (O)"]').click();
  await page.getByRole('button', { name: 'Duplicate slide 1', exact: true }).click();
  await expect(page.locator('.slide')).toHaveCount(before + 1);
  const ids = await page.locator('.slide').nth(1).evaluate(slide => ({
    id: slide.id, field: slide.querySelector('input').id, caption: slide.querySelector('p[id]').id,
    label: slide.querySelector('label').htmlFor, aria: slide.querySelector('input').getAttribute('aria-describedby'),
    href: slide.querySelector('a[href^="#"]').getAttribute('href'),
    colour: getComputedStyle(slide.querySelector('p[id]')).color,
  }));
  expect(ids.id).not.toBe('authoring-source');
  expect(ids.field).not.toBe('authoring-field');
  expect(ids.label).toBe(ids.field);
  expect(ids.aria).toBe(ids.caption);
  expect(ids.href).toBe('#' + ids.caption);
  expect(ids.colour).toBe('rgb(9, 81, 144)');
  expect(await page.evaluate(() => window.authoringExecutions)).toBe(1);
  await expect(page.locator('.slide').nth(1)).not.toHaveAttribute('data-wfp-edit-annotation-id');
  await expect(page.locator('.slide').nth(1).locator('script')).toHaveCount(0);
  expect(await page.evaluate(() => { const ids = [...document.querySelectorAll('[id]')].map(el => el.id); return ids.length === new Set(ids).size; })).toBe(true);
  await page.locator('#wfp-editor-root [data-action="undo"]').click();
  await expect(page.locator('.slide')).toHaveCount(before);
  await page.locator('#wfp-editor-root [data-action="redo"]').click();
  await expect(page.locator('.slide')).toHaveCount(before + 1);
  await page.locator('.wfpe-overview-thumb').nth(1).click();
  await expect(page.locator('.slide.active')).toHaveAttribute('id', ids.id);
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('.slide.active')).not.toHaveAttribute('id', ids.id);
  const html = await exportHtml(page);
  const file = testInfo.outputPath('duplicate.html');
  await fs.writeFile(file, html);
  await page.goto('file://' + file);
  await expect(page.locator('.slide')).toHaveCount(before + 1);
  await expect(page.locator('#' + ids.caption)).toHaveCSS('color', 'rgb(9, 81, 144)');
  await expect(page.locator('#wfp-editor-root')).toHaveCount(0);
  expect(await page.evaluate(() => window.authoringExecutions)).toBe(1);
});

test('Add text opens editing and retains content after undo/redo and clean export', async ({ page }, testInfo) => {
  await load(page);
  await page.keyboard.press('e');
  await page.getByRole('button', { name: 'Add text', exact: true }).click();
  const text = page.locator('[contenteditable="true"]');
  await expect(text).toBeVisible();
  const box = await text.boundingBox();
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y).toBeGreaterThanOrEqual(0);
  await text.fill('A new authored message');
  await page.keyboard.press('Escape');
  await page.locator('#wfp-editor-root [data-action="undo"]').click();
  await expect(page.getByText('A new authored message', { exact: true })).toHaveCount(0);
  await page.locator('#wfp-editor-root [data-action="undo"]').click();
  await expect(page.locator('.slide.active').getByText('Add your text', { exact: true })).toHaveCount(0);
  await page.locator('#wfp-editor-root [data-action="redo"]').click();
  await page.locator('#wfp-editor-root [data-action="redo"]').click();
  await expect(page.getByText('A new authored message', { exact: true })).toBeVisible();
  const html = await exportHtml(page);
  const file = testInfo.outputPath('text.html');
  await fs.writeFile(file, html);
  await page.goto('file://' + file);
  await expect(page.getByText('A new authored message', { exact: true })).toBeVisible();
  await expect(page.locator('#wfp-editor-root, [contenteditable]')).toHaveCount(0);
});

test('Replace image embeds raster, cancels safely, restores responsive attributes and exports', async ({ page }, testInfo) => {
  await load(page);
  await page.evaluate(() => {
    const image = document.createElement('img');
    image.alt = 'Authoring image';
    image.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
    image.style.cssText = 'position:absolute;left:100px;top:150px;width:220px;height:120px;object-fit:cover';
    const picture = document.createElement('picture');
    const source = document.createElement('source');
    source.srcset = image.src;
    image.srcset = image.src + ' 1x';
    image.sizes = '220px';
    picture.append(source, image);
    document.querySelector('.slide.active').append(picture);
  });
  await page.keyboard.press('e');
  const img = page.getByAltText('Authoring image');
  await img.click();
  const before = await img.getAttribute('src');
  const box = await img.boundingBox();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Replace image', exact: true }).click();
  await (await chooser).setFiles(raster);
  await expect(img).toHaveAttribute('src', /^data:image\/png;base64,/);
  expect(await img.boundingBox()).toEqual(box);
  await expect(img).toHaveCSS('object-fit', 'cover');
  await expect(img).not.toHaveAttribute('srcset');
  await expect(page.locator('picture source')).not.toHaveAttribute('srcset');
  const cancelled = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Replace image', exact: true }).click();
  await (await cancelled).setFiles([]);
  await expect(img).toHaveAttribute('src', /^data:image\/png;base64,/);
  const invalid = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Replace image', exact: true }).click();
  await (await invalid).setFiles({ name: 'bad.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg/>') });
  await expect(page.locator('.wfpe-toast')).toContainText('not supported');
  await page.locator('#wfp-editor-root [data-action="undo"]').click();
  await expect(img).toHaveAttribute('src', before);
  await expect(img).toHaveAttribute('srcset', before + ' 1x');
  await expect(img).toHaveAttribute('sizes', '220px');
  await expect(page.locator('picture source')).toHaveAttribute('srcset', before);
  await page.locator('#wfp-editor-root [data-action="redo"]').click();
  await expect(img).toHaveAttribute('src', /^data:image\/png;base64,/);
  const html = await exportHtml(page);
  const file = testInfo.outputPath('image.html');
  await fs.writeFile(file, html);
  await page.goto('file://' + file);
  await expect(page.getByAltText('Authoring image')).toHaveAttribute('src', /^data:image\/png;base64,/);
  await expect(page.getByAltText('Authoring image')).toHaveCSS('object-fit', 'cover');
  expect(await page.getByAltText('Authoring image').boundingBox()).toEqual(box);
});

for (const flat of [false, true]) {
  test(`Add text stays within ${flat ? 'scrolled flat document' : 'scaled slide'} visible canvas`, async ({ page }) => {
    await load(page, flat);
    if (flat) await page.evaluate(() => window.scrollTo(0, 450));
    else await page.evaluate(() => {
      const deck = document.querySelector('.slide').parentElement;
      deck.style.transform = 'scale(.55)';
      deck.style.transformOrigin = 'top left';
    });
    await page.keyboard.press('e');
    await page.getByRole('button', { name: 'Add text', exact: true }).click();
    const text = page.locator('[contenteditable="true"]');
    await expect(text).toBeVisible();
    const rect = await text.boundingBox();
    expect(rect.x).toBeGreaterThanOrEqual(0);
    expect(rect.y).toBeGreaterThanOrEqual(0);
    expect(rect.x + rect.width).toBeLessThanOrEqual(page.viewportSize().width);
    expect(rect.y + rect.height).toBeLessThanOrEqual(page.viewportSize().height);
    if (!flat) {
      const slide = await page.locator('.slide.active').boundingBox();
      expect(rect.x + rect.width).toBeLessThanOrEqual(slide.x + slide.width);
      expect(rect.y + rect.height).toBeLessThanOrEqual(slide.y + slide.height);
      expect(rect.width).toBeCloseTo(198, 0);
    }
    await text.fill('Visible new text');
    await page.keyboard.press('Escape');
    await page.locator('#wfp-editor-root [data-action="undo"]').click();
    await page.locator('#wfp-editor-root [data-action="undo"]').click();
    await expect(page.getByText('Add your text', { exact: true })).toHaveCount(0);
  });
}

for (const embedded of [false, true]) {
  test(`duplicate preserves ${embedded ? 'embedded' : 'document'} CSS SVG references without changing the source`, async ({ page }) => {
    await load(page);
    await page.evaluate(embedded => {
      const slide = document.querySelector('.slide');
      slide.insertAdjacentHTML('beforeend', '<svg><defs><linearGradient id="copy-gradient"><stop stop-color="red"/></linearGradient></defs><rect class="copy-shape" width="20" height="20" /></svg>');
      const style = document.createElement('style');
      style.textContent = '.copy-shape { fill: url(#copy-gradient); }';
      (embedded ? slide : document.head).append(style);
    }, embedded);
    await page.locator('#wfp-editor-root [title="Overview (O)"]').click();
    await page.getByRole('button', { name: 'Duplicate slide 1', exact: true }).click();
    const slides = page.locator('.slide');
    const gradient = await slides.nth(1).locator('linearGradient').getAttribute('id');
    expect(gradient).not.toBe('copy-gradient');
    expect(await slides.first().locator('.copy-shape').evaluate(el => getComputedStyle(el).fill)).toContain('#copy-gradient"');
    expect(await slides.nth(1).locator('.copy-shape').evaluate(el => getComputedStyle(el).fill)).toContain('#' + gradient + '"');
    await slides.first().evaluate(el => el.remove());
    expect(await slides.first().locator('.copy-shape').evaluate(el => getComputedStyle(el).fill)).toContain('#' + gradient + '"');
  });
}
