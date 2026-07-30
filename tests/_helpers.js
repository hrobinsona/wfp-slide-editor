import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from '@playwright/test';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const PROJECT_ROOT = path.resolve(__dirname, '..');
export const FIXTURES_DIR = path.join(PROJECT_ROOT, 'fixtures');
export const EDITOR_PATH = path.join(PROJECT_ROOT, 'editor.js');

export const PINNED_PRIMARIES = ['Townhall-1.html', 'boilerplate.html'];

// ── Missing-fixture handling ────────────────────────────────────────────────
// Deck HTML in fixtures/ is gitignored on purpose (see .gitignore and
// fixtures/README.md), so a fresh clone — or any of the .worktrees/ checkouts —
// starts with no private decks at all. That must degrade to *skips*, never to a
// collection-time crash: a run that produces no results is indistinguishable
// from a run where everything passed, which is the worst possible failure mode
// for a gate.

export function fixtureExists(name) {
  return fs.existsSync(path.join(FIXTURES_DIR, name));
}

export function missingFixtureReason(name) {
  return (
    `Fixture "${name}" is not installed in fixtures/. Deck HTML is gitignored ` +
    `by design, so fresh clones and worktrees start without it. ` +
    `See fixtures/README.md for which decks the primaries are, where they come ` +
    `from, and how to reinstall them.`
  );
}

// Runtime skip guard. Call from inside a test body or a hook (Playwright's
// test.skip(condition, reason) only works from there — not at module scope).
// The test is reported as skipped with the reason attached, so the run still
// produces a full report naming exactly what is missing.
export function skipIfFixtureMissing(name) {
  test.skip(!fixtureExists(name), missingFixtureReason(name));
}

// Editor markers must not survive export. Scoped to ATTRIBUTE position inside
// a tag: the current Avent deck template legitimately mentions
// `body[data-wfp-edit-overview="on"]` in its own stylesheet (that rule disables
// entrance reveals while the editor's overview is on), so a bare substring check
// fails on any deck that co-operates with the editor.
export const EDITOR_MARKER_ATTR_RE = /<[^>]*\sdata-wfp-edit[-a-zA-Z]*\s*=/;

// Parses exported HTML for slide elements, in document order.
//
// Both the element tag and the id are per-deck authoring choices — the retired
// fixtures emitted `<div class="slide" id="s0">`, the current template emits a
// bare `<section class="slide">` — so neither is assumed. `slide` must appear as
// a whole class token, otherwise `slide-head` / `slide-body` wrappers inflate
// the count.
export function parseSlideTags(html) {
  const out = [];
  const re = /<(?:div|section|article)\s+([^>]*)>/g;
  let match;
  while ((match = re.exec(html)) !== null) {
    const attrs = match[1];
    const classes = (attrs.match(/\bclass="([^"]*)"/)?.[1] ?? '').split(/\s+/).filter(Boolean);
    if (!classes.includes('slide')) continue;
    out.push({ id: attrs.match(/\bid="([^"]+)"/)?.[1] ?? null, classes });
  }
  return out;
}

export const ROTATION_MISSING_REASON =
  'No rotation fixtures installed. The rotation pool is every .html in ' +
  'fixtures/ that contains a .deck wrapper and is not a pinned primary; deck ' +
  'HTML is gitignored, so fresh clones and worktrees have an empty pool. ' +
  'See fixtures/README.md for the current rotation decks and where they come from.';

export async function loadFixtureWithEditor(page, fixtureName) {
  skipIfFixtureMissing(fixtureName);
  const url = `/fixtures/${fixtureName}`;
  // Some fixtures are large (multi-MB) and slow to parse. Generous timeouts
  // here keep the helper usable across all fixtures, including the rotation
  // pool.
  await page.goto(url, { timeout: 30_000 });
  await page.locator('.deck').first().waitFor({ state: 'attached', timeout: 20_000 });
  await page.addScriptTag({ path: EDITOR_PATH });
  await page.waitForFunction(() => window.__wfpEditorReady === true, null, { timeout: 10_000 });
  await stampSlideIds(page);
  await waitForSlideSettled(page);
}

// Gives every top-level slide a stable id when the deck doesn't author one.
//
// Overview coverage (reorder, delete, undo, export round-trip) has to name
// slides to assert that identity survives a mutation. The retired fixtures
// happened to author id="s0".."s8"; the current template emits bare <section
// class="slide">, which left every one of those assertions comparing empty
// strings — passing vacuously in some places and failing in others. Stamping
// makes the identity explicit and deck-independent. Authored ids are never
// overwritten.
export async function stampSlideIds(page) {
  await page.evaluate(() => {
    document.querySelectorAll('.deck > .slide').forEach((slide, index) => {
      if (!slide.id) slide.id = `s${index}`;
    });
  });
}

// Waits until nothing on the active slide is still animating.
//
// Decks run entrance transitions/keyframes on slide activation. A running CSS
// animation takes precedence over inline styles, so asserting geometry, opacity
// or colour mid-entrance reads the animation's value and silently ignores what
// the editor just wrote. Infinite animations (ambient glows) are excluded —
// they never finish by design.
export async function waitForSlideSettled(page) {
  await page
    .waitForFunction(
      () => {
        const slide = document.querySelector('.slide.active');
        if (!slide) return false;
        return !document.getAnimations().some((a) => {
          const node = a.effect && a.effect.target;
          if (!node || node.nodeType !== 1 || !slide.contains(node)) return false;
          if (a.playState !== 'running') return false;
          let timing;
          try {
            timing = a.effect.getComputedTiming();
          } catch (_) {
            return true;
          }
          return timing.iterations !== Infinity;
        });
      },
      null,
      { timeout: 8_000, polling: 100 },
    )
    .catch(() => {});
}

// Forces the File System Access API away so Cmd+S / the export menu's
// primary action exercises the legacy download fallback. Register BEFORE
// the page navigates (addInitScript applies from the next navigation).
export async function disableFsa(page) {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'showSaveFilePicker', { value: undefined, configurable: true });
  });
}

// ── Deck-agnostic target discovery ──────────────────────────────────────────
// The retired WFP-coral fixtures happened to carry a small absolutely-
// positioned `.wfp-badge` on slide 1, and roughly 120 assertions hard-coded
// `.slide.active .wfp-badge` as "the element to drag / resize / recolour".
// The current Avent deck generation lays slides out in flow and has no element
// of that shape on slide 1 of any deck, so hard-coding a replacement class
// would only re-break on the next fixture refresh.
//
// Instead, targets are DISCOVERED from whichever fixture is loaded:
//   * candidates are ranked by CSS position and box size,
//   * identified by a class that is unique within their own slide (so
//     clone-counting assertions still behave the way they did with
//     `.wfp-badge`: one before paste, two after),
//   * verified to be the TOPMOST element at their own centre — the editor's
//     findSelectableTarget returns event.target verbatim, so a candidate whose
//     centre is covered by a child or a sibling would select something else,
//     and
//   * if the only suitable target lives on another slide, that slide is
//     activated first.
//
// Every finder returns a selector rooted at `.slide.active`, or null when the
// deck genuinely has nothing of that shape. Callers pair the null case with
// test.skip so the miss is reported, never silently passed.

export const NO_ABSOLUTE_TARGET_REASON =
  'This fixture has no element that can serve as an absolutely-positioned ' +
  'target: none is natively absolute and clickable, and no flow element stays ' +
  'clickable once pinned. See the target-discovery note in tests/_helpers.js.';

export const NO_STABLE_TARGET_REASON =
  'This fixture has no hit-testable element with a slide-unique class on any ' +
  'slide. See the target-discovery note in tests/_helpers.js.';

export const NO_TEXT_TARGET_REASON =
  'This fixture has no text-bearing, hit-testable element with a slide-unique ' +
  'class on any slide. See the target-discovery note in tests/_helpers.js.';

const TARGET_DEFAULTS = { position: 'any', text: null, minWidth: 40, minHeight: 24 };

// Collects candidates across every slide. Safe on hidden slides: `position`
// is a cascaded value and resolves even under `display: none`. Geometry is
// NOT trustworthy here, so it is verified later, after activation.
function collectTargetCandidates(page, opts) {
  return page.evaluate((o) => {
    const slides = [...document.querySelectorAll('.deck > .slide')];
    const activeIndex = slides.findIndex((s) => s.classList.contains('active'));
    const out = [];
    slides.forEach((slide, index) => {
      for (const el of slide.querySelectorAll('*')) {
        if (el.closest('#wfp-editor-root')) continue;
        const position = getComputedStyle(el).position;
        if (o.position === 'absolute' && position !== 'absolute' && position !== 'fixed') continue;
        if (o.position === 'flow' && position !== 'static' && position !== 'relative') continue;
        if (o.text !== null) {
          const hasText = [...el.childNodes].some(
            (n) => n.nodeType === 3 && n.textContent.trim().length > 0,
          );
          if (hasText !== o.text) continue;
        }
        const unique = [...el.classList].find(
          (c) => slide.querySelectorAll(`.${CSS.escape(c)}`).length === 1,
        );
        if (!unique) continue;
        const cs = getComputedStyle(el);
        const inert =
          cs.animationName === 'none' &&
          (cs.transitionProperty === 'none' || parseFloat(cs.transitionDuration) === 0);
        out.push({
          index,
          selector: `.slide.active .${unique}`,
          // Prefer targets on the active slide (no navigation, no entrance
          // animation to wait out) and inert ones (an element with its own
          // transition re-animates every style the editor writes, so computed
          // reads land mid-flight and the inspector's readout snaps back).
          score: (index === activeIndex ? 2 : 0) + (inert ? 1 : 0),
        });
      }
    });
    return out.sort((a, b) => b.score - a.score);
  }, opts);
}

async function activateSlide(page, index) {
  const already = await page.evaluate((i) => {
    const slides = [...document.querySelectorAll('.deck > .slide')];
    if (slides[i]?.classList.contains('active')) return true;
    slides.forEach((s, n) => {
      if (n !== i) s.classList.remove('active', 'visible');
    });
    slides[i].classList.add('active');
    return false;
  }, index);
  if (already) return;
  await waitForSlideSettled(page);
}

async function verifyTarget(page, selector) {
  return page.evaluate(
    ({ sel, minWidth, minHeight }) => {
      const el = document.querySelector(sel);
      if (!el) return false;
      const r = el.getBoundingClientRect();
      if (r.width < minWidth || r.height < minHeight) return false;
      return document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) === el;
    },
    { sel: selector, minWidth: 0, minHeight: 0 },
  );
}

function meetsSize(page, selector, opts) {
  return page.evaluate(
    ({ sel, minWidth, minHeight }) => {
      const el = document.querySelector(sel);
      if (!el) return false;
      const r = el.getBoundingClientRect();
      return r.width >= minWidth && r.height >= minHeight;
    },
    { sel: selector, minWidth: opts.minWidth, minHeight: opts.minHeight },
  );
}

// Viewport point that hit-tests to `selector` itself.
//
// The editor's findSelectableTarget returns event.target verbatim, so clicking
// an element's geometric centre selects whatever child happens to sit there —
// e.g. the current decks wrap an accent <span> inside every headline, dead
// centre. Falls back to the centre when no point inside the box resolves to the
// element, so callers still get a deterministic (if covered) point.
export async function hitPointFor(page, selector) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) throw new Error(`No element matching ${sel}`);
    const r = el.getBoundingClientRect();
    const centre = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    if (document.elementFromPoint(centre.x, centre.y) === el) return centre;
    const cols = 9;
    const rows = 7;
    for (let j = 1; j < rows; j++) {
      for (let i = 1; i < cols; i++) {
        const x = r.left + (r.width * i) / cols;
        const y = r.top + (r.height * j) / rows;
        if (document.elementFromPoint(x, y) === el) return { x, y };
      }
    }
    return centre;
  }, selector);
}

function activeSlideIndex(page) {
  return page.evaluate(() =>
    [...document.querySelectorAll('.deck > .slide')].findIndex((s) => s.classList.contains('active')),
  );
}

export async function findDeckTarget(page, options = {}) {
  const opts = { ...TARGET_DEFAULTS, ...options };
  const startIndex = await activeSlideIndex(page);
  const candidates = await collectTargetCandidates(page, {
    position: opts.position,
    text: opts.text,
  });
  for (const candidate of candidates) {
    await activateSlide(page, candidate.index);
    if (!(await meetsSize(page, candidate.selector, opts))) continue;
    if (await verifyTarget(page, candidate.selector)) return candidate.selector;
  }
  // A failed search must not leave the deck parked on the last slide it tried:
  // the caller's next search would then score candidates against the wrong
  // active slide, and any follow-up assertion would run on it too.
  if (startIndex >= 0) await activateSlide(page, startIndex);
  return null;
}

// Convenience wrappers with the skip already wired. Call from a test body,
// AFTER loadFixtureWithEditor and BEFORE toggling edit mode.

// Any clickable, uniquely-classed element. Use where the test just needs
// "something on the slide to select".
export async function requireStableTarget(page, options = {}) {
  const selector = await findDeckTarget(page, options);
  test.skip(!selector, NO_STABLE_TARGET_REASON);
  return selector;
}

// Text-bearing variant, for inline-text-edit and font/colour assertions that
// need a direct text node to act on.
export async function requireTextTarget(page, options = {}) {
  const selector = await findDeckTarget(page, { text: true, ...options });
  test.skip(!selector, NO_TEXT_TARGET_REASON);
  return selector;
}

// The absolute-positioning stand-in for the retired `.wfp-badge`.
//
// Prefers a genuinely absolutely-positioned element. The current Avent deck
// generation composes slides in flow, so most decks have none whose centre is
// directly clickable; rather than skipping ~55 assertions about drag deltas,
// geometry inputs, and clone offsets, a discovered flow element is PINNED to
// absolute at its own current box — exactly what the editor's own
// unlockToAbsolute does on first drag, and covered independently by
// 04b-flex-freeze and v2-15-unlock-hardening. That keeps the absolute-path
// assertions meaningful on any deck instead of tying them to one deck's
// decorative markup.
export async function requireAbsoluteTarget(page, options = {}) {
  const opts = { ...TARGET_DEFAULTS, ...options };
  const native = await findDeckTarget(page, { ...opts, position: 'absolute' });
  if (native) return native;

  const startIndex = await activeSlideIndex(page);
  const candidates = await collectTargetCandidates(page, { position: 'any', text: opts.text });
  for (const candidate of candidates) {
    await activateSlide(page, candidate.index);
    if (!(await meetsSize(page, candidate.selector, opts))) continue;
    // Must be clickable BEFORE pinning (so the discovered element is a real
    // interaction target) and still clickable AFTER (pinning takes it out of
    // flow, which can let a reflowed sibling slide over its centre).
    if (!(await verifyTarget(page, candidate.selector))) continue;
    await page.evaluate((sel) => {
      const el = document.querySelector(sel);
      el.dataset.wfpTestPinned = el.getAttribute('style') || '';
      // Same recipe as the editor's own unlockToAbsolute: capture all four
      // dimensions before mutating position, and zero the margin — `top`
      // positions the margin box while offsetTop measures the border box, so a
      // non-zero margin makes every subsequent offset-anchored write drift.
      const { offsetLeft: x, offsetTop: y, offsetWidth: w, offsetHeight: h } = el;
      el.style.position = 'absolute';
      el.style.margin = '0';
      el.style.left = `${x}px`;
      el.style.top = `${y}px`;
      el.style.width = `${w}px`;
      el.style.height = `${h}px`;
    }, candidate.selector);
    if (await verifyTarget(page, candidate.selector)) return candidate.selector;
    await page.evaluate((sel) => {
      const el = document.querySelector(sel);
      const previous = el.dataset.wfpTestPinned;
      delete el.dataset.wfpTestPinned;
      if (previous) el.setAttribute('style', previous);
      else el.removeAttribute('style');
    }, candidate.selector);
  }
  if (startIndex >= 0) await activateSlide(page, startIndex);
  test.skip(true, NO_ABSOLUTE_TARGET_REASON);
  return null;
}

// Returns the rotation fixture for this run, or null when none are installed.
//
// Runs at collection time, so it must never throw — callers guard with
// ROTATION_MISSING_REASON and declare an explicitly skipped test instead.
//
// The choice must be IDENTICAL in every worker. Playwright re-imports spec
// files in each worker process, so a `Math.random()` pick gives each worker a
// different fixture; the describe titles then disagree and Playwright reports
// "Test not found in the worker process". The pick is therefore seeded and
// stable for the day, which also makes a failure reproducible — pin it with
// WFP_ROTATION_FIXTURE=<name> or WFP_ROTATION_SEED=<number> to re-run one.
export function pickRandomRotationFixture() {
  if (!fs.existsSync(FIXTURES_DIR)) return null;
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
  if (pool.length === 0) return null;
  pool.sort();

  const pinned = process.env.WFP_ROTATION_FIXTURE;
  if (pinned) return pool.includes(pinned) ? pinned : null;

  const seed = Number(
    process.env.WFP_ROTATION_SEED ?? new Date().toISOString().slice(0, 10).replace(/-/g, ''),
  );
  return pool[seed % pool.length];
}
