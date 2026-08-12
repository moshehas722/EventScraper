// Site scraper for barby.co.il (Barby, Tel Aviv).
//
// The site is a React SPA; its homepage loads all upcoming shows from a JSON
// API. We call that API directly instead of rendering the page.
//
// Endpoint: GET https://barby.co.il/api/shows/find
//   -> { returnShow: { show: [...] }, tierPriceData, dpData }
// Each show has: showName, showDate ("DD/MM/YYYY"), showTime, showPrice,
//   showTierPriceType ("1" = fixed price, "2" = tiered / "from" price), showId.

import { fetchJson } from '../http.js';
import { noopProgress } from '../progress.js';

const API_URL = 'https://barby.co.il/api/shows/find';
const ORIGIN = 'https://barby.co.il';

export const meta = {
  id: 'barby',
  name: 'Barby (Tel Aviv)',
  currency: '₪',
};

/**
 * Fetch and normalize all upcoming Barby events.
 * @returns {Promise<Array<{site:string,name:string,date:string,time:string,priceText:string,url:string}>>}
 *   date is normalized to ISO YYYY-MM-DD.
 */
export async function fetchEvents(progress = noopProgress) {
  progress.log('GET /api/shows/find');
  const data = await fetchJson(API_URL, {
    Referer: `${ORIGIN}/`,
    Origin: ORIGIN,
  });

  const shows = data?.returnShow?.show ?? [];
  progress.log(`parsed ${shows.length} shows`);
  return shows.map((s) => {
    const tiered = String(s.showTierPriceType) === '2';
    const price = s.showPrice ? `${meta.currency}${s.showPrice}` : 'N/A';
    return {
      site: meta.name,
      name: stripHtml(s.showName).trim(),
      date: toIsoDate(s.showDate),
      time: s.showTime ?? '',
      priceText: tiered && s.showPrice ? `from ${price}` : price,
      url: s.showId ? `${ORIGIN}/show/${s.showId}` : ORIGIN,
    };
  });
}

// "DD/MM/YYYY" -> "YYYY-MM-DD" (returns original on unexpected input).
function toIsoDate(d) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(d ?? '').trim());
  return m ? `${m[3]}-${m[2]}-${m[1]}` : String(d ?? '');
}

function stripHtml(str) {
  return String(str ?? '').replace(/<[^>]*>/g, '');
}
