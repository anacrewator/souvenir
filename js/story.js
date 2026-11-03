// Draws a 1080×1920 story card for a trip: gingham, taped polaroids, the trip name.
import { drawable } from './thumbs.js';
import { fmtRange, plural } from './util.js';

const C = {
  ink: '#2A1420', paper: '#FFFDF8', pink: '#FF6FAE', blush: '#FFD3E6',
  cherry: '#E0243A', butter: '#FFE066', matcha: '#5E7F3A', lime: '#D7EE8E',
};

function gingham(ctx, w, h, base, line, size = 64) {
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = line;
  for (let x = 0; x < w; x += size * 2) ctx.fillRect(x, 0, size, h);
  for (let y = 0; y < h; y += size * 2) ctx.fillRect(0, y, w, size);
}

function pickItems(items, n) {
  const imgs = items.filter((i) => i.kind !== 'video');
  const pool = imgs.length >= n ? imgs : items;
  if (pool.length <= n) return pool;
  return Array.from({ length: n }, (_, i) => pool[Math.floor((i + 0.5) * pool.length / n)]);
}

function coverDraw(ctx, img, x, y, w, h) {
  const r = Math.max(w / img.naturalWidth, h / img.naturalHeight);
  const sw = w / r, sh = h / r;
  ctx.drawImage(img, (img.naturalWidth - sw) / 2, (img.naturalHeight - sh) / 2, sw, sh, x, y, w, h);
}

function tape(ctx, x, y, w, rot) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.fillStyle = 'rgba(255, 224, 102, 0.82)';
  ctx.beginPath();
  const h = 46, zig = 6;
  ctx.moveTo(-w / 2, -h / 2);
  ctx.lineTo(w / 2, -h / 2);
  for (let i = 0; i <= 6; i++) ctx.lineTo(w / 2 + (i % 2 ? zig : 0), -h / 2 + (h * i) / 6);
  ctx.lineTo(-w / 2, h / 2);
  for (let i = 6; i >= 0; i--) ctx.lineTo(-w / 2 - (i % 2 ? zig : 0), -h / 2 + (h * i) / 6);
  ctx.fill();
  ctx.restore();
}

function polaroid(ctx, img, cx, cy, size, rot, caption) {
  const pad = size * 0.06, bottom = size * 0.22;
  const w = size + pad * 2, h = size + pad + bottom;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(rot);
  ctx.shadowColor = 'rgba(42, 20, 32, 0.35)';
  ctx.shadowBlur = 30;
  ctx.shadowOffsetY = 14;
  ctx.fillStyle = '#fff';
  ctx.fillRect(-w / 2, -h / 2, w, h);
  ctx.shadowColor = 'transparent';
  ctx.fillStyle = C.blush;
  ctx.fillRect(-w / 2 + pad, -h / 2 + pad, size, size);
  if (img) coverDraw(ctx, img, -w / 2 + pad, -h / 2 + pad, size, size);
  if (caption) {
    ctx.fillStyle = C.ink;
    ctx.font = `${Math.round(size * 0.12)}px "Gochi Hand", cursive`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(caption, 0, h / 2 - bottom / 2, w - pad * 2);
  }
  ctx.restore();
  tape(ctx, cx + Math.sin(rot) * (h / 2), cy - Math.cos(rot) * (h / 2), size * 0.42, rot - 0.05);
}

function flower(ctx, x, y, r, petal, centre) {
  ctx.save();
  ctx.translate(x, y);
  ctx.lineWidth = r * 0.12;
  ctx.strokeStyle = C.ink;
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    ctx.beginPath();
    ctx.arc(Math.cos(a) * r * 0.62, Math.sin(a) * r * 0.62, r * 0.48, 0, Math.PI * 2);
    ctx.fillStyle = petal;
    ctx.fill();
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.38, 0, Math.PI * 2);
  ctx.fillStyle = centre;
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function star(ctx, x, y, r, fill) {
  ctx.save();
  ctx.translate(x, y);
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
    const rr = i % 2 ? r * 0.45 : r;
    ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
  }
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.lineWidth = r * 0.1;
  ctx.strokeStyle = C.ink;
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function wrapLines(ctx, text, maxW) {
  const words = text.split(/\s+/);
  const lines = [];
  let line = '';
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width > maxW && line) { lines.push(line); line = w; } else line = test;
  }
  if (line) lines.push(line);
  return lines;
}

export async function makeStoryCard(album, { flags = '', siteUrl = '' } = {}) {
  await Promise.all([
    document.fonts.load('140px "Bagel Fat One"'),
    document.fonts.load('60px "Gochi Hand"'),
    document.fonts.load('700 44px "Bricolage Grotesque"'),
  ]).catch(() => {});

  const W = 1080, H = 1920;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d');
  gingham(ctx, W, H, C.blush, 'rgba(255, 111, 174, 0.42)');

  // Title, big and stickered
  const title = album.title || 'Our trip';
  let size = 150;
  ctx.font = `${size}px "Bagel Fat One", sans-serif`;
  let lines = wrapLines(ctx, title, 900);
  while ((lines.length > 2 || lines.some((l) => ctx.measureText(l).width > 940)) && size > 70) {
    size -= 8;
    ctx.font = `${size}px "Bagel Fat One", sans-serif`;
    lines = wrapLines(ctx, title, 900);
  }
  ctx.save();
  ctx.translate(W / 2, 250);
  ctx.rotate(-0.04);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  lines.forEach((l, i) => {
    const y = (i - (lines.length - 1) / 2) * size * 0.95;
    ctx.lineWidth = size * 0.2;
    ctx.strokeStyle = '#fff';
    ctx.strokeText(l, 0, y);
    ctx.fillStyle = C.pink;
    ctx.fillText(l, 8, y + 9);
    ctx.fillStyle = C.cherry;
    ctx.fillText(l, 0, y);
  });
  ctx.restore();

  // Date pill
  const dates = album.start ? fmtRange(album.start, album.end) : '';
  const pill = [flags, dates].filter(Boolean).join('  ');
  ctx.font = '700 44px "Bricolage Grotesque", sans-serif';
  const pw = Math.min(980, ctx.measureText(pill).width + 80);
  ctx.save();
  ctx.translate(W / 2, 470);
  ctx.rotate(0.03);
  ctx.fillStyle = C.butter;
  ctx.strokeStyle = C.ink;
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.roundRect(-pw / 2, -42, pw, 84, 42);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = C.ink;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(pill, 0, 3, pw - 50);
  ctx.restore();

  // Polaroids
  const picks = pickItems(album.items, 4);
  const imgs = await Promise.all(picks.map((it) => drawable(it).catch(() => null)));
  const spots = [
    { x: 310, y: 800, r: -0.1, s: 380 },
    { x: 775, y: 880, r: 0.08, s: 370 },
    { x: 315, y: 1330, r: 0.06, s: 370 },
    { x: 770, y: 1400, r: -0.07, s: 380 },
  ];
  const caps = album.placeInfo?.cities?.length ? album.placeInfo.cities : [];
  imgs.forEach((img, i) => {
    const sp = spots[i];
    const cap = i === 0 ? (caps[0] || '') : i === 3 ? (caps[1] || '') : '';
    polaroid(ctx, img, sp.x, sp.y, sp.s, sp.r, cap);
  });

  flower(ctx, 950, 690, 62, C.pink, C.butter);
  flower(ctx, 120, 1180, 48, C.butter, C.cherry);
  star(ctx, 130, 610, 52, C.lime);
  star(ctx, 960, 1270, 40, C.cherry);

  // Footer
  ctx.fillStyle = C.ink;
  ctx.textAlign = 'center';
  ctx.font = '700 46px "Bricolage Grotesque", sans-serif';
  const counts = [album.photos ? plural(album.photos, 'photo') : '', album.videos ? plural(album.videos, 'video') : '',
    album.days > 1 ? plural(album.days, 'day') : ''].filter(Boolean).join(', ');
  ctx.fillText(counts, W / 2, 1790);
  ctx.font = '40px "Gochi Hand", cursive';
  ctx.fillText(`sorted with souvenir${siteUrl ? `  ${siteUrl.replace(/^https?:\/\//, '')}` : ''}`, W / 2, 1860);

  return new Promise((r) => c.toBlob(r, 'image/png'));
}
