// Makes a copy of a photo or video without the place it was taken.
// The bytes that hold the location are blanked in place, so the picture, the date and
// the file size stay the same and nothing gets re-compressed. Every copy is read back
// afterwards; a file that still has a location is reported, never sent.
import { exifr } from './metadata.js';

const enc = (s) => [...s].map((c) => c.charCodeAt(0));
const latin1 = (u8) => new TextDecoder('latin1').decode(u8);

function indexesOf(u8, pattern, from = 0, to = u8.length) {
  const out = [];
  const p0 = pattern[0];
  outer: for (let i = u8.indexOf(p0, from); i !== -1 && i <= to - pattern.length; i = u8.indexOf(p0, i + 1)) {
    for (let j = 1; j < pattern.length; j++) if (u8[i + j] !== pattern[j]) continue outer;
    out.push(i);
  }
  return out;
}

// ---------- EXIF (JPEG, HEIC, PNG, WebP, TIFF/DNG) ----------
const TYPE_SIZE = [0, 1, 1, 2, 4, 8, 1, 1, 2, 4, 8, 4, 8, 4];

// Blanks the GPS block of the TIFF structure that starts at `t`. Returns true if it found one.
function blankGps(u8, t) {
  const le = u8[t] === 0x49;
  if (!((le && u8[t + 1] === 0x49 && u8[t + 2] === 0x2a && u8[t + 3] === 0) ||
        (!le && u8[t] === 0x4d && u8[t + 1] === 0x4d && u8[t + 2] === 0 && u8[t + 3] === 0x2a))) return false;
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const u16 = (o) => dv.getUint16(o, le);
  const u32 = (o) => dv.getUint32(o, le);
  const inside = (o, len = 1) => o >= 0 && o + len <= u8.length;
  const ifd0 = t + u32(t + 4);
  if (!inside(ifd0, 2)) return false;
  const n0 = u16(ifd0);
  if (n0 > 500 || !inside(ifd0 + 2, n0 * 12)) return false;
  let found = false;
  for (let e = 0; e < n0; e++) {
    const at = ifd0 + 2 + e * 12;
    if (u16(at) !== 0x8825) continue;
    const gps = t + u32(at + 8);
    if (!inside(gps, 2)) continue;
    const n = u16(gps);
    if (n > 200 || !inside(gps + 2, n * 12)) continue;
    for (let k = 0; k < n; k++) {
      const ent = gps + 2 + k * 12;
      const size = (TYPE_SIZE[u16(ent + 2)] || 1) * u32(ent + 4);
      if (size > 4 && size < 4096) {
        const v = t + u32(ent + 8);
        if (inside(v, size)) u8.fill(0, v, v + size);
      }
    }
    // An empty GPS block: zero entries, and a zero "next block" pointer right after.
    u8.fill(0, gps, Math.min(u8.length, gps + 2 + n * 12 + 4));
    found = true;
  }
  return found;
}

function blankExif(u8) {
  let hit = false;
  // "Exif\0\0" marks EXIF in JPEG, HEIC and most WebP files.
  for (const i of indexesOf(u8, enc('Exif\0\0'))) hit = blankGps(u8, i + 6) || hit;
  // TIFF-based files (DNG and other RAW) start with the EXIF structure itself.
  hit = blankGps(u8, 0) || hit;
  // PNG keeps EXIF in an "eXIf" chunk, WebP sometimes in a bare "EXIF" chunk.
  for (const i of indexesOf(u8, enc('eXIf'))) hit = blankGps(u8, i + 4) || hit;
  for (const i of indexesOf(u8, enc('EXIF'))) hit = blankGps(u8, i + 8) || hit;
  return hit;
}

// ---------- XMP (text metadata some apps add) ----------
function blankXmp(u8) {
  let hit = false;
  for (const start of indexesOf(u8, enc('<x:xmpmeta'))) {
    const endAt = indexesOf(u8, enc('</x:xmpmeta>'), start, Math.min(u8.length, start + 4 * 1024 * 1024))[0];
    if (endAt == null) continue;
    const text = latin1(u8.subarray(start, endAt));
    const spans = [];
    for (const m of text.matchAll(/\b[\w-]+:GPS\w*\s*=\s*"([^"]*)"/g)) spans.push([m.index + m[0].length - 1 - m[1].length, m[1].length]);
    for (const m of text.matchAll(/<([\w-]+:GPS\w*)>([^<]*)<\/\1>/g)) spans.push([m.index + m[1].length + 2, m[2].length]);
    for (const [o, len] of spans) { u8.fill(0x20, start + o, start + o + len); hit = true; }
  }
  return hit;
}

// ---------- PNG chunk checksums have to match the edited bytes ----------
const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
function crc32(u8, from, to) {
  let c = 0xffffffff;
  for (let i = from; i < to; i++) c = CRC[(c ^ u8[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function fixPngCrcs(u8) {
  if (!(u8[0] === 0x89 && u8[1] === 0x50 && u8[2] === 0x4e && u8[3] === 0x47)) return;
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  for (let o = 8; o + 12 <= u8.length;) {
    const len = dv.getUint32(o);
    const type = latin1(u8.subarray(o + 4, o + 8));
    if (o + 12 + len > u8.length) break;
    if (!['IDAT', 'IEND'].includes(type)) dv.setUint32(o + 8 + len, crc32(u8, o + 4, o + 8 + len));
    o += 12 + len;
  }
}

// ---------- Videos: location lives in the "moov" box ----------
const u32be = (b, o) => ((b[o] << 24) >>> 0) + (b[o + 1] << 16) + (b[o + 2] << 8) + b[o + 3];
const ISO6709 = /[+-]\d{2}\.\d{2,}[+-]\d{3}\.\d{2,}(?:[+-]\d+(?:\.\d+)?)?\/?/g;

async function moovRange(file) {
  let off = 0;
  for (let guard = 0; off + 8 <= file.size && guard < 400; guard++) {
    const h = new Uint8Array(await file.slice(off, off + 16).arrayBuffer());
    let size = u32be(h, 0);
    let header = 8;
    if (size === 1) { size = u32be(h, 8) * 2 ** 32 + u32be(h, 12); header = 16; } else if (size === 0) size = file.size - off;
    if (size < header) return null;
    if (String.fromCharCode(h[4], h[5], h[6], h[7]) === 'moov') return [off, off + size];
    off += size;
  }
  return null;
}

function blankVideoPlaces(moov) {
  let hit = false;
  // "©xyz" boxes (Android, older iPhones): turn them into empty "free" boxes.
  for (const i of indexesOf(moov, [0xa9, 0x78, 0x79, 0x7a])) {
    const size = u32be(moov, i - 4);
    if (i < 4 || size < 8 || i - 4 + size > moov.length) continue;
    moov.set(enc('free'), i);
    moov.fill(0, i + 4, i - 4 + size);
    hit = true;
  }
  // iPhone keeps "com.apple.quicktime.location.ISO6709" as text: blank the coordinates.
  const text = latin1(moov);
  for (const m of text.matchAll(ISO6709)) { moov.fill(0x20, m.index, m.index + m[0].length); hit = true; }
  return hit;
}

async function stillHasPlace(file, kind) {
  if (kind === 'video') {
    const r = await moovRange(file);
    if (!r) return false;
    if (r[1] - r[0] > 64 * 1024 * 1024) return true;
    const moov = new Uint8Array(await file.slice(r[0], r[1]).arrayBuffer());
    return /[+-]\d{2}\.\d{2,}[+-]\d{3}\.\d{2,}/.test(latin1(moov)) || indexesOf(moov, [0xa9, 0x78, 0x79, 0x7a]).length > 0;
  }
  const gps = await exifr.gps(file).catch(() => null);
  if (gps && Number.isFinite(gps.latitude) && Number.isFinite(gps.longitude)) return true;
  const xmp = await exifr.parse(file, { tiff: false, xmp: true, gps: false }).catch(() => null);
  return Boolean(xmp && Object.keys(xmp).some((k) => /^GPS(Latitude|Longitude)$/.test(k) && String(xmp[k]).trim()));
}

// Returns { file, ok }. ok is false when the location couldn't be removed: don't share that file.
export async function withoutLocation(file, kind) {
  const opts = { type: file.type, lastModified: file.lastModified };
  let out = file;
  if (kind === 'video') {
    const r = await moovRange(file);
    if (r && r[1] - r[0] <= 64 * 1024 * 1024) {
      const moov = new Uint8Array(await file.slice(r[0], r[1]).arrayBuffer());
      if (blankVideoPlaces(moov)) out = new File([file.slice(0, r[0]), moov, file.slice(r[1])], file.name, opts);
    }
  } else {
    const u8 = new Uint8Array(await file.arrayBuffer());
    const a = blankExif(u8);
    const b = blankXmp(u8);
    if (a || b) { fixPngCrcs(u8); out = new File([u8], file.name, opts); }
  }
  return { file: out, ok: !(await stillHasPlace(out, kind)) };
}
