// iPhone HEIC photos carry a small ready-made preview (about 320×240) next to the full
// 12-megapixel picture. Decoding that preview is roughly a hundred times faster than the
// whole photo, so this pulls it out and wraps it as a tiny HEIC file of its own.
// Returns a Blob, or null when the file has no usable preview.

const td = new TextDecoder('latin1');

function reader(u8) {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const r = {
    u8: (o) => u8[o],
    u16: (o) => dv.getUint16(o),
    u32: (o) => dv.getUint32(o),
    n: (o, size) => (size === 0 ? 0 : size === 2 ? dv.getUint16(o) : size === 4 ? dv.getUint32(o) : dv.getUint32(o) * 2 ** 32 + dv.getUint32(o + 4)),
    type: (o) => td.decode(u8.subarray(o, o + 4)),
  };
  // Calls fn(type, start, size) for each box between `from` and `to`.
  r.boxes = (from, to, fn) => {
    for (let o = from; o + 8 <= to;) {
      let size = r.u32(o);
      if (size === 0) size = to - o;
      if (size < 8 || o + size > to) return;
      fn(r.type(o + 4), o, size);
      o += size;
    }
  };
  return r;
}

// Finds the "meta" box near the start of the file and reads all of it.
async function readMeta(blob) {
  let head = new Uint8Array(await blob.slice(0, 256 * 1024).arrayBuffer());
  let r = reader(head);
  let meta = null;
  r.boxes(0, head.length, (type, o, size) => { if (type === 'meta' && !meta) meta = [o, size]; });
  if (!meta) {
    // The meta box may run past what we read: look at box headers only.
    for (let o = 0; o + 8 <= head.length;) {
      const size = r.u32(o);
      if (r.type(o + 4) === 'meta') { meta = [o, size]; break; }
      if (size < 8) break;
      o += size;
    }
    if (!meta || meta[1] > 8 * 1024 * 1024) return null;
  }
  if (meta[0] + meta[1] > head.length) {
    head = new Uint8Array(await blob.slice(meta[0], meta[0] + meta[1]).arrayBuffer());
    return { u8: head, start: 0, size: meta[1] };
  }
  return { u8: head, start: meta[0], size: meta[1] };
}

function parse(u8, start, size) {
  const r = reader(u8);
  const out = { primary: 0, types: new Map(), thumbs: [], props: [], assoc: new Map(), locs: new Map() };
  r.boxes(start + 12, start + size, (type, o, len) => {
    const v = r.u8(o + 8);
    const end = o + len;
    if (type === 'pitm') out.primary = v === 0 ? r.u16(o + 12) : r.u32(o + 12);
    else if (type === 'iinf') {
      r.boxes(o + (v === 0 ? 14 : 16), end, (t, e) => {
        if (t !== 'infe') return;
        const ev = r.u8(e + 8);
        if (ev === 2) out.types.set(r.u16(e + 12), r.type(e + 16));
        else if (ev === 3) out.types.set(r.u32(e + 12), r.type(e + 18));
      });
    } else if (type === 'iref') {
      const w = v === 0 ? 2 : 4;
      r.boxes(o + 12, end, (t, e) => {
        if (t !== 'thmb') return;
        const from = r.n(e + 8, w);
        const count = r.u16(e + 8 + w);
        const to = [];
        for (let i = 0; i < count; i++) to.push(r.n(e + 10 + w + i * w, w));
        out.thumbs.push({ id: from, to });
      });
    } else if (type === 'iprp') {
      r.boxes(o + 8, end, (t, e, l) => {
        if (t === 'ipco') r.boxes(e + 8, e + l, (_, p, pl) => out.props.push(u8.subarray(p, p + pl)));
        else if (t === 'ipma') {
          const mv = r.u8(e + 8);
          const wide = r.u8(e + 11) & 1;
          let p = e + 16;
          const count = r.u32(e + 12);
          for (let i = 0; i < count && p < e + l; i++) {
            const id = mv < 1 ? r.u16(p) : r.u32(p);
            p += mv < 1 ? 2 : 4;
            const n = r.u8(p++);
            const list = [];
            for (let k = 0; k < n; k++) {
              if (wide) { const x = r.u16(p); list.push({ essential: x >> 15, index: x & 0x7fff }); p += 2; }
              else { const x = r.u8(p); list.push({ essential: x >> 7, index: x & 0x7f }); p += 1; }
            }
            out.assoc.set(id, list);
          }
        }
      });
    } else if (type === 'iloc') {
      const offSize = r.u8(o + 12) >> 4, lenSize = r.u8(o + 12) & 15;
      const baseSize = r.u8(o + 13) >> 4, idxSize = v > 0 ? r.u8(o + 13) & 15 : 0;
      let p = o + 14;
      const count = v < 2 ? r.u16(p) : r.u32(p);
      p += v < 2 ? 2 : 4;
      for (let i = 0; i < count && p < end; i++) {
        const id = v < 2 ? r.u16(p) : r.u32(p);
        p += v < 2 ? 2 : 4;
        let method = 0;
        if (v > 0) { method = r.u16(p) & 15; p += 2; }
        p += 2; // data reference index
        const base = r.n(p, baseSize); p += baseSize;
        const n = r.u16(p); p += 2;
        const extents = [];
        for (let k = 0; k < n; k++) {
          p += idxSize;
          const off = r.n(p, offSize); p += offSize;
          const length = r.n(p, lenSize); p += lenSize;
          extents.push([base + off, length]);
        }
        out.locs.set(id, { method, extents });
      }
    }
  });
  return out;
}

const ascii = (s) => [...s].map((c) => c.charCodeAt(0));

function box(type, body, fullBox = null) {
  const head = fullBox ? 12 : 8;
  const out = new Uint8Array(head + body.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, out.length);
  out.set(ascii(type), 4);
  if (fullBox) dv.setUint32(8, (fullBox.version << 24) | fullBox.flags);
  out.set(body, head);
  return out;
}

const cat = (...parts) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
};
const be16 = (v) => [v >> 8 & 255, v & 255];
const be32 = (v) => [v >>> 24 & 255, v >> 16 & 255, v >> 8 & 255, v & 255];
const v0 = { version: 0, flags: 0 };

export async function heicThumbnail(blob) {
  const meta = await readMeta(blob);
  if (!meta) return null;
  const info = parse(meta.u8, meta.start, meta.size);
  if (!info.primary) return null;
  const sizeOf = (id) => {
    for (const a of info.assoc.get(id) || []) {
      const p = info.props[a.index - 1];
      if (p && td.decode(p.subarray(4, 8)) === 'ispe') {
        const dv = new DataView(p.buffer, p.byteOffset, p.byteLength);
        return dv.getUint32(12) * dv.getUint32(16);
      }
    }
    return 0;
  };
  const thumb = info.thumbs
    .filter((t) => t.to.includes(info.primary) && info.types.get(t.id) === 'hvc1')
    .map((t) => ({ ...t, area: sizeOf(t.id) }))
    .filter((t) => t.area >= 160 * 120)
    .sort((a, b) => b.area - a.area)[0];
  const loc = thumb && info.locs.get(thumb.id);
  if (!loc || loc.method !== 0 || !loc.extents.length) return null;

  const chunks = await Promise.all(loc.extents.map(([o, l]) => blob.slice(o, o + l).arrayBuffer().then((b) => new Uint8Array(b))));
  const data = cat(...chunks);
  if (!data.length || data.length > 4 * 1024 * 1024) return null;

  const props = (info.assoc.get(thumb.id) || []).map((a) => ({ ...a, bytes: info.props[a.index - 1] })).filter((a) => a.bytes);
  if (!props.length) return null;

  const ftyp = box('ftyp', new Uint8Array([...ascii('heic'), 0, 0, 0, 0, ...ascii('mif1'), ...ascii('heic')]));
  const hdlr = box('hdlr', new Uint8Array([0, 0, 0, 0, ...ascii('pict'), ...new Array(12).fill(0), 0]), v0);
  const pitm = box('pitm', new Uint8Array(be16(1)), v0);
  const infe = box('infe', new Uint8Array([...be16(1), 0, 0, ...ascii('hvc1'), 0]), { version: 2, flags: 0 });
  const iinf = box('iinf', cat(new Uint8Array(be16(1)), infe), v0);
  const ipco = box('ipco', cat(...props.map((p) => p.bytes)));
  const ipma = box('ipma', new Uint8Array([...be32(1), ...be16(1), props.length, ...props.map((p, i) => (p.essential ? 0x80 : 0) | (i + 1))]), v0);
  const iprp = box('iprp', cat(ipco, ipma));
  const ilocLen = 12 + 2 + 2 + 2 + 2 + 2 + 4 + 4;
  const metaLen = 12 + hdlr.length + pitm.length + iinf.length + iprp.length + ilocLen;
  const dataAt = ftyp.length + metaLen + 8;
  const iloc = box('iloc', new Uint8Array([0x44, 0x00, ...be16(1), ...be16(1), ...be16(0), ...be16(1), ...be32(dataAt), ...be32(data.length)]), v0);
  const metaBox = box('meta', cat(hdlr, pitm, iinf, iprp, iloc), v0);
  const mdat = box('mdat', data);
  return new Blob([ftyp, metaBox, mdat], { type: 'image/heic' });
}
