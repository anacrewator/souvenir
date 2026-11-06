// Small previews, made on demand as they scroll into view, a few at a time.
import { exifr } from './metadata.js';
import { el } from './util.js';
import { heicThumbnail } from './heic-thumb.js';

const registry = new Map();
const thumbs = new Map(); // id -> Promise<url|null>
const urls = new Set();

export function register(item) {
  registry.set(item.id, item);
  if (item.file && browserOpensHeic !== true && looksHeic(item.file, item.name)) loadHeic().catch(() => {});
}
export const itemById = (id) => registry.get(id);

export function resetThumbs() {
  urls.forEach((u) => URL.revokeObjectURL(u));
  urls.clear();
  thumbs.clear();
  jobs.length = 0;
  tilesOf.clear();
  registry.clear();
}

function track(blob) {
  if (!blob) return null;
  const u = URL.createObjectURL(blob);
  urls.add(u);
  return u;
}

// Work queue. Tiles on screen go first (newest first), so scrolling never leaves you
// waiting behind photos you've already passed. Off-screen ones fill in afterwards.
const MAX_AT_ONCE = Math.max(2, Math.min(6, (navigator.hardwareConcurrency || 4) - 1));
let active = 0;
const jobs = [];
const near = new WeakSet(); // tiles on (or almost on) screen
const tilesOf = new Map(); // id -> Set of tile nodes

const wanted = (job) => job.urgent || [...(tilesOf.get(job.id) || [])].some((n) => near.has(n) && n.isConnected);

function pump() {
  while (active < MAX_AT_ONCE && jobs.length) {
    let i = jobs.length - 1;
    for (let k = jobs.length - 1; k >= 0; k--) if (wanted(jobs[k])) { i = k; break; }
    const [job] = jobs.splice(i, 1);
    active++;
    job.run().finally(() => { active--; pump(); });
  }
}

function slot(id, fn, urgent) {
  return new Promise((resolve, reject) => {
    jobs.push({ id, urgent, run: () => fn().then(resolve, reject) });
    queueMicrotask(pump);
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

// Chrome, Firefox and Edge can't open iPhone HEIC photos. For previews, the small picture
// the iPhone saves inside each HEIC is decoded (a few milliseconds). Only when there's
// none, or for the full-size view, the whole photo is decoded with libheif (via heic-to),
// in a background worker. The library loads as soon as the first HEIC shows up.
const HEIC_LIB = 'https://cdn.jsdelivr.net/npm/heic-to@1.6.6/dist/heic-to.js';
let heicLib = null;
const loadHeic = () => (heicLib ??= import(HEIC_LIB).catch((e) => { heicLib = null; throw e; }));
const HEIC_EXT = /\.(heic|heif)$/i;
const looksHeic = (blob, name = '') => HEIC_EXT.test(name || blob.name || '') || /hei[cf]/i.test(blob.type || '');
let browserOpensHeic = null; // learnt from the first HEIC: true in Safari, false elsewhere

async function heicBitmapBlob(blob, size) {
  const { heicTo } = await loadHeic();
  const bmp = await heicTo({ blob, type: 'bitmap' });
  try { return await drawScaled(bmp, bmp.width, bmp.height, size); } finally { bmp.close?.(); }
}
const heicScaled = heicBitmapBlob;

async function heicPreview(blob, size) {
  const small = await heicThumbnail(blob).catch(() => null);
  if (small) {
    const b = await heicBitmapBlob(small, size).catch(() => null);
    if (b) return b;
  }
  return heicBitmapBlob(blob, size);
}

// The browser decodes and shrinks the photo in the background, off the page's main thread.
async function browserScaled(blob, size) {
  const bmp = await createImageBitmap(blob, { resizeHeight: size, resizeQuality: 'medium', imageOrientation: 'from-image' });
  try { return await drawScaled(bmp, bmp.width, bmp.height, Math.round(size * 4 / 3)); } finally { bmp.close?.(); }
}

async function viaImg(blob, size) {
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return await drawScaled(img, img.naturalWidth, img.naturalHeight, size);
  } finally { URL.revokeObjectURL(url); }
}

async function imageThumb(blob, size, name) {
  const heic = looksHeic(blob, name);
  if (!heic || browserOpensHeic !== false) {
    try {
      const b = 'createImageBitmap' in window ? await browserScaled(blob, Math.round(size * 0.75)) : await viaImg(blob, size);
      if (heic) browserOpensHeic = true;
      return track(b);
    } catch {
      if (heic && browserOpensHeic == null) browserOpensHeic = false;
    }
    if (!heic) {
      const b = await viaImg(blob, size).catch(() => null);
      if (b) return track(b);
    }
  }
  if (heic) {
    const b = await heicPreview(blob, size).catch(() => null);
    if (b) return track(b);
  }
  return track(await embeddedThumb(blob));
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

export function thumbUrl(item, { size = 480, urgent = false } = {}) {
  if (!thumbs.has(item.id)) {
    thumbs.set(item.id, slot(item.id, async () => {
      if (item.fetchThumb) return track(await item.fetchThumb());
      if (item.kind === 'video') return videoThumb(item.file, size);
      return imageThumb(item.file, size, item.name);
    }, urgent).catch(() => null));
  }
  return thumbs.get(item.id);
}

async function fill(node) {
  const item = registry.get(node.dataset.id);
  if (!item) return;
  const url = await thumbUrl(item);
  io?.unobserve(node);
  tilesOf.get(item.id)?.delete(node);
  if (!url) { node.classList.add('broken'); return; }
  const img = el('img', { alt: '', decoding: 'async', draggable: 'false' });
  img.onload = () => node.classList.add('ready');
  img.src = url;
  node.append(img);
}

const io = 'IntersectionObserver' in window
  ? new IntersectionObserver((entries) => {
      let changed = false;
      for (const e of entries) {
        if (e.isIntersecting) {
          near.add(e.target);
          changed = true;
          if (!e.target.dataset.asked) { e.target.dataset.asked = '1'; fill(e.target); }
        } else near.delete(e.target);
      }
      if (changed) pump();
    }, { rootMargin: '300px 0px' })
  : null;

export function thumbNode(item, extraClass = '') {
  const node = el('div', { class: `thumb ${item.kind === 'video' ? 'is-video' : ''} ${extraClass}`.trim(), 'data-id': item.id });
  if (!tilesOf.has(item.id)) tilesOf.set(item.id, new Set());
  tilesOf.get(item.id).add(node);
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
    if (looksHeic(item.file, item.name)) {
      const b = await heicScaled(item.file, 2400).catch(() => null);
      if (b) {
        const big = URL.createObjectURL(b);
        const im = el('img', { alt: item.name });
        im.src = big;
        return { el: im, cleanup: () => URL.revokeObjectURL(big) };
      }
    }
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
    } catch { /* try HEIC below */ } finally { URL.revokeObjectURL(url); }
    if (looksHeic(item.file, item.name)) {
      const b = await heicScaled(item.file, 1200).catch(() => null);
      if (b) return loadImg(URL.createObjectURL(b), true);
    }
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
