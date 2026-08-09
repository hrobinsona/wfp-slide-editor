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

const els = {};
let fileHandle = null;
let sourceText = '';
let sourceNotes = [];
let blockIndex = new Map(); // "start-end" → scanned block (for edit detection)

function idb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function rememberHandle(handle) {
  try {
    const db = await idb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(handle, HANDLE_KEY);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  } catch (_) { /* handle persistence is a convenience, never a hard failure */ }
}

async function recallHandle() {
  try {
    const db = await idb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(HANDLE_KEY);
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
  for (const note of notes) {
    const target = els.doc.querySelector(
      `[data-md-line="${note.anchorLine}"][data-md-end="${note.anchorEnd}"]`,
    );
    if (!target) continue;
    target.setAttribute('data-wfp-edit-annotation-id', annotationId());
    target.setAttribute('data-wfp-edit-annotation-text', note.text);
    if (note.status) target.setAttribute('data-wfp-edit-annotation-status', note.status);
    if (note.reply) target.setAttribute('data-wfp-edit-annotation-reply', note.reply);
    target.dataset.mdNoteLine = String(note.noteStart);
    target.dataset.mdNoteEnd = String(note.noteEnd);
  }

  if (window.__wfpMarkdownBridge) window.__wfpMarkdownBridge.refresh();
  els.doc.dataset.ready = 'true';
}

// ---------------------------------------------------------------------------
// Collect current state from the DOM
// ---------------------------------------------------------------------------
function collectNotes() {
  return [...els.doc.querySelectorAll('[data-wfp-edit-annotation-id]')]
    .map((el) => ({
      text: el.getAttribute('data-wfp-edit-annotation-text') || '',
      status: el.getAttribute('data-wfp-edit-annotation-status') || '',
      reply: el.getAttribute('data-wfp-edit-annotation-reply') || '',
      anchorEnd: Number(el.dataset.mdEnd),
      noteStart: el.dataset.mdNoteLine === undefined ? null : Number(el.dataset.mdNoteLine),
      noteEnd: el.dataset.mdNoteEnd === undefined ? null : Number(el.dataset.mdNoteEnd),
    }))
    .filter((n) => n.text.trim());
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
  return renderInline(block.text) === escapeHtml(block.text);
}

function collectEdits() {
  const edits = [];
  const skipped = [];
  for (const el of els.doc.querySelectorAll('[data-md-line]')) {
    const key = `${el.dataset.mdLine}-${el.dataset.mdEnd}`;
    const block = blockIndex.get(key);
    if (!block || (block.type !== 'paragraph' && block.type !== 'heading')) continue;
    const current = el.textContent.replace(/\s+/g, ' ').trim();
    const original = String(block.text).replace(/\s+/g, ' ').trim();
    if (current === original) continue;
    if (!isPlainSource(block)) {
      skipped.push(original.slice(0, 40));
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
  // file changed underneath us since it was rendered.
  const onDisk = await (await fileHandle.getFile()).text();
  if (onDisk !== sourceText) {
    return { ok: false, message: 'File changed on disk — reopen before saving' };
  }

  const notes = collectNotes();
  const { edits, skipped } = collectEdits();
  const result = applyMarkdownWriteback(sourceText, { sourceNotes, notes, edits });

  const writable = await fileHandle.createWritable();
  await writable.write(result.text);
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
  return { ok: true, message };
}

async function openFile(handle) {
  const picked = handle || (await window.showOpenFilePicker({
    types: [{ description: 'Markdown', accept: { 'text/markdown': ['.md', '.markdown'] } }],
    multiple: false,
  }))[0];
  if (!(await ensurePermission(picked))) { setStatus('Permission denied', 'error'); return; }
  fileHandle = picked;
  await rememberHandle(picked);
  const text = await (await picked.getFile()).text();
  renderInto(text);
  els.name.textContent = picked.name;
  document.title = `${picked.name} — review`;
  setStatus(`${sourceNotes.length} note${sourceNotes.length === 1 ? '' : 's'} in file`);
  loadEditor();
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
  writeback: () => {
    const { edits } = collectEdits();
    return applyMarkdownWriteback(sourceText, { sourceNotes, notes: collectNotes(), edits });
  },
  get source() { return sourceText; },
};

function boot() {
  els.doc = document.getElementById('md-doc');
  els.status = document.getElementById('md-status');
  els.name = document.getElementById('md-name');
  document.getElementById('md-open').addEventListener('click', () => openFile().catch((e) => setStatus(e.message, 'error')));
  document.getElementById('md-save').addEventListener('click', () => window.__wfpMarkdownSink());

  if (!window.showOpenFilePicker) {
    setStatus('This browser has no File System Access API — use Chrome or Edge', 'error');
    return;
  }
  recallHandle().then(async (handle) => {
    if (!handle) { setStatus('Open a Markdown file to begin'); return; }
    const reopen = document.getElementById('md-reopen');
    reopen.hidden = false;
    reopen.textContent = `Reopen ${handle.name}`;
    reopen.addEventListener('click', () => openFile(handle).catch((e) => setStatus(e.message, 'error')));
    setStatus('Open a Markdown file to begin');
  });
}

document.addEventListener('DOMContentLoaded', boot);
