#!/usr/bin/env node
/**
 * Assemble the deployed bookmarklet runtime from ordered source fragments.
 *
 * The bookmarklet still loads one self-contained `editor.js`; this script only
 * gives the source clearer physical boundaries while preserving that runtime
 * contract.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SOURCE_ROOT = path.join(ROOT, 'src', 'editor');
const DEFAULT_OUTPUT_FILE = path.join(ROOT, 'editor.js');

const PARTS = [
  '00-preamble.js',
  '10-state.js',
  '20-dom-css.js',
  '30-ui-inspector-controls.js',
  '40-helpers-selection-inspector.js',
  '45-notes-panel.js',
  '50-history.js',
  '60-modes-overview-keyboard.js',
  '70-selection-events.js',
  '80-drag-resize-unlock.js',
  '85-adaptive-fade.js',
  '90-text-edit.js',
  '95-export.js',
  '96-live-refresh.js',
  '99-ready.js',
];

function resolveOutputFile(argv) {
  const equalsArg = argv.find((arg) => arg.startsWith('--out='));
  if (equalsArg) {
    const value = equalsArg.slice('--out='.length).trim();
    if (!value) throw new Error('--out requires a file path.');
    return path.resolve(process.cwd(), value);
  }

  const idx = argv.indexOf('--out');
  if (idx === -1) return DEFAULT_OUTPUT_FILE;

  const value = argv[idx + 1];
  if (!value || value.startsWith('--')) throw new Error('--out requires a file path.');
  return path.resolve(process.cwd(), value);
}

function buildEditorSource() {
  return PARTS
    .map((part) => {
      const file = path.join(SOURCE_ROOT, part);
      if (!fs.existsSync(file)) throw new Error(`Missing editor source fragment: ${part}`);
      return fs.readFileSync(file, 'utf-8');
    })
    .join('');
}

function main() {
  const argv = process.argv.slice(2);
  const outputFile = resolveOutputFile(argv);
  const checkOnly = argv.includes('--check');
  const source = buildEditorSource();

  if (checkOnly) {
    const existing = fs.existsSync(outputFile) ? fs.readFileSync(outputFile, 'utf-8') : '';
    if (existing !== source) {
      console.error(
        `[build-editor] ${path.relative(ROOT, outputFile)} is out of date. Run npm run build:editor.`,
      );
      process.exit(1);
    }
    console.error(`[build-editor] ${path.relative(ROOT, outputFile)} is up to date.`);
    return;
  }

  fs.mkdirSync(path.dirname(outputFile), { recursive: true });
  fs.writeFileSync(outputFile, source, 'utf-8');
  console.error(
    `[build-editor] wrote ${path.relative(ROOT, outputFile)} from ${PARTS.length} source fragments.`,
  );
}

main();
