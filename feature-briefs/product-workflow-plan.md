# Product workflow improvements

Status: implementation, browser validation, and independent review complete.
Publication pending GitHub authentication.

Base: GitHub `origin/main` at `1310413`. Worktree: `.worktrees/product-workflow`.
Branch: `feat/product-workflow`. Do not merge or deploy; finish with a pull request.

## Outcomes

1. Protect unsaved edits during external agent updates and recover a local working
   snapshot after reload. Distinguish saved source from a local recovery copy;
   never silently replace unsaved edits or overwrite a newer external file.
2. Author agent notes for an element, a whole slide, or the whole deck. Browse,
   edit, undo, save, reimport, and reconcile each scope using the existing notes
   and handoff workflow. Clean copies contain no annotation metadata.
3. Duplicate an existing slide, insert editable text, and replace a selected
   image with a local image while preserving layout. Every action must undo/redo
   and survive clean export and reopening.

## Execution

- Write a focused brief for each outcome before implementation; strict test-first
  for state/export/geometry, browser-first permitted for visual controls with
  browser tests before completion.
- GPT-6 Astra with high reasoning handles the independent implementation areas.
  Agents own separate source fragments and tests; the coordinating agent owns
  shared integration, documentation, generated runtime, and Git operations.
- Preserve the dependency-free bookmarklet runtime and existing host layouts.
- Use current public fixtures plus local private fixtures copied into ignored
  worktree paths; never modify or commit private fixtures or generated outputs.
- Verify the user journeys with Playwright, including scaled layout, keyboard
  use, cancel paths, undo/redo, clean export/reopen, save/recovery, and conflicts.
- Run the appropriate regression suite, an independent code-review subagent,
  resolve findings, and provide a local preview before creating the PR.
- Commit the plan, shared feature implementation, and validation documentation.
  The three features share history/export integration and land as one coherent change. Push only the feature branch, never main.

## Progress and continuation

- [x] Refreshed GitHub and created an isolated worktree.
- [x] Scheduled this thread to check for interrupted work at half past each hour;
      the next check after the observed five-hour reset is 02:30 London time.
      Automation: `resume-slide-editor-implementation`. Pause it on completion.
- [x] Recovery and conflict protection implemented and tested.
- [x] Scoped notes implemented and tested.
- [x] Slide reuse and content actions implemented and tested.
- [x] Integrated browser journeys and regression suite pass.
- [x] Independent review approved; findings resolved.
- [ ] Feature branch pushed, PR created, continuation paused.

Do not restart completed work after a quota interruption. Read this plan, Git
status/log, the three feature briefs, and this thread; continue outstanding work
in the same worktree. Check active agents before assigning duplicate work.

## Final validation and handoff

- GitHub main rechecked at `1310413`; feature work is isolated in this worktree.
- Full Chromium regression: 638 passed, 8 old toolbar assertions failed.
- Updated those assertions for Add text; all affected suites and all new workflow
  cases then passed: **116/116**, including **28/28** new feature/journey tests.
  All 646 cases have passing coverage across the full run and affected rerun.
- Generated runtime check and whitespace check pass. Visual inspection at
  1280×720 and 1024×768 completed; preview `http://localhost:8080/dev/harness.html`.
- Independent GPT-6 Astra code review: no remaining code findings; original save
  races, note-draft loss, conflict-panel focus and SVG reference bugs resolved.
- GitHub CLI credentials are invalid. Browser GitHub access was rejected by
  automatic approval review because origin-level session access was not authorized.
  Finish publishing once the user reauthenticates GitHub; never merge or deploy.

Feature implementation commit: `327df00`. The feature branch push also failed
because GitHub credentials were unavailable. The prepared PR description is in
ignored `tests/output/product-workflow-pr.md`. Continuation is paused while
waiting for GitHub login; code, review and browser validation are complete.


## Added scope: mouse multi-selection and shared group notes

Implemented in the same worktree per the follow-up request. See
`feature-briefs/multi-selection-notes.md`. Full regression: 658/658; after a
visual layout correction, affected suites: 48/48 including 13 new cases.
Independent review approved. GitHub authentication rechecked on 2026-09-22;
the credential is still invalid, so publishing remains pending login.
