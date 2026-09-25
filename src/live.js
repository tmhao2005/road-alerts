// Live driving logic, kept free of the DOM so it can be tested without a phone.
import { pointSegment, bearing, angleBetween } from './geo.js';
import { roadFacts, roadLabel, PENALTY } from './lookup.js';
import { guessZone } from './zone.js';
import { statutoryLimit, withSign } from './limit.js';
import { travel } from './oneway.js';

export const TILE = 0.02;

export function tilesAround(lon, lat) {
  const tx = Math.floor(lon / TILE), ty = Math.floor(lat / TILE);
  const out = [];
  for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) out.push(`${tx + dx}_${ty + dy}`);
  return out;
}

// fix: { lon, lat, acc, heading, speed (m/s) }; prev: the piece matched last time;
// bike: a xe máy, which may ride both ways on some streets one-way for cars.
//
// A single nearest-road rule fails exactly where it matters: at junctions, where a side
// street is as close as the road you are on, and on divided roads, where the opposite
// carriageway is a few metres away. So a moving car also has to agree with the road's
// direction, and staying on the same road is cheaper than jumping to another.
export function matchLive(pieces, fix, prev, bike = false) {
  const p = [fix.lon, fix.lat];
  const maxDist = Math.max(25, Math.min(fix.acc || 25, 60));
  const moving = fix.heading != null && fix.speed != null && fix.speed > 2;
  let best = null;
  for (const pc of pieces) {
    for (let i = 0; i < pc.c.length - 1; i++) {
      const a = pc.c[i], b = pc.c[i + 1];
      const { dist, t } = pointSegment(p, a, b);
      if (dist > maxDist) continue;
      let score = dist + (PENALTY[pc.highway] || 0);
      let d = 0;
      if (moving) {
        const br = bearing(a, b);
        const way = travel(pc, bike);
        if (way === -1) d = angleBetween((br + 180) % 360, fix.heading);
        else if (way === 1) d = angleBetween(br, fix.heading);
        else d = Math.min(angleBetween(br, fix.heading), angleBetween((br + 180) % 360, fix.heading));
        score += d > 60 ? 40 : d * 0.25;
      }
      // Holding on to the road is for GPS drifting toward a side street, not for a car that
      // has already swung off it: kept through a turn, the screen stays on the old road a
      // whole fix after the car has left it.
      const held = d < 30;
      if (held && prev && prev.id === pc.id) score -= 8;
      else if (held && prev && prev.name && prev.name === pc.name) score -= 5;
      if (!best || score < best.score) best = { piece: pc, seg: i, t, dist, score };
    }
  }
  return best;
}

export function evaluate(piece, index, vehicle) {
  const road = roadFacts(piece);
  const ward = piece.w ? index.wards[piece.w - 1] : null;
  const quarter = piece.q ? index.quarters[piece.q - 1] : null;
  const zone = road.expressway
    ? { inside: false, confidence: 'cao', reason: 'Cao tốc — áp dụng Điều 9' }
    : guessZone({
        highway: road.highway,
        ward: ward ? ward.k : null,
        quarter: quarter ? quarter.k : null,
        inResidential: !!piece.res,
      });
  const limit = withSign(vehicle, statutoryLimit(vehicle, { ...road, inside: zone.inside }), road.sign);
  return {
    road, zone, limit,
    label: roadLabel(piece),
    name: [piece.name, piece.ref].filter(Boolean).join(' · ') || null,
    wardName: ward ? ward.n : null,
    quarterName: quarter ? quarter.n : null,
  };
}

// Junctions, GPS jitter and roads mapped in inconsistent pieces make the limit flicker,
// and a limit spoken then taken back is worse than one spoken late. So a new value must
// hold over some distance before it replaces the shown one - and the distance is
// asymmetric: a LOWER limit is shown almost at once, a HIGHER one only once it has held
// for a while. Being slow to relax is safe; being slow to tighten gets people fined.
//
// value: { key, max } (max null = unknown). metres: distance since the previous fix.
export function makeStabiliser({ down = 40, up = 250 } = {}) {
  let shown = null, pending = null, travelled = 0;
  return function next(value, metres = 0) {
    if (!shown) { shown = value; return { shown, changed: true }; }
    if (value.key === shown.key) { pending = null; travelled = 0; return { shown, changed: false }; }
    if (!pending || pending.key !== value.key) { pending = value; travelled = 0; }
    travelled += metres;
    const tighter = value.max != null && (shown.max == null || value.max < shown.max);
    if (travelled >= (tighter ? down : up)) {
      shown = value; pending = null; travelled = 0;
      return { shown, changed: true };
    }
    return { shown, changed: false };
  };
}
