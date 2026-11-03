// Reads when and where each photo or video was taken, without uploading anything.
// Sources, best first: camera EXIF / video atoms → Google Takeout .json sidecars → file name → file date.
import exifr from 'https://cdn.jsdelivr.net/npm/exifr@7.1.3/dist/full.esm.mjs';
import { pool } from './util.js';

export { exifr };

const IMAGE_EXT = /\.(jpe?g|jfif|png|heic|heif|webp|gif|avif|tiff?|dng|bmp)$/i;
const VIDEO_EXT = /\.(mp4|mov|m4v|3gp|avi|webm|mkv|mts|m2ts)$/i;

export function kindOf(file) {
  const n = file.name || '';
  if (n.startsWith('.')) return null; // macOS ._ files, .DS_Store
  if (/\.json$/i.test(n)) return 'sidecar';
  if (VIDEO_EXT.test(n) || (file.type || '').startsWith('video/')) return 'video';
  if (IMAGE_EXT.test(n) || (file.type || '').startsWith('image/')) return 'image';
  return null;
}

let seq = 0;
export const newId = () => 'i' + (++seq).toString(36);

export function makeItem(file, path) {
  path = path || file.webkitRelativePath || file.name;
  const slash = path.lastIndexOf('/');
  return {
    id: newId(),
    name: file.name,
    path,
    dir: slash >= 0 ? path.slice(0, slash) : '',
    kind: kindOf(file),
    file,
    size: file.size,
    date: null,
    dateSource: null, // camera | google | filename | file
    lat: null,
    lon: null,
    camera: null,
    screenshot: false,
    source: 'local',
  };
}

export function validDate(d) {
  return d instanceof Date && !isNaN(d) && d.getFullYear() >= 1990 && d.getTime() < Date.now() + 2 * 864e5;
}
export function validGeo(lat, lon) {
  return Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 &&
    !(Math.abs(lat) < 1e-6 && Math.abs(lon) < 1e-6);
}

const SHOT_NAME = /(screenshot|screen[ _-]?shot|captura|bildschirmfoto|capture d.?[ée]cran|schermafbeelding|скриншот|スクリーンショット)/i;

// ---------- Photos ----------
async function readImage(item) {
  let out = null;
  try {
    out = await exifr.parse(item.file, {
      tiff: true, exif: true, gps: true, ifd1: false, interop: false,
      xmp: false, icc: false, iptc: false, jfif: false, ihdr: false,
      translateValues: false, reviveValues: true, mergeOutput: true,
    });
  } catch { out = null; }

  if (out) {
    const shot = out.DateTimeOriginal || out.CreateDate || out.DateTimeDigitized;
    if (validDate(shot)) { item.date = shot; item.dateSource = 'camera'; }
    else if (validDate(out.ModifyDate)) { item.date = out.ModifyDate; item.dateSource = 'edited'; }
    if (validGeo(out.latitude, out.longitude)) { item.lat = out.latitude; item.lon = out.longitude; }
    item.camera = [out.Make, out.Model].filter(Boolean).join(' ').trim() || null;
  }

  let comment = '';
  if (out?.UserComment) {
    comment = typeof out.UserComment === 'string' ? out.UserComment : new TextDecoder().decode(out.UserComment);
  }
  const png = /\.png$/i.test(item.name) || item.file.type === 'image/png';
  item.screenshot = SHOT_NAME.test(item.name) || /screenshot/i.test(comment) ||
    (png && !item.camera && item.dateSource !== 'camera' && item.lat == null);
}

// ---------- Videos (MP4 / MOV): read the 'moov' box, no full-file load ----------
const MAC_EPOCH = 2082844800; // seconds between 1904-01-01 and 1970-01-01
const u32 = (b, o) => ((b[o] << 24) >>> 0) + (b[o + 1] << 16) + (b[o + 2] << 8) + b[o + 3];
const bytes = async (file, start, len) => new Uint8Array(await file.slice(start, start + len).arrayBuffer());

async function findMoov(file) {
  let off = 0;
  for (let guard = 0; off + 8 <= file.size && guard < 200; guard++) {
    const h = await bytes(file, off, 16);
    let size = u32(h, 0);
    const type = String.fromCharCode(h[4], h[5], h[6], h[7]);
    let header = 8;
    if (size === 1) { size = u32(h, 8) * 2 ** 32 + u32(h, 12); header = 16; }
    else if (size === 0) size = file.size - off;
    if (size < header) return null;
    if (type === 'moov') return size > 64 * 1024 * 1024 ? null : bytes(file, off, size);
    off += size;
  }
  return null;
}

async function readVideo(item) {
  const moov = await findMoov(item.file).catch(() => null);
  if (!moov) return;
  const text = new TextDecoder('latin1').decode(moov);

  // Apple keeps the local creation date with its time zone.
  const apple = text.match(/(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})([+-]\d{2}):?(\d{2})/);
  if (apple) {
    const d = new Date(`${apple[1]}${apple[2]}:${apple[3]}`);
    if (validDate(d)) { item.date = d; item.dateSource = 'camera'; }
  }
  if (!item.date) {
    const i = text.indexOf('mvhd');
    if (i >= 0 && i + 16 < moov.length) {
      const v1 = moov[i + 4] === 1;
      const secs = v1 ? u32(moov, i + 8) * 2 ** 32 + u32(moov, i + 12) : u32(moov, i + 8);
      if (secs > 0) {
        const d = new Date((secs - MAC_EPOCH) * 1000);
        if (validDate(d)) { item.date = d; item.dateSource = 'camera'; }
      }
    }
  }
  // ISO 6709 location string, e.g. "+38.7223-009.1393+012.000/"
  const g = text.match(/([+-]\d{2}\.\d{2,})([+-]\d{3}\.\d{2,})/);
  if (g) {
    const lat = parseFloat(g[1]), lon = parseFloat(g[2]);
    if (validGeo(lat, lon)) { item.lat = lat; item.lon = lon; }
  }
}

// ---------- File names like IMG_20230815_142233.jpg, PXL_20230815…, "Screenshot 2023-08-15 at 14.22.33" ----------
const NAME_DATE = /(?:^|\D)((?:19|20)\d{2})[-_.]?(0[1-9]|1[0-2])[-_.]?(0[1-9]|[12]\d|3[01])(?:[ _T.-]?(?:at )?([01]\d|2[0-3])[-_.:h]?([0-5]\d)[-_.:m]?([0-5]\d))?/;
export function dateFromName(name) {
  const m = name.match(NAME_DATE);
  if (!m) return null;
  const [, y, mo, d, h = '12', mi = '00', s = '00'] = m;
  const date = new Date(+y, +mo - 1, +d, +h, +mi, +s);
  return validDate(date) && date.getDate() === +d ? date : null;
}

// ---------- Google Takeout sidecars ----------
async function readSidecars(entries) {
  const byDir = new Map();
  await pool(entries, 8, async ({ file, path }) => {
    if (file.size > 300_000) return;
    try {
      const data = JSON.parse(await file.text());
      if (!data || !(data.photoTakenTime || data.geoData || data.geoDataExif)) return;
      const p = path || file.webkitRelativePath || file.name;
      const dir = p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '';
      if (!byDir.has(dir)) byDir.set(dir, []);
      byDir.get(dir).push({ name: file.name.toLowerCase(), data });
    } catch { /* not a Takeout file */ }
  });
  return byDir;
}

function matchSidecar(item, byDir) {
  const list = byDir.get(item.dir);
  if (!list) return null;
  const m = item.name.match(/^(.*?)(\(\d+\))?(\.[^.]+)$/);
  if (m) {
    const [, stem, dup = '', ext] = m;
    const stems = [stem, stem.replace(/-(edited|bearbeitet|modifi[ée]|editado|modificato|bewerkt)$/i, '')];
    for (const s of stems) {
      const orig = (s + ext).toLowerCase();
      let cands = list.filter((j) => j.name.startsWith(orig) ||
        (orig.length > 40 && orig.startsWith(j.name.slice(0, Math.min(j.name.length - 5, 40)))));
      cands = dup ? cands.filter((j) => j.name.includes(dup)) : cands.filter((j) => !/\(\d+\)\.json$/.test(j.name));
      if (cands.length) return cands[0].data;
    }
  }
  return list.find((j) => j.data.title === item.name)?.data || null;
}

function applySidecar(item, sc) {
  const ts = Number(sc.photoTakenTime?.timestamp);
  if (ts > 0 && item.dateSource !== 'camera') {
    const d = new Date(ts * 1000);
    if (validDate(d)) { item.date = d; item.dateSource = 'google'; }
  }
  if (item.lat == null) {
    for (const g of [sc.geoData, sc.geoDataExif]) {
      if (g && validGeo(g.latitude, g.longitude)) { item.lat = g.latitude; item.lon = g.longitude; break; }
    }
  }
}

function finish(item) {
  if (item.date) return;
  const fromName = dateFromName(item.name);
  if (fromName) { item.date = fromName; item.dateSource = 'filename'; return; }
  const mod = new Date(item.file.lastModified);
  if (validDate(mod)) { item.date = mod; item.dateSource = 'file'; }
}

export async function extractAll(entries, onProgress) {
  const media = [];
  const sidecars = [];
  for (const e of entries) {
    const k = kindOf(e.file);
    if (k === 'sidecar') sidecars.push(e);
    else if (k) media.push(makeItem(e.file, e.path));
  }
  const byDir = sidecars.length ? await readSidecars(sidecars) : new Map();
  let done = 0;
  await pool(media, 6, async (item) => {
    try {
      if (item.kind === 'video') await readVideo(item);
      else await readImage(item);
    } catch { /* unreadable: falls back to file name / date */ }
    if (byDir.size) {
      const sc = matchSidecar(item, byDir);
      if (sc) applySidecar(item, sc);
    }
    finish(item);
    onProgress?.(++done, media.length);
  });
  return media;
}
