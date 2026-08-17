// Vercel serverless function — reads/writes the event blacklist in Blob
// storage. Self-contained: no dependency on the scraper subproject.

import { get, put } from '@vercel/blob';

const BLACKLIST_PATHNAME = 'blacklist/blacklist.json';

export default async function handler(req, res) {
  if (req.method === 'GET') {
    try {
      const result = await get(BLACKLIST_PATHNAME, { access: 'private', useCache: false });
      if (!result) {
        res.status(200).json({ blacklist: [] });
        return;
      }
      const text = await new Response(result.stream).text();
      const parsed = JSON.parse(text);
      res.status(200).json({ blacklist: Array.isArray(parsed) ? parsed : [] });
    } catch (err) {
      console.error('Blacklist load failed:', err);
      res.status(500).json({ error: err.message ?? 'Blacklist load failed' });
    }
    return;
  }

  if (req.method === 'PUT') {
    const blacklist = req.body?.blacklist;
    if (!Array.isArray(blacklist)) {
      res.status(400).json({ error: 'Body must be { blacklist: [...] }' });
      return;
    }

    try {
      await put(BLACKLIST_PATHNAME, JSON.stringify(blacklist, null, 2), {
        access: 'private',
        addRandomSuffix: false,
        allowOverwrite: true,
        contentType: 'application/json',
      });
      res.status(200).json({ blacklist });
    } catch (err) {
      console.error('Blacklist save failed:', err);
      res.status(500).json({ error: err.message ?? 'Blacklist save failed' });
    }
    return;
  }

  res.status(405).json({ error: 'Method not allowed' });
}
