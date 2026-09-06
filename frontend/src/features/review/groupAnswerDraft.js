const STORAGE_PREFIX = "reviewGroupDraft:";

function storageKey(groupKey) {
  return groupKey ? `${STORAGE_PREFIX}${groupKey}` : null;
}

function sameItemIds(a, b) {
  if (a.length !== b.length) return false;

  const sortedA = [...a].sort();
  const sortedB = [...b].sort();

  return sortedA.every((id, index) => id === sortedB[index]);
}

// Session-only, per-tab memory of in-progress group answers, so leaving to the
// menu mid-group and coming back doesn't throw the attempt away. Keyed by a
// caller-provided group identity plus the exact item set, so a retry batch
// (same group, fewer items) never inherits an unrelated draft.
export function loadGroupDraft(groupKey, itemIds) {
  const key = storageKey(groupKey);
  if (!key) return null;

  try {
    const raw = window.sessionStorage.getItem(key);
    if (!raw) return null;

    const parsed = JSON.parse(raw);

    if (!parsed || !Array.isArray(parsed.itemIds) || !sameItemIds(parsed.itemIds, itemIds || [])) {
      return null;
    }

    return parsed.data ?? null;
  } catch {
    return null;
  }
}

export function saveGroupDraft(groupKey, itemIds, data) {
  const key = storageKey(groupKey);
  if (!key) return;

  try {
    window.sessionStorage.setItem(key, JSON.stringify({ itemIds: itemIds || [], data }));
  } catch {
    // Storage unavailable (private browsing, quota) — drafts are a convenience, not a guarantee.
  }
}

export function clearGroupDraft(groupKey) {
  const key = storageKey(groupKey);
  if (!key) return;

  try {
    window.sessionStorage.removeItem(key);
  } catch {
    // ignore
  }
}
