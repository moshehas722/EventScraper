// Site scraper for teder.fm (Teder, Tel Aviv).
//
// Teder is a custom PHP SPA. wp-json and /api/* discovery found no events API.
// The homepage loads the אירועים section via POST with only_content=1 (same as
// the in-browser pgnFetch). Radio/archive listings link to /shows/ or use
// category-archive — we keep only ticketed events (data-pgn-type="events",
// /events/{id}).
//
// Endpoint: POST /home?only_content=1&update={ts}
// Each card: title, date (DD.MM.YY), time (HH:mm), venue class, url.

import { noopProgress } from '../progress.js';

const ORIGIN = 'https://www.teder.fm';
const HOME_URL = `${ORIGIN}/home`;

const EVENT_RE =
  /<a class="link pgn-link" href="(https:\/\/www\.teder\.fm\/events\/\d+)"[^>]*data-pgn-type="events"[^>]*>([\s\S]*?)<\/a>/gi;

export const meta = {
  id: 'teder',
  name: 'Teder (Tel Aviv)',
  currency: '₪',
};

/**
 * Fetch and normalize all upcoming Teder ticketed events.
 * @returns {Promise<Array<{site:string,name:string,date:string,time:string,priceText:string,url:string}>>}
 */
export async function fetchEvents(progress = noopProgress) {
  progress.log('POST /home?only_content=1');
  const html = await fetchHomeContent();

  const today = todayIso();
  const events = [];
  const seen = new Set();

  for (const m of html.matchAll(EVENT_RE)) {
    const url = m[1];
    if (seen.has(url)) continue;
    seen.add(url);

    const block = m[0];
    const name = decodeHtml(block.match(/class="txt title">([^<]+)/)?.[1] ?? '').trim();
    const date = ddMmYyToIso(block.match(/class="datetime-item item-date">([^<]+)/)?.[1] ?? '');
    const time = String(block.match(/class="datetime-item item-time">([^<]+)/)?.[1] ?? '').trim();
    if (!name || !date || date < today) continue;

    events.push({
      site: meta.name,
      name,
      date,
      time,
      priceText: 'N/A',
      url,
    });
  }

  progress.log(`parsed ${events.length} events`);
  return events;
}

async function fetchHomeContent() {
  const url = `${HOME_URL}?only_content=1&update=${Date.now()}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
        '(KHTML, like Gecko) Chrome/126.0 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9,he;q=0.8',
      Referer: `${ORIGIN}/home`,
      Origin: ORIGIN,
    },
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok) {
    throw new Error(`POST ${url} -> HTTP ${res.status} ${res.statusText}`);
  }

  return res.text();
}

// "13.08.26" -> "2026-08-13"
function ddMmYyToIso(text) {
  const m = /^(\d{2})\.(\d{2})\.(\d{2})$/.exec(String(text ?? '').trim());
  return m ? `20${m[3]}-${m[2]}-${m[1]}` : '';
}

function decodeHtml(str) {
  return String(str ?? '')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function todayIso() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
