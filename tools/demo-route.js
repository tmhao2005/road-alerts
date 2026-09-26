// Routes for the demo drives that go somewhere, worked out over the tiles and written
// next to them. The app reads site/demo/<key>.json for ?demo=<key>.
//
//   node tools/demo-route.js [site/tiles] [site/demo]
//
// Built next to the tiles rather than committed: it is derived from OSM like they are.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { TILE, evaluate } from '../src/live.js';
import { route } from '../src/route.js';
import { metres } from '../src/geo.js';

// Ends as [lon, lat]. The hospital is where OSM has Bệnh viện Đa khoa Tâm Anh; the Củ Chi
// ends are where Google Maps has the bus station and the Bamboo restaurant on Cây Bài.
// speeding: the drive is also where the speed warning is shown off, so it gets scenes.
const ROUTES = {
  tamanh: { from: [106.6138763, 10.8036915], to: [106.66620, 10.80246] },
  cuchi: { from: [106.4822579, 10.9709819], to: [106.5315771, 11.0064914], speeding: true },
};

const [DIR = 'site/tiles', OUT = 'site/demo'] = process.argv.slice(2);
if (!existsSync(`${DIR}/index.json`)) { console.error(`No tiles in ${DIR}; run npm run site first.`); process.exit(1); }
mkdirSync(OUT, { recursive: true });
const load = (k) => (existsSync(`${DIR}/${k}.json`) ? JSON.parse(readFileSync(`${DIR}/${k}.json`, 'utf8')) : []);
const index = JSON.parse(readFileSync(`${DIR}/index.json`, 'utf8'));

// The limit along a route as stretches of one value: [{ from, to, max, tier }], in metres.
// Worked out for a car; a xe máy's limits differ in value but change in the same places.
function stretches(pieces, r) {
  const at = new Map();
  for (const p of pieces) p.c.forEach((c, k) => { const key = `${c[0]},${c[1]}`; if (!at.has(key)) at.set(key, []); at.get(key).push([p, k]); });
  const edge = (a, b) => (at.get(`${a[0]},${a[1]}`) || []).find(([p, k]) => [p.c[k + 1], p.c[k - 1]].some((c) => c && c[0] === b[0] && c[1] === b[1]));
  const out = [];
  let d = 0;
  for (let i = 1; i < r.length; i++) {
    const len = metres(r[i - 1], r[i]);
    const e = edge(r[i - 1], r[i]);
    const { max, tier } = e ? evaluate(e[0], index, 'oto_con').limit : { max: null, tier: null };
    const last = out[out.length - 1];
    if (last && last.max === max && last.tier === tier) last.to = d + len;
    else out.push({ from: d, to: d + len, max, tier });
    d += len;
  }
  return out;
}

// Where along the drive the pretend driver speeds, so the warning is heard at each of its
// levels. Found in the map rather than written down in metres, because the map is
// rebuilt every week and a sign that moves would leave a fixed scene speeding past nothing.
//
// On the longest stretch with no sign, the driver creeps over the statutory limit and then
// pushes on: the hedged warning, then the firm one. At the biggest drop to a signposted
// limit, the driver misses the sign and brakes late: the firm warning, with the limit said
// again. Further into that sign's stretch, a little over it: the plain warning.
function speedingScenes(runs) {
  const scenes = [], marks = [];
  const law = runs.filter((s) => s.tier === 'theo_luat' && s.to - s.from >= 1500 && s.from > 300)
    .sort((a, b) => (b.to - b.from) - (a.to - a.from))[0];
  if (law) {
    // In the middle, well clear of whatever junction or change of limit began the stretch.
    const at = law.from + (law.to - law.from - 900) / 2;
    scenes.push({ from: at, to: at + 500, over: 7 }, { from: at + 500, to: at + 900, over: 12 });
    marks.push({ at, name: `Quá tốc độ · theo luật ${law.max}` });
  }
  let drop = null;
  runs.forEach((s, i) => {
    const before = runs[i - 1];
    if (!before || s.tier !== 'bien_bao' || before.max == null || s.max == null || s.to - s.from < 600) return;
    if (before.max - s.max >= 20 && (!drop || before.max - s.max > drop.by)) drop = { s, by: before.max - s.max };
  });
  if (drop) {
    const { from, to, max } = drop.s;
    scenes.push({ from, to: from + 200, late: true }, { from: from + 420, to: Math.min(to - 50, from + 650), over: 7 });
    marks.push({ at: from, name: `Không giảm tốc ở biển ${max}` });
  }
  return { scenes, marks };
}

for (const [name, { from, to, speeding }] of Object.entries(ROUTES)) {
  // Every tile in the box around both ends, with a tile to spare for a detour.
  const pieces = [];
  const x0 = Math.floor(Math.min(from[0], to[0]) / TILE) - 1, x1 = Math.floor(Math.max(from[0], to[0]) / TILE) + 1;
  const y0 = Math.floor(Math.min(from[1], to[1]) / TILE) - 1, y1 = Math.floor(Math.max(from[1], to[1]) / TILE) + 1;
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) pieces.push(...load(`${x}_${y}`));
  const r = route(pieces, from, to);
  if (!r) { console.error(`${name}: no route in these tiles`); process.exitCode = 1; continue; }
  let length = 0;
  for (let i = 1; i < r.length; i++) length += metres(r[i - 1], r[i]);
  // Where the route goes over a flyover, marked on the demo's bar to jump to.
  const decks = new Map();
  for (const p of pieces) if (p.bridge && p.h && p.h.some(([, h]) => h >= 4)) for (const c of p.c) decks.set(`${c[0]},${c[1]}`, p.name || 'Cầu vượt');
  const marks = [];
  let d = 0, on = null;
  r.forEach((c, i) => {
    if (i) d += metres(r[i - 1], c);
    const deck = decks.get(`${c[0]},${c[1]}`) || null;
    if (deck && deck !== on) marks.push({ at: Math.round(d), name: deck });
    on = deck;
  });
  let scenes = [];
  if (speeding) {
    const found = speedingScenes(stretches(pieces, r));
    scenes = found.scenes.map((s) => ({ ...s, from: Math.round(s.from), to: Math.round(s.to) }));
    marks.push(...found.marks.map((k) => ({ ...k, at: Math.round(k.at) })));
    marks.sort((a, b) => a.at - b.at);
  }
  writeFileSync(`${OUT}/${name}.json`, JSON.stringify({ route: r, metres: Math.round(length), marks, scenes }));
  console.log(`${name}: ${(length / 1000).toFixed(1)} km, ${r.length} points, ${scenes.length} scenes -> ${OUT}/${name}.json`);
}
