// Site scraper for bar-giyora.co.il (Bar Giyora / בר גיורא, Tel Aviv).
//
// WordPress + WooCommerce + custom bargyora theme. Upcoming shows are WooCommerce
// products listed on the homepage (first 9) with admin-ajax load-more for the rest.
//
// Endpoint: POST /wp-admin/admin-ajax.php
//   action=bargyora_products_filter&post_ids[]={seen}&posts_per_page=9&nonce=…
// Response: { html, count }
// Each product card: name/link, Hebrew date "יום …, DD.MM.YYYY", door time.
// Prices: GET /wp-json/wc/store/v1/products?include={ids} (batch by product id).

import { fetchJson, fetchPostJson, fetchText } from '../http.js';
import { noopProgress } from '../progress.js';

const ORIGIN = 'https://bar-giyora.co.il';
const HOME_URL = `${ORIGIN}/`;
const AJAX_URL = `${ORIGIN}/wp-admin/admin-ajax.php`;
const PRODUCTS_URL = `${ORIGIN}/wp-json/wc/store/v1/products`;
const TLS = { insecureTls: true };

const ITEM_RE =
  /<div class="col-4 product[^"]*" data-post="(\d+)">[\s\S]*?<div class="performance-con">\s*<h5><a href="([^"]+)">([\s\S]*?)<\/a><\/h5>[\s\S]*?<span class="date">[^,]*,\s*(\d{2}\.\d{2}\.\d{4})<\/span>\s*<span class="time">פתיחת דלתות:\s*(\d{2}:\d{2})/g;

export const meta = {
  id: 'bargiyora',
  name: 'Bar Giyora (Tel Aviv)',
  currency: '₪',
  origin: ORIGIN,
};

/**
 * Fetch and normalize all upcoming Bar Giyora events.
 * @returns {Promise<Array<{site:string,name:string,date:string,time:string,priceText:string,url:string}>>}
 */
export async function fetchEvents(progress = noopProgress) {
  const apiHeaders = { Referer: HOME_URL, Origin: ORIGIN };

  progress.log('GET /');
  const pageHtml = await fetchText(HOME_URL, apiHeaders, TLS);

  const nonce = pageHtml.match(/data-nonce="([^"]+)"/)?.[1] ?? '';
  const postsPerPage = pageHtml.match(/data-posts_per_page="(\d+)"/)?.[1] ?? '9';
  const total = Number(pageHtml.match(/data-total="(\d+)"/)?.[1] ?? '0');
  const term = pageHtml.match(/data-term="([^"]*)"/)?.[1] ?? '';

  const seen = new Set();
  const events = [];

  for (const event of parseItemsHtml(pageHtml)) {
    addUnique(events, seen, event);
  }
  progress.log(`  ${events.length} events (initial)`);

  const postIds = events.map((e) => e.id);
  while (postIds.length < total) {
    progress.log(`POST bargyora_products_filter offset=${postIds.length}`);
    const data = await fetchPostJson(
      AJAX_URL,
      buildFilterBody({
        post_ids: postIds,
        posts_per_page: postsPerPage,
        term,
        nonce,
      }),
      apiHeaders,
      TLS,
    );

    const batch = parseItemsHtml(String(data.html ?? ''));
    progress.log(`  +${batch.length} events`);

    if (batch.length === 0) break;

    for (const event of batch) {
      if (addUnique(events, seen, event)) postIds.push(event.id);
    }

    if (batch.length < Number(postsPerPage)) break;
  }

  progress.log(`pricing ${events.length} products`);
  const pricesById = await fetchPricesById(
    events.map((e) => e.id),
    apiHeaders,
    progress,
  );

  const normalized = events.map((event) => ({
    site: meta.name,
    name: event.name,
    date: event.date,
    time: event.time,
    priceText: pricesById.get(event.id) ?? 'N/A',
    url: event.url,
  }));

  progress.log(`parsed ${normalized.length} events`);
  return normalized;
}

function parseItemsHtml(html) {
  const events = [];
  for (const m of html.matchAll(ITEM_RE)) {
    const [, id, url, name, dateText, time] = m;
    const date = parseDateText(dateText);
    if (!date) continue;

    events.push({
      id,
      name: decodeHtml(name).trim(),
      date,
      time: time.trim(),
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

function buildFilterBody({ post_ids, posts_per_page, term, nonce }) {
  const parts = [
    'action=bargyora_products_filter',
    `posts_per_page=${encodeURIComponent(posts_per_page)}`,
    `term=${encodeURIComponent(term ?? '')}`,
    'selected_term=',
    'date=',
    'search_keyword=',
    `nonce=${encodeURIComponent(nonce ?? '')}`,
  ];
  for (const id of post_ids) parts.push(`post_ids[]=${encodeURIComponent(id)}`);
  return parts.join('&');
}

async function fetchPricesById(ids, headers, progress) {
  const prices = new Map();
  const unique = [...new Set(ids)];
  const chunkSize = 20;

  for (let i = 0; i < unique.length; i += chunkSize) {
    const chunk = unique.slice(i, i + chunkSize);
    progress.log(`GET wc/store products include=${chunk.length}`);
    const products = await fetchJson(
      `${PRODUCTS_URL}?include=${chunk.join(',')}&per_page=${chunk.length}`,
      headers,
      TLS,
    );

    for (const product of products) {
      prices.set(String(product.id), priceFromProduct(product));
    }
  }

  return prices;
}

function priceFromProduct(product) {
  const prices = product?.prices;
  if (!prices) return 'N/A';

  const range = prices.price_range;
  if (range?.min_amount != null && range?.max_amount != null) {
    const min = Number(range.min_amount);
    const max = Number(range.max_amount);
    if (Number.isFinite(min) && Number.isFinite(max)) {
      return min === max ? `₪${min}` : `from ₪${min}`;
    }
  }

  const amount = Number(prices.price);
  if (Number.isFinite(amount) && amount > 0) return `₪${amount}`;
  return 'N/A';
}

function addUnique(events, seen, event) {
  const key = `${event.id}|${event.date}|${event.time}`;
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
