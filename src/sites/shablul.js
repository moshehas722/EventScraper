// Site scraper for shablul.smarticket.co.il (Shablul / שבלול, Tel Aviv).
//
// SmarTicket platform. The homepage loads upcoming performances from a JSON
// catalog API. Each show (production) embeds an events[] array of dated
// performances with pricelist tiers.
//
// Endpoint: GET /api/shows
//   -> [{ id, title, url, events: [{ id, show_date, show_time, pricelist, ... }] }]
// Event URL: {origin}/{show.url}/?id={event.id}

import { fetchJson } from '../http.js';
import { noopProgress } from '../progress.js';

const ORIGIN = 'https://shablul.smarticket.co.il';
const API_URL = `${ORIGIN}/api/shows`;

export const meta = {
  id: 'shablul',
  name: 'Shablul (Tel Aviv)',
  currency: '₪',
  origin: ORIGIN,
};

/**
 * Fetch and normalize all upcoming Shablul events.
 * @returns {Promise<Array<{site:string,name:string,date:string,time:string,priceText:string,url:string}>>}
 */
export async function fetchEvents(progress = noopProgress) {
  progress.log('GET /api/shows');
  const shows = await fetchJson(API_URL, {
    Referer: `${ORIGIN}/`,
    Origin: ORIGIN,
  });

  const today = todayIso();
  const events = [];

  for (const show of Array.isArray(shows) ? shows : []) {
    for (const ev of show.events ?? []) {
      if (ev.visibility === false) continue;
      const date = String(ev.show_date ?? '').trim();
      if (!date || date < today) continue;

      const slug = show.url ?? show.url_en;
      const eventId = ev.id;
      events.push({
        site: meta.name,
        name: stripHtml(show.title).trim(),
        date,
        time: String(ev.show_time ?? ev.time_label ?? '').trim(),
        priceText: formatPrice(ev.pricelist),
        url: slug && eventId ? `${ORIGIN}/${slug}/?id=${eventId}` : `${ORIGIN}${ev.permalink ?? ''}`,
      });
    }
  }

  progress.log(`parsed ${events.length} events`);
  return events;
}

function formatPrice(pricelist) {
  if (!Array.isArray(pricelist) || pricelist.length === 0) return 'N/A';
  const prices = pricelist
    .map((p) => Number(p.price))
    .filter((n) => Number.isFinite(n) && n > 0);
  if (prices.length === 0) return 'N/A';
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  if (min === max) return `${meta.currency}${min}`;
  return `from ${meta.currency}${min}`;
}

function stripHtml(str) {
  return String(str ?? '')
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function todayIso() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
