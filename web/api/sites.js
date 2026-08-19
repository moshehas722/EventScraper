// Vercel serverless function — static metadata for every registered venue
// scraper. Self-contained: no dependency on the scraper subproject, so the
// two deploy independently (see web/api/events/blob.js).
//
// The frontend uses this to group per-venue event sources under one icon
// per scraper (see web/src/sourceGroups.js) — without it, aggregator
// scrapers whose `source` varies per event (Comy, Muzi, Zappa) render one
// ungrouped, favicon-less pin per venue instead of a single icon.
//
// Must stay in sync with the SITES meta in src/site_scraper/registry.js —
// id/name/currency/origin only (never fetchEvents or anything that touches
// the venues themselves).
const SITES_META = [
  { id: 'barby', name: 'Barby (Tel Aviv)', currency: '₪', origin: 'https://barby.co.il' },
  { id: 'ozen', name: 'Ozen (Tel Aviv)', currency: '₪', origin: 'https://ozentelaviv.com' },
  { id: 'hameretz2', name: 'Hameretz 2 (Tel Aviv)', currency: '₪', origin: 'https://hameretz2.org' },
  { id: 'levontin7', name: 'Levontin 7 (Tel Aviv)', currency: '₪', origin: 'https://levontin7.com' },
  { id: 'haezor', name: 'HaZor (Tel Aviv)', currency: '₪', origin: 'https://haezor.com' },
  { id: 'babebar', name: 'Babe Bar (Hod Hasharon)', currency: '₪', origin: 'https://babebar.co.il' },
  { id: 'papaito', name: 'Papaito', currency: '₪', origin: 'https://papaito.co.il' },
  { id: 'shablul', name: 'Shablul (Tel Aviv)', currency: '₪', origin: 'https://shablul.smarticket.co.il' },
  { id: 'grayyehud', name: 'Gray Club (Yehud)', currency: '₪', origin: 'https://grayclub.co.il' },
  { id: 'graymodiin', name: 'Gray Club (Modiin)', currency: '₪', origin: 'https://grayclub.co.il' },
  { id: 'graytelaviv', name: 'Gray Club (Tel Aviv)', currency: '₪', origin: 'https://grayclub.co.il' },
  { id: 'teder', name: 'Teder (Tel Aviv)', currency: '₪', origin: 'https://www.teder.fm' },
  { id: 'zappa', name: 'Zappa Club', currency: '₪', origin: 'https://www.zappa-club.co.il' },
  { id: 'greenbear', name: 'Green Bear (Hod Hasharon)', currency: '₪', origin: 'https://www.greenbear-club.com' },
  { id: 'bargiyora', name: 'Bar Giyora (Tel Aviv)', currency: '₪', origin: 'https://bar-giyora.co.il' },
  { id: 'muzicenter', name: 'Muzi (Center)', currency: '₪', origin: 'https://muzi.co.il' },
  { id: 'comy', name: 'Comy', currency: '₪', origin: 'https://comy.co.il' },
];

export default async function handler(req, res) {
  res.status(200).json(SITES_META);
}
