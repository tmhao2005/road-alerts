// The quickest way between two points over the tile roads, for demo drives that go
// somewhere: the autopilot on its own keeps straight and turns only where a road ends, so
// it wanders. Not a navigation router - no turn costs, no traffic - just a believable way
// a driver would take, by road class and one-way rules.
//
// Pure apart from geo.js and oneway.js.
import { metres, pointSegment } from './geo.js';
import { travel } from './oneway.js';

// Speeds a car keeps up in town, km/h. Only their ratios matter: they are what makes the
// route stay on the bigger roads instead of cutting through every lane on the way.
const KMH = { motorway: 80, trunk: 50, primary: 40, secondary: 35, tertiary: 30, unclassified: 22, residential: 18, living_street: 10, service: 10 };
const FASTEST = 80 / 3.6;

const key = (p) => `${p[0]},${p[1]}`;

// pieces: tile pieces around both ends; from, to: [lon, lat]. Returns the route as the
// road's own vertices, [[lon, lat], ...], or null if no way through was found.
export function route(pieces, from, to, bike = false) {
  const nodes = new Map();
  const node = (p) => {
    let n = nodes.get(key(p));
    if (!n) nodes.set(key(p), (n = { at: p, out: [] }));
    return n;
  };
  // A piece crossing a tile edge is in both tiles; linked twice it is harmless, but slow.
  const seen = new Set();
  for (const pc of pieces) {
    const id = `${pc.id}|${key(pc.c[0])}|${key(pc.c[pc.c.length - 1])}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const way = travel(pc, bike);
    const speed = (KMH[(pc.highway || '').replace('_link', '')] || 15) / 3.6;
    for (let i = 0; i + 1 < pc.c.length; i++) {
      const a = node(pc.c[i]), b = node(pc.c[i + 1]);
      const cost = metres(pc.c[i], pc.c[i + 1]) / speed;
      if (way !== -1) a.out.push({ n: b, cost });
      if (way !== 1) b.out.push({ n: a, cost });
    }
  }
  const start = nearest(pieces, from), goal = nearest(pieces, to);
  if (!start || !goal) return null;
  const s = nodes.get(key(start)), g = nodes.get(key(goal));

  // A*, with the straight line at the fastest speed as the estimate.
  const best = new Map([[s, 0]]), back = new Map();
  const open = heap();
  open.push(s, metres(s.at, g.at) / FASTEST);
  const done = new Set();
  while (open.size()) {
    const n = open.pop();
    if (n === g) break;
    if (done.has(n)) continue;
    done.add(n);
    for (const { n: m, cost } of n.out) {
      const c = best.get(n) + cost;
      if (c < (best.get(m) ?? Infinity)) {
        best.set(m, c);
        back.set(m, n);
        open.push(m, c + metres(m.at, g.at) / FASTEST);
      }
    }
  }
  if (!best.has(g)) return null;
  const out = [];
  for (let n = g; n; n = back.get(n)) out.push(n.at);
  return out.reverse();
}

// The end of the nearest road segment that is closer to the point.
function nearest(pieces, p) {
  let best = null;
  for (const pc of pieces) {
    for (let i = 0; i + 1 < pc.c.length; i++) {
      const { dist, t } = pointSegment(p, pc.c[i], pc.c[i + 1]);
      if (!best || dist < best.dist) best = { dist, at: t < 0.5 ? pc.c[i] : pc.c[i + 1] };
    }
  }
  return best && best.at;
}

function heap() {
  const items = [];
  const up = (i) => {
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (items[p].k <= items[i].k) break;
      [items[p], items[i]] = [items[i], items[p]];
      i = p;
    }
  };
  const down = (i) => {
    for (;;) {
      const l = 2 * i + 1, r = l + 1;
      let m = i;
      if (l < items.length && items[l].k < items[m].k) m = l;
      if (r < items.length && items[r].k < items[m].k) m = r;
      if (m === i) return;
      [items[m], items[i]] = [items[i], items[m]];
      i = m;
    }
  };
  return {
    size: () => items.length,
    push(v, k) { items.push({ v, k }); up(items.length - 1); },
    pop() {
      const top = items[0], last = items.pop();
      if (items.length) { items[0] = last; down(0); }
      return top.v;
    },
  };
}
