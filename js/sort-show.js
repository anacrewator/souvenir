// The sorting scene: photos land in a messy heap while they're read, then fly into
// a pile per trip (plus Everyday, Screenshots, No date). Pile labels switch to city
// names as places are looked up.
import { $, el, plural, prefersReducedMotion } from './util.js';
import { thumbUrl } from './thumbs.js';

const MAX_CARDS = 42;
let s = null;
let seed = 11;
const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

export const showEnabled = () => !prefersReducedMotion() && typeof Element.prototype.animate === 'function';
export const showActive = () => Boolean(s);

function setText(title, sub) {
  if (title != null) $('#show-title').textContent = title;
  if (sub != null) $('#show-sub').textContent = sub;
}
function setProgress(p) {
  const bar = $('#show-bar');
  bar.hidden = p == null;
  if (p != null) bar.style.setProperty('--p', Math.max(0.02, Math.min(1, p)));
}

export function startShow(total, { onClose } = {}) {
  const d = $('#sort-show');
  seed = 11;
  $('.show-layer', d).replaceChildren();
  $('#show-piles').replaceChildren();
  $('#show-continue').hidden = true;
  $('#show-skip').hidden = false;
  s = { d, total, every: Math.max(1, Math.ceil(total / MAX_CARDS)), seen: 0, cards: [], piles: new Map(), z: 10, onClose, timer: null };
  setText('Reading your photos', `0 of ${total.toLocaleString('en-GB')}`);
  setProgress(0);
  if (!d.open) d.showModal();
}

export function feedShow(item, done) {
  if (!s) return;
  s.seen++;
  setText(null, `${done.toLocaleString('en-GB')} of ${s.total.toLocaleString('en-GB')}`);
  setProgress(done / s.total);
  if ((s.seen - 1) % s.every !== 0 || s.cards.length >= MAX_CARDS) return;

  const layer = $('.show-layer', s.d);
  const heap = $('.show-heap', s.d).getBoundingClientRect();
  const base = layer.getBoundingClientRect();
  const card = el('div', { class: 'show-card' }, el('div', { class: 'show-photo' }));
  layer.append(card);
  const w = card.offsetWidth, h = card.offsetHeight;
  const x = heap.left - base.left + heap.width / 2 - w / 2 + (rand() - 0.5) * Math.max(0, heap.width - w) * 0.85;
  const y = heap.top - base.top + heap.height / 2 - h / 2 + (rand() - 0.5) * Math.max(0, heap.height - h) * 0.75;
  const r = (rand() - 0.5) * 56;
  card.style.left = `${x}px`;
  card.style.top = `${y}px`;
  card.style.zIndex = String(s.z++);
  card.style.transform = `rotate(${r}deg)`;
  card.animate([
    { transform: `translate(${(rand() - 0.5) * 60}px, -70px) rotate(${r * 2}deg) scale(1.3)`, opacity: 0 },
    { transform: `rotate(${r}deg)`, opacity: 1 },
  ], { duration: 420, easing: 'cubic-bezier(.2, 1.4, .4, 1)' });
  thumbUrl(item).then((u) => {
    if (!u) return;
    const img = el('img', { alt: '' });
    img.src = u;
    card.firstChild.append(img);
  });
  s.cards.push({ item, card, x, y, r });
}

function makePile(def) {
  const name = el('span', { class: 'pile-name' }, def.label);
  const flags = el('span', { class: 'pile-flags' }, def.flags || '');
  const count = el('p', { class: 'pile-count' }, '0');
  const stack = el('div', { class: 'pile-stack' });
  const node = el('div', { class: `pile pile-${def.kind}` }, stack, el('p', { class: 'pile-label' }, flags, name), count);
  return { ...def, node, stack, name, flags, countEl: count, landed: 0, expected: 0 };
}

export async function sortShow(lib, { titleOf, flagsOf }) {
  if (!s) return;
  const show = s;
  setProgress(null);

  const albumOf = new Map();
  for (const a of [...lib.trips, ...lib.months, ...lib.extras]) for (const it of a.items) albumOf.set(it, a);

  const hits = new Map();
  for (const c of show.cards) {
    const a = albumOf.get(c.item);
    if (a?.kind === 'trip') hits.set(a, (hits.get(a) || 0) + 1);
  }
  const maxTrips = innerWidth < 600 ? 3 : 5;
  const chosen = [...hits.keys()].sort((a, b) => hits.get(b) - hits.get(a)).slice(0, maxTrips).sort((a, b) => b.start - a.start);
  const keyOf = (a) => {
    if (!a || a.kind === 'month') return 'everyday';
    if (a.kind === 'trip') return chosen.includes(a) ? a.id : 'more-trips';
    return a.kind;
  };

  const realCount = (key) => {
    if (key === 'everyday') return lib.months.reduce((n, m) => n + m.items.length, 0);
    if (key === 'more-trips') return lib.trips.filter((t) => !chosen.includes(t)).reduce((n, t) => n + t.items.length, 0);
    const a = [...lib.trips, ...lib.extras].find((x) => x.id === key || x.kind === key);
    return a ? a.items.length : 0;
  };
  const defs = [
    ...chosen.map((t) => ({ key: t.id, label: titleOf(t), flags: flagsOf(t), kind: 'trip' })),
    { key: 'more-trips', label: 'More trips', kind: 'trip' },
    { key: 'everyday', label: 'Everyday', kind: 'everyday' },
    { key: 'screens', label: 'Screenshots', kind: 'screens' },
    { key: 'undated', label: 'No date', kind: 'undated' },
  ];
  const targets = show.cards.map((c) => keyOf(albumOf.get(c.item)));
  const box = $('#show-piles');
  defs.filter((d) => targets.includes(d.key)).forEach((d, i) => {
    const p = makePile(d);
    p.real = realCount(d.key);
    p.expected = targets.filter((k) => k === d.key).length;
    show.piles.set(d.key, p);
    box.append(p.node);
    p.node.animate([{ transform: 'translateY(30px) scale(.6) rotate(-6deg)', opacity: 0 }, { transform: 'none', opacity: 1 }],
      { duration: 420, delay: i * 90, easing: 'cubic-bezier(.2, 1.5, .4, 1)', fill: 'backwards' });
  });

  const trips = lib.trips.length;
  setText(trips ? `Found ${plural(trips, 'trip')}` : 'Sorting by month', 'Putting everything in its place');
  await frame();
  if (s !== show) return;
  squeezeHeap(show);
  await wait(450 + show.piles.size * 90);
  if (s !== show) return;

  const order = show.cards.map((c, i) => ({ c, key: targets[i] })).reverse();
  const stagger = Math.max(55, Math.min(150, 2600 / order.length));
  await Promise.all(order.map(({ c, key }, i) => fly(show, c, show.piles.get(key), i * stagger)));
  if (s !== show) return;

  setText('All sorted', trips ? `${plural(trips, 'trip')} and ${plural(lib.months.length, 'month')} at home` : `${plural(lib.months.length, 'month')} of photos`);
  $('#show-skip').hidden = true;
  $('#show-continue').hidden = false;
  $('#show-continue').focus();
  show.timer = setTimeout(() => endShow(), 3500);
}

// The piles take up room, so the heap slides into whatever space is left.
function squeezeHeap(show) {
  const layer = $('.show-layer', show.d).getBoundingClientRect();
  const heap = $('.show-heap', show.d).getBoundingClientRect();
  if (!show.cards.length) return;
  const xs = show.cards.map((c) => c.x), ys = show.cards.map((c) => c.y);
  const w = show.cards[0].card.offsetWidth, h = show.cards[0].card.offsetHeight;
  const minX = Math.min(...xs), maxX = Math.max(...xs) + w;
  const minY = Math.min(...ys), maxY = Math.max(...ys) + h;
  const kx = Math.min(1, heap.width / Math.max(1, maxX - minX));
  const ky = Math.min(1, Math.max(0.15, heap.height - h * 0.2) / Math.max(1, maxY - minY));
  const cx = heap.left - layer.left + heap.width / 2, cy = heap.top - layer.top + heap.height / 2;
  const ox = (minX + maxX) / 2, oy = (minY + maxY) / 2;
  for (const c of show.cards) {
    c.x = cx + (c.x + w / 2 - ox) * kx - w / 2;
    c.y = cy + (c.y + h / 2 - oy) * ky - h / 2;
    c.card.style.left = `${c.x}px`;
    c.card.style.top = `${c.y}px`;
  }
}

function fly(show, c, pile, delay) {
  return new Promise((resolve) => setTimeout(() => {
    if (s !== show || !pile) return resolve();
    const layer = $('.show-layer', show.d).getBoundingClientRect();
    const t = pile.stack.getBoundingClientRect();
    const w = c.card.offsetWidth, h = c.card.offsetHeight;
    const scale = Math.min(t.width / w, t.height / h) * 0.9;
    const n = pile.landed;
    const tx = t.left - layer.left + t.width / 2 - w / 2 + (rand() - 0.5) * 8;
    const ty = t.top - layer.top + t.height / 2 - h / 2 - Math.min(n, 8) * 1.5;
    const dx = tx - c.x, dy = ty - c.y;
    const r1 = (rand() - 0.5) * 18;
    c.card.style.zIndex = String(1000 + show.z++);
    const anim = c.card.animate([
      { transform: `translate(0, 0) rotate(${c.r}deg) scale(1)` },
      { transform: `translate(${dx * 0.45}px, ${dy * 0.45 - 90}px) rotate(${(c.r + r1) / 2 + 12}deg) scale(${(1 + scale) / 2 + 0.12})`, offset: 0.45 },
      { transform: `translate(${dx}px, ${dy}px) rotate(${r1}deg) scale(${scale})` },
    ], { duration: 720, easing: 'cubic-bezier(.45, .05, .3, 1)', fill: 'forwards' });
    anim.onfinish = () => {
      pile.landed++;
      const shown = pile.landed === pile.expected ? pile.real : Math.max(pile.landed, Math.round(pile.real * pile.landed / pile.expected));
      pile.countEl.textContent = plural(shown, 'item');
      pile.node.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.06) rotate(-1deg)' }, { transform: 'scale(1)' }], { duration: 220 });
      resolve();
    };
    anim.oncancel = () => resolve();
  }, delay));
}

// Called when a trip's place name arrives.
export function renameInShow(id, title, flags) {
  const p = s?.piles.get(id);
  if (!p || p.name.textContent === title) return;
  p.name.textContent = title;
  p.flags.textContent = flags || '';
  p.node.animate([{ transform: 'rotate(0)' }, { transform: 'rotate(-4deg) scale(1.08)' }, { transform: 'rotate(0)' }], { duration: 360, easing: 'ease-out' });
}

export function endShow() {
  if (!s) return;
  const { d, onClose, timer } = s;
  clearTimeout(timer);
  s = null;
  if (d.open) d.close();
  onClose?.();
}

export function wireShow() {
  $('#show-continue').addEventListener('click', endShow);
  $('#show-skip').addEventListener('click', endShow);
  $('#sort-show').addEventListener('close', () => { if (s) endShow(); });
}
