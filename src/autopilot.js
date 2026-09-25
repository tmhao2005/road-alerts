// A pretend car for checking the screen at a desk: it drives real roads from the tiles and
// hands out fixes the way a phone does, one a second, with GPS-sized noise. It follows
// the road it is on, keeps straight through junctions, stops at some lights, and turns
// only where the road ends - or, given a route (src/route.js), drives that route to its
// end and parks there. Deterministic for a given seed, so a replay can be compared run to
// run.
import { metres, metresPerDegree, bearing, angleBetween } from './geo.js';
import { allowed } from './path.js';
import { matchLive } from './live.js';

const RANK = { motorway: 7, trunk: 6, primary: 5, secondary: 4, tertiary: 3, unclassified: 2, residential: 1 };
// A route goes down lanes a wandering demo never takes, and nobody does 40 in those. km/h.
const LANE = { tertiary: 40, unclassified: 30, residential: 25, living_street: 15, service: 15 };
const same = (a, b) => a[0] === b[0] && a[1] === b[1];

function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

// getPieces(lon, lat): the road pieces around a point.
// start: [lon, lat]; heading: compass degrees to set off in; kmh: cruising speed.
// route: [[lon, lat], ...] of road vertices to follow instead; start and heading follow.
export function makeAutopilot({ getPieces, start, heading, kmh = 50, noise = 3, seed = 7, stopShare = 0.5, wait = 8, route = null }) {
  const random = rng(seed);
  const gauss = () => Math.sqrt(-2 * Math.log(random() || 1e-9)) * Math.cos(2 * Math.PI * random());
  const cruise = kmh / 3.6;
  // Phone GPS error drifts rather than jumping independently each second, so the error
  // here is a slow random walk around the true position.
  const err = { x: 0, y: 0 };
  const drift = () => {
    const k = 0.85, j = Math.sqrt(1 - k * k) * noise;
    err.x = err.x * k + gauss() * j; err.y = err.y * k + gauss() * j;
  };

  // The piece and direction that take the car from vertex `at` to vertex `to`.
  function onto(at, to) {
    for (const pc of getPieces(at[0], at[1])) {
      for (let k = 0; k < pc.c.length; k++) {
        if (!same(pc.c[k], at)) continue;
        for (const s of [1, -1]) if (pc.c[k + s] && same(pc.c[k + s], to) && allowed(pc, s)) return { piece: pc, k, s };
      }
    }
    return null;
  }

  let piece, sense, i, done;
  // On a route: the vertex the car last passed, and how far there is still to go.
  let passed = 0;
  const left = [];
  if (route) {
    const o = route.length > 1 && onto(route[0], route[1]);
    if (!o) return null;
    ({ piece, s: sense, k: i } = o);
    done = 0;
    left[route.length - 1] = 0;
    for (let n = route.length - 2; n >= 0; n--) left[n] = left[n + 1] + metres(route[n], route[n + 1]);
  } else {
    const m0 = matchLive(getPieces(start[0], start[1]), { lon: start[0], lat: start[1], acc: 30, heading, speed: 10 }, null);
    if (!m0) return null;
    piece = m0.piece;
    sense = angleBetween(bearing(piece.c[m0.seg], piece.c[m0.seg + 1]), heading) <= 90 ? 1 : -1;
    if (!allowed(piece, sense)) sense = -sense;
    // Heading along the edge from vertex i to i + sense, `done` metres in.
    i = sense === 1 ? m0.seg : m0.seg + 1;
    done = metres(piece.c[i], [start[0], start[1]]);
  }
  let v = 0;
  let waitUntil = 0, clock = 0, parked = false; // parked: a one-way road that just ends
  const decided = new Map(); // light id -> stops there or not

  const edge = () => [piece.c[i], piece.c[i + sense]];

  // At the last vertex of a piece: carry on along the same way or name if there is one,
  // otherwise take the straightest bigger road, otherwise turn round.
  function nextPiece(at, inBearing) {
    let best = null;
    for (const pc of getPieces(at[0], at[1])) {
      if (pc === piece) continue;
      for (let k = 0; k < pc.c.length; k++) {
        if (pc.c[k][0] !== at[0] || pc.c[k][1] !== at[1]) continue;
        for (const s of [1, -1]) {
          const j = k + s;
          if (j < 0 || j >= pc.c.length || !allowed(pc, s)) continue;
          const turn = angleBetween(inBearing, bearing(pc.c[k], pc.c[j]));
          if (turn > 100) continue;
          const same = pc.id === piece.id ? 3 : pc.name && pc.name === piece.name ? 2 : 0;
          const score = same * 100 + (RANK[pc.highway] || 0) * 8 - turn;
          if (!best || score > best.score) best = { pc, k, s, score };
        }
      }
    }
    return best;
  }

  function advance(dist) {
    while (dist > 0) {
      const [a, b] = edge();
      const len = metres(a, b);
      if (done + dist < len) { done += dist; return; }
      dist -= len - done;
      i += sense;
      done = 0;
      if (route) {
        passed++;
        const next = route[passed + 1];
        if (!next) { i -= sense; done = len; parked = true; return; }
        if (piece.c[i + sense] && same(piece.c[i + sense], next)) continue;
        const o = onto(piece.c[i], next);
        if (o) { piece = o.piece; i = o.k; sense = o.s; continue; }
        i -= sense; done = len; parked = true; return;
      }
      if (i + sense < 0 || i + sense >= piece.c.length) {
        const n = nextPiece(piece.c[i], bearing(a, b));
        if (n) { piece = n.pc; i = n.k; sense = n.s; }
        else if (allowed(piece, -sense)) sense = -sense;
        else { i -= sense; done = metres(piece.c[i], piece.c[i + sense]); parked = true; return; }
      }
    }
  }

  // The first light ahead on this piece, if the car should stop for it.
  function stopAhead() {
    let d = metres(piece.c[i], piece.c[i + sense]) - done;
    for (let k = i + sense, n = passed + 1; k >= 0 && k < piece.c.length; k += sense, n++) {
      // A light on a road the route turns off before reaching is not the car's to stop at.
      if (route && !(route[n] && same(piece.c[k], route[n]))) return null;
      for (const [vtx, facing, id] of piece.sg || []) {
        if (vtx !== k || (facing !== 0 && facing !== sense)) continue;
        if (!decided.has(id)) decided.set(id, random() < stopShare);
        if (decided.get(id)) return { id, d };
      }
      if (k + sense >= 0 && k + sense < piece.c.length) d += metres(piece.c[k], piece.c[k + sense]);
      if (d > 120) return null;
    }
    return null;
  }

  function position() {
    const [a, b] = edge();
    const len = metres(a, b) || 1;
    const f = done / len;
    return { at: [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f], heading: bearing(a, b) };
  }

  // Advance by dt seconds and return a fix, shaped like the phone's.
  return function step(dt = 1) {
    const substeps = Math.max(1, Math.round(dt / 0.1));
    for (let n = 0; n < substeps; n++) {
      const h = dt / substeps;
      clock += h;
      const light = clock < waitUntil ? null : stopAhead();
      if (parked || clock < waitUntil) v = 0;
      else if (light && light.d < 45) {
        // Brake to stand just short of the stop line, then wait there.
        const target = Math.max(0, light.d - 4);
        v = Math.min(v, Math.sqrt(2 * 2.2 * target));
        if (target < 0.5 || v < 0.3) { v = 0; waitUntil = clock + wait; decided.set(light.id, false); }
      } else if (route) {
        // Easing down into a lane or up out of it, and braking to a stop at the end.
        const cap = Math.min(cruise, (LANE[(piece.highway || '').replace('_link', '')] || Infinity) / 3.6, Math.sqrt(2 * 2.2 * (left[passed] - done)));
        v = v > cap ? Math.max(cap, v - 2.5 * h) : Math.min(cap, v + 1.6 * h);
      } else v = Math.min(cruise, v + 1.6 * h);
      advance(v * h);
    }
    const { at, heading: hd } = position();
    const k = metresPerDegree(at[1]);
    drift();
    return {
      lon: at[0] + err.x / k.x,
      lat: at[1] + err.y / k.y,
      acc: Math.round(4 + Math.abs(gauss()) * noise),
      heading: v > 0.5 ? (hd + gauss() * 3 + 360) % 360 : null,
      speed: Math.max(0, v + gauss() * 0.3),
    };
  };
}
