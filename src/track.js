// Which road the car is on, remembering how it got there - on trial against matchLive.
//
// matchLive takes the best road for each fix on its own, with a bonus for the road it was
// on last time. Where a flyover runs over the road it crosses, that is not enough: the two
// are metres apart, a GPS fix that drifts a few metres lands nearer the one below, and the
// road below often carries the same name, so it wins the bonus too. Then the app warns
// about a light the car is flying over.
//
// Here every road near the car keeps a running cost: how badly each fix fits it, plus what
// it would have cost to get onto it from wherever the car might have been at the last fix.
// Carrying on along a road is free, turning onto one it connects to is cheap, and jumping
// between levels where they do not meet - off a deck onto the road under it - costs so much
// that a run of fixes has to point there before the car is moved. The costs fade, so an old
// mistake does not hold the car on the wrong road for ever.
//
// Pure apart from geo.js, lookup.js and oneway.js.
import { pointSegment, bearing, angleBetween, metres } from './geo.js';
import { PENALTY } from './lookup.js';
import { travel } from './oneway.js';

const FADE = 0.95;    // how much of the last fix's cost carries into this one
const SAME = 3;       // onto a road of the same name, or up or down a ramp that meets it
const TURN = 8;       // onto another road it connects to
const LEAP = 80;      // between levels where they do not meet: off a deck, onto the road under it
const KEEP = 250;     // roads costing this much more than the best are forgotten

const level = (pc) => pc.layer || 0;
const vkey = (c) => c[0] + ',' + c[1];
// A way is cut into pieces where its ward changes, and a piece on a tile edge is in both
// tiles: the same piece twice is still one road.
const pk = (pc) => pc.id + '|' + vkey(pc.c[0]);

// Every piece reachable by road within budget metres of where the car would be on q.
function reachFrom(q, at, near, budget) {
  const seg = (pc, i) => metres(pc.c[i], pc.c[i + 1]);
  const cost = new Map(), open = [];
  const push = (c, d) => { const k = vkey(c); if (d <= budget && d < (cost.get(k) ?? Infinity)) { cost.set(k, d); open.push([k, d]); } };
  push(q.c[at.seg], seg(q, at.seg) * at.t);
  push(q.c[at.seg + 1], seg(q, at.seg) * (1 - at.t));
  const out = new Set([pk(q)]);
  while (open.length) {
    let j = 0;
    for (let n = 1; n < open.length; n++) if (open[n][1] < open[j][1]) j = n;
    const [k, d] = open.splice(j, 1)[0];
    if (d > cost.get(k)) continue;
    for (const [pc, i] of near.get(k) || []) {
      out.add(pk(pc));
      if (i > 0) push(pc.c[i - 1], d + seg(pc, i - 1));
      if (i + 1 < pc.c.length) push(pc.c[i + 1], d + seg(pc, i));
    }
  }
  return out;
}

// memory: what the last call returned as .memory, or null to start afresh.
// Returns what matchLive does - { piece, seg, t, dist, score } - plus the memory to pass
// back with the next fix, or null with no road near.
export function matchTrack(pieces, fix, memory = null, bike = false) {
  const p = [fix.lon, fix.lat];
  const maxDist = Math.max(25, Math.min(fix.acc || 25, 60));
  const moving = fix.heading != null && fix.speed != null && fix.speed > 2;
  // How far the car can have gone since the last fix, with room for a late one.
  const budget = 30 + 1.5 * (fix.speed || 7);
  // Each piece nearby at its best segment: how far, which way, and how badly it fits.
  const info = new Map(), near = new Map();
  for (const pc of pieces) {
    let best = null;
    for (let i = 0; i < pc.c.length - 1; i++) {
      const a = pc.c[i], b = pc.c[i + 1];
      const { dist, t } = pointSegment(p, a, b);
      if (dist > maxDist + budget) continue;
      let d = 0, e = dist + (PENALTY[pc.highway] || 0);
      if (moving) {
        const br = bearing(a, b);
        const way = travel(pc, bike);
        if (way === -1) d = angleBetween((br + 180) % 360, fix.heading);
        else if (way === 1) d = angleBetween(br, fix.heading);
        else d = Math.min(angleBetween(br, fix.heading), angleBetween((br + 180) % 360, fix.heading));
        e += d > 60 ? 40 : d * 0.25;
      }
      if (!best || e < best.e) best = { piece: pc, seg: i, t, dist, d, e };
    }
    if (!best) continue;
    pc.c.forEach((c, i) => { const k = vkey(c); if (!near.has(k)) near.set(k, []); near.get(k).push([pc, i]); });
    info.set(pk(pc), best);
  }
  const was = memory || [];
  const reach = new Map();
  const reachable = (q, pc) => {
    let r = reach.get(pk(q));
    if (!r) { const at = info.get(pk(q)); r = at ? reachFrom(q, at, near, budget) : new Set([pk(q)]); reach.set(pk(q), r); }
    return r.has(pk(pc));
  };
  // What it costs to have gone from q at the last fix to pc now.
  function step(q, pc) {
    if (q.id === pc.id) return 0;
    const qi = info.get(pk(q));
    // Already pointing well away from q: the car has left it, and where to is free.
    const swung = qi && moving && qi.d >= 30;
    if (reachable(q, pc)) {
      if (swung) return 0;
      return (q.name && q.name === pc.name) || level(q) !== level(pc) ? SAME : TURN;
    }
    if (level(q) !== level(pc)) return LEAP;
    return q.name && q.name === pc.name ? SAME : TURN;
  }
  let best = null;
  const next = [];
  for (const c of info.values()) {
    if (c.dist > maxDist) continue;
    let from = was.length ? Infinity : 0;
    for (const w of was) from = Math.min(from, FADE * w.cost + step(w.piece, c.piece));
    const cost = c.e + from;
    next.push({ piece: c.piece, cost });
    if (!best || cost < best.score) best = { piece: c.piece, seg: c.seg, t: c.t, dist: c.dist, score: cost };
  }
  if (!best) return null;
  best.memory = next.map((n) => ({ piece: n.piece, cost: n.cost - best.score })).filter((n) => n.cost < KEEP);
  return best;
}
