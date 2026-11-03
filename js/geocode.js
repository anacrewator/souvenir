// Turns coordinates into city names. Only the rough centre of a place (2 decimals, ~1 km)
// is sent, one request at a time, and answers are cached on this device.
import { sleep } from './util.js';
import { haversine } from './cluster.js';

const KEY = 'souvenir:places:v1';
let cache = {};
try { cache = JSON.parse(localStorage.getItem(KEY)) || {}; } catch { cache = {}; }
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(cache)); } catch { /* storage full or blocked */ } };

const seeds = [];
export function seedPlaces(list) { seeds.push(...list); }

const keyOf = (lat, lon) => `${lat.toFixed(1)},${lon.toFixed(1)}`;
let queue = Promise.resolve();

export function lookupPlace(lat, lon, { online = true } = {}) {
  const seed = seeds.find((p) => haversine(p.lat, p.lon, lat, lon) < 40);
  if (seed) return Promise.resolve(seed);
  const k = keyOf(lat, lon);
  if (cache[k]) return Promise.resolve(cache[k]);
  if (!online) return Promise.resolve(null);
  const job = queue.then(() => fetchPlace(lat, lon)).then((p) => {
    if (p) { cache[k] = p; save(); }
    return p;
  }).catch(() => null);
  queue = job.then(() => sleep(250));
  return job;
}

async function fetchPlace(lat, lon) {
  const lang = (navigator.language || 'en').slice(0, 2);
  const url = `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat.toFixed(2)}&longitude=${lon.toFixed(2)}&localityLanguage=${lang}`;
  const r = await fetch(url, { referrerPolicy: 'no-referrer' });
  if (!r.ok) throw new Error(`Place lookup failed (${r.status})`);
  const j = await r.json();
  const city = j.city || j.locality || j.principalSubdivision || '';
  return { city, region: j.principalSubdivision || '', country: j.countryName || '', cc: (j.countryCode || '').toUpperCase() };
}

export function flagOf(cc) {
  if (!/^[A-Z]{2}$/.test(cc || '')) return '';
  return String.fromCodePoint(...[...cc].map((c) => 127397 + c.charCodeAt(0)));
}

// Names a trip from its busiest places: "Lisbon", "Tokyo & Kyoto", "Rome, Florence & Venice".
export async function describeTrip(trip, opts) {
  if (!trip.places.length) return null;
  const total = trip.places.reduce((s, p) => s + p.count, 0);
  const picks = trip.places.filter((p, i) => i === 0 || p.count / total >= 0.15).slice(0, 4);
  const named = (await Promise.all(picks.map((p) => lookupPlace(p.lat, p.lon, opts)))).filter(Boolean);
  if (!named.length) return null;
  const cities = [...new Set(named.map((n) => n.city || n.region || n.country).filter(Boolean))].slice(0, 3);
  const countries = [...new Map(named.filter((n) => n.country).map((n) => [n.cc || n.country, n])).values()]
    .map((n) => ({ name: n.country, cc: n.cc }));
  let title = '';
  if (cities.length === 1) title = cities[0];
  else if (cities.length === 2) title = `${cities[0]} & ${cities[1]}`;
  else if (cities.length === 3) title = `${cities[0]}, ${cities[1]} & ${cities[2]}`;
  return { title, cities, countries };
}
