# Local recovery and external update protection

Status: implemented and browser-validated; independent code review approved. TDD: strict for persistence/save/conflicts.

A reload must offer a locally recovered working copy, retaining all note scopes,
replies and image content. A persistent status distinguishes source state from
local recovery. Restore and Discard are explicit; changed source is flagged.
Recovery does not restore history or merge documents.

Use a versioned IndexedDB snapshot keyed by the full source URL, supporting
image-heavy documents beyond localStorage limits. Debounce committed history
and observe document content for live text edits; canonical export-normalized
content determines dirty state, so undo back to the saved state clears it.
Storage errors must leave editing/save usable and visibly report that recovery
is unavailable. Recovery snapshots use annotated export with inlined assets;
all editor chrome and body mode markers are removed.

An external write while dirty is held pending. Keep local work, download a local
copy, or apply the disk version only after storing a recoverable prior snapshot.
Save is blocked while a pending newer file exists. Unfinished note drafts defer
refresh and protect restore/apply operations, including across asynchronous waits. Read the bound file before
building and again immediately before writing; verify the written HTML before
accepting the post-close timestamp. Serialize saves; edits made while
an asynchronous save is running remain dirty. Cancellation and write failures do
not clear local recovery. File System Access has no atomic compare-and-swap;
checking immediately before createWritable narrows but cannot eliminate the OS
race between that final read and close.

Verification: initial failing browser status/reload test; save/edit/undo/redo;
notes/reload/restore/discard/stale source; clean export; quota failure; large
snapshot; pending conflict/keep/download/apply; pre-write detection and save races.

Final verification: all 28 product workflow tests passed within the 116-test
final regression run. The full suite exercised 646 tests; eight old toolbar
assertions were updated and all passed in the final affected-suite rerun.
