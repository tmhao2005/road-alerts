// Drive a road virtually through the same tiles and logic the phone uses, printing
// every point where the displayed limit would change and every traffic light it would
// announce. A preview of a test route.
//
//   node tools/sim.js QL.13            (south to north)
//   node tools/sim.js QL.1 --south     (north to south)
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { tilesAround, matchLive, evaluate, makeStabiliser } from '../src/live.js';
import { lightsAhead, reachFor, makeLightWatcher, lightPhrase } from '../src/lights.js';
import { metresPerDegree } from '../src/geo.js';

const DIR = 'site/tiles';
const args = process.argv.slice(2);
const ref = args.find((a) => !a.startsWith('--'));
const vehicle = args.includes('--xe') ? args[args.indexOf('--xe') + 1] : 'oto_con';
if (!ref) { console.error('usage: node tools/sim.js <ref, e.g. QL.13> [--south] [--xe oto_con]'); process.exit(1); }
if (!existsSync(`${DIR}/index.json`)) { console.error('Build tiles first: npm run site'); process.exit(1); }

const index = JSON.parse(readFileSync(`${DIR}/index.json`, 'utf8'));
const cache = new Map();
const load = (k) => {
  if (!cache.has(k)) cache.set(k, existsSync(`${DIR}/${k}.json`) ? JSON.parse(readFileSync(`${DIR}/${k}.json`, 'utf8')) : []);
  return cache.get(k);
};

// Collect the route's vertices from every tile and order them along its main axis.
// Crude, but these quốc lộ run mostly north-south out of the city.
const norm = (s) => (s || '').toUpperCase().replace(/[\s.]/g, '');
const want = norm(ref);
const pts = new Map();
{
  for (const file of readdirSync(DIR)) {
    if (file === 'index.json') continue;
    for (const pc of load(file.replace('.json', ''))) {
      if (!(norm(pc.ref).split(';').includes(want) || norm(pc.ref) === want)) continue;
      // On a divided road keep only the carriageway going our way; mixing both makes the
      // simulated car zig-zag across the median and match side streets.
      const oneway = ['yes', '1', 'true', '-1'].includes(pc.oneway);
      if (oneway) {
        let north = pc.c[pc.c.length - 1][1] > pc.c[0][1];
        if (pc.oneway === '-1') north = !north;
        if (north === args.includes('--south')) continue;
      }
      for (const c of pc.c) pts.set(`${c[0]},${c[1]}`, c);
    }
  }
  let route = [...pts.values()].sort((a, b) => a[1] - b[1]);
  if (args.includes('--south')) route.reverse();
  if (route.length < 2) { console.error(`No road with ref ${ref} in the tiles.`); process.exit(1); }

  // Resample to one fix every ~25 m, the spacing of a phone GPS at ~90 km/h.
  const fixes = [];
  for (let i = 0; i < route.length - 1; i++) {
    const a = route[i], b = route[i + 1];
    const m = metresPerDegree(a[1]);
    const dx = (b[0] - a[0]) * m.x, dy = (b[1] - a[1]) * m.y;
    const len = Math.hypot(dx, dy);
    if (len > 400) continue; // a jump between parallel carriageways, not a road
    const heading = ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360;
    for (let t = 0; t < len; t += 25) {
      fixes.push({ lon: a[0] + ((b[0] - a[0]) * t) / len, lat: a[1] + ((b[1] - a[1]) * t) / len, acc: 8, heading, speed: 20 });
    }
  }

  const stable = makeStabiliser();
  const watch = makeLightWatcher();
  let prev = null, km = 0, last = null, changes = 0, lights = 0;
  for (const fix of fixes) {
    let step = 0;
    if (last) {
      const m = metresPerDegree(fix.lat);
      step = Math.hypot((fix.lon - last.lon) * m.x, (fix.lat - last.lat) * m.y);
      // A gap this big is the crude route jumping between pieces, not driving.
      if (step > 400) step = 0;
      km += step / 1000;
    }
    last = fix;
    const pieces = tilesAround(fix.lon, fix.lat).flatMap(load);
    const m = matchLive(pieces, fix, prev);
    if (!m) continue;
    prev = m.piece;
    const r = evaluate(m.piece, index, vehicle);
    const s = stable({ key: `${r.limit.max ?? '—'} ${r.limit.tier}`, max: r.limit.max }, step);
    if (s.changed) {
      changes++;
      const val = r.limit.max ?? '—';
      console.log(`km ${km.toFixed(1).padStart(5)}  ${String(val).padStart(3)}  ${r.limit.tier.padEnd(9)} ${(r.name || r.label).slice(0, 28).padEnd(28)} ${r.wardName || ''} — ${r.zone.reason}`);
    }
    const { speak } = watch(lightsAhead(pieces, m, fix, reachFor(fix.speed)));
    if (speak) {
      lights++;
      console.log(`km ${km.toFixed(1).padStart(5)}  ${lightPhrase(speak)}, còn ${Math.round(speak.dist)} m (node ${speak.id})`);
    }
  }
  console.log(`\n${km.toFixed(1)} km simulated, ${changes} limit announcements, ${lights} traffic lights`);
}
