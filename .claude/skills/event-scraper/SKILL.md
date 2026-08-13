---
name: event-scraper
description: >-
  Add venue scrapers to EventScraper by discovering backend JSON/REST APIs
  (not HTML parsing). Use when adding a new venue site, scraping event or
  ticketing websites, probing wp-json or custom APIs, or implementing
  fetchEvents modules for this repo.
---

# EventScraper — add a venue

## Goal

Add a site module that calls the venue's **backend data API** and normalizes
results into the common event shape. Do not use headless browsers or HTML
parsing unless every REST path is exhausted.

## Workflow

Copy this checklist and track progress:

```
- [ ] 1. Discover API endpoint(s)
- [ ] 2. Probe response shape (dates, prices, URLs)
- [ ] 3. Create src/sites/<id>.js
- [ ] 4. Register in src/registry.js SITES array
- [ ] 5. Update README supported venues table
- [ ] 6. Verify: node src/index.js <today> and node src/index.js --all --quiet
- [ ] 7. Delete `scraper-temp/` contents (or the whole folder) when done
```

## Step 1 — Discover the API

1. Fetch the venue homepage HTML (use `curl.exe` on Windows, not bare `curl`).
2. Search for API hints:
   - `wp-json`, `/api/`, `fetch(`, `.json`, custom namespaces (`hm2/v1`, `tickera-public`)
   - `<link rel="https://api.w.org/">` → try `{origin}/wp-json/`
3. Create `scraper-temp/` if needed. Write all discovery artifacts there —
   probe scripts (`scraper-temp/probe-*.mjs`), downloaded HTML, etc. Use
   `fetchJson` from `src/http.js` in probe scripts (always pass `Referer` +
   `Origin`).
4. List routes: `GET {origin}/wp-json/` → inspect `routes` keys.

**Prefer** a single endpoint that returns all upcoming events with name, datetime,
price, and URL. **Avoid** downloading entire product catalogs when search/per-event
lookup works.

See [reference.md](reference.md) for patterns seen in Barby, Ozen, and Hameretz 2.

## Step 2 — Normalize to common shape

Every `fetchEvents()` must return:

```js
{ site, name, date, time, priceText, url }
```

| Field | Rule |
|-------|------|
| `site` | `meta.name` (e.g. `"Barby (Tel Aviv)"`) |
| `name` | Plain text; strip HTML entities |
| `date` | `YYYY-MM-DD` |
| `time` | `HH:mm` (24h) |
| `priceText` | `₪NNN`, `from ₪NNN`, or `N/A` |
| `url` | Direct link to event/tickets page |

**Dates:** normalize whatever the API sends (`DD/MM/YYYY`, ISO `2026-08-12T21:30`,
etc.) to ISO date + time. For ambiguous ISO with `Z`, prefer extracting the
literal `YYYY-MM-DD` and `HH:mm` prefix if that matches what the site displays.

**Prices:**
- Single tier → `₪145`
- Multiple in-stock tiers → `from ₪125` (lowest available)
- External ticketing / sold out / unknown → `N/A`

## Step 3 — Site module template

Create `src/sites/<id>.js`:

```js
// Site scraper for example.com (Venue Name).
//
// Endpoint: GET https://example.com/api/events
// Fields: ...

import { fetchJson } from '../http.js';
import { noopProgress } from '../progress.js';

const ORIGIN = 'https://example.com';
const API_URL = `${ORIGIN}/api/events`;

export const meta = {
  id: 'example',
  name: 'Venue Name (City)',
  currency: '₪',
};

export async function fetchEvents(progress = noopProgress) {
  progress.log('GET /api/events');
  const data = await fetchJson(API_URL, {
    Referer: `${ORIGIN}/`,
    Origin: ORIGIN,
  });

  const events = /* extract array from response */;
  progress.log(`parsed ${events.length} events`);

  return events.map((e) => ({
    site: meta.name,
    name: String(e.title ?? '').trim(),
    date: /* YYYY-MM-DD */,
    time: /* HH:mm */,
    priceText: /* ₪… | from ₪… | N/A */,
    url: e.url ?? ORIGIN,
  }));
}
```

Conventions:
- Import `fetchJson` from `../http.js` (browser-like headers for Cloudflare).
- Accept `progress = noopProgress`; log each HTTP step via `progress.log()`.
- Keep venue-specific helpers private in the same file.
- Match comment/doc style of existing modules (`barby.js`, `ozen.js`, `hameretz2.js`).

## Step 4 — Register

In `src/registry.js`:

```js
import * as example from './sites/example.js';
const SITES = [barby, ozen, hameretz2, levontin7, example];
```

Orchestration (concurrent fetch, progress, failure isolation) is already handled
by `fetchAllSites()` in `src/progress.js` — do not duplicate it in site modules.

## Step 5 — Verify

```bash
node src/index.js                  # today
node src/index.js 2026-08-12       # specific day
node src/index.js --all --quiet    # full merge, no progress noise
node src/index.js --all --json     # stdout JSON only; progress on stderr
```

Confirm: event count is plausible, names/dates/times match the live site, prices
look right, URLs open the correct event page.

## Anti-patterns

- Parsing rendered HTML when a JSON API exists
- Bulk-fetching thousands of WooCommerce products when `?search=` per event works
- Hardcoding page caps that truncate data OR removing caps without stopping early
- Putting progress orchestration inside site modules (use `progress.log` only)
- Leaving probe scripts, downloaded HTML, or other temp files in the repo root
  — use `scraper-temp/` only, and delete its contents when done

## Additional resources

- Venue-specific API notes and discovery commands: [reference.md](reference.md)
