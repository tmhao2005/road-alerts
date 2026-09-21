// Reduce osmium's GeoJSON export to just what the speed lookup reads: drivable roads,
// residential areas, and the ward/commune and khu phố/ấp boundaries.
import { createReadStream, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { bboxOf } from '../src/geo.js';

const [src, out, bboxArg] = process.argv.slice(2);
if (!src || !out) {
  console.error('usage: node tools/build-index.js <in.geojsonseq> <out.json> [w,s,e,n]');
  process.exit(1);
}

const DRIVABLE = new Set([
  'motorway', 'motorway_link', 'trunk', 'trunk_link', 'primary', 'primary_link',
  'secondary', 'secondary_link', 'tertiary', 'tertiary_link', 'unclassified',
  'residential', 'living_street', 'service', 'road',
]);

// Six decimals is ~0.1 m - finer than any phone GPS, and it halves the file.
const round = (c) => [Math.round(c[0] * 1e6) / 1e6, Math.round(c[1] * 1e6) / 1e6];

// Admin names carry the urban/rural split the law's wording depends on:
// "Phường"/"Khu phố" are urban units, "Xã"/"Ấp" rural ones.
function adminKind(level, name) {
  if (!name) return null;
  if (level === '6') return name.startsWith('Phường') ? 'phuong' : name.startsWith('Xã') ? 'xa' : null;
  if (level === '9') return name.startsWith('Khu phố') ? 'khu_pho' : name.startsWith('Ấp') ? 'ap' : null;
  return null;
}

function ringsOf(geom) {
  if (geom.type === 'Polygon') return geom.coordinates.map((r) => r.map(round));
  if (geom.type === 'MultiPolygon') return geom.coordinates.flat().map((r) => r.map(round));
  return null;
}

const roads = [], residential = [], wards = [], quarters = [];
const rl = createInterface({ input: createReadStream(src, 'utf8'), crlfDelay: Infinity });

for await (const raw of rl) {
  const line = raw.replace(/^\x1e/, '').trim();
  if (!line) continue;
  let f;
  try { f = JSON.parse(line); } catch { continue; }
  const p = f.properties || {}, g = f.geometry || {};

  if (g.type === 'LineString' && DRIVABLE.has(p.highway)) {
    roads.push({
      id: p['@id'], highway: p.highway, name: p.name || null, ref: p.ref || null,
      lanes: p.lanes || null, oneway: p.oneway || null, junction: p.junction || null,
      expressway: p.expressway || null,
      maxspeed: p.maxspeed || null, maxF: p['maxspeed:forward'] || null, maxB: p['maxspeed:backward'] || null,
      c: g.coordinates.map(round),
    });
    continue;
  }

  const rings = ringsOf(g);
  if (!rings) continue;
  // A multipolygon's parts can be far apart, so the box must cover every ring.
  const b = bboxOf(rings.flat());
  if (p.landuse === 'residential') {
    residential.push({ b, r: rings });
  } else if (p.boundary === 'administrative') {
    const kind = adminKind(p.admin_level, p.name);
    if (kind === 'phuong' || kind === 'xa') wards.push({ name: p.name, kind, b, r: rings });
    else if (kind) quarters.push({ name: p.name, kind, b, r: rings });
  }
}

const bbox = bboxArg ? bboxArg.split(',').map(Number) : null;
writeFileSync(out, JSON.stringify({ bbox, roads, residential, wards, quarters }));
console.log(`roads ${roads.length}, residential ${residential.length}, wards ${wards.length}, quarters ${quarters.length} -> ${out}`);
