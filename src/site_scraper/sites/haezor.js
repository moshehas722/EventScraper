// Site scraper for haezor.com (HaZor / מועדון האזור, Tel Aviv).
//
// WordPress with a custom "events" post type that is not exposed via wp-json.
// REST discovery (wp-json routes, wp/v2/events, admin-ajax) found no event API.
// The Hebrew schedule page is server-rendered HTML with all upcoming events.
//
// Source: GET /%d7%9c%d7%95%d7%97-%d7%94%d7%95%d7%a4%d7%a2%d7%95%d7%aa/ (לוח הופעות)
// Each .clsItem has: clsDate (Hebrew "DD בmonth"), clsTime, clsPrice, title link.

import { fetchText } from '../http.js';
import { noopProgress } from '../progress.js';

const ORIGIN = 'https://haezor.com';
const SCHEDULE_URL = `${ORIGIN}/%d7%9c%d7%95%d7%97-%d7%94%d7%95%d7%a4%d7%a2%d7%95%d7%aa/`;

export const meta = {
  id: 'haezor',
  name: 'HaZor (Tel Aviv)',
  location: 'HaZor, Tel Aviv',
  currency: '₪',
  origin: ORIGIN,
};

const HEBREW_MONTHS = {
  ינואר: 1,
  פברואר: 2,
  מרץ: 3,
  אפריל: 4,
  מאי: 5,
  יוני: 6,
  יולי: 7,
  אוגוסט: 8,
  ספטמבר: 9,
  אוקטובר: 10,
  נובמבר: 11,
  דצמבר: 12,
};

const ITEM_RE =
  /<div class="clsItem" onclick="location\.href='([^']+)'">[\s\S]*?<div class="clsDate">([^<]+)<\/div>[\s\S]*?<h2>(?:<a[^>]*>)?([^<]+)(?:<\/a>)?<\/h2>[\s\S]*?<div class="clsTime">([^<]+)<\/div>[\s\S]*?<div class="clsPrice">([^<]+)<\/div>/g;

/**
 * Fetch and normalize all upcoming HaZor events.
 * @returns {Promise<Array<{site:string,name:string,date:string,time:string,priceText:string,url:string}>>}
 */
export async function fetchEvents(progress = noopProgress) {
  progress.log('GET לוח הופעות (schedule HTML)');
  const html = await fetchText(
    SCHEDULE_URL,
    { Referer: `${ORIGIN}/`, Origin: ORIGIN },
    { insecureTls: true },
  );

  const events = [];
  for (const m of html.matchAll(ITEM_RE)) {
    const [, url, dateText, name, time, priceRaw] = m;
    const date = hebrewDateToIso(dateText);
    if (!date) continue;

    events.push({
      site: meta.name,
      name: decodeHtml(name).trim(),
      date,
      time: time.trim(),
      priceText: normalizePrice(priceRaw),
      url,
    });
  }

  progress.log(`parsed ${events.length} events`);
  return events;
}

// "12 באוגוסט יום רביעי" -> "2026-08-12" (year inferred from today).
function hebrewDateToIso(dateText) {
  const m = /^(\d{1,2})\s+ב(\S+)/.exec(String(dateText ?? '').trim());
  if (!m) return '';

  const day = Number(m[1]);
  const month = HEBREW_MONTHS[m[2]];
  if (!month || day < 1 || day > 31) return '';

  const today = new Date();
  let year = today.getFullYear();
  const candidate = new Date(year, month - 1, day);
  const todayStart = new Date(year, today.getMonth(), today.getDate());
  if (candidate < todayStart) year += 1;

  const p = (n) => String(n).padStart(2, '0');
  return `${year}-${p(month)}-${p(day)}`;
}

// "80/90 ש\"ח" -> "from ₪80"; "50/70 מגיל 18" -> "from ₪50"; single tier -> "₪NNN"
function normalizePrice(raw) {
  const text = String(raw ?? '').trim();
  const pricePart = text.split(/מגיל|ש["״]ח/i)[0].trim();
  const nums = [...pricePart.matchAll(/\d+/g)].map((m) => Number(m[0])).filter((n) => n > 0);
  if (nums.length === 0) return 'N/A';

  const min = Math.min(...nums);
  const amount = `${meta.currency}${min}`;
  return nums.length > 1 ? `from ${amount}` : amount;
}

function decodeHtml(str) {
  return String(str ?? '')
    .replace(/&#8211;/g, '–')
    .replace(/&#038;/g, '&')
    .replace(/&#039;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"');
}
