// ===========================================================================
// Markdown writeback (v2.22)
//
// Turns the editor's current annotation state back into Markdown by splicing
// lines into the ORIGINAL source text. There is deliberately no HTML→Markdown
// conversion anywhere: the source string is the truth, the DOM is a
// projection of it, and saving only inserts, replaces, or removes whole lines
// at ranges the renderer recorded.
//
// The one rule that makes this safe: every operation is expressed against the
// ORIGINAL line numbering, then applied in DESCENDING order, so an earlier
// splice can never invalidate a later one's indices.
// ===========================================================================

import { MD_NOTE_TYPE } from './render.js';

const BLANK = /^\s*$/;

/** One `> [!HARRY]` block, including its optional agent channel lines. */
export function serializeCallout(note) {
  const body = String(note.text || '').trim().split('\n');
  const lines = [`> [!${MD_NOTE_TYPE}] ${body[0] || ''}`.trimEnd()];
  for (const extra of body.slice(1)) lines.push(`> ${extra}`.trimEnd());
  if (note.status) lines.push(`> status: ${note.status}`);
  if (note.reply) lines.push(`> reply: ${note.reply}`);
  return lines;
}

/** The Markdown source line(s) for an edited block, preserving its syntax. */
export function serializeEdit(edit) {
  const text = String(edit.text == null ? '' : edit.text).trim();
  if (edit.kind === 'heading') return [`${'#'.repeat(edit.level || 1)} ${text}`];
  return text.split('\n');
}

function notesEqual(a, b) {
  return (
    String(a.text || '').trim() === String(b.text || '').trim() &&
    String(a.status || '') === String(b.status || '') &&
    String(a.reply || '') === String(b.reply || '')
  );
}

/**
 * Apply the current annotation and edit state to `source`.
 *
 * `sourceNotes` is what the renderer found in the file; `notes` is what the
 * editor holds now. A note carrying `noteStart` came from the file and is
 * matched back to it by line, because callouts deliberately carry no ids —
 * an id in a vault file is noise a human would have to read around.
 *
 * Returns { text, inserted, updated, removed, edited }.
 */
export function applyMarkdownWriteback(source, { sourceNotes = [], notes = [], edits = [] } = {}) {
  const lines = String(source).split('\n');
  const ops = [];
  const stats = { inserted: 0, updated: 0, removed: 0, edited: 0 };

  const liveByStart = new Map();
  for (const note of notes) {
    if (note.noteStart != null) liveByStart.set(note.noteStart, note);
  }

  // Callouts that were in the file but whose annotation is gone: delete them.
  for (const src of sourceNotes) {
    if (liveByStart.has(src.noteStart)) continue;
    let start = src.noteStart;
    let end = src.noteEnd;
    // Consume the blank line that separated the callout from its block, so
    // repeated add/remove cycles cannot accumulate blank lines.
    if (BLANK.test(lines[end + 1] || '') && BLANK.test(lines[start - 1] || '')) end += 1;
    ops.push({ start, deleteCount: end - start + 1, lines: [], order: start });
    stats.removed += 1;
  }

  notes.forEach((note, index) => {
    const text = String(note.text || '').trim();
    if (!text) return;
    if (note.noteStart != null) {
      const src = sourceNotes.find((s) => s.noteStart === note.noteStart);
      if (src && notesEqual(src, note)) return; // untouched
      ops.push({
        start: note.noteStart,
        deleteCount: note.noteEnd - note.noteStart + 1,
        lines: serializeCallout(note),
        order: index,
      });
      stats.updated += 1;
      return;
    }
    // New note: land it immediately after the block it annotates, separated
    // by a blank line so Obsidian renders it as its own callout rather than
    // gluing it to the preceding block.
    const anchorEnd = note.anchorEnd == null ? lines.length - 1 : note.anchorEnd;
    const insertAt = anchorEnd + 1;
    const payload = serializeCallout(note);
    const needsLeadingBlank = !BLANK.test(lines[anchorEnd] || '');
    const needsTrailingBlank = insertAt < lines.length && !BLANK.test(lines[insertAt] || '');
    ops.push({
      start: insertAt,
      deleteCount: 0,
      lines: [...(needsLeadingBlank ? [''] : []), ...payload, ...(needsTrailingBlank ? [''] : [])],
      order: index,
    });
    stats.inserted += 1;
  });

  for (const edit of edits) {
    ops.push({
      start: edit.start,
      deleteCount: edit.end - edit.start + 1,
      lines: serializeEdit(edit),
      order: -1,
    });
    stats.edited += 1;
  }

  // Descending by target line keeps every remaining op's indices valid. Ties
  // (two new notes on the same block) are applied in reverse creation order
  // so they end up in creation order in the file.
  ops.sort((a, b) => (b.start - a.start) || (b.order - a.order));
  for (const op of ops) lines.splice(op.start, op.deleteCount, ...op.lines);

  return { text: lines.join('\n'), ...stats };
}
