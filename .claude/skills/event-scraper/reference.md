# EventScraper — API discovery reference

## Discovery commands

**Windows:** use `curl.exe`, not PowerShell's `curl` alias.

```bash
mkdir scraper-temp 2>nul
curl.exe -s -L "https://example.com/" -H "User-Agent: Mozilla/5.0" -o scraper-temp/page.html
```

Probe script template — save as `scraper-temp/probe-example.mjs` (delete
`scraper-temp/` when done):

```js
import { fetchJson } from '../src/http.js';

const ORIGIN = 'https://example.com';
const headers = { Referer: `${ORIGIN}/`, Origin: ORIGIN };

const data = await fetchJson(`${ORIGIN}/wp-json/`, headers);
console.log(Object.keys(data.routes).filter((r) => /event|show|ticket/i.test(r)));

const events = await fetchJson(`${ORIGIN}/CANDIDATE_ENDPOINT`, headers);
console.log(JSON.stringify(Array.isArray(events) ? events[0] : events, null, 2));
```

## Known venue patterns

### React SPA with dedicated API (Barby)

| | |
|---|---|
| URL | `https://barby.co.il` |
| Endpoint | `GET /api/shows/find` |
| Date | `showDate` as `DD/MM/YYYY` |
| Time | `showTime` |
| Price | `showPrice`; `showTierPriceType === "2"` → tiered |
| Event URL | `{origin}/show/{showId}` |

### WordPress + Tickera + WooCommerce (Ozen)

| | |
|---|---|
| URL | `https://ozentelaviv.com` |
| Events | `GET /wp-json/tickera-public/v1/events` |
| URLs + external detect | `GET /wp-json/wp/v2/tc_events?per_page=100&_fields=id,slug,link,content` |
| Prices | `GET /wp-json/wc/store/v1/products?search={slug}&per_page=100` |

Price rules:
- Content contains `go-out.co` → external ticketing → `N/A`
- Else match products by event slug in product slug, fallback to title search
- Only `is_purchasable && is_in_stock` products; min price wins

Do **not** paginate the full product catalog (1000+ items). Search per on-site
event instead; cache by slug; run searches in parallel.

### Custom WordPress REST namespace (Hameretz 2)

| | |
|---|---|
| URL | `https://hameretz2.org` |
| Endpoint | `GET /wp-json/hm2/v1/events` |
| Date/time | `start` → extract `YYYY-MM-DD` and `HH:mm` from prefix |
| Price | `ticket_types[]` (in-stock tiers) or fallback `price` |
| URL | `ticket_sale_link` or `{origin}/e/{link_slug}/` |
| Filter | `status === 'upcoming' \|\| status === 'in_progress'` |

### WordPress + fat-event plugin (Levontin 7)

| | |
|---|---|
| URL | `https://levontin7.com` |
| Endpoint | `GET /wp-admin/admin-ajax.php?action=fat_event_get_timetable&sc_id=931&view=month&month=M&year=Y` |
| Date/time | `start_date` as `"YYYY-MM-DD HH:mm:ss"` |
| Price | External (eventer.co.il) or on-site Stripe — API `fees` always 0 → `N/A` |
| URL | `url` field (includes `sd`/`ed` query params) |

Fetch 6 months from current month; dedupe by `url`; skip `is_day_off` and past dates.

### WordPress + The Events Calendar (Babe Bar)

| | |
|---|---|
| URL | `https://babebar.co.il` |
| Endpoint | `GET /wp-json/tribe/events/v1/events?start_date={today} 00:00:00&per_page=100&page=N` |
| Date/time | `start_date` as `"YYYY-MM-DD HH:mm:ss"` (Asia/Jerusalem local) |
| Price | `cost_details.values[]` or parse `cost` (HTML `&#8362;` entity) |
| URL | `url` field → `{origin}/event/{slug}/` |
| TLS | Incomplete cert chain — pass `{ insecureTls: true }` as 3rd arg to `fetchJson` |

Paginate while `next_rest_url` is set (~59 upcoming events). Single-tier prices
from `cost_details.values`; multiple values → `from ₪min`.

### WordPress custom events, no REST (HaZor)

| | |
|---|---|
| URL | `https://haezor.com` |
| REST tried | `wp-json/` (no event routes), `wp/v2/events` (404), admin-ajax (no handlers) |
| Source | `GET /%d7%9c%d7%95%d7%97-%d7%94%d7%95%d7%a4%d7%a2%d7%95%d7%aa/` (לוח הופעות) — server-rendered HTML |
| Date | `.clsDate` Hebrew: `12 באוגוסט יום רביעי` → infer year from today |
| Time | `.clsTime` → `HH:mm` |
| Price | `.clsPrice` tier text: `80/90 ש"ח` → `from ₪80`; `249-599 ש"ח` → `from ₪249` |
| URL | `.clsItem` onclick `location.href='…'` |

Only events listed on the schedule page are returned (no pagination API found).

### WordPress + rgbcode events block (Papaito)

| | |
|---|---|
| URL | `https://papaito.co.il` |
| REST tried | `wp-json/` (no public event routes), `rgbc/v1/*` (401 without auth) |
| Endpoint | `POST /wp-admin/admin-ajax.php` — `action=load_events_block` |
| Nonce | Extract `ajaxNonce` from homepage `rgbcJsLocalize` script |
| Params | `date_filter`, `page`, `per_page`, `page_url` |
| Date/time | `items_html` date text: `13.08 (ה׳) 21:00` → infer year from today |
| Price | Not in listing API → `N/A` |
| URL | `/event/{id}/` from item link |
| TLS | Incomplete cert chain — pass `{ insecureTls: true }` to HTTP helpers |

Paginate while `pagination_html` contains a `data-page` greater than the current page.

### SmarTicket platform (Shablul)

| | |
|---|---|
| URL | `https://shablul.smarticket.co.il` |
| Endpoint | `GET /api/shows` |
| Structure | Array of show productions; each has `events[]` performances |
| Date/time | `show_date` (`YYYY-MM-DD`), `show_time` (`HH:mm`) |
| Price | `pricelist[].price`; multiple tiers → `from ₪min` |
| URL | `{origin}/{show.url}/?id={event.id}` |
| Filter | `visibility !== false`; skip past `show_date` |

Single bulk endpoint returns all upcoming performances with embedded price tiers.
Sold-out events (`tickets_available: false`) still include `pricelist`.

### WordPress + grayux theme (Gray Club Yehud)

| | |
|---|---|
| URL | `https://grayclub.co.il/gray-יהוד/` |
| REST tried | `wp-json/` (no public event routes) |
| Initial load | Server-rendered HTML on location page (first 12 shows) |
| Endpoint | `POST /wp-admin/admin-ajax.php` — `action=load_more_shows` |
| Params | `posts_per_page` (offset, starts 12, +=6 each load), `load_more_shows=6`, `categorytermid=5` (Yehud) |
| Response | `{ status, htmldata, hideButton }` |
| Date | `DD.MM.YYYY` in `.date-time` |
| Time | Door opening: `פתיחת דלתות: HH:mm` (no show start in listing) |
| Price | On event page / tickets.grayclub.co.il → `N/A` in listing |
| URL | `/event/{artistId}/{showId}/` |

Paginate while `hideButton` is false. Only scrape Yehud (`categorytermid=5`); Tel Aviv and Modiin use other term IDs.

### Custom PHP SPA (Teder)

| | |
|---|---|
| URL | `https://www.teder.fm` |
| REST tried | `wp-json/`, `/api/events`, `/api/shows` — no event data |
| Endpoint | `POST /home?only_content=1&update={ts}` (pgnFetch fragment loader) |
| Response | HTML with event cards in אירועים section |
| Filter | `data-pgn-type="events"` + `/events/{id}` URL (exclude `/shows/` radio/archive) |
| Date | `DD.MM.YY` in `.item-date` |
| Time | `HH:mm` in `.item-time` |
| Venue | Sub-space in `.location-txt` (Radio, Rafi, Romano) — not a separate output field |
| Price | Not on listing or event detail → `N/A` |
| URL | `https://www.teder.fm/events/{id}` |

Embedded `#schedule-json` is radio broadcast schedule only (`section: "shows"`), not ticketed events.

### Eventim Israel platform (Zappa Club)

| | |
|---|---|
| URL | `https://www.zappa-club.co.il` |
| Site platform | Eventim (Akamai); homepage uses SERP widget pointing at public API |
| Endpoint | `GET https://public-api.eventim.com/websearch/search/api/exploration/v1/products` |
| Params | `webId=web__eventim-co-il`, `language=he`, `retail_partner=ZPE`, `search_term=זאפה`, `sort=DateAsc`, `top=50`, `page=N` |
| Date/time | `typeAttributes.liveEntertainment.startDate` (ISO `+03:00`) → literal `YYYY-MM-DD`, `HH:mm` |
| Venue | `typeAttributes.liveEntertainment.location.name` — filter `/זאפה\|Zappa\|אמפי עומר/i` |
| Price | `price` when present → `₪NNN`; missing (often sold out) → `N/A` |
| URL | Rewrite `link` / `url.path` from `eventim.co.il` to `zappa-club.co.il` pathname |
| TLS | Pass `insecureTls: true` — corporate MITM breaks Eventim cert chain on some networks |

Paginate all pages; dedupe by `productId`. `search_term=זאפה` returns ~46 unique Zappa
venue events (5 pages) vs ~21 when scanning the full Eventim catalog unfiltered.

### Wix Events warmup JSON (Green Bear)

| | |
|---|---|
| Marketing URL | `https://www.greenbear-club.com` |
| Schedule / tickets | `https://www.greenbear.co.il/` (לוח מופעים) |
| REST tried | `/_api/wix-events-web/v1/events/query` (400 without session), v2 routes (404) |
| Source | `GET /` — parse `wix-warmup-data` → `appsWarmupData.*.events.events[]` |
| Date/time | `scheduling.config.startDate` (UTC ISO) + `scheduling.startTimeFormatted` (local display) |
| Price | `registration.ticketing.lowestPrice` / `highestPrice`; multiple tiers → `from ₪min` |
| URL | `{origin}/event-details/{slug}` |
| Filter | Skip events with `date` before today |

The public site homepage (`greenbear-club.com`) is a separate Wix property with
image cards linking to `greenbear.co.il`; scrape the co.il schedule for full
metadata (name, time, price).

## WordPress generic checklist

1. `GET {origin}/wp-json/` — list routes
2. Try `{origin}/wp-json/wp/v2/{post_type}?per_page=100`
3. Search homepage HTML for plugin namespaces: `tickera-public`, custom `*/v1/events`
4. WooCommerce Store API: `{origin}/wp-json/wc/store/v1/products?search=…`

## HTTP helper

`src/http.js` → `fetchJson(url, { Referer, Origin })` sends browser-like headers.
Required for Cloudflare-protected sites. Throws on non-2xx.

## Shared infrastructure (do not reimplement)

| File | Role |
|------|------|
| `src/http.js` | JSON fetch with browser headers |
| `src/progress.js` | `noopProgress`, `createProgress`, `fetchAllSites` |
| `src/index.js` | CLI, day filter, merge, table output |

Progress goes to **stderr**; table/JSON to **stdout**.

## When REST fails

Document why in README. Only then consider HTML parsing or browser automation — and
flag brittleness to the user. Zappa was previously blocked from direct
`zappa-club.co.il` HTTPS on some networks; the working approach is Eventim's
public API with `insecureTls`, not HTML parsing.
