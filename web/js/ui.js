// Small DOM helpers for the UI.

export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESCAPES[c]);

export function formatDuration(ms) {
  if (!ms) return '';
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function debounce(fn, ms) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

const VIEWS = ['loading', 'setup', 'login', 'input', 'review', 'done'];

export function showView(name) {
  for (const view of VIEWS) $(`#view-${view}`).hidden = view !== name;
  window.scrollTo({ top: 0 });
}

let noticeHandler = null;

/** Notice bar at the top. notice(null) hides it. */
export function notice(text, { type = 'info', action = null } = {}) {
  const box = $('#notice');
  if (!text) {
    box.hidden = true;
    return;
  }
  box.className = `notice ${type}`;
  $('#notice-text').textContent = text;
  const button = $('#notice-action');
  button.hidden = !action;
  button.textContent = action?.label || '';
  noticeHandler = action?.fn || null;
  box.hidden = false;
}

export function initNotice() {
  $('#notice-close').addEventListener('click', () => notice(null));
  $('#notice-action').addEventListener('click', () => {
    const handler = noticeHandler;
    notice(null);
    handler?.();
  });
}
