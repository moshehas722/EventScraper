// Site scraper for muzi.co.il (Muzi — Center region aggregator).
//
// Muzi is a WordPress events aggregator. REST discovery: wp-json exists but the
// `event` post type is not registered for REST (404 on /wp/v2/event). Taxonomy
// metadata is available (/wp/v2/events_by_region) but not event listings.
// admin-ajax `event_tax_infinite_scroll` returns HTML fragments, not JSON.
//
// Source: GET /events-by-region/center/ and paginated archive pages (38 pages,
// 10 events each). Each listing block has name, show time, venue hall, price
// range, and event URL. Date comes from preceding section headers
// (data-event-date="YYYYMMDD"). Promoted/ad blocks (.events-blocks-promotion)
// are skipped.

import { fetchText } from '../http.js';
import { noopProgress } from '../progress.js';

const ORIGIN = 'https://muzi.co.il';
const CENTER_PATH = '/events-by-region/center/';
const CENTER_URL = `${ORIGIN}${CENTER_PATH}`;

const DATE_HEADER_SPLIT =
  /(<div class="pt-4 pb-3 css-hidden-dates events-title" data-event-date="\d{8}">)/;
const EVENT_BLOCK_RE =
  /<div class="event py-4 post-(\d+)[^"]*"[\s\S]*?(?=<div class="event py-4 post-|<div class="pt-4 pb-3 css-hidden-dates|<div id="loadmoreEventsWrapper"|$)/g;

export const meta = {
  id: 'muzicenter',
  name: 'Muzi (Center)',
  currency: '₪',
  origin: ORIGIN,
};

/**
 * Fetch and normalize all upcoming Muzi Center-region events.
 * @returns {Promise<Array<{site:string,name:string,date:string,time:string,priceText:string,url:string}>>}
 */
export async function fetchEvents(progress = noopProgress) {
  const apiHeaders = { Referer: CENTER_URL, Origin: ORIGIN };
  const today = todayIso();
  const seen = new Set();
  const events = [];

  let page = 1;
  while (true) {
    const pageUrl = page === 1 ? CENTER_URL : `${ORIGIN}${CENTER_PATH}page/${page}/`;
    progress.log(`GET ${page === 1 ? CENTER_PATH : `${CENTER_PATH}page/${page}/`}`);

    const html = await fetchText(pageUrl, apiHeaders);
    const batch = parseListingHtml(html, today);
    progress.log(`  +${batch.length} events`);

    for (const event of batch) {
      addUnique(events, seen, event);
    }

    if (!html.includes('rel="next"') || batch.length === 0) break;
    page += 1;
  }

  progress.log(`parsed ${events.length} events`);
  return events;
}

function parseListingHtml(html, today) {
  const events = [];
  let currentDate = '';

  for (const part of html.split(DATE_HEADER_SPLIT)) {
    const dateMatch = /data-event-date="(\d{8})"/.exec(part);
    if (dateMatch) currentDate = dateMatch[1];

    for (const match of part.matchAll(EVENT_BLOCK_RE)) {
      const block = match[0];
      if (/events-blocks-promotion/.test(block) || !/border-left/.test(block)) continue;

      const url = block.match(/class="avatar-data__link" href="([^"]+)"/)?.[1]?.trim() ?? '';
      const nameRaw =
        block.match(/class="avatar-name[\s\S]*?class="avatar-data__link"[^>]*>([\s\S]*?)<\/a>/)?.[1] ??
        '';
      const time =
        block.match(/avatar-time[\s\S]*?תחילת הופעה:\s*(\d{2}:\d{2})/)?.[1]?.trim() ?? '';
      const venue =
        block.match(/avatar-location[\s\S]*?<p class="avatar-data__link[^"]*"[^>]*>([^<]+)/)?.[1]?.trim() ??
        '';
      const priceRaw =
        block.match(/avatar-cost[\s\S]*?<p class="avatar-data__link[^"]*"[^>]*>([^<]+)/)?.[1]?.trim() ??
        '';

      const name = decodeHtml(nameRaw.replace(/<[^>]+>/g, '')).trim();
      const date = yyyymmddToIso(currentDate);
      if (!url || !name || !date || date < today) continue;

      events.push({
        site: formatSite(venue),
        name,
        date,
        time,
        priceText: formatPrice(priceRaw),
        url,
      });
    }
  }

  return events;
}

function formatSite(venue) {
  const hall = decodeHtml(venue).trim();
  return hall ? `${meta.name} (${hall})` : meta.name;
}

function formatPrice(raw) {
  const text = decodeHtml(String(raw ?? '')).trim();
  if (!text || /בקרוב/i.test(text)) return 'N/A';

  const amounts = [...text.matchAll(/(\d+)/g)].map((m) => Number(m[1]));
  if (!amounts.length) return 'N/A';

  const min = Math.min(...amounts);
  if (/-|–/.test(text) && amounts.length > 1) return `from ${meta.currency}${min}`;
  if (amounts.length === 1) return `${meta.currency}${min}`;
  return `from ${meta.currency}${min}`;
}

function yyyymmddToIso(value) {
  const text = String(value ?? '').trim();
  if (!/^\d{8}$/.test(text)) return '';
  return `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}`;
}

function addUnique(events, seen, event) {
  const key = `${event.url}|${event.date}|${event.time}`;
  if (seen.has(key)) return false;
  seen.add(key);
  events.push(event);
  return true;
}

function decodeHtml(str) {
  return String(str ?? '')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&#8211;/g, '–');
}

function todayIso() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
