// Spotify: login (Authorization Code with PKCE) and Web API calls
// including token refresh, rate-limit handling and retries.
import { t } from './i18n.js';

const AUTH_URL = 'https://accounts.spotify.com/authorize';
const TOKEN_URL = 'https://accounts.spotify.com/api/token';
const API_URL = 'https://api.spotify.com/v1';
const SCOPES = ['playlist-read-private', 'playlist-read-collaborative', 'playlist-modify-public', 'playlist-modify-private'];
const TOKEN_KEY = 'pp.token';
const PKCE_KEY = 'pp.pkce';

export class AuthError extends Error {
  name = 'AuthError';
}

export class ApiError extends Error {
  name = 'ApiError';
  constructor(status, message) {
    super(message);
    this.status = status;
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

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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
    const hint = /regist|premium|developer|not.*allow/i.test(msg) ? t('api.forbiddenHint') : '';
    return t('api.forbidden', { message }) + hint;
  }
  if (status === 404) return t('api.notFound', { message });
  return t('api.error', { status, message });
}

export class SpotifyClient {
  constructor(clientId) {
    this.clientId = clientId;
    this.refreshing = null;
    this.onWait = null; // callback(ms) while waiting because of rate limits
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

  async request(method, path, { query, body } = {}) {
    const url = path.startsWith('https://') ? path : `${API_URL}${path}${query ? `?${new URLSearchParams(query)}` : ''}`;
    // POST requests are not retried on server/network errors to avoid duplicate playlist entries
    const idempotent = method === 'GET';
    let forceRefresh = false;

    for (let attempt = 0; ; attempt++) {
      const token = await this.accessToken(forceRefresh);
      forceRefresh = false;

      let res;
      try {
        res = await fetch(url, {
          method,
          headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
          body: body ? JSON.stringify(body) : undefined,
        });
      } catch {
        if (!idempotent || attempt >= 3) throw new ApiError(0, t('api.offline'));
        await sleep(1000 * 2 ** attempt);
        continue;
      }

      if (res.status === 401) {
        if (attempt === 0) { forceRefresh = true; continue; }
        logout();
        throw new AuthError(t('auth.rejected'));
      }

      const retryable = res.status === 429 || (idempotent && res.status >= 500);
      if (retryable && attempt < 6) {
        const text = await res.text().catch(() => '');
        if (res.status === 429 && /quota/i.test(text)) throw new ApiError(429, t('api.quota'));
        // Retry-After is not exposed via CORS in every case, so fall back to exponential backoff
        const retryAfter = Number(res.headers.get('Retry-After'));
        const wait = retryAfter > 0 ? retryAfter * 1000 : Math.min(2000 * 2 ** attempt, 30000);
        this.onWait?.(wait);
        await sleep(wait);
        continue;
      }

      if (res.status === 204) return null;
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new ApiError(res.status, apiErrorText(res.status, data));
      return data;
    }
  }

  me() {
    return this.request('GET', '/me');
  }

  async search(q, { limit = 10, offset = 0 } = {}) {
    const data = await this.request('GET', '/search', { query: { q, type: 'track', limit, offset, market: 'from_token' } });
    return (data?.tracks?.items || []).filter(Boolean);
  }

  getTrack(id) {
    return this.request('GET', `/tracks/${encodeURIComponent(id)}`, { query: { market: 'from_token' } });
  }

  /** All playlists of the user, including followed ones (the UI filters them). */
  async myPlaylists() {
    const all = [];
    let url = '/me/playlists?limit=50';
    while (url) {
      const page = await this.request('GET', url);
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
      const page = await this.request('GET', url);
      for (const it of page?.items || []) {
        const uri = (it.item || it.track)?.uri;
        if (uri) uris.add(uri);
      }
      url = page?.next;
    }
    return uris;
  }

  createPlaylist({ name, isPublic = false, description = '' }) {
    return this.request('POST', '/me/playlists', { body: { name, public: isPublic, description } });
  }

  /** Adds tracks in chunks of 100. On failure, err.added holds the number already added. */
  async addTracks(playlistId, uris, onProgress) {
    let added = 0;
    try {
      for (let i = 0; i < uris.length; i += 100) {
        const chunk = uris.slice(i, i + 100);
        await this.request('POST', `/playlists/${encodeURIComponent(playlistId)}/items`, { body: { uris: chunk } });
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
