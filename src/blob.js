// Uploads/downloads scraped events JSON to/from the eventscraper-blob Vercel Blob store.

import { get, put } from '@vercel/blob';

function loadLocalEnv() {
  if (process.env.BLOB_READ_WRITE_TOKEN) return;
  try {
    process.loadEnvFile('.env.local');
  } catch {
    // no .env.local present; rely on already-set environment variables
  }
}

function requireToken() {
  loadLocalEnv();
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    throw new Error(
      'BLOB_READ_WRITE_TOKEN is not set. Add it to .env.local (see the Blob store\'s ' +
        'Quickstart tab in the Vercel dashboard for the real value).',
    );
  }
  return process.env.BLOB_READ_WRITE_TOKEN;
}

function eventsPathname({ date, all }) {
  return all ? 'events/all.json' : `events/${date}.json`;
}

/**
 * Upload events JSON to Vercel Blob. Private access — readable by anyone
 * holding BLOB_READ_WRITE_TOKEN (the deployed site, or a local dev session
 * that has the token in .env.local).
 * @param {Array} events
 * @param {{ date: string, all: boolean }} opts
 * @returns {Promise<{ url: string, pathname: string }>}
 */
export async function uploadEventsToBlob(events, opts) {
  const token = requireToken();
  return put(eventsPathname(opts), JSON.stringify(events, null, 2), {
    access: 'private',
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: 'application/json',
    token,
  });
}

/**
 * Load the last-uploaded events JSON snapshot from Vercel Blob.
 * @param {{ date: string, all: boolean }} opts
 * @returns {Promise<{ events: Array, uploadedAt: Date, pathname: string } | null>}
 *   Resolves to null if no snapshot has been uploaded for that scope yet.
 */
export async function downloadEventsFromBlob(opts) {
  const token = requireToken();
  const pathname = eventsPathname(opts);
  const result = await get(pathname, { access: 'private', token });
  if (!result) return null;

  const text = await new Response(result.stream).text();
  return { events: JSON.parse(text), uploadedAt: result.blob.uploadedAt, pathname };
}

const FAVORITES_PATHNAME = 'favorites/favorites.json';

/**
 * Load the saved favorites list from Vercel Blob — a separate file from the
 * events snapshot so it survives scraper re-runs.
 * @returns {Promise<Array>} empty array if nothing has been saved yet
 */
export async function downloadFavoritesFromBlob() {
  const token = requireToken();
  // Bypass the CDN cache — favorites are read right after being written
  // (click, then refresh), so a cached response can look like a lost save.
  const result = await get(FAVORITES_PATHNAME, { access: 'private', token, useCache: false });
  if (!result) return [];

  const text = await new Response(result.stream).text();
  const parsed = JSON.parse(text);
  return Array.isArray(parsed) ? parsed : [];
}

/**
 * Overwrite the saved favorites list in Vercel Blob.
 * @param {Array} favorites
 */
export async function uploadFavoritesToBlob(favorites) {
  const token = requireToken();
  return put(FAVORITES_PATHNAME, JSON.stringify(favorites, null, 2), {
    access: 'private',
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: 'application/json',
    token,
  });
}

const WHATSAPP_MESSAGES_PATHNAME = 'whatsapp/messages.json';
const WHATSAPP_PLUGIN_SECRET_PATHNAME = 'whatsapp/plugin-secret.json';

/**
 * Load the "WhatsApp Messages" store from Vercel Blob.
 * @returns {Promise<Array>} empty array if nothing has been stored yet
 */
export async function downloadWhatsAppMessages() {
  const token = requireToken();
  const result = await get(WHATSAPP_MESSAGES_PATHNAME, { access: 'private', token, useCache: false });
  if (!result) return [];

  const text = await new Response(result.stream).text();
  const parsed = JSON.parse(text);
  return Array.isArray(parsed) ? parsed : [];
}

/**
 * Overwrite the "WhatsApp Messages" store in Vercel Blob.
 * @param {Array} messages
 */
export async function saveWhatsAppMessages(messages) {
  const token = requireToken();
  return put(WHATSAPP_MESSAGES_PATHNAME, JSON.stringify(messages, null, 2), {
    access: 'private',
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: 'application/json',
    token,
  });
}

/**
 * Load the WhatsApp plugin's registration secret from Blob. Stored in Blob
 * rather than a local file because the scraper's Docker container is
 * recreated (not restarted) on every deploy, so anything written to local
 * disk is lost before the plugin gets a chance to reuse it.
 * @returns {Promise<string | undefined>}
 */
export async function loadWhatsAppPluginSecret() {
  const token = requireToken();
  const result = await get(WHATSAPP_PLUGIN_SECRET_PATHNAME, {
    access: 'private',
    token,
    useCache: false,
  });
  if (!result) return undefined;

  const text = await new Response(result.stream).text();
  return JSON.parse(text).secret;
}

/**
 * Persist the WhatsApp plugin's registration secret to Blob.
 * @param {string} secret
 */
export async function saveWhatsAppPluginSecret(secret) {
  const token = requireToken();
  return put(WHATSAPP_PLUGIN_SECRET_PATHNAME, JSON.stringify({ secret }), {
    access: 'private',
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: 'application/json',
    token,
  });
}
