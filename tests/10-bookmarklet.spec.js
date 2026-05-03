import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts', 'build-bookmarklet.js');
const OUTPUT = path.join(ROOT, 'bookmarklet.txt');

function runBuild(env = {}, args = []) {
  return execFileSync('node', [SCRIPT, ...args], {
    cwd: ROOT,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
    .toString('utf-8')
    .trim();
}

test.describe('Phase 10 — Bookmarklet generator', () => {
  test('produces a valid javascript: bookmarklet under 1KB', () => {
    const out = runBuild({ EDITOR_URL: 'https://example.github.io/wfp-slide-editor/editor.js' });
    expect(out).toMatch(/^javascript:/);
    expect(out.length).toBeLessThan(1024);
    expect(out).toContain('document.createElement');
    expect(out).toContain('https://example.github.io/wfp-slide-editor/editor.js');
    expect(out).toContain('Date.now()');
    // Body must be a self-invoking function so it runs on bookmark click.
    expect(out).toMatch(/\(function\(\)\{[\s\S]*\}\)\(\);?$/);
  });

  test('--local flag points the bookmarklet at http://localhost:8080/editor.js', () => {
    const out = runBuild({}, ['--local']);
    expect(out).toContain('http://localhost:8080/editor.js');
  });

  test('writes the bookmarklet string to bookmarklet.txt at the project root', () => {
    runBuild({ EDITOR_URL: 'https://example.github.io/wfp-slide-editor/editor.js' });
    expect(fs.existsSync(OUTPUT)).toBe(true);
    const written = fs.readFileSync(OUTPUT, 'utf-8').trim();
    expect(written).toMatch(/^javascript:\(function\(\)\{/);
    expect(written.length).toBeLessThan(1024);
  });

  test('the generated bookmarklet body, when executed in a fixture page, injects the editor', async ({
    page,
  }) => {
    // Build with --local so the script src will resolve via the dev server
    // that the playwright config already starts.
    runBuild({}, ['--local']);
    const javascriptUrl = fs.readFileSync(OUTPUT, 'utf-8').trim();
    expect(javascriptUrl.startsWith('javascript:')).toBe(true);
    const body = javascriptUrl.slice('javascript:'.length);

    await page.goto('/fixtures/Townhall-1.html');
    await page.locator('.deck').first().waitFor({ state: 'attached', timeout: 20_000 });

    // Run the bookmarklet body in the page (the same code the browser would
    // execute on bookmark click).
    await page.evaluate(body);

    await page.waitForFunction(() => window.__wfpEditorReady === true, null, {
      timeout: 10_000,
    });

    const editorMounted = await page.evaluate(
      () => !!document.getElementById('wfp-editor-root'),
    );
    expect(editorMounted).toBe(true);

    // Pressing E should toggle the badge — i.e. the editor is fully
    // interactive after bookmarklet injection.
    const badge = page.locator('#wfp-editor-root .wfpe-mode-badge');
    await expect(badge).toHaveText(/Edit:\s*OFF/);
    await page.keyboard.press('e');
    await expect(badge).toHaveText(/Edit:\s*ON/);
  });
});
