// ===========================================================================
// Recent-file list (v2.22)
//
// Kept DOM-free so it can be unit-tested in Node: the File System Access
// picker cannot be automated, but the list arithmetic around it can be, and
// that is where the ordering and duplication bugs actually live.
//
// Identity is `isSameEntry`, not name: two notes in different folders can
// share a filename, and the same file re-picked yields a different handle
// object that must still collapse onto one entry.
// ===========================================================================

export const RECENTS_CAP = 8;

async function sameEntry(a, b) {
  if (a === b) return true;
  try {
    if (typeof a.isSameEntry === 'function') return await a.isSameEntry(b);
  } catch (_) { /* fall through to the name comparison below */ }
  return a.name === b.name;
}

/**
 * Put `handle` at the front, drop any earlier entry for the same file, and cap
 * the result. Returns a new array; the input is never mutated.
 */
export async function mergeRecents(list, handle, cap = RECENTS_CAP) {
  if (!handle) return [...(list || [])].slice(0, cap);
  const out = [handle];
  for (const item of list || []) {
    if (out.length >= cap) break;
    if (!item) continue;
    if (await sameEntry(item, handle)) continue;
    out.push(item);
  }
  return out;
}

/**
 * Labels for the recents picker. Duplicate filenames are disambiguated with a
 * numeric suffix so two `notes.md` from different folders stay distinguishable
 * — the handle carries no path, so there is nothing better to show.
 */
export function recentLabels(list) {
  const seen = new Map();
  return (list || []).map((handle) => {
    const name = handle?.name || 'untitled';
    const count = seen.get(name) || 0;
    seen.set(name, count + 1);
    return count === 0 ? name : `${name} (${count + 1})`;
  });
}
