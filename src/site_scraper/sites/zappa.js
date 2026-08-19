// Site scraper for zappa-club.co.il (Zappa Club, multiple locations).
//
// Zappa runs on the Eventim Israel platform. Upcoming performances are listed
// via Eventim's public websearch API (same backend as the site's SERP widget).
//
// Endpoint: GET https://public-api.eventim.com/websearch/search/api/exploration/v1/products
//   ?webId=web__eventim-co-il&language=he&retail_partner=ZPE&search_term=זאפה&sort=DateAsc&top=50&page=N
// Each product has: name, price, productId, link/url.path,
//   typeAttributes.liveEntertainment.startDate (ISO +03:00), location.name (venue).
// Results are filtered to Zappa venues and deduped by productId.

import { fetchJson } from '../http.js';
import { noopProgress } from '../progress.js';

const ORIGIN = 'https://www.zappa-club.co.il';
const API_URL =
  'https://public-api.eventim.com/websearch/search/api/exploration/v1/products';
const WEB_ID = 'web__eventim-co-il';
const RETAIL_PARTNER = 'ZPE';
const SEARCH_TERM = 'זאפה';
const PAGE_SIZE = 50;
const ZAPPA_VENUE_RE = /זאפה|Zappa|אמפי עומר/i;

const VENUE_LABELS = {
  'זאפה חיפה': 'Haifa',
  'זאפה תל אביב - מתחם מידטאון': 'Tel Aviv',
  'זאפה אמפי שוני': 'Amphi Shuni',
  'זאפה ירושלים': 'Jerusalem',
  'זאפה הרצליה': 'Herzliya',
};

export const meta = {
  id: 'zappa',
  name: 'Zappa Club',
  currency: '₪',
  origin: ORIGIN,
};

/**
 * Fetch and normalize all upcoming Zappa Club events across locations.
 * @returns {Promise<Array<{site:string,name:string,date:string,time:string,priceText:string,url:string}>>}
 */
export async function fetchEvents(progress = noopProgress) {
  const apiHeaders = { Referer: `${ORIGIN}/`, Origin: ORIGIN };
  const tls = { insecureTls: true };
  const today = todayIso();
  const seen = new Set();
  const events = [];

  progress.log('GET eventim exploration/v1/products (search_term=זאפה)');
  const first = await fetchProductPage(1, apiHeaders, tls);
  const totalPages = Number(first.totalPages) || 1;
  progress.log(`  ${first.totalResults ?? '?'} results, ${totalPages} page(s)`);

  for (let page = 1; page <= totalPages; page++) {
    const data = page === 1 ? first : await fetchProductPage(page, apiHeaders, tls);
    for (const product of data.products ?? []) {
      const live = product.typeAttributes?.liveEntertainment;
      const venue = live?.location?.name ?? '';
      if (!ZAPPA_VENUE_RE.test(venue)) continue;

      const productId = String(product.productId ?? '');
      if (!productId || seen.has(productId)) continue;
      seen.add(productId);

      const { date, time } = splitStartDate(live?.startDate);
      if (!date || date < today) continue;

      events.push({
        site: formatSite(venue),
        name: String(product.name ?? '').trim(),
        date,
        time,
        priceText: formatPrice(product),
        url: toZappaUrl(product),
      });
    }
  }

  progress.log(`parsed ${events.length} events`);
  return events;
}

async function fetchProductPage(page, headers, tls) {
  const params = new URLSearchParams({
    webId: WEB_ID,
    language: 'he',
    page: String(page),
    retail_partner: RETAIL_PARTNER,
    search_term: SEARCH_TERM,
    sort: 'DateAsc',
    top: String(PAGE_SIZE),
  });
  return fetchJson(`${API_URL}?${params}`, headers, tls);
}

function formatSite(venue) {
  const trimmed = venue.replace(/^זאפה\s*/, '').trim();
  const label = VENUE_LABELS[venue] ?? (trimmed || venue);
  return `${meta.name} (${label})`;
}

function splitStartDate(startDate) {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(String(startDate ?? '').trim());
  return m ? { date: m[1], time: m[2] } : { date: '', time: '' };
}

function formatPrice(product) {
  const price = Number(product.price);
  if (Number.isFinite(price) && price > 0) return `${meta.currency}${price}`;
  return 'N/A';
}

function toZappaUrl(product) {
  const raw =
    product.link ??
    (product.url?.path ? `${product.url.domain ?? ''}${product.url.path}` : '');
  try {
    const pathname = new URL(String(raw)).pathname;
    return `${ORIGIN}${pathname}`;
  } catch {
    return product.productId ? `${ORIGIN}/event/${product.productId}/` : ORIGIN;
  }
}

function todayIso() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
