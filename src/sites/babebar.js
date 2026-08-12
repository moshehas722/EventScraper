// Site scraper for babebar.co.il (Babe Bar, Hod Hasharon).
//
// WordPress + The Events Calendar (TEC) + WooCommerce tickets. One paginated
// REST call returns every upcoming event with name, local start time, cost,
// and event page URL.
//
// Endpoint: GET /wp-json/tribe/events/v1/events?start_date=…&per_page=100&page=N
// Each event has: title, start_date ("YYYY-MM-DD HH:mm:ss"), cost,
//   cost_details.values[], url.
// Node fetch rejects babebar.co.il's incomplete TLS chain — use insecureTls.

import { fetchJson } from '../http.js';
import { noopProgress } from '../progress.js';

const ORIGIN = 'https://babebar.co.il';
const API_BASE = `${ORIGIN}/wp-json/tribe/events/v1/events`;
const PER_PAGE = 100;
const FETCH_OPTS = { insecureTls: true };

export const meta = {
  id: 'babebar',
  name: 'Babe Bar (Hod Hasharon)',
  currency: '₪',
  origin: ORIGIN,
};

/**
 * Fetch and normalize all upcoming Babe Bar events.
 * @returns {Promise<Array<{site:string,name:string,date:string,time:string,priceText:string,url:string}>>}
 */
export async function fetchEvents(progress = noopProgress) {
  const apiHeaders = { Referer: `${ORIGIN}/`, Origin: ORIGIN };
  const startDate = `${todayIso()} 00:00:00`;
  const events = [];
  let page = 1;

  while (true) {
    const params = new URLSearchParams({
      start_date: startDate,
      per_page: String(PER_PAGE),
      page: String(page),
      status: 'publish',
    });
    progress.log(`GET /wp-json/tribe/events/v1/events page=${page}`);
    const data = await fetchJson(`${API_BASE}?${params}`, apiHeaders, FETCH_OPTS);

    const batch = data?.events ?? [];
    events.push(...batch);
    progress.log(`  ${batch.length} events`);

    if (!data?.next_rest_url || batch.length === 0) break;
    page += 1;
  }

  progress.log(`parsed ${events.length} events`);
  return events.map((e) => ({
    site: meta.name,
    name: decodeEntities(String(e.title ?? '').trim()),
    date: splitStartDate(e.start_date).date,
    time: splitStartDate(e.start_date).time,
    priceText: formatPrice(e),
    url: e.url ?? ORIGIN,
  }));
}

function formatPrice(event) {
  const values = (event.cost_details?.values ?? [])
    .map((v) => Number(String(v).replace(/[^\d.]/g, '')))
    .filter((n) => n > 0);

  const prices = values.length > 0 ? values : parseCostField(event.cost);
  if (prices.length === 0) return 'N/A';

  const min = Math.min(...prices);
  const amount = `${meta.currency}${stripTrailingZero(min)}`;
  return prices.length > 1 ? `from ${amount}` : amount;
}

function parseCostField(cost) {
  const text = decodeEntities(String(cost ?? ''));
  const m = /(\d+(?:\.\d+)?)/g;
  const prices = [];
  let match;
  while ((match = m.exec(text)) !== null) {
    const n = Number(match[1]);
    if (n > 0) prices.push(n);
  }
  return prices;
}

function splitStartDate(startDate) {
  const m = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2})/.exec(String(startDate ?? '').trim());
  return m ? { date: m[1], time: m[2] } : { date: '', time: '' };
}

function stripTrailingZero(n) {
  return Number.isInteger(n) ? String(n) : String(n);
}

function decodeEntities(str) {
  return String(str ?? '')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#8211;/g, '–')
    .replace(/&#8220;/g, '"')
    .replace(/&#8221;/g, '"');
}

function todayIso() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
