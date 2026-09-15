// Demo mode: simulates the Spotify API with a small catalog – no login, no real changes.
import { normalize } from './match.js';
import { ApiError } from './spotify.js';
import { t } from './i18n.js';

const COLORS = ['#e76f51', '#2a9d8f', '#e9c46a', '#264653', '#8338ec', '#ff006e', '#3a86ff', '#6a994e'];

function cover(album, i) {
  const letter = (album.match(/\p{L}|\p{N}/u) || ['?'])[0].toUpperCase();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="${COLORS[i % COLORS.length]}"/><text x="32" y="42" font-family="sans-serif" font-size="28" fill="#fff" text-anchor="middle">${letter}</text></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

// [title, artists, album, year, duration in s, album type]
const RAW = [
  ['Bohemian Rhapsody - Remastered 2011', ['Queen'], 'A Night At The Opera (2011 Remaster)', 1975, 354, 'album'],
  ['Bohemian Rhapsody - Live Aid', ['Queen'], 'Bohemian Rhapsody (The Original Soundtrack)', 2018, 362, 'album'],
  ['Bohemian Rhapsody (In the Style of Queen)', ['Karaoke Kings'], 'Karaoke Rock Classics', 2012, 356, 'compilation'],
  ['Rock Me Amadeus', ['Falco'], 'Falco 3', 1985, 202, 'album'],
  ['Rock Me Amadeus - The Salieri Mix', ['Falco'], 'Falco 3 (Deluxe Edition)', 1985, 405, 'album'],
  ['Der Kommissar', ['Falco'], 'Einzelhaft', 1982, 230, 'album'],
  ['Bologna', ['Wanda'], 'Amore', 2014, 211, 'album'],
  ['Maschin', ['Bilderbuch'], 'Schick Schock', 2015, 247, 'album'],
  ['Fürstenfeld', ['STS'], 'Überdosis G\'fühl', 1984, 263, 'album'],
  ['Titanium (feat. Sia)', ['David Guetta', 'Sia'], 'Nothing but the Beat', 2011, 245, 'album'],
  ['Get Lucky (feat. Pharrell Williams and Nile Rodgers)', ['Daft Punk', 'Pharrell Williams', 'Nile Rodgers'], 'Random Access Memories', 2013, 369, 'album'],
  ['Get Lucky (Radio Edit) [feat. Pharrell Williams and Nile Rodgers]', ['Daft Punk', 'Pharrell Williams', 'Nile Rodgers'], 'Get Lucky', 2013, 248, 'single'],
  ['Schrei nach Liebe', ['Die Ärzte'], 'Die Bestie in Menschengestalt', 1993, 254, 'album'],
  ['Kickstart My Heart', ['Mötley Crüe'], 'Dr. Feelgood', 1989, 283, 'album'],
  ['The Sound of Silence', ['Simon & Garfunkel'], 'Sounds of Silence', 1966, 185, 'album'],
  ['Back In Black', ['AC/DC'], 'Back In Black', 1980, 255, 'album'],
  ['1979 - Remastered 2012', ['The Smashing Pumpkins'], 'Mellon Collie And The Infinite Sadness (Remastered)', 1995, 266, 'album'],
];

export const DEMO_TRACKS = RAW.map(([name, artists, album, year, seconds, albumType], i) => {
  const id = `demo${String(i + 1).padStart(18, '0')}`;
  return {
    id,
    uri: `spotify:track:${id}`,
    name,
    artists: artists.map((a) => ({ name: a })),
    album: { name: album, album_type: albumType, release_date: String(year), images: [{ url: cover(album, i), width: 64, height: 64 }] },
    duration_ms: seconds * 1000,
    explicit: false,
    is_playable: true,
    external_urls: { spotify: '' },
  };
});

export const DEMO_TARGET = 'New Releases';

export const DEMO_LIST = [
  '# Example list (demo)',
  'Queen - Bohemian Rhapsody',
  '14:03 Falco – Rock Me Amadeus',
  'Wanda - Bologna',
  'Die Aerzte - Schrei nach Liebe',
  'David Guetta feat. Sia - Titanium',
  'Motley Crue - Kickstart My Heart',
  'Daft Punk - Get Lucky (Radio Edit)',
  'Back In Black - AC/DC',
  'Falco - Rock Me Amadeus',
  'Bilderbuch - Maschin',
  'Unknown Band - Does Not Exist',
  'https://open.spotify.com/track/demo000000000000000009',
].join('\n');

const wait = (min, max) => new Promise((r) => setTimeout(r, min + Math.random() * (max - min)));

export class DemoClient {
  constructor() {
    this.demo = true;
    this.onWait = null;
    this.playlists = [
      { id: 'demoplaylist1', name: 'Morning Show', owner: { id: 'demo' }, collaborative: false, public: true, items: { total: 12 } },
      { id: 'demoplaylist2', name: DEMO_TARGET, owner: { id: 'demo' }, collaborative: false, public: false, items: { total: 1 } },
      { id: 'demoplaylist3', name: 'Team picks', owner: { id: 'colleague' }, collaborative: true, public: false, items: { total: 40 } },
      { id: 'demoplaylist4', name: 'Someone else’s playlist (only followed)', owner: { id: 'someone' }, collaborative: false, public: true, items: { total: 99 } },
    ];
    this.contents = new Map([['demoplaylist2', new Set([DEMO_TRACKS[6].uri])]]);
  }

  async me() {
    await wait(100, 200);
    return { id: 'demo', display_name: t('demo.account') };
  }

  async search(q, { limit = 10 } = {}) {
    await wait(120, 450);
    if (/isrc:/i.test(q)) return [];
    const terms = normalize(q.replace(/\b(track|artist|album|year):/gi, ' ')).split(' ').filter(Boolean);
    if (!terms.length) return [];
    return DEMO_TRACKS.map((track) => {
      const words = new Set(normalize(`${track.artists.map((a) => a.name).join(' ')} ${track.name} ${track.album.name}`).split(' '));
      return [track, terms.filter((term) => words.has(term)).length];
    })
      .filter(([, hits]) => hits >= Math.max(1, Math.ceil(terms.length / 2)))
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([track]) => track);
  }

  async getTrack(id) {
    await wait(80, 200);
    const track = DEMO_TRACKS.find((x) => x.id === id);
    if (!track) throw new ApiError(404, t('demo.trackMissing'));
    return track;
  }

  async myPlaylists() {
    await wait(200, 400);
    return this.playlists;
  }

  async playlistTrackUris(id) {
    await wait(150, 300);
    return new Set(this.contents.get(id) || []);
  }

  async createPlaylist({ name, isPublic = false, description = '' }) {
    await wait(300, 500);
    const playlist = { id: `demonew${Date.now()}`, name, description, owner: { id: 'demo' }, collaborative: false, public: isPublic, items: { total: 0 } };
    this.playlists.unshift(playlist);
    return playlist;
  }

  async addTracks(playlistId, uris, onProgress) {
    const set = this.contents.get(playlistId) || new Set();
    this.contents.set(playlistId, set);
    let added = 0;
    for (let i = 0; i < uris.length; i += 100) {
      await wait(400, 700);
      const chunk = uris.slice(i, i + 100);
      chunk.forEach((u) => set.add(u));
      added += chunk.length;
      onProgress?.(added, uris.length);
    }
    return added;
  }
}
