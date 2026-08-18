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
    const siteEvents = JSON.parse(text);

    // WhatsApp events aren't pruned by date-relevance (only by retention), so
    // they need an explicit "still upcoming" filter here — the site snapshot
    // is already upcoming-only by construction. Never let this fail the
    // whole request — fall back to site events only.
    let waEvents = [];
    try {
      const waResult = await get('whatsapp/events.json', { access: 'private', useCache: false });
      if (waResult) {
        const waText = await new Response(waResult.stream).text();
        const parsed = JSON.parse(waText);
        waEvents = Array.isArray(parsed) ? parsed : [];
      }
      const today = todayIso();
      waEvents = waEvents.filter((e) => e.date >= today);
      if (!all) waEvents = waEvents.filter((e) => e.date === date);
    } catch (err) {
      console.error('WhatsApp events load failed (continuing with site events only):', err);
    }

    const events = [...siteEvents, ...waEvents].sort(
      (a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time),
    );

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
