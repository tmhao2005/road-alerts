// Traffic lights ahead on the road being driven, and when to mention one. Kept free of the
// DOM so it can be tested without a phone.
//
// Warning about a light is correct whether or not a camera watches it, which is why this
// needs no camera data. The cost of getting it wrong is asymmetric the other way from
// speed limits: a missed light is silence, but a light announced on a road the driver is
// not taking trains them to ignore the voice. So the walk ahead only follows the road
// the car is on, and stops at any junction where that road is not obvious.
import { metres, bearing, angleBetween } from './geo.js';

const ONEWAY = new Set(['yes', '1', 'true']);
const MOVING = 2; // m/s; below this the heading is noise, and a car stopped at a light needs no warning

const same = (a, b) => a[0] === b[0] && a[1] === b[1];

// Which way the car travels along a piece: 1 with its vertex order, -1 against it.
function senseOn(piece, seg, heading) {
  return angleBetween(bearing(piece.c[seg], piece.c[seg + 1]), heading) <= 90 ? 1 : -1;
}

function allowed(piece, sense) {
  if (piece.oneway === '-1') return sense === -1;
  if (ONEWAY.has(piece.oneway) || piece.junction === 'roundabout' || /^motorway/.test(piece.highway)) return sense === 1;
  return true;
}

// The piece the road carries on into at a vertex. Roads are split into pieces wherever
// the ward changes and OSM splits ways at most junctions, so this is needed constantly.
// It only continues along the same way, or the same named road going roughly straight;
// anything else is a turn the car may or may not take.
function continuation(pieces, from, end, inBearing) {
  let best = null;
  for (const pc of pieces) {
    if (pc === from || pc.c.length < 2) continue;
    let sense;
    if (same(pc.c[0], end)) sense = 1;
    else if (same(pc.c[pc.c.length - 1], end)) sense = -1;
    else continue;
    if (!allowed(pc, sense)) continue;
    const n = pc.c.length;
    const out = sense === 1 ? bearing(pc.c[0], pc.c[1]) : bearing(pc.c[n - 1], pc.c[n - 2]);
    const turn = angleBetween(inBearing, out);
    if (turn > 45) continue;
    const rank = pc.id === from.id ? 0 : (pc.name && pc.name === from.name) || (pc.ref && pc.ref === from.ref) ? 1 : 2;
    if (rank === 2) continue;
    if (!best || rank < best.rank || (rank === best.rank && turn < best.turn)) best = { piece: pc, sense, rank, turn };
  }
  return best;
}

// Lights facing the car within `reach` metres ahead, nearest first.
// match: matchLive's result ({ piece, seg }); fix: { lon, lat, heading, speed }.
export function lightsAhead(pieces, match, fix, reach) {
  if (!match || fix.heading == null || !(fix.speed >= MOVING)) return [];
  let piece = match.piece;
  let sense = senseOn(piece, match.seg, fix.heading);
  let i = sense === 1 ? match.seg + 1 : match.seg;
  let at = [fix.lon, fix.lat];
  let d = 0;
  const out = [];
  const visited = new Set([piece]);
  for (;;) {
    let prevPt = null;
    for (; i >= 0 && i < piece.c.length; i += sense) {
      d += metres(at, piece.c[i]);
      prevPt = at;
      at = piece.c[i];
      if (d > reach) return out;
      for (const [v, facing, id, crossing] of piece.sg || []) {
        if (v === i && (facing === 0 || facing === sense) && !out.some((l) => l.id === id)) {
          out.push({ id, crossing: !!crossing, dist: d, at });
        }
      }
    }
    const next = continuation(pieces, piece, at, bearing(prevPt || at, at));
    if (!next || visited.has(next.piece)) return out;
    visited.add(next.piece);
    piece = next.piece;
    sense = next.sense;
    // The shared vertex was already walked on the previous piece.
    i = sense === 1 ? 1 : piece.c.length - 2;
  }
}

// How far ahead to look: about eight seconds of driving, so the warning arrives with time
// to ease off, but never so far that it names a light two junctions away in the city.
export function reachFor(speed, { seconds = 8, min = 80, max = 300 } = {}) {
  return Math.max(min, Math.min(max, (speed || 0) * seconds));
}

// Decides which light to speak, once. Two things make a naive "nearest light" repeat
// itself: a light where two roads meet is stored on both, and one junction is often
// mapped as several signal nodes a few metres apart (one per approach, or one per
// carriageway). So each node is spoken at most once, and nothing is spoken within
// `cluster` metres of the light last spoken.
export function makeLightWatcher({ cluster = 60, tooClose = 20 } = {}) {
  const said = new Set();
  let lastAt = null;
  return function next(ahead) {
    const light = ahead[0] || null;
    if (!light || said.has(light.id)) return { next: light, speak: null };
    said.add(light.id);
    if (said.size > 500) said.clear();
    // Already at the stop line: saying "ahead" now is noise.
    if (light.dist < tooClose) return { next: light, speak: null };
    if (lastAt && metres(lastAt, light.at) < cluster) return { next: light, speak: null };
    lastAt = light.at;
    return { next: light, speak: light };
  };
}

export function lightPhrase(light) {
  return light.crossing ? 'Đèn qua đường phía trước' : 'Đèn giao thông phía trước';
}
