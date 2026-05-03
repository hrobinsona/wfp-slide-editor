# WFP Slide Editor

A bookmarklet-activated visual editor for HTML presentations. Click a bookmark, edit any slide directly in the browser (drag, resize, retype, change font size), then export the modified HTML.

## Why this exists

Prompting Claude for spatial tweaks (move that box 20px right, make this title bigger) is slow and error-prone. Direct manipulation is faster for the last 10% of polish. This tool covers that 10% without replacing Claude for everything else.

## How it works

1. The slide HTML stays clean. It never knows about the editor.
2. A bookmarklet (one-click bookmark in your browser bar) loads a hosted `editor.js` on demand.
3. `editor.js` activates an edit overlay on the current slide, lets you make changes directly, and exports the modified HTML when you're done.

This separates content (the slide) from tooling (the editor). Slides remain portable, standards-compliant HTML. The editor evolves independently and applies retroactively to any slide ever made.

## Quickstart for Claude Code

If you're Claude Code reading this for the first time:

1. Read `CLAUDE.md` for stack, commands, and rules.
2. Read `REQUIREMENTS.md` for what v1 must do (and not do).
3. Read `DESIGN.md` for architectural decisions.
4. Read `TASKS.md` for the build plan.
5. Read `TESTING.md` for the fixture-driven test approach.
6. The `fixtures/` directory contains real WFP presentations to test against. Treat them as immutable inputs.

## Project layout

```
.
├── CLAUDE.md                  # Session-persistent instructions for Claude Code
├── README.md                  # This file
├── REQUIREMENTS.md            # v1 spec: what the editor must do
├── DESIGN.md                  # Architectural decisions and rationale
├── STACK.md                   # Tech choices (and why each was chosen)
├── TASKS.md                   # Implementation plan, ordered
├── TESTING.md                 # Test approach using fixture HTMLs
├── ROADMAP.md                 # v2+ deferred items
├── .claude/
│   ├── settings.json          # Project-level Claude Code settings
│   └── agents/
│       ├── code-reviewer.md   # Reviews each phase before completion (Opus)
│       └── playwright-runner.md  # Runs tests, reports failures (Sonnet)
├── fixtures/                  # Real WFP presentations for testing
│   └── README.md              # How fixtures are used
├── tests/                     # Playwright tests (created in TASKS.md)
└── editor.js                  # The actual editor (created in TASKS.md)
```
