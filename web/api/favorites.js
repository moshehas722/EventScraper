// Vercel serverless function — reads/writes the favorites list in Blob
// storage. Self-contained: no dependency on the scraper subproject. Stored
// as its own file (separate from events/*.json) so scraper re-runs never
// touch it.

import { get, put } from '@vercel/blob';

const FAVORITES_PATHNAME = 'favorites/favorites.json';

function todayIso() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
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
      res.status(200).json({ favorites: Array.isArray(parsed) ? parsed : [] });
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
