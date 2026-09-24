# Slide reuse and content actions

Status: implemented and browser-validated; independent code review approved. Parent: product-workflow-plan.md.

## Contract

- Overview offers Duplicate slide beside Delete. It inserts a copy immediately
  after its source, with a single structural history entry and live navigation.
- Copies retain authored markup and styles. Every copied DOM id is unique;
  fragment links, labels, ARIA references, SVG URLs, and accessible same-origin
  stylesheet ID selectors are rewritten. Editor markers and note identities are
  removed; cloned scripts do not execute.
- Add text is available in Edit mode outside Overview, including flat documents.
  It places a text box near the centre of the visible editing canvas, selects it,
  and opens inline editing with its placeholder selected. Insert and subsequent
  typing use the existing independent undo transactions.
- Replace image is available for one selected img. A local file input accepts
  PNG, JPEG, GIF, WebP, AVIF and BMP; cancellation changes nothing. Invalid or
  undecodable files explain the failure. Successful replacement embeds a data
  URL and retains the box dimensions and object-fit. Responsive picture sources
  are disabled for the replacement and restored by Undo.
- All actions survive clean export and reopening, without editor UI or notes.

## Verification

Strict test-first for structural identity, image history and export. Browser
journeys exercise Overview controls, scaled text placement, actual file input,
invalid files, undo/redo, and export/reopen using public fixtures. Existing
Overview and text-edit regressions remain required. No runtime dependency.

Final verification: all 28 product workflow tests passed within the 116-test
final regression run. The full suite exercised 646 tests; eight old toolbar
assertions were updated and all passed in the final affected-suite rerun.
