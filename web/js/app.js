// PlaylistPusher – flow: setup → login → list & target → matching/review → confirmation → import.
import { parseList, decodeBytes } from './parse.js';
import { findCandidates, SCORE_ACCEPT } from './match.js';
import { SpotifyClient, AuthError, startLogin, completeLogin, hasSession, logout, redirectUri } from './spotify.js';
import { DemoClient, DEMO_LIST, DEMO_TARGET } from './demo.js';
import { initReview, renderAll, refresh, touch, slimTrack, selectedTrack, importRows, rowClass } from './review.js';
import { t, translatePage, setLanguage } from './i18n.js';
import { $, $$, debounce, showView, notice, initNotice } from './ui.js';
import './usage.js';

const CLIENT_KEY = 'pp.clientId';
const PRELOAD_KEY = 'pp.preloadId';
const NEW_PLAYLIST = '__new';
// One search at a time: Spotify's request quota for Development Mode apps is small
const CONCURRENCY = 1;

const urlParams = new URLSearchParams(location.search);

const state = {
  demo: urlParams.has('demo'),
  clientId: null,
  client: null,
  me: null,
  playlists: [],
  playlistsLoading: false,
  session: null, // current review, persisted in localStorage
  matching: false,
  importing: false,
};

const storage = {
  get(key) { try { return localStorage.getItem(key); } catch { return null; } },
  set(key, value) {
    try {
      localStorage.setItem(key, value);
      return true;
    } catch {
      return false; // not available or full
    }
  },
  del(key) { try { localStorage.removeItem(key); } catch { /* not available */ } },
};

// ---------- Session persistence ----------

const sessionKey = () => (state.demo ? 'pp.session.demo' : 'pp.session');
const TRANSIENT_KEYS = new Set(['busy', 'playing', 'dup']);
let saveWarned = false;

function saveNow() {
  if (!state.session) return storage.del(sessionKey());
  const saved = storage.set(sessionKey(), JSON.stringify(state.session, (key, value) => (TRANSIENT_KEYS.has(key) ? undefined : value)));
  // Very long lists can exceed the browser storage; warn once so the tab is not closed before importing
  if (!saved && !saveWarned) {
    saveWarned = true;
    notice(t('app.saveFailed'), { type: 'error' });
  }
}
const save = debounce(saveNow, 300);

function loadSession() {
  try {
    const s = JSON.parse(storage.get(sessionKey()));
    return s?.rows?.length && s.phase !== 'done' ? s : null;
  } catch {
    return null;
  }
}

// ---------- Startup & login ----------

async function init() {
  if (urlParams.has('lang')) setLanguage(urlParams.get('lang'));
  translatePage();
  initNotice();
  initReview({ state, save, notice, onError: handleError });
  bindLanguage();
  bindSetup();
  bindInput();
  bindReview();

  if (state.demo) {
    state.client = new DemoClient();
    $('#demo-badge').hidden = false;
    $('#btn-demo-list').hidden = false;
    return startApp();
  }

  state.clientId = storage.get(CLIENT_KEY);
  try {
    await completeLogin();
  } catch (err) {
    notice(err.message, { type: 'error' });
  }
  if (!state.clientId) return showSetup();
  if (!hasSession(state.clientId)) return showView('login');
  state.client = new SpotifyClient(state.clientId);
  return startApp();
}

async function startApp() {
  showView('loading');
  notice(null);
  state.client.onWait = (ms) => setProgressText(t('review.rateLimited', { seconds: Math.ceil(ms / 1000) }));
  try {
    state.me = await state.client.me();
  } catch (err) {
    if (err instanceof AuthError) {
      showView('login');
      return handleError(err);
    }
    notice(err.message, { type: 'error', action: { label: t('app.retry'), fn: startApp } });
    return;
  }
  $('#account').hidden = false;
  $('#account-name').textContent = state.demo ? t('demo.account') : state.me.display_name || state.me.id;
  $('#btn-settings').hidden = state.demo;
  $('#btn-logout').dataset.i18n = state.demo ? 'account.exitDemo' : 'account.logout';
  translatePage($('#account'));

  const playlistsLoaded = loadPlaylists();
  const example = state.demo && urlParams.get('demo') === 'example';
  const preload = state.demo ? null : await fetchPreload();
  const restored = !preload && !example && loadSession();

  if (restored) {
    state.session = restored;
    // Interrupted searches are not resumed automatically, so no requests are spent without asking
    restored.rows.forEach((r) => { if (r.status === 'searching') r.status = 'pending'; });
    openReview();
    notice(t('review.restored'), { action: { label: t('review.discard'), fn: resetToInput } });
    return;
  }
  showView('input');
  updateParseInfo();
  if (preload) await applyPreload(preload, playlistsLoaded);
  if (example) {
    await playlistsLoaded;
    insertExample();
    if (canStart()) startMatching();
  }
}

function handleError(err) {
  if (err instanceof AuthError) {
    stopMatching();
    saveNow();
    state.importing = false;
    $('#account').hidden = true;
    if (state.clientId) showView('login');
    else showSetup();
    notice(state.session ? `${err.message} ${t('error.sessionKept')}` : err.message, { type: 'error' });
    return;
  }
  notice(err?.message || String(err), { type: 'error' });
}

function bindLanguage() {
  $$('[data-lang]').forEach((button) => button.addEventListener('click', () => {
    if (!setLanguage(button.dataset.lang)) return;
    // Texts generated at runtime are rendered again in the new language
    if (state.demo && state.me) $('#account-name').textContent = t('demo.account');
    renderPlaylistSelects();
    updateParseInfo();
    if (state.session) refresh();
    if (state.session?.phase === 'done') renderDone();
    $('#redirect-uri').textContent = redirectUri();
  }));
}

function showSetup() {
  $('#redirect-uri').textContent = redirectUri();
  $('#input-client-id').value = state.clientId || '';
  showView('setup');
}

function bindSetup() {
  $('#form-setup').addEventListener('submit', (e) => {
    e.preventDefault();
    const id = $('#input-client-id').value.trim();
    if (id !== state.clientId) logout();
    state.clientId = id;
    storage.set(CLIENT_KEY, id);
    notice(null);
    if (hasSession(id)) {
      state.client = new SpotifyClient(id);
      startApp();
    } else {
      showView('login');
    }
  });
  $('#btn-copy-redirect').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(redirectUri());
      notice(t('setup.copied'), { type: 'ok' });
    } catch {
      notice(t('setup.copyManually', { uri: redirectUri() }));
    }
  });
  $('#btn-login').addEventListener('click', () => {
    saveNow();
    startLogin(state.clientId);
  });
  $('#btn-setup-again').addEventListener('click', showSetup);
  $('#btn-settings').addEventListener('click', showSetup);
  $('#btn-logout').addEventListener('click', () => {
    if (state.demo) {
      location.href = '/';
      return;
    }
    stopMatching();
    saveNow();
    logout();
    state.client = null;
    $('#account').hidden = true;
    notice(null);
    showView('login');
  });
}

// ---------- Preloading from the command line ----------

async function fetchPreload() {
  try {
    const res = await fetch('/api/preload');
    const data = res.ok ? await res.json() : null;
    if (!data?.id || storage.get(PRELOAD_KEY) === data.id) return null;
    storage.set(PRELOAD_KEY, data.id);
    return data;
  } catch {
    return null;
  }
}

async function applyPreload(preload, playlistsLoaded) {
  storage.del(sessionKey());
  const bytes = Uint8Array.from(atob(preload.data), (c) => c.charCodeAt(0));
  $('#input-list').value = decodeBytes(bytes);
  $('#select-order').value = preload.order || 'auto';
  updateParseInfo();
  notice(t('input.listLoaded', { name: preload.filename }), { type: 'ok' });
  if (!preload.playlist) return;
  await playlistsLoaded;
  if (selectPlaylist(preload.playlist) && canStart()) startMatching();
}

/** Selects a playlist by name, link or ID; unknown names preselect "new playlist". */
function selectPlaylist(value) {
  const id = (value.match(/playlist[/:]([A-Za-z0-9]{22})/) || [])[1] || (/^[A-Za-z0-9]{22}$/.test(value) ? value : null);
  const wanted = value.trim().toLowerCase();
  const found = state.playlists.find((p) => p.id === id) || state.playlists.find((p) => p.name.trim().toLowerCase() === wanted);
  const select = $('#select-playlist');
  if (found) {
    select.value = found.id;
  } else if (id) {
    notice(t('playlists.notFound', { id }), { type: 'error' });
    return false;
  } else {
    select.value = NEW_PLAYLIST;
    $('#input-new-name').value = value.trim();
    notice(t('playlists.willCreate', { name: value.trim() }));
  }
  onPlaylistChange();
  return true;
}

// ---------- Steps 1 & 2: list and target ----------

function bindInput() {
  const textarea = $('#input-list');
  textarea.addEventListener('input', debounce(updateParseInfo, 250));
  $('#select-order').addEventListener('change', updateParseInfo);
  $('#input-file').addEventListener('change', (e) => {
    if (e.target.files[0]) readFile(e.target.files[0]);
    e.target.value = '';
  });

  const dropzone = $('#dropzone');
  dropzone.addEventListener('dragover', (e) => { e.preventDefault(); dropzone.classList.add('drag'); });
  dropzone.addEventListener('dragleave', () => dropzone.classList.remove('drag'));
  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.classList.remove('drag');
    if (e.dataTransfer.files[0]) readFile(e.dataTransfer.files[0]);
  });
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => e.preventDefault());

  $('#btn-demo-list').addEventListener('click', insertExample);
  $('#select-playlist').addEventListener('change', onPlaylistChange);
  $('#input-new-name').addEventListener('input', updateStartButton);
  $('#btn-reload-playlists').addEventListener('click', loadPlaylists);
  $('#btn-match').addEventListener('click', startMatching);
}

function insertExample() {
  $('#input-list').value = DEMO_LIST;
  updateParseInfo();
  if (!$('#select-playlist').value) selectPlaylist(DEMO_TARGET);
}

async function readFile(file) {
  $('#input-list').value = decodeBytes(await file.arrayBuffer());
  updateParseInfo();
  notice(t('input.fileLoaded', { name: file.name }), { type: 'ok' });
}

const currentParse = () => parseList($('#input-list').value, { order: $('#select-order').value });

function updateParseInfo() {
  const { entries, format } = currentParse();
  const unusable = entries.filter((e) => e.error).length;
  $('#parse-info').textContent = entries.length ? t('input.parsed', { n: entries.length, format, unusable }) : '';
  // The request overview shows how many Spotify requests this list will need
  window.dispatchEvent(new CustomEvent('pp:parsed', { detail: { entries: entries.length - unusable } }));
  updateStartButton();
}

async function loadPlaylists() {
  state.playlistsLoading = true;
  renderPlaylistSelects();
  try {
    const all = await state.client.myPlaylists();
    state.playlists = all.filter((p) => p.owner?.id === state.me.id || p.collaborative);
  } catch (err) {
    state.playlists = [];
    handleError(err);
  } finally {
    state.playlistsLoading = false;
  }
  renderPlaylistSelects();
}

function fillPlaylistSelect(select, { withChoose, extra = null }) {
  const previous = select.value;
  if (state.playlistsLoading) {
    select.replaceChildren(new Option(t('playlists.loading'), ''));
    return;
  }
  const options = withChoose ? [new Option(t('playlists.choose'), '')] : [];
  options.push(new Option(t('playlists.new'), NEW_PLAYLIST));
  const playlists = extra && !state.playlists.some((p) => p.id === extra.id) ? [extra, ...state.playlists] : state.playlists;
  for (const p of playlists) {
    const count = p.items?.total ?? p.tracks?.total;
    const shared = !!p.owner && p.owner.id !== state.me?.id;
    options.push(new Option(t('playlists.option', { name: p.name, count, shared }), p.id));
  }
  select.replaceChildren(...options);
  if ([...select.options].some((o) => o.value === previous)) select.value = previous;
}

function renderPlaylistSelects() {
  fillPlaylistSelect($('#select-playlist'), { withChoose: true });
  onPlaylistChange();
  if (state.session) renderReviewTarget();
}

function onPlaylistChange() {
  $('#new-playlist').hidden = $('#select-playlist').value !== NEW_PLAYLIST;
  updateStartButton();
}

function startProblem() {
  if (!currentParse().entries.length) return 'input.needList';
  const value = $('#select-playlist').value;
  if (value === NEW_PLAYLIST) return $('#input-new-name').value.trim() ? null : 'input.needName';
  return state.playlists.some((p) => p.id === value) ? null : 'input.needTarget';
}

const canStart = () => !startProblem();

function updateStartButton() {
  const problem = startProblem();
  $('#btn-match').disabled = !!problem;
  $('#start-hint').textContent = problem ? t(problem) : '';
}

// ---------- Step 3: matching & review ----------

function startMatching() {
  if (!canStart()) return;
  const order = $('#select-order').value;
  const { entries } = parseList($('#input-list').value, { order });
  const playlist = state.playlists.find((p) => p.id === $('#select-playlist').value);
  state.session = {
    listText: $('#input-list').value,
    order,
    target: playlist
      ? { id: playlist.id, name: playlist.name, isNew: false }
      : { id: null, name: $('#input-new-name').value.trim(), isNew: true, isPublic: $('#input-new-public').checked },
    existingUris: [],
    skipDuplicates: true,
    filter: 'all',
    phase: 'review',
    rows: entries.map((entry, i) => ({
      id: i, entry, status: 'pending', candidates: [], selectedId: null,
      include: false, manual: false, imported: false, error: null, open: false, rev: 0,
    })),
  };
  notice(null);
  openReview();
  saveNow();
  if (playlist) loadExistingUris();
  resumeMatching();
}

function openReview() {
  showView('review');
  renderReviewTarget();
  renderAll();
}

function renderReviewTarget() {
  const s = state.session;
  const select = $('#review-playlist');
  const nameInput = $('#review-new-name');
  // Keep the name current if the playlist was renamed since the session was saved
  const known = s.target.id && state.playlists.find((p) => p.id === s.target.id);
  if (known) s.target.name = known.name;
  fillPlaylistSelect(select, { withChoose: false, extra: s.target.id ? { id: s.target.id, name: s.target.name } : null });
  if (!state.playlistsLoading) select.value = s.target.id || NEW_PLAYLIST;

  const isNew = !s.target.id;
  nameInput.hidden = !isNew;
  $('#review-new-public-wrap').hidden = !isNew;
  $('#review-target-hint').hidden = !isNew;
  if (isNew && document.activeElement !== nameInput) nameInput.value = s.target.name || '';
  $('#review-new-public').checked = !!s.target.isPublic;

  const locked = state.importing || s.rows.some((r) => r.imported);
  select.disabled = locked || state.playlistsLoading;
  nameInput.disabled = locked;
  $('#review-new-public').disabled = locked;
}

function onReviewTargetChange(e) {
  const s = state.session;
  if (e.target.value === NEW_PLAYLIST) {
    s.target = { id: null, name: $('#review-new-name').value.trim(), isNew: true, isPublic: $('#review-new-public').checked };
  } else {
    const playlist = state.playlists.find((p) => p.id === e.target.value);
    if (!playlist) return;
    s.target = { id: playlist.id, name: playlist.name, isNew: false };
  }
  s.existingUris = [];
  if (s.target.id) loadExistingUris();
  renderReviewTarget();
  refresh();
  saveNow();
  if (!s.target.id) $('#review-new-name').focus();
}

async function loadExistingUris() {
  const session = state.session;
  const targetId = session.target.id;
  try {
    const uris = await state.client.playlistTrackUris(targetId);
    if (state.session !== session || session.target.id !== targetId) return;
    session.existingUris = [...uris];
    refresh();
    save();
  } catch (err) {
    if (err instanceof AuthError) return handleError(err);
    notice(t('playlists.existingFailed', { message: err.message }), { type: 'error' });
  }
}

const setProgressText = (text) => { $('#progress-text').textContent = text; };
let matchRun = 0;
let matchController = null;

async function resumeMatching() {
  const session = state.session;
  if (!session || state.matching || state.importing) return;
  // Not searched yet, interrupted, or failed because of Spotify (list errors like album links stay as they are)
  const queue = session.rows.filter((r) => r.status === 'pending' || r.status === 'searching' || (r.status === 'error' && !r.entry.error));
  if (!queue.length) return;

  const run = ++matchRun;
  const controller = new AbortController();
  matchController = controller;
  const active = () => run === matchRun && state.session === session;
  queue.forEach((r) => {
    r.status = 'pending';
    r.error = null;
    touch(r);
  });
  state.matching = true;
  notice(null);

  const total = session.rows.length;
  const updateProgress = () => {
    const done = session.rows.filter((r) => r.status === 'done' || r.status === 'error').length;
    $('#progress').hidden = false;
    $('#progress-bar').style.width = `${Math.round((done / total) * 100)}%`;
    setProgressText(t('review.progress', { done, total }));
  };
  updateProgress();
  refresh();

  let fatal = null;
  const worker = async () => {
    while (queue.length && !fatal && !controller.signal.aborted && active()) {
      const row = queue.shift();
      if (row.removed) continue; // removed from the list while the search was running
      row.status = 'searching';
      touch(row);
      refresh();
      try {
        if (row.entry.error) throw new Error(row.entry.error);
        const candidates = await findCandidates(row.entry, {
          order: session.order,
          search: (q) => state.client.search(q, { signal: controller.signal }),
          getTrack: (id) => state.client.getTrack(id, { signal: controller.signal }),
        });
        row.candidates = candidates.map((c) => ({ track: slimTrack(c.track), score: Math.round(c.score * 1000) / 1000, swapped: c.swapped || undefined }));
        row.selectedId = row.candidates[0]?.track.id ?? null;
        row.include = !!row.candidates[0] && row.candidates[0].score >= SCORE_ACCEPT;
        row.status = 'done';
      } catch (err) {
        if (err.name === 'AbortError' || err instanceof AuthError || err.fatal) {
          // Cancelled or pointless to continue (quota, rate limit, access denied): try this row again later
          row.status = 'pending';
          if (err.name !== 'AbortError') fatal = err;
        } else {
          row.status = 'error';
          row.error = err.message;
        }
      }
      touch(row);
      if (active()) {
        updateProgress();
        refresh();
        save();
      }
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  if (matchController === controller) matchController = null;
  if (!active()) return;

  state.matching = false;
  $('#progress').hidden = true;
  refresh();
  saveNow();

  if (fatal instanceof AuthError) return handleError(fatal);
  const pending = session.rows.filter((r) => r.status === 'pending').length;
  const resume = pending ? { label: t('review.resumeShort'), fn: resumeMatching } : null;
  if (fatal) return notice(`${fatal.message} ${t('review.resultsKept')}`, { type: 'error', action: resume });
  if (controller.signal.aborted) return notice(t('review.cancelled', { n: pending }), { action: resume });

  const counts = { sure: 0, check: 0, none: 0 };
  session.rows.forEach((r) => { counts[rowClass(r)] = (counts[rowClass(r)] || 0) + 1; });
  notice(t('review.doneNotice', counts), { type: counts.check + counts.none ? 'info' : 'ok' });
}

/** Cancels the running search immediately, including requests in flight and rate-limit waits. */
function cancelMatching() {
  matchController?.abort();
}

// ---------- Confirmation & import ----------

function bindReview() {
  $('#btn-back').addEventListener('click', backToInput);
  $('#btn-cancel').addEventListener('click', cancelMatching);
  $('#btn-resume').addEventListener('click', resumeMatching);
  $('#btn-import').addEventListener('click', confirmImport);
  $('#btn-new').addEventListener('click', resetToInput);
  $('#review-playlist').addEventListener('change', onReviewTargetChange);
  $('#review-new-name').addEventListener('input', (e) => {
    state.session.target.name = e.target.value.trim();
    refresh();
    save();
  });
  $('#review-new-public').addEventListener('change', (e) => {
    state.session.target.isPublic = e.target.checked;
    save();
  });
  window.addEventListener('beforeunload', saveNow);
}

function stopMatching() {
  matchRun++;
  matchController?.abort();
  matchController = null;
  state.matching = false;
  $('#progress').hidden = true;
}

function backToInput() {
  const s = state.session;
  if (s.rows.some((r) => r.manual) && !confirm(t('review.backConfirm'))) return;
  stopMatching();
  $('#input-list').value = s.listText;
  $('#select-order').value = s.order;
  if (s.target.id && state.playlists.some((p) => p.id === s.target.id)) {
    $('#select-playlist').value = s.target.id;
  } else if (!s.target.id) {
    $('#select-playlist').value = NEW_PLAYLIST;
    $('#input-new-name').value = s.target.name;
    $('#input-new-public').checked = !!s.target.isPublic;
  }
  onPlaylistChange();
  updateParseInfo();
  state.session = null;
  saveNow();
  notice(null);
  showView('input');
}

function resetToInput() {
  stopMatching();
  state.session = null;
  saveNow();
  $('#input-list').value = '';
  updateParseInfo();
  notice(null);
  showView('input');
}

async function confirmImport() {
  const rows = importRows();
  if (!rows.length || state.matching || state.importing) return;
  const s = state.session;
  if (!s.target.id && !s.target.name) {
    notice(t('review.needsName'), { type: 'error' });
    $('#review-new-name').focus();
    return;
  }
  const notImported = s.rows.filter((r) => !r.imported && !rows.includes(r));
  const notSearched = notImported.filter((r) => r.status === 'pending').length;
  const duplicates = notImported.filter((r) => r.dup && r.include).length;
  const excluded = notImported.length - duplicates - notSearched;
  const unconfirmed = rows.filter((r) => rowClass(r) !== 'sure').length;

  $('#confirm-text').textContent = t(s.target.id ? 'confirm.question' : 'confirm.questionNew', { count: rows.length, name: s.target.name });
  const details = [t('confirm.order')];
  if (unconfirmed) details.push(t('confirm.unconfirmed', { n: unconfirmed }));
  if (duplicates) details.push(t('confirm.duplicates', { n: duplicates }));
  if (notSearched) details.push(t('confirm.notSearched', { n: notSearched }));
  if (excluded) details.push(t('confirm.excluded', { n: excluded }));
  $('#confirm-details').replaceChildren(...details.map((text) => Object.assign(document.createElement('li'), { textContent: text })));

  const dialog = $('#dialog-confirm');
  dialog.returnValue = '';
  dialog.showModal();
  const ok = await new Promise((resolve) => dialog.addEventListener('close', () => resolve(dialog.returnValue === 'ok'), { once: true }));
  if (ok) runImport(rows);
}

async function runImport(rows) {
  const s = state.session;
  state.importing = true;
  renderReviewTarget();
  refresh();
  $('#progress').hidden = false;
  $('#progress-bar').style.width = '0%';
  setProgressText(t('import.starting'));
  let added = 0;

  try {
    if (!s.target.id) {
      setProgressText(t('import.creating'));
      const playlist = await state.client.createPlaylist({ name: s.target.name, isPublic: !!s.target.isPublic, description: t('import.description') });
      Object.assign(s.target, { id: playlist.id, isNew: false, created: true });
      saveNow();
      loadPlaylists();
    }
    await state.client.addTracks(s.target.id, rows.map((r) => selectedTrack(r).uri), (count, total) => {
      rows.slice(added, count).forEach((r) => { r.imported = true; touch(r); });
      added = count;
      $('#progress-bar').style.width = `${Math.round((count / total) * 100)}%`;
      setProgressText(t('import.progress', { count, total }));
      refresh();
      saveNow();
    });
  } catch (err) {
    state.importing = false;
    $('#progress').hidden = true;
    renderReviewTarget();
    refresh();
    saveNow();
    if (err instanceof AuthError) return handleError(err);
    const partial = added ? t('import.partial', { added, total: rows.length }) : '';
    notice(t('import.failed', { partial, message: err.message }), { type: 'error' });
    return;
  }

  state.importing = false;
  $('#progress').hidden = true;
  s.phase = 'done';
  s.importedCount = rows.length;
  saveNow();
  renderDone();
  notice(null);
  showView('done');
}

function renderDone() {
  const s = state.session;
  const params = { name: s.target.name, count: s.importedCount };
  $('#done-text').textContent = t(s.target.created ? 'done.created' : 'done.added', params);
  $('#done-open').hidden = state.demo;
  $('#done-open').href = `https://open.spotify.com/playlist/${encodeURIComponent(s.target.id)}`;
}

init();
