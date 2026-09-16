// Matching: search strategy against the Spotify search and scoring of results (0..1).

export const SCORE_SURE = 0.85; // from here on "confident"
export const SCORE_ACCEPT = 0.6; // from here on selected automatically, below "uncertain"

// Version hints that may indicate a different recording than wanted (weight = penalty)
const VERSION_TAGS = [
  ['live', 0.25], ['karaoke', 0.5], ['instrumental', 0.35], ['acoustic', 0.2], ['akustik', 0.2],
  ['remix', 0.25], ['rmx', 0.25], ['mix', 0.1], ['cover', 0.3], ['tribute', 0.4], ['demo', 0.2],
  ['unplugged', 0.2], ['sped up', 0.4], ['slowed', 0.4], ['nightcore', 0.5], ['8 bit', 0.4],
  ['lullaby', 0.4], ['piano', 0.2], ['orchestral', 0.2], ['extended', 0.1], ['a cappella', 0.3],
  ['acapella', 0.3], ['medley', 0.3], ['in the style of', 0.5], ['originally performed', 0.5], ['made famous', 0.5],
].map(([tag, weight]) => [normalize(tag), weight]);

// Version suffixes that do not change the content ("Remastered 2011", "Single Version", ...)
const NEUTRAL_VERSION_WORDS = new Set(
  ['remaster', 'remastered', 'remasterd', 'digital', 'digitally', 'version', 'deluxe', 'edition', 'mono', 'stereo', 'original', 'single', 'album', 'the'].map(normalize),
);

const IMITATOR_ARTIST_RE = /karaoke|tribute|cover band|hit crew|in the style/i;

/** Normalizes text for comparison: lower case, no accents/umlauts, no punctuation. */
export function normalize(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ß/g, 'ss')
    .replace(/[’'`´]/g, '')
    .replace(/[&+]/g, ' and ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/ae|oe|ue/g, (m) => m[0]) // "Aerzte" == "Ärzte"
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^the /, '');
}

/** Similarity of two normalized strings (bigram Dice coefficient or word overlap). */
export function similarity(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const A = bigrams(a);
  const B = bigrams(b);
  let inter = 0;
  for (const [g, n] of A.map) inter += Math.min(n, B.map.get(g) || 0);
  const dice = A.size + B.size ? (2 * inter) / (A.size + B.size) : 0;
  const ta = new Set(a.split(' '));
  const tb = new Set(b.split(' '));
  let common = 0;
  for (const w of ta) if (tb.has(w)) common++;
  return Math.max(dice, common / Math.max(ta.size, tb.size));
}

function bigrams(s) {
  const text = s.replace(/ /g, '');
  const map = new Map();
  for (let i = 0; i < text.length - 1; i++) {
    const g = text.slice(i, i + 2);
    map.set(g, (map.get(g) || 0) + 1);
  }
  return { map, size: Math.max(text.length - 1, 0) };
}

/** Splits "Song (Radio Edit)" / "Song - Remastered 2011" into the core title and version parts. */
export function splitTitle(title) {
  const original = String(title || '');
  const versions = [];
  let rest = original.replace(/\s*[([]([^)\]]*)[)\]]/g, (_, v) => { versions.push(v); return ' '; });
  rest = rest.replace(/\s+[-–—]\s+(.*)$/, (_, v) => { versions.push(v); return ''; });
  rest = rest.replace(/\s+(?:feat\.?|ft\.|featuring)\s+.*$/i, '');
  return { core: rest.trim() || original, version: versions.join(' '), versions };
}

/** Relevant version words, e.g. {radio, edit} – without "feat." credits and neutral suffixes. */
function versionWords(title) {
  const words = new Set();
  for (const v of splitTitle(title).versions) {
    const withoutFeat = v.replace(/(?:^|\s)(?:feat\.?|ft\.|featuring|with)\s.*$/i, '');
    for (const w of normalize(withoutFeat).split(' ')) {
      if (w && !NEUTRAL_VERSION_WORDS.has(w) && !/^\d+$/.test(w)) words.add(w);
    }
  }
  return words;
}

/** 1 = same version, lower = different (wanted version missing or another version). */
function versionMatch(inputTitle, candTitle) {
  const a = versionWords(inputTitle);
  const b = versionWords(candTitle);
  if (!a.size && !b.size) return 1;
  if (!a.size) return 0.9;
  if (!b.size) return 0.85;
  let common = 0;
  for (const w of a) if (b.has(w)) common++;
  return 0.85 + 0.15 * (common / new Set([...a, ...b]).size);
}

function splitArtists(s) {
  return String(s || '')
    .split(/\s+(?:feat\.?|ft\.|featuring|vs\.?|x|with|mit|und|and)\s+|\s*[,;/&+]\s*/i)
    .map(normalize)
    .filter(Boolean);
}

function primaryArtist(artist) {
  return String(artist || '').split(/\s+(?:feat\.?|ft\.|featuring|vs\.?|x)\s+|\s*[,;/]\s*|\s+&\s+/i)[0] || artist;
}

function scoreArtist(artist, candArtists) {
  const names = candArtists.map((a) => normalize(a.name)).filter(Boolean);
  if (!names.length) return 0;
  const full = normalize(artist);
  const parts = splitArtists(artist);
  const best = (x) => Math.max(...names.map((n) => similarity(x, n)));
  const joined = similarity(full, names.join(' '));
  const single = best(full);
  const primary = parts.length ? best(parts[0]) : 0;
  const coverage = parts.length ? parts.filter((p) => best(p) >= 0.8).length / parts.length : 0;
  return Math.max(joined, single, 0.85 * primary + 0.15 * coverage);
}

function hasTag(text, tag) {
  return ` ${text} `.includes(` ${tag} `);
}

function versionPenalty(inputText, track) {
  const input = normalize(inputText);
  const candVersion = normalize(splitTitle(track.name).version);
  const candName = normalize(track.name);
  const album = normalize(track.album?.name);
  let penalty = 0;
  for (const [tag, weight] of VERSION_TAGS) {
    const inInput = hasTag(input, tag);
    if (hasTag(candVersion, tag) && !inInput) penalty += weight;
    else if (hasTag(album, tag) && !inInput) penalty += weight / 2;
    else if (inInput && !hasTag(candName, tag) && !hasTag(album, tag)) penalty += weight / 2;
  }
  return Math.min(penalty, 0.6);
}

function scorePair(artist, title, entry, track) {
  const titleFull = similarity(normalize(title), normalize(track.name));
  const titleCore = similarity(normalize(splitTitle(title).core), normalize(splitTitle(track.name).core));
  const version = versionMatch(title, track.name);
  const titleScore = Math.max(titleFull, titleCore * version);
  const artistScore = scoreArtist(artist, track.artists || []);
  let score = 0.55 * titleScore + 0.45 * artistScore;
  score -= versionPenalty(`${title} ${entry.album || ''}`, track);
  if ((track.artists || []).some((a) => IMITATOR_ARTIST_RE.test(a.name)) && !IMITATOR_ARTIST_RE.test(artist)) score -= 0.4;
  return { score, titleScore, artistScore, versionMatch: version };
}

function scoreQuery(query, track) {
  const q = normalize(query).split(' ').filter(Boolean);
  const artists = (track.artists || []).map((a) => a.name).join(' ');
  const c = new Set(normalize(`${artists} ${splitTitle(track.name).core}`).split(' ').filter(Boolean));
  if (!q.length || !c.size) return { score: 0, versionMatch: 1 };
  const hits = q.filter((w) => c.has(w)).length;
  const score = 0.7 * (hits / q.length) + 0.3 * (hits / c.size) - versionPenalty(query, track);
  return { score, versionMatch: 1 };
}

/** Scores a Spotify track against a list entry. */
export function scoreTrack(entry, track, { rank = 0, order = 'auto', viaIsrc = false } = {}) {
  let result;
  if (entry.artist && entry.title) {
    result = scorePair(entry.artist, entry.title, entry, track);
    if (order === 'auto') {
      const swapped = scorePair(entry.title, entry.artist, entry, track);
      if (swapped.score > result.score + 0.05) result = { ...swapped, swapped: true };
    }
  } else if (entry.query || entry.title || entry.artist) {
    result = scoreQuery(entry.query || entry.title || entry.artist, track);
  } else {
    result = { score: viaIsrc ? 0.9 : 0, versionMatch: 1 };
  }

  let score = result.score;
  if (viaIsrc) score += 0.15;
  if (entry.durationMs && track.duration_ms) {
    const diff = Math.abs(entry.durationMs - track.duration_ms) / 1000;
    if (diff <= 3) score += 0.03;
    else if (diff >= 30) score -= 0.1;
    else if (diff >= 15) score -= 0.05;
  }
  if (entry.album && similarity(normalize(entry.album), normalize(track.album?.name)) >= 0.8) score += 0.04;
  if (track.album?.album_type === 'compilation') score -= 0.03;
  if (track.is_playable === false) score -= 0.15;
  score += 0.02 * (1 - Math.min(rank, 10) / 10); // Spotify's relevance order as a tie-breaker

  return { ...result, score: Math.max(0, Math.min(1, score)) };
}

function queryValue(s) {
  return String(s || '').replace(/[":]/g, ' ').replace(/\s+/g, ' ').trim();
}

/** True if both queries consist of the same words (in any order). */
function sameWords(a, b) {
  const words = (s) => [...new Set(normalize(s).split(' '))].sort().join(' ');
  return words(a) === words(b);
}

/**
 * Finds matching tracks for an entry.
 * search(q) -> Promise<Track[]>, getTrack(id) -> Promise<Track>
 * Result: candidates [{ track, score, swapped }] sorted by score, best first.
 */
export async function findCandidates(entry, { search, getTrack, order = 'auto' }) {
  if (entry.uri) {
    const track = await getTrack(entry.uri.split(':').pop());
    return track ? [{ track, score: 1 }] : [];
  }

  const pool = new Map();
  const queried = new Set();
  let lastError = null;
  const ranked = () =>
    [...pool.values()]
      .map(({ track, rank, viaIsrc }) => ({ track, ...scoreTrack(entry, track, { rank, order, viaIsrc }) }))
      .sort((a, b) => b.score - a.score);
  const best = () => ranked()[0];
  const weak = (min) => !best() || best().score < min;
  const run = async (q, viaIsrc = false) => {
    if (!q || queried.has(q)) return;
    queried.add(q);
    try {
      const tracks = await search(q);
      tracks.forEach((track, rank) => {
        if (track?.id && !pool.has(track.id)) pool.set(track.id, { track, rank, viaIsrc });
      });
    } catch (err) {
      // Stop right away if searching on is pointless: cancelled, logged out, quota or access problems
      if (err?.name === 'AuthError' || err?.name === 'AbortError' || err?.fatal) throw err;
      lastError = err;
    }
  };

  if (entry.isrc) await run(`isrc:${entry.isrc}`, true);

  if (entry.artist && entry.title && weak(0.9)) {
    // Requests are limited: one free-text search finds most tracks in any order and version.
    // Only if nothing fits, a second, simpler search follows (core title + main artist, or the title alone).
    const first = queryValue(`${entry.artist} ${entry.title}`);
    const simple = queryValue(`${splitTitle(entry.title).core} ${primaryArtist(entry.artist)}`);
    await run(first);
    if (weak(SCORE_ACCEPT)) await run(sameWords(first, simple) ? queryValue(splitTitle(entry.title).core) : simple);
  } else if (!entry.isrc || weak(SCORE_ACCEPT)) {
    const text = entry.query || [entry.artist, entry.title].filter(Boolean).join(' ');
    await run(queryValue(text));
    // Badly formatted lines such as "QUEEN-BOHEMIAN_RHAPSODY": one more try with separators as spaces
    if (weak(SCORE_ACCEPT)) await run(queryValue(text.replace(/[-_/|.,;]+/g, ' ')));
  }

  if (!pool.size && lastError) throw lastError;
  // Five alternatives are enough for the review and keep the saved session small for long lists
  return ranked().slice(0, 5);
}
