// Cut the TP.HCM index into small tiles a phone can load as it drives.
//
// The expensive part - which ward, khu phố and residential area each stretch of road
// sits in - is done here once, so the phone never touches a polygon. Areas are
// rasterised onto a ~55 m grid, then every road is split wherever those facts change.
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';

const [src = 'data/hcm-index.json', outDir = 'site/tiles'] = process.argv.slice(2);
const data = JSON.parse(readFileSync(src, 'utf8'));
if (!data.bbox) throw new Error('index has no bbox; rebuild it with tools/prep-hcm.sh');

const TILE = 0.02;   // ~2.2 km: a 3x3 block around the car covers ~6 km of road
const CELL = 0.0005; // ~55 m: finer than where any boundary sign could be placed anyway
const [W0, S0, E0, N0] = data.bbox;
const NX = Math.ceil((E0 - W0) / CELL), NY = Math.ceil((N0 - S0) / CELL);

// Scanline fill, even-odd across all rings so holes stay empty. Cost scales with edges
// times rows spanned, not with cells times vertices, which keeps 3,000+ polygons fast.
function rasterise(polys, arr) {
  polys.forEach((poly, idx) => {
    const rows = new Map();
    for (const ring of poly.r) {
      for (let i = 0, k = ring.length - 1; i < ring.length; k = i++) {
        const [x1, y1] = ring[k], [x2, y2] = ring[i];
        if (y1 === y2) continue;
        const lo = Math.min(y1, y2), hi = Math.max(y1, y2);
        const j0 = Math.max(0, Math.ceil((lo - S0) / CELL - 0.5));
        const j1 = Math.min(NY - 1, Math.ceil((hi - S0) / CELL - 0.5) - 1);
        for (let j = j0; j <= j1; j++) {
          const yc = S0 + (j + 0.5) * CELL;
          const x = x1 + ((yc - y1) * (x2 - x1)) / (y2 - y1);
          let xs = rows.get(j);
          if (!xs) rows.set(j, (xs = []));
          xs.push(x);
        }
      }
    }
    for (const [j, xs] of rows) {
      xs.sort((a, b) => a - b);
      for (let m = 0; m + 1 < xs.length; m += 2) {
        const i0 = Math.max(0, Math.ceil((xs[m] - W0) / CELL - 0.5));
        const i1 = Math.min(NX - 1, Math.ceil((xs[m + 1] - W0) / CELL - 0.5) - 1);
        for (let i = i0; i <= i1; i++) arr[j * NX + i] = idx + 1;
      }
    }
  });
}

const wardAt = new Uint16Array(NX * NY);
const quarterAt = new Uint16Array(NX * NY);
const resAt = new Uint16Array(NX * NY);
rasterise(data.wards, wardAt);
rasterise(data.quarters, quarterAt);
rasterise(data.residential, resAt);

// Roads are very often the boundary between two wards, so the cell under a road can land
// on either side and the answer flips every few metres. Look ~110 m around instead and
// take the most urban answer found: stable along a border road, and it errs toward the
// lower limit, which is the side that cannot get a driver fined.
const REACH = 2;
const URBAN = { phuong: 2, xa: 1, khu_pho: 2, ap: 1 };
function factsAt(x, y) {
  const ci = Math.floor((x - W0) / CELL), cj = Math.floor((y - S0) / CELL);
  let w = 0, wRank = 0, q = 0, qRank = 0, res = 0;
  for (let j = cj - REACH; j <= cj + REACH; j++) {
    if (j < 0 || j >= NY) continue;
    for (let i = ci - REACH; i <= ci + REACH; i++) {
      if (i < 0 || i >= NX) continue;
      const c = j * NX + i;
      const wi = wardAt[c];
      if (wi) { const r = URBAN[data.wards[wi - 1].kind] || 0; if (r > wRank) { w = wi; wRank = r; } }
      const qi = quarterAt[c];
      if (qi) { const r = URBAN[data.quarters[qi - 1].kind] || 0; if (r > qRank) { q = qi; qRank = r; } }
      if (resAt[c]) res = 1;
    }
  }
  return { w, q, res };
}

const ATTRS = ['id', 'highway', 'name', 'ref', 'lanes', 'oneway', 'junction', 'expressway', 'maxspeed', 'maxF', 'maxB'];

// Split each road where its ward / khu phố / residential facts change. Consecutive
// pieces share the vertex at the change, so the road stays continuous.
const pieces = [];
for (const road of data.roads) {
  const base = {};
  for (const a of ATTRS) if (road[a] != null) base[a] = road[a];
  let cur = null;
  for (const pt of road.c) {
    const f = factsAt(pt[0], pt[1]);
    const key = `${f.w}|${f.q}|${f.res}`;
    if (!cur || cur.key !== key) {
      if (cur) { cur.c.push(pt); pieces.push(cur); }
      cur = { key, f, c: [pt] };
    } else {
      cur.c.push(pt);
    }
  }
  if (cur && cur.c.length >= 2) pieces.push(cur);
  // Attach attributes after splitting, so every piece carries its own facts.
  for (let k = pieces.length - 1; k >= 0 && !pieces[k].road; k--) {
    const p = pieces[k];
    p.road = base;
  }
}

const tiles = new Map();
for (const p of pieces) {
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const [x, y] of p.c) { if (x < w) w = x; if (x > e) e = x; if (y < s) s = y; if (y > n) n = y; }
  const out = { ...p.road, c: p.c };
  if (p.f.w) out.w = p.f.w;
  if (p.f.q) out.q = p.f.q;
  if (p.f.res) out.res = 1;
  for (let tx = Math.floor(w / TILE); tx <= Math.floor(e / TILE); tx++) {
    for (let ty = Math.floor(s / TILE); ty <= Math.floor(n / TILE); ty++) {
      const k = `${tx}_${ty}`;
      let t = tiles.get(k);
      if (!t) tiles.set(k, (t = []));
      t.push(out);
    }
  }
}

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });
let bytes = 0, largest = 0;
for (const [k, t] of tiles) {
  const json = JSON.stringify(t);
  bytes += json.length;
  largest = Math.max(largest, json.length);
  writeFileSync(`${outDir}/${k}.json`, json);
}
writeFileSync(`${outDir}/index.json`, JSON.stringify({
  tile: TILE,
  bbox: data.bbox,
  built: new Date().toISOString().slice(0, 10),
  wards: data.wards.map((w) => ({ n: w.name, k: w.kind })),
  quarters: data.quarters.map((q) => ({ n: q.name, k: q.kind })),
}));

console.log(`pieces ${pieces.length}, tiles ${tiles.size}, total ${(bytes / 1e6).toFixed(1)} MB, largest tile ${(largest / 1e3).toFixed(0)} KB -> ${outDir}`);
