#!/usr/bin/env node
/**
 * Build the WFP Slide Editor bookmarklet string and write it to bookmarklet.txt.
 *
 * Usage:
 *   node scripts/build-bookmarklet.js
 *   EDITOR_URL=https://you.github.io/wfp-slide-editor/editor.js node scripts/build-bookmarklet.js
 *   node scripts/build-bookmarklet.js --local
 *   node scripts/build-bookmarklet.js --local --out /tmp/bookmarklet.txt
 *
 * The bookmarklet does one thing: inject `<script src="EDITOR_URL?<timestamp>">`
 * into the current page. The cache-buster timestamp ensures a click always
 * fetches the latest editor.js.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DEFAULT_OUTPUT_FILE = path.join(ROOT, 'bookmarklet.txt');
const SIZE_LIMIT_BYTES = 1024;

const DEFAULT_REMOTE = 'https://[user].github.io/wfp-slide-editor/editor.js';
const LOCAL_URL = 'http://localhost:8080/editor.js';

function resolveEditorUrl(argv) {
  if (argv.includes('--local')) return LOCAL_URL;
  if (process.env.EDITOR_URL && process.env.EDITOR_URL.trim()) {
    return process.env.EDITOR_URL.trim();
  }
  return DEFAULT_REMOTE;
}

function resolveOutputFile(argv) {
  const equalsArg = argv.find((arg) => arg.startsWith('--out='));
  if (equalsArg) {
    const value = equalsArg.slice('--out='.length).trim();
    if (!value) {
      console.error('[build-bookmarklet] --out requires a file path.');
      process.exit(1);
    }
    return path.resolve(process.cwd(), value);
  }

  const idx = argv.indexOf('--out');
  if (idx === -1) return DEFAULT_OUTPUT_FILE;

  const value = argv[idx + 1];
  if (!value || value.startsWith('--')) {
    console.error('[build-bookmarklet] --out requires a file path.');
    process.exit(1);
  }
  return path.resolve(process.cwd(), value);
}

function buildBookmarklet(editorUrl) {
  // Body of the IIFE that gets prefixed with `javascript:`. Kept terse to fit
  // under the 1KB browser bookmarklet limit. The `&`/`?` choice handles URLs
  // that already contain a query string.
  const body =
    `(function(){` +
    `var s=document.createElement('script');` +
    `s.src=${JSON.stringify(editorUrl)}+(${JSON.stringify(editorUrl)}.indexOf('?')>-1?'&':'?')+Date.now();` +
    `document.body.appendChild(s);` +
    `})();`;
  return `javascript:${body}`;
}

function main() {
  const argv = process.argv.slice(2);
  const editorUrl = resolveEditorUrl(argv);
  const outputFile = resolveOutputFile(argv);
  const bookmarklet = buildBookmarklet(editorUrl);
  const sizeBytes = Buffer.byteLength(bookmarklet, 'utf-8');

  if (sizeBytes > SIZE_LIMIT_BYTES) {
    console.error(
      `[build-bookmarklet] Output is ${sizeBytes} bytes, exceeds ${SIZE_LIMIT_BYTES}-byte limit.`,
    );
    process.exit(1);
  }

  fs.mkdirSync(path.dirname(outputFile), { recursive: true });
  fs.writeFileSync(outputFile, bookmarklet + '\n', 'utf-8');

  process.stdout.write(bookmarklet + '\n');
  console.error(
    `[build-bookmarklet] ${sizeBytes} bytes (limit ${SIZE_LIMIT_BYTES}), pointed at ${editorUrl}, written to ${path.relative(ROOT, outputFile)}`,
  );

  if (editorUrl === DEFAULT_REMOTE) {
    console.error(
      `[build-bookmarklet] WARNING: using placeholder URL. Set EDITOR_URL=https://<your-user>.github.io/wfp-slide-editor/editor.js or run with --local.`,
    );
  }
}

main();
