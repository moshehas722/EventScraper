// Shared HTTP helper. Sends browser-like headers so requests pass through
// Cloudflare's basic bot protection (plain fetch gets a 403 challenge page).

import https from 'node:https';
import { URL } from 'node:url';

const BROWSER_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/126.0 Safari/537.36',
  Accept: 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9,he;q=0.8',
  'sec-ch-ua': '"Chromium";v="126", "Not:A-Brand";v="24"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"Windows"',
  'Sec-Fetch-Dest': 'empty',
  'Sec-Fetch-Mode': 'cors',
  'Sec-Fetch-Site': 'same-origin',
};

const REQUEST_TIMEOUT_MS = 30_000;
const MAX_ATTEMPTS = 4;
const RETRYABLE_HTTP = new Set([429, 502, 503, 504]);

/** @param {number} attempt zero-based attempt index */
function retryDelayMs(attempt) {
  return 500 * 2 ** attempt + Math.random() * 250;
}

/** @param {unknown} err */
function isRetryableNetworkError(err) {
  if (err instanceof Error && err.name === 'AbortError') return true;
  if (err instanceof TypeError && /fetch failed/i.test(err.message)) return true;
  const code = err instanceof Error && err.cause && typeof err.cause === 'object'
    ? /** @type {{ code?: string }} */ (err.cause).code
    : undefined;
  return (
    code === 'ECONNRESET' ||
    code === 'ETIMEDOUT' ||
    code === 'ECONNREFUSED' ||
    code === 'ENOTFOUND' ||
    code === 'EAI_AGAIN' ||
    code === 'UND_ERR_CONNECT_TIMEOUT' ||
    code === 'UND_ERR_HEADERS_TIMEOUT' ||
    code === 'UND_ERR_SOCKET'
  );
}

/** @param {unknown} err @param {string} url */
function formatFetchError(err, url) {
  const cause = err instanceof Error ? err.cause : undefined;
  const detail =
    cause && typeof cause === 'object' && 'code' in cause && cause.code
      ? String(cause.code)
      : err instanceof Error
        ? err.message
        : String(err);
  return new Error(`GET ${url} failed: ${detail}`);
}

/** @param {string} url @param {object} extraHeaders @param {(body: string) => unknown} parseBody @param {{ method?: string, body?: string }} [request] */
function fetchInsecure(url, extraHeaders, parseBody, request = {}) {
  const target = new URL(url);
  const method = request.method ?? 'GET';
  const headers = { ...BROWSER_HEADERS, ...extraHeaders };

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port || 443,
        path: `${target.pathname}${target.search}`,
        method,
        headers,
        rejectUnauthorized: false,
      },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          body += chunk;
        });
        res.on('end', () => {
          if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
            reject(
              new Error(`${method} ${url} -> HTTP ${res.statusCode} ${res.statusMessage ?? ''}`.trim()),
            );
            return;
          }
          try {
            resolve(parseBody(body));
          } catch (err) {
            reject(err);
          }
        });
      },
    );

    req.on('error', reject);
    req.setTimeout(REQUEST_TIMEOUT_MS, () => {
      req.destroy(new Error('Timeout'));
    });
    if (request.body) req.write(request.body);
    req.end();
  });
}

/**
 * Fetch a URL with browser-like headers.
 * Retries transient network failures and overloaded upstream responses.
 * @param {string} url
 * @param {object} [extraHeaders] e.g. { Referer, Origin } required by some sites
 * @param {(res: Response) => Promise<unknown>} parseBody
 * @param {{ insecureTls?: boolean }} [options]
 */
async function fetchWithRetry(url, extraHeaders, parseBody, options = {}) {
  if (options.insecureTls) {
    return fetchInsecure(url, extraHeaders, (body) => parseBody({ json: () => JSON.parse(body), text: () => body }));
  }

  let lastError;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { ...BROWSER_HEADERS, ...extraHeaders },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      if (!res.ok) {
        if (RETRYABLE_HTTP.has(res.status) && attempt < MAX_ATTEMPTS - 1) {
          await new Promise((r) => setTimeout(r, retryDelayMs(attempt)));
          continue;
        }
        throw new Error(`GET ${url} -> HTTP ${res.status} ${res.statusText}`);
      }

      return parseBody(res);
    } catch (err) {
      if (err instanceof Error && err.message.includes('-> HTTP')) throw err;

      lastError = err;
      if (attempt < MAX_ATTEMPTS - 1 && isRetryableNetworkError(err)) {
        await new Promise((r) => setTimeout(r, retryDelayMs(attempt)));
        continue;
      }
      throw formatFetchError(err, url);
    }
  }

  throw formatFetchError(lastError, url);
}

/**
 * Fetch a URL as JSON with browser-like headers.
 * @param {string} url
 * @param {object} [extraHeaders] e.g. { Referer, Origin } required by some sites
 * @param {{ insecureTls?: boolean }} [options] set insecureTls when the host serves an incomplete cert chain
 */
export async function fetchJson(url, extraHeaders = {}, options = {}) {
  return fetchWithRetry(url, extraHeaders, (res) => res.json(), options);
}

/**
 * Fetch a URL as text with browser-like headers.
 * @param {string} url
 * @param {{ insecureTls?: boolean }} [options] set insecureTls when the host serves an incomplete cert chain
 */
export async function fetchText(url, extraHeaders = {}, options = {}) {
  return fetchWithRetry(url, extraHeaders, (res) => res.text(), options);
}

/**
 * POST form data and parse the response as JSON.
 * @param {string} url
 * @param {Record<string, string>|URLSearchParams|string} body
 * @param {object} [extraHeaders]
 * @param {{ insecureTls?: boolean }} [options]
 */
export async function fetchPostJson(url, body, extraHeaders = {}, options = {}) {
  const payload =
    typeof body === 'string' ? body : new URLSearchParams(body).toString();
  const headers = {
    'Content-Type': 'application/x-www-form-urlencoded',
    ...extraHeaders,
  };

  if (options.insecureTls) {
    return fetchInsecure(url, headers, (raw) => JSON.parse(raw), {
      method: 'POST',
      body: payload,
    });
  }

  let lastError;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { ...BROWSER_HEADERS, ...headers },
        body: payload,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      if (!res.ok) {
        if (RETRYABLE_HTTP.has(res.status) && attempt < MAX_ATTEMPTS - 1) {
          await new Promise((r) => setTimeout(r, retryDelayMs(attempt)));
          continue;
        }
        throw new Error(`POST ${url} -> HTTP ${res.status} ${res.statusText}`);
      }

      return res.json();
    } catch (err) {
      if (err instanceof Error && err.message.includes('-> HTTP')) throw err;

      lastError = err;
      if (attempt < MAX_ATTEMPTS - 1 && isRetryableNetworkError(err)) {
        await new Promise((r) => setTimeout(r, retryDelayMs(attempt)));
        continue;
      }
      throw formatFetchError(err, url);
    }
  }

  throw formatFetchError(lastError, url);
}
