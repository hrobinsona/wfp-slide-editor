# Testing

## Philosophy

Test the editor against real WFP slides, not synthetic examples. The fixtures in `fixtures/` are the ground truth — if the editor works on them, it works.

The fixtures are immutable inputs. Tests never modify them. Test artifacts (exported HTML, screenshots) go in `tests/output/` (gitignored).

## What gets tested

For each phase listed in `TASKS.md`, there's a corresponding spec in `tests/`. Each phase's verification step describes the assertion.

End-to-end coverage is not optional. Before declaring v1 done, `tests/09-end-to-end.spec.js` runs through every "Done criteria" item in `REQUIREMENTS.md` against THREE fixtures: the two pinned primaries (`Townhall-1.html` and `boilerplate.html`) and one randomly selected rotation fixture.

## Why dual primaries plus a randomized rotation

`Townhall-1.html` is a real finished presentation with all the messy quirks of production work. `boilerplate.html` is the WFP template every new presentation starts from, so it's a regression canary: if the editor breaks here, it'll break on every future deck. Testing both on every run catches both kinds of breakage.

The random rotation fixture catches drift. If we hard-coded a single second fixture, the tests slowly drift to passing for that fixture's specific shape and silently break on others. By randomizing on every test run, broken assumptions get caught fast.

```javascript
// tests/_helpers.js
import fs from 'node:fs';
import path from 'node:path';

const PINNED_PRIMARIES = ['Townhall-1.html', 'boilerplate.html'];

export function pickRandomRotationFixture() {
  const all = fs.readdirSync('./fixtures').filter(f => f.endsWith('.html'));
  const pool = all.filter(f => !PINNED_PRIMARIES.includes(f));
  if (pool.length === 0) throw new Error('No rotation fixtures available');
  return pool[Math.floor(Math.random() * pool.length)];
}
```

The end-to-end spec logs which rotation fixture it picked so failures are reproducible.

## Test structure

```
tests/
├── _helpers.js              # loadFixtureWithEditor, pickRandomRotationFixture, etc.
├── 01-bootstrap.spec.js     # Phase 1: editor loads, E toggles edit mode
├── 02-selection.spec.js     # Phase 2: click selects, ring renders
├── 03-font-size.spec.js     # Phase 3: arrow keys nudge font size
├── 04-drag.spec.js          # Phase 4: drag updates position, scale-aware
├── 05-resize.spec.js        # Phase 5: handles resize element
├── 06-undo.spec.js          # Phase 6: history stack
├── 07-text-edit.spec.js     # Phase 7: double-click edits text
├── 08-export.spec.js        # Phase 8: Cmd+S downloads clean HTML
└── 09-end-to-end.spec.js    # Full done-criteria checklist on 2 fixtures
```

## Running tests

- `npm test` — all specs
- `npx playwright test 04-drag` — single phase
- `npx playwright test --ui` — interactive mode for debugging
- `npx playwright test --debug` — step through with the inspector

## Manual verification (don't skip)

Some things Playwright can't reliably check without becoming brittle. Before declaring a task done, manually confirm:

1. Open the fixture in a real browser (not just Playwright).
2. Inject the editor via the dev console.
3. Press `E`. Edit-mode badge appears.
4. With edit mode OFF, press ArrowRight. Slide advances. (Editor must not break navigation when inactive.)
5. With edit mode ON, press ArrowRight. Slide does NOT advance. (Editor takes precedence.)
6. Make a small change, export, open the downloaded file in a new tab. Confirm the change persists and no editor UI is visible.

## Output artifacts

- `tests/output/*.html` — exported HTML files for inspection
- `tests/output/screenshots/` — screenshots from failed assertions
- `playwright-report/` — Playwright's HTML report (run `npx playwright show-report`)

All of these are gitignored.

## When tests fail

1. Check the Playwright report (`npx playwright show-report`).
2. Re-run with `--ui` to see the failure interactively.
3. If the failure is on the randomized second fixture, note which one was selected. The CI log or test output should print it.
4. Reproduce by hard-coding that fixture in `pickRandomRotationFixture` until fixed.
5. Don't disable the test. Fix the editor.
