// A made-up camera roll so anyone can try the app without their own photos.
// Pictures are drawn on the fly; dates and places are set by hand.
import { newId } from './metadata.js';
import { seedPlaces } from './geocode.js';

const HOME = { lat: 40.4168, lon: -3.7038, city: 'Madrid', region: 'Madrid', country: 'Spain', cc: 'ES' };
const PLACES = {
  lisbon: { lat: 38.7223, lon: -9.1393, city: 'Lisbon', region: 'Lisbon', country: 'Portugal', cc: 'PT', sky: ['#7fd3ff', '#fff1c1'], ground: '#f4a259', accent: '#ffd23f' },
  tokyo: { lat: 35.6762, lon: 139.6503, city: 'Tokyo', region: 'Tokyo', country: 'Japan', cc: 'JP', sky: ['#ffd3e6', '#fff8f0'], ground: '#8e7dbe', accent: '#ff6fae' },
  kyoto: { lat: 35.0116, lon: 135.7681, city: 'Kyoto', region: 'Kyoto', country: 'Japan', cc: 'JP', sky: ['#ffe5ec', '#d7ee8e'], ground: '#5e7f3a', accent: '#e0243a' },
  cdmx: { lat: 19.4326, lon: -99.1332, city: 'Mexico City', region: 'CDMX', country: 'Mexico', cc: 'MX', sky: ['#5bc0eb', '#ffe066'], ground: '#e0243a', accent: '#2ec4b6' },
  home: { ...HOME, sky: ['#cdbbff', '#fffdf8'], ground: '#ff9f1c', accent: '#ff6fae' },
};

let rnd = 7;
const rand = () => ((rnd = (rnd * 16807) % 2147483647) / 2147483647);
const jitter = (v, amt) => v + (rand() - 0.5) * amt;

function paint(place, kind) {
  const c = document.createElement('canvas');
  c.width = 640;
  c.height = 800;
  const g = c.getContext('2d');
  const sky = g.createLinearGradient(0, 0, 0, 800);
  sky.addColorStop(0, place.sky[0]);
  sky.addColorStop(1, place.sky[1]);
  g.fillStyle = sky;
  g.fillRect(0, 0, 640, 800);
  // sun
  g.fillStyle = place.accent;
  g.beginPath();
  g.arc(120 + rand() * 400, 140 + rand() * 160, 50 + rand() * 50, 0, Math.PI * 2);
  g.fill();
  if (kind === 'screen') {
    g.fillStyle = '#fff';
    g.fillRect(40, 60, 560, 680);
    g.fillStyle = '#2a1420';
    for (let i = 0; i < 9; i++) g.fillRect(80, 110 + i * 64, 200 + rand() * 280, 22);
    return c;
  }
  // hills / skyline
  g.fillStyle = place.ground;
  g.beginPath();
  g.moveTo(0, 800);
  for (let x = 0; x <= 640; x += 40) g.lineTo(x, 520 + Math.sin(x / 70 + rand() * 3) * 50 + rand() * 40);
  g.lineTo(640, 800);
  g.fill();
  g.fillStyle = 'rgba(42,20,32,0.82)';
  for (let i = 0; i < 6; i++) {
    const w = 40 + rand() * 60, h = 60 + rand() * 180;
    g.fillRect(rand() * 600, 700 - h, w, h + 100);
  }
  return c;
}

const toBlob = (canvas, type) => new Promise((r) => canvas.toBlob(r, type, 0.8));

async function make(placeKey, date, { gps = true, kind = 'image', name } = {}) {
  const place = PLACES[placeKey];
  const blob = await toBlob(paint(place, kind), kind === 'screen' ? 'image/png' : 'image/jpeg');
  const fileName = name || `IMG_${String(1000 + Math.floor(rand() * 8999))}.${kind === 'screen' ? 'PNG' : 'JPG'}`;
  const file = new File([blob], fileName, { type: blob.type, lastModified: date ? date.getTime() : Date.now() });
  return {
    id: newId(),
    name: fileName,
    path: `Sample camera roll/${fileName}`,
    dir: 'Sample camera roll',
    kind: kind === 'video' ? 'image' : 'image',
    file,
    size: file.size + Math.floor(rand() * 1e6),
    date,
    dateSource: date ? 'camera' : null,
    lat: gps ? jitter(place.lat, 0.06) : null,
    lon: gps ? jitter(place.lon, 0.06) : null,
    camera: 'Sample camera',
    screenshot: kind === 'screen',
    source: 'demo',
  };
}

function at(day, hour) {
  const d = new Date(day + 'T00:00:00');
  d.setHours(hour, Math.floor(rand() * 60), Math.floor(rand() * 60));
  return d;
}
function addDays(day, n) {
  const d = new Date(day + 'T12:00:00');
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

async function trip(place, start, days, perDay, { gpsShare = 0.85 } = {}) {
  const out = [];
  for (let d = 0; d < days; d++) {
    for (let i = 0; i < perDay; i++) {
      out.push(make(place, at(addDays(start, d), 9 + Math.floor(rand() * 12)), { gps: rand() < gpsShare }));
    }
  }
  return Promise.all(out);
}

export async function makeDemoLibrary() {
  rnd = 7;
  seedPlaces(Object.values(PLACES).map(({ lat, lon, city, region, country, cc }) => ({ lat, lon, city, region, country, cc })));
  const parts = await Promise.all([
    trip('lisbon', '2026-06-12', 4, 4),
    trip('tokyo', '2026-04-02', 4, 3),
    trip('kyoto', '2026-04-06', 3, 3),
    trip('cdmx', '2025-12-27', 5, 3),
  ]);
  const home = [];
  const homeDays = ['2025-11-08', '2025-11-22', '2026-01-17', '2026-02-14', '2026-02-28', '2026-03-21', '2026-05-09',
    '2026-05-23', '2026-07-04', '2026-07-18', '2026-09-12', '2026-10-03', '2026-10-24'];
  for (const day of homeDays) {
    const n = 1 + Math.floor(rand() * 3);
    for (let i = 0; i < n; i++) home.push(make('home', at(day, 10 + Math.floor(rand() * 10)), { gps: rand() < 0.7 }));
  }
  const screens = [
    make('home', at('2026-05-03', 10), { kind: 'screen', gps: false, name: 'Screenshot 2026-05-03 at 10.12.44.png' }),
    make('home', at('2026-08-19', 22), { kind: 'screen', gps: false, name: 'Screenshot 2026-08-19 at 22.40.02.png' }),
    make('tokyo', at('2026-03-28', 15), { kind: 'screen', gps: false, name: 'Screenshot 2026-03-28 at 15.03.10.png' }),
  ];
  const undated = [make('home', null, { gps: false, name: 'old-scan-01.jpg' }), make('home', null, { gps: false, name: 'old-scan-02.jpg' })];
  const rest = await Promise.all([...home, ...screens, ...undated]);
  return [...parts.flat(), ...rest];
}
