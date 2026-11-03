// Turns a pile of dated (and maybe geotagged) items into trips, months and leftovers.
import { dayKey, monthKey, spanDays, fmtMonth } from './util.js';

export const DEFAULT_SETTINGS = {
  home: 'auto',        // 'auto' | 'none' | a place key
  homeRadiusKm: 60,    // further than this from home = away
  gapHours: 36,        // this long without away photos ends a trip
  minTripItems: 4,     // smaller groups go back to everyday
  onlineNames: true,   // look up city names for trips
};

const HOUR = 3600e3;
const CELL = 0.25; // degrees, about 25 km

export function haversine(aLat, aLon, bLat, bLon) {
  const r = Math.PI / 180;
  const dLat = (bLat - aLat) * r, dLon = (bLon - aLon) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * r) * Math.cos(bLat * r) * Math.sin(dLon / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}

const cellKey = (lat, lon) => `${Math.round(lat / CELL)}|${Math.round(lon / CELL)}`;

// Groups geotagged items into ~25 km cells. Sorted by number of distinct days seen.
export function findPlaces(items) {
  const cells = new Map();
  for (const it of items) {
    if (it.lat == null) continue;
    const k = cellKey(it.lat, it.lon);
    let c = cells.get(k);
    if (!c) cells.set(k, (c = { key: k, latSum: 0, lonSum: 0, count: 0, days: new Set() }));
    c.latSum += it.lat;
    c.lonSum += it.lon;
    c.count++;
    if (it.date) c.days.add(dayKey(it.date));
  }
  return [...cells.values()]
    .map((c) => ({ key: c.key, lat: c.latSum / c.count, lon: c.lonSum / c.count, count: c.count, days: c.days.size }))
    .sort((a, b) => b.days - a.days || b.count - a.count);
}

function makeAlbum(kind, items, extra = {}) {
  const dated = items.filter((i) => i.date);
  const start = dated[0]?.date || null;
  const end = dated[dated.length - 1]?.date || null;
  return {
    id: extra.id || `${kind}-${start ? start.getTime().toString(36) : items.length}`,
    kind,
    items,
    start,
    end,
    days: start ? spanDays(start, end) : 0,
    photos: items.filter((i) => i.kind !== 'video').length,
    videos: items.filter((i) => i.kind === 'video').length,
    places: findPlaces(items).sort((a, b) => b.count - a.count),
    title: '',
    ...extra,
  };
}

// Trips from GPS: runs of photos far from home, close together in time.
function tripsByPlace(dated, home, s) {
  const gap = s.gapHours * HOUR;
  const status = dated.map((it) =>
    it.lat == null ? null : home ? haversine(home.lat, home.lon, it.lat, it.lon) > s.homeRadiusKm : true);
  const tripOf = new Array(dated.length).fill(-1);
  const groups = [];
  let cur = -1;
  let lastAway = 0;
  for (let i = 0; i < dated.length; i++) {
    if (status[i] === true) {
      const t = dated[i].date.getTime();
      if (cur < 0 || t - lastAway > gap) { cur = groups.length; groups.push([]); }
      groups[cur].push(i);
      tripOf[i] = cur;
      lastAway = t;
    } else if (status[i] === false) {
      cur = -1; // back home
    }
  }

  // Photos without GPS join a trip when their neighbours in time are on it.
  const prev = new Array(dated.length), next = new Array(dated.length);
  for (let i = 0, p = -1; i < dated.length; i++) { prev[i] = p; if (status[i] !== null) p = i; }
  for (let i = dated.length - 1, n = -1; i >= 0; i--) { next[i] = n; if (status[i] !== null) n = i; }
  const SNAP = 6 * HOUR;
  for (let i = 0; i < dated.length; i++) {
    if (status[i] !== null || dated[i].dateSource === 'file') continue;
    const a = prev[i], b = next[i];
    const ta = a >= 0 ? tripOf[a] : -1, tb = b >= 0 ? tripOf[b] : -1;
    let g = -1;
    if (ta >= 0 && ta === tb) g = ta;
    else if (ta >= 0 && dated[i].date - dated[a].date <= SNAP) g = ta;
    else if (tb >= 0 && dated[b].date - dated[i].date <= SNAP) g = tb;
    if (g >= 0) groups[g].push(i);
  }

  return groups
    .filter((g) => g.length >= s.minTripItems)
    .map((g) => makeAlbum('trip', g.sort((x, y) => x - y).map((i) => dated[i])));
}

// No GPS at all: guess trips from runs of days with lots of photos.
function tripsByBursts(dated, s) {
  const byDay = new Map();
  for (const it of dated) {
    if (it.dateSource === 'file') continue;
    const k = dayKey(it.date);
    byDay.set(k, (byDay.get(k) || 0) + 1);
  }
  const busyDays = [...byDay.entries()].filter(([, n]) => n >= 6).map(([k]) => k).sort();
  const runs = [];
  let run = null;
  let prev = null;
  for (const k of busyDays) {
    const gapDays = prev ? Math.round((new Date(k + 'T12:00') - new Date(prev + 'T12:00')) / 864e5) : 99;
    if (run && gapDays <= 2) run.push(k);
    else runs.push((run = [k]));
    prev = k;
  }
  return runs
    .filter((r) => r.length >= 2)
    .map((r) => dated.filter((it) => it.dateSource !== 'file' && dayKey(it.date) >= r[0] && dayKey(it.date) <= r[r.length - 1]))
    .filter((items) => items.length >= s.minTripItems * 2)
    .map((items) => makeAlbum('trip', items, { guessed: true }));
}

export function sortLibrary(items, settings) {
  const s = { ...DEFAULT_SETTINGS, ...settings };
  const screens = [], undated = [], dated = [];
  for (const it of items) {
    if (it.screenshot) screens.push(it);
    else if (!it.date) undated.push(it);
    else dated.push(it);
  }
  dated.sort((a, b) => a.date - b.date);
  screens.sort((a, b) => (a.date || 0) - (b.date || 0));

  const places = findPlaces(dated);
  let home = null;
  if (s.home === 'auto') home = places[0] || null;
  else if (s.home !== 'none') home = places.find((p) => p.key === s.home) || places[0] || null;

  const geoCount = dated.filter((i) => i.lat != null).length;
  const useGps = geoCount >= 3 && geoCount / Math.max(1, dated.length) >= 0.05;
  const trips = useGps ? tripsByPlace(dated, home, s) : tripsByBursts(dated, s);

  const inTrip = new Set(trips.flatMap((t) => t.items));
  const byMonth = new Map();
  for (const it of dated) {
    if (inTrip.has(it)) continue;
    const k = monthKey(it.date);
    if (!byMonth.has(k)) byMonth.set(k, []);
    byMonth.get(k).push(it);
  }
  const months = [...byMonth.entries()].map(([k, list]) =>
    makeAlbum('month', list, { id: `month-${k}`, title: fmtMonth(list[0].date) }));

  const extras = [];
  if (screens.length) extras.push(makeAlbum('screens', screens, { id: 'screens', title: 'Screenshots and saved images' }));
  if (undated.length) extras.push(makeAlbum('undated', undated, { id: 'undated', title: "Couldn't find a date" }));

  return {
    home,
    places: places.slice(0, 8),
    usedGps: useGps,
    trips: trips.reverse(),
    months: months.reverse(),
    extras,
    total: items.length,
  };
}

export function defaultTripTitle(t) {
  return t.guessed ? `Getaway? ${fmtMonth(t.start)}` : `Trip, ${fmtMonth(t.start)}`;
}
