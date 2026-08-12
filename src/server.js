// HTTP API for the event scraper — used by the React web UI.

import express from 'express';
import cors from 'cors';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scrapeEvents, todayIso, SITES } from './registry.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3001;
const WEB_DIST = path.join(__dirname, '..', 'web', 'dist');

const app = express();
app.use(cors());
app.use(express.json());

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

app.get('/api/sites', (_req, res) => {
  res.json(
    SITES.map((s) => ({
      id: s.meta.id,
      name: s.meta.name,
      currency: s.meta.currency,
    })),
  );
});

app.get('/api/events', async (req, res) => {
  const all = req.query.all === 'true' || req.query.all === '1';
  const date = typeof req.query.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.date)
    ? req.query.date
    : todayIso();

  try {
    const events = await scrapeEvents({ date, all, quiet: true });
    res.json({ date: all ? null : date, all, count: events.length, events });
  } catch (err) {
    console.error('Scrape failed:', err);
    res.status(500).json({ error: err.message ?? 'Scrape failed' });
  }
});

// Serve built React app in production
app.use(express.static(WEB_DIST));
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(WEB_DIST, 'index.html'), (err) => {
    if (err) next();
  });
});

app.listen(PORT, () => {
  console.log(`EventScraper API listening on http://localhost:${PORT}`);
});
