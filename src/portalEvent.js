// The common "Portal Event" schema shared by every origin (site-scraping,
// WhatsApp). Each origin normalizes into this shape at write time, so the
// portal (and its read API) never needs origin-specific branching.
//
//   { id, origin, source, sourceOrigin, name, date, time, location, cost,
//     category, reference, referenceType }
//
// `id`/`date`/`time` are guaranteed present on every Portal Event produced
// here — downstream code never needs to guard against them being null.

import { createHash } from 'node:crypto';

/**
 * Deterministic id for an event, stable across re-scrapes/re-extractions of
 * the same event. Delimited (not naive concatenation) to avoid field-boundary
 * collisions; includes `time` so two same-day/same-reference events at
 * different times don't collide (see src/sites/muzicenter.js for a case
 * where that already happens for site-scraped events).
 *
 * Must stay byte-identical to the duplicate copy in web/api/favorites.js
 * (self-contained Vercel function, no src/ imports) — both backends read the
 * same Blob store, and a mismatched hash would make the same legacy favorite
 * resolve to two different ids depending on which one served the GET.
 * @param {{ source: string, reference: string, date: string, time?: string }} fields
 * @returns {string}
 */
export function computeEventId({ source, reference, date, time }) {
  const raw = `${source} ${reference} ${date} ${time ?? ''}`;
  return createHash('sha1').update(raw, 'utf8').digest('hex').slice(0, 20);
}

/**
 * Maps a site-scraped event ({ site, name, date, time, priceText, url,
 * siteOrigin }) into a Portal Event.
 * @param {{ site: string, name: string, date: string, time: string, priceText: string, url: string, siteOrigin?: string }} e
 */
export function toPortalEventFromSite(e) {
  return {
    id: computeEventId({ source: e.site, reference: e.url, date: e.date, time: e.time }),
    origin: 'site',
    source: e.site,
    sourceOrigin: e.siteOrigin ?? null,
    name: e.name,
    date: e.date,
    time: e.time ?? '',
    location: null,
    cost: e.priceText,
    category: 'other',
    reference: e.url,
    referenceType: 'url',
  };
}

/**
 * Maps a stored WhatsApp message entry ({ chatJid, id, fromMe, sender,
 * senderName, timestamp, text, receivedAt, event }) into a Portal Event.
 * Returns null when the entry isn't a real, dateable event — callers must
 * filter those out (e.g. `.map(toPortalEventFromWhatsAppEntry).filter(Boolean)`).
 * @param {object} entry
 * @returns {object | null}
 */
export function toPortalEventFromWhatsAppEntry(entry) {
  const ev = entry.event;
  // Gemini can return isEvent:true with date:null when it can't pin down a
  // date — such an event can't be sorted/filtered, so it's excluded here.
  if (!ev?.isEvent || !ev.date) return null;

  // senderName can be empty for 1:1 chats — fall back so `source` is never null.
  const source = entry.senderName || entry.sender || entry.chatJid;

  return {
    id: computeEventId({ source, reference: entry.text, date: ev.date, time: ev.time ?? '' }),
    origin: 'whatsapp',
    source,
    sourceOrigin: null,
    name: ev.name,
    date: ev.date,
    time: ev.time ?? '',
    location: ev.location ?? null,
    cost: ev.cost ?? null,
    category: ev.category,
    reference: entry.text,
    referenceType: 'text',
  };
}
