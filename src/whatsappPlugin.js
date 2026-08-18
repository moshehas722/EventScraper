// "Event Scraper for WhatsApp" — a silent WhatsApp agent plugin mounted onto
// the scraper's own always-up Express server (see server.js). It never
// replies; it only stores every incoming message to the "WhatsApp Messages"
// Blob store and prunes entries older than the configured retention window.
//
// Registers against the WhatsApp agent's main service using the standard
// remote-plugin HTTP contract (POST /plugins/register, POST /on-message,
// POST /plugins/heartbeat, DELETE /plugins/register). See the
// create-whatsapp-plugin skill for the full protocol.

import {
  downloadWhatsAppMessages,
  saveWhatsAppMessages,
  loadWhatsAppPluginSecret,
  saveWhatsAppPluginSecret,
} from './blob.js';

// Node doesn't auto-load .env.local; blob.js only does so lazily on first
// use, which is too late here since mountWhatsAppPlugin() reads env vars
// synchronously at server startup, before any blob call has happened.
try {
  process.loadEnvFile('.env.local');
} catch {
  // no .env.local present; rely on already-set environment variables (e.g. Docker's -e flags)
}

const PLUGIN_ID = process.env.WHATSAPP_PLUGIN_ID || 'event-scraper-for-whatsapp';
const DEFAULT_RETENTION_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;
const HEARTBEAT_INTERVAL_MS = 30_000;
const REGISTER_RETRY_INTERVAL_MS = 10_000;

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
    return kept.length;
  });
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
          description: 'Silently stores every incoming message to Blob and prunes it after a configurable retention period. Never replies.',
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
    const entry = {
      chatJid,
      id: message.id,
      fromMe: message.fromMe,
      sender: message.sender,
      senderName: message.senderName,
      timestamp: message.timestamp,
      text: message.text,
      receivedAt: Date.now(),
    };
    try {
      const remaining = await storeAndPrune(entry, retentionDays);
      console.log(`[whatsapp-plugin] stored message from ${chatJid} — ${remaining} kept (retention: ${retentionDays}d)`);
    } catch (err) {
      console.error('[whatsapp-plugin] failed to store/prune message:', err.message);
    }
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
