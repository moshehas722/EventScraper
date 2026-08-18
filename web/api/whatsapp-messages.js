// Vercel serverless function — reads the "WhatsApp Messages" store written by
// the Event Scraper for WhatsApp plugin. Self-contained: no dependency on the
// scraper subproject, so the two deploy independently. Read-only — the store
// is written by the plugin (running on the local scraper server), never by
// this UI.

import { get } from '@vercel/blob';

const WHATSAPP_MESSAGES_PATHNAME = 'whatsapp/messages.json';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    // Bypass the CDN cache — messages arrive continuously, so a cached
    // response can look like the plugin has stopped working.
    const result = await get(WHATSAPP_MESSAGES_PATHNAME, { access: 'private', useCache: false });
    if (!result) {
      res.status(200).json({ messages: [] });
      return;
    }
    const text = await new Response(result.stream).text();
    const parsed = JSON.parse(text);
    res.status(200).json({ messages: Array.isArray(parsed) ? parsed : [] });
  } catch (err) {
    console.error('WhatsApp messages load failed:', err);
    res.status(500).json({ error: err.message ?? 'WhatsApp messages load failed' });
  }
}
