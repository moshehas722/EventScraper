// Registered venue scrapers — shared by CLI and web API.

import * as barby from './sites/barby.js';
import * as ozen from './sites/ozen.js';
import * as hameretz2 from './sites/hameretz2.js';
import * as levontin7 from './sites/levontin7.js';
import * as haezor from './sites/haezor.js';
import * as babebar from './sites/babebar.js';
import * as papaito from './sites/papaito.js';
import * as shablul from './sites/shablul.js';
import * as grayyehud from './sites/grayyehud.js';
import * as teder from './sites/teder.js';
import * as zappa from './sites/zappa.js';
import * as greenbear from './sites/greenbear.js';

export const SITES = [barby, ozen, hameretz2, levontin7, haezor, babebar, papaito, shablul, grayyehud, teder, zappa, greenbear];

/**
 * Fetch events from all venues, optionally filtered by date.
 * @param {{ date?: string, all?: boolean, quiet?: boolean }} opts
 * @returns {Promise<Array<{ site: string, name: string, date: string, time: string, priceText: string, url: string }>>}
 */
export async function scrapeEvents({ date, all = false, quiet = true } = {}) {
  const { fetchAllSites, setProgressQuiet } = await import('./progress.js');
  setProgressQuiet(quiet);

  let events = await fetchAllSites(SITES);

  if (!all && date) {
    events = events.filter((e) => e.date === date);
  }

  events.sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time));
  return events;
}

export function todayIso() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
