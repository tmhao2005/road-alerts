// Routes for the demo drives that go somewhere, worked out over the tiles and written
// next to them. The app reads site/demo/<key>.json for ?demo=<key>.
//
//   node tools/demo-route.js [site/tiles] [site/demo]
//
// Built next to the tiles rather than committed: it is derived from OSM like they are.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { TILE } from '../src/live.js';
import { route } from '../src/route.js';
import { metres } from '../src/geo.js';

// Ends as [lon, lat]. The hospital is where OSM has Bệnh viện Đa khoa Tâm Anh.
const ROUTES = {
  tamanh: { from: [106.6138763, 10.8036915], to: [106.66620, 10.80246] },
};

const [DIR = 'site/tiles', OUT = 'site/demo'] = process.argv.slice(2);
if (!existsSync(`${DIR}/index.json`)) { console.error(`No tiles in ${DIR}; run npm run site first.`); process.exit(1); }
mkdirSync(OUT, { recursive: true });
const load = (k) => (existsSync(`${DIR}/${k}.json`) ? JSON.parse(readFileSync(`${DIR}/${k}.json`, 'utf8')) : []);

for (const [name, { from, to }] of Object.entries(ROUTES)) {
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
  writeFileSync(`${OUT}/${name}.json`, JSON.stringify({ route: r, metres: Math.round(length), marks }));
  console.log(`${name}: ${(length / 1000).toFixed(1)} km, ${r.length} points -> ${OUT}/${name}.json`);
}
