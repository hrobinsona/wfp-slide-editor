# Slide and deck agent notes

Status: implemented and browser-validated; independent code review approved. Outcome 2 of `product-workflow-plan.md`.

## Contract

The notes panel offers Current slide and Whole deck authoring without selecting
an arbitrary element. One note per scope target uses the existing annotation ID,
instruction and agent-reply attributes on the actual slide or resolved deck
root, plus an explicit scope marker. Element notes retain their existing flow.
Slide/deck controls are unavailable in Markdown and flat-document mode.

Cards identify scope, browse all scopes, and jump to a slide when applicable.
Scoped cards open an editor inside the notes panel, including from Overview.
Saving/deleting a note is one undoable transaction; changing the instruction
clears the previous agent reply. Deleting a slide removes its notes, and undo
restores them with the slide.

Handoff entries carry `scope: element|slide|deck`; absent scope on older handoffs
means element. Slide/deck anchors refer to their structural root, never child
content. Scoped entries do not receive element geometry. Existing result IDs
reconcile done/skipped/needs-input for every scope. Clean copies strip all note
metadata. Annotated copies restore the same scope on reimport.

## Verification

Strict test-first browser coverage for scope/state, history, export/reimport,
results and clean-copy removal. Public fixtures only; no fixture mutation.
Focused regressions cover the existing notes panel, annotations and Markdown.

Final verification: all 28 product workflow tests passed within the 116-test
final regression run. The full suite exercised 646 tests; eight old toolbar
assertions were updated and all passed in the final affected-suite rerun.
