# Stack

## Runtime

| Choice | Why |
|---|---|
| Vanilla JavaScript (ES2022) | Keeps the editor dependency-free inside arbitrary slide pages. |
| Plain CSS scoped through `#wfp-editor-root` and explicit editor state attributes | Avoids leaking editor styling into slide content and keeps export cleanup tractable. |
| No framework | The editor must load as an injected script without React/Vue/Svelte runtime assumptions or host-page conflicts. |
| Single deployed `editor.js` | Keeps GitHub Pages hosting and bookmarklet loading simple. The file is now large enough that internal refactoring is needed. |

## Hosting

| Choice | Why |
|---|---|
| GitHub Pages | Free, stable URL, version-controlled, and enough for a static JavaScript file. |

Hosted URL pattern:

```text
https://[username].github.io/wfp-slide-editor/editor.js
```

## Testing

| Choice | Why |
|---|---|
| Playwright | Required for browser-real drag, resize, scale, export, keyboard, and Overview behaviours. |
| Fixture-driven E2E tests | Real slide decks expose layout and animation edge cases that synthetic DOM tests miss. |
| No unit test framework yet | Most meaningful behaviour currently needs a browser. If refactoring extracts pure helpers, add unit coverage only where it improves signal. |

## Dev Tooling

| Choice | Why |
|---|---|
| `http-server` | Tiny static server for local fixture testing and local-only bookmarklet mode. |
| Node 20+ | Required for Playwright and project scripts. |
| `scripts/build-bookmarklet.js` | Generates the bookmarklet string for hosted or local editor URLs. |

## Deliberate Exclusions

- **No runtime dependencies.** The shipped editor must stay self-contained.
- **No framework.** A framework is not justified for injected editor chrome.
- **No required bundler today.** The next refactor can propose source splitting, but deployment must stay explicit and low-risk.
- **No TypeScript today.** JavaScript remains the source of truth; add JSDoc or extracted helper tests where useful.
- **No CI today.** Tests run locally before pushing. Add CI only if private fixture constraints are solved or a sanitized fixture set is created.
- **No fixture commits by default.** Real deck content stays local and gitignored.

## Dependencies

Production dependencies: none.

Development dependencies:

```json
{
  "devDependencies": {
    "@playwright/test": "^1.49.0",
    "http-server": "^14.1.1"
  }
}
```

If a task seems to need a runtime dependency, stop and document why in the relevant brief before adding it.
