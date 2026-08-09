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
export function applyMarkdownWriteback(
  source,
  { sourceNotes = [], notes = [], edits = [], boundNoteStarts = null } = {},
) {
  const lines = String(source).split('\n');
  const ops = [];
  const stats = { inserted: 0, updated: 0, removed: 0, edited: 0, unbound: 0 };

  const liveByStart = new Map();
  for (const note of notes) {
    if (note.noteStart != null) liveByStart.set(note.noteStart, note);
  }

  // Callouts that were in the file but whose annotation is gone: delete them.
  //
  // `boundNoteStarts` is the set the host actually attached to the DOM. A
  // callout that never got bound — two notes on one block, where the element
  // can only carry one — is absent from `notes` for a reason that has nothing
  // to do with the user deleting it, so it must be left strictly alone.
  // Treating "not in the DOM" as "deleted" silently destroyed such notes.
  for (const src of sourceNotes) {
    if (boundNoteStarts && !boundNoteStarts.has(src.noteStart)) { stats.unbound += 1; continue; }
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
    //
    // A non-finite anchor means the caller could not resolve a source block
    // (it used to happen when an inline element was annotated, since only
    // block elements carry data-md-*). Number(undefined) is NaN, and
    // splice(NaN, …) silently inserts at index 0 — which put the callout above
    // the first heading and, in a vault note, inside the YAML front matter.
    // Refuse the op instead.
    if (note.anchorEnd != null && !Number.isFinite(note.anchorEnd)) {
      stats.unanchored = (stats.unanchored || 0) + 1;
      return;
    }
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

  // Descending by target line keeps every remaining op's indices valid.
  //
  // At an EQUAL start, replacements must run before pure inserts. A note
  // anchored to the block above lands at exactly the next block's start line;
  // if the insert went first, the replacement's range would then point into
  // the freshly inserted callout and splice through the middle of it, leaving
  // a duplicated block and a misplaced note.
  //
  // Remaining ties (two new notes on one block) are applied in reverse
  // creation order so they end up in creation order in the file.
  ops.sort((a, b) => (
    (b.start - a.start) ||
    (Number(b.deleteCount > 0) - Number(a.deleteCount > 0)) ||
    (b.order - a.order)
  ));
  for (const op of ops) lines.splice(op.start, op.deleteCount, ...op.lines);

  return { text: lines.join('\n'), ...stats };
}
