// Where the arrows on one-way streets sit.
//
// They belong to the map, like paint on the road: laid out once, in metres, and left
// there while the car drives over them. Laid out on screen instead, frame by frame, an
// arrow changes size as it nears, slides along its road, and swaps places with its
// neighbour as the view moves.
//
// Pure: no imports, so it runs under `node --test` and in the browser.

const MIN = 12;  // metres: a piece shorter than this is a stub at a junction, not a street
const AIM = 3;   // metres each way over which an arrow takes its direction

// roads: [{ xy: flat [x0, y0, x1, y1, ...] in metres, way: 1 along the vertex order or -1
// against it, rank: higher is placed first, id }]. gap: metres between arrows on a road.
// Returns the arrows kept, each { road, x, y, ux, uy, key }: where it sits, the way it
// points, and a name that stays the same for as long as the arrow does.
//
// Roads are spread evenly with arrows, then the arrows are kept the way map labels are:
// main roads first, and one that would crowd an arrow already kept going the same way is
// dropped. So a road cut into short pieces at every junction, or mapped as parallel
// carriageways, still reads as one arrow at a time, while a divided road keeps an arrow
// each way. The order is fixed by the map alone, so the same roads always give the same
// arrows, whichever order they arrive in.
export function placeArrows(roads, gap) {
  const all = [];
  for (const road of roads) {
    const { xy, way } = road, n = xy.length / 2;
    const cum = new Float64Array(n);
    for (let i = 1; i < n; i++) cum[i] = cum[i - 1] + Math.hypot(xy[2 * i] - xy[2 * i - 2], xy[2 * i + 1] - xy[2 * i - 1]);
    const total = cum[n - 1];
    if (!(total >= MIN)) continue;
    const count = Math.max(1, Math.floor(total / gap));
    for (let k = 0; k < count; k++) {
      const s = ((k + 0.5) * total) / count;
      const [x, y] = pointAt(xy, cum, s);
      // Aimed along a few metres of road rather than the one straight piece it lands on,
      // so an arrow on a vertex of a bend points round the bend, not off it.
      const a = pointAt(xy, cum, Math.max(0, s - AIM)), b = pointAt(xy, cum, Math.min(total, s + AIM));
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (!len) continue;
      const ux = ((b[0] - a[0]) / len) * way, uy = ((b[1] - a[1]) / len) * way;
      all.push({ road, x, y, ux, uy, total, key: `${Math.round(x * 10)},${Math.round(y * 10)},${Math.round(Math.atan2(uy, ux) * 100)}` });
    }
  }
  all.sort(first);
  const reach = 0.6 * gap;
  const grid = new Map(), kept = [];
  const cell = (x, y) => `${Math.floor(x / reach)},${Math.floor(y / reach)}`;
  for (const s of all) {
    const cx = Math.floor(s.x / reach), cy = Math.floor(s.y / reach);
    let crowded = false;
    for (let i = cx - 1; i <= cx + 1 && !crowded; i++) {
      for (let j = cy - 1; j <= cy + 1 && !crowded; j++) {
        for (const q of grid.get(`${i},${j}`) || []) {
          if (q.ux * s.ux + q.uy * s.uy > 0.7 && Math.hypot(q.x - s.x, q.y - s.y) < reach) { crowded = true; break; }
        }
      }
    }
    if (crowded) continue;
    kept.push(s);
    const c = cell(s.x, s.y);
    if (!grid.has(c)) grid.set(c, []);
    grid.get(c).push(s);
  }
  return kept;
}

// Main roads first, then longer pieces, whose arrows are spread over more road; the rest
// only makes the order total.
function first(a, b) {
  return (b.road.rank - a.road.rank) || (b.total - a.total) || ((a.road.id || 0) - (b.road.id || 0)) ||
    (a.x - b.x) || (a.y - b.y) || (a.ux - b.ux) || (a.uy - b.uy);
}

function pointAt(xy, cum, s) {
  let i = 1;
  while (i < cum.length - 1 && cum[i] < s) i++;
  const span = cum[i] - cum[i - 1], f = span ? (s - cum[i - 1]) / span : 0;
  return [xy[2 * i - 2] + (xy[2 * i] - xy[2 * i - 2]) * f, xy[2 * i - 1] + (xy[2 * i + 1] - xy[2 * i - 1]) * f];
}
