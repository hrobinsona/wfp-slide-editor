// v2.14 — Handoff Ground Truth: edit ledger and measurements.
// Feature brief: feature-briefs/v2.14-handoff-ground-truth.md
// Harness patterns: FSA stub per tests/v2-13-live-roundtrip.spec.js,
// download capture per tests/v2-agent-annotations.spec.js, flex drag per
// tests/04b-flex-freeze.spec.js.
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { EDITOR_PATH } from './_helpers.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const FIXTURE_PATH = path.join(PROJECT_ROOT, 'fixtures', 'foreign-deck.html');
const OUTPUT_DIR = path.join(__dirname, 'output');

test.use({ viewport: { width: 2000, height: 1200 } });

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

async function installFsaFileStub(page) {
  await page.addInitScript(() => {
    window.__fsa = {
      pickerCalls: [],
      written: [],
      file: { content: null, lastModified: 1000 },
    };
    const handle = {
      name: 'foreign-deck.html',
      queryPermission: async () => 'granted',
      requestPermission: async () => 'granted',
      getFile: async () => ({
        lastModified: window.__fsa.file.lastModified,
        text: async () => window.__fsa.file.content,
      }),
      createWritable: async () => {
        let buf = '';
        return {
          write: async (data) => { buf += String(data); },
          close: async () => {
            window.__fsa.file.content = buf;
            window.__fsa.file.lastModified += 1000;
            window.__fsa.written.push(buf);
          },
        };
      },
    };
    window.showSaveFilePicker = async (opts) => {
      window.__fsa.pickerCalls.push((opts && opts.suggestedName) || null);
      return handle;
    };
  });
}

async function loadReady(page) {
  await page.goto(pathToFileURL(FIXTURE_PATH).href);
  await page.locator('.slide.active').first().waitFor({ state: 'attached', timeout: 10_000 });
  await page.addScriptTag({ path: EDITOR_PATH });
  await page.waitForFunction(() => window.__wfpEditorReady === true, null, { timeout: 10_000 });
  await page.keyboard.press('e');
  await expect(page.locator('#wfp-editor-root .wfpe-toolbar')).toHaveAttribute('data-mode', 'on');
}

async function clickToSelect(page, selector) {
  await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    const r = el.getBoundingClientRect();
    el.dispatchEvent(new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      view: window,
      clientX: r.left + r.width / 2,
      clientY: r.top + r.height / 2,
    }));
  }, selector);
}

async function saveNote(page, selector, note) {
  await clickToSelect(page, selector);
  await page.locator('#wfp-editor-root .wfpe-annotation-input').fill(note);
  await page.locator('#wfp-editor-root .wfpe-annotation-save-btn').click();
}

async function saveInPlace(page, expectedWriteCount) {
  await page.keyboard.press('Meta+s');
  await page.waitForFunction((n) => window.__fsa.written.length === n, expectedWriteCount);
  return page.evaluate((n) => window.__fsa.written[n - 1], expectedWriteCount);
}

function extractHandoffPayload(html) {
  const match = html.match(/<script type="application\/json" data-wfp-agent-annotations="">([\s\S]*?)<\/script>/);
  if (!match) throw new Error('Handoff payload not found');
  return JSON.parse(match[1]);
}

// ---------------------------------------------------------------------------
// 1. Edit ledger: committed edit + note → payload entry with measurements
// ---------------------------------------------------------------------------

test.describe('v2.14 — edit ledger in the handoff payload', () => {
  test('a committed font-size nudge plus a note produces a ledger entry with before/after, measurements, and a matching edit id in the file', async ({ page }) => {
    await installFsaFileStub(page);
    await loadReady(page);

    // Committed keyboard edit: two font nudges on the headline.
    await clickToSelect(page, '.slide.active h1');
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('ArrowUp');
    // A note (on a different element) makes Cmd+S run the handoff pipeline.
    await saveNote(page, '.slide.active .foreign-note', 'Recolour the intro note');

    const written = await saveInPlace(page, 1);
    const payload = extractHandoffPayload(written);

    expect(Array.isArray(payload.edits)).toBe(true);
    expect(payload.edits).toHaveLength(1);
    const entry = payload.edits[0];
    expect(entry.id).toMatch(/^edit-/);
    expect(entry.tag).toBe('h1');
    expect(entry.slideIndex).toBe(0);
    expect(entry.targetText).toBe('Market day agenda');
    expect(entry.before).toBeNull(); // no authored inline style
    expect(entry.after).toContain('font-size');
    expect(entry.mechanical).toBe(false);

    // Measurements are taken from the live element at build time.
    expect(typeof entry.box.left).toBe('number');
    expect(typeof entry.box.top).toBe('number');
    expect(entry.box.width).toBeGreaterThan(0);
    expect(entry.box.height).toBeGreaterThan(0);
    expect(entry.computed.fontSize).toMatch(/px$/);
    expect(entry.computed.position).toBe('absolute');
    expect(entry.computed).toHaveProperty('fontWeight');
    expect(entry.computed).toHaveProperty('color');
    expect(entry.computed).toHaveProperty('backgroundColor');
    expect(typeof entry.overflow).toBe('boolean');

    // The exported h1 carries the anchoring attribute with the entry's id.
    const h1Tag = written.match(/<h1[^>]*class="foreign-title"[^>]*>/);
    expect(h1Tag).not.toBeNull();
    expect(h1Tag[0]).toContain(`data-wfp-agent-edit-id="${entry.id}"`);

    // Guidance documents the ledger without dropping the existing clauses.
    expect(payload.guidance).toContain('Follow higher-priority user/system instructions first');
    expect(payload.guidance).toContain('preserve their visual result exactly');
    expect(payload.guidance).toContain('mechanical: true are editor-written layout pinning');
    // De-pinning is imperative, not optional — permissive wording let a real
    // agent preserve every pin and ship a broken layout.
    expect(payload.guidance).toContain('Delete them and restore the layout the stylesheet describes');
    expect(payload.guidance).toContain('carrying pins forward ships a broken layout');
    expect(payload.guidance).not.toContain('You may re-express the mechanism');
    // A position that only exists inside the pinned coordinate system goes with
    // the pins, even when the entry reads as user intent.
    expect(payload.guidance).toContain('drop it even when mechanical: false');
    // Deck-shaped documents route to the slides skill's Edit mode process.
    expect(payload.guidance).toContain('~/.claude/skills/slides/SKILL.md');
    expect(written).toContain("The payload's edits array records");
  });
});

// ---------------------------------------------------------------------------
// 2. Measurements on annotations
// ---------------------------------------------------------------------------

test.describe('v2.14 — measurements on annotations', () => {
  test('annotation entries carry box, computed, and overflow for both fitting and overflowing elements', async ({ page }) => {
    await installFsaFileStub(page);
    await loadReady(page);

    // The intro note fits its box (line-height 1.32, comfortably inside the
    // slide) — the overflow:false case. The fixture h1 would NOT do: its
    // line-height of 0.96 makes glyphs paint below the line box, a real
    // scrollHeight > clientHeight overflow the measurement must report.
    await saveNote(page, '.slide.active .foreign-note', 'NOTE FITS');
    await saveNote(page, '.slide.active .resize-target', 'OVERFLOW NOTE');
    // Force the card small around its (padded, 22px) text content so its
    // content overflows its own box before the save runs.
    await page.evaluate(() => {
      const el = document.querySelector('.slide.active .resize-target');
      el.style.width = '40px';
      el.style.height = '30px';
    });

    const written = await saveInPlace(page, 1);
    const payload = extractHandoffPayload(written);
    expect(payload.annotations).toHaveLength(2);

    const intro = payload.annotations.find((a) => a.targetText.startsWith('A synthetic'));
    expect(intro).toBeTruthy();
    expect(intro.box).toBeDefined();
    expect(intro.computed).toBeDefined();
    expect(intro.box.width).toBeGreaterThan(0);
    expect(intro.box.height).toBeGreaterThan(0);
    expect(typeof intro.box.left).toBe('number');
    expect(typeof intro.box.top).toBe('number');
    expect(intro.computed.fontSize).toMatch(/px$/);
    expect(intro.computed.position).toBe('absolute');
    expect(intro.computed).toHaveProperty('fontWeight');
    expect(intro.computed).toHaveProperty('color');
    expect(intro.computed).toHaveProperty('backgroundColor');
    expect(intro.overflow).toBe(false);

    const card = payload.annotations.find((a) => a.targetText === 'Resize target');
    expect(card).toBeTruthy();
    expect(card.box.width).toBeLessThan(60); // measured live, post-shrink
    expect(card.computed.position).toBe('absolute');
    expect(card.overflow).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 3. Hygiene: transient stamps, undone edits, clean copies
// ---------------------------------------------------------------------------

test.describe('v2.14 — ledger hygiene', () => {
  test('the live DOM keeps no edit ids after save, undone edits produce no entry, and clean copies carry no ledger', async ({ page }) => {
    await installFsaFileStub(page);
    await loadReady(page);

    // Kept edit on the headline.
    await clickToSelect(page, '.slide.active h1');
    await page.keyboard.press('ArrowUp');
    // Edited-then-fully-undone element: nudge the intro note, then undo.
    await clickToSelect(page, '.slide.active .foreign-note');
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('Meta+z');
    // A note keeps Cmd+S on the handoff pipeline.
    await saveNote(page, '.slide.active .foreign-note', 'KEEP PIPELINE');

    const written = await saveInPlace(page, 1);
    const payload = extractHandoffPayload(written);

    // Only the kept edit ledgers; the undone element produces no entry.
    expect(payload.edits).toHaveLength(1);
    expect(payload.edits[0].tag).toBe('h1');

    // The transient stamp never survives in the live document.
    const liveEditIds = await page.evaluate(
      () => document.querySelectorAll('[data-wfp-agent-edit-id]').length,
    );
    expect(liveEditIds).toBe(0);

    // Clean copy (export menu row 2) carries neither ledger entries nor
    // edit ids, even while notes and edits exist in the session.
    const downloadPromise = page.waitForEvent('download', { timeout: 5_000 });
    await page.locator('#wfp-editor-root button[data-action="export"]').click();
    await page.locator('#wfp-editor-root .wfpe-export-menu-item[data-action="clean-copy"]').click();
    const download = await downloadPromise;
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    const cleanPath = path.join(OUTPUT_DIR, `v2-14-clean-${Date.now()}.html`);
    await download.saveAs(cleanPath);
    const clean = fs.readFileSync(cleanPath, 'utf-8');
    expect(clean).not.toContain('data-wfp-agent-edit-id');
    expect(clean).not.toContain('data-wfp-agent-annotations');
    expect(clean).not.toContain('"edits"');
  });
});

// ---------------------------------------------------------------------------
// 4. Mechanical labelling on flow-unlock pinning
// ---------------------------------------------------------------------------

test.describe('v2.14 — mechanical labelling', () => {
  test('a flow-unlock drag in the flex chip row ledgers pinned siblings as mechanical and the dragged chip as user intent', async ({ page }) => {
    await installFsaFileStub(page);
    await loadReady(page);

    // Drag the first chip 40px right (04b flex-freeze pattern): the unlock
    // pins the chip row and every chip, then the drag moves chip 1 only.
    const center = await page.evaluate(() => {
      const chip = document.querySelector('.slide.active .chip-row .chip');
      const r = chip.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });
    await page.mouse.move(center.x, center.y);
    await page.mouse.down();
    await page.mouse.move(center.x + 20, center.y, { steps: 4 });
    await page.mouse.move(center.x + 40, center.y, { steps: 4 });
    await page.mouse.up();

    await saveNote(page, '.slide.active h1', 'PIPELINE NOTE');
    const written = await saveInPlace(page, 1);
    const payload = extractHandoffPayload(written);

    const byText = (text) => payload.edits.find((e) => e.targetText === text);
    const dragged = byText('Plan');
    const siblingA = byText('Review');
    const siblingB = byText('Publish');
    const container = byText('Plan Review Publish');
    expect(dragged).toBeTruthy();
    expect(siblingA).toBeTruthy();
    expect(siblingB).toBeTruthy();
    expect(container).toBeTruthy();

    // Editor-written pinning is labelled mechanical…
    expect(siblingA.mechanical).toBe(true);
    expect(siblingB.mechanical).toBe(true);
    expect(container.mechanical).toBe(true);
    // …but the chip the user actually moved is user intent, even though the
    // freeze stamped it like its siblings.
    expect(dragged.mechanical).toBe(false);

    // All four are real style diffs against a pristine (attribute-less) before.
    for (const entry of [dragged, siblingA, siblingB, container]) {
      expect(entry.before).toBeNull();
      expect(entry.after).toBeTruthy();
    }
  });
});

// ---------------------------------------------------------------------------
// 5. Reimport: strip edit ids at boot, ignore the ledger, keep notes
// ---------------------------------------------------------------------------

// A handoff file whose agent left the ledger metadata behind: the payload
// still contains `edits`, and two elements still carry edit-id attrs.
function buildLedgerResidueFixture() {
  const source = fs.readFileSync(FIXTURE_PATH, 'utf-8');
  const withAttrs = source
    .replace(
      'class="foreign-title">Market day agenda',
      'class="foreign-title" data-wfp-agent-annotation-id="ann-1" data-wfp-agent-edit-id="edit-old-1">Market day agenda',
    )
    .replace(
      'data-testid="resize-target">Resize target',
      'data-testid="resize-target" data-wfp-agent-edit-id="edit-old-2">Resize target',
    );
  const payload = {
    version: 1,
    source: 'wfp-slide-editor',
    kind: 'agent-handoff',
    guidance: 'User-authored annotations are editing requests for the marked elements.',
    annotations: [
      { id: 'ann-1', instruction: 'Punch up this headline', slideIndex: 0, targetText: 'Market day agenda' },
    ],
    edits: [
      { id: 'edit-old-1', tag: 'h1', slideIndex: 0, targetText: 'Market day agenda', before: null, after: 'font-size: 80px;', mechanical: false },
      { id: 'edit-old-2', tag: 'div', slideIndex: 0, targetText: 'Resize target', before: null, after: 'width: 300px;', mechanical: false },
    ],
  };
  const blocks = [
    '<!-- WFP Editor handoff: user-authored annotations are in script[data-wfp-agent-annotations]. -->',
    `<script type="application/json" data-wfp-agent-annotations>${JSON.stringify(payload, null, 2)}</script>`,
  ].join('\n');
  return withAttrs.replace('</body>', `${blocks}\n</body>`);
}

test.describe('v2.14 — reimport hygiene', () => {
  test('reimporting a file with leftover edits and edit ids strips the attrs at boot and re-imports notes normally', async ({ page }) => {
    await installFsaFileStub(page);
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    const fixturePath = path.join(OUTPUT_DIR, 'v2-14-ledger-residue.html');
    fs.writeFileSync(fixturePath, buildLedgerResidueFixture());
    await page.goto(pathToFileURL(fixturePath).href);
    await page.locator('.slide.active').first().waitFor({ state: 'attached', timeout: 10_000 });
    await page.addScriptTag({ path: EDITOR_PATH });
    await page.waitForFunction(() => window.__wfpEditorReady === true, null, { timeout: 10_000 });

    // Boot stripped every ledger anchor from the live DOM…
    const residue = await page.evaluate(() => ({
      editIdAttrs: document.querySelectorAll('[data-wfp-agent-edit-id]').length,
      annotationScripts: document.querySelectorAll('script[data-wfp-agent-annotations]').length,
      handoffTargetAttrs: document.querySelectorAll('[data-wfp-agent-annotation-id]').length,
    }));
    expect(residue).toEqual({ editIdAttrs: 0, annotationScripts: 0, handoffTargetAttrs: 0 });

    // …while the note re-imported normally.
    const h1 = page.locator('#foreign-slide-1 h1');
    await expect(h1).toHaveAttribute('data-wfp-edit-annotation-id', 'ann-1');
    await expect(h1).toHaveAttribute('data-wfp-edit-annotation-text', 'Punch up this headline');
    await expect(page.locator('#wfp-editor-root .wfpe-export-badge')).toHaveAttribute('data-count', '1');

    // The ledger is agent-facing context, never restorable state: a fresh
    // save rebuilds it from this session's (empty) edit history.
    await page.keyboard.press('e');
    await expect(page.locator('#wfp-editor-root .wfpe-toolbar')).toHaveAttribute('data-mode', 'on');
    const written = await saveInPlace(page, 1);
    const payload = extractHandoffPayload(written);
    expect(payload.annotations).toHaveLength(1);
    expect(payload.edits).toEqual([]);
    expect(written).not.toContain('edit-old-1');
    expect(written).not.toContain('edit-old-2');
  });
});

// ---------------------------------------------------------------------------
// 6. Overflow false positives (v2.14 QA — BUG-001, BUG-002)
// ---------------------------------------------------------------------------

test.describe('v2.14 — overflow measurement false positives', () => {
  // BUG-001: dragging a flex child flow-unlocks the row and PINS the parent
  // (.chip-row) to its pre-drag footprint via a freeze marker. The dragged
  // child's deliberate new position then falls outside that stale parent box,
  // tripping the parent-escape check even though nothing is visually clipped.
  test('a flow-unlock drag target is not reported as overflowing its frozen parent', async ({ page }) => {
    await installFsaFileStub(page);
    await loadReady(page);

    // Drag the first chip ("Plan") down and out of the flex row. This freezes
    // the row and its siblings, and repositions the chip below the row's box.
    const center = await page.evaluate(() => {
      const chip = document.querySelector('.slide.active .chip-row .chip');
      const r = chip.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });
    await page.mouse.move(center.x, center.y);
    await page.mouse.down();
    await page.mouse.move(center.x + 20, center.y + 60, { steps: 4 });
    await page.mouse.move(center.x + 30, center.y + 120, { steps: 4 });
    await page.mouse.up();

    // Sanity: the drag actually flow-unlocked the row (freeze markers present).
    const froze = await page.evaluate(() => {
      const chip = document.querySelector('.slide.active .chip-row .chip');
      const row = document.querySelector('.slide.active .chip-row');
      const has = (el) => !!el && (el.hasAttribute('data-wfp-edit-frozen') || el.hasAttribute('data-wfp-edit-flex-frozen'));
      return { chip: has(chip), row: has(row) };
    });
    expect(froze.chip || froze.row).toBe(true);

    // Annotate the dragged chip so it carries a measured overflow value.
    await saveNote(page, '.slide.active .chip-row .chip', 'Nudge this chip');
    const written = await saveInPlace(page, 1);
    const payload = extractHandoffPayload(written);

    const chip = payload.annotations.find((a) => a.targetText === 'Plan');
    expect(chip).toBeTruthy();
    // No visual clipping — the new position is the deliberate result of the
    // drag, not an escape from a real containment boundary.
    expect(chip.overflow).toBe(false);

    // And its ledger entry (position edit) must agree.
    const chipEdit = payload.edits.find((e) => e.targetText === 'Plan');
    expect(chipEdit).toBeTruthy();
    expect(chipEdit.overflow).toBe(false);
  });

  // BUG-002: sub-1 line-height display text paints glyph descenders a few px
  // below the content box, so scrollHeight edges fractionally past clientHeight
  // on an auto-height heading that never actually clips.
  test('a wrapped sub-1 line-height headline is not reported as overflowing', async ({ page }) => {
    await installFsaFileStub(page);
    await loadReady(page);

    // Force the line-height:0.96 headline to wrap to multiple lines. Its height
    // is auto, so content is always fully visible — any overflow:true here is a
    // descender-metric artifact, not clipping.
    await page.evaluate(() => {
      const h1 = document.querySelector('.slide.active h1.foreign-title');
      h1.style.width = '260px';
      h1.style.fontSize = '60px';
    });
    const wrapped = await page.evaluate(() => {
      const h1 = document.querySelector('.slide.active h1.foreign-title');
      return {
        multiline: h1.getBoundingClientRect().height > 90,
        gap: h1.scrollHeight - h1.clientHeight,
      };
    });
    expect(wrapped.multiline).toBe(true); // genuinely wrapped, height grew
    expect(wrapped.gap).toBeGreaterThan(1); // the descender artifact is present

    await saveNote(page, '.slide.active h1.foreign-title', 'Punch up this headline');
    const written = await saveInPlace(page, 1);
    const payload = extractHandoffPayload(written);

    const headline = payload.annotations.find((a) => a.targetText === 'Market day agenda');
    expect(headline).toBeTruthy();
    expect(headline.overflow).toBe(false);
  });
});
