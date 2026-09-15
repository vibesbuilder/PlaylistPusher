import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalize, similarity, splitTitle, scoreTrack, findCandidates, SCORE_SURE, SCORE_ACCEPT } from '../web/js/match.js';

let nextId = 0;
const track = (name, artists, extra = {}) => {
  const id = `t${++nextId}`;
  return {
    id,
    uri: `spotify:track:${id}`,
    name,
    artists: artists.map((n) => ({ name: n })),
    album: { name: extra.album || name, album_type: extra.albumType || 'album', images: [] },
    duration_ms: extra.duration || 200000,
    is_playable: extra.playable ?? true,
  };
};

const best = (entry, tracks, order = 'auto') =>
  tracks
    .map((t, rank) => ({ t, ...scoreTrack(entry, t, { rank, order }) }))
    .sort((a, b) => b.score - a.score)[0];

test('normalization: umlauts, special characters, articles', () => {
  assert.equal(normalize('Die Ärzte'), normalize('Die Aerzte'));
  assert.equal(normalize('Mötley Crüe'), normalize('Motley Crue'));
  assert.equal(normalize('The Beatles'), normalize('Beatles'));
  assert.equal(similarity(normalize('AC/DC'), normalize('ACDC')), 1);
  assert.equal(normalize("Don't Stop Me Now"), normalize('Dont Stop Me Now'));
});

test('titles are split into core and version', () => {
  assert.deepEqual(splitTitle('Bohemian Rhapsody - Remastered 2011'), { core: 'Bohemian Rhapsody', version: 'Remastered 2011', versions: ['Remastered 2011'] });
  assert.deepEqual(splitTitle('Titanium (feat. Sia)'), { core: 'Titanium', version: 'feat. Sia', versions: ['feat. Sia'] });
  assert.deepEqual(splitTitle('Get Lucky (Radio Edit) [feat. Pharrell Williams]').versions, ['Radio Edit', 'feat. Pharrell Williams']);
  assert.equal(splitTitle('Dancing With A Stranger').core, 'Dancing With A Stranger');
});

test('the original beats live, karaoke and tribute versions', () => {
  const original = track('Bohemian Rhapsody - Remastered 2011', ['Queen'], { album: 'A Night At The Opera (2011 Remaster)' });
  const tracks = [
    track('Bohemian Rhapsody (In the Style of Queen)', ['The Karaoke Channel']),
    track('Bohemian Rhapsody - Live Aid', ['Queen'], { album: 'Bohemian Rhapsody (The Original Soundtrack)' }),
    original,
  ];
  const b = best({ artist: 'Queen', title: 'Bohemian Rhapsody' }, tracks);
  assert.equal(b.t, original);
  assert.ok(b.score >= SCORE_SURE, `score ${b.score}`);
});

test('the requested version (radio edit / live) is preferred', () => {
  const album = track('Get Lucky (feat. Pharrell Williams and Nile Rodgers)', ['Daft Punk', 'Pharrell Williams', 'Nile Rodgers']);
  const radio = track('Get Lucky (Radio Edit) [feat. Pharrell Williams and Nile Rodgers]', ['Daft Punk', 'Pharrell Williams', 'Nile Rodgers'], { albumType: 'single' });
  assert.equal(best({ artist: 'Daft Punk', title: 'Get Lucky (Radio Edit)' }, [album, radio]).t, radio);
  assert.equal(best({ artist: 'Daft Punk', title: 'Get Lucky' }, [radio, album]).t, album);

  const studio = track('Bohemian Rhapsody - Remastered 2011', ['Queen']);
  const live = track('Bohemian Rhapsody - Live Aid', ['Queen']);
  assert.equal(best({ artist: 'Queen', title: 'Bohemian Rhapsody (Live)' }, [studio, live]).t, live);
});

test('featuring, multiple artists and swapped order', () => {
  const titanium = track('Titanium (feat. Sia)', ['David Guetta', 'Sia']);
  assert.ok(scoreTrack({ artist: 'David Guetta feat. Sia', title: 'Titanium' }, titanium).score >= SCORE_SURE);
  assert.ok(scoreTrack({ artist: 'Sia', title: 'Titanium' }, titanium).score >= SCORE_SURE);

  const swapped = scoreTrack({ artist: 'Titanium', title: 'David Guetta' }, titanium, { order: 'auto' });
  assert.ok(swapped.swapped && swapped.score >= SCORE_SURE, `score ${swapped.score}`);
  const strict = scoreTrack({ artist: 'Titanium', title: 'David Guetta' }, titanium, { order: 'artist-title' });
  assert.ok(strict.score < SCORE_ACCEPT, `score ${strict.score}`);
});

test('a different song by the same artist is uncertain', () => {
  const s = scoreTrack({ artist: 'Queen', title: 'Bohemian Rhapsody' }, track('Radio Ga Ga', ['Queen']));
  assert.ok(s.score < SCORE_ACCEPT, `score ${s.score}`);
});

test('umlaut spellings and unplayable tracks', () => {
  const aerzte = track('Schrei nach Liebe', ['Die Ärzte']);
  assert.ok(scoreTrack({ artist: 'Die Aerzte', title: 'Schrei nach Liebe' }, aerzte).score >= SCORE_SURE);
  const blocked = track('Schrei nach Liebe', ['Die Ärzte'], { playable: false });
  assert.equal(best({ artist: 'Die Ärzte', title: 'Schrei nach Liebe' }, [blocked, aerzte]).t, aerzte);
});

test('search strategy: one good hit is enough, fallbacks only when needed', async () => {
  const falco = track('Rock Me Amadeus', ['Falco']);
  const queries = [];
  const search = async (q) => { queries.push(q); return q.startsWith('track:') ? [falco] : []; };
  const candidates = await findCandidates({ artist: 'Falco', title: 'Rock Me Amadeus' }, { search });
  assert.equal(candidates[0].track, falco);
  assert.deepEqual(queries, ['track:Rock Me Amadeus artist:Falco']);

  const missing = [];
  const none = await findCandidates({ artist: 'Unknown', title: 'Does Not Exist' }, { search: async (q) => { missing.push(q); return []; } });
  assert.equal(none.length, 0);
  assert.equal(missing.length, 4); // field search, free text, swapped, title only
});

test('search strategy: link and ISRC', async () => {
  const t = track('Bologna', ['Wanda']);
  const viaLink = await findCandidates({ uri: `spotify:track:${t.id}` }, { getTrack: async (id) => (id === t.id ? t : null) });
  assert.equal(viaLink[0].track, t);
  assert.equal(viaLink[0].score, 1);

  const queries = [];
  const viaIsrc = await findCandidates({ isrc: 'ATABC1400001' }, { search: async (q) => { queries.push(q); return [t]; } });
  assert.equal(viaIsrc[0].track, t);
  assert.ok(viaIsrc[0].score >= SCORE_SURE);
  assert.deepEqual(queries, ['isrc:ATABC1400001']);
});

test('search errors are only thrown when nothing was found', async () => {
  const t = track('Maschin', ['Bilderbuch']);
  let calls = 0;
  const flaky = async () => { if (calls++ === 0) throw new Error('temporarily unavailable'); return [t]; };
  const result = await findCandidates({ artist: 'Bilderbuch', title: 'Maschin' }, { search: flaky });
  assert.equal(result[0].track, t);
  await assert.rejects(findCandidates({ query: 'x' }, { search: async () => { throw new Error('offline'); } }), /offline/);
});
