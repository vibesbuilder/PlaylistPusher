// Spotify: login (Authorization Code with PKCE) and Web API calls with request pacing,
// token refresh, rate-limit/quota handling and cancellation.
import { t } from './i18n.js';

const AUTH_URL = 'https://accounts.spotify.com/authorize';
const TOKEN_URL = 'https://accounts.spotify.com/api/token';
const API_URL = 'https://api.spotify.com/v1';
const SCOPES = ['playlist-read-private', 'playlist-read-collaborative', 'playlist-modify-public', 'playlist-modify-private'];
const TOKEN_KEY = 'pp.token';
const PKCE_KEY = 'pp.pkce';

// Development Mode apps share a small request quota per developer account,
// so requests are spread out and rate limits are retried only a few times.
const MIN_INTERVAL_MS = 400;
const MAX_INTERVAL_MS = 3000;
const MAX_RATE_LIMIT_RETRIES = 3;
const MAX_WAIT_MS = 60000;
const SEARCH_CACHE_SIZE = 500;

export class AuthError extends Error {
  name = 'AuthError';
}

export class ApiError extends Error {
  name = 'ApiError';
  constructor(status, message, { fatal = false, retryAfter = null } = {}) {
    super(message);
    this.status = status;
    this.fatal = fatal; // further requests are pointless for now (quota, rate limit, access denied)
    this.retryAfter = retryAfter; // seconds, if Spotify sent a Retry-After header
  }
}

export const redirectUri = () => `${location.origin}/callback`;

const store = {
  get(key) {
    try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage not available */ }
  },
  del(key) {
    try { localStorage.removeItem(key); } catch { /* storage not available */ }
  },
};

const abortError = () => new DOMException('Aborted', 'AbortError');

/** Waits ms milliseconds; rejects with an AbortError when the signal is aborted. */
export function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError());
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError());
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function randomString(length) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  return Array.from(crypto.getRandomValues(new Uint8Array(length)), (x) => chars[x % chars.length]).join('');
}

function base64url(buffer) {
  return btoa(String.fromCharCode(...new Uint8Array(buffer))).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

/** Redirects to the Spotify login. */
export async function startLogin(clientId) {
  const verifier = randomString(64);
  const state = randomString(16);
  const challenge = base64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  store.set(PKCE_KEY, { verifier, state, clientId });
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: redirectUri(),
    scope: SCOPES.join(' '),
    code_challenge_method: 'S256',
    code_challenge: challenge,
    state,
  });
  location.assign(`${AUTH_URL}?${params}`);
}

/** Handles the return from Spotify (/callback). Returns true once logged in. */
export async function completeLogin() {
  if (location.pathname !== '/callback') return false;
  const params = new URLSearchParams(location.search);
  history.replaceState(null, '', '/');
  const pkce = store.get(PKCE_KEY);
  store.del(PKCE_KEY);

  const error = params.get('error');
  if (error) throw new AuthError(error === 'access_denied' ? t('auth.cancelled') : t('auth.failed', { error }));
  if (!pkce || params.get('state') !== pkce.state) throw new AuthError(t('auth.invalidState'));

  const data = await tokenRequest({
    grant_type: 'authorization_code',
    code: params.get('code'),
    redirect_uri: redirectUri(),
    client_id: pkce.clientId,
    code_verifier: pkce.verifier,
  });
  saveToken(data, pkce.clientId);
  return true;
}

async function tokenRequest(body) {
  let res;
  try {
    res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(body),
    });
  } catch {
    throw new ApiError(0, t('api.offline'));
  }
  const data = await res.json().catch(() => ({}));
  if (res.ok) return data;
  const messages = {
    invalid_client: () => t('auth.invalidClient'),
    invalid_grant: () => t('auth.expired'),
    invalid_request: () => t('auth.invalidRequest', { details: data.error_description || data.error }),
  };
  throw new AuthError(messages[data.error]?.() || t('auth.failed', { error: data.error_description || data.error || res.status }));
}

function saveToken(data, clientId, previous) {
  store.set(TOKEN_KEY, {
    clientId,
    access: data.access_token,
    refresh: data.refresh_token || previous?.refresh,
    expiresAt: Date.now() + (Number(data.expires_in || 3600) - 60) * 1000,
  });
}

export const hasSession = (clientId) => store.get(TOKEN_KEY)?.clientId === clientId;
export const logout = () => store.del(TOKEN_KEY);

function apiErrorText(status, data) {
  const msg = data?.error?.message || data?.error_description || '';
  const message = msg ? `: ${msg}` : '';
  if (status === 403) {
    let hint = '';
    if (/regist|premium|developer|not.*allow/i.test(msg)) hint = t('api.forbiddenHint');
    else if (/scope/i.test(msg)) hint = t('api.scopeHint');
    return t('api.forbidden', { message }) + hint;
  }
  if (status === 404) return t('api.notFound', { message });
  return t('api.error', { status, message });
}

const retryText = (seconds) => (seconds ? t('api.retryIn', { minutes: Math.max(1, Math.ceil(seconds / 60)) }) : t('api.retryLater'));
const withContext = (context, message) => (context ? `${t(context)}: ${message}` : message);

export class SpotifyClient {
  constructor(clientId) {
    this.clientId = clientId;
    this.refreshing = null;
    this.onWait = null; // callback(ms) while waiting because of rate limits
    this.interval = MIN_INTERVAL_MS;
    this.nextSlot = 0;
    this.searchCache = new Map();
  }

  async accessToken(forceRefresh = false) {
    const token = store.get(TOKEN_KEY);
    if (!token || token.clientId !== this.clientId) throw new AuthError(t('auth.notLoggedIn'));
    if (!forceRefresh && Date.now() < token.expiresAt) return token.access;
    if (!token.refresh) throw new AuthError(t('auth.expired'));
    this.refreshing ??= tokenRequest({ grant_type: 'refresh_token', refresh_token: token.refresh, client_id: this.clientId })
      .then((data) => {
        saveToken(data, this.clientId, token);
        return data.access_token;
      })
      .catch((err) => {
        if (err instanceof AuthError) logout();
        throw err;
      })
      .finally(() => {
        this.refreshing = null;
      });
    return this.refreshing;
  }

  /** Waits for the next free request slot, so requests are spread out evenly. */
  async pace(signal) {
    const now = Date.now();
    const start = Math.max(now, this.nextSlot);
    this.nextSlot = start + this.interval;
    if (start > now) await sleep(start - now, signal);
  }

  async request(method, path, { query, body, signal, context } = {}) {
    const url = path.startsWith('https://') ? path : `${API_URL}${path}${query ? `?${new URLSearchParams(query)}` : ''}`;
    // POST requests are not retried on server/network errors to avoid duplicate playlist entries
    const idempotent = method === 'GET';
    let refreshed = false;
    let forceRefresh = false;
    let networkRetries = 0;
    let serverRetries = 0;
    let rateLimitRetries = 0;

    for (;;) {
      await this.pace(signal);
      const token = await this.accessToken(forceRefresh);
      forceRefresh = false;

      let res;
      try {
        res = await fetch(url, {
          method,
          headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
          body: body ? JSON.stringify(body) : undefined,
          signal,
        });
      } catch (err) {
        if (err.name === 'AbortError') throw err;
        if (!idempotent || networkRetries >= 2) throw new ApiError(0, withContext(context, t('api.offline')));
        networkRetries++;
        await sleep(1000 * 2 ** networkRetries, signal);
        continue;
      }

      if (res.status === 401) {
        if (!refreshed) {
          refreshed = true;
          forceRefresh = true;
          continue;
        }
        logout();
        throw new AuthError(t('auth.rejected'));
      }

      if (res.status === 429) {
        const data = await res.json().catch(() => null);
        const retryAfter = Number(res.headers.get('Retry-After')) || null;
        this.logFailure(method, url, res.status, data);
        if (data?.error?.reason === 'QUOTA_EXCEEDED' || /quota/i.test(JSON.stringify(data ?? ''))) {
          throw new ApiError(429, withContext(context, `${t('api.quota')} ${retryText(retryAfter)}`), { fatal: true, retryAfter });
        }
        const wait = retryAfter ? retryAfter * 1000 : 5000 * (rateLimitRetries + 1);
        if (rateLimitRetries >= MAX_RATE_LIMIT_RETRIES || wait > MAX_WAIT_MS) {
          throw new ApiError(429, withContext(context, `${t('api.rateLimited')} ${retryText(retryAfter)}`), { fatal: true, retryAfter });
        }
        rateLimitRetries++;
        this.interval = Math.min(this.interval * 2, MAX_INTERVAL_MS); // slow down for the rest of the session
        this.nextSlot = Math.max(this.nextSlot, Date.now() + wait);
        this.onWait?.(wait);
        continue;
      }

      if (res.status >= 500 && idempotent && serverRetries < 2) {
        serverRetries++;
        this.nextSlot = Math.max(this.nextSlot, Date.now() + 2000 * serverRetries);
        continue;
      }

      if (res.status === 204) return null;
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        this.logFailure(method, url, res.status, data);
        throw new ApiError(res.status, withContext(context, apiErrorText(res.status, data)), { fatal: res.status === 403 });
      }
      return data;
    }
  }

  logFailure(method, url, status, data) {
    console.warn(`[Spotify] ${method} ${url.replace(API_URL, '').split('?')[0]} → ${status}`, data?.error ?? data);
  }

  me() {
    return this.request('GET', '/me', { context: 'api.ctx.profile' });
  }

  /** Track search. Identical queries are answered from a cache to save requests. */
  async search(q, { limit = 10, offset = 0, signal } = {}) {
    const key = `${q.trim().toLowerCase()}|${limit}|${offset}`;
    if (this.searchCache.has(key)) return this.searchCache.get(key);
    // No market parameter: with a user token Spotify uses the country of the account
    const data = await this.request('GET', '/search', { query: { q, type: 'track', limit, offset }, signal, context: 'api.ctx.search' });
    const tracks = (data?.tracks?.items || []).filter(Boolean);
    if (this.searchCache.size >= SEARCH_CACHE_SIZE) this.searchCache.delete(this.searchCache.keys().next().value);
    this.searchCache.set(key, tracks);
    return tracks;
  }

  getTrack(id, { signal } = {}) {
    return this.request('GET', `/tracks/${encodeURIComponent(id)}`, { signal, context: 'api.ctx.track' });
  }

  /** All playlists of the user, including followed ones (the UI filters them). */
  async myPlaylists() {
    const all = [];
    let url = '/me/playlists?limit=50';
    while (url) {
      const page = await this.request('GET', url, { context: 'api.ctx.playlists' });
      all.push(...(page?.items || []).filter(Boolean));
      url = page?.next;
    }
    return all;
  }

  /** URIs of all tracks in an owned or collaborative playlist. */
  async playlistTrackUris(playlistId) {
    const uris = new Set();
    let url = `/playlists/${encodeURIComponent(playlistId)}/items?limit=50&additional_types=track`;
    while (url) {
      const page = await this.request('GET', url, { context: 'api.ctx.playlistItems' });
      for (const it of page?.items || []) {
        const uri = (it.item || it.track)?.uri;
        if (uri) uris.add(uri);
      }
      url = page?.next;
    }
    return uris;
  }

  createPlaylist({ name, isPublic = false, description = '' }) {
    return this.request('POST', '/me/playlists', { body: { name, public: isPublic, description }, context: 'api.ctx.createPlaylist' });
  }

  /** Adds tracks in chunks of 100. On failure, err.added holds the number already added. */
  async addTracks(playlistId, uris, onProgress) {
    let added = 0;
    try {
      for (let i = 0; i < uris.length; i += 100) {
        const chunk = uris.slice(i, i + 100);
        await this.request('POST', `/playlists/${encodeURIComponent(playlistId)}/items`, { body: { uris: chunk }, context: 'api.ctx.addTracks' });
        added += chunk.length;
        onProgress?.(added, uris.length);
      }
    } catch (err) {
      err.added = added;
      throw err;
    }
    return added;
  }
}
