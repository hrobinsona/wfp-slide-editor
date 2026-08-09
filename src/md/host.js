// ===========================================================================
// Markdown review host (v2.22)
//
// Owns everything the editor deliberately does not know about: opening a
// Markdown file, rendering it into an anchoring surface, stamping saved
// callouts back on as editor annotations, and writing Markdown out again.
//
// The editor↔host contract is two flags and two hooks:
//   host → editor : documentElement.dataset.wfpMarkdown = 'true'  (reduces surface)
//                   window.__wfpMarkdownSink = async () => result (replaces export)
//   editor → host : window.__wfpMarkdownBridge = { reset, refresh }
//
// All chrome lives OUTSIDE <main>. The editor resolves <main> as its flat
// root and findSelectableTarget refuses anything the root does not contain,
// so the toolbar can never be selected or annotated.
// ===========================================================================

const DB_NAME = 'wfp-md-review';
const STORE = 'handles';
const HANDLE_KEY = 'last';
const DIR_KEY = 'lastDir';
const RECENTS_KEY = 'recents';
// Walk caps. A vault can be large and this list only has to be usable, not
// exhaustive; hidden and dependency directories are never interesting here.
const MAX_DEPTH = 6;
const MAX_FILES = 500;
const SKIP_DIRS = new Set(['node_modules', '.git', '.obsidian', 'dist', 'build']);

const els = {};
let fileHandle = null;
let dirHandle = null;
let currentFileDir = null; // path segments from the folder root to the open file
let sourceText = '';
let sourceNotes = [];
let blockIndex = new Map(); // "start-end" → scanned block (for edit detection)
let objectUrls = []; // blob URLs minted for relative images; revoked on re-render
let recents = []; // most-recent-first file handles, mirrored to IndexedDB
let boundNoteStarts = new Set(); // source callouts actually attached to the DOM
let renderedText = new Map(); // block key → textContent as first rendered
let sourceEol = '\n'; // the file's own line ending, restored on write

function idb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function rememberHandle(handle, key = HANDLE_KEY) {
  try {
    const db = await idb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(handle, key);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  } catch (_) { /* handle persistence is a convenience, never a hard failure */ }
}

async function recallHandle(key = HANDLE_KEY) {
  try {
    const db = await idb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(key);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  } catch (_) {
    return null;
  }
}

async function ensurePermission(handle, mode = 'readwrite') {
  if (!handle || typeof handle.queryPermission !== 'function') return true;
  if ((await handle.queryPermission({ mode })) === 'granted') return true;
  return (await handle.requestPermission({ mode })) === 'granted';
}

function setStatus(message, tone = '') {
  els.status.textContent = message;
  els.status.dataset.tone = tone;
}

function annotationId() {
  return `ann-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

// ---------------------------------------------------------------------------
// Folder access
//
// Opening the vault (or repo) root once buys two things a single-file picker
// cannot: a list to pick notes from without re-prompting, and the ability to
// resolve relative images, which live beside the note rather than inside it.
// ---------------------------------------------------------------------------
async function listMarkdownFiles(root) {
  const found = [];
  async function walk(dir, segments, depth) {
    if (depth > MAX_DEPTH || found.length >= MAX_FILES) return;
    for await (const [name, handle] of dir.entries()) {
      if (found.length >= MAX_FILES) return;
      if (name.startsWith('.') || SKIP_DIRS.has(name)) continue;
      if (handle.kind === 'directory') {
        await walk(handle, [...segments, name], depth + 1);
      } else if (/\.(md|markdown)$/i.test(name)) {
        found.push({ path: [...segments, name].join('/'), dir: segments, handle });
      }
    }
  }
  await walk(root, [], 0);
  found.sort((a, b) => a.path.localeCompare(b.path));
  return found;
}

function populateFileList(files) {
  els.files.replaceChildren();
  const placeholder = document.createElement('option');
  placeholder.textContent = files.length ? `${files.length} notes — pick one` : 'No .md files found';
  placeholder.value = '';
  els.files.appendChild(placeholder);
  files.forEach((file, index) => {
    const option = document.createElement('option');
    option.value = String(index);
    option.textContent = file.path;
    els.files.appendChild(option);
  });
  els.files.hidden = files.length === 0;
  els.files.__files = files;
}

async function openDirectory(handle) {
  const picked = handle || (await window.showDirectoryPicker({ mode: 'readwrite' }));
  if (!(await ensurePermission(picked))) { setStatus('Folder permission denied', 'error'); return; }
  dirHandle = picked;
  await rememberHandle(picked, DIR_KEY);
  setStatus(`Reading ${picked.name}…`);
  populateFileList(await listMarkdownFiles(picked));
  setStatus(`${picked.name} — pick a note`);
}

// Markdown references images by a path relative to the note. Nothing in the
// page can read that path directly, so each one is fetched through the folder
// handle and swapped for a blob URL.
async function resolveRelativeImages() {
  for (const url of objectUrls) URL.revokeObjectURL(url);
  objectUrls = [];
  if (!dirHandle || !currentFileDir) return;
  for (const img of els.doc.querySelectorAll('img[src]')) {
    const src = img.getAttribute('src');
    if (!src || /^(https?:|data:|blob:)/i.test(src)) continue;
    const segments = [...currentFileDir, ...src.split('/')].filter((s) => s && s !== '.');
    const resolved = [];
    for (const segment of segments) {
      if (segment === '..') resolved.pop();
      else resolved.push(segment);
    }
    try {
      let dir = dirHandle;
      for (const segment of resolved.slice(0, -1)) dir = await dir.getDirectoryHandle(segment);
      const file = await (await dir.getFileHandle(resolved[resolved.length - 1])).getFile();
      const url = URL.createObjectURL(file);
      objectUrls.push(url);
      img.src = url;
    } catch (_) {
      img.dataset.mdUnresolved = 'true'; // missing asset stays visible as a broken ref
    }
  }
}

// ---------------------------------------------------------------------------
// Render + stamp
// ---------------------------------------------------------------------------
function renderInto(text) {
  const { html, notes, blocks } = renderMarkdown(text);
  sourceText = text;
  sourceNotes = notes;
  blockIndex = new Map();
  for (const block of blocks) blockIndex.set(`${block.start}-${block.end}`, block);

  if (window.__wfpMarkdownBridge) window.__wfpMarkdownBridge.reset();
  els.doc.innerHTML = html;

  // Saved callouts become live annotations again — this is what stops notes
  // from accumulating as visible blockquotes and keeps the notes panel in
  // sync with the file across sessions.
  boundNoteStarts = new Set();
  for (const note of notes) {
    const target = els.doc.querySelector(
      `[data-md-line="${note.anchorLine}"][data-md-end="${note.anchorEnd}"]`,
    );
    if (!target) continue;
    // One element can only carry one annotation. A second callout on the same
    // block stays unbound rather than overwriting the first — and because it
    // is unbound, writeback leaves it in the file untouched instead of reading
    // its absence from the DOM as a deletion.
    if (target.hasAttribute('data-wfp-edit-annotation-id')) continue;
    boundNoteStarts.add(note.noteStart);
    target.setAttribute('data-wfp-edit-annotation-id', annotationId());
    target.setAttribute('data-wfp-edit-annotation-text', note.text);
    if (note.status) target.setAttribute('data-wfp-edit-annotation-status', note.status);
    if (note.reply) target.setAttribute('data-wfp-edit-annotation-reply', note.reply);
    target.dataset.mdNoteLine = String(note.noteStart);
    target.dataset.mdNoteEnd = String(note.noteEnd);
  }

  // Baseline for edit detection. Comparing a block's live textContent against
  // its raw Markdown source reports every formatted block as changed forever;
  // comparing against what was actually rendered detects real edits only.
  renderedText = new Map();
  for (const el of els.doc.querySelectorAll('[data-md-line]')) {
    renderedText.set(`${el.dataset.mdLine}-${el.dataset.mdEnd}`, normalizeText(el.textContent));
  }

  if (window.__wfpMarkdownBridge) window.__wfpMarkdownBridge.refresh();
  els.doc.dataset.ready = 'true';
  resolveRelativeImages();
}

function normalizeEol(value) {
  return String(value).replace(/\r\n/g, '\n');
}

function normalizeText(value) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
}

// ---------------------------------------------------------------------------
// Collect current state from the DOM
// ---------------------------------------------------------------------------
function collectNotes() {
  return [...els.doc.querySelectorAll('[data-wfp-edit-annotation-id]')]
    .map((el) => {
      // The editor lets you select any descendant, so a note can land on a
      // <strong> or <a>, which carries no source range. Resolve up to the
      // owning block — commenting on a bold figure should anchor to its
      // paragraph, not fail.
      const block = el.closest('[data-md-line]');
      return {
        text: el.getAttribute('data-wfp-edit-annotation-text') || '',
        status: el.getAttribute('data-wfp-edit-annotation-status') || '',
        reply: el.getAttribute('data-wfp-edit-annotation-reply') || '',
        anchorEnd: block ? Number(block.dataset.mdEnd) : null,
        noteStart: el.dataset.mdNoteLine === undefined ? null : Number(el.dataset.mdNoteLine),
        noteEnd: el.dataset.mdNoteEnd === undefined ? null : Number(el.dataset.mdNoteEnd),
      };
    })
    .filter((n) => n.text.trim() && (n.noteStart != null || Number.isFinite(n.anchorEnd)));
}

// Text edits are intentionally narrow: paragraphs and headings whose SOURCE is
// pure text. Anything with inline markup (a link, bold, code) would lose that
// syntax if we rebuilt its source line from textContent, so those blocks are
// reported as skipped rather than silently flattened.
//
// The plain-text test deliberately runs against the ORIGINAL source, never the
// live DOM: editing a paragraph replaces its children, so `**bold**` has
// already become a bare text node by the time we look — a DOM check would see
// no markup and happily flatten the source.
function isPlainSource(block) {
  // A pipe table survives every inline rule untouched, so the markup test
  // alone would call it plain and let an edit collapse its rows into one line.
  if (/^\s*\|/m.test(block.text)) return false;
  return renderInline(block.text) === escapeHtml(block.text);
}

function collectEdits() {
  const edits = [];
  const skipped = [];
  for (const el of els.doc.querySelectorAll('[data-md-line]')) {
    const key = `${el.dataset.mdLine}-${el.dataset.mdEnd}`;
    const block = blockIndex.get(key);
    if (!block || (block.type !== 'paragraph' && block.type !== 'heading')) continue;
    const current = normalizeText(el.textContent);
    if (current === renderedText.get(key)) continue; // genuinely untouched
    if (!isPlainSource(block)) {
      skipped.push(normalizeText(block.text).slice(0, 40));
      continue;
    }
    edits.push({
      start: block.start,
      end: block.end,
      kind: block.type,
      level: block.level,
      text: el.textContent.trim(),
    });
  }
  return { edits, skipped };
}

// ---------------------------------------------------------------------------
// Save
// ---------------------------------------------------------------------------
async function save() {
  if (!fileHandle) return { ok: false, message: 'No file open' };
  if (!(await ensurePermission(fileHandle))) return { ok: false, message: 'Write permission denied' };

  // The agent writes these files constantly. Refuse rather than clobber if the
  // file changed underneath us since it was rendered. Compared on normalized
  // line endings, since that is the form we hold.
  const onDisk = normalizeEol(await (await fileHandle.getFile()).text());
  if (onDisk !== sourceText) {
    return { ok: false, message: 'File changed on disk — reopen before saving' };
  }

  const notes = collectNotes();
  const { edits, skipped } = collectEdits();
  const result = applyMarkdownWriteback(sourceText, { sourceNotes, notes, edits, boundNoteStarts });

  const writable = await fileHandle.createWritable();
  // Restore the file's own line endings; everything upstream works in \n.
  await writable.write(sourceEol === '\n' ? result.text : result.text.replace(/\n/g, sourceEol));
  await writable.close();

  // Re-render so line numbers match the file again; a second save against
  // stale numbers would splice into the wrong place.
  renderInto(result.text);

  const parts = [];
  if (result.inserted) parts.push(`${result.inserted} added`);
  if (result.updated) parts.push(`${result.updated} updated`);
  if (result.removed) parts.push(`${result.removed} removed`);
  if (result.edited) parts.push(`${result.edited} edited`);
  let message = parts.length ? `Saved — ${parts.join(', ')}` : 'Saved — no changes';
  if (skipped.length) message += ` · ${skipped.length} formatted block(s) left untouched`;
  // A block can only carry one annotation, so any further callout on it stays
  // in the file but is invisible here. Say so, or it reads as a lost note.
  if (result.unbound) message += ` · ${result.unbound} note(s) not shown (one per block)`;
  return { ok: true, message };
}

async function openFile(handle, fileDir = null) {
  const picked = handle || (await window.showOpenFilePicker({
    types: [{ description: 'Markdown', accept: { 'text/markdown': ['.md', '.markdown'] } }],
    multiple: false,
  }))[0];
  if (!(await ensurePermission(picked))) { setStatus('Permission denied', 'error'); return; }
  fileHandle = picked;
  // Only a file reached through the folder handle has a known location, and
  // therefore resolvable relative images.
  currentFileDir = fileDir;
  await rememberHandle(picked);
  // Refresh the recents list on EVERY open, not just at boot. The first
  // version bound the reopen control once during boot and closed over that
  // handle, so it named — and reopened — whichever file happened to be first,
  // for the rest of the session.
  recents = await mergeRecents(recents, picked);
  await rememberHandle(recents, RECENTS_KEY);
  renderRecents();
  const raw = await (await picked.getFile()).text();
  // CRLF files would otherwise break every line regex (`.` never matches \r),
  // silently turning headings into paragraphs and callouts into content.
  sourceEol = raw.includes('\r\n') ? '\r\n' : '\n';
  renderInto(normalizeEol(raw));
  document.title = `${picked.name} — review`;
  setStatus(`${sourceNotes.length} note${sourceNotes.length === 1 ? '' : 's'} in file`);
  loadEditor();
}

// Rebuilt from `recents` each time rather than mutated, so the control can
// never drift from the list it represents.
function renderRecents() {
  const labels = recentLabels(recents);
  els.recent.replaceChildren();
  // The open file is always recents[0], so the control can name what you are
  // looking at AND switch away from it. The placeholder only exists for the
  // state where history was restored but nothing is open yet.
  if (!fileHandle) {
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = recents.length ? 'Recent…' : 'No recent files';
    els.recent.appendChild(placeholder);
  }
  labels.forEach((label, index) => {
    const option = document.createElement('option');
    option.value = String(index);
    option.textContent = label;
    els.recent.appendChild(option);
  });
  els.recent.hidden = recents.length === 0;
  els.recent.value = fileHandle ? '0' : '';
}

let editorLoaded = false;
function loadEditor() {
  if (editorLoaded) return;
  editorLoaded = true;
  document.documentElement.dataset.wfpMarkdown = 'true';
  const script = document.createElement('script');
  script.src = els.doc.dataset.editorSrc || '../editor.js';
  document.body.appendChild(script);
}

// The editor calls this instead of writing HTML when Markdown mode is on.
window.__wfpMarkdownSink = async function markdownSink() {
  try {
    const result = await save();
    setStatus(result.message, result.ok ? 'ok' : 'error');
    return result;
  } catch (error) {
    setStatus(`Save failed: ${error.message}`, 'error');
    return { ok: false, message: error.message };
  }
};

// Everything except file I/O, exposed for tests: the File System Access
// picker cannot be driven by automation, so coverage drives the render →
// annotate → writeback path directly and the picker is verified by hand.
window.__wfpMarkdownHost = {
  renderInto,
  collectNotes,
  collectEdits,
  // Accepts a stand-in handle so the open→recents wiring can be exercised
  // without a picker; the real one differs only in where it comes from.
  openFile,
  get recents() { return recents.map((h) => h.name); },
  writeback: () => {
    const { edits } = collectEdits();
    return applyMarkdownWriteback(sourceText, {
      sourceNotes, notes: collectNotes(), edits, boundNoteStarts,
    });
  },
  get source() { return sourceText; },
};

function boot() {
  els.doc = document.getElementById('md-doc');
  els.status = document.getElementById('md-status');
  els.files = document.getElementById('md-files');
  els.recent = document.getElementById('md-recent');
  const guard = (fn) => () => fn().catch((e) => setStatus(e.message, 'error'));

  document.getElementById('md-open').addEventListener('click', guard(() => openFile()));
  document.getElementById('md-open-dir').addEventListener('click', guard(() => openDirectory()));
  document.getElementById('md-save').addEventListener('click', () => window.__wfpMarkdownSink());
  els.files.addEventListener('change', guard(async () => {
    const file = els.files.__files?.[Number(els.files.value)];
    if (file) await openFile(file.handle, file.dir);
  }));
  // Reads `recents` at click time rather than closing over a handle, which is
  // what made the old single button permanently stale.
  els.recent.addEventListener('change', guard(async () => {
    const handle = recents[Number(els.recent.value)];
    if (handle) await openFile(handle);
  }));

  if (!window.showOpenFilePicker) {
    setStatus('This browser has no File System Access API — use Chrome or Edge', 'error');
    return;
  }

  // Stored handles need a fresh user gesture to re-grant after a restart, so
  // the reopen affordances are buttons rather than anything automatic.
  recallHandle(DIR_KEY).then((handle) => {
    if (!handle) return;
    const reopenDir = document.getElementById('md-reopen-dir');
    reopenDir.hidden = false;
    reopenDir.textContent = `Reopen ${handle.name}/`;
    reopenDir.addEventListener('click', guard(() => openDirectory(handle)));
  });
  recallHandle(RECENTS_KEY).then((stored) => {
    recents = Array.isArray(stored) ? stored.filter(Boolean) : [];
    renderRecents();
  });
  setStatus('Open a folder or a single .md to begin');
}

document.addEventListener('DOMContentLoaded', boot);
