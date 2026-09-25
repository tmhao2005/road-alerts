// How high a road stands: flyover decks, and the ramps up to them.
//
// OSM marks a flyover as bridge=yes on a layer, never with a height, and maps its ramps as
// plain road. Nothing needs either to the metre - the road view draws a deck over the road
// it crosses, and only needs to know which bridges those are - so the heights here are
// inferred:
//
//   - A bridge that crosses a road is a deck, DECK metres up. One over water crosses no road
//     and stays flat; there are thousands of those over the city's kênh and rạch.
//   - A deck climbs to that height at GRADE from the nearest junction at either end, which
//     is where its lanes part from the ones staying on the ground. That junction may be out
//     along the road it continues, or right at its end, in which case the deck itself is
//     the ramp.
//
// Heights are breakpoints along each piece: [[s, h], ...], s in metres from its first
// vertex, h in metres, linear between them and 0 outside them.
//
// Pure apart from geo.js.
import { metres } from './geo.js';

export const DECK = 6;       // a cầu vượt clears ~4.75 m, plus the deck itself
export const GRADE = 0.05;

const key = (c) => `${c[0]},${c[1]}`;
const raised = (p) => !!p.bridge && p.layer >= 1;

function lengths(p) {
  const cum = [0];
  for (let i = 1; i < p.c.length; i++) cum.push(cum[i - 1] + metres(p.c[i - 1], p.c[i]));
  return cum;
}

// Whether segments ab and cd cross, in the lon/lat plane. Touching at an end is meeting,
// not crossing.
function crosses(a, b, c, d) {
  const o = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  const d1 = o(a, b, c), d2 = o(a, b, d), d3 = o(c, d, a), d4 = o(c, d, b);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

// pieces: road pieces, each once. Returns Map piece -> breakpoints, for the pieces that
// leave the ground.
export function elevate(pieces) {
  const at = new Map();
  for (const p of pieces) p.c.forEach((c, i) => { const k = key(c); if (!at.has(k)) at.set(k, []); at.get(k).push([p, i]); });

  // Ground segments on a coarse grid, to find what each bridge crosses.
  const G = 0.002, grid = new Map();
  const cell = (x, y) => `${Math.floor(x / G)}_${Math.floor(y / G)}`;
  for (const p of pieces) {
    if (raised(p)) continue;
    for (let i = 0; i + 1 < p.c.length; i++) {
      const [a, b] = [p.c[i], p.c[i + 1]];
      for (let x = Math.floor(Math.min(a[0], b[0]) / G); x <= Math.floor(Math.max(a[0], b[0]) / G); x++) {
        for (let y = Math.floor(Math.min(a[1], b[1]) / G); y <= Math.floor(Math.max(a[1], b[1]) / G); y++) {
          const k = `${x}_${y}`;
          if (!grid.has(k)) grid.set(k, []);
          grid.get(k).push([a, b]);
        }
      }
    }
  }
  const overRoad = (p) => {
    for (let i = 0; i + 1 < p.c.length; i++) {
      const [a, b] = [p.c[i], p.c[i + 1]];
      const seen = new Set();
      for (let x = Math.floor(Math.min(a[0], b[0]) / G); x <= Math.floor(Math.max(a[0], b[0]) / G); x++) {
        for (let y = Math.floor(Math.min(a[1], b[1]) / G); y <= Math.floor(Math.max(a[1], b[1]) / G); y++) {
          for (const s of grid.get(`${x}_${y}`) || []) {
            if (seen.has(s)) continue;
            seen.add(s);
            if (crosses(a, b, s[0], s[1])) return true;
          }
        }
      }
    }
    return false;
  };
  const decks = new Set(pieces.filter((p) => raised(p) && overRoad(p)));

  const out = new Map();
  const put = (p, pts) => {
    // A short piece between two decks can be on both ramps: it keeps the higher.
    const old = out.get(p);
    if (!old) { out.set(p, pts); return; }
    const ss = [...new Set([...old, ...pts].map(([s]) => s))].sort((a, b) => a - b);
    out.set(p, ss.map((s) => [s, Math.max(heightAlong(old, s), heightAlong(pts, s))]));
  };

  // From a deck's end outward along the road it continues, to where the ramp starts: the
  // first junction, or as far as the climb takes. Returns the stretch walked as
  // [{ piece, from, to }] in each piece's own metres, nearest the deck first, and its length.
  function rampOut(deck, end) {
    const legs = [];
    let d = 0, v = end === 0 ? deck.c[0] : deck.c[deck.c.length - 1], came = deck;
    for (;;) {
      const others = (at.get(key(v)) || []).filter(([p]) => p !== came);
      // Another deck carries on from here: this end is not a ramp.
      if (others.some(([p]) => decks.has(p))) return null;
      // Where the lanes part, or no road on: the ground starts here.
      if (others.length !== 1 || d >= DECK / GRADE) return { legs, length: d };
      const [p, i] = others[0];
      const cum = lengths(p), sense = i === 0 ? 1 : -1;
      if (i !== 0 && i !== p.c.length - 1) return { legs, length: d }; // joins mid-way: a junction
      const len = cum[cum.length - 1], need = DECK / GRADE - d;
      if (len >= need) {
        legs.push({ piece: p, from: sense === 1 ? 0 : len, to: sense === 1 ? need : len - need });
        return { legs, length: d + need };
      }
      legs.push({ piece: p, from: sense === 1 ? 0 : len, to: sense === 1 ? len : 0 });
      d += len;
      came = p;
      v = sense === 1 ? p.c[p.c.length - 1] : p.c[0];
    }
  }

  for (const deck of decks) {
    const cum = lengths(deck), len = cum[cum.length - 1];
    const ends = [rampOut(deck, 0), rampOut(deck, 1)];
    // Distance from the ground at each end, and how steeply it climbs from there: at GRADE,
    // unless the deck is too short to reach its height that way before its middle.
    const run = ends.map((e) => (e ? e.length : null));
    const grade = ends.map((e, k) => (e ? Math.max(GRADE, DECK / (run[k] + len / 2)) : 0));
    const h = (s) => Math.min(DECK, ...[0, 1].filter((k) => ends[k]).map((k) => grade[k] * (run[k] + (k === 0 ? s : len - s))));
    const ss = new Set([0, len, ...cum]);
    for (const k of [0, 1]) {
      if (!ends[k]) continue;
      const top = (DECK / grade[k]) - run[k];
      if (top > 0 && top < len) ss.add(k === 0 ? top : len - top);
    }
    put(deck, [...ss].sort((a, b) => a - b).map((s) => [s, h(s)]));
    // Down the ramps, off the deck: the heights fall away from its ends to the ground.
    ends.forEach((e, k) => {
      if (!e) return;
      let d = e.length;
      for (const { piece, from, to } of e.legs) {
        const span = Math.abs(to - from);
        const hi = grade[k] * d, lo = grade[k] * (d - span);
        const pts = [[from, hi], [to, Math.max(0, lo)]].sort((a, b) => a[0] - b[0]);
        put(piece, pts);
        d -= span;
      }
    });
  }
  return out;
}

// The height at s metres along a piece with these breakpoints. Lengths measured another
// way can overshoot an end by a hair, which is still the end.
export function heightAlong(bp, s) {
  if (!bp || !bp.length || s < bp[0][0] - 0.5 || s > bp[bp.length - 1][0] + 0.5) return 0;
  s = Math.min(Math.max(s, bp[0][0]), bp[bp.length - 1][0]);
  for (let i = 1; i < bp.length; i++) {
    if (s <= bp[i][0]) {
      const [s0, h0] = bp[i - 1], [s1, h1] = bp[i];
      return s1 > s0 ? h0 + ((h1 - h0) * (s - s0)) / (s1 - s0) : h1;
    }
  }
  return bp[bp.length - 1][1];
}
