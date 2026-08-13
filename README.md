# EventScraper

A small command-line tool that scrapes event/ticketing websites and lists the
**shows happening on a given day** — each with its **name** and **ticket price**.

## Intent

Concert and club venues each publish their lineups on their own site, in their
own format. Checking "what's on tonight and how much are tickets?" means visiting
several sites and reading each one by hand.

EventScraper does that for you. Point it at a day and it returns a single,
consolidated list of every event across all supported venues — show name, start
time, ticket price, and a link to buy — sorted by date and time.

The project is built to grow: each venue is a self-contained scraper module, so
adding a new site is a matter of dropping in one file. It starts with a single
venue and expands from there.

## How it works

Most modern venue sites are JavaScript single-page apps — the HTML you download
contains no event data; the page fetches it from a backend JSON API after it
loads. Rather than render pages in a headless browser, EventScraper identifies
each site's underlying data API and calls it directly. That's faster, more
reliable, and far less brittle than parsing HTML.

Each site module fetches its data and normalizes it into one common event shape:

```
{ site, name, date (YYYY-MM-DD), time, priceText, url }
```

The core then filters by day, merges all venues, sorts, and prints.

## Supported venues

| Venue              | Status      | Source                                   |
| ------------------ | ----------- | ---------------------------------------- |
| Barby (Tel Aviv)   | ✅ Working  | `GET barby.co.il/api/shows/find` (JSON)  |
| Ozen (Tel Aviv)    | ✅ Working  | Tickera + WooCommerce REST (see below)   |
| Hameretz 2 (Tel Aviv) | ✅ Working | `GET hameretz2.org/wp-json/hm2/v1/events` |
| Levontin 7 (Tel Aviv) | ✅ Working | fat-event admin-ajax timetable (see below) |
| Babe Bar (Hod Hasharon) | ✅ Working | `GET babebar.co.il/wp-json/tribe/events/v1/events` |
| HaZor (Tel Aviv)      | ✅ Working | Schedule page HTML (see below)           |
| Papaito               | ✅ Working | admin-ajax `load_events_block` (see below) |
| Shablul (Tel Aviv)    | ✅ Working | `GET shablul.smarticket.co.il/api/shows`   |
| Teder (Tel Aviv)      | ✅ Working | POST `/home?only_content=1` (see below)    |
| Gray Club (Yehud)     | ✅ Working | admin-ajax `load_more_shows` (see below)   |
| Gray Club (Modiin)    | ✅ Working | admin-ajax `load_more_shows` (see below)   |
| Gray Club (Tel Aviv)  | ✅ Working | admin-ajax `load_more_shows` (see below)   |
| Zappa Club (Israel)   | ✅ Working | Eventim websearch products API (see below) |
| Green Bear (Hod Hasharon) | ✅ Working | Wix Events warmup JSON on greenbear.co.il (see below) |
| Muzi (Center)         | ✅ Working | Center region archive pages (see below)      |
| Bar Giyora (Tel Aviv)     | ✅ Working | admin-ajax `bargyora_products_filter` (see below) |

## Usage

Requires Node.js 20+ (no dependencies to install).

```bash
node src/index.js                 # events today
node src/index.js 2026-08-21      # events on a specific day (YYYY-MM-DD)
node src/index.js --all           # every upcoming event across all venues
node src/index.js --all --json    # machine-readable JSON output
node src/index.js --quiet         # suppress progress on stderr
node src/index.js --help
```

Example:

```
Events for 2026-08-12 — 1 found

  Time    Price       Source            Event
  21:00   ₪145        Barby (Tel Aviv)  נועם בתן - סדרת מופעים ראשונה בבארבי
                      https://barby.co.il/show/5371
```

Prices show as a fixed amount (`₪145`) or, for tiered shows, a starting price
(`from ₪125`).

## Project layout

```
EventScraper/
  README.md
  package.json
  src/
    index.js         CLI: arg parsing, day filter, multi-site merge, output
    registry.js      registered venue scrapers (SITES array)
    http.js          shared fetch helper (browser-like headers)
    progress.js      shared progress logging (stderr)
    sites/
      barby.js       Barby-specific fetch + normalize
      ozen.js        Ozen-specific fetch + normalize
      hameretz2.js   Hameretz 2-specific fetch + normalize
      levontin7.js   Levontin 7-specific fetch + normalize
      haezor.js      HaZor-specific fetch + normalize
      babebar.js     Babe Bar-specific fetch + normalize
      papaito.js     Papaito-specific fetch + normalize
      shablul.js     Shablul-specific fetch + normalize
      teder.js       Teder-specific fetch + normalize
      grayyehud.js   Gray Club Yehud-specific fetch + normalize
      graymodiin.js  Gray Club Modiin-specific fetch + normalize
      graytelaviv.js Gray Club Tel Aviv-specific fetch + normalize
      zappa.js       Zappa Club-specific fetch + normalize
      greenbear.js   Green Bear-specific fetch + normalize
      bargiyora.js   Bar Giyora-specific fetch + normalize
      muzicenter.js  Muzi Center-region fetch + normalize
```

Ozen uses three public REST endpoints: Tickera's event list
(`tickera-public/v1/events`), WordPress event posts for URLs and external-ticket
detection (`wp/v2/tc_events`), and targeted WooCommerce Store API product search
(`wc/store/v1/products?search=…`) for on-site ticket prices. Events sold via
go-out.co show `N/A` for price.

Levontin 7 uses the fat-event WordPress plugin's admin-ajax timetable
(`fat_event_get_timetable`, schedule shortcode `sc_id=931`). Tickets are sold
via eventer.co.il or on-site without price data in the API, so prices show as
`N/A`.

Babe Bar uses The Events Calendar's WordPress REST API
(`tribe/events/v1/events`, paginated). Prices come from `cost_details.values`;
the site serves an incomplete TLS certificate chain, so its scraper passes
`insecureTls` to the shared HTTP helper.

HaZor (מועדון האזור) uses a custom WordPress events post type that is not
exposed via wp-json. After REST discovery failed, the scraper parses the Hebrew
schedule page (`/לוח-הופעות/`). Dates are Hebrew ("12 באוגוסט"); prices come
from tier text like `80/90 ש"ח` → `from ₪80`. The site serves an incomplete
TLS cert chain on some Node/OpenSSL builds; the scraper uses `insecureTls` for
that host only.

Papaito uses the rgbcode theme's admin-ajax events block
(`load_events_block`). The response is JSON with an `items_html` fragment per
page; dates are `DD.MM (weekday) HH:mm` with the year inferred from today.
Prices are not in the listing API → `N/A`. The site serves an incomplete TLS
certificate chain, so its scraper passes `insecureTls` to the shared HTTP helper.

Shablul runs on the SmarTicket platform. `GET /api/shows` returns show
productions, each with an `events[]` array of dated performances (date, time,
`pricelist` tiers). Multiple tiers → `from ₪min`; sold-out performances still
list with prices from the catalog when available.

Zappa Club runs on the Eventim Israel platform (Akamai). The scraper calls
Eventim's public websearch products API
(`public-api.eventim.com/websearch/search/api/exploration/v1/products`) with
`webId=web__eventim-co-il`, `retail_partner=ZPE`, and `search_term=זאפה`, then
filters to Zappa venue names (Tel Aviv, Herzliya, Jerusalem, Haifa, Amphi
Shuni). Dates/times come from `startDate`; listing prices are a single tier when
present — sold-out or unlisted tiers → `N/A`. Event URLs are rewritten to
`zappa-club.co.il`. The Eventim API host may require `insecureTls` on networks
with TLS interception; direct HTTPS to `zappa-club.co.il` can also be slow or
blocked from some corporate networks.

Teder (תדר) is a custom PHP SPA with no wp-json or `/api/*` events endpoint.
The homepage אירועים section is loaded via `POST /home?only_content=1` (same as
the site's pgnFetch). Ticketed events link to `/events/{id}`; radio/archive
items under `/shows/` are excluded. Dates are `DD.MM.YY`; sub-venue (Radio, Rafi,
Romano) appears in the card but is not a separate field. Prices are not in the
listing or event pages → `N/A`.

Gray Club (Yehud, Modiin, and Tel Aviv) use the grayux theme's admin-ajax load-more
(`load_more_shows`, `categorytermid=5` for Yehud, `6` for Modiin, `7` for Tel Aviv). The first 12
shows are server-rendered on each location page; each load-more returns JSON with
an `htmldata` fragment. Dates are `DD.MM.YYYY`; times are door opening
(`פתיחת דלתות`). Prices are on individual event/ticket pages → `N/A`.

Green Bear (הדוב הירוק, Hod Hasharon) is a Wix site. The marketing homepage
(`greenbear-club.com`) links to ticket pages on `greenbear.co.il`. Public Wix
Events REST query endpoints require session tokens; the schedule page SSR embeds
full event objects in `wix-warmup-data` (`appsWarmupData` → `events.events[]`).
Dates/times use `scheduling.startTimeFormatted` with the local date derived from
`scheduling.config.startDate` in `Asia/Jerusalem`. Prices from
`registration.ticketing.{lowestPrice,highestPrice}`; multiple tiers → `from ₪…`.

Muzi (Center) is a WordPress events aggregator for the central Israel region.
REST discovery found taxonomy routes (`/wp/v2/events_by_region`) but the `event`
post type is not exposed via wp-json; admin-ajax infinite scroll returns HTML
fragments. The scraper paginates the server-rendered archive
(`/events-by-region/center/`, ~38 pages). Each listing has show time, venue
hall, and price range; dates come from section headers (`data-event-date`).
Promoted/ad blocks are skipped. The `site` field includes the venue hall name
(e.g. `Muzi (Center) (בארבי נמל יפו)`) for filter UX across multiple venues.

Bar Giyora (בר גיורא, Even Gvirol 30 Tel Aviv) is WordPress + WooCommerce with a
custom bargyora theme. The homepage renders the first 9 upcoming show products;
additional shows load via admin-ajax (`bargyora_products_filter`, sending
`post_ids[]` of already-seen products). Dates are Hebrew weekday +
`DD.MM.YYYY`; times are door opening (`פתיחת דלתות`). Ticket prices come from
the WooCommerce Store API (`wc/store/v1/products?include=…`) batched by product
id. The site may require `insecureTls` on networks with TLS interception.

## Adding a venue

1. Create `src/sites/<venue>.js` exporting:
   - `meta` — `{ id, name, currency }`
   - `fetchEvents(progress?)` — returns an array of the common event shape above, with
     `date` normalized to `YYYY-MM-DD`. Optional `progress` (from `progress.js`) logs
     step messages to stderr.
2. Register it in the `SITES` array in `src/registry.js`.

Everything else — day filtering, merging, sorting, table/JSON output — works
automatically. If a single site fails, the others still return; the failure is
reported to stderr.

## Notes & limitations

- Data is only as current and accurate as each venue's own API.
- Some sites sit behind bot protection (e.g. Cloudflare); the shared HTTP helper
  sends browser-like headers to get through, but this can change at any time.
- Tiered-price shows report the base/starting tier. A per-show price-range
  lookup could be added if full ranges are needed.
- Please scrape responsibly: respect each site's terms of service and avoid
  hammering their servers.
