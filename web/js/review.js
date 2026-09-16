// Review view: renders the rows, lets the user pick alternatives, search manually, paste a link,
// select and remove entries, and change the order by drag and drop or keyboard.
import { SCORE_SURE, SCORE_ACCEPT, scoreTrack } from './match.js';
import { parseSpotifyTrackId } from './parse.js';
import { t, getLanguage } from './i18n.js';
import { $, $$, esc, formatDuration } from './ui.js';

let ctx = null; // { state, save, notice, onError }
const elements = new Map(); // row.id -> <li>
const signatures = new Map(); // row.id -> last rendered state
const selected = new Set(); // ids of selected rows
let lastSelectedId = null; // anchor for Shift-click range selection
let lastRemoval = null; // { session, removed: [{ row, index }] } for "Undo"
let dragId = null; // row.id of the row being dragged
let dropTarget = null; // { id, position: 'before' | 'after' }

const ICONS = {
  edit: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16v4Z"/><path d="m13.5 6.5 4 4"/></svg>',
  close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 15 6-6 6 6"/></svg>',
  trash: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16"/><path d="M9 7V4h6v3"/><path d="m6 7 1 13h10l1-13"/><path d="M10 11v6M14 11v6"/></svg>',
};

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
  list.addEventListener('mousedown', (e) => {
    // Shift-click on a checkbox selects a range; do not also select text on the page
    if (e.shiftKey && e.target.matches('input[data-act=select-row]')) e.preventDefault();
  });
  list.addEventListener('dragstart', onDragStart);
  list.addEventListener('dragover', onDragOver);
  list.addEventListener('drop', onDrop);
  list.addEventListener('dragend', onDragEnd);
  // Scroll while dragging near the edges, also above the sticky header and footer
  document.addEventListener('dragover', autoScroll);
  document.addEventListener('keydown', onDeleteKey);

  $('#btn-restore-order').addEventListener('click', restoreOrder);
  $('#select-all').addEventListener('change', (e) => {
    for (const row of selectableRows()) {
      if (e.target.checked) selected.add(row.id);
      else selected.delete(row.id);
    }
    refresh();
  });
  $('#btn-remove-selected').addEventListener('click', removeSelected);
  $('#btn-clear-selection').addEventListener('click', () => {
    selected.clear();
    refresh();
  });
  $('#filters').addEventListener('click', (e) => {
    const button = e.target.closest('[data-filter]');
    if (!button) return;
    ctx.state.session.filter = button.dataset.filter;
    selected.clear(); // a selection that is no longer visible would be removed unnoticed
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
  selected.clear();
  lastSelectedId = null;
  lastRemoval = null;
  refresh();
}

/** Updates duplicates, changed rows, order, selection, filters and the summary. */
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
    // Position number and selection are updated without re-rendering the row
    const checkbox = el.querySelector('[data-act=select-row]');
    if (el.dataset.pos !== String(index + 1)) {
      el.dataset.pos = index + 1;
      el.querySelector('.num').textContent = index + 1;
      checkbox.setAttribute('aria-label', t('row.select', { n: index + 1 }));
    }
    const isSelected = selected.has(row.id);
    checkbox.checked = isSelected;
    el.classList.toggle('selected', isSelected);

    const show = matchesFilter(row, filter);
    el.hidden = !show;
    if (show) visible++;
  });

  $('#rows-empty').hidden = visible > 0 || !session.rows.length;
  $$('#filters [data-filter]').forEach((b) => b.classList.toggle('active', b.dataset.filter === filter));
  $('#input-skip-dups').checked = session.skipDuplicates;
  updateSummary();
}

const selectableRows = () => ctx.state.session.rows.filter((r) => matchesFilter(r) && !r.imported);

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

  const sorted = session.rows.every((r, i) => i === 0 || session.rows[i - 1].id < r.id);
  $('#btn-restore-order').hidden = importing || sorted;

  // Selection: "select all shown" checkbox and the bar with bulk actions
  const selectable = selectableRows();
  const selectedShown = selectable.filter((r) => selected.has(r.id)).length;
  const selectAll = $('#select-all');
  selectAll.checked = selectable.length > 0 && selectedShown === selectable.length;
  selectAll.indeterminate = selectedShown > 0 && selectedShown < selectable.length;
  selectAll.disabled = importing || selectable.length === 0;
  $('#bulk-bar').hidden = importing || selected.size === 0;
  $('#bulk-count').textContent = t('review.selected', { n: selected.size });
  $('#btn-remove-selected').title = t('review.removeSelectedTitle', { n: selected.size });
}

function itemClasses(row) {
  const done = row.status === 'done' || row.status === 'error';
  return `item ${rowClass(row)}${done && !willImport(row) && !row.imported ? ' skipped' : ''}${row.imported ? ' imported' : ''}`;
}

function rowHtml(row) {
  const track = selectedTrack(row);
  const name = row.entry.raw;
  // Entries that were not searched yet can be changed manually as long as no search is running
  const busy = row.status === 'searching' || (row.status === 'pending' && ctx.state.matching);
  const locked = busy || row.imported || ctx.state.importing;
  const handle = ctx.state.importing
    ? '<span class="drag" aria-hidden="true">⠿</span>'
    : `<span class="drag" role="button" tabindex="0" draggable="true" data-act="drag" title="${esc(t('row.dragTitle'))}" aria-label="${esc(t('row.dragLabel', { name }))}">⠿</span>`;
  const changeLabel = t(row.open ? 'row.close' : 'row.change');
  return `<div class="item-line">
    ${handle}
    <input type="checkbox" data-act="select-row" ${row.imported || ctx.state.importing ? 'disabled' : ''}>
    <span class="num"></span>
    <div class="source"><div class="raw">${esc(name)}</div>${sourceInfo(row)}</div>
    <div class="match">${matchInfo(row, track)}</div>
    <div class="badges">${badgesHtml(row)}</div>
    <div class="row-actions">
      <button type="button" class="icon-btn" data-act="toggle" title="${esc(changeLabel)}" aria-label="${esc(`${changeLabel}: ${name}`)}" aria-expanded="${!!row.open}" ${locked ? 'disabled' : ''}>${row.open ? ICONS.close : ICONS.edit}</button>
      <button type="button" class="icon-btn danger" data-act="remove" title="${esc(t('row.remove'))}" aria-label="${esc(`${t('row.remove')}: ${name}`)}" ${row.imported || ctx.state.importing ? 'disabled' : ''}>${ICONS.trash}</button>
    </div>
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
  if (c && !row.imported && !row.include) out.push(`<span class="badge none">${esc(t('row.notImported'))}</span>`);
  if (row.dup === 'playlist') out.push(`<span class="badge dup">${esc(t('row.inPlaylist'))}</span>`);
  if (row.dup === 'list') out.push(`<span class="badge dup">${esc(t('row.duplicate'))}</span>`);
  return out.join('');
}

function panelHtml(row) {
  const cands = row.candidates
    .map((c) => {
      const isSelected = c.track.id === row.selectedId;
      const cls = c.score >= SCORE_SURE ? 'sure' : c.score >= SCORE_ACCEPT ? 'check' : 'none';
      const play = ctx.state.demo
        ? ''
        : `<button type="button" class="small play" data-act="play" data-track="${esc(c.track.id)}">${esc(t(row.playing === c.track.id ? 'row.stop' : 'row.play'))}</button>`;
      return `<li class="cand${isSelected ? ' selected' : ''}"><label><input type="radio" name="sel-${row.id}" data-act="select" value="${esc(c.track.id)}" ${isSelected ? 'checked' : ''}>${trackHtml(c.track, false)}<span class="badge ${cls}">${Math.round(c.score * 100)} %</span></label>${play}</li>`;
    })
    .join('');
  const player = row.playing
    ? `<div class="player"><iframe src="https://open.spotify.com/embed/track/${esc(row.playing)}" allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture" loading="lazy" title="${esc(t('row.player'))}"></iframe></div>`
    : '';
  const query = row.searchQuery ?? ([row.entry.artist, row.entry.title].filter(Boolean).join(' ') || row.entry.query || '');
  return `<div class="panel">
    ${cands ? `<div><p class="hint pick-hint">${esc(t('row.pickHint'))}</p><ul class="cands">${cands}</ul></div>` : `<p class="muted">${esc(t('row.noSuggestions'))}</p>`}
    ${player}
    <form data-act="search"><input type="search" name="q" value="${esc(query)}" placeholder="${esc(t('row.searchPlaceholder'))}" aria-label="${esc(t('row.searchLabel'))}"><button type="submit" ${row.busy ? 'disabled' : ''}>${esc(t(row.busy === 'search' ? 'row.searchBusy' : 'row.search'))}</button></form>
    <form data-act="link"><input name="link" placeholder="${esc(t('row.linkPlaceholder'))}" aria-label="${esc(t('row.linkLabel'))}"><button type="submit" ${row.busy ? 'disabled' : ''}>${esc(t(row.busy === 'link' ? 'row.applyBusy' : 'row.apply'))}</button></form>
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

// ---------- Removing entries ----------

function removeRows(ids) {
  const { session } = ctx.state;
  const wanted = new Set(ids);
  const removed = [];
  session.rows.forEach((row, index) => {
    if (wanted.has(row.id) && !row.imported) removed.push({ row, index });
  });
  if (!removed.length) return;
  for (const { row } of removed) {
    row.removed = true; // a running search skips removed entries
    selected.delete(row.id);
    elements.get(row.id)?.remove();
    elements.delete(row.id);
    signatures.delete(row.id);
  }
  session.rows = session.rows.filter((row) => !row.removed);
  lastRemoval = { session, removed };
  refresh();
  ctx.save();
  ctx.notice(t('review.removed', { n: removed.length }), { action: { label: t('review.undo'), fn: undoRemoval } });
}

function removeSelected() {
  if (selected.size && !ctx.state.importing) removeRows([...selected]);
}

function undoRemoval() {
  const removal = lastRemoval;
  lastRemoval = null;
  if (!removal || removal.session !== ctx.state.session) return;
  const { rows } = removal.session;
  // Re-insert in ascending original position, so every entry lands where it was
  for (const { row, index } of [...removal.removed].sort((a, b) => a.index - b.index)) {
    row.removed = false;
    rows.splice(Math.min(index, rows.length), 0, row);
  }
  refresh();
  ctx.save();
}

function onDeleteKey(e) {
  if (e.key !== 'Delete' || !selected.size || $('#view-review').hidden || document.querySelector('dialog[open]')) return;
  if (e.target.closest('input:not([type=checkbox]):not([type=radio]), textarea, select')) return;
  e.preventDefault();
  removeSelected();
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
  // A manual choice counts as searched, so "Resume search" leaves this entry alone
  if (e.target.dataset.act === 'select') update(row, { selectedId: e.target.value, manual: true, include: true, status: 'done' });
}

function onClick(e) {
  const checkbox = e.target.closest('input[data-act=select-row]');
  if (checkbox) return toggleSelection(checkbox, e.shiftKey);

  const radio = e.target.closest('input[data-act=select]');
  if (radio) {
    const row = rowOf(radio);
    // Clicking the track that is already selected confirms it, e.g. an uncertain match that is correct
    if (row && row.selectedId === radio.value && !(row.manual && row.include)) update(row, { manual: true, include: true, status: 'done' });
    return;
  }

  const button = e.target.closest('button[data-act]');
  const row = button && rowOf(button);
  if (!row) return;
  const act = button.dataset.act;
  if (act === 'toggle') update(row, { open: !row.open, playing: null });
  if (act === 'play') update(row, { playing: row.playing === button.dataset.track ? null : button.dataset.track });
  if (act === 'remove') removeRows([row.id]);
}

/** Selects or deselects a row; with Shift, the whole range from the last clicked row. */
function toggleSelection(checkbox, withShift) {
  const row = rowOf(checkbox);
  if (!row) return;
  const on = checkbox.checked;
  const visible = selectableRows();
  const from = withShift ? visible.findIndex((r) => r.id === lastSelectedId) : -1;
  const to = visible.indexOf(row);
  const range = from >= 0 && to >= 0 ? visible.slice(Math.min(from, to), Math.max(from, to) + 1) : [row];
  for (const r of range) {
    if (on) selected.add(r.id);
    else selected.delete(r.id);
  }
  lastSelectedId = row.id;
  refresh();
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
