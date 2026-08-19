// Site scraper for comy.co.il (Comy — nationwide stand-up/comedy aggregator).
//
// WordPress theme with a custom comy/v1/shows REST route, but that route is
// POST-only and unused by the frontend. The homepage search widget instead
// calls admin-ajax action=comy_search (SEARCH_ACTION in the theme's app.js),
// which returns the full upcoming catalog (~500+ shows across ~140 venues)
// in one POST — no pagination needed.
//
// Endpoint: POST https://comy.co.il/wp-admin/admin-ajax.php?action=comy_search
// Fields: artistName, showName (category label, e.g. "סטנדאפ"), link
//   (tickets.comy.co.il booking page), timestamp, placeName.
// `timestamp` is Unix seconds whose UTC calendar/clock fields equal the
// Israel wall-clock date/time (verified against the site's own displayed
// date/time strings) — read date/time straight from the UTC components,
// no Asia/Jerusalem conversion needed.
// No price field anywhere in the listing -> priceText is always N/A.

import { fetchPostJson } from '../http.js';
import { noopProgress } from '../progress.js';

const ORIGIN = 'https://comy.co.il';
const AJAX_URL = `${ORIGIN}/wp-admin/admin-ajax.php?action=comy_search`;
const DOOR_TIME_SUFFIX_RE = /\s*-?\s*פתיחת דלתות\s*\d{1,2}:\d{2}\s*$/;

export const meta = {
  id: 'comy',
  name: 'Comy',
  location: 'Comy',
  currency: '₪',
  origin: ORIGIN,
  aggregator: true,
};

/**
 * Fetch and normalize all upcoming Comy events across venues.
 * @returns {Promise<Array<{site:string,name:string,date:string,time:string,priceText:string,url:string}>>}
 */
export async function fetchEvents(progress = noopProgress) {
  const apiHeaders = { Referer: `${ORIGIN}/`, Origin: ORIGIN };
  const today = todayIso();

  progress.log('POST admin-ajax.php?action=comy_search');
  const data = await fetchPostJson(
    AJAX_URL,
    {
      mainSearchText: '',
      dateFrom: '',
      dateTo: '',
      isToday: 'false',
      isTomorrow: 'false',
      isWeekend: 'false',
      subIsNear: 'false',
      lat: '',
      lng: '',
      subIsAnywhere: 'true',
      subArea: '',
      subCityText: '',
      quickSearch: 'false',
    },
    apiHeaders,
  );

  const raw = data?.success ? (data.data?.events ?? []) : [];
  progress.log(`  ${raw.length} events`);

  const seen = new Set();
  const events = [];
  for (const item of raw) {
    const event = normalizeEvent(item);
    if (!event || event.date < today) continue;

    const key = `${event.url}|${event.date}|${event.time}`;
    if (seen.has(key)) continue;
    seen.add(key);
    events.push(event);
  }

  progress.log(`parsed ${events.length} events`);
  return events;
}

/** @param {object} item */
function normalizeEvent(item) {
  const { date, time } = splitTimestamp(item.timestamp);
  const url = String(item.link ?? '').trim();
  const artistName = String(item.artistName ?? '').trim();
  if (!date || !time || !url || !artistName) return null;

  const venue = cleanPlace(item.placeName);

  return {
    site: formatSite(venue),
    location: formatLocation(venue),
    name: formatName(artistName, item.showName),
    date,
    time,
    priceText: 'N/A',
    category: 'standup',
    url,
  };
}

function formatName(artistName, showName) {
  const category = String(showName ?? '').trim();
  return category ? `${artistName} - ${category}` : artistName;
}

function cleanPlace(raw) {
  return String(raw ?? '').replace(DOOR_TIME_SUFFIX_RE, '').trim();
}

function formatSite(venue) {
  return venue ? `${meta.name} (${venue})` : meta.name;
}

function formatLocation(venue) {
  return venue ? `${meta.name}, ${venue}` : meta.location;
}

/** @param {number | undefined} timestamp Unix seconds; UTC fields equal Israel wall-clock date/time. */
function splitTimestamp(timestamp) {
  const seconds = Number(timestamp);
  if (!Number.isFinite(seconds)) return { date: '', time: '' };

  const d = new Date(seconds * 1000);
  const p = (n) => String(n).padStart(2, '0');
  const date = `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
  const time = `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
  return { date, time };
}

function todayIso() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
