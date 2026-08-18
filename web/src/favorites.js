// Favorites are stored independently of the scraped events snapshot (as their
// own Blob file) so they survive scraper re-runs. Each entry keeps a copy of
// the event's display fields so the favorites panel still works even if that
// event later drops out of the current snapshot.

/** @param {string} fromIso @param {string} toIso */
export function daysUntil(fromIso, toIso) {
  const [y1, m1, d1] = fromIso.split('-').map(Number);
  const [y2, m2, d2] = toIso.split('-').map(Number);
  const start = Date.UTC(y1, m1 - 1, d1);
  const end = Date.UTC(y2, m2 - 1, d2);
  return Math.round((end - start) / 86400000);
}

/** @param {number} days */
export function formatDaysLeft(days) {
  if (days < 0) return 'Past';
  if (days === 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  return `In ${days} days`;
}

/**
 * Prefer live event fields (fresher date/time/price) when the favorited
 * event is still present in the current snapshot; fall back to the stored
 * snapshot otherwise.
 * @param {object} favorite
 * @param {Array} events
 */
export function mergeFavoriteWithLiveEvent(favorite, events) {
  const live = events.find((e) => e.id === favorite.id);
  return live ? { ...favorite, ...live } : favorite;
}

/**
 * Nearest-upcoming-first; past-dated favorites sink to the bottom.
 * @param {Array<{ date: string, time: string }>} favorites
 * @param {string} todayIso
 */
export function sortFavorites(favorites, todayIso) {
  return [...favorites].sort((a, b) => {
    const aPast = a.date < todayIso;
    const bPast = b.date < todayIso;
    if (aPast !== bPast) return aPast ? 1 : -1;
    return a.date.localeCompare(b.date) || a.time.localeCompare(b.time);
  });
}

/** @param {object} event */
export function toFavoriteRecord(event) {
  return {
    id: event.id,
    name: event.name,
    date: event.date,
    time: event.time,
    cost: event.cost,
    source: event.source,
    sourceOrigin: event.sourceOrigin ?? null,
    reference: event.reference,
    referenceType: event.referenceType,
  };
}

/**
 * Favorites on the nearest upcoming date (today or later). Returns null if none.
 * @param {Array} favorites
 * @param {Array} events
 * @param {string} todayIso
 */
export function getUpcomingFavoritesHighlight(favorites, events, todayIso) {
  const upcoming = favorites
    .map((f) => mergeFavoriteWithLiveEvent(f, events))
    .filter((f) => f.date >= todayIso)
    .sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time));

  if (upcoming.length === 0) return null;

  const nearestDate = upcoming[0].date;
  return {
    date: nearestDate,
    events: upcoming.filter((f) => f.date === nearestDate),
  };
}

/** @param {{ date: string, events: Array<{ id: string }> } | null} highlight */
export function upcomingHighlightKey(highlight) {
  if (!highlight) return null;
  const ids = highlight.events.map((e) => e.id).sort().join('\0');
  return `${highlight.date}\0${ids}`;
}
