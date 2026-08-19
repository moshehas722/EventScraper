// Site scraper for papaito.co.il (Papaito).
//
// WordPress + rgbcode custom events block. The homepage loads and filters events
// via admin-ajax (JSON wrapper with HTML item fragments), not wp-json REST.
//
// Endpoint: POST /wp-admin/admin-ajax.php
//   action=load_events_block&nonce=…&date_filter=&page=N&per_page=100&page_url=…
// Response: { success, data: { items_html, pagination_html } }
// Each item has: title, date text "DD.MM (weekday) HH:mm", url /event/{id}/.
// Node fetch rejects papaito.co.il's incomplete TLS chain — use insecureTls.

import { fetchText, fetchPostJson } from '../http.js';
import { noopProgress } from '../progress.js';

const ORIGIN = 'https://papaito.co.il';
const AJAX_URL = `${ORIGIN}/wp-admin/admin-ajax.php`;
const PER_PAGE = 100;
const FETCH_OPTS = { insecureTls: true };

export const meta = {
  id: 'papaito',
  name: 'Papaito',
  currency: '₪',
  origin: ORIGIN,
};

const NONCE_RE = /ajaxNonce":"([a-f0-9]+)"/;
const ITEM_RE =
  /<a\s+class="events-block__item[^"]*"\s+href="([^"]+)"[\s\S]*?events-block__item-title[^>]*>\s*([^<]+?)\s*<\/div>[\s\S]*?events-block__item-date[\s\S]*?>\s*(\d{2}\.\d{2}\s+\([^)]+\)\s+\d{2}:\d{2})/g;

/**
 * Fetch and normalize all upcoming Papaito events.
 * @returns {Promise<Array<{site:string,name:string,date:string,time:string,priceText:string,url:string}>>}
 */
export async function fetchEvents(progress = noopProgress) {
  const apiHeaders = { Referer: `${ORIGIN}/`, Origin: ORIGIN };

  progress.log('GET / (nonce)');
  const homeHtml = await fetchText(`${ORIGIN}/`, apiHeaders, FETCH_OPTS);
  const nonce = NONCE_RE.exec(homeHtml)?.[1];
  if (!nonce) throw new Error('Papaito ajax nonce not found on homepage');

  const events = [];
  const seen = new Set();
  let page = 1;

  while (true) {
    progress.log(`POST load_events_block page=${page}`);
    const data = await fetchPostJson(
      AJAX_URL,
      {
        action: 'load_events_block',
        nonce,
        date_filter: '',
        page: String(page),
        per_page: String(PER_PAGE),
        page_url: `${ORIGIN}/`,
      },
      apiHeaders,
      FETCH_OPTS,
    );

    if (!data?.success) throw new Error('Papaito load_events_block returned success=false');

    const html = String(data.data?.items_html ?? '');
    const batch = parseItemsHtml(html);
    progress.log(`  ${batch.length} events`);

    for (const event of batch) {
      const key = `${event.url}-${event.date}-${event.time}`;
      if (seen.has(key)) continue;
      seen.add(key);
      events.push(event);
    }

    const pagination = String(data.data?.pagination_html ?? '');
    const nextPage = nextPageNumber(pagination, page);
    if (!nextPage || batch.length === 0) break;
    page = nextPage;
  }

  progress.log(`parsed ${events.length} events`);
  return events;
}

function parseItemsHtml(html) {
  const events = [];
  for (const m of html.matchAll(ITEM_RE)) {
    const [, url, name, dateTimeText] = m;
    const { date, time } = parseDateTimeText(dateTimeText);
    if (!date) continue;

    events.push({
      site: meta.name,
      name: decodeHtml(name).trim(),
      date,
      time,
      priceText: 'N/A',
      url: url.trim(),
    });
  }
  return events;
}

// "13.08 (ה׳) 21:00" -> { date: "2026-08-13", time: "21:00" }
function parseDateTimeText(text) {
  const m = /^(\d{2})\.(\d{2})\s+\([^)]+\)\s+(\d{2}:\d{2})/.exec(String(text ?? '').trim());
  if (!m) return { date: '', time: '' };

  const day = Number(m[1]);
  const month = Number(m[2]);
  const time = m[3];
  const date = inferIsoDate(day, month);
  return { date, time };
}

function inferIsoDate(day, month) {
  const today = new Date();
  let year = today.getFullYear();
  const candidate = new Date(year, month - 1, day);
  const todayStart = new Date(year, today.getMonth(), today.getDate());
  if (candidate < todayStart) year += 1;

  const p = (n) => String(n).padStart(2, '0');
  return `${year}-${p(month)}-${p(day)}`;
}

function nextPageNumber(paginationHtml, currentPage) {
  const pages = [...paginationHtml.matchAll(/data-page="(\d+)"/g)].map((m) => Number(m[1]));
  const upcoming = pages.filter((p) => p > currentPage);
  return upcoming.length > 0 ? Math.min(...upcoming) : null;
}

function decodeHtml(str) {
  return String(str ?? '')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#8211;/g, '–');
}
