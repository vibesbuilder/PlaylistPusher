import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseList } from '../web/js/parse.js';
import { entryLine, entriesText, exportFileName } from '../web/js/export.js';

test('entries become "Artist - Title" lines without numbering', () => {
  const { entries } = parseList(' 1. Queen - Bohemian Rhapsody\n14:03:22 Falco – Rock Me Amadeus 3:20\nsome free text');
  assert.deepEqual(entries.map(entryLine), ['Queen - Bohemian Rhapsody', 'Falco - Rock Me Amadeus', 'some free text']);
});

test('links, ISRC codes and unusable lines', () => {
  assert.equal(entryLine({ uri: 'spotify:track:4uLU6hMCjMI75M1A2tKUQC' }), 'https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC');
  assert.equal(entryLine({ isrc: 'USRC17607839' }), 'USRC17607839');
  assert.equal(entryLine({ error: 'unsupportedLink', raw: 'https://example.com/x' }), 'https://example.com/x');
  assert.equal(entryLine({ uri: 'spotify:track:x', artist: 'Queen', title: 'Bohemian Rhapsody' }), 'Queen - Bohemian Rhapsody');
});

test('duplicates are saved once, Windows line breaks', () => {
  const { text, count } = entriesText([
    { artist: 'Will Clarke', title: 'WHAT?!' },
    { artist: 'Queen', title: 'Bohemian Rhapsody' },
    { artist: 'will clarke', title: 'What?!' },
  ]);
  assert.equal(count, 2);
  assert.equal(text, 'Will Clarke - WHAT?!\r\nQueen - Bohemian Rhapsody\r\n');
  assert.deepEqual(entriesText([]), { text: '', count: 0 });
});

test('the saved list can be loaded again', () => {
  const original = parseList('Title - Artist\nBohemian Rhapsody - Queen', { order: 'title-artist' }).entries;
  const { text } = entriesText(original);
  const { entries } = parseList(text);
  assert.deepEqual(entries.map((e) => [e.artist, e.title]), [['Artist', 'Title'], ['Queen', 'Bohemian Rhapsody']]);
});

test('file name without forbidden characters', () => {
  assert.equal(exportFileName('Radio: Top 20 / 2026?', 'not imported'), 'Radio Top 20 2026 - not imported.txt');
  assert.equal(exportFileName('', 'nicht importiert'), 'PlaylistPusher - nicht importiert.txt');
  assert.equal(exportFileName('...', 'x'), 'PlaylistPusher - x.txt');
});
