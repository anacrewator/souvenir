// Small previews, made on demand as they scroll into view, a few at a time.
import { exifr } from './metadata.js';
import { el } from './util.js';

const registry = new Map();
const thumbs = new Map(); // id -> Promise<url|null>
const urls = new Set();

export const register = (item) => registry.set(item.id, item);
export const itemById = (id) => registry.get(id);

export function resetThumbs() {
  urls.forEach((u) => URL.revokeObjectURL(u));
  urls.clear();
  thumbs.clear();
  registry.clear();
}

function track(blob) {
  if (!blob) return null;
  const u = URL.createObjectURL(blob);
  urls.add(u);
  return u;
}

let active = 0;
const waiting = [];
function slot(fn) {
  return new Promise((resolve, reject) => {
    const run = async () => {
      active++;
      try { resolve(await fn()); } catch (e) { reject(e); } finally { active--; waiting.shift()?.(); }
    };
    if (active < 4) run(); else waiting.push(run);
  });
}

function drawScaled(src, w, h, size, type = 'image/jpeg') {
  const s = Math.min(1, size / Math.max(w, h));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w * s));
  c.height = Math.max(1, Math.round(h * s));
  c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
  return new Promise((r) => c.toBlob(r, type, 0.82));
}

async function embeddedThumb(blob) {
  const t = await exifr.thumbnail(blob).catch(() => null);
  return t ? new Blob([t], { type: 'image/jpeg' }) : null;
}

async function imageThumb(blob, size) {
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return track(await drawScaled(img, img.naturalWidth, img.naturalHeight, size));
  } catch {
    // e.g. HEIC outside Safari: use the small JPEG the camera tucked inside the file.
    return track(await embeddedThumb(blob));
  } finally {
    URL.revokeObjectURL(url);
  }
}

function videoThumb(file, size) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const v = document.createElement('video');
    v.muted = true;
    v.playsInline = true;
    v.preload = 'metadata';
    let finished = false;
    const done = (res) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      v.removeAttribute('src');
      v.load();
      URL.revokeObjectURL(url);
      resolve(res);
    };
    const timer = setTimeout(() => done(null), 12000);
    v.onloadedmetadata = () => { v.currentTime = Math.min(1, (v.duration || 3) / 3); };
    v.onseeked = async () => {
      try { done(track(await drawScaled(v, v.videoWidth, v.videoHeight, size))); } catch { done(null); }
    };
    v.onerror = () => done(null);
    v.src = url;
  });
}

export function thumbUrl(item, size = 480) {
  if (!thumbs.has(item.id)) {
    thumbs.set(item.id, slot(async () => {
      if (item.fetchThumb) return track(await item.fetchThumb());
      if (item.kind === 'video') return videoThumb(item.file, size);
      return imageThumb(item.file, size);
    }).catch(() => null));
  }
  return thumbs.get(item.id);
}

async function fill(node) {
  const item = registry.get(node.dataset.id);
  if (!item) return;
  const url = await thumbUrl(item);
  if (!url) { node.classList.add('broken'); return; }
  const img = el('img', { alt: '', decoding: 'async', draggable: 'false' });
  img.onload = () => node.classList.add('ready');
  img.src = url;
  node.append(img);
}

const io = 'IntersectionObserver' in window
  ? new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.isIntersecting) { io.unobserve(e.target); fill(e.target); }
      }
    }, { rootMargin: '500px 0px' })
  : null;

export function thumbNode(item, extraClass = '') {
  const node = el('div', { class: `thumb ${item.kind === 'video' ? 'is-video' : ''} ${extraClass}`.trim(), 'data-id': item.id });
  if (io) io.observe(node); else fill(node);
  return node;
}

// Full-size media for the lightbox. Returns { el, cleanup, preview }.
export async function fullMedia(item) {
  if (item.kind === 'video') {
    const blob = item.file || (item.fetchBlob ? await item.fetchBlob().catch(() => null) : null);
    if (blob) {
      const url = URL.createObjectURL(blob);
      const v = el('video', { controls: true, playsinline: true, preload: 'metadata' });
      v.src = url;
      return { el: v, cleanup: () => { v.pause(); v.removeAttribute('src'); v.load(); URL.revokeObjectURL(url); } };
    }
  } else if (item.file) {
    const url = URL.createObjectURL(item.file);
    const img = el('img', { alt: item.name });
    img.src = url;
    try {
      await img.decode();
      return { el: img, cleanup: () => URL.revokeObjectURL(url) };
    } catch { URL.revokeObjectURL(url); }
  } else if (item.fetchLarge) {
    const blob = await item.fetchLarge().catch(() => null);
    if (blob) {
      const url = URL.createObjectURL(blob);
      const img = el('img', { alt: item.name });
      img.src = url;
      return { el: img, cleanup: () => URL.revokeObjectURL(url) };
    }
  }
  const t = await thumbUrl(item);
  const img = el('img', { alt: item.name });
  if (t) img.src = t;
  return { el: img, cleanup() {}, preview: true };
}

// A decoded image good enough for the story card (max ~1200 px).
export async function drawable(item) {
  if (item.kind !== 'video' && item.file) {
    const url = URL.createObjectURL(item.file);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      const b = await drawScaled(img, img.naturalWidth, img.naturalHeight, 1200);
      return await loadImg(URL.createObjectURL(b), true);
    } catch { /* fall through to thumb */ } finally { URL.revokeObjectURL(url); }
  }
  if (item.fetchLarge) {
    const b = await item.fetchLarge().catch(() => null);
    if (b) return loadImg(URL.createObjectURL(b), true);
  }
  const t = await thumbUrl(item);
  return t ? loadImg(t, false) : null;
}

async function loadImg(url, revoke) {
  const img = new Image();
  img.src = url;
  try { await img.decode(); return img; } catch { return null; } finally { if (revoke) setTimeout(() => URL.revokeObjectURL(url), 1000); }
}
