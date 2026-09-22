// The shape of an arrow drawn along a road, on screen.
//
// Pure: no imports, so it runs under `node --test` and in the browser.

// The map draws a curve as straight pieces between its points, so an arrow tracing them
// bends sharply wherever it meets one. Over an arrow's length a road bends evenly, so it
// is drawn as one circular arc through the traced line's two ends and its middle, which
// has no corner anywhere; a line that is straight enough stays straight. Returns the arc
// as points from tail to tip, and the direction of travel at the tip.
export function arc(line) {
  const a = line[0], c = line[line.length - 1];
  let total = 0;
  for (let k = 1; k < line.length; k++) total += Math.hypot(line[k][0] - line[k - 1][0], line[k][1] - line[k - 1][1]);
  const b = fromEnd(line, total / 2).at;
  const chord = Math.hypot(c[0] - a[0], c[1] - a[1]);
  const bend = ((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) / (chord || 1);
  if (!chord || Math.abs(bend) < 0.6) return { pts: [a, c], dir: [(c[0] - a[0]) / (chord || 1), (c[1] - a[1]) / (chord || 1)] };
  const sq = (p) => p[0] * p[0] + p[1] * p[1];
  const d = 2 * (a[0] * (b[1] - c[1]) + b[0] * (c[1] - a[1]) + c[0] * (a[1] - b[1]));
  const ox = (sq(a) * (b[1] - c[1]) + sq(b) * (c[1] - a[1]) + sq(c) * (a[1] - b[1])) / d;
  const oy = (sq(a) * (c[0] - b[0]) + sq(b) * (a[0] - c[0]) + sq(c) * (b[0] - a[0])) / d;
  const r = Math.hypot(a[0] - ox, a[1] - oy);
  const wrap = (t) => Math.atan2(Math.sin(t), Math.cos(t));
  const t0 = Math.atan2(a[1] - oy, a[0] - ox);
  const toB = wrap(Math.atan2(b[1] - oy, b[0] - ox) - t0);
  let sweep = wrap(Math.atan2(c[1] - oy, c[0] - ox) - t0);
  // The short way round unless the middle point says otherwise.
  if (Math.sign(toB) !== Math.sign(sweep) || Math.abs(toB) > Math.abs(sweep)) sweep -= Math.sign(sweep) * 2 * Math.PI;
  const n = Math.max(8, Math.ceil((Math.abs(sweep) * r) / 2));
  const pts = [];
  for (let k = 0; k <= n; k++) {
    const t = t0 + (sweep * k) / n;
    pts.push([ox + r * Math.cos(t), oy + r * Math.sin(t)]);
  }
  const t2 = t0 + sweep, turn = Math.sign(sweep);
  return { pts, dir: [-Math.sin(t2) * turn, Math.cos(t2) * turn] };
}

// The point `d` px back from the end of a screen polyline, and the index of the first
// vertex beyond it.
export function fromEnd(line, d) {
  for (let k = line.length - 1; k > 0; k--) {
    const a = line[k - 1], b = line[k], step = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (step >= d) { const g = d / step; return { at: [b[0] + (a[0] - b[0]) * g, b[1] + (a[1] - b[1]) * g], index: k }; }
    d -= step;
  }
  return { at: line[0], index: 1 };
}
