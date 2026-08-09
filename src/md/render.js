// ===========================================================================
// Markdown → HTML render layer (v2.22)
//
// This is an ANCHORING SURFACE, not an Obsidian replica. Its job is to give
// the editor a DOM whose every block knows exactly which source lines it came
// from, so an annotation maps back to a line range with no text matching and
// no orphan class of bugs. Fidelity beyond that is explicitly a non-goal:
// wikilinks, embeds, Dataview, and setext headings render as literal text.
//
// Dependency-free by project convention. Block scanning is a single pass over
// lines, deliberately separated from HTML emission: a block's source range is
// decided by the scanner alone and never adjusted while generating markup.
//
// Line numbers are 0-indexed and INCLUSIVE at both ends:
//   data-md-line = first source line of the block
//   data-md-end  = last source line of the block
// ===========================================================================

export const MD_NOTE_TYPE = 'HARRY';

const CALLOUT_RE = new RegExp(`^>\\s*\\[!${MD_NOTE_TYPE}\\]\\s?(.*)$`, 'i');
const QUOTE_LINE_RE = /^>\s?(.*)$/;
const ATX_RE = /^(#{1,6})\s+(.*)$/;
const FENCE_RE = /^(```|~~~)(.*)$/;
const HR_RE = /^(?:\s*[-*_]){3,}\s*$/;
const UL_RE = /^(\s*)([-*+])\s+(.*)$/;
const OL_RE = /^(\s*)(\d{1,9})[.)]\s+(.*)$/;

// Sentinel for extracted code spans. U+0000 cannot appear in Markdown text
// that reached us from a file read, so it cannot collide with content — and
// unlike a space-delimited placeholder it never perturbs the surrounding text.
const CODE_OPEN = '\u0000';
const CODE_CLOSE = '\u0001';

export function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Only http(s) and mailto survive an explicit scheme; relative and in-page
// targets pass through untouched. Anything else becomes inert text, so a
// javascript: or data: link committed into a vault note can never go live in
// the review surface.
function safeUrl(raw) {
  const url = String(raw || '').trim();
  const probe = url.replace(/[\u0000-\u0020\u007f]+/g, '');
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(probe);
  if (!scheme) return url;
  const name = scheme[1].toLowerCase();
  return name === 'http' || name === 'https' || name === 'mailto' ? url : null;
}

// Inline marks, applied to escaped text. Code spans are lifted out first and
// restored last so their contents are never parsed as emphasis or links.
export function renderInline(text) {
  const codes = [];
  let out = String(text).replace(/`([^`]+)`/g, (_, code) => {
    codes.push(code);
    return `${CODE_OPEN}${codes.length - 1}${CODE_CLOSE}`;
  });
  out = escapeHtml(out);
  out = out.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (whole, alt, href) => {
    const url = safeUrl(href);
    return url === null ? escapeHtml(whole) : `<img src="${escapeHtml(url)}" alt="${alt}">`;
  });
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (whole, label, href) => {
    const url = safeUrl(href);
    return url === null ? escapeHtml(whole) : `<a href="${escapeHtml(url)}">${label}</a>`;
  });
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/__([^_]+)__/g, '<strong>$1</strong>');
  out = out.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  out = out.replace(/~~([^~]+)~~/g, '<del>$1</del>');
  return out.replace(
    new RegExp(`${CODE_OPEN}(\\d+)${CODE_CLOSE}`, 'g'),
    (_, i) => `<code>${escapeHtml(codes[Number(i)])}</code>`,
  );
}

function isBlankLine(line) {
  return /^\s*$/.test(line);
}

function isBlockStart(line) {
  return (
    ATX_RE.test(line) ||
    FENCE_RE.test(line) ||
    QUOTE_LINE_RE.test(line) ||
    UL_RE.test(line) ||
    OL_RE.test(line) ||
    HR_RE.test(line)
  );
}

/** Flat list of block descriptors with exact source ranges. */
export function scanBlocks(lines) {
  const blocks = [];
  let i = 0;

  // YAML front matter is metadata, not prose. Without this it scans as
  // hr/paragraph/hr, and annotating that "paragraph" splices a callout between
  // the fences — which breaks Obsidian properties. Claimed as one opaque
  // block so nothing can render, anchor to, or edit inside it.
  if (lines[0] === '---') {
    for (let j = 1; j < lines.length; j += 1) {
      if (lines[j] === '---' || lines[j] === '...') {
        blocks.push({ type: 'frontmatter', start: 0, end: j });
        i = j + 1;
        break;
      }
    }
  }

  while (i < lines.length) {
    const line = lines[i];
    if (isBlankLine(line)) { i += 1; continue; }

    const fence = FENCE_RE.exec(line);
    if (fence) {
      const marker = fence[1];
      let end = lines.length - 1;
      for (let j = i + 1; j < lines.length; j += 1) {
        if (lines[j].startsWith(marker)) { end = j; break; }
      }
      blocks.push({ type: 'code', start: i, end, info: fence[2].trim(), body: lines.slice(i + 1, end) });
      i = end + 1;
      continue;
    }

    if (HR_RE.test(line) && !UL_RE.test(line)) {
      blocks.push({ type: 'hr', start: i, end: i });
      i += 1;
      continue;
    }

    const atx = ATX_RE.exec(line);
    if (atx) {
      blocks.push({ type: 'heading', start: i, end: i, level: atx[1].length, text: atx[2].trim() });
      i += 1;
      continue;
    }

    if (QUOTE_LINE_RE.test(line)) {
      let end = i;
      while (end + 1 < lines.length && QUOTE_LINE_RE.test(lines[end + 1])) end += 1;
      const raw = lines.slice(i, end + 1);
      const callout = CALLOUT_RE.exec(raw[0]);
      if (callout) {
        blocks.push({ type: 'callout', start: i, end, ...parseCalloutBody(callout[1], raw.slice(1)) });
      } else {
        blocks.push({ type: 'quote', start: i, end, lines: raw.map((l) => QUOTE_LINE_RE.exec(l)[1]) });
      }
      i = end + 1;
      continue;
    }

    if (UL_RE.test(line) || OL_RE.test(line)) {
      const ordered = !UL_RE.test(line);
      let end = i;
      while (end + 1 < lines.length) {
        const next = lines[end + 1];
        const after = lines[end + 2];
        // A blank line ends the list unless another item follows it, so loose
        // lists keep their separators without swallowing the next paragraph.
        if (isBlankLine(next)) {
          if (after === undefined || (!UL_RE.test(after) && !OL_RE.test(after))) break;
          end += 2;
          continue;
        }
        if (!UL_RE.test(next) && !OL_RE.test(next)) break;
        end += 1;
      }
      const items = [];
      for (let j = i; j <= end; j += 1) {
        const m = UL_RE.exec(lines[j]) || OL_RE.exec(lines[j]);
        if (m) items.push({ line: j, text: m[3] });
      }
      blocks.push({ type: 'list', start: i, end, ordered, items });
      i = end + 1;
      continue;
    }

    let end = i;
    while (end + 1 < lines.length && !isBlankLine(lines[end + 1]) && !isBlockStart(lines[end + 1])) {
      end += 1;
    }
    blocks.push({ type: 'paragraph', start: i, end, text: lines.slice(i, end + 1).join('\n') });
    i = end + 1;
  }
  return blocks;
}

// `> [!HARRY] instruction`, continuation lines, and the agent's channel back:
// `status:` and `reply:` reuse the same vocabulary as the HTML handoff.
function parseCalloutBody(firstLine, restLines) {
  const textParts = [];
  if (firstLine.trim()) textParts.push(firstLine.trim());
  let status = '';
  let reply = '';
  for (const raw of restLines) {
    const inner = QUOTE_LINE_RE.exec(raw)[1];
    const statusMatch = /^status:\s*(.*)$/i.exec(inner);
    if (statusMatch) { status = statusMatch[1].trim(); continue; }
    const replyMatch = /^reply:\s*(.*)$/i.exec(inner);
    if (replyMatch) { reply = replyMatch[1].trim(); continue; }
    if (inner.trim()) textParts.push(inner.trim());
  }
  return { text: textParts.join(' '), status, reply };
}

function attrs(block) {
  return ` data-md-line="${block.start}" data-md-end="${block.end}"`;
}

function renderBlockHtml(block) {
  switch (block.type) {
    case 'heading':
      return `<h${block.level}${attrs(block)}>${renderInline(block.text)}</h${block.level}>`;
    case 'paragraph':
      return `<p${attrs(block)}>${renderInline(block.text)}</p>`;
    case 'hr':
      return `<hr${attrs(block)}>`;
    case 'code':
      return `<pre${attrs(block)}><code>${escapeHtml(block.body.join('\n'))}</code></pre>`;
    case 'quote':
      return `<blockquote${attrs(block)}>${renderInline(block.lines.join('\n'))}</blockquote>`;
    case 'list': {
      const tag = block.ordered ? 'ol' : 'ul';
      // Newline-separated so the list's own textContent reads as separate
      // items — note-card snippets are built from it, and joined markup would
      // render "first item?second item?" with no break between them.
      const items = block.items
        .map((it) => `<li data-md-line="${it.line}" data-md-end="${it.line}">${renderInline(it.text)}</li>`)
        .join('\n');
      return `<${tag}${attrs(block)}>\n${items}\n</${tag}>`;
    }
    default:
      return '';
  }
}

/**
 * Render Markdown into an anchoring surface.
 *
 * Returns { html, notes, blocks }. `notes` describes every callout in the
 * source, each already bound to the block it annotates — the host page stamps
 * those onto the DOM as editor annotation attributes, which is what makes a
 * saved note reappear as a note rather than as visible content.
 */
export function renderMarkdown(text) {
  const lines = String(text).split('\n');
  const blocks = scanBlocks(lines);
  const notes = [];
  const contentBlocks = [];

  blocks.forEach((block, index) => {
    // Front matter is carried in the source but never rendered, so it cannot
    // be annotated, edited, or used as an anchor.
    if (block.type === 'frontmatter') return;
    if (block.type !== 'callout') { contentBlocks.push(block); return; }
    // A callout annotates the block it FOLLOWS; with nothing before it, the
    // one it precedes. Paired by index in the scanned list, so the binding
    // never depends on rendered text.
    let anchor = null;
    for (let j = index - 1; j >= 0; j -= 1) {
      if (blocks[j].type !== 'callout') { anchor = blocks[j]; break; }
    }
    if (!anchor) {
      for (let j = index + 1; j < blocks.length; j += 1) {
        if (blocks[j].type !== 'callout') { anchor = blocks[j]; break; }
      }
    }
    notes.push({
      text: block.text,
      status: block.status,
      reply: block.reply,
      noteStart: block.start,
      noteEnd: block.end,
      anchorLine: anchor ? anchor.start : null,
      anchorEnd: anchor ? anchor.end : null,
    });
  });

  return { html: contentBlocks.map(renderBlockHtml).join('\n'), notes, blocks: contentBlocks };
}
