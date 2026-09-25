// Reduce osmium's GeoJSON export to just what the speed lookup reads: drivable roads,
// residential areas, the ward/commune and khu phố/ấp boundaries, and traffic lights.
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

// A light's direction tag is relative to the way it sits on: forward means it faces
// traffic travelling in the way's drawing order.
function lightSense(p) {
  const d = p['traffic_signals:direction'] || p.direction;
  return d === 'forward' ? 1 : d === 'backward' ? -1 : 0;
}

const roads = [], residential = [], wards = [], quarters = [];
const lights = new Map();
const rl = createInterface({ input: createReadStream(src, 'utf8'), crlfDelay: Infinity });

for await (const raw of rl) {
  const line = raw.replace(/^\x1e/, '').trim();
  if (!line) continue;
  let f;
  try { f = JSON.parse(line); } catch { continue; }
  const p = f.properties || {}, g = f.geometry || {};

  if (g.type === 'Point' && p.highway === 'traffic_signals') {
    const c = round(g.coordinates);
    lights.set(`${c[0]},${c[1]}`, [lightSense(p), p['@id'], p.crossing === 'traffic_signals' ? 1 : 0]);
    continue;
  }

  if (g.type === 'LineString' && DRIVABLE.has(p.highway)) {
    roads.push({
      id: p['@id'], highway: p.highway, name: p.name || null, ref: p.ref || null,
      lanes: p.lanes || null, oneway: p.oneway || null, onewayMoto: p['oneway:motorcycle'] || null, junction: p.junction || null,
      expressway: p.expressway || null,
      maxspeed: p.maxspeed || null, maxF: p['maxspeed:forward'] || null, maxB: p['maxspeed:backward'] || null,
      bridge: p.bridge && p.bridge !== 'no' ? 1 : null, layer: parseInt(p.layer, 10) || null,
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

// Every light is a node of the road it controls, so it lands exactly on a vertex. Stored
// per road as [vertex, sense, node id, crossing]; a light where two roads meet is kept
// on both, and the node id lets the phone say it once.
const placed = new Set();
for (const road of roads) {
  road.c.forEach((c, i) => {
    const l = lights.get(`${c[0]},${c[1]}`);
    if (!l) return;
    (road.sg ||= []).push([i, ...l]);
    placed.add(l[1]);
  });
}

const bbox = bboxArg ? bboxArg.split(',').map(Number) : null;
writeFileSync(out, JSON.stringify({ bbox, roads, residential, wards, quarters }));
console.log(`roads ${roads.length}, residential ${residential.length}, wards ${wards.length}, quarters ${quarters.length}, lights ${placed.size}/${lights.size} on a road -> ${out}`);
