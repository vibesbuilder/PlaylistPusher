// Input parser: turns a track list (text, CSV/TSV, M3U, Spotify links, ISRC)
// into uniform entries { artist, title, query, uri, isrc, album, durationMs, error }.

const TRACK_LINK_RE = /(?:open\.spotify\.com\/(?:intl-[a-z]{2}(?:-[a-z]{2})?\/)?track\/|spotify:track:)([A-Za-z0-9]{22})/i;
const OTHER_LINK_RE = /open\.spotify\.com\/(?:intl-[a-z-]+\/)?(?:album|playlist|artist|episode|show)\/|spotify:(?:album|playlist|artist|episode|show):/i;
const ISRC_RE = /^([A-Z]{2})-?([A-Z0-9]{3})-?(\d{2})-?(\d{5})$/i;
const AUDIO_FILE_RE = /\.(mp3|mp2|flac|wav|m4a|aac|ogg|opus|wma|aiff?)$/i;
const SEPARATORS = [' - ', ' – ', ' — ', ' ‒ ', ' | ', ' / '];

// Recognized column headers (English and German)
const HEADER_ALIASES = {
  uri: ['uri', 'spotify uri', 'track uri', 'spotify url', 'track url', 'spotify link', 'link', 'url', 'spotify id', 'track id'],
  artist: ['artist', 'artists', 'artist name', 'artist name(s)', 'artist names', 'interpret', 'interpreten', 'interpret(en)', 'künstler', 'kuenstler', 'performer', 'band'],
  title: ['title', 'titel', 'track', 'track name', 'trackname', 'track title', 'song', 'song title', 'songtitel', 'musiktitel', 'name', 'werktitel'],
  album: ['album', 'album name', 'albumtitel', 'album title'],
  isrc: ['isrc'],
  duration: ['duration', 'duration (ms)', 'duration_ms', 'dauer', 'länge', 'laenge', 'length', 'spieldauer'],
};

/** Decodes file contents: UTF-8 (with/without BOM), UTF-16 (with BOM), otherwise Windows-1252. */
export function decodeBytes(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (u8[0] === 0xef && u8[1] === 0xbb && u8[2] === 0xbf) return new TextDecoder('utf-8').decode(u8.subarray(3));
  if (u8[0] === 0xff && u8[1] === 0xfe) return new TextDecoder('utf-16le').decode(u8.subarray(2));
  if (u8[0] === 0xfe && u8[1] === 0xff) return new TextDecoder('utf-16be').decode(u8.subarray(2));
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(u8);
  } catch {
    return new TextDecoder('windows-1252').decode(u8);
  }
}

/** Returns the track ID from a Spotify link/URI, or null. */
export function parseSpotifyTrackId(text) {
  const m = String(text || '').match(TRACK_LINK_RE);
  return m ? m[1] : null;
}

/**
 * Parses a complete list.
 * order: 'auto' | 'artist-title' | 'title-artist'
 */
export function parseList(text, { order = 'auto' } = {}) {
  const lines = String(text || '').replace(/^﻿/, '').split(/\r\n|\r|\n/);
  const table = detectTable(lines);
  const entries = [];

  if (table) {
    for (let i = table.headerIndex + 1; i < lines.length; i++) {
      if (!lines[i].trim()) continue;
      const e = entryFromCells(splitCsvLine(lines[i], table.delimiter), table.columns, order);
      if (e) entries.push({ ...e, line: i + 1, raw: lines[i].trim() });
    }
    return { entries, format: table.delimiter === '\t' ? 'TSV' : 'CSV' };
  }

  let m3u = false;
  let extinf = null;
  const pushEntry = (e, line, raw) => e && entries.push({ ...e, line, raw });

  lines.forEach((rawLine, i) => {
    const line = rawLine.trim();
    if (!line) return;
    if (/^#EXTM3U/i.test(line)) { m3u = true; return; }
    const inf = line.match(/^#EXTINF:\s*(-?\d+)[^,]*,(.*)$/i);
    if (inf) {
      m3u = true;
      extinf = { seconds: Number(inf[1]), text: inf[2].trim(), line: i + 1 };
      return;
    }
    if (line.startsWith('#') || line.startsWith('//')) return;

    if (extinf) {
      // The line after #EXTINF is the file path or link of that entry
      const fromPath = parseSpotifyTrackId(line) ? parseLine(line, order) : null;
      const e = fromPath || parseLine(extinf.text || fileBaseName(line), order);
      if (e && extinf.seconds > 0) e.durationMs = extinf.seconds * 1000;
      pushEntry(e, extinf.line, extinf.text || line);
      extinf = null;
      return;
    }
    pushEntry(parseLine(AUDIO_FILE_RE.test(line) ? fileBaseName(line) : line, order), i + 1, line);
  });
  if (extinf?.text) {
    const e = parseLine(extinf.text, order);
    if (e && extinf.seconds > 0) e.durationMs = extinf.seconds * 1000;
    pushEntry(e, extinf.line, extinf.text);
  }
  return { entries, format: m3u ? 'M3U' : 'Text' };
}

/** Parses a single line. Errors are returned as translation keys (e.g. 'unsupportedLink'). */
export function parseLine(input, order = 'auto') {
  let s = String(input || '').trim();
  if (!s) return null;

  const id = parseSpotifyTrackId(s);
  if (id) return { uri: `spotify:track:${id}` };
  if (OTHER_LINK_RE.test(s)) return { error: 'unsupportedLink' };

  const isrc = s.replace(/\s+/g, '').match(ISRC_RE);
  if (isrc) return { isrc: isrc.slice(1).join('').toUpperCase() };

  s = stripPrefixes(s);
  if (s.includes('\t')) {
    let fields = s.split('\t').map((f) => f.trim()).filter(Boolean);
    fields = fields.filter((f) => !/^\d{1,2}:\d{2}(?::\d{2})?$/.test(f));
    if (fields.length >= 3 && /^\d+$/.test(fields[0])) fields.shift();
    if (fields.length >= 2) return withOrder(fields[0], fields[1], order);
    s = fields[0] || '';
  }

  const split = splitBySeparator(s, order);
  if (split) return split;

  const semi = s.split(';').map((x) => x.trim()).filter(Boolean);
  if (semi.length === 2) return withOrder(semi[0], semi[1], order);

  const query = unquote(s);
  return query ? { query } : null;
}

function withOrder(a, b, order) {
  const [artist, title] = order === 'title-artist' ? [b, a] : [a, b];
  return { artist: unquote(artist), title: unquote(title) };
}

function splitBySeparator(s, order) {
  const fromEnd = order === 'title-artist';
  let best = null;
  for (const sep of SEPARATORS) {
    const idx = fromEnd ? s.lastIndexOf(sep) : s.indexOf(sep);
    if (idx <= 0 || idx + sep.length >= s.length) continue;
    if (!best || (fromEnd ? idx > best.idx : idx < best.idx)) best = { idx, sep };
  }
  if (!best) return null;
  const a = s.slice(0, best.idx).trim();
  const b = s.slice(best.idx + best.sep.length).trim();
  return a && b ? withOrder(a, b, order) : null;
}

// Removes timestamps, dates and numbering at the start of a line
function stripPrefixes(s) {
  return s
    .replace(/^\[?\d{4}-\d{2}-\d{2}(?:[ T]\d{1,2}:\d{2}(?::\d{2})?)?\]?\s+/, '')
    .replace(/^\[?\d{1,2}\.\d{1,2}\.\d{2,4}(?:,?\s+\d{1,2}:\d{2}(?::\d{2})?)?\]?\s+/, '')
    .replace(/^\[?\d{1,2}:\d{2}(?::\d{2})?\]?\s*(?:[-–|]\s+)?(?=\S)/, '')
    .replace(/^#?\d{1,4}[.)]\s+/, '')
    .trim();
}

function unquote(s) {
  return String(s || '').trim().replace(/^["'„“‚‘»«](.*)["'“”‘’«»]$/, '$1').trim();
}

function fileBaseName(path) {
  const base = path.split(/[\\/]/).pop().replace(AUDIO_FILE_RE, '').replace(/_/g, ' ');
  return base.replace(/^\d{1,3}\s*[-.]?\s+/, '').trim();
}

function detectTable(lines) {
  const idx = lines.findIndex((l) => l.trim());
  if (idx < 0) return null;
  const header = lines[idx];
  const [delimiter, count] = ['\t', ';', ',']
    .map((d) => [d, splitCsvLine(header, d).length - 1])
    .sort((a, b) => b[1] - a[1])[0];
  if (!count) return null;

  const cells = splitCsvLine(header, delimiter).map((c) => c.toLowerCase());
  const columns = {};
  for (const [key, aliases] of Object.entries(HEADER_ALIASES)) {
    const col = cells.findIndex((c) => aliases.includes(c));
    if (col >= 0) columns[key] = col;
  }
  if (!('title' in columns) && !('uri' in columns) && !('isrc' in columns)) return null;
  if ('duration' in columns) columns.durationIsMs = /ms/.test(cells[columns.duration]);
  return { headerIndex: idx, delimiter, columns };
}

function entryFromCells(cells, cols, order) {
  const get = (key) => (key in cols ? (cells[cols[key]] ?? '').trim() : '');
  const artist = unquote(get('artist'));
  const title = unquote(get('title'));
  const base = { album: get('album') || null, durationMs: parseDuration(get('duration'), cols.durationIsMs) };

  const uriCell = get('uri');
  const id = parseSpotifyTrackId(uriCell) || (/^[A-Za-z0-9]{22}$/.test(uriCell) ? uriCell : null);
  if (id) return { ...base, uri: `spotify:track:${id}`, artist, title };

  const isrc = get('isrc').replace(/\s+/g, '').match(ISRC_RE);
  if (isrc) return { ...base, isrc: isrc.slice(1).join('').toUpperCase(), artist, title };

  if (artist && title) return { ...base, artist, title };
  if (title) {
    const e = parseLine(title, order);
    return e && { ...base, ...e };
  }
  return artist ? { ...base, query: artist } : null;
}

function parseDuration(value, isMs) {
  if (!value) return null;
  const parts = value.split(':').map(Number);
  if (parts.length >= 2 && parts.every((n) => Number.isFinite(n))) {
    return parts.reduce((acc, n) => acc * 60 + n, 0) * 1000;
  }
  const n = Number(value.replace(',', '.'));
  if (!Number.isFinite(n) || n <= 0) return null;
  return isMs || n > 20000 ? Math.round(n) : Math.round(n * 1000);
}

export function splitCsvLine(line, delim) {
  const out = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch !== '"') cur += ch;
      else if (line[i + 1] === '"') { cur += '"'; i++; }
      else quoted = false;
    } else if (ch === '"' && !cur.trim()) {
      quoted = true;
      cur = '';
    } else if (ch === delim) {
      out.push(cur.trim());
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur.trim());
  return out;
}
