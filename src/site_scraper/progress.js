// Shared progress reporting and site-fetch orchestration.
// Messages go to stderr so stdout stays clean for tables and --json.

/** @typedef {{ log: (message: string) => void }} Progress */
/** @typedef {{ meta: { name: string, origin?: string, location?: string }, fetchEvents: (progress?: Progress) => Promise<Array<object>> }} SiteModule */

export const noopProgress = { log() {} };

let quiet = false;

/** @param {boolean} value */
export function setProgressQuiet(value) {
  quiet = value;
}

/**
 * Create a progress reporter scoped to one venue.
 * @param {string} siteName
 * @returns {Progress}
 */
export function createProgress(siteName) {
  return {
    log(message) {
      if (!quiet) console.error(`${siteName}: ${message}`);
    },
  };
}

/**
 * Fetch events from every registered site concurrently.
 * A single site failing does not prevent the others from returning.
 * @param {SiteModule[]} sites
 * @returns {Promise<Array<object>>}
 */
export async function fetchAllSites(sites) {
  if (!quiet) {
    console.error(`Fetching ${sites.length} venue${sites.length === 1 ? '' : 's'}…`);
  }

  const results = await Promise.allSettled(sites.map((site) => fetchSite(site)));
  const events = [];
  results.forEach((result, i) => {
    if (result.status === 'fulfilled') events.push(...result.value);
    else console.error(`! ${sites[i].meta.name} failed: ${result.reason.message}`);
  });
  return events;
}

/**
 * @param {SiteModule} site
 */
async function fetchSite(site) {
  const progress = createProgress(site.meta.name);
  progress.log('starting');
  const events = await site.fetchEvents(progress);
  progress.log(`done (${events.length} events)`);
  const origin = site.meta.origin ?? null;
  const location = site.meta.location ?? null;
  // Attach venue-wide defaults from meta. A per-event value set by the scraper
  // (e.g. Zappa/Muzi, whose venue varies per event) is preserved and wins.
  return events.map((e) => ({
    ...e,
    siteOrigin: e.siteOrigin ?? origin,
    siteLocation: e.siteLocation ?? location,
  }));
}
