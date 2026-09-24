// A made-up trip on real roads, for looking at the post-drive review without driving:
// open the app with ?mock. The pretend car drives the Q1 demo route through the same tiles
// and rules the phone uses, and taps Sai once for each different kind of limit it meets -
// the statute on a small street, a sign on the map, the statute on a big road - so each
// card has a real map, a real replay and a different explanation to give.
//
//   node tools/mock-trip.js [site/tiles] [site/mock/trip.json]
//
// Built next to the tiles rather than committed: it is derived from OSM like they are.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { tilesAround, matchLive, evaluate, makeStabiliser } from '../src/live.js';
import { makeAutopilot } from '../src/autopilot.js';
import { lastChange } from '../src/trip.js';
import { metres } from '../src/geo.js';

const [DIR = 'site/tiles', OUT = 'site/mock/trip.json'] = process.argv.slice(2);
if (!existsSync(`${DIR}/index.json`)) { console.error(`No tiles in ${DIR}; run npm run site first.`); process.exit(1); }
const index = JSON.parse(readFileSync(`${DIR}/index.json`, 'utf8'));
const cache = new Map();
const load = (k) => {
  if (!cache.has(k)) cache.set(k, existsSync(`${DIR}/${k}.json`) ? JSON.parse(readFileSync(`${DIR}/${k}.json`, 'utf8')) : []);
  return cache.get(k);
};
const getPieces = (lon, lat) => tilesAround(lon, lat).flatMap(load);

const VEHICLE = 'oto_con';
const step = makeAutopilot({ getPieces, start: [106.694793, 10.769263], heading: 68, kmh: 35, seed: 5 });
if (!step) { console.error('The demo route is not in these tiles.'); process.exit(1); }

// Times are rewritten to "just now" when the app loads the file; these only need to be
// in the right order and a second apart.
const T0 = Date.parse('2026-01-01T01:00:00Z');
const trip = { id: T0, start: new Date(T0).toISOString(), vehicle: VEHICLE, built: index.built };
const trace = [{ type: 'start', t: trip.start, vehicle: VEHICLE }];
const reports = [];
const stab = makeStabiliser();
let prev = null, shown = null, last = null;
const window = [];
// Tap well into the first road, then a few seconds after each change to a kind of limit
// not tapped yet: the change is then inside the thirty seconds the card replays.
const taps = new Set([45]);
const kinds = new Set();
const kind = (r) => `${r.limit.tier}|${r.zone.reason}`;

const snapshot = (type, fix, kmh, r) => ({
  type, t: new Date(fix.t).toISOString(),
  lat: +fix.lat.toFixed(6), lon: +fix.lon.toFixed(6), acc: fix.acc,
  heading: fix.heading != null ? Math.round(fix.heading) : null, speedSrc: 'gps', headingSrc: 'gps', kmh,
  way: prev ? prev.id : null,
  road: r ? (r.name || r.label) : null, highway: r ? r.road.highway : null,
  ward: r ? r.wardName : null, quarter: r ? r.quarterName : null,
  zone: r ? { inside: r.zone.inside, confidence: r.zone.confidence, reason: r.zone.reason } : null,
  now: r ? { max: r.limit.max, tier: r.limit.tier, rule: r.limit.rule } : null,
  shown: shown ? { max: shown.limit.max, tier: shown.limit.tier, rule: shown.limit.rule } : null,
});

for (let s = 0; s < 900 && reports.length < 3; s++) {
  const fix = { ...step(1), t: T0 + s * 1000 };
  const kmh = Math.round(fix.speed * 3.6);
  const m = matchLive(getPieces(fix.lon, fix.lat), fix, prev);
  let r = null;
  if (m) {
    prev = m.piece;
    r = evaluate(m.piece, index, VEHICLE);
    const moved = last ? metres([last.lon, last.lat], [fix.lon, fix.lat]) : 0;
    const out = stab({ key: `${r.limit.max ?? '—'}|${r.limit.tier}`, max: r.limit.max }, moved);
    if (out.changed) {
      if (!shown) kinds.add(kind(r));
      else if (!kinds.has(kind(r))) { kinds.add(kind(r)); taps.add(s + 7); }
      shown = r;
    }
  }
  last = fix;
  window.push({ t: fix.t, lon: +fix.lon.toFixed(6), lat: +fix.lat.toFixed(6), kmh, shown: shown ? shown.limit.max : null });
  while (window.length && fix.t - window[0].t > 30e3) window.shift();
  if (s % 5 === 0) trace.push(snapshot('trace', fix, kmh, r));
  // A tap needs the car moving: nobody reports a limit from a standstill at the lights.
  if (r && taps.has(s) && kmh > 10) {
    const w = window.map((x) => ({ ...x }));
    const snap = snapshot('report', fix, kmh, r);
    trace.push(snap);
    reports.push({
      ...snap, id: T0 + s * 1000, trip: trip.id, vehicle: VEHICLE,
      facts: { expressway: r.road.expressway, divided: r.road.divided, oneway: r.road.oneway, lanes: r.road.lanes, inside: r.zone.inside },
      window: w, changeAt: lastChange(w),
    });
  } else if (taps.has(s)) taps.add(s + 3);
}
// Keep driving a little after the last tap, then park.
trip.end = trace[trace.length - 1].t;

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify({ trip, trace, reports }));
console.log(`${OUT}: ${reports.length} reports, ${trace.length} trace entries`);
for (const r of reports) console.log(`  ${r.t.slice(11, 19)}  ${r.road}  shown ${r.shown && r.shown.max}  now ${r.now && r.now.max}  ${r.zone && r.zone.reason}`);
