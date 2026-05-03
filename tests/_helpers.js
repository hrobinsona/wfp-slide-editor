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
  // Some fixtures are large (multi-MB) and slow to parse. Generous timeouts
  // here keep the helper usable across all fixtures, including the rotation
  // pool.
  await page.goto(url, { timeout: 30_000 });
  await page.locator('.deck').first().waitFor({ state: 'attached', timeout: 20_000 });
  await page.addScriptTag({ path: EDITOR_PATH });
  await page.waitForFunction(() => window.__wfpEditorReady === true, null, { timeout: 10_000 });
}

export function pickRandomRotationFixture() {
  const all = fs.readdirSync(FIXTURES_DIR).filter((f) => f.endsWith('.html'));
  // The editor's contract (DESIGN.md) assumes a .deck wrapper around the
  // slides for transform: scale() math. Fixtures that don't fit the contract
  // are filtered out so they don't randomly poison the rotation. Some
  // fixtures are several MB and the .deck declaration may appear deep in
  // the body (e.g. after large inline assets in <head>), so we scan the
  // whole file rather than a head sample.
  const pool = all
    .filter((f) => !PINNED_PRIMARIES.includes(f))
    .filter((f) => {
      const content = fs.readFileSync(path.join(FIXTURES_DIR, f), 'utf-8');
      return /class=["'][^"']*\bdeck\b/.test(content);
    });
  if (pool.length === 0) throw new Error('No rotation fixtures available');
  return pool[Math.floor(Math.random() * pool.length)];
}
