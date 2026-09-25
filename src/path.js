// The road ahead of the car, as far as it obviously goes. Lights, the drawn road view and
// the upcoming limits all read the same walk, so they can never disagree about which road
// the car is about to be on. Kept free of the DOM so it can be tested without a phone.
import { metres, bearing, angleBetween } from './geo.js';
import { travel } from './oneway.js';

export const same = (a, b) => a[0] === b[0] && a[1] === b[1];

// Which way the car travels along a piece: 1 with its vertex order, -1 against it.
export function senseOn(piece, seg, heading) {
  return angleBetween(bearing(piece.c[seg], piece.c[seg + 1]), heading) <= 90 ? 1 : -1;
}

// bike: a xe máy, which may ride both ways on some streets one-way for cars.
export function allowed(piece, sense, bike = false) {
  const way = travel(piece, bike);
  return way === 0 || way === sense;
}

// The piece the road carries on into at a vertex. Roads are split into pieces wherever
// the ward changes and OSM splits ways at most junctions, so this is needed constantly.
// It continues along the same way, or the same named road going roughly straight. A road
// that only changes name - a bridge, most often - is followed too, but only when it is
// the one way on from that vertex; anything else is a turn the car may or may not take.
export function continuation(pieces, from, end, inBearing, bike = false) {
  let best = null, ways = 0, sole = null;
  for (const pc of pieces) {
    if (pc === from || pc.c.length < 2) continue;
    const n = pc.c.length;
    for (let k = 0; k < n; k++) {
      if (!same(pc.c[k], end)) continue;
      for (const sense of [1, -1]) {
        const j = k + sense;
        if (j < 0 || j >= n || !allowed(pc, sense, bike)) continue;
        ways++;
        const turn = angleBetween(inBearing, bearing(pc.c[k], pc.c[j]));
        if (turn > 45 || (k !== 0 && k !== n - 1)) continue;
        const rank = pc.id === from.id ? 0 : (pc.name && pc.name === from.name) || (pc.ref && pc.ref === from.ref) ? 1 : 2;
        const cand = { piece: pc, sense, rank, turn };
        if (rank === 2) { sole = turn <= 20 ? cand : null; continue; }
        if (!best || rank < best.rank || (rank === best.rank && turn < best.turn)) best = cand;
      }
    }
  }
  return best || (ways === 1 ? sole : null);
}

// Walk forward from `from` (a [lon, lat] on the matched segment) for up to `reach` metres.
//
//   pts, dist  the polyline ahead and the distance to each of its points
//   legs       [{ piece, sense, start, end }], the pieces in order with where each begins
//   lights     signals facing the car, nearest first: { id, crossing, dist, at }
//   open       true if the road still goes on at the end, false if the walk stopped at a
//              junction it could not see through or at the end of the road
//   back       the vertex of the matched segment behind the car
// bike: a xe máy, for streets that are one-way for cars only.
export function walkAhead(pieces, match, heading, reach, from, bike = false) {
  let piece = match.piece;
  let sense = senseOn(piece, match.seg, heading);
  // The vertex just passed, for anything that needs to know what is behind the car.
  const back = piece.c[sense === 1 ? match.seg : match.seg + 1];
  let i = sense === 1 ? match.seg + 1 : match.seg;
  let at = from;
  let d = 0;
  const pts = [from], dist = [0], legs = [], lights = [];
  const visited = new Set([piece]);
  let leg = { piece, sense, start: 0, end: 0 };
  legs.push(leg);
  for (;;) {
    let prevPt = null;
    for (; i >= 0 && i < piece.c.length; i += sense) {
      const next = piece.c[i];
      const step = metres(at, next);
      if (d + step > reach) {
        const f = step > 0 ? (reach - d) / step : 0;
        pts.push([at[0] + (next[0] - at[0]) * f, at[1] + (next[1] - at[1]) * f]);
        dist.push(reach);
        leg.end = reach;
        return { pts, dist, legs, lights, open: true, back };
      }
      d += step;
      prevPt = at;
      at = next;
      if (step > 0) { pts.push(at); dist.push(d); }
      for (const [v, facing, id, crossing] of piece.sg || []) {
        if (v === i && (facing === 0 || facing === sense) && !lights.some((l) => l.id === id)) {
          lights.push({ id, crossing: !!crossing, dist: d, at });
        }
      }
    }
    leg.end = d;
    const next = continuation(pieces, piece, at, bearing(prevPt || at, at), bike);
    if (!next || visited.has(next.piece)) return { pts, dist, legs, lights, open: false, back };
    visited.add(next.piece);
    piece = next.piece;
    sense = next.sense;
    leg = { piece, sense, start: d, end: d };
    legs.push(leg);
    // The shared vertex was already walked on the previous piece.
    i = sense === 1 ? 1 : piece.c.length - 2;
  }
}

// Vertices where three or more road ends meet: the places a car can leave the road it is
// on. A split where only the ward changes joins two ends and is not one. Pass one tile's
// pieces: every road touching a vertex is in the tile holding it, and a piece crossing a
// tile edge is repeated in both tiles, so pooling tiles would count it twice.
export function junctions(pieces) {
  const ends = new Map();
  for (const pc of pieces) {
    const n = pc.c.length;
    pc.c.forEach(([lon, lat], i) => {
      const k = `${lon},${lat}`;
      ends.set(k, (ends.get(k) || 0) + (i > 0) + (i < n - 1));
    });
  }
  const out = new Set();
  for (const [k, e] of ends) if (e >= 3) out.add(k);
  return out;
}

// How far along a walk the car on screen may be carried between fixes. Carried at its last
// speed through a junction it is turning at, it overshoots down the old road and has to be
// brought back across the corner when the next fix lands on the new one. So once the phone
// says the car is swinging off the road, the guess stops at the junction and the turn
// starts from the corner - or, already in the junction, the car is taken no further down
// the old road at all.
//
// Only a swing that is growing counts. Driving straight, the guess carries on through:
// stopping at every junction would make the car stutter along any city street. And coming
// out of a bend the phone's heading lags the road it is already on, which looks the same
// as leaving it except that the gap is closing.
// isJunction([lon, lat]) -> boolean; heading, was: the phone's direction of travel at this
// fix and the one before.
export function holdAt(walk, isJunction, heading, was = null, { swing = 15, near = 12 } = {}) {
  if (heading == null || walk.pts.length < 2) return Infinity;
  const road = bearing(walk.pts[0], walk.pts[1]);
  const off = angleBetween(road, heading);
  if (off < swing || (was != null && off <= angleBetween(road, was))) return Infinity;
  if (walk.back && isJunction(walk.back) && metres(walk.back, walk.pts[0]) < near) return 0;
  for (let i = 1; i < walk.pts.length; i++) if (isJunction(walk.pts[i])) return walk.dist[i];
  return Infinity;
}

// The point on a match's segment nearest the fix: where the car is drawn, and where the
// walk for the view starts, so the car sits on the road rather than beside it.
export function snapped(match) {
  const a = match.piece.c[match.seg], b = match.piece.c[match.seg + 1];
  return [a[0] + (b[0] - a[0]) * match.t, a[1] + (b[1] - a[1]) * match.t];
}

// The point `d` metres along a walk, and the direction of travel there.
export function pointAt(walk, d) {
  const { pts, dist } = walk;
  if (pts.length === 1 || d <= 0) return { at: pts[0], bearing: pts.length > 1 ? bearing(pts[0], pts[1]) : null };
  for (let i = 1; i < pts.length; i++) {
    if (dist[i] >= d || i === pts.length - 1) {
      const span = dist[i] - dist[i - 1];
      const f = span > 0 ? Math.min(1, (d - dist[i - 1]) / span) : 0;
      const a = pts[i - 1], b = pts[i];
      return { at: [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f], bearing: bearing(a, b) };
    }
  }
}
