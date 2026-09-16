import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseList, parseLine, decodeBytes } from '../web/js/parse.js';

const one = (text, opts) => {
  const { entries } = parseList(text, opts);
  assert.equal(entries.length, 1, `expected exactly one entry for: ${text}`);
  return entries[0];
};

test('artist - title with different separators', () => {
  assert.deepEqual(parseLine('Queen - Bohemian Rhapsody'), { artist: 'Queen', title: 'Bohemian Rhapsody' });
  assert.deepEqual(parseLine('Falco – Rock Me Amadeus'), { artist: 'Falco', title: 'Rock Me Amadeus' });
  assert.deepEqual(parseLine('Wanda | Bologna'), { artist: 'Wanda', title: 'Bologna' });
  assert.deepEqual(parseLine('AC/DC - Back In Black'), { artist: 'AC/DC', title: 'Back In Black' });
});

test('version suffix stays in the title; title - artist order', () => {
  assert.deepEqual(parseLine('Queen - Bohemian Rhapsody - Remastered 2011'), { artist: 'Queen', title: 'Bohemian Rhapsody - Remastered 2011' });
  assert.deepEqual(parseLine('Bohemian Rhapsody - Queen', 'title-artist'), { artist: 'Queen', title: 'Bohemian Rhapsody' });
});

test('timestamps, dates, numbering and quotes are removed', () => {
  const expected = { artist: 'Queen', title: 'Bohemian Rhapsody' };
  assert.deepEqual(parseLine('14:03:22 Queen - Bohemian Rhapsody'), expected);
  assert.deepEqual(parseLine('[2026-09-15 14:03] Queen - Bohemian Rhapsody'), expected);
  assert.deepEqual(parseLine('15.09.2026 14:03 Queen - Bohemian Rhapsody'), expected);
  assert.deepEqual(parseLine('12. Queen - Bohemian Rhapsody'), expected);
  assert.deepEqual(parseLine('"Queen" - "Bohemian Rhapsody"'), expected);
});

test('Spotify links, URIs and ISRC', () => {
  assert.deepEqual(parseLine('https://open.spotify.com/intl-de/track/4u7EnebtmKWzUH433cf5Qv?si=abc'), { uri: 'spotify:track:4u7EnebtmKWzUH433cf5Qv' });
  assert.deepEqual(parseLine('spotify:track:4u7EnebtmKWzUH433cf5Qv'), { uri: 'spotify:track:4u7EnebtmKWzUH433cf5Qv' });
  assert.deepEqual(parseLine('https://open.spotify.com/album/1GbtB4zTqAsyfZEsm1RZfx'), { error: 'unsupportedLink' });
  assert.deepEqual(parseLine('GBUM71029604'), { isrc: 'GBUM71029604' });
  assert.deepEqual(parseLine('AT-A12-26-00001'), { isrc: 'ATA122600001' });
});

test('free text without separator and commas in artist names', () => {
  assert.deepEqual(parseLine('Bohemian Rhapsody'), { query: 'Bohemian Rhapsody' });
  const e = one('Earth, Wind & Fire - September');
  assert.equal(e.artist, 'Earth, Wind & Fire');
  assert.equal(e.title, 'September');
});

test('empty lines and comments are skipped, line numbers are kept', () => {
  const { entries, format } = parseList('# Morning show\n\nQueen - Bohemian Rhapsody\n// break\nFalco - Jeanny\n');
  assert.equal(format, 'Text');
  assert.deepEqual(entries.map((e) => [e.line, e.artist]), [[3, 'Queen'], [5, 'Falco']]);
});

test('CSV with German header and duration', () => {
  const { entries, format } = parseList('Interpret;Titel;Dauer\nFalco;Rock Me Amadeus;3:22\n"Simon & Garfunkel";"The Sound of Silence";03:05\n');
  assert.equal(format, 'CSV');
  assert.equal(entries.length, 2);
  assert.deepEqual([entries[0].artist, entries[0].title, entries[0].durationMs], ['Falco', 'Rock Me Amadeus', 202000]);
  assert.equal(entries[1].artist, 'Simon & Garfunkel');
});

test('Exportify CSV uses the track URI', () => {
  const e = one('"Track URI","Track Name","Artist Name(s)","Duration (ms)"\n"spotify:track:4u7EnebtmKWzUH433cf5Qv","Bohemian Rhapsody","Queen","354320"');
  assert.equal(e.uri, 'spotify:track:4u7EnebtmKWzUH433cf5Qv');
  assert.equal(e.durationMs, 354320);
});

test('columns pasted from Excel (tab separated) without header', () => {
  assert.deepEqual(parseLine('Smashing Pumpkins\t1979'), { artist: 'Smashing Pumpkins', title: '1979' });
  assert.deepEqual(parseLine('3\tQueen\tBohemian Rhapsody\t5:55'), { artist: 'Queen', title: 'Bohemian Rhapsody' });
});

test('M3U with EXTINF and plain file paths', () => {
  const { entries, format } = parseList('#EXTM3U\n#EXTINF:355,Queen - Bohemian Rhapsody\nC:\\Music\\queen.mp3\nD:\\Music\\01 - Falco - Rock Me Amadeus.mp3\n');
  assert.equal(format, 'M3U');
  assert.equal(entries.length, 2);
  assert.deepEqual([entries[0].artist, entries[0].title, entries[0].durationMs, entries[0].line], ['Queen', 'Bohemian Rhapsody', 355000, 2]);
  assert.deepEqual([entries[1].artist, entries[1].title], ['Falco', 'Rock Me Amadeus']);
});

test('badly formatted lines: underscores, spaces, durations, leading zeros', () => {
  const expected = { artist: 'Queen', title: 'Bohemian Rhapsody' };
  assert.deepEqual(parseLine('Queen_-_Bohemian_Rhapsody'), expected);
  assert.deepEqual(parseLine('Queen   -   Bohemian   Rhapsody'), expected);
  assert.deepEqual(parseLine('Queen - Bohemian Rhapsody'), expected);
  assert.deepEqual(parseLine('Queen - Bohemian Rhapsody (5:55)'), expected);
  assert.deepEqual(parseLine('Queen - Bohemian Rhapsody 05:55'), expected);
  assert.deepEqual(parseLine('01 Queen - Bohemian Rhapsody'), expected);
  assert.deepEqual(parseLine('07 - Queen - Bohemian Rhapsody'), expected);
  assert.deepEqual(parseLine('311 - Amber'), { artist: '311', title: 'Amber' });
  assert.deepEqual(parseLine('50 Cent - In Da Club'), { artist: '50 Cent', title: 'In Da Club' });
});

test('umlauts broken by a wrong encoding are repaired, correct text stays untouched', () => {
  const { entries } = parseList('Die Ã„rzte - Schrei nach Liebe\nMÃ¶tley CrÃ¼e - Kickstart My Heart\nFalco â€“ Jeanny\nGroß“ bleibt');
  assert.deepEqual(entries.map((e) => e.artist ?? e.query), ['Die Ärzte', 'Mötley Crüe', 'Falco', 'Groß“ bleibt']);
});

test('files in UTF-8 (BOM), UTF-16 and Windows-1252 are decoded correctly', () => {
  const text = 'Die Ärzte - Schrei nach Liebe';
  const utf8 = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode(text)]);
  assert.equal(decodeBytes(utf8), text);
  const utf16 = new Uint8Array([0xff, 0xfe, ...[...text].flatMap((c) => [c.charCodeAt(0) & 0xff, c.charCodeAt(0) >> 8])]);
  assert.equal(decodeBytes(utf16), text);
  const cp1252 = new Uint8Array([...text].map((c) => c.charCodeAt(0))); // Ä = 0xC4
  assert.equal(decodeBytes(cp1252), text);
});
