// Optional: pick photos straight from Google Photos with Google's official Picker API.
// Needs CONFIG.googleClientId (see README). Google doesn't share GPS through the picker,
// so these are sorted by date only. For trips with places, Google Takeout is better.
import { CONFIG } from '../config.js';
import { sleep } from './util.js';
import { googleConfigured, getToken } from './google-auth.js';
import { newId, validDate } from './metadata.js';

const SCOPE = 'https://www.googleapis.com/auth/photospicker.mediaitems.readonly';
const API = 'https://photospicker.googleapis.com/v1';

export const googleEnabled = () => googleConfigured() && Boolean(CONFIG.googlePhotosPicker);

let token = null;

async function api(path, init = {}) {
  const r = await fetch(API + path, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
  });
  if (!r.ok) throw new Error(`Google Photos answered ${r.status}`);
  return r.status === 204 ? null : r.json();
}

const seconds = (s, fallback) => (s ? parseFloat(String(s)) * 1000 : fallback);

export async function startSession() {
  token = await getToken(SCOPE);
  return api('/sessions', { method: 'POST', body: '{}' });
}

export async function waitForSelection(session, { signal } = {}) {
  const every = Math.max(2000, seconds(session.pollingConfig?.pollInterval, 4000));
  const until = Date.now() + seconds(session.pollingConfig?.timeoutIn, 20 * 60 * 1000);
  while (Date.now() < until) {
    if (signal?.aborted) throw new Error('cancelled');
    await sleep(every);
    const s = await api(`/sessions/${session.id}`);
    if (s.mediaItemsSet) return s;
  }
  throw new Error('The Google Photos picker timed out.');
}

async function gfetch(url) {
  const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) throw new Error(`Download failed (${r.status})`);
  return r.blob();
}

export async function listSelection(session) {
  const out = [];
  let pageToken = '';
  do {
    const q = new URLSearchParams({ sessionId: session.id, pageSize: '100' });
    if (pageToken) q.set('pageToken', pageToken);
    const page = await api(`/mediaItems?${q}`);
    out.push(...(page.mediaItems || []));
    pageToken = page.nextPageToken || '';
  } while (pageToken);
  api(`/sessions/${session.id}`, { method: 'DELETE' }).catch(() => {});
  return out.map(toItem);
}

function toItem(m) {
  const f = m.mediaFile || {};
  const video = m.type === 'VIDEO' || /^video\//.test(f.mimeType || '');
  const d = new Date(m.createTime);
  const base = f.baseUrl;
  return {
    id: newId(),
    name: f.filename || `${m.id}.${video ? 'mp4' : 'jpg'}`,
    path: f.filename || m.id,
    dir: 'Google Photos',
    kind: video ? 'video' : 'image',
    file: null,
    size: 0,
    date: validDate(d) ? d : null,
    dateSource: 'google',
    lat: null,
    lon: null,
    camera: [f.mediaFileMetadata?.cameraMake, f.mediaFileMetadata?.cameraModel].filter(Boolean).join(' ') || null,
    screenshot: false,
    source: 'google',
    fetchThumb: () => gfetch(`${base}=w600-h600`),
    fetchLarge: () => gfetch(`${base}=w2048-h2048`),
    fetchBlob: () => gfetch(`${base}${video ? '=dv' : '=d'}`),
  };
}
