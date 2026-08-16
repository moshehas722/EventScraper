// Vercel serverless function — serves the last events snapshot uploaded to
// Blob storage by the (separately deployed) scraper. Self-contained: no
// dependency on the scraper subproject, so the two deploy independently.

import { get } from '@vercel/blob';

function todayIso() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export default async function handler(req, res) {
  const all = req.query.all === 'true' || req.query.all === '1';
  const date = typeof req.query.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.date)
    ? req.query.date
    : todayIso();

  const pathname = all ? 'events/all.json' : `events/${date}.json`;

  try {
    const result = await get(pathname, { access: 'private' });
    if (!result) {
      res.status(404).json({ error: 'No saved snapshot found in Blob storage' });
      return;
    }

    const text = await new Response(result.stream).text();
    const events = JSON.parse(text);

    res.status(200).json({
      date: all ? null : date,
      all,
      count: events.length,
      events,
      uploadedAt: result.blob.uploadedAt,
      source: 'blob',
    });
  } catch (err) {
    console.error('Blob load failed:', err);
    res.status(500).json({ error: err.message ?? 'Blob load failed' });
  }
}
