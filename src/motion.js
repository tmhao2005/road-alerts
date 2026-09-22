// Smooth motion between GPS fixes.
//
// A phone gives one fix a second. Drawn as it arrives, the road jumps forward once a
// second, which reads as broken rather than live. So between fixes the car carries on
// along the road it is matched to at its last speed, and when a fix disagrees with that
// guess the difference is eased out over a fraction of a second instead of snapped.
//
// Two limits keep the guess honest: it never runs more than `ahead` seconds past the
// last fix (a GPS that stops answering stops the car, it does not send it on), and it
// never leaves the walked road, so at a junction it waits for the next fix rather than
// inventing a turn.
//
// Pure apart from geo.js; times are in seconds, from any clock that only goes forward.
import { metresPerDegree } from './geo.js';

export function makeMotion({ ease = 0.45, ahead = 1.5, turn = 0.35, snap = 80, hold = 10, stopped = 0.8 } = {}) {
  let origin = null, m = null;
  let base = null;           // { pts: [[x, y]], cum: [m], t0, v }
  let off = null;            // { x, y, t }: the correction being eased out
  let shown = null;          // the bearing on screen, eased toward the road's
  let lastAt = null;

  const toXY = ([lon, lat]) => [(lon - origin[0]) * m.x, (lat - origin[1]) * m.y];
  const toLL = ([x, y]) => [origin[0] + x / m.x, origin[1] + y / m.y];

  function along(s) {
    const { pts, cum } = base;
    if (pts.length === 1 || s <= 0) return pts[0];
    for (let i = 1; i < pts.length; i++) {
      if (cum[i] >= s || i === pts.length - 1) {
        const span = cum[i] - cum[i - 1];
        const f = span > 0 ? Math.min(1, (s - cum[i - 1]) / span) : 0;
        return [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * f, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * f];
      }
    }
  }

  function travelled(now) {
    const s = base.v * Math.min(Math.max(0, now - base.t0), ahead);
    return Math.min(s, base.cum[base.cum.length - 1]);
  }

  function position(now) {
    const p = along(travelled(now));
    if (!off) return p;
    const k = Math.exp(-(now - off.t) / ease);
    return [p[0] + off.x * k, p[1] + off.y * k];
  }

  // The direction the road takes from here: aimed at a point a little way ahead, so the
  // view turns into a bend smoothly instead of swinging at each vertex.
  function roadBearing(now) {
    const s = travelled(now);
    const total = base.cum[base.cum.length - 1];
    const look = Math.max(12, Math.min(40, base.v * 1.5));
    const a = along(Math.min(s, Math.max(0, total - look)));
    const b = along(Math.min(total, s + look));
    const dx = b[0] - a[0], dy = b[1] - a[1];
    if (Math.hypot(dx, dy) < 1) return null;
    return ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360;
  }

  return {
    // pts: the road ahead as [lon, lat], starting at the matched point. speed in m/s.
    fix(now, pts, speed) {
      if (!origin) { origin = pts[0]; m = metresPerDegree(origin[1]); }
      const v = speed != null && speed > stopped ? speed : 0;
      const xy = pts.map(toXY);
      const cum = [0];
      for (let i = 1; i < xy.length; i++) cum.push(cum[i - 1] + Math.hypot(xy[i][0] - xy[i - 1][0], xy[i][1] - xy[i - 1][1]));
      if (base) {
        const cur = position(now);
        const dx = cur[0] - xy[0][0], dy = cur[1] - xy[0][1];
        const gap = Math.hypot(dx, dy);
        // Standing at a light, GPS wanders by metres each second; the car on screen
        // should stand still, not shuffle.
        if (v === 0 && base.v === 0 && gap < hold) return;
        off = gap > snap ? null : { x: dx, y: dy, t: now };
      }
      base = { pts: xy, cum, t0: now, v };
    },

    // Where to draw the car now: { lon, lat, bearing } (bearing null until known).
    at(now) {
      if (!base) return null;
      const p = toLL(position(now));
      const target = roadBearing(now);
      const dt = lastAt == null ? 0 : Math.max(0, now - lastAt);
      lastAt = now;
      if (target != null) {
        if (shown == null) shown = target;
        else {
          const diff = ((target - shown + 540) % 360) - 180;
          shown = (shown + diff * (1 - Math.exp(-dt / turn)) + 360) % 360;
        }
      }
      return { lon: p[0], lat: p[1], bearing: shown };
    },
  };
}
