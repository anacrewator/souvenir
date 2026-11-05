import { CONFIG } from '../config.js';
import { extractAll, kindOf } from './metadata.js';
import { sortLibrary, DEFAULT_SETTINGS, defaultTripTitle } from './cluster.js';
import { lookupPlace, describeTrip, flagOf } from './geocode.js';
import { register, resetThumbs, thumbNode, fullMedia } from './thumbs.js';
import { canSaveToFolder, saveToFolder, downloadZip } from './export.js';
import { makeStoryCard } from './story.js';
import { makeDemoLibrary } from './demo.js';
import { googleEnabled, startSession, waitForSelection, listSelection } from './google-photos.js';
import { driveEnabled, shareToDrive } from './drive.js';
import { preloadGoogle } from './google-auth.js';
import { withoutLocation } from './strip-location.js';
import { showEnabled, showActive, startShow, feedShow, sortShow, renameInShow, endShow, wireShow } from './sort-show.js';
import {
  $, $$, el, busy, toast, plural, fmtRange, fmtLongDay, fmtDateTime, fmtMonth, dayKey, monthKey,
  loadScript, loadCss, saveBlob, sanitizeName, prefersReducedMotion,
} from './util.js';

// ---------- state ----------
const SETTINGS_KEY = 'souvenir:settings:v1';
const NAMES_KEY = 'souvenir:names:v1';
const readJSON = (k, fallback) => { try { return JSON.parse(localStorage.getItem(k)) ?? fallback; } catch { return fallback; } };
const writeJSON = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } };

const saved = readJSON(SETTINGS_KEY, {});
const state = {
  items: [],
  seen: new Set(),
  lib: null,
  settings: { ...DEFAULT_SETTINGS, ...saved, home: 'auto' },
  names: readJSON(NAMES_KEY, {}),
  placeInfo: new Map(), // trip id -> { title, cities, countries }
  homeName: '',
  album: null,
  map: null,
  lb: { list: [], index: 0, cleanup: null, token: 0 },
  working: false,
};

const isTrip = (a) => a.kind === 'trip';
const allAlbums = () => state.lib ? [...state.lib.trips, ...state.lib.months, ...state.lib.extras] : [];
const findAlbum = (id) => allAlbums().find((a) => a.id === id);

function countLine(a) {
  const parts = [];
  if (a.photos) parts.push(plural(a.photos, 'photo'));
  if (a.videos) parts.push(plural(a.videos, 'video'));
  return parts.join(', ') || 'Empty';
}
function tiltFor(id) {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) | 0;
  return ((Math.abs(h) % 7) - 3) * 0.6;
}
const flagsFor = (a) => (state.placeInfo.get(a.id)?.countries || []).map((c) => flagOf(c.cc)).filter(Boolean).join(' ');

function titleFor(a) {
  if (state.names[a.id]) return state.names[a.id];
  if (isTrip(a)) return state.placeInfo.get(a.id)?.title || defaultTripTitle(a);
  return a.title;
}

// ---------- reading files ----------
async function ingest(entries) {
  if (state.working) return;
  const mediaCount = entries.filter((e) => ['image', 'video'].includes(kindOf(e.file))).length;
  if (!mediaCount) {
    toast("That didn't include any photos or videos. Try choosing the folder that holds them.");
    return;
  }
  state.working = true;
  const animate = showEnabled();
  if (animate) startShow(mediaCount, { onClose: revealResults });
  else busy.show(`Reading ${plural(mediaCount, 'file')}`, 0);
  try {
    const items = await extractAll(entries, (done, total, item) => {
      if (animate) feedShow(item, done);
      else if (done % 5 === 0 || done === total) busy.show(`Reading dates and places: ${done.toLocaleString()} of ${total.toLocaleString()}`, done / total);
    });
    addItems(items);
  } catch (e) {
    console.error(e);
    endShow();
    toast(`Couldn't read those files: ${e.message}`);
  } finally {
    busy.hide();
    state.working = false;
  }
}

function addItems(items) {
  let added = 0;
  for (const it of items) {
    const key = it.source === 'google' ? it.id : `${it.name.toLowerCase()}|${it.size}`;
    if (state.seen.has(key)) continue;
    state.seen.add(key);
    state.items.push(it);
    register(it);
    added++;
  }
  if (!state.items.length) { endShow(); return; }
  resort();
  $('#results').hidden = false;
  if (showActive()) sortShow(state.lib, { titleOf: titleFor, flagsOf: flagsFor });
  else revealResults();
  if (items.length && !added) toast('Those were already here, so nothing new was added.');
}

function revealResults() {
  if (!state.lib) return;
  requestAnimationFrame(() => $('#results').scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' }));
}

function resort() {
  state.lib = sortLibrary(state.items, state.settings);
  renderResults();
  nameTrips();
}

// ---------- place names ----------
let nameRun = 0;
async function nameTrips() {
  const run = ++nameRun;
  const lib = state.lib;
  const online = state.settings.onlineNames;
  state.homeName = '';
  if (lib.home) {
    lookupPlace(lib.home.lat, lib.home.lon, { online }).then((p) => {
      if (run !== nameRun || !p) return;
      state.homeName = p.city || p.region || p.country;
      renderHome();
    });
  }
  for (const t of lib.trips) {
    if (run !== nameRun) return;
    if (state.placeInfo.has(t.id) && state.placeInfo.get(t.id)._online === online) { refreshTrip(t); continue; }
    const info = await describeTrip(t, { online });
    if (run !== nameRun) return;
    if (info) {
      info._online = online;
      state.placeInfo.set(t.id, info);
      refreshTrip(t);
    }
  }
  renderStats();
}

function refreshTrip(t) {
  const old = document.querySelector(`.trip-card[data-album="${t.id}"]`);
  if (old) old.replaceWith(tripCard(t));
  if (state.album === t) renderAlbumHead(t);
  renameInShow(t.id, titleFor(t), flagsFor(t));
}

// ---------- rendering: results ----------
function renderResults() {
  const { trips, months, extras } = state.lib;
  renderStats();
  renderHome();

  $('#trip-grid').replaceChildren(...trips.map(tripCard));
  const empty = !trips.length;
  $('#trips-empty').hidden = !empty;
  if (empty) {
    $('#trips-empty-text').textContent = state.lib.usedGps
      ? 'Everything here looks like it was taken near home. If these photos are all from one trip, open Settings and set Home to "None".'
      : "These photos don't have locations, and there were no runs of busy photo days that look like a trip. Photos exported with their original data work best.";
  }

  $('#month-list').replaceChildren(...months.map(monthRow));
  $('#everyday').hidden = !months.length && !extras.length;
  $('#extras').replaceChildren(...extras.map(extraCard));

  $('#save-all').hidden = !canSaveToFolder();
}

function renderStats() {
  if (!state.lib) return;
  const items = state.items;
  const photos = items.filter((i) => i.kind !== 'video').length;
  const videos = items.length - photos;
  const countries = new Set();
  for (const t of state.lib.trips) for (const c of state.placeInfo.get(t.id)?.countries || []) countries.add(c.cc || c.name);
  const stat = (n, one, many) => el('li', {}, el('strong', {}, n.toLocaleString('en-GB')), n === 1 ? one : many);
  $('#stats').replaceChildren(...[
    stat(photos, 'photo', 'photos'),
    videos ? stat(videos, 'video', 'videos') : null,
    stat(state.lib.trips.length, 'trip', 'trips'),
    countries.size ? stat(countries.size, 'country', 'countries') : null,
  ].filter(Boolean));
}

function renderHome() {
  const s = $('#home-sticker');
  const lib = state.lib;
  if (!lib || !lib.usedGps) { s.hidden = true; return; }
  s.hidden = false;
  if (state.settings.home === 'none') s.textContent = 'Home: none';
  else s.textContent = state.homeName ? `Home: ${state.homeName}` : 'Home: found it';
  s.title = 'Change where home is';
}

function pickCovers(items, n) {
  const imgs = items.filter((i) => i.kind !== 'video');
  const pool = imgs.length >= n ? imgs : items;
  if (pool.length <= n) return pool;
  return Array.from({ length: n }, (_, i) => pool[Math.floor((i + 0.5) * pool.length / n)]);
}

function tripCard(t) {
  const title = titleFor(t);
  const covers = pickCovers(t.items, 3);
  const flags = flagsFor(t);
  const card = el('button', {
    class: 'trip-card', type: 'button', 'data-album': t.id, style: `--tilt:${tiltFor(t.id)}deg`,
    'aria-label': `${title}, ${fmtRange(t.start, t.end)}, ${countLine(t)}`,
    onclick: () => openAlbum(t),
  },
  el('div', { class: 'stack' }, covers.map((it, i) => el('figure', { class: 'polaroid' },
    thumbNode(it),
    i === covers.length - 1 ? el('figcaption', { class: 'cap' }, title) : el('div', { class: 'cap', 'aria-hidden': 'true' }, ' ')))),
  el('div', { class: 'trip-label' },
    flags ? el('span', { class: 'trip-flags', 'aria-hidden': 'true' }, flags) : null,
    el('span', { class: 'trip-dates' }, fmtRange(t.start, t.end)),
    el('span', { class: 'trip-counts' }, countLine(t)),
    t.guessed ? el('span', { class: 'trip-guess' }, 'guessed from dates') : null));
  return card;
}

function monthRow(m) {
  const shown = pickCovers(m.items, 8);
  return el('button', { class: 'month-row', type: 'button', onclick: () => openAlbum(m) },
    el('span', {}, el('span', { class: 'month-name' }, titleFor(m)), el('span', { class: 'month-count' }, countLine(m))),
    el('span', { class: 'month-strip', 'aria-hidden': 'true' }, shown.map((it) => thumbNode(it)),
      m.items.length > shown.length ? el('span', { class: 'month-more' }, `+${(m.items.length - shown.length).toLocaleString('en-GB')}`) : null));
}

function extraCard(a) {
  const blurb = a.kind === 'screens'
    ? 'Screenshots, memes and images without camera details. Kept out of your trips.'
    : 'No date in the file, its Takeout data or its name. Usually scans or edited copies.';
  return el('button', { class: 'extra-card', type: 'button', onclick: () => openAlbum(a) },
    el('div', { class: `note ${a.kind === 'screens' ? 'note-lilac' : 'note-butter'}` },
      el('h3', {}, a.title),
      el('p', {}, `${countLine(a)}. ${blurb}`),
      el('div', { class: 'extra-strip', 'aria-hidden': 'true' }, pickCovers(a.items, 4).map((it) => thumbNode(it)))));
}

// ---------- album view ----------
function renderAlbumHead(a) {
  $('#album-title').value = titleFor(a);
  $('#album-flags').textContent = flagsFor(a);
  const info = state.placeInfo.get(a.id);
  const parts = [];
  if (a.start) parts.push(fmtRange(a.start, a.end));
  parts.push(countLine(a));
  if (isTrip(a) && a.days > 1) parts.push(plural(a.days, 'day'));
  if (info?.countries?.length) parts.push(info.countries.map((c) => c.name).join(' and '));
  $('#album-meta').textContent = parts.join(', ');
  $('#album-story').hidden = !(isTrip(a) || a.kind === 'month');
  $('#album-save').hidden = !canSaveToFolder();
}

function openAlbum(a) {
  state.album = a;
  renderAlbumHead(a);
  renderAlbumDays(a);
  const d = $('#album-dialog');
  if (!d.open) d.showModal();
  d.scrollTop = 0;
  renderMap(a);
}

function renderAlbumDays(a) {
  const box = $('#album-days');
  const ordered = [...a.items].sort((x, y) => (x.date || 0) - (y.date || 0));
  const groups = new Map();
  for (const it of ordered) {
    const k = it.date ? dayKey(it.date) : 'none';
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(it);
  }
  const startDay = a.start ? new Date(a.start.getFullYear(), a.start.getMonth(), a.start.getDate()) : null;
  const sections = [];
  for (const [k, list] of groups) {
    let head;
    if (k === 'none') head = el('h3', { class: 'day-head' }, 'No date');
    else {
      const d = list[0].date;
      const n = startDay ? Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()) - startDay) / 864e5) + 1 : 1;
      head = el('h3', { class: 'day-head' },
        isTrip(a) ? el('span', { class: 'day-num' }, `Day ${n}`) : null,
        fmtLongDay(d),
        el('span', { class: 'day-place' }, plural(list.length, 'item')));
    }
    sections.push(el('section', { class: 'day' }, head,
      el('div', { class: 'day-grid' }, list.map((it) => el('button', {
        class: 'tile', type: 'button',
        'aria-label': `${it.kind === 'video' ? 'Video' : 'Photo'} ${it.name}${it.date ? ', ' + fmtDateTime(it.date) : ''}`,
        onclick: () => openLightbox(ordered, ordered.indexOf(it)),
      }, thumbNode(it))))));
  }
  box.replaceChildren(...sections);
}

const LEAFLET_JS = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.js';
const LEAFLET_CSS = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.css';

async function renderMap(a) {
  const wrap = $('#album-map-wrap');
  const pts = a.items.filter((i) => i.lat != null);
  if (state.map) { state.map.remove(); state.map = null; }
  if (!isTrip(a) || !pts.length) { wrap.hidden = true; return; }
  wrap.hidden = false;
  try {
    await Promise.all([loadCss(LEAFLET_CSS), loadScript(LEAFLET_JS)]);
  } catch {
    wrap.hidden = true;
    return;
  }
  if (state.album !== a) return;
  const L = window.L;
  const box = $('#album-map');
  box.replaceChildren();
  const map = L.map(box, { scrollWheelZoom: false, preferCanvas: true });
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 18,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(map);
  const group = L.featureGroup(pts.map((p) => L.circleMarker([p.lat, p.lon], {
    radius: 7, color: '#2A1420', weight: 2, fillColor: '#FF6FAE', fillOpacity: 1,
  }))).addTo(map);
  map.fitBounds(group.getBounds().pad(0.25), { maxZoom: 13 });
  state.map = map;
  setTimeout(() => map.invalidateSize(), 60);
}

function closeAlbum() {
  $('#album-dialog').close();
}

// ---------- lightbox ----------
function openLightbox(list, index) {
  state.lb.list = list;
  state.lb.index = Math.max(0, index);
  const d = $('#lightbox');
  if (!d.open) d.showModal();
  showLightbox();
}

async function showLightbox() {
  const lb = state.lb;
  const it = lb.list[lb.index];
  if (!it) return;
  lb.cleanup?.();
  lb.cleanup = null;
  const token = ++lb.token;
  const stage = $('#lb-stage');
  stage.replaceChildren(el('p', { class: 'fine' }, 'Loading…'));
  const cap = $('#lb-caption');
  cap.replaceChildren(
    el('strong', {}, it.date ? fmtDateTime(it.date) : 'No date'),
    `${it.name}${it.camera ? `, ${it.camera}` : ''} (${lb.index + 1} of ${lb.list.length})`);
  $('#lb-prev').disabled = lb.index === 0;
  $('#lb-next').disabled = lb.index === lb.list.length - 1;
  const media = await fullMedia(it);
  if (token !== lb.token) { media.cleanup(); return; }
  lb.cleanup = media.cleanup;
  stage.replaceChildren(media.el);
  if (media.preview) cap.append(el('span', { class: 'fine', style: 'display:block' }, 'Showing the small preview. This browser can’t open the full file.'));
}

function stepLightbox(delta) {
  const lb = state.lb;
  const next = lb.index + delta;
  if (next < 0 || next >= lb.list.length) return;
  lb.index = next;
  showLightbox();
}

// ---------- exporting ----------
const ym = (d) => (d ? monthKey(d) : '');
function folderFor(a) {
  const title = sanitizeName(titleFor(a));
  if (isTrip(a)) return { path: ['Trips', `${ym(a.start)} ${title}`], items: a.items };
  if (a.kind === 'month') return { path: ['Everyday', `${ym(a.start)} ${a.start.toLocaleDateString('en-GB', { month: 'long' })}`], items: a.items };
  if (a.kind === 'screens') return { path: ['Screenshots'], items: a.items };
  return { path: ['No date'], items: a.items };
}

async function runExport(kind, albums, zipName) {
  if (state.working) return;
  const folders = albums.map(folderFor);
  const total = folders.reduce((s, f) => s + f.items.length, 0);
  if (!total) return;
  state.working = true;
  try {
    if (kind === 'folder') {
      busy.show('Pick where to save', null);
      const res = await saveToFolder(folders, (done, all) => busy.show(`Saving ${done.toLocaleString()} of ${all.toLocaleString()}`, done / all));
      toast(`Saved ${plural(res.saved, 'file')} into “${res.folder}”.${res.failed ? ` ${plural(res.failed, 'file')} couldn’t be copied.` : ''}`);
    } else {
      const bytes = albums.flatMap((a) => a.items).reduce((s, i) => s + (i.size || 0), 0);
      if (bytes > 2e9 && !confirm(`This ZIP would be about ${(bytes / 1e9).toFixed(1)} GB, which can crash the browser. ${canSaveToFolder() ? 'Saving as folders is safer. ' : ''}Make it anyway?`)) return;
      busy.show('Packing the ZIP', 0);
      const res = await downloadZip(folders, zipName, (p) => busy.show(`Packing the ZIP: ${Math.round(p * 100)}%`, p));
      toast(res.failed ? `ZIP downloaded. ${plural(res.failed, 'file')} couldn’t be added.` : 'ZIP downloaded.');
    }
  } catch (e) {
    if (e?.name !== 'AbortError') { console.error(e); toast(`Saving stopped: ${e.message}`); }
  } finally {
    busy.hide();
    state.working = false;
  }
}

// ---------- story card ----------
let storyBlob = null;
async function openStory(a) {
  busy.show('Making your story card', null);
  try {
    const album = { ...a, title: titleFor(a), placeInfo: state.placeInfo.get(a.id) };
    storyBlob = await makeStoryCard(album, { flags: flagsFor(a), siteUrl: CONFIG.siteUrl });
    const img = $('#story-img');
    if (img.src) URL.revokeObjectURL(img.src);
    img.src = URL.createObjectURL(storyBlob);
    const file = new File([storyBlob], `${sanitizeName(album.title)} story.png`, { type: 'image/png' });
    $('#story-share').hidden = !(navigator.canShare && navigator.canShare({ files: [file] }));
    $('#story-dialog').showModal();
  } catch (e) {
    console.error(e);
    toast(`Couldn't make the story card: ${e.message}`);
  } finally {
    busy.hide();
  }
}

// ---------- sharing a trip with friends ----------
const SHARED_KEY = 'souvenir:shared:v1';
const shared = readJSON(SHARED_KEY, {}); // album id -> { link, at, count, strip }
const share = { album: null, abort: null, ready: null, busy: false };

const fmtSize = (b) => (b >= 1e9 ? `${(b / 1e9).toFixed(1)} GB` : `${Math.max(1, Math.round(b / 1e6))} MB`);
function canShareFiles() {
  try { return Boolean(navigator.canShare && navigator.canShare({ files: [new File(['x'], 'x.jpg', { type: 'image/jpeg' })] })); } catch { return false; }
}

function openShare(a) {
  share.album = a;
  share.ready = null;
  const bytes = a.items.reduce((s, i) => s + (i.size || 0), 0);
  $('#share-title').textContent = `Share ${titleFor(a)}`;
  $('#share-meta').textContent = `${countLine(a)}${bytes ? `, about ${fmtSize(bytes)}` : ''}`;
  const drive = driveEnabled();
  const phone = canShareFiles();
  $('#way-drive').hidden = !drive;
  $('#way-phone').hidden = !phone;
  $('#way-none').hidden = drive || phone;
  $('#share-strip').closest('.check').hidden = !drive && !phone;
  if (drive) preloadGoogle();
  $('#drive-progress').hidden = true;
  renderDriveDone();
  resetPhone();
  $('#share-dialog').showModal();
}

function resetPhone() {
  const a = share.album;
  share.ready = null;
  $('#phone-go').textContent = `Send ${plural(a.items.length, 'file')}`;
  $('#phone-status').textContent = a.items.length > 60 ? 'Big trips can be too much for chat apps. The Drive link is easier for those.' : '';
}

function renderDriveDone() {
  const s = share.album && shared[share.album.id];
  $('#drive-done').hidden = !s;
  $('#drive-go').textContent = s ? 'Upload again' : 'Upload to Google Drive';
  $('#drive-go').classList.toggle('btn-primary', !s);
  if (!s) return;
  const when = new Date(s.at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  $('#drive-when').textContent = `Shared on ${when}: ${plural(s.count, 'file')}${s.strip ? ', without locations' : ', with locations'}.`;
  $('#drive-link').value = s.link;
  $('#drive-open').href = s.link;
  $('#drive-send').hidden = !navigator.share;
}

// A copy of the file to send, without its location when that's ticked. null = leave it out.
async function fileToSend(item, strip, skipped) {
  let file = item.file || (item.fetchBlob ? await item.fetchBlob().catch(() => null) : null);
  if (!file) return null;
  if (!(file instanceof File)) file = new File([file], item.name, { type: file.type });
  if (!strip) return file;
  const r = await withoutLocation(file, item.kind).catch(() => ({ ok: false }));
  if (!r.ok) { skipped.push(item.name); return null; }
  return r.file;
}

const byDate = (items) => [...items].sort((x, y) => (x.date?.getTime() ?? 0) - (y.date?.getTime() ?? 0));

function leftOutNote(skipped, failed = 0) {
  const notes = [];
  if (skipped.length) notes.push(`${plural(skipped.length, 'file')} left out because the location couldn’t be removed`);
  if (failed > 0) notes.push(`${plural(failed, 'file')} didn’t upload`);
  return notes.length ? ` ${notes.join('; ')}.` : '';
}

async function driveFlow() {
  const a = share.album;
  if (!a || share.busy) return;
  share.busy = true;
  const strip = $('#share-strip').checked;
  const skipped = [];
  const ctrl = new AbortController();
  share.abort = ctrl;
  const bar = $('#drive-progress .busy-bar');
  const status = $('#drive-status');
  $('#drive-progress').hidden = false;
  $('#drive-go').disabled = true;
  $('#drive-stop').hidden = false;
  bar.classList.add('indeterminate');
  status.textContent = 'Waiting for Google sign-in';
  try {
    const items = byDate(a.items);
    const res = await shareToDrive({
      folderName: folderFor(a).path.at(-1),
      files: items.map((it) => ({ name: it.name, date: it.date, get: () => fileToSend(it, strip, skipped) })),
      signal: ctrl.signal,
      onProgress: (done, total) => {
        bar.classList.remove('indeterminate');
        bar.style.setProperty('--p', Math.max(0.02, done / total));
        status.textContent = `Uploading ${done.toLocaleString()} of ${total.toLocaleString()}`;
      },
    });
    shared[a.id] = { link: res.link, at: Date.now(), count: res.uploaded, strip };
    writeJSON(SHARED_KEY, shared);
    renderDriveDone();
    toast(`Shared. Copy the link and send it to your friends.${leftOutNote(skipped, res.failed.length - skipped.length)}`, 8000);
  } catch (e) {
    if (e?.name === 'AbortError') toast('Stopped. What was already uploaded is in your Drive, but not shared.');
    else { console.error(e); toast(e.message || 'Sharing didn’t work.'); }
  } finally {
    share.busy = false;
    share.abort = null;
    $('#drive-progress').hidden = true;
    $('#drive-go').disabled = false;
    $('#drive-stop').hidden = true;
  }
}

async function phoneFlow() {
  const a = share.album;
  if (!a || share.busy) return;
  const strip = $('#share-strip').checked;
  const status = $('#phone-status');
  const title = titleFor(a);
  // Files are got ready first. If that took too long, the browser wants a fresh tap to open the menu.
  if (!share.ready) {
    share.busy = true;
    $('#phone-go').disabled = true;
    const skipped = [];
    const files = [];
    try {
      const items = byDate(a.items);
      for (let i = 0; i < items.length; i++) {
        status.textContent = `Getting the files ready: ${i + 1} of ${items.length}`;
        const f = await fileToSend(items[i], strip, skipped);
        if (f) files.push(f);
      }
    } finally {
      share.busy = false;
      $('#phone-go').disabled = false;
    }
    if (!files.length) { status.textContent = `Nothing to send.${leftOutNote(skipped)}`; return; }
    share.ready = { files, note: leftOutNote(skipped) };
    $('#phone-go').textContent = `Send ${plural(files.length, 'file')} now`;
  }
  const { files, note } = share.ready;
  if (!navigator.canShare({ files })) {
    status.textContent = 'That’s too many files for this device’s share menu. Use the Drive link instead.';
    return;
  }
  try {
    await navigator.share({ files, title });
    status.textContent = `Sent.${note}`;
  } catch (e) {
    if (e?.name === 'NotAllowedError') status.textContent = `Ready. Tap “Send ${plural(files.length, 'file')} now”.${note}`;
    else if (e?.name === 'AbortError') status.textContent = `Ready when you are.${note}`;
    else status.textContent = `The share menu didn’t open: ${e.message}`;
  }
}

// ---------- settings ----------
function openSettings() {
  const f = $('#settings-form');
  const sel = $('#set-home');
  const lib = state.lib;
  sel.replaceChildren(
    el('option', { value: 'auto' }, `Find it for me${state.homeName ? ` (${state.homeName})` : ''}`),
    ...(lib?.places || []).slice(0, 6).map((p) => {
      const o = el('option', { value: p.key }, `Near ${p.lat.toFixed(2)}, ${p.lon.toFixed(2)} (${plural(p.days, 'day')} of photos)`);
      lookupPlace(p.lat, p.lon, { online: state.settings.onlineNames }).then((n) => {
        if (n) o.textContent = `${n.city || n.region}, ${n.country} (${plural(p.days, 'day')} of photos)`;
      });
      return o;
    }),
    el('option', { value: 'none' }, 'None: everything with a location is a trip'));
  sel.value = state.settings.home;
  $('#settings-dialog').returnValue = '';
  for (const k of ['homeRadiusKm', 'gapHours', 'minTripItems']) f.elements[k].value = state.settings[k];
  f.elements.onlineNames.checked = state.settings.onlineNames;
  updateOutputs();
  $('#settings-dialog').showModal();
}
function updateOutputs() {
  const f = $('#settings-form');
  $('#out-radius').textContent = `${f.elements.homeRadiusKm.value} km`;
  const h = +f.elements.gapHours.value;
  $('#out-gap').textContent = h % 24 === 0 ? plural(h / 24, 'day') : plural(h, 'hour');
  $('#out-min').textContent = plural(+f.elements.minTripItems.value, 'photo');
}
function applySettings() {
  const f = $('#settings-form');
  state.settings = {
    home: f.elements.home.value,
    homeRadiusKm: +f.elements.homeRadiusKm.value,
    gapHours: +f.elements.gapHours.value,
    minTripItems: +f.elements.minTripItems.value,
    onlineNames: f.elements.onlineNames.checked,
  };
  const { home, ...persist } = state.settings;
  writeJSON(SETTINGS_KEY, persist);
  if (state.lib) resort();
  toast('Re-sorted.');
}

// ---------- start over ----------
function startOver() {
  if (state.items.length && !confirm('Clear these photos from the page? Your files stay where they are.')) return;
  resetThumbs();
  state.items = [];
  state.seen.clear();
  state.lib = null;
  state.placeInfo.clear();
  state.settings.home = 'auto';
  $('#results').hidden = true;
  $('#start').scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
}

// ---------- folders waiting to be sorted ----------
// Browsers only let you choose one folder per click, so picks collect here and get
// sorted together in one go.
const basket = [];
const mediaIn = (entries) => entries.filter((e) => ['image', 'video'].includes(kindOf(e.file))).length;

function labelOf(entries) {
  const tops = [...new Set(entries.filter((e) => e.path.includes('/')).map((e) => e.path.split('/')[0]))];
  if (tops.length === 1) return tops[0];
  if (tops.length > 1) return `${tops[0]} and ${plural(tops.length - 1, 'more folder')}`;
  return 'Photos you picked';
}

function queue(entries) {
  const count = mediaIn(entries);
  if (!count) {
    toast("That didn't include any photos or videos. Try choosing the folder that holds them.");
    return;
  }
  const label = labelOf(entries);
  const sig = `${label}|${entries.length}`;
  if (basket.some((b) => b.sig === sig)) { toast(`${label} is already on the list.`); return; }
  basket.push({ label, entries, count, sig });
  renderBasket();
}

function renderBasket() {
  const has = basket.length > 0;
  $('#basket').hidden = !has;
  $('#pick-folder-text').textContent = has ? 'Add another folder' : 'Choose a folder';
  $('#pick-files-text').textContent = has ? 'Add photos' : 'Choose photos';
  $('#pick-folder-label').classList.toggle('btn-primary', !has);
  $('#dz-big').textContent = has ? 'Add more, or sort what’s here' : 'Drop folders or a pile of photos here';
  $('#dz-small').textContent = has
    ? 'You can also drag several folders in at once.'
    : 'Add as many folders as you like, then sort them together. JPG, HEIC, PNG, MP4, MOV and more.';
  const total = basket.reduce((s, b) => s + b.count, 0);
  $('#basket-sort').textContent = `Sort ${plural(total, 'photo')}`;
  $('#basket-list').replaceChildren(...basket.map((b, i) => el('li', { class: 'basket-chip' },
    el('span', { class: 'basket-name', title: b.label }, b.label),
    el('span', { class: 'basket-count' }, b.count.toLocaleString()),
    el('button', { class: 'basket-x', type: 'button', 'aria-label': `Remove ${b.label}`, 'data-i': String(i) }, '×'))));
}

function sortBasket() {
  if (!basket.length || state.working) return;
  const all = basket.flatMap((b) => b.entries);
  basket.length = 0;
  renderBasket();
  ingest(all);
}

// ---------- drag & drop ----------
async function entriesFromDrop(dt) {
  const roots = [...(dt.items || [])].map((i) => (i.kind === 'file' && i.webkitGetAsEntry ? i.webkitGetAsEntry() : null)).filter(Boolean);
  const files = [...(dt.files || [])];
  if (!roots.length) return files.map((f) => ({ file: f, path: f.name }));
  const out = [];
  const readAll = (reader) => new Promise((res, rej) => reader.readEntries(res, rej));
  async function walk(entry, path) {
    if (entry.isFile) {
      const file = await new Promise((res, rej) => entry.file(res, rej)).catch(() => null);
      if (file) out.push({ file, path: path + file.name });
    } else if (entry.isDirectory) {
      const reader = entry.createReader();
      for (let batch = await readAll(reader); batch.length; batch = await readAll(reader)) {
        for (const e of batch) await walk(e, `${path}${entry.name}/`);
      }
    }
  }
  for (const r of roots) await walk(r, '');
  return out;
}

function setupDrop() {
  let depth = 0;
  const dz = $('#dropzone');
  const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
  window.addEventListener('dragenter', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    depth++;
    document.body.classList.add('dragging');
  });
  window.addEventListener('dragover', (e) => { if (hasFiles(e)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } });
  window.addEventListener('dragleave', () => {
    depth = Math.max(0, depth - 1);
    if (!depth) document.body.classList.remove('dragging');
  });
  window.addEventListener('drop', async (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    depth = 0;
    document.body.classList.remove('dragging');
    dz.classList.remove('over');
    const entries = await entriesFromDrop(e.dataTransfer);
    // A drop can hold several folders already, so it sorts straight away,
    // unless there's a list waiting: then it joins the list.
    if (basket.length) { queue(entries); $('#start').scrollIntoView({ block: 'center' }); } else ingest(entries);
  });
  dz.addEventListener('dragover', () => dz.classList.add('over'));
  dz.addEventListener('dragleave', () => dz.classList.remove('over'));
}

// ---------- Google Photos ----------
let gpAbort = null;
async function googleFlow() {
  if (state.working) return;
  const step = $('#gp-step');
  try {
    const session = await startSession();
    $('#gp-open').href = `${session.pickerUri.replace(/\/$/, '')}/autoclose`;
    step.hidden = false;
    gpAbort = new AbortController();
    await waitForSelection(session, { signal: gpAbort.signal });
    step.hidden = true;
    busy.show('Fetching your picks from Google Photos', null);
    const items = await listSelection(session);
    busy.hide();
    addItems(items);
  } catch (e) {
    busy.hide();
    step.hidden = true;
    if (e.message !== 'cancelled') toast(e.message || 'Google Photos didn’t work this time.');
  }
}

// ---------- wiring ----------
function wire() {
  // footer + nav from config
  if (CONFIG.repoUrl) {
    const r = $('#repo-link');
    r.href = CONFIG.repoUrl;
    r.hidden = false;
  }
  const credit = $('#credit');
  const who = CONFIG.creator?.handle
    ? el('a', { href: CONFIG.creator.url || '#', target: '_blank', rel: 'noopener' }, CONFIG.creator.handle)
    : (CONFIG.creator?.name || 'Ana');
  credit.replaceChildren('Made by ', who, '. Free and open source',
    CONFIG.repoUrl ? [': ', el('a', { href: CONFIG.repoUrl, target: '_blank', rel: 'noopener' }, 'make your own copy on GitHub'), '.'] : '.');

  const folderInput = $('#pick-folder');
  if (!('webkitdirectory' in folderInput)) $('#pick-folder-label').hidden = true;
  folderInput.addEventListener('change', (e) => {
    queue([...e.target.files].map((f) => ({ file: f, path: f.webkitRelativePath || f.name })));
    e.target.value = '';
  });
  $('#pick-files').addEventListener('change', (e) => {
    queue([...e.target.files].map((f) => ({ file: f, path: f.name })));
    e.target.value = '';
  });
  $('#basket-sort').addEventListener('click', sortBasket);
  $('#basket-clear').addEventListener('click', () => { basket.length = 0; renderBasket(); });
  $('#basket-list').addEventListener('click', (e) => {
    const x = e.target.closest('.basket-x');
    if (!x) return;
    basket.splice(Number(x.dataset.i), 1);
    renderBasket();
    (basket.length ? $('#basket-sort') : $('#dropzone')).focus();
  });

  $$('[data-action="demo"]').forEach((b) => b.addEventListener('click', async () => {
    if (state.working) return;
    state.working = true;
    busy.show('Painting a sample camera roll', null);
    try {
      const lib = await makeDemoLibrary();
      busy.hide();
      if (showEnabled()) {
        // Shuffle so the heap looks like a real, messy camera roll.
        const shuffled = [...lib].sort(() => Math.random() - 0.5);
        startShow(shuffled.length, { onClose: revealResults });
        for (let i = 0; i < shuffled.length && showActive(); i++) {
          feedShow(shuffled[i], i + 1);
          await new Promise((r) => setTimeout(r, 28));
        }
      }
      addItems(lib);
    } finally { busy.hide(); state.working = false; }
  }));

  if (googleEnabled()) {
    $('#gp-box').hidden = false;
    $('#gp-pick').addEventListener('click', googleFlow);
    $('#gp-cancel').addEventListener('click', () => { gpAbort?.abort(); $('#gp-step').hidden = true; });
  }

  $('#add-more').addEventListener('click', () => $('#start').scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth' }));
  $('#open-settings').addEventListener('click', openSettings);
  $('#home-sticker').addEventListener('click', openSettings);
  $('#start-over').addEventListener('click', startOver);
  $('#save-all').addEventListener('click', () => runExport('folder', allAlbums()));
  $('#zip-all').addEventListener('click', () => runExport('zip', allAlbums(), 'souvenir sorted photos'));

  // album dialog
  $('#album-title').addEventListener('change', (e) => {
    const a = state.album;
    if (!a) return;
    const v = e.target.value.trim();
    if (v && v !== titleFor(a)) state.names[a.id] = v;
    else if (!v) delete state.names[a.id];
    writeJSON(NAMES_KEY, state.names);
    e.target.value = titleFor(a);
    if (isTrip(a)) refreshTrip(a);
    else renderResults();
  });
  $('#album-title').addEventListener('keydown', (e) => { if (e.key === 'Enter') e.target.blur(); });
  $('#album-story').addEventListener('click', () => state.album && openStory(state.album));
  $('#album-save').addEventListener('click', () => state.album && runExport('folder', [state.album]));
  $('#album-zip').addEventListener('click', () => state.album && runExport('zip', [state.album], titleFor(state.album)));
  $('#album-dialog').addEventListener('close', () => {
    if (state.map) { state.map.remove(); state.map = null; }
    state.album = null;
  });

  // lightbox
  $('#lb-prev').addEventListener('click', () => stepLightbox(-1));
  $('#lb-next').addEventListener('click', () => stepLightbox(1));
  document.addEventListener('keydown', (e) => {
    if (!$('#lightbox').open) return;
    if (e.key === 'ArrowLeft') stepLightbox(-1);
    if (e.key === 'ArrowRight') stepLightbox(1);
  });
  $('#lightbox').addEventListener('close', () => {
    state.lb.cleanup?.();
    state.lb.cleanup = null;
    state.lb.token++;
    $('#lb-stage').replaceChildren();
  });

  // close buttons, and clicking the dark backdrop of the lightbox
  $$('[data-close]').forEach((b) => b.addEventListener('click', () => b.closest('dialog').close()));
  $('#lightbox').addEventListener('click', (e) => { if (e.target.id === 'lb-stage') $('#lightbox').close(); });
  $('#story-dialog').addEventListener('click', (e) => { if (e.target.id === 'story-dialog') e.target.close(); });

  // settings
  $('#settings-form').addEventListener('input', updateOutputs);
  $('#settings-dialog').addEventListener('close', () => { if ($('#settings-dialog').returnValue === 'apply') applySettings(); });

  // story
  $('#story-download').addEventListener('click', () => {
    if (storyBlob && state.album) saveBlob(storyBlob, `${sanitizeName(titleFor(state.album))} story.png`);
  });
  $('#story-share').addEventListener('click', async () => {
    if (!storyBlob || !state.album) return;
    const file = new File([storyBlob], `${sanitizeName(titleFor(state.album))} story.png`, { type: 'image/png' });
    try { await navigator.share({ files: [file], title: titleFor(state.album) }); } catch { /* user closed the share sheet */ }
  });

  // sharing
  $('#album-share').addEventListener('click', () => state.album && openShare(state.album));
  $('#drive-go').addEventListener('click', driveFlow);
  $('#drive-stop').addEventListener('click', () => share.abort?.abort());
  $('#phone-go').addEventListener('click', phoneFlow);
  $('#share-strip').addEventListener('change', () => { if (!share.busy) resetPhone(); });
  $('#share-zip').addEventListener('click', () => share.album && runExport('zip', [share.album], titleFor(share.album)));
  $('#drive-copy').addEventListener('click', async () => {
    const f = $('#drive-link');
    try { await navigator.clipboard.writeText(f.value); toast('Link copied.'); } catch { f.select(); toast('Select the link and copy it.'); }
  });
  $('#drive-send').addEventListener('click', async () => {
    const s = share.album && shared[share.album.id];
    if (!s) return;
    try { await navigator.share({ title: titleFor(share.album), text: `Photos from ${titleFor(share.album)}`, url: s.link }); } catch { /* closed */ }
  });

  setupDrop();
  wireShow();
}

wire();
