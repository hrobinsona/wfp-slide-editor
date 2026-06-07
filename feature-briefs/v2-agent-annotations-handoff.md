# v2.x Brief - Agent Handoff Annotations

## Goal

Let authors leave targeted agent cleanup instructions on selected slide elements, then export an explicit handoff HTML file that an agent can inspect and act on.

The first slice supports one annotation per selected element, a compact inspector authoring UI, visible peach circular markers while editing, undoable save/delete, clean normal export, and a separate handoff export with structured metadata. This is deliberately metadata-driven rather than a hidden prompt.

## Decisions

- Scope: single selected element only. No slide-level or text-range annotations in v1.
- Storage: live annotations use `data-wfp-edit-annotation-id` and `data-wfp-edit-annotation-text` on the target element.
- Normal export: unchanged clean artifact; strips all annotation attributes and handoff metadata.
- Handoff export: separate toolbar action that downloads `<basename>-agent-handoff.html`.
- Handoff format: safe HTML comment plus `script[type="application/json"][data-wfp-agent-annotations]`, with matching `data-wfp-agent-annotation-id` attributes on targets.
- Reimport: when the editor is injected into handoff HTML, matching handoff metadata is restored into live editor annotation attributes.
- Copy/paste/duplicate: annotations do not copy to clones because editor artifacts are stripped before cloning.

## Behaviour

- The inspector shows an Agent note row for exactly one selected element.
- The row contains a textarea plus Save and Delete controls.
- Selecting another element refreshes the textarea from that element's annotation.
- Saving trimmed text writes or updates that element's annotation.
- Saving empty/whitespace text removes the annotation.
- Delete removes the annotation.
- Saved annotations show a small editor-only peach circular marker on the target element while edit mode is on.
- The Agent note row visibly distinguishes saved, unsaved, and delete-on-save draft states.
- Unchanged saves do not create history entries.
- Save/delete are each one undoable history entry.
- The Handoff toolbar button is disabled when there are no connected annotations and enabled otherwise.
- Handoff export commits any open text edit before serialization, like normal export.
- Handoff export includes only connected annotated elements in metadata.
- Reimport ignores stale metadata entries whose target id no longer exists.

## Tests

Add `tests/v2-agent-annotations.spec.js` covering:

- Annotation row visibility for single selection, no selection, multi-select, and Overview.
- Save, edit, delete, empty-save delete, unchanged-save no-op, and selection refresh.
- Saved-state UI and target circular marker visibility.
- Undo/redo for annotation save/delete.
- Duplicate/copy/paste do not copy annotations.
- Normal export contains no annotation metadata or annotation text.
- Handoff export contains the safe comment, JSON metadata, and matching target markers.
- Reopening handoff HTML reloads annotations into the inspector.
- Re-exporting normally after reimport strips all handoff metadata.
- Toolbar order and Handoff enabled/disabled state.

## Non-Goals

- Hidden prompts intended to override agent/system/user instructions.
- Text-range annotations.
- Slide-level annotations.
- Pins panel, comments panel, review status, or resolved-state workflow.
- Multi-annotation threads on one element.
- Persisting annotations outside exported HTML.
