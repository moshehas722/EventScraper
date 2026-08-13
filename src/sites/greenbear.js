// Site scraper for greenbear-club.com / greenbear.co.il (Green Bear, Hod Hasharon).
//
// Wix Events app — public REST query endpoints return 400/404 without session
// tokens. The schedule page SSR embeds full event objects in wix-warmup-data
// (appsWarmupData → events.events[]).
//
// Source: GET https://www.greenbear.co.il/ (לוח מופעים)
// Fields: title, scheduling.config.startDate, scheduling.startTimeFormatted,
//   registration.ticketing.{lowestPrice,highestPrice}, slug.

import { fetchText } from '../http.js';
import { noopProgress } from '../progress.js';

const ORIGIN = 'https://www.greenbear.co.il';
const SCHEDULE_URL = `${ORIGIN}/`;

export const meta = {
  id: 'greenbear',
  name: 'Green Bear (Hod Hasharon)',
  currency: '₪',
  origin: 'https://www.greenbear-club.com',
};

/**
 * Fetch and normalize all upcoming Green Bear events.
 * @returns {Promise<Array<{site:string,name:string,date:string,time:string,priceText:string,url:string}>>}
 */
export async function fetchEvents(progress = noopProgress) {
  const apiHeaders = { Referer: `${ORIGIN}/`, Origin: ORIGIN };
  progress.log(`GET ${SCHEDULE_URL} (Wix Events warmup JSON)`);
  const html = await fetchText(SCHEDULE_URL, apiHeaders);

  const rawEvents = extractWarmupEvents(html);
  progress.log(`parsed ${rawEvents.length} events from warmup data`);

  const today = todayIso();
  return rawEvents
    .map(normalizeEvent)
    .filter((e) => e.date >= today);
}

/** @param {string} html */
function extractWarmupEvents(html) {
  const match = html.match(/id="wix-warmup-data">([\s\S]*?)<\/script>/);
  if (!match) return [];

  let warmup;
  try {
    warmup = JSON.parse(match[1]);
  } catch {
    return [];
  }

  const apps = warmup?.appsWarmupData ?? {};
  for (const app of Object.values(apps)) {
    if (!app || typeof app !== 'object') continue;
    for (const widget of Object.values(app)) {
      const list = widget?.events?.events;
      if (Array.isArray(list) && list.length > 0) return list;
    }
  }
  return [];
}

/** @param {object} event */
function normalizeEvent(event) {
  const cfg = event.scheduling?.config ?? {};
  const { date, time } = localDateTime(cfg.startDate, event.scheduling?.startTimeFormatted);

  return {
    site: meta.name,
    name: String(event.title ?? '').trim(),
    date,
    time,
    priceText: formatPrice(event.registration?.ticketing),
    url: `${ORIGIN}/event-details/${event.slug}`,
  };
}

/**
 * Prefer site-displayed local time; derive date in Asia/Jerusalem from ISO UTC.
 * @param {string | undefined} startIso
 * @param {string | undefined} displayTime
 */
function localDateTime(startIso, displayTime) {
  const time = normalizeTime(displayTime) ?? '00:00';
  if (!startIso) return { date: '1970-01-01', time };

  const d = new Date(startIso);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jerusalem',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d);
  const get = (type) => parts.find((p) => p.type === type)?.value ?? '00';
  const date = `${get('year')}-${get('month')}-${get('day')}`;

  return { date, time: normalizeTime(displayTime) ?? utcTimeInJerusalem(d) };
}

/** @param {Date} d */
function utcTimeInJerusalem(d) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Jerusalem',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(d);
}

/** @param {string | undefined} value */
function normalizeTime(value) {
  const m = String(value ?? '').match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  return `${m[1].padStart(2, '0')}:${m[2]}`;
}

/** @param {object | undefined} ticketing */
function formatPrice(ticketing) {
  if (!ticketing) return 'N/A';

  const low = String(ticketing.lowestPriceFormatted ?? ticketing.lowestPrice ?? '').trim();
  const high = String(ticketing.highestPriceFormatted ?? ticketing.highestPrice ?? '').trim();

  if (!low) return 'N/A';
  if (high && high !== low) {
    const amount = low.startsWith('₪') ? low : `${meta.currency}${low.replace(/[^\d.]/g, '')}`;
    return `from ${amount}`;
  }
  return low.startsWith('₪') ? low : `${meta.currency}${low.replace(/[^\d.]/g, '')}`;
}

function todayIso() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
