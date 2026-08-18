// Uploads/downloads the "WhatsApp Messages" store and the plugin's
// registration secret to/from the eventscraper-blob Vercel Blob store.

import { get, put } from '@vercel/blob';
import { requireToken } from '../blob.js';

const WHATSAPP_MESSAGES_PATHNAME = 'whatsapp/messages.json';
const WHATSAPP_EVENTS_PATHNAME = 'whatsapp/events.json';
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
 * Load the Portal-Event-shaped view of extracted WhatsApp events from Blob
 * (see src/portalEvent.js). Derived from, and pruned alongside, the raw
 * "WhatsApp Messages" store — only entries where the LLM found a real,
 * dateable event.
 * @returns {Promise<Array>} empty array if nothing has been stored yet
 */
export async function downloadWhatsAppEvents() {
  const token = requireToken();
  const result = await get(WHATSAPP_EVENTS_PATHNAME, { access: 'private', token, useCache: false });
  if (!result) return [];

  const text = await new Response(result.stream).text();
  const parsed = JSON.parse(text);
  return Array.isArray(parsed) ? parsed : [];
}

/**
 * Overwrite the Portal-Event-shaped WhatsApp events store in Vercel Blob.
 * @param {Array} events
 */
export async function saveWhatsAppEvents(events) {
  const token = requireToken();
  return put(WHATSAPP_EVENTS_PATHNAME, JSON.stringify(events, null, 2), {
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
