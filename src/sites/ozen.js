// Site scraper for ozentelaviv.com (Ozen Tel Aviv).
//
// WordPress + Tickera + WooCommerce. Events come from Tickera's public REST
// API; on-site ticket prices come from the WooCommerce Store API. Events sold
// through go-out.co (linked in the event content) report price as N/A.
//
// Endpoints:
//   GET /wp-json/tickera-public/v1/events
//   GET /wp-json/wp/v2/tc_events?per_page=100
//   GET /wp-json/wc/store/v1/products?search=<term>&per_page=100

import { fetchJson } from '../http.js';
import { noopProgress } from '../progress.js';

const ORIGIN = 'https://ozentelaviv.com';
const EVENTS_URL = `${ORIGIN}/wp-json/tickera-public/v1/events`;
const WP_EVENTS_URL = `${ORIGIN}/wp-json/wp/v2/tc_events?per_page=100&_fields=id,slug,link,content`;
const PRODUCTS_URL = `${ORIGIN}/wp-json/wc/store/v1/products?per_page=100`;

export const meta = {
  id: 'ozen',
  name: 'Ozen (Tel Aviv)',
  currency: '₪',
};

/**
 * Fetch and normalize all upcoming Ozen events.
 * @returns {Promise<Array<{site:string,name:string,date:string,time:string,priceText:string,url:string}>>}
 */
export async function fetchEvents(progress = noopProgress) {
  const apiHeaders = { Referer: `${ORIGIN}/`, Origin: ORIGIN };
  progress.log('GET tickera-public/v1/events + wp/v2/tc_events');
  const [events, wpEvents] = await Promise.all([
    fetchJson(EVENTS_URL, apiHeaders),
    fetchJson(WP_EVENTS_URL, apiHeaders),
  ]);

  const wpById = Object.fromEntries(wpEvents.map((e) => [e.id, e]));
  const productCache = new Map();

  const onsite = events.filter((ev) => {
    const wp = wpById[ev.id];
    return wp && !/go-out\.co/i.test(wp.content?.rendered ?? '');
  });
  progress.log(`pricing ${onsite.length} on-site events`);

  const pricesById = new Map(
    await Promise.all(
      onsite.map(async (ev) => {
        const wp = wpById[ev.id];
        const products = await productsForEvent(ev, wp, apiHeaders, productCache, progress);
        return [ev.id, priceFromProducts(ev, wp, products)];
      }),
    ),
  );

  let priced = 0;
  const normalized = events.map((ev) => {
    const wp = wpById[ev.id];
    const { date, time } = splitDateTime(ev.date);
    const external = /go-out\.co/i.test(wp?.content?.rendered ?? '');
    const priceText = external ? 'N/A' : (pricesById.get(ev.id) ?? 'N/A');
    if (priceText !== 'N/A') priced++;

    return {
      site: meta.name,
      name: decodeHtml(ev.title).trim(),
      date,
      time,
      priceText,
      url: wp?.link ?? ORIGIN,
    };
  });

  progress.log(`loaded ${events.length} events (${priced} with on-site prices)`);
  return normalized;
}

async function productsForEvent(event, wpEvent, headers, cache, progress) {
  const cacheKey = wpEvent.slug;
  if (cache.has(cacheKey)) return cache.get(cacheKey);

  progress.log(`search products: ${wpEvent.slug}`);
  const slugResults = await fetchJson(
    `${PRODUCTS_URL}&search=${encodeURIComponent(wpEvent.slug)}`,
    headers,
  );

  let products = slugResults;
  if (!findTicketProducts(event, wpEvent, slugResults).length) {
    const title = decodeHtml(event.title).slice(0, 50);
    progress.log(`search products by title: ${title.slice(0, 40)}`);
    products = await fetchJson(`${PRODUCTS_URL}&search=${encodeURIComponent(title)}`, headers);
  }

  cache.set(cacheKey, products);
  return products;
}

function priceFromProducts(event, wpEvent, products) {
  if (!wpEvent) return 'N/A';

  const matched = findTicketProducts(event, wpEvent, products);
  const prices = matched.map(productPrice).filter((p) => p > 0);
  if (prices.length === 0) return 'N/A';

  const min = Math.min(...prices);
  const amount = `${meta.currency}${formatPrice(min)}`;
  return prices.length > 1 ? `from ${amount}` : amount;
}

function findTicketProducts(event, wpEvent, products) {
  const slug = wpEvent.slug;
  const title = norm(event.title);

  const bySlug = products.filter((p) => productSlugMatchesEvent(p.slug, slug));
  const byName = products.filter((p) => norm(p.name) === title);
  const candidates = bySlug.length ? bySlug : byName;

  return candidates.filter((p) => p.is_purchasable && p.is_in_stock);
}

function productSlugMatchesEvent(productSlug, eventSlug) {
  const decoded = decodeURIComponent(productSlug).toLowerCase();
  const slug = eventSlug.toLowerCase();
  return decoded.includes(slug);
}

function productPrice(product) {
  const minor = product.prices.currency_minor_unit ?? 2;
  return Number(product.prices.price) / 10 ** minor;
}

// "2026-08-12 20:30" -> { date: "2026-08-12", time: "20:30" }
function splitDateTime(value) {
  const m = /^(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2})/.exec(String(value ?? '').trim());
  return m ? { date: m[1], time: m[2] } : { date: String(value ?? ''), time: '' };
}

function formatPrice(n) {
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/\.?0+$/, '');
}

function decodeHtml(str) {
  return String(str ?? '')
    .replace(/&#8211;/g, '–')
    .replace(/&#038;/g, '&')
    .replace(/&#039;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"');
}

function norm(str) {
  return decodeHtml(str)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
