// Vercel serverless function — reads/writes the favorites list in Blob
// storage. Self-contained: no dependency on the scraper subproject. Stored
// as its own file (separate from events/*.json) so scraper re-runs never
// touch it.

import { get, put } from '@vercel/blob';
import { createHash } from 'node:crypto';

const FAVORITES_PATHNAME = 'favorites/favorites.json';

function todayIso() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// Must stay byte-identical to computeEventId in src/portalEvent.js — both
// backends read the same Blob store, and a mismatched hash would make the
// same legacy favorite resolve to two different ids depending on which one
// served the GET.
function computeEventId({ source, reference, date, time }) {
  const raw = `${source} ${reference} ${date} ${time ?? ''}`;
  return createHash('sha1').update(raw, 'utf8').digest('hex').slice(0, 20);
}

// Upgrades a pre-Portal-Event favorite record ({url,name,date,time,priceText,
// site,siteOrigin}) to the current shape. Every pre-migration favorite is
// necessarily a site event, so referenceType: 'url' is always safe here.
function migrateLegacyFavorite(f) {
  return {
    id: computeEventId({ source: f.site, reference: f.url, date: f.date, time: f.time }),
    name: f.name,
    date: f.date,
    time: f.time,
    cost: f.priceText,
    source: f.site,
    sourceOrigin: f.siteOrigin ?? null,
    reference: f.url,
    referenceType: 'url',
  };
}

export default async function handler(req, res) {
  if (req.method === 'GET') {
    try {
      // Bypass the CDN cache — favorites are read right after being written
      // (click, then refresh), so a cached response can look like a lost save.
      const result = await get(FAVORITES_PATHNAME, { access: 'private', useCache: false });
      if (!result) {
        res.status(200).json({ favorites: [] });
        return;
      }
      const text = await new Response(result.stream).text();
      const parsed = JSON.parse(text);
      const favorites = Array.isArray(parsed) ? parsed : [];
      res.status(200).json({ favorites: favorites.map((f) => (f.id ? f : migrateLegacyFavorite(f))) });
    } catch (err) {
      console.error('Favorites load failed:', err);
      res.status(500).json({ error: err.message ?? 'Favorites load failed' });
    }
    return;
  }

  if (req.method === 'PUT') {
    const favorites = req.body?.favorites;
    if (!Array.isArray(favorites)) {
      res.status(400).json({ error: 'Body must be { favorites: [...] }' });
      return;
    }

    const today = todayIso();
    const upcoming = favorites.filter((f) => f.date >= today);

    try {
      await put(FAVORITES_PATHNAME, JSON.stringify(upcoming, null, 2), {
        access: 'private',
        addRandomSuffix: false,
        allowOverwrite: true,
        contentType: 'application/json',
      });
      res.status(200).json({ favorites: upcoming });
    } catch (err) {
      console.error('Favorites save failed:', err);
      res.status(500).json({ error: err.message ?? 'Favorites save failed' });
    }
    return;
  }

  res.status(405).json({ error: 'Method not allowed' });
}
