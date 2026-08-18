// Blacklist hides events by id (falling back to normalized name for entries
// saved before ids existed) — source, date, time, and reference are ignored
// beyond that. Stored in its own Blob file so it survives scraper re-runs.

/** @param {string | null | undefined} name */
export function normalizeEventName(name) {
  return String(name ?? '').trim().replace(/\s+/g, ' ');
}

/**
 * Whether a stored blacklist entry refers to the same event as a live one.
 * Matches by id when the entry has one (every entry created after this
 * schema change does); falls back to normalized-name matching for entries
 * saved before ids existed, so nothing already hidden becomes visible again.
 * This must stay a per-entry predicate, not a shared hashable key — every
 * live event always has an id, so a single eventKey() compared symmetrically
 * could never fall back to name matching on the live-event side.
 * @param {{ id?: string, name: string }} entry
 * @param {{ id: string, name: string }} event
 */
export function blacklistEntryMatches(entry, event) {
  if (entry.id) return entry.id === event.id;
  return normalizeEventName(entry.name) === normalizeEventName(event.name);
}

/** @param {{ id: string, name: string }} event @param {Array<{ id?: string, name: string }>} blacklist */
export function isBlacklisted(event, blacklist) {
  return blacklist.some((entry) => blacklistEntryMatches(entry, event));
}

/** @param {{ id: string, name: string }} event */
export function toBlacklistRecord(event) {
  return {
    id: event.id,
    name: normalizeEventName(event.name),
  };
}

/**
 * Display-only key for React list rendering — not used for cross-object
 * matching (see blacklistEntryMatches).
 * @param {{ id?: string, name: string }} entry
 */
export function eventKey(entry) {
  return entry.id ?? normalizeEventName(entry.name);
}

/** @param {Array<{ name: string }>} entries */
export function sortBlacklist(entries) {
  return [...entries].sort((a, b) => a.name.localeCompare(b.name));
}
