// Review view: renders the rows, lets the user pick alternatives, search manually, paste a link
// and change the order of the rows by drag and drop or keyboard.
import { SCORE_SURE, SCORE_ACCEPT, scoreTrack } from './match.js';
import { parseSpotifyTrackId } from './parse.js';
import { requestUsage, lastQuotaStop } from './spotify.js';
import { t, getLanguage } from './i18n.js';
import { $, $$, esc, formatDuration } from './ui.js';

let ctx = null; // { state, save, notice, onError }
const elements = new Map(); // row.id -> <li>
const signatures = new Map(); // row.id -> last rendered state
let dragId = null; // row.id of the row being dragged
let dropTarget = null; // { id, position: 'before' | 'after' }

const round = (x) => Math.round(x * 1000) / 1000;

/** Reduces a Spotify track object to the fields we need (keeps the saved session small). */
export function slimTrack(track) {
  const images = [...(track.album?.images || [])].sort((a, b) => (a.width || 0) - (b.width || 0));
  const image = images.find((i) => (i.width || 64) >= 64) || images.at(-1);
  return {
    id: track.id,
    uri: track.uri,
    name: track.name,
    artists: (track.artists || []).map((a) => ({ name: a.name })),
    album: { name: track.album?.name || '', album_type: track.album?.album_type, release_date: track.album?.release_date || '', image: image?.url || '' },
    duration_ms: track.duration_ms,
    explicit: !!track.explicit,
    is_playable: track.is_playable,
  };
}

const selectedCand = (row) => row.candidates.find((c) => c.track.id === row.selectedId) || null;
export const selectedTrack = (row) => selectedCand(row)?.track || null;
export const touch = (row) => { row.rev = (row.rev || 0) + 1; };
const notSearched = (row) => row.status === 'pending' || row.status === 'searching';
const rowById = (id) => ctx.state.session.rows.find((r) => r.id === id);
const rowOf = (el) => rowById(Number(el.closest('li[data-id]')?.dataset.id));

export function rowClass(row) {
  if (notSearched(row)) return 'pending';
  const c = selectedCand(row);
  if (!c) return 'none';
  if (row.manual || c.score >= SCORE_SURE) return 'sure';
  return c.score >= SCORE_ACCEPT ? 'check' : 'none';
}

function matchesFilter(row, filter = ctx.state.session.filter || 'all') {
  return filter === 'all' || (filter === 'dup' ? !!row.dup : rowClass(row) === filter);
}

function computeDuplicates() {
  const { session } = ctx.state;
  const existing = new Set(session.existingUris || []);
  const seen = new Set();
  for (const row of session.rows) {
    row.dup = null;
    const uri = row.include ? selectedTrack(row)?.uri : null;
    if (!uri) continue;
    if (existing.has(uri) && !row.imported) row.dup = 'playlist';
    else if (seen.has(uri)) row.dup = 'list';
    seen.add(uri);
  }
}

const willImport = (row) => !!(row.include && !row.imported && selectedTrack(row) && !(ctx.state.session.skipDuplicates && row.dup));
export const importRows = () => ctx.state.session.rows.filter(willImport);

export function initReview(context) {
  ctx = context;
  const list = $('#rows');
  list.addEventListener('change', onChange);
  list.addEventListener('click', onClick);
  list.addEventListener('submit', onSubmit);
  list.addEventListener('keydown', onHandleKey);
  list.addEventListener('dragstart', onDragStart);
  list.addEventListener('dragover', onDragOver);
  list.addEventListener('drop', onDrop);
  list.addEventListener('dragend', onDragEnd);
  // Scroll while dragging near the edges, also above the sticky header and footer
  document.addEventListener('dragover', autoScroll);
  $('#btn-restore-order').addEventListener('click', restoreOrder);
  $('#filters').addEventListener('click', (e) => {
    const button = e.target.closest('[data-filter]');
    if (!button) return;
    ctx.state.session.filter = button.dataset.filter;
    refresh();
    ctx.save();
  });
  $('#input-skip-dups').addEventListener('change', (e) => {
    ctx.state.session.skipDuplicates = e.target.checked;
    refresh();
    ctx.save();
  });
}

/** Rebuilds the whole list (new session). */
export function renderAll() {
  $('#rows').textContent = '';
  elements.clear();
  signatures.clear();
  refresh();
}

/** Updates duplicates, changed rows, order, filters and the summary. */
export function refresh() {
  const { session, importing, matching } = ctx.state;
  computeDuplicates();
  const list = $('#rows');
  const filter = session.filter || 'all';
  let visible = 0;

  session.rows.forEach((row, index) => {
    let el = elements.get(row.id);
    if (!el) {
      el = document.createElement('li');
      el.dataset.id = row.id;
      elements.set(row.id, el);
    }
    // Keep the DOM in the order of the rows, which can be changed by drag and drop
    if (list.children[index] !== el) list.insertBefore(el, list.children[index] || null);

    const sig = `${row.rev}|${row.dup}|${session.skipDuplicates}|${importing}|${matching}|${getLanguage()}`;
    if (signatures.get(row.id) !== sig) {
      // Keep what the user typed into the search/link fields
      const typed = { q: el.querySelector('input[name=q]')?.value, link: el.querySelector('input[name=link]')?.value };
      el.className = itemClasses(row);
      el.innerHTML = rowHtml(row);
      if (typed.q != null && el.querySelector('input[name=q]')) el.querySelector('input[name=q]').value = typed.q;
      if (typed.link && el.querySelector('input[name=link]')) el.querySelector('input[name=link]').value = typed.link;
      signatures.set(row.id, sig);
      el.dataset.pos = '';
    }
    // The number shows the current position; updated without re-rendering the row
    if (el.dataset.pos !== String(index + 1)) {
      el.dataset.pos = index + 1;
      el.querySelector('.num').textContent = index + 1;
      el.querySelector('[data-act=include]').setAttribute('aria-label', t('row.include', { n: index + 1 }));
    }
    const show = matchesFilter(row, filter);
    el.hidden = !show;
    if (show) visible++;
  });

  $('#rows-empty').hidden = visible > 0 || !session.rows.length;
  $$('#filters [data-filter]').forEach((b) => b.classList.toggle('active', b.dataset.filter === filter));
  $('#input-skip-dups').checked = session.skipDuplicates;
  updateSummary();
}

function updateSummary() {
  const { session, matching, importing } = ctx.state;
  const counts = { all: session.rows.length, sure: 0, check: 0, none: 0, dup: 0 };
  for (const row of session.rows) {
    const cls = rowClass(row);
    if (cls in counts) counts[cls]++;
    if (row.dup) counts.dup++;
  }
  for (const [key, value] of Object.entries(counts)) $(`#count-${key}`).textContent = value;

  const count = importRows().length;
  const imported = session.rows.filter((r) => r.imported).length;
  const pending = session.rows.filter(notSearched).length;
  const needsName = !session.target.id && !session.target.name;
  let info = t('review.footer', { count, total: session.rows.length, imported, pending });
  if (matching) info = t('review.searching');
  else if (needsName) info = t('review.needsName');
  $('#footer-info').textContent = info;

  const button = $('#btn-import');
  button.disabled = matching || importing || count === 0 || needsName;
  button.textContent = importing ? t('review.importing') : t('review.importButton', { count });

  // "Resume" also retries searches that failed because of Spotify (quota, connection)
  const retryable = pending + session.rows.filter((r) => r.status === 'error' && !r.entry.error).length;
  $('#btn-cancel').hidden = !matching;
  const resume = $('#btn-resume');
  resume.hidden = matching || importing || retryable === 0;
  resume.textContent = t('review.resume', { n: retryable });

  $('#btn-restore-order').hidden = importing || session.rows.every((r, i) => r.id === i);
  renderUsage();
}

/** Shows how many requests were sent to Spotify – helps to find out the limits of the request quota. */
function renderUsage() {
  const el = $('#usage-info');
  const { client, demo } = ctx.state;
  if (demo || !client) {
    el.hidden = true;
    return;
  }
  const usage = requestUsage();
  let text = t('review.usage', { session: client.requestCount ?? 0, hour: usage.hour, day: usage.day });
  const stop = lastQuotaStop();
  if (stop) {
    const time = new Date(stop.at).toLocaleString(getLanguage(), { dateStyle: 'short', timeStyle: 'short' });
    text += t('review.lastQuotaStop', { time, day: stop.day });
  }
  el.textContent = text;
  el.hidden = false;
}

function itemClasses(row) {
  const done = row.status === 'done' || row.status === 'error';
  return `item ${rowClass(row)}${done && !willImport(row) && !row.imported ? ' skipped' : ''}${row.imported ? ' imported' : ''}`;
}

function rowHtml(row) {
  const track = selectedTrack(row);
  // Entries that were not searched yet can be changed manually as long as no search is running
  const busy = row.status === 'searching' || (row.status === 'pending' && ctx.state.matching);
  const locked = busy || row.imported || ctx.state.importing;
  const handle = ctx.state.importing
    ? '<span class="drag" aria-hidden="true">⠿</span>'
    : `<span class="drag" role="button" tabindex="0" draggable="true" data-act="drag" title="${esc(t('row.dragTitle'))}" aria-label="${esc(t('row.dragLabel', { name: row.entry.raw }))}">⠿</span>`;
  return `<div class="item-line">
    ${handle}
    <input type="checkbox" data-act="include" ${row.include && track ? 'checked' : ''} ${locked || !track ? 'disabled' : ''}>
    <span class="num"></span>
    <div class="source"><div class="raw">${esc(row.entry.raw)}</div>${sourceInfo(row)}</div>
    <div class="match">${matchInfo(row, track)}</div>
    <div class="badges">${badgesHtml(row)}</div>
    <button type="button" class="small toggle" data-act="toggle" ${locked ? 'disabled' : ''}>${esc(t(row.open ? 'row.close' : 'row.change'))}</button>
  </div>${row.open && !locked ? panelHtml(row) : ''}`;
}

function sourceInfo(row) {
  const e = row.entry;
  let text = '';
  if (e.uri) text = t('row.spotifyLink');
  else if (e.isrc) text = t('row.isrc', { isrc: e.isrc });
  else if (e.artist && e.title) text = selectedCand(row)?.swapped ? t('row.swapped') : '';
  else if (e.query) text = t('row.freeText');
  return text ? `<div class="sub muted">${esc(text)}</div>` : '';
}

function matchInfo(row, track) {
  if (row.status === 'pending') return `<div class="searching">${esc(t(ctx.state.matching ? 'row.waiting' : 'row.notSearched'))}</div>`;
  if (row.status === 'searching') return `<div class="searching"><span class="spinner"></span>${esc(t('row.searching'))}</div>`;
  if (row.status === 'error') return `<div class="muted">⚠ ${esc(row.entry.error ? t(`parse.${row.entry.error}`) : row.error)}</div>`;
  if (!track) return `<div class="muted">${esc(t(row.candidates.length ? 'row.noSelection' : 'row.noMatch'))}</div>`;
  return trackHtml(track, true);
}

function trackHtml(track, withLink) {
  const year = (track.album.release_date || '').slice(0, 4);
  const artists = track.artists.map((a) => a.name).join(', ');
  const sub = [artists, track.album.name + (year ? ` (${year})` : ''), formatDuration(track.duration_ms)].filter(Boolean).join(' · ');
  const img = track.album.image ? `<img class="cover" src="${esc(track.album.image)}" alt="" loading="lazy" draggable="false">` : '<span class="cover empty">♪</span>';
  const name = withLink && !ctx.state.demo
    ? `<a href="https://open.spotify.com/track/${esc(track.id)}" target="_blank" rel="noopener" draggable="false" title="${esc(t('row.openInSpotify'))}">${esc(track.name)}</a>`
    : esc(track.name);
  const explicit = track.explicit ? ' <span class="badge dup" title="Explicit">E</span>' : '';
  const blocked = track.is_playable === false ? ` <span class="badge none">${esc(t('row.notPlayable'))}</span>` : '';
  return `${img}<div class="meta"><div class="name" title="${esc(track.name)}">${name}${explicit}</div><div class="sub" title="${esc(sub)}">${esc(sub)}${blocked}</div></div>`;
}

function badgesHtml(row) {
  const out = [];
  const c = selectedCand(row);
  const cls = rowClass(row);
  if (row.imported) out.push(`<span class="badge sure">${esc(t('row.imported'))}</span>`);
  else if (c && row.manual) out.push(`<span class="badge manual">${esc(t('row.manual'))}</span>`);
  else if (c) out.push(`<span class="badge ${cls}" title="${esc(t('row.scoreTitle'))}">${{ sure: '✓', check: '?', none: '✗' }[cls]} ${Math.round(c.score * 100)} %</span>`);
  else if (row.status === 'done') out.push(`<span class="badge none">${esc(t('row.notFound'))}</span>`);
  if (row.dup === 'playlist') out.push(`<span class="badge dup">${esc(t('row.inPlaylist'))}</span>`);
  if (row.dup === 'list') out.push(`<span class="badge dup">${esc(t('row.duplicate'))}</span>`);
  return out.join('');
}

function panelHtml(row) {
  const cands = row.candidates
    .map((c) => {
      const selected = c.track.id === row.selectedId;
      const cls = c.score >= SCORE_SURE ? 'sure' : c.score >= SCORE_ACCEPT ? 'check' : 'none';
      const play = ctx.state.demo
        ? ''
        : `<button type="button" class="small play" data-act="play" data-track="${esc(c.track.id)}">${esc(t(row.playing === c.track.id ? 'row.stop' : 'row.play'))}</button>`;
      return `<li class="cand${selected ? ' selected' : ''}"><label><input type="radio" name="sel-${row.id}" data-act="select" value="${esc(c.track.id)}" ${selected ? 'checked' : ''}>${trackHtml(c.track, false)}<span class="badge ${cls}">${Math.round(c.score * 100)} %</span></label>${play}</li>`;
    })
    .join('');
  const player = row.playing
    ? `<div class="player"><iframe src="https://open.spotify.com/embed/track/${esc(row.playing)}" allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture" loading="lazy" title="${esc(t('row.player'))}"></iframe></div>`
    : '';
  const query = row.searchQuery ?? ([row.entry.artist, row.entry.title].filter(Boolean).join(' ') || row.entry.query || '');
  return `<div class="panel">
    ${cands ? `<ul class="cands">${cands}</ul>` : `<p class="muted">${esc(t('row.noSuggestions'))}</p>`}
    ${player}
    <form data-act="search"><input type="search" name="q" value="${esc(query)}" placeholder="${esc(t('row.searchPlaceholder'))}" aria-label="${esc(t('row.searchLabel'))}"><button type="submit" ${row.busy ? 'disabled' : ''}>${esc(t(row.busy === 'search' ? 'row.searchBusy' : 'row.search'))}</button></form>
    <form data-act="link"><input name="link" placeholder="${esc(t('row.linkPlaceholder'))}" aria-label="${esc(t('row.linkLabel'))}"><button type="submit" ${row.busy ? 'disabled' : ''}>${esc(t(row.busy === 'link' ? 'row.applyBusy' : 'row.apply'))}</button></form>
    <div><button type="button" class="link" data-act="skip">${esc(t('row.skip'))}</button></div>
  </div>`;
}

function update(row, patch) {
  Object.assign(row, patch);
  touch(row);
  refresh();
  ctx.save();
}

function dedupe(cands) {
  const seen = new Set();
  return cands.filter((c) => !seen.has(c.track.id) && seen.add(c.track.id));
}

// ---------- Changing the order ----------

/** Moves a row before or after another row. */
function moveRow(id, targetId, position) {
  const rows = ctx.state.session.rows;
  const from = rows.findIndex((r) => r.id === id);
  if (from < 0 || id === targetId) return;
  const [row] = rows.splice(from, 1);
  const target = rows.findIndex((r) => r.id === targetId);
  rows.splice(target < 0 ? from : target + (position === 'after' ? 1 : 0), 0, row);
  refresh();
  ctx.save();
}

function restoreOrder() {
  ctx.state.session.rows.sort((a, b) => a.id - b.id);
  refresh();
  ctx.save();
}

function setDropTarget(target) {
  if (dropTarget) elements.get(dropTarget.id)?.classList.remove('drop-before', 'drop-after');
  dropTarget = target;
  if (target) elements.get(target.id)?.classList.add(`drop-${target.position}`);
}

function onDragStart(e) {
  const handle = e.target.closest?.('[data-act=drag]');
  if (!handle || ctx.state.importing) return;
  const li = handle.closest('li[data-id]');
  dragId = Number(li.dataset.id);
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', rowById(dragId)?.entry.raw || '');
  e.dataTransfer.setDragImage(li, 16, 20);
  requestAnimationFrame(() => li.classList.add('dragging'));
}

function onDragOver(e) {
  if (dragId === null) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  const li = e.target.closest?.('li[data-id]');
  if (!li) return; // between two rows: keep the current marker
  const id = Number(li.dataset.id);
  if (id === dragId) {
    setDropTarget(null);
    return;
  }
  const rect = li.getBoundingClientRect();
  const position = e.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
  if (dropTarget?.id !== id || dropTarget.position !== position) setDropTarget({ id, position });
}

function onDrop(e) {
  if (dragId === null) return;
  e.preventDefault();
  if (dropTarget) moveRow(dragId, dropTarget.id, dropTarget.position);
}

function onDragEnd() {
  if (dragId !== null) elements.get(dragId)?.classList.remove('dragging');
  setDropTarget(null);
  dragId = null;
}

function autoScroll(e) {
  if (dragId === null) return;
  const edge = 90;
  if (e.clientY < edge) window.scrollBy(0, -14);
  else if (e.clientY > window.innerHeight - edge) window.scrollBy(0, 14);
}

const MOVE_KEYS = { ArrowUp: -1, ArrowDown: 1, PageUp: -10, PageDown: 10, Home: -Infinity, End: Infinity };

/** Keyboard alternative on the handle: arrow keys, Page Up/Down and Home/End move the row among the visible rows. */
function onHandleKey(e) {
  const handle = e.target.closest?.('[data-act=drag]');
  if (!handle || !(e.key in MOVE_KEYS) || ctx.state.importing) return;
  e.preventDefault();
  const row = rowOf(handle);
  const visible = ctx.state.session.rows.filter((r) => matchesFilter(r));
  const from = visible.indexOf(row);
  const to = Math.max(0, Math.min(visible.length - 1, from + MOVE_KEYS[e.key]));
  if (from < 0 || to === from) return;
  moveRow(row.id, visible[to].id, to > from ? 'after' : 'before');
  const el = elements.get(row.id);
  el?.querySelector('[data-act=drag]')?.focus();
  el?.scrollIntoView({ block: 'nearest' });
}

// ---------- Events ----------

function onChange(e) {
  const row = rowOf(e.target);
  if (!row) return;
  if (e.target.dataset.act === 'include') update(row, { include: e.target.checked });
  // A manual choice counts as searched, so "Resume search" leaves this entry alone
  if (e.target.dataset.act === 'select') update(row, { selectedId: e.target.value, manual: true, include: true, status: 'done' });
}

function onClick(e) {
  const button = e.target.closest('button[data-act]');
  const row = button && rowOf(button);
  if (!row) return;
  const act = button.dataset.act;
  if (act === 'toggle') update(row, { open: !row.open, playing: null });
  if (act === 'play') update(row, { playing: row.playing === button.dataset.track ? null : button.dataset.track });
  if (act === 'skip') update(row, { include: false, open: false, playing: null });
}

async function onSubmit(e) {
  const form = e.target.closest('form[data-act]');
  if (!form) return;
  e.preventDefault();
  const row = rowOf(form);
  if (!row || row.busy) return;
  const { client, session } = ctx.state;

  try {
    if (form.dataset.act === 'search') {
      const q = form.elements.q.value.trim();
      if (!q) return;
      update(row, { busy: 'search', searchQuery: q });
      const tracks = await client.search(q, { limit: 10 });
      const results = tracks.map((track, rank) => ({ track: slimTrack(track), score: round(scoreTrack(row.entry, track, { rank, order: session.order }).score) }));
      const current = selectedCand(row);
      update(row, { busy: null, candidates: dedupe([...(current ? [current] : []), ...results]) });
      if (!results.length) ctx.notice(t('row.noResults', { q }));
    } else if (form.dataset.act === 'link') {
      const id = parseSpotifyTrackId(form.elements.link.value);
      if (!id) {
        ctx.notice(t('row.invalidLink'), { type: 'error' });
        return;
      }
      update(row, { busy: 'link' });
      const track = await client.getTrack(id);
      const cand = { track: slimTrack(track), score: round(scoreTrack(row.entry, track).score) };
      form.elements.link.value = '';
      update(row, { busy: null, candidates: dedupe([cand, ...row.candidates]), selectedId: cand.track.id, manual: true, include: true, status: 'done' });
    }
  } catch (err) {
    update(row, { busy: null });
    ctx.onError(err);
  }
}
