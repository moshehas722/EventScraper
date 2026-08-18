// Blacklist hides events by name — source, date, time, and URL are ignored.
// Stored in its own Blob file so it survives scraper re-runs.

/** @param {string} name */
export function normalizeEventName(name) {
  return name.trim().replace(/\s+/g, ' ');
}

/** @param {{ name: string }} event */
export function eventKey(event) {
  return normalizeEventName(event.name);
}

/** @param {object} event */
export function toBlacklistRecord(event) {
  return {
    name: normalizeEventName(event.name),
  };
}

/** @param {Array<{ name: string }>} entries */
export function sortBlacklist(entries) {
  return [...entries].sort((a, b) => a.name.localeCompare(b.name));
}

/** @param {{ name: string }} event @param {Array<{ name: string }>} blacklist */
export function isBlacklisted(event, blacklist) {
  const key = eventKey(event);
  return blacklist.some((entry) => eventKey(entry) === key);
}
