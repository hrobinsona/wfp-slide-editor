# Fixtures

Real HTML presentations used as test inputs.

## Privacy model

By default, **all HTML fixtures in this folder are gitignored**. They live on your local machine, tests run against them, but they never enter git history. This protects WFP/Philips/Avent presentation content from accidentally being pushed to a public repo.

If you want to commit a fixture (e.g. a sanitized example for documentation), edit `.gitignore` to add an allow-list line:

```
!fixtures/sample-deck.html
```

Treat each addition as a deliberate decision. Read the file first; confirm there are no real names, brand references, or internal content.

## Rules

- **Immutable.** Never modify a fixture file. Tests read them, the editor edits the in-page DOM, exports go to `tests/output/`.
- **Copied, never moved.** Fixtures are copies of decks that live in the slide-builder workspace. Copy them in; never move or edit the originals.
- **Representative.** Each fixture should exercise different parts of the deck system. If you find a fixture that triggers a unique edge case (unusual layout, animation pattern, image type), keep it.
- **Local by default.** Fixtures stay on your machine. Tests are reproducible per-machine, not via CI (no CI on this project anyway).

## Current fixtures

These are the fixtures expected to exist locally. They are NOT committed to git unless explicitly allow-listed.

Source workspace (the slides skill):

```
~/Library/Mobile Documents/iCloud~md~obsidian/Documents/Keith/projects/Presentations/slide-builder/
```

**Primary fixtures (tested on every run — `PINNED_PRIMARIES` in `tests/_helpers.js`):**

| Fixture | Copied from | What it is |
|---|---|---|
| `Townhall-1.html` | `output/slides/d4-ai-town-hall.html` | 9-slide finished Avent town hall. Cover + content slides, dark and light fields, entrance reveals, an SVG growth curve, a hand-built mock UI. The realistic "finished deck" case. |
| `boilerplate.html` | `assets/boilerplate.html` | The generated Avent scaffold every deck is built from: 1920x1080 `.deck` canvas, scaler JS, keyboard nav, progress bar, nav dots, full token cascade, cover + closing slide. Tested on every run as a regression canary — if the editor breaks here it breaks on every future deck. |

**Rotation fixtures (one per run — every other `.html` in this folder containing a `.deck`):**

| Fixture | Copied from | What it is |
|---|---|---|
| `d2-intelligence-layer.html` | `output/slides/d2-intelligence-layer.html` | 9 slides, includes the only slide in the set with genuinely absolutely-positioned content (the architecture diagram). |
| `pplus-commercial-model.html` | `references/examples/golden/pplus-commercial-model.html` | 5 slides, an approved reference deck — a shorter deck with a chart slide. |

**Committed, sanitized fixtures (allow-listed in `.gitignore`):**

- `foreign-deck.html` — a non-`.deck` presentation (`.presentation > .slide`), for the foreign-deck resolver.
- `flat-document.html` — a flat, non-slide document (`main#flat-article`), for flat-document mode.

The filenames of the two primaries are **role names**, not descriptions of one particular deck: "the finished multi-slide deck" and "the scaffold". They are kept stable so `PINNED_PRIMARIES` and the ~150 spec call sites that name them do not have to change every time the decks are refreshed. Update this table instead.

### Refreshing the fixtures

1. Copy the current decks over the two primaries, keeping the filenames. Copy, don't move; don't edit the originals.
2. Refresh the rotation decks the same way (their names are free — the pool is discovered by scanning this folder).
3. Run `npm test`.
4. If a spec now fails because it assumed something about the old deck's markup, **derive the value from the loaded fixture** rather than hard-coding a new constant — otherwise the same break recurs on the next refresh. `tests/_helpers.js` already provides the discovery helpers (see below).
5. Update this table with what the new decks are and where they came from.

### When the fixtures are missing

A fresh clone, and every checkout under `.worktrees/`, starts with **no** private decks. That is expected and handled: specs that need a missing fixture are reported as **skipped**, with a reason naming the fixture, while every fixture-free spec still runs. You get a real report — never a collection abort.

To make them run, copy the decks in as above. `npm test` on a checkout without them should read roughly:

```
274 skipped
221 passed
```

## How tests use fixtures

See `TESTING.md` for the full approach. In short:

1. Playwright loads a fixture from the local dev server.
2. Injects `editor.js`.
3. Drives interactions via Playwright's page API.
4. Asserts DOM state, export output, etc.

Fixtures must always render correctly in a browser when the editor is NOT loaded. This is a baseline constraint.

Specs do not name deck-specific elements. `tests/_helpers.js` discovers a target from whatever fixture is loaded (`requireAbsoluteTarget`, `requireTextTarget`, `requireStableTarget`, `hitPointFor`) and skips with a clear reason when a deck genuinely has nothing of the required shape. Add a new fixture only when it represents a real layout edge case, and keep it local/gitignored unless it has been deliberately sanitized and allow-listed.
