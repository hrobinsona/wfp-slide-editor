# v2.x Brief — Multi-Select Move

## Goal

Let authors move several active-slide elements together without introducing a full group-editing system.

The first slice supports Cmd/Ctrl-click multi-selection, clear visual feedback for the group, and scale-aware group drag with one undo/redo entry. This is intentionally narrower than marquee selection, group resize, or grouped inspector editing.

## Decisions

- Modifier: Cmd-click on macOS and Ctrl-click on Windows/Linux toggle elements in the selection.
- Scope: active slide only, session only.
- Visuals: one group bounding box plus subtle outlines around each selected element.
- Group actions: move only. Copy, paste, duplicate, delete, resize, inline text edit, and inspector controls remain single-element behaviours.
- Selection normalization: an ancestor and descendant cannot both remain selected; the latest clicked target wins.

## Behaviour

- Plain click selects exactly one element.
- Cmd/Ctrl-click toggles an element into or out of the current active-slide selection.
- Clicking the slide canvas, exiting edit mode, entering Overview, or changing active slides clears multi-selection.
- Dragging any selected member moves all selected members together.
- Dragging an unselected element resets to single selection and drags only that element.
- Group movement uses the same deck-scale conversion as single-element drag.
- Flow-positioned selected elements unlock through the existing absolute-positioning/freeze path.
- One completed group drag creates one history entry covering all moved elements and any touched containers/siblings.
- Export persists moved element positions and strips all editor UI.

## Tests

Add `tests/v2-multi-select.spec.js` covering:

- Cmd/Ctrl-click add/remove and plain-click reset.
- Slide-click, edit-mode off, Overview entry, and active-slide change clearing.
- Group box and per-element outlines, with inspector/handles/dimension bubble hidden for groups.
- Single-selection visual behaviour unchanged.
- Scale-aware group drag, deadzone, dragging a selected member, dragging an unselected element, and mixed flow/absolute movement.
- One-step undo/redo of group drag.
- Clean export after a group move.

## Non-Goals

- Marquee/lasso selection.
- Group copy/paste/duplicate/delete.
- Group resize.
- Group inspector style/layout edits.
- Persistent grouping or group/ungroup operations.
