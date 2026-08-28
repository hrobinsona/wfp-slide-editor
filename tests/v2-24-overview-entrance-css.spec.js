import { test, expect } from '@playwright/test';
import { EDITOR_PATH } from './_helpers.js';

// v2.24 — the overview entrance-CSS rewriter is string surgery on selectors,
// so it gets table-driven coverage of the shapes that can go wrong rather than
// one happy-path assertion.
//
// Each case builds a minimal deck with a single deck stylesheet, enters
// overview, and asserts what the NON-active slide's probe element computes to.
// `expected: '1'` means the deck's own gating rule was correctly re-scoped;
// `'0'` means it was correctly left alone.

async function buildDeck(page, deckCss, markup = '') {
  // The deck carries real decoys: a non-active `.menu` and a slide whose class
  // merely starts with the token. A case that only asserts "the probe stayed
  // hidden" would pass vacuously without elements for the bad selector to hit.
  await page.setContent(`<!DOCTYPE html>
    <html><head><style>
      .slide { opacity: 1; }
      .probe, .mprobe, .altprobe { opacity: 0; }
    </style>
    <style>
      ${deckCss}
    </style></head>
    <body>
      <div class="menu"><div class="mprobe">decoy</div></div>
      <div class="deck">
        <div class="slide is-active" id="s0"><div class="probe a">one</div>${markup}</div>
        <div class="slide" id="s1"><div class="probe a">two</div>${markup}</div>
        <div class="slide is-active-alt" id="s2"><div class="altprobe">three</div>${markup}</div>
      </div>
    </body></html>`);
  await page.addScriptTag({ path: EDITOR_PATH });
  await page.waitForFunction(() => window.__wfpEditorReady === true);
  await page.keyboard.press('o');
  await page.waitForFunction(
    () => document.querySelectorAll('#wfp-editor-root .wfpe-overview-thumb').length === 3,
  );
}

// Exact count of what the rewriter emitted — not a selector-text pattern,
// which cannot see a false positive that happens not to match the pattern.
const injectedRuleCount = (page) => page.evaluate(() => {
  const el = document.querySelector('#wfp-editor-root style[data-wfp-edit-style="overview-entrance"]');
  return el && el.sheet ? el.sheet.cssRules.length : -1;
});

const probeOpacity = (page, selector = '#s1 .probe') =>
  page.evaluate((sel) => getComputedStyle(document.querySelector(sel)).opacity, selector);

const CASES = [
  {
    name: 'plain descendant gating rule is re-scoped',
    css: '.slide.is-active .probe { opacity: 1; }',
    expected: '1',
  },
  {
    name: 'a comma inside :is() does not void the injected sheet',
    // Splitting naively on every comma strands an unclosed paren, and the CSS
    // parser then swallows every rule that follows.
    css: '.slide.is-active :is(.probe, .nothing) { opacity: 1; }',
    expected: '1',
  },
  {
    name: 'a rule following a tricky one still applies',
    css: `.slide.is-active :is(.zzz, .yyy) { color: red; }
          .slide.is-active .probe { opacity: 1; }`,
    expected: '1',
  },
  {
    name: 'child and sibling combinators are re-scoped',
    css: '.slide.is-active > .probe { opacity: 1; }',
    expected: '1',
  },
  {
    name: '@media condition is preserved, not flattened',
    css: '@media (min-width: 1px) { .slide.is-active .probe { opacity: 1; } }',
    expected: '1',
  },
  {
    name: '@media that should NOT match stays unmatched',
    css: '@media (max-width: 1px) { .slide.is-active .probe { opacity: 1; } }',
    expected: '0',
  },
  {
    name: '@supports condition is preserved',
    css: '@supports (opacity: 1) { .slide.is-active .probe { opacity: 1; } }',
    expected: '1',
  },
  {
    name: 'a rule with no descendant part is not re-scoped',
    // Overview forces `opacity: 1 !important` on every slide box, so computed
    // style cannot see this one — but emitting `body[…] .slide { … }` would
    // tell every slide it is active. Assert nothing was emitted.
    css: '.slide.is-active { opacity: 1; border-color: red; }',
    expectInjected: 0,
  },
  {
    name: 'a non-slide `X.is-active Y` UI-state rule is left alone',
    // Nav tabs, agenda rows, accordions and progress steps all have this shape.
    // The deck renders a real, non-active `.menu`, so a regression reveals its
    // descendant — and emits a rule that should not exist.
    css: '.menu.is-active .mprobe { opacity: 1; }',
    probe: '.menu .mprobe',
    expected: '0',
    expectInjected: 0,
  },
  {
    name: 'the token is not matched inside a longer class name',
    // #s2 really carries `is-active-alt`. Raw-substring stripping would yield
    // the nonsense selector `.slide-alt .altprobe`, which matches nothing — so
    // opacity cannot see the regression. The tell is that the rule was
    // considered at all.
    css: '.slide.is-active-alt .altprobe { opacity: 1; }',
    expectInjected: 0,
  },
  {
    name: 'the token inside :not() is left alone',
    // The deck's own rule legitimately matches every NON-active slide, so the
    // tell is the ACTIVE slide: stripping the token would turn `:not(.is-active)`
    // into `:not()` or `.slide`, either dropping the rule or inverting it.
    css: '.slide:not(.is-active) .probe { opacity: 1; }',
    probe: '#s0 .probe',
    expected: '0',
  },
  {
    name: 'a token inside an attribute value does not corrupt the selector',
    css: `[data-x=".is-active"] .probe { opacity: 1; }
          .slide.is-active .probe { opacity: 1; }`,
    expected: '1',
  },
  {
    name: 'native CSS nesting is skipped, not lifted out of its parent',
    // `&` is meaningless once a rule is lifted out of its parent — and
    // Element.matches('&.is-active') does NOT throw, it resolves & to :scope
    // and returns true, so the slide-anchoring gate does not catch this on
    // its own.
    css: '.slide { &.is-active .probe { opacity: 1; } }',
    expectInjected: 0,
  },
  {
    name: '@container is skipped, not flattened into @media',
    // Lifting a rule out of a condition the rewriter does not understand makes
    // it apply unconditionally; re-emitting it as @media changes what it means.
    css: '@container (min-width: 99999px) { .slide.is-active .probe { opacity: 1; } }',
    expected: '0',
    expectInjected: 0,
  },
  {
    name: '@starting-style is skipped — flattening it would blank the grid',
    // @starting-style holds the HIDDEN value for an entrance. Lifting it out
    // emits `opacity: 0` at winning specificity over the deck's own visible
    // rule, so every thumbnail goes blank — the exact failure this feature
    // exists to fix.
    css: `.slide.is-active .probe { opacity: 1; }
          @starting-style { .slide.is-active .probe { opacity: 0; } }`,
    expected: '1',
  },
  {
    name: '@layer is recursed into',
    css: '@layer deck { .slide.is-active .probe { opacity: 1; } }',
    expected: '1',
  },
  {
    name: 'declarations survive intact, including !important and custom properties',
    css: '.slide.is-active .probe { --tone: 0.5; opacity: var(--tone) !important; }',
    expected: '0.5',
  },
];

test.describe('v2.24 — overview entrance-CSS rewriter', () => {
  for (const c of CASES) {
    test(c.name, async ({ page }) => {
      await buildDeck(page, c.css);
      if (c.expected !== undefined) {
        expect(await probeOpacity(page, c.probe || '#s1 .probe')).toBe(c.expected);
      }
      if (c.expectInjected !== undefined) {
        expect(await injectedRuleCount(page)).toBe(c.expectInjected);
      }
    });
  }

  test('the active slide is unaffected in every case', async ({ page }) => {
    await buildDeck(page, '.slide.is-active .probe { opacity: 1; }');
    expect(await probeOpacity(page, '#s0 .probe')).toBe('1');
  });

  test('exiting overview removes every injected rule', async ({ page }) => {
    await buildDeck(page, '.slide.is-active .probe { opacity: 1; }');
    expect(await probeOpacity(page)).toBe('1');

    await page.keyboard.press('o');
    await page.waitForFunction(() => !document.body.hasAttribute('data-wfp-edit-overview'));

    expect(await probeOpacity(page)).toBe('0');
  });

  test('a deck whose rules gate nothing produces no injected rules at all', async ({ page }) => {
    // Every rule here is a false-positive candidate; none should be emitted.
    await buildDeck(page, `
      .menu.is-active .probe { opacity: 1; }
      .slide.is-active { opacity: 1; }
      .slide.is-active-alt .probe { opacity: 1; }
    `);
    expect(await injectedRuleCount(page)).toBe(0);
  });
});
