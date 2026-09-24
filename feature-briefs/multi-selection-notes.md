# Mouse selection and notes for selected groups

Status: implemented, browser-validated, and independently reviewed. TDD: strict for selection/history/export.

## Outcomes

- Drag empty canvas space in Edit mode to draw a selection rectangle. Shift-drag
  can start over content; Cmd/Ctrl adds enclosed items to the current selection.
  Fully enclosed visible boxes on the active slide are selected, without keeping
  both an ancestor and descendant. Existing drag-on-item still moves selection.
- The rectangle uses viewport coordinates, so scaled decks remain accurate.
  It is editor chrome, never exported. Escape, pointer cancellation, blur, mode
  changes, and slide changes cancel safely. Small clicks retain existing meaning.
- Notes can target multiple selected items. The note identity and participating
  elements must survive handoff/reimport and recovery, retain agent replies,
  avoid overwriting existing individual notes, and undo/delete atomically.
  Use one shared instruction for the selected group, with independent member identities.
- Exclude Overview and Markdown from geometry selection. Existing movement,
  inline editing, inspector controls and Cmd/Ctrl-click selection remain intact.

## Validation

Real mouse selection on a public fixture at multiple scales; additive selection,
Escape cancellation, no off-slide/hidden/ancestor duplicates; move and undo;
group notes alongside individual notes; handoff/reimport/replies; clean export;
recovery; independent code review and relevant Playwright regressions.


## Verification result

- Initial rectangle and group-note tests failed before implementation.
- Full Chromium suite: **658 passed** (3.8m), including 12 new workflow cases.
- Visual inspection found inspector overflow with an open group note; a new
  short-window test reproduced it. A two-column action layout and bounded,
  scrollable panels fixed it. Final affected suites: **48 passed**, including
  all **13** new cases. Screenshots checked at 1280×720 and 1024×640.
- Independent code review approved after fixes for note-cycle identity, hidden
  descendants, unused-anchor cleanup, and immediate slide-change cancellation.
- Generated runtime and whitespace checks pass. No fixtures or outputs committed.

Preview: `http://localhost:8080/dev/harness.html`; local bookmarklet generated
from this worktree. Shared-group notes are separate from permanent grouping.
