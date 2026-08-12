// Site scraper for levontin7.com (Levontin 7, Tel Aviv).
//
// WordPress + fat-event plugin. The full schedule grid loads events via
// admin-ajax (JSON), not wp-json REST.
//
// Endpoint: GET /wp-admin/admin-ajax.php
//   action=fat_event_get_timetable&sc_id=931&view=month&month=M&year=Y
// Each event has: id, title, start_date ("YYYY-MM-DD HH:mm:ss"), url.
// Ticket prices are sold via eventer.co.il (external_link) or on-site Stripe
// without fees in the API — all report as N/A.

import { fetchJson } from '../http.js';
import { noopProgress } from '../progress.js';

const ORIGIN = 'https://levontin7.com';
const AJAX_URL = `${ORIGIN}/wp-admin/admin-ajax.php`;
const SC_ID = '931';
const MONTHS_AHEAD = 6;

export const meta = {
  id: 'levontin7',
  name: 'Levontin 7 (Tel Aviv)',
  currency: '₪',
  origin: ORIGIN,
};

/**
 * Fetch and normalize all upcoming Levontin 7 events.
 * @returns {Promise<Array<{site:string,name:string,date:string,time:string,priceText:string,url:string}>>}
 */
export async function fetchEvents(progress = noopProgress) {
  const apiHeaders = { Referer: `${ORIGIN}/`, Origin: ORIGIN };
  const today = todayIso();
  const seen = new Set();
  const events = [];

  for (let offset = 0; offset < MONTHS_AHEAD; offset++) {
    const d = new Date();
    d.setDate(1);
    d.setMonth(d.getMonth() + offset);
    const month = d.getMonth() + 1;
    const year = d.getFullYear();

    progress.log(`GET fat_event_get_timetable ${year}-${String(month).padStart(2, '0')}`);
    const monthEvents = await fetchTimetable(month, year, apiHeaders);
    progress.log(`  ${monthEvents.length} events`);

    for (const e of monthEvents) {
      if (e.is_day_off) continue;
      const { date, time } = splitStartDate(e.start_date);
      if (!date || date < today) continue;
      const key = e.url ?? `${e.id}-${date}-${time}`;
      if (seen.has(key)) continue;
      seen.add(key);

      events.push({
        site: meta.name,
        name: String(e.title ?? '').trim(),
        date,
        time,
        priceText: 'N/A',
        url: e.url ?? ORIGIN,
      });
    }
  }

  progress.log(`loaded ${events.length} events`);
  return events;
}

async function fetchTimetable(month, year, headers) {
  const params = new URLSearchParams({
    action: 'fat_event_get_timetable',
    sc_id: SC_ID,
    sc_category: '',
    sc_organizer: '',
    month: String(month),
    year: String(year),
    view: 'month',
  });
  const data = await fetchJson(`${AJAX_URL}?${params}`, headers);
  return Array.isArray(data) ? data : [];
}

function splitStartDate(startDate) {
  const m = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2})/.exec(String(startDate ?? '').trim());
  return m ? { date: m[1], time: m[2] } : { date: '', time: '' };
}

function todayIso() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
