// Shares a trip through the person's own Google Drive: a new folder, a copy of each file,
// then "anyone with the link can view". The "drive.file" permission only lets this page
// see files it created itself, never the rest of someone's Drive.
import { getToken, forgetToken, googleConfigured } from './google-auth.js';
import { pool, sleep } from './util.js';

const SCOPE = 'https://www.googleapis.com/auth/drive.file';
const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';

export const driveEnabled = googleConfigured;

async function call(url, token, init = {}, tries = 4) {
  for (let attempt = 1; ; attempt++) {
    let r;
    try {
      r = await fetch(url, { ...init, headers: { Authorization: `Bearer ${token}`, ...(init.headers || {}) } });
    } catch (e) {
      if (attempt >= tries) throw new Error('Lost the connection to Google Drive.');
      await sleep(1000 * 2 ** attempt);
      continue;
    }
    if (r.ok) return r;
    if (r.status === 401) { forgetToken(SCOPE); throw new Error('Google sign-in ran out. Press the button again to carry on.'); }
    const retry = r.status === 429 || r.status >= 500 || (r.status === 403 && /rate|quota/i.test(await r.clone().text()));
    if (!retry || attempt >= tries) {
      const msg = await r.json().then((j) => j?.error?.message).catch(() => '');
      if (/storage quota/i.test(msg || '')) throw new Error('Your Google Drive is full.');
      throw new Error(`Google Drive answered ${r.status}${msg ? `: ${msg}` : ''}`);
    }
    await sleep(1000 * 2 ** attempt + Math.random() * 500);
  }
}

const json = (r) => r.json();

async function uploadOne(token, folderId, file, when) {
  const meta = { name: file.name, parents: [folderId] };
  if (when) meta.modifiedTime = when.toISOString();
  const start = await call(`${UPLOAD}?uploadType=resumable&fields=id`, token, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Type': file.type || 'application/octet-stream',
      'X-Upload-Content-Length': String(file.size),
    },
    body: JSON.stringify(meta),
  });
  const session = start.headers.get('Location');
  if (!session) throw new Error('Google Drive didn’t start the upload.');
  // The upload link already carries its own permission, so no token header is needed.
  for (let attempt = 1; ; attempt++) {
    const r = await fetch(session, { method: 'PUT', headers: { 'Content-Type': file.type || 'application/octet-stream' }, body: file }).catch(() => null);
    if (r?.ok) return r.json();
    if (attempt >= 3) throw new Error(`Couldn’t upload ${file.name}.`);
    await sleep(1500 * attempt);
  }
}

// files: [{ get: async () => File, date, name }]. Returns { link, folderId, uploaded, failed }.
export async function shareToDrive({ folderName, files, onProgress, signal }) {
  const token = await getToken(SCOPE);
  const folder = await call(`${API}/files?fields=id,webViewLink`, token, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=UTF-8' },
    body: JSON.stringify({ name: folderName, mimeType: 'application/vnd.google-apps.folder', description: 'Shared from souvenir' }),
  }).then(json);
  let uploaded = 0;
  const failed = [];
  onProgress?.(0, files.length);
  await pool(files, 3, async (f) => {
    if (signal?.aborted) return;
    try {
      const file = await f.get();
      if (!file) { failed.push(f.name); return; }
      await uploadOne(token, folder.id, file, f.date);
      uploaded++;
    } catch (e) {
      if (/sign-in ran out|Drive is full/.test(e.message)) throw e;
      console.warn(e);
      failed.push(f.name);
    }
    onProgress?.(uploaded + failed.length, files.length);
  });
  if (signal?.aborted) throw new DOMException('Stopped', 'AbortError');
  if (!uploaded) throw new Error('None of the files uploaded, so nothing was shared.');
  // Sharing the folder shares everything inside it.
  await call(`${API}/files/${folder.id}/permissions`, token, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=UTF-8' },
    body: JSON.stringify({ type: 'anyone', role: 'reader', allowFileDiscovery: false }),
  });
  return { link: folder.webViewLink || `https://drive.google.com/drive/folders/${folder.id}`, folderId: folder.id, uploaded, failed };
}
