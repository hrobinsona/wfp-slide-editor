# Stack

## Runtime

| Choice | Why |
|---|---|
| Vanilla JavaScript (ES2022) | Zero dependencies, no build step, fits in a single file. The editor runs inside any HTML page; minimal surface = minimal conflict. |
| Plain CSS (scoped via `#wfp-editor-root`) | Same logic. No CSS-in-JS, no preprocessor. Scoped via parent ID selector. |
| No framework (no React, no Vue, no Svelte) | Editor UI is small (toolbar, ring, handles, toast). Frameworks add weight and risk conflict with whatever the host page might be running. |

## Hosting

| Choice | Why |
|---|---|
| GitHub Pages | Free, stable URL, version-controlled, no separate account. Deploys on push to `main`. |

The hosted URL pattern: `https://[username].github.io/wfp-slide-editor/editor.js`

## Testing

| Choice | Why |
|---|---|
| Playwright | End-to-end testing against real fixture HTMLs in a real browser. Required because much of the editor's behavior (drag, scale-aware coordinates, inline-style merging) only manifests in a browser, not in JSDOM. |
| No unit test framework | The editor has no testable logic units that benefit from isolated unit tests. Everything meaningful happens against the DOM. Playwright covers it. |

## Dev tooling

| Choice | Why |
|---|---|
| `http-server` (npm) | Tiny static file server for local development. Used by `npm run dev` to serve fixtures so they can be opened with the editor injected. |
| Node 20+ | Required for Playwright. |

## Deliberate exclusions

- **No TypeScript.** The editor is small enough that TS adds friction without proportional benefit. JSDoc comments cover type hints where useful.
- **No bundler (Vite, esbuild, Rollup).** No build step means no bundler.
- **No linter / formatter config.** Keep it minimal. Add Prettier later if the project grows.
- **No CI.** Tests run locally before each push. Add GitHub Actions if/when the editor has multiple contributors.

## Dependencies (production)

None. Zero. The shipped `editor.js` has no runtime dependencies.

## Dependencies (dev)

Just enough to run tests:

```json
{
  "devDependencies": {
    "@playwright/test": "^1.49.0",
    "http-server": "^14.1.1"
  }
}
```

If a task requires adding a runtime dependency, stop and re-read this file. Adding a dependency is a deliberate decision, not a default.
