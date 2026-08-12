// Site scraper for grayclub.co.il (Gray Club Yehud / מועדון גריי יהוד).
//
// WordPress + grayux theme (Kod VeLev). The Yehud location page loads the first
// 12 shows server-side; additional shows via admin-ajax (JSON wrapper with HTML
// item fragments), not wp-json REST.
//
// Endpoint: POST /wp-admin/admin-ajax.php
//   action=load_more_shows&posts_per_page=N&load_more_shows=6&categorytermid=5
// Response: { status, htmldata, hideButton }
// Each item has: singer-name, date "DD.MM.YYYY", door time "פתיחת דלתות", url /event/{id}/{showId}/.
// categorytermid=5 is the Yehud location term (Tel Aviv and Modiin use other terms).

import { fetchPostJson, fetchText } from '../http.js';
import { noopProgress } from '../progress.js';

const ORIGIN = 'https://grayclub.co.il';
const YEHUD_PATH = '/gray-%d7%99%d7%94%d7%95%d7%93/';
const YEHUD_URL = `${ORIGIN}${YEHUD_PATH}`;
const AJAX_URL = `${ORIGIN}/wp-admin/admin-ajax.php`;
const CATEGORY_TERM_ID = '5';
const INITIAL_PER_PAGE = 12;
const LOAD_MORE = 6;

export const meta = {
  id: 'grayyehud',
  name: 'Gray Club (Yehud)',
  currency: '₪',
};

const ITEM_RE =
  /<a\s+href="([^"]+)"\s+class="divImg"[^>]*>[\s\S]*?<(?:h3|div)\s+class="singer-name">\s*([\s\S]*?)\s*<\/(?:h3|div)>[\s\S]*?<div\s+class="date-time">[\s\S]*?(\d{2}\.\d{2}\.\d{4})[\s\S]*?<p><b>פתיחת דלתות:<\/b>\s*(\d{2}:\d{2})/g;

/**
 * Fetch and normalize all upcoming Gray Club Yehud events.
 * @returns {Promise<Array<{site:string,name:string,date:string,time:string,priceText:string,url:string}>>}
 */
export async function fetchEvents(progress = noopProgress) {
  const apiHeaders = { Referer: YEHUD_URL, Origin: ORIGIN };

  progress.log(`GET ${YEHUD_PATH}`);
  const pageHtml = await fetchText(YEHUD_URL, apiHeaders);

  const seen = new Set();
  const events = [];

  for (const event of parseItemsHtml(pageHtml)) {
    addUnique(events, seen, event);
  }
  progress.log(`  ${events.length} events (initial)`);

  let postsPerPage = INITIAL_PER_PAGE;
  while (true) {
    progress.log(`POST load_more_shows offset=${postsPerPage}`);
    const data = await fetchPostJson(
      AJAX_URL,
      {
        action: 'load_more_shows',
        posts_per_page: String(postsPerPage),
        load_more_shows: String(LOAD_MORE),
        categorytermid: CATEGORY_TERM_ID,
      },
      apiHeaders,
    );

    const batch = parseItemsHtml(String(data.htmldata ?? ''));
    progress.log(`  +${batch.length} events`);

    for (const event of batch) {
      addUnique(events, seen, event);
    }

    if (batch.length === 0 || data.hideButton) break;
    postsPerPage += LOAD_MORE;
  }

  progress.log(`parsed ${events.length} events`);
  return events;
}

function parseItemsHtml(html) {
  const events = [];
  for (const m of html.matchAll(ITEM_RE)) {
    const [, url, name, dateText, time] = m;
    const date = parseDateText(dateText);
    if (!date) continue;

    events.push({
      site: meta.name,
      name: decodeHtml(name).trim(),
      date,
      time: time.trim(),
      priceText: 'N/A',
      url: url.trim(),
    });
  }
  return events;
}

function parseDateText(text) {
  const m = /(\d{2})\.(\d{2})\.(\d{4})/.exec(String(text ?? '').trim());
  if (!m) return '';
  return `${m[3]}-${m[2]}-${m[1]}`;
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
    .replace(/&#8211;/g, '–');
}
