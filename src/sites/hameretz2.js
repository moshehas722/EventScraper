// Site scraper for hameretz2.org (Hameretz 2, Tel Aviv).
//
// The site loads its schedule from a custom WordPress REST API. One call returns
// every upcoming event with name, start time, ticket tiers, and buy link.
//
// Endpoint: GET https://hameretz2.org/wp-json/hm2/v1/events
// Each event has: name, start ("YYYY-MM-DDTHH:mm"), price, ticket_types[],
//   ticket_sale_link, link_slug, status.

import { fetchJson } from '../http.js';
import { noopProgress } from '../progress.js';

const ORIGIN = 'https://hameretz2.org';
const API_URL = `${ORIGIN}/wp-json/hm2/v1/events`;

export const meta = {
  id: 'hameretz2',
  name: 'Hameretz 2 (Tel Aviv)',
  currency: '₪',
};

/**
 * Fetch and normalize all upcoming Hameretz 2 events.
 * @returns {Promise<Array<{site:string,name:string,date:string,time:string,priceText:string,url:string}>>}
 */
export async function fetchEvents(progress = noopProgress) {
  progress.log('GET /wp-json/hm2/v1/events');
  const events = await fetchJson(API_URL, {
    Referer: `${ORIGIN}/`,
    Origin: ORIGIN,
  });

  const upcoming = events.filter((e) => e.status === 'upcoming' || e.status === 'in_progress');
  progress.log(`parsed ${upcoming.length} events`);

  return upcoming.map((e) => {
    const { date, time } = splitStart(e.start);
    return {
      site: meta.name,
      name: String(e.name ?? '').trim(),
      date,
      time,
      priceText: formatPrice(e),
      url: eventUrl(e),
    };
  });
}

function formatPrice(event) {
  const tiers = (event.ticket_types ?? []).filter(
    (t) => t.in_stock && !t.closed && Number(t.price) > 0,
  );
  const prices =
    tiers.length > 0
      ? tiers.map((t) => Number(t.price))
      : Number(event.price) > 0
        ? [Number(event.price)]
        : [];

  if (prices.length === 0) return 'N/A';

  const min = Math.min(...prices);
  const amount = `${meta.currency}${min}`;
  return prices.length > 1 ? `from ${amount}` : amount;
}

function eventUrl(event) {
  const link = String(event.ticket_sale_link ?? '').trim();
  if (link) return link;

  const slug = String(event.link_slug ?? event.event_slug ?? event.slug ?? '').trim();
  return slug ? `${ORIGIN}/e/${slug}/` : ORIGIN;
}

// "2026-11-11T21:30" or "2026-10-24T21:30:00.000Z" -> { date, time }
function splitStart(value) {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(String(value ?? '').trim());
  return m ? { date: m[1], time: m[2] } : { date: '', time: '' };
}
