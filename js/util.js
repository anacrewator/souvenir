export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];

// Tiny element builder: el('div', { class: 'x', onclick }, child, 'text')
export function el(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k === 'text') n.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid == null || kid === false) continue;
    n.append(kid.nodeType ? kid : String(kid));
  }
  return n;
}

export async function pool(list, size, fn) {
  let next = 0;
  const workers = Array.from({ length: Math.min(size, list.length) }, async () => {
    while (next < list.length) {
      const i = next++;
      await fn(list[i], i);
    }
  });
  await Promise.all(workers);
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const LOCALE = 'en-GB';
const fmt = (d, o) => d.toLocaleDateString(LOCALE, o);

export function dayKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export const monthKey = (d) => dayKey(d).slice(0, 7);

export function fmtRange(a, b) {
  const full = { day: 'numeric', month: 'short', year: 'numeric' };
  if (dayKey(a) === dayKey(b)) return fmt(a, full);
  if (a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth()) return `${a.getDate()}–${fmt(b, full)}`;
  if (a.getFullYear() === b.getFullYear()) return `${fmt(a, { day: 'numeric', month: 'short' })} – ${fmt(b, full)}`;
  return `${fmt(a, full)} – ${fmt(b, full)}`;
}
export const fmtMonth = (d) => fmt(d, { month: 'long', year: 'numeric' });
export const fmtLongDay = (d) => fmt(d, { weekday: 'long', day: 'numeric', month: 'long' });
export const fmtDateTime = (d) =>
  `${fmt(d, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}, ${d.toLocaleTimeString(LOCALE, { hour: '2-digit', minute: '2-digit' })}`;

export const plural = (n, one, many = one + 's') => `${n.toLocaleString(LOCALE)} ${n === 1 ? one : many}`;

export function spanDays(a, b) {
  const s = new Date(a.getFullYear(), a.getMonth(), a.getDate());
  const e = new Date(b.getFullYear(), b.getMonth(), b.getDate());
  return Math.round((e - s) / 864e5) + 1;
}

const loaded = new Map();
export function loadScript(src) {
  if (!loaded.has(src)) {
    loaded.set(src, new Promise((res, rej) => {
      const s = el('script', { src, async: true, crossorigin: 'anonymous' });
      s.onload = res;
      s.onerror = () => { loaded.delete(src); rej(new Error(`Couldn't load ${src}`)); };
      document.head.append(s);
    }));
  }
  return loaded.get(src);
}
export function loadCss(href) {
  if (!loaded.has(href)) {
    loaded.set(href, new Promise((res, rej) => {
      const l = el('link', { rel: 'stylesheet', href, crossorigin: 'anonymous' });
      l.onload = res;
      l.onerror = rej;
      document.head.append(l);
    }));
  }
  return loaded.get(href);
}

export function sanitizeName(s) {
  return String(s).replace(/[\/\\:*?"<>|\u0000-\u001f]+/g, '-').replace(/\s+/g, ' ').trim().slice(0, 90) || 'Album';
}

export function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

// Popovers sit in the top layer, so they show above open dialogs too.
function showTop(node) {
  if (node.showPopover) { try { node.showPopover(); } catch { /* already open */ } }
  else node.hidden = false;
}
function hideTop(node) {
  if (node.hidePopover) { try { node.hidePopover(); } catch { /* already closed */ } }
  else node.hidden = true;
}

let toastTimer;
export function toast(msg, ms = 5000) {
  const t = $('#toast');
  t.textContent = msg;
  hideTop(t);
  showTop(t);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => hideTop(t), ms);
}

export const busy = {
  show(text, fraction = null) {
    const b = $('#busy');
    $('#busy-text', b).textContent = text;
    const bar = $('#busy-bar', b);
    bar.classList.toggle('indeterminate', fraction == null);
    bar.style.setProperty('--p', fraction == null ? 0.35 : Math.max(0.02, Math.min(1, fraction)));
    if (b.showPopover) { if (!b.matches(':popover-open')) b.showPopover(); }
    else b.hidden = false;
  },
  hide() { hideTop($('#busy')); },
};

export const prefersReducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
