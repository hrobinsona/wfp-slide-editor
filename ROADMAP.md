# Roadmap

This file tracks work not covered by the current product contract in `REQUIREMENTS.md`. Known bugs and small iteration candidates on existing behaviour live in `FEATURES-AND-BUGS.md`.

## Delivered

### v1 Element Editing

Bookmarklet load, edit-mode toggle, selection, drag, resize, font-size keyboard nudges, inline text edit, undo/redo, export, and bookmarklet generation.

Historical build plan: `TASKS.md`.

### v2.0 Inspector and Liquid-glass Refresh

Inspector controls for position, size, font size, colour, opacity, reset styles, and minimised state. Toolbar visual refresh shipped with the same release.

Historical feature brief: `feature-briefs/v2-inspector.md`.

### v2.1 Overview Mode

Slide-grid overview, click-to-navigate, drag-to-reorder, delete, last-slide guard, slide-level undo/redo, and clean export after slide mutations.

Historical feature brief: `feature-briefs/v2-overview.md`.

### v2.2 Element Copy/Paste/Delete + Overview Add Slide

Session-only element copy/paste with same-slide duplicate, selected-element delete, cross-slide paste via the active slide, structural undo/redo, clean export of pasted elements, and blank slide insertion from Overview mode with undo/redo.

Feature brief: `feature-briefs/duplicate execution.md`.

### v2.3 Multi-Select Move

Cmd/Ctrl-click active-slide multi-select with group bounding box, per-element outlines, scale-aware group movement, flow unlock support, one-step undo/redo, and clean export.

Feature brief: `feature-briefs/v2-multi-select-move.md`.

### v2.5 Agent Handoff Annotations

Selected-element agent notes, visible peach circular markers, undoable annotation save/delete, clean normal export, explicit handoff export with structured metadata, and handoff reimport.

Feature brief: `feature-briefs/v2-agent-annotations-handoff.md`.

### v2.11 Export Action Menu and Save-in-place

Single Export toolbar button with an agent-annotation count badge (hidden at zero) replacing the separate Handoff button, and a two-row action menu. The primary row (Cmd/Ctrl+S, or Enter while the menu is open) writes straight over the source file on disk via the File System Access API in Chromium-based browsers, using an IndexedDB-backed file handle so only the first save per page load, and one re-grant click per reload, are needed instead of a picker every time. Safari and Firefox fall back to the v2.5 download behaviour. A secondary "Clean copy" row keeps an always-download, notes-stripped path in every browser.

Feature brief: `feature-briefs/v2.11-save-in-place-export.md`.

### v2.13 Live Agent Round-trip

When an agent rewrites the bound save-in-place file, the editor refreshes the document in place (document swap plus editor re-injection — no reload, no bookmarklet re-click, no re-grant), restoring edit mode, active slide, fold states, and the file handle. Refreshes defer while an interaction is open, the editor's own saves never self-trigger, and permission loss pauses the watch with a re-link on the next save. The handoff guidance now carries an agent results contract (`script[data-wfp-agent-results]`, statuses done/skipped/needs-input); import reconciles results — done resolves even sloppy leftovers, replies render as amber/slate badges plus a read-only inspector line, and a summary toast reports the round. Feasibility spike: `feature-briefs/spike-live-refresh-findings.md`.

Feature brief: `feature-briefs/v2.13-live-agent-roundtrip.md`.

### v2.14 Handoff Ground Truth: Edit Ledger and Measurements

Handoff exports now carry an `edits` ledger — one entry per user-touched element, pristine pre-edit inline style versus current, anchored to the exported element via `data-wfp-agent-edit-id` (stamped on the live DOM only transiently during the build) — plus `box`/`computed`/`overflow` measurements on both ledger entries and annotations, read from the live document at save time. Unlock/freeze pinning is labelled `mechanical: true` only while an element's style is still exactly what the pin wrote, so editor mechanics never read as user intent; the guidance tells agents to preserve ledger edits unless a note asks otherwise, and reimport ignores the ledger and strips leftover anchors at boot. Deliberately excluded from ledger v1: slide reorder/insert/delete intent (needs an order-at-boot snapshot — candidate follow-up) and text-content before/after.

Feature brief: `feature-briefs/v2.14-handoff-ground-truth.md`.

## Active Engineering Track

### Maintainability Refactor

The editor is now feature-rich but structurally heavy: `editor.js` is about 3.4k lines and carries element editing, inspector, history, overview, and export in one file. Before major feature expansion, fix the known correctness gaps and clarify internal boundaries.

Executable brief: `REFACTOR-MAINTAINABILITY.md`.

## v2.x Candidates

### Slide- and Deck-scoped Agent Notes

Raised 2026-07-24, same review. Notes attach only to a single selected element in the active slide (`saveAnnotation` refuses multi-select and Overview mode), so deck-scoped intent — the stated main purpose of annotations — gets smuggled through an arbitrary element's note. Candidate: a `scope` field in the handoff payload (`element` | `slide` | `deck`), a note affordance on Overview slide cards, and a single deck-level note reachable from the export menu. Revisits the v2.5 "slide-level annotations" non-goal. Deliberately excludes typed/relational annotations — freeform text plus scope covers the gap.

### Persistence

Autosave to localStorage so closing a tab does not lose edits. Key by URL plus a slide/deck hash. Must define restore UX and stale-source behaviour before implementation. The v2.11 file-handle store (IndexedDB `wfp-editor`/`handles`, keyed by `location.href`) is a candidate foundation for this — it already solves per-URL persistence and reload rehydration — though today it holds only the bound save-file handle, not edit history or a change hash.

### Multi-select Follow-ups

Marquee/lasso selection, group copy/delete/duplicate, group resize, group inspector edits, and persistent group/ungroup operations.

### Snap-to-grid and Alignment Guides

A 16px grid would be useful. Smarter guides could snap to element edges, centers, and slide axes.

### Aspect-ratio Lock on Resize

Hold Shift while resizing to preserve aspect ratio. Most useful for images and logo-like elements.

### Z-order Control

Bring forward/send backward shortcuts and possibly a compact layers view.

### Add New Elements

Insert text, image, divider, or simple shape elements. This moves the editor closer to authoring, so scope carefully.

### Agent Handoff Evals

Build an eval suite for downstream agents consuming `<basename>-agent-handoff.html`. The editor's Playwright tests verify that handoff metadata is exported correctly; evals should verify that an agent can read the JSON, apply each annotation to the matching `data-wfp-agent-annotation-id` element, avoid unrelated edits, preserve valid HTML/scripts/styles, respect higher-priority user/system instructions, ignore stale metadata, and remove resolved handoff metadata from the final cleaned file. The v2.13 results contract (`script[data-wfp-agent-results]`) gives these evals an objective per-annotation target: did the agent record accurate statuses, strip done metadata, and keep skipped/needs-input notes anchored.

## v3 Candidates

### Asset Replacement

Replace an image source through a file picker or URL. Needs a decision on embedded assets vs external references.

### Animation Editing

Adjust animation delays and preview animations in place.

### Theme Variable Overrides

Expose CSS custom properties at deck or slide level. Needs guardrails so edits do not unintentionally recolour the whole deck.

### Component-aware Editing

Recognize common WFP slide components and offer pattern-specific controls.

## Architectural Candidates

### Source Split With Stable Deployment

Split implementation source into smaller files only if the deployment path stays obvious. Options include:

- Keep a single deployed `editor.js` generated by an explicit build command.
- Load multiple plain scripts from the bookmarklet in a documented order.
- Keep one file but enforce stronger internal module boundaries.

The maintainability refactor should decide whether physical splitting is worth it after the correctness fixes land.

### Surgical Export

Instead of serializing the live DOM, fetch original source text and apply recorded patches. This preserves whitespace/comments better but increases complexity.

### Pinned Editor Versions

Freeze a stable runtime file such as `editor-v2.1.js` when a future change risks breaking older workflows.

### Browser Extension Distribution

Consider only if bookmarklet installation becomes a real adoption blocker.

## Won't Build For Now

- Mobile/touch editing.
- Real-time collaboration.
- Cloud sync of edits.
- Full WYSIWYG slide authoring from scratch.
- Plugin system.
