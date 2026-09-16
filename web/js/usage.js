// Overview of the requests sent to Spotify – helps to stay within Spotify's request quota.
import { requestUsage, usageHistory, quotaStops, resetUsage } from './spotify.js';
import { t, getLanguage } from './i18n.js';
import { $, esc } from './ui.js';

// Rough guide from tests, not an official Spotify figure: the quota was used up after about
// this many requests within 24 hours, followed by a block of about 24 hours.
export const DAILY_REQUESTS_GUIDE = 1000;

const demo = new URLSearchParams(location.search).has('demo');
let sessionCount = 0; // requests since this page was loaded
let listEntries = 0; // searchable entries of the list in the input view

const format = (n) => Number(n || 0).toLocaleString(getLanguage());
const formatTime = (at, options) => new Date(at).toLocaleString(getLanguage(), options);

function renderButton() {
  const button = $('#btn-usage');
  const { day } = requestUsage();
  button.hidden = demo;
  button.textContent = t('usage.button', { day: format(day), guide: format(DAILY_REQUESTS_GUIDE) });
  button.classList.toggle('warn', day >= DAILY_REQUESTS_GUIDE * 0.8 && day < DAILY_REQUESTS_GUIDE);
  button.classList.toggle('over', day >= DAILY_REQUESTS_GUIDE);
}

/** Estimate below "Find tracks": requests the list needs (one or two per entry) compared with the guide. */
function renderEstimate() {
  const hint = $('#budget-hint');
  if (demo || !listEntries) {
    hint.hidden = true;
    return;
  }
  const left = Math.max(0, DAILY_REQUESTS_GUIDE - requestUsage().day);
  const tooMany = listEntries * 2 > left;
  const estimate = t('usage.estimate', { min: format(listEntries), max: format(listEntries * 2), left: format(left), guide: format(DAILY_REQUESTS_GUIDE) });
  hint.textContent = tooMany ? `${estimate} ${t('usage.estimateTooMany')}` : estimate;
  hint.classList.toggle('warn', tooMany);
  hint.hidden = false;
}

function renderDialog() {
  const { hour, day } = requestUsage();
  $('#usage-session').textContent = format(sessionCount);
  $('#usage-hour').textContent = format(hour);
  $('#usage-day').textContent = format(day);

  const stops = [...quotaStops()].reverse();
  $('#usage-stops').innerHTML = stops.length
    ? stops.map((s) => `<li>${esc(t('usage.stop', { time: formatTime(s.at, { dateStyle: 'short', timeStyle: 'short' }), day: format(s.day) }))}</li>`).join('')
    : `<li class="muted">${esc(t('usage.noStops'))}</li>`;

  const hours = usageHistory();
  const hourFormat = { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' };
  $('#usage-hours').innerHTML = hours.length
    ? hours.map(({ at, count }) => `<tr><td>${esc(formatTime(at, hourFormat))}</td><td class="count">${format(count)}</td></tr>`).join('')
    : `<tr><td class="muted" colspan="2">${esc(t('usage.noRequests'))}</td></tr>`;
}

function render() {
  renderButton();
  renderEstimate();
  if ($('#dialog-usage').open) renderDialog();
}

$('#btn-usage').addEventListener('click', () => {
  renderDialog();
  $('#dialog-usage').showModal();
});

$('#btn-usage-reset').addEventListener('click', () => {
  if (confirm(t('usage.resetConfirm'))) resetUsage();
});

window.addEventListener('pp:usage', (e) => {
  if (e.detail?.type === 'request') sessionCount++;
  if (e.detail?.type === 'reset') sessionCount = 0;
  render();
});
window.addEventListener('pp:parsed', (e) => {
  listEntries = e.detail?.entries || 0;
  renderEstimate();
});
window.addEventListener('pp:language', render);

render();
