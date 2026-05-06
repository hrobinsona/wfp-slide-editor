# Fixtures

Real WFP HTML presentations used as test inputs.

## Privacy model

By default, **all HTML fixtures in this folder are gitignored**. They live on your local machine, tests run against them, but they never enter git history. This protects WFP/Philips presentation content from accidentally being pushed to a public repo.

If you want to commit a fixture (e.g. a sanitized example for documentation), edit `.gitignore` to add an allow-list line:

```
!fixtures/sample-deck.html
```

Treat each addition as a deliberate decision. Read the file first; confirm there are no real names, brand references, or internal content.

## Rules

- **Immutable.** Never modify a fixture. Tests read them, the editor edits in-memory representations, exports go to `tests/output/`.
- **Representative.** Each fixture should exercise different parts of the WFP system. If you find a fixture that triggers a unique edge case (unusual layout, animation pattern, image type), keep it.
- **Local by default.** Fixtures stay on your machine. Tests are reproducible per-machine, not via CI (no CI on this project anyway).

## Current fixtures

These are the fixtures expected to exist locally on Harry's machine. They are NOT committed to git unless explicitly allow-listed.

**Primary fixtures (tested on every run):**
- `Townhall-1.html` — 9 slides. Mix of dark and light backgrounds, animations, charts, complex grid layouts. Real-world finished presentation.
- `boilerplate.html` — The WFP starting template every presentation is built from. Tested on every run as a regression canary: if the editor breaks here, it'll break on every future presentation built from this template. Likely fewer quirks than finished decks, which makes it the cleanest baseline.

**Rotation fixtures (one randomly selected per end-to-end run):**
- `Inspirational-presentation-1.html` — additional finished presentation, used in random rotation.
- `Inspirational-presentation-2.html` — additional finished presentation, used in random rotation.

Add more here as you create new presentations. The end-to-end tests pick a random rotation fixture each run, so adding more increases coverage. Keep `Townhall-1.html` and `boilerplate.html` as the pinned primaries unless there's a strong reason to change.

## How tests use fixtures

See `TESTING.md` for the full approach. In short:

1. Playwright loads a fixture from the local dev server.
2. Injects `editor.js`.
3. Drives interactions via Playwright's page API.
4. Asserts DOM state, export output, etc.

Fixtures must always render correctly in a browser when the editor is NOT loaded. This is a baseline constraint.

Current coverage uses these fixtures for the v1 editor, v2 inspector, and v2.1 Overview mode. Add a new fixture only when it represents a real layout edge case, and keep it local/gitignored unless it has been deliberately sanitized and allow-listed.
