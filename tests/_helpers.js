import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const PROJECT_ROOT = path.resolve(__dirname, '..');
export const FIXTURES_DIR = path.join(PROJECT_ROOT, 'fixtures');
export const EDITOR_PATH = path.join(PROJECT_ROOT, 'editor.js');

export const PINNED_PRIMARIES = ['Townhall-1.html', 'boilerplate.html'];

export async function loadFixtureWithEditor(page, fixtureName) {
  const url = `/fixtures/${fixtureName}`;
  await page.goto(url);
  await page.locator('.deck').first().waitFor({ state: 'attached', timeout: 5_000 });
  await page.addScriptTag({ path: EDITOR_PATH });
  await page.waitForFunction(() => window.__wfpEditorReady === true, null, { timeout: 5_000 });
}

export function pickRandomRotationFixture() {
  const all = fs.readdirSync(FIXTURES_DIR).filter((f) => f.endsWith('.html'));
  const pool = all.filter((f) => !PINNED_PRIMARIES.includes(f));
  if (pool.length === 0) throw new Error('No rotation fixtures available');
  return pool[Math.floor(Math.random() * pool.length)];
}
