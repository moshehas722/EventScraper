// "Event Scraper for WhatsApp" — a silent WhatsApp agent plugin mounted onto
// the scraper's own always-up Express server (see server.js). It never
// replies; it only stores every incoming message to the "WhatsApp Messages"
// Blob store — enriched with an LLM-extracted event summary, applied
// slightly later via a batched Gemini call (see llm.js and the extraction
// queue below) — and prunes entries older than the configured retention
// window.
//
// Registers against the WhatsApp agent's main service using the standard
// remote-plugin HTTP contract (POST /plugins/register, POST /on-message,
// POST /plugins/heartbeat, DELETE /plugins/register). See the
// create-whatsapp-plugin skill for the full protocol.

import {
  downloadWhatsAppMessages,
  saveWhatsAppMessages,
  saveWhatsAppEvents,
  loadWhatsAppPluginSecret,
  saveWhatsAppPluginSecret,
} from './blob.js';
import { extractEventsFromMessages } from './llm.js';
import { toPortalEventFromWhatsAppEntry } from '../portalEvent.js';

// Node doesn't auto-load .env files; server.js's own loader runs before this
// module's exported mountWhatsAppPlugin() is called, but not before this
// module's own top-level code (ES imports evaluate before the importer's
// body), so load defensively here too.
for (const envFile of ['.env', '.env.local']) {
  try {
    process.loadEnvFile(envFile);
  } catch {
    // file missing or unreadable; rely on already-set environment variables
  }
}

const PLUGIN_ID = process.env.WHATSAPP_PLUGIN_ID || 'event-scraper-for-whatsapp';
const DEFAULT_RETENTION_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;
const HEARTBEAT_INTERVAL_MS = 30_000;
const REGISTER_RETRY_INTERVAL_MS = 10_000;

// The Gemini free tier caps requests/day far below typical message volume,
// so messages are extracted in batches rather than one Gemini call each:
// a batch flushes once it reaches WHATSAPP_EXTRACTION_BATCH_SIZE messages,
// or WHATSAPP_EXTRACTION_BATCH_MINUTES have passed since the oldest queued
// message, whichever comes first.
const DEFAULT_EXTRACTION_BATCH_SIZE = 10;
const DEFAULT_EXTRACTION_BATCH_MINUTES = 15;

function envPositiveNumber(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

const EXTRACTION_BATCH_SIZE = envPositiveNumber(
  'WHATSAPP_EXTRACTION_BATCH_SIZE',
  DEFAULT_EXTRACTION_BATCH_SIZE,
);
const EXTRACTION_BATCH_MINUTES = envPositiveNumber(
  'WHATSAPP_EXTRACTION_BATCH_MINUTES',
  DEFAULT_EXTRACTION_BATCH_MINUTES,
);
const EXTRACTION_BATCH_INTERVAL_MS = EXTRACTION_BATCH_MINUTES * 60_000;

const CONFIG_JSON_SCHEMA = {
  type: 'object',
  properties: {
    retentionDays: {
      type: 'integer',
      minimum: 1,
      description: `Number of days to keep stored WhatsApp messages before they're purged (default ${DEFAULT_RETENTION_DAYS})`,
    },
  },
  additionalProperties: false,
};

function normalizeRetentionDays(config) {
  const value = Number(config?.retentionDays);
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_RETENTION_DAYS;
}

// Serializes reads/prunes/writes against the single "WhatsApp Messages" Blob
// file so concurrent /on-message hits can't race each other's get→put cycle.
let writeQueue = Promise.resolve();
function serialize(fn) {
  const result = writeQueue.then(fn, fn);
  writeQueue = result.then(
    () => {},
    () => {},
  );
  return result;
}

async function storeAndPrune(entry, retentionDays) {
  return serialize(async () => {
    const messages = await downloadWhatsAppMessages();
    messages.push(entry);
    const cutoff = Date.now() - retentionDays * DAY_MS;
    const kept = messages.filter((m) => m.receivedAt >= cutoff);
    await saveWhatsAppMessages(kept);

    // Best-effort: the raw message is already safely stored above, so a
    // failure deriving/saving the portal-facing events view must never
    // surface as a failure to store the message itself.
    try {
      const portalEvents = kept.map(toPortalEventFromWhatsAppEntry).filter(Boolean);
      await saveWhatsAppEvents(portalEvents);
    } catch (err) {
      console.error('[whatsapp-plugin] failed to derive/save portal events (raw message still stored):', err.message);
    }

    return kept.length;
  });
}

// Patches the `event` field onto already-stored messages once a batched
// extraction result comes back (see the extraction queue below). Reuses
// storeAndPrune's write queue so an append (a new incoming message) and an
// update (this) can never race each other's get→put cycle on the same Blob
// file. A message that aged out of retention (or was otherwise not found)
// between being queued and the batch flushing is silently skipped — it's
// already gone from the store, so there's nothing to patch.
async function applyExtractedEvents(updates) {
  if (updates.length === 0) return;

  return serialize(async () => {
    const messages = await downloadWhatsAppMessages();
    const eventByKey = new Map(updates.map((u) => [`${u.chatJid} ${u.id}`, u.event]));

    let changed = 0;
    const next = messages.map((m) => {
      const key = `${m.chatJid} ${m.id}`;
      if (!eventByKey.has(key)) return m;
      changed += 1;
      return { ...m, event: eventByKey.get(key) };
    });
    if (changed === 0) return;

    await saveWhatsAppMessages(next);
    try {
      const portalEvents = next.map(toPortalEventFromWhatsAppEntry).filter(Boolean);
      await saveWhatsAppEvents(portalEvents);
    } catch (err) {
      console.error(
        '[whatsapp-plugin] failed to derive/save portal events after batch extraction (messages still updated):',
        err.message,
      );
    }
    console.log(`[whatsapp-plugin] applied extraction results to ${changed}/${updates.length} message(s)`);
  });
}

// Messages queued for the next batched Gemini call. Flushed once it reaches
// EXTRACTION_BATCH_SIZE, or EXTRACTION_BATCH_INTERVAL_MS after the oldest
// queued message, whichever comes first.
/** @type {Array<{ chatJid: string, id: string, text: string }>} */
let pendingExtractions = [];
let extractionFlushTimer = null;

async function flushExtractionQueue() {
  if (extractionFlushTimer) {
    clearTimeout(extractionFlushTimer);
    extractionFlushTimer = null;
  }
  if (pendingExtractions.length === 0) return;

  const batch = pendingExtractions;
  pendingExtractions = [];

  let results;
  try {
    results = await extractEventsFromMessages(batch.map((m) => m.text));
  } catch (err) {
    // The messages themselves are already safely stored (with event: null)
    // from handleMessage — losing this batch's extraction is a degraded
    // experience, not data loss.
    console.error(`[whatsapp-plugin] batch event extraction failed for ${batch.length} message(s):`, err.message);
    return;
  }

  const updates = batch.map((m, i) => ({ chatJid: m.chatJid, id: m.id, event: results[i] ?? null }));
  try {
    await applyExtractedEvents(updates);
  } catch (err) {
    console.error('[whatsapp-plugin] failed to apply batch extraction results:', err.message);
  }
}

function scheduleExtractionFlush() {
  if (extractionFlushTimer) return; // already scheduled for the oldest queued message
  extractionFlushTimer = setTimeout(() => {
    extractionFlushTimer = null;
    flushExtractionQueue().catch((err) => console.error('[whatsapp-plugin] extraction flush threw:', err.message));
  }, EXTRACTION_BATCH_INTERVAL_MS);
}

function queueForExtraction(chatJid, id, text) {
  pendingExtractions.push({ chatJid, id, text });
  if (pendingExtractions.length >= EXTRACTION_BATCH_SIZE) {
    flushExtractionQueue().catch((err) => console.error('[whatsapp-plugin] extraction flush threw:', err.message));
    return;
  }
  scheduleExtractionFlush();
}

/**
 * Mounts the plugin's /on-message route on the given Express app and
 * registers it with the WhatsApp agent's main service. No-op (with a
 * warning) if MAIN_SERVICE_URL / PLUGIN_BASE_URL aren't configured, so a
 * missing WhatsApp config never takes down the scraper API itself.
 * @param {import('express').Express} app
 */
export function mountWhatsAppPlugin(app) {
  const mainServiceUrl = (process.env.WHATSAPP_MAIN_SERVICE_URL || '').replace(/\/+$/, '');
  const pluginBaseUrl = process.env.WHATSAPP_PLUGIN_BASE_URL;

  if (!mainServiceUrl || !pluginBaseUrl) {
    console.warn(
      '[whatsapp-plugin] WHATSAPP_MAIN_SERVICE_URL / WHATSAPP_PLUGIN_BASE_URL not set — ' +
        'Event Scraper for WhatsApp is disabled.',
    );
    return;
  }

  if (!process.env.GEMINI_API_KEY) {
    console.warn(
      '[whatsapp-plugin] GEMINI_API_KEY not set — messages will be stored without event extraction.',
    );
  }

  let secret;

  async function registerWithMain() {
    try {
      const res = await fetch(`${mainServiceUrl}/plugins/register`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(secret ? { 'X-Plugin-Secret': secret } : {}),
        },
        body: JSON.stringify({
          pluginId: PLUGIN_ID,
          name: 'Event Scraper for WhatsApp',
          description: 'Silently stores every incoming message to Blob (with an LLM-extracted event summary) and prunes it after a configurable retention period. Never replies.',
          baseUrl: pluginBaseUrl,
          configJsonSchema: CONFIG_JSON_SCHEMA,
        }),
      });
      if (!res.ok) {
        console.error(`[whatsapp-plugin] register failed (${res.status}):`, await res.json().catch(() => ({})));
        setTimeout(registerWithMain, REGISTER_RETRY_INTERVAL_MS);
        return;
      }
      const body = await res.json();
      secret = body.secret;
      await saveWhatsAppPluginSecret(secret);
      console.log(`[whatsapp-plugin] registered as "${PLUGIN_ID}" with ${mainServiceUrl}`);

      setInterval(async () => {
        try {
          await fetch(`${mainServiceUrl}/plugins/heartbeat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Plugin-Secret': secret },
            body: JSON.stringify({ pluginId: PLUGIN_ID }),
          });
        } catch (err) {
          console.error('[whatsapp-plugin] heartbeat failed:', err.message);
        }
      }, HEARTBEAT_INTERVAL_MS);
    } catch (err) {
      console.error('[whatsapp-plugin] main service unreachable, retrying shortly:', err.message);
      setTimeout(registerWithMain, REGISTER_RETRY_INTERVAL_MS);
    }
  }

  async function handleMessage({ chatJid, message, config }) {
    const retentionDays = normalizeRetentionDays(config);

    // event starts null and is filled in later, out of band, once this
    // message's batch flushes (see the extraction queue above) — storing
    // the message must never wait on (or be lost to a failure of) Gemini.
    const entry = {
      chatJid,
      id: message.id,
      fromMe: message.fromMe,
      sender: message.sender,
      senderName: message.senderName,
      timestamp: message.timestamp,
      text: message.text,
      receivedAt: Date.now(),
      event: null,
    };
    try {
      const remaining = await storeAndPrune(entry, retentionDays);
      console.log(`[whatsapp-plugin] stored message from ${chatJid} — ${remaining} kept (retention: ${retentionDays}d)`);
    } catch (err) {
      console.error('[whatsapp-plugin] failed to store/prune message:', err.message);
      return;
    }

    queueForExtraction(chatJid, message.id, message.text);
  }

  app.post('/on-message', (req, res) => {
    if (req.header('X-Plugin-Secret') !== secret) {
      res.status(401).json({ error: 'Invalid secret.' });
      return;
    }
    // Silent plugin: ack immediately, never call /plugins/callback.
    res.json({ ok: true });
    handleMessage(req.body).catch((err) => console.error('[whatsapp-plugin] on-message handler threw:', err));
  });

  async function shutdown() {
    if (secret) {
      try {
        await fetch(`${mainServiceUrl}/plugins/register`, {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json', 'X-Plugin-Secret': secret },
          body: JSON.stringify({ pluginId: PLUGIN_ID }),
        });
      } catch (err) {
        console.error('[whatsapp-plugin] unregister on shutdown failed:', err.message);
      }
    }
    // Best-effort: flush any messages still waiting on their extraction
    // batch so a routine redeploy doesn't strand them without event data.
    try {
      await flushExtractionQueue();
    } catch (err) {
      console.error('[whatsapp-plugin] extraction flush on shutdown failed:', err.message);
    }
    process.exit(0);
  }
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  loadWhatsAppPluginSecret()
    .then((existing) => {
      secret = existing;
      registerWithMain();
    })
    .catch((err) => {
      console.error('[whatsapp-plugin] failed to load persisted secret, registering fresh:', err.message);
      registerWithMain();
    });
}
