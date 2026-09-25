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
// inventing a turn. A caller that knows the car is turning also passes where to stop, and
// the guess slows into that point instead of carrying on past it.
//
// The correction keeps the car's momentum. Eased out from a standing start, it changed the
// car's velocity in a single frame at every fix: a small lurch once a second on a straight
// road, and at a turn a sideways slide across the corner while the car pointed down the
// road it had left. Starting from the velocity already on screen, the car instead bends
// from the old road onto the new one.
//
// Pure apart from geo.js; times are in seconds, from any clock that only goes forward.
import { metresPerDegree } from './geo.js';

export function makeMotion({ ease = 0.3, ahead = 1.5, turn = 0.35, snap = 80, hold = 10, stopped = 0.8 } = {}) {
  let origin = null, m = null;
  let base = null;           // { pts: [[x, y]], cum: [m], t0, v, stop, lead }
  let off = null;            // { x, y, vx, vy, t }: the correction being eased out
  let shown = null;          // the bearing on screen, eased toward the road's
  let lastAt = null;
  let heard = null;          // { course, t }: the phone's last direction of travel

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
    const d = Math.max(0, now - base.t0);
    let s = base.v * Math.min(d, ahead);
    if (base.lead) {
      // Rounding a corner the path starts where the car is drawn, behind where the fix
      // puts it, and the car closes that gap along the curve from the speed it had.
      const { s0, u0, k } = base.lead, e = (s0 + (u0 + s0 / k) * d) * Math.exp(-d / k);
      s = Math.max(0, s0 + s - e);
    } else if (base.stop < Infinity) {
      // Leaves the last fix at full speed and comes to rest exactly at the stop.
      s = base.stop > 0 ? base.stop * (1 - Math.exp(-s / base.stop)) : 0;
    }
    return Math.min(s, base.cum[base.cum.length - 1]);
  }

  // A fix that puts the car on a road running a different way from the one it is drawn
  // on - a turn - is joined by a curve: out of the car along the way it points, into the
  // new road a few metres past the fix. Returns the path and where along it the fix is,
  // or null where a curve would not help: a U-turn, or a fix too far away to reach.
  function corner(cur, facing, xy, cum, v) {
    const total = cum[cum.length - 1];
    if (facing == null || total < 2) return null;
    const reach = Math.min(total, Math.max(8, v * 0.8));
    let i = 1;
    while (i < xy.length - 1 && cum[i] < reach) i++;
    const f = (reach - cum[i - 1]) / (cum[i] - cum[i - 1] || 1);
    const B = [xy[i - 1][0] + (xy[i][0] - xy[i - 1][0]) * f, xy[i - 1][1] + (xy[i][1] - xy[i - 1][1]) * f];
    const out = Math.atan2(xy[i][0] - xy[i - 1][0], xy[i][1] - xy[i - 1][1]);
    const into = (facing * Math.PI) / 180;
    const bend = Math.abs((((out - into) * 180) / Math.PI + 540) % 360 - 180);
    const span = Math.hypot(B[0] - cur[0], B[1] - cur[1]);
    if (bend < 25 || bend > 150 || span > 40) return null;
    // Hermite, with both ends' tangents as long as the chord: a round, even turn.
    const t0 = [Math.sin(into) * span, Math.cos(into) * span], t1 = [Math.sin(out) * span, Math.cos(out) * span];
    const pts = [];
    for (let n = 0; n <= 16; n++) {
      const u = n / 16, u2 = u * u, u3 = u2 * u;
      const h00 = 2 * u3 - 3 * u2 + 1, h10 = u3 - 2 * u2 + u, h01 = -2 * u3 + 3 * u2, h11 = u3 - u2;
      pts.push([h00 * cur[0] + h10 * t0[0] + h01 * B[0] + h11 * t1[0], h00 * cur[1] + h10 * t0[1] + h01 * B[1] + h11 * t1[1]]);
    }
    for (let j = i; j < xy.length; j++) pts.push(xy[j]);
    const c = [0];
    for (let j = 1; j < pts.length; j++) c.push(c[j - 1] + Math.hypot(pts[j][0] - pts[j - 1][0], pts[j][1] - pts[j - 1][1]));
    return { pts, cum: c, fixAt: Math.max(0, c[16] - reach) };
  }

  // Critically damped: no overshoot, and it starts at the velocity it was given.
  function correction(now) {
    if (!off) return [0, 0];
    const d = now - off.t, k = Math.exp(-d / ease);
    return [(off.x + (off.vx + off.x / ease) * d) * k, (off.y + (off.vy + off.y / ease) * d) * k];
  }

  function position(now) {
    const p = along(travelled(now));
    const [cx, cy] = correction(now);
    return [p[0] + cx, p[1] + cy];
  }

  const H = 1 / 60;
  const velocity = (f, now) => {
    const a = f(now), b = f(now + H);
    return [(b[0] - a[0]) / H, (b[1] - a[1]) / H];
  };

  // The direction the road takes from here: aimed at a point a little way ahead, so the
  // view turns into a bend smoothly instead of swinging at each vertex.
  function roadBearing(now) {
    const s = travelled(now);
    const total = base.cum[base.cum.length - 1];
    // Round a corner the curve itself is the turn, so it is followed closely.
    const look = base.lead ? 4 : Math.max(12, Math.min(40, base.v * 1.5));
    const a = along(Math.min(s, Math.max(0, total - look)));
    const b = along(Math.min(total, s + look));
    const dx = b[0] - a[0], dy = b[1] - a[1];
    if (Math.hypot(dx, dy) < 1) return null;
    return ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360;
  }

  return {
    // pts: the road ahead as [lon, lat], starting at the matched point. speed in m/s.
    // stop: metres along pts that the car should not be carried past before the next fix.
    // course: the phone's own direction of travel, in degrees.
    fix(now, pts, speed, stop = Infinity, course = null) {
      if (!origin) { origin = pts[0]; m = metresPerDegree(origin[1]); }
      const v = speed != null && speed > stopped ? speed : 0;
      const xy = pts.map(toXY);
      const cum = [0];
      for (let i = 1; i < xy.length; i++) cum.push(cum[i - 1] + Math.hypot(xy[i][0] - xy[i - 1][0], xy[i][1] - xy[i - 1][1]));
      // How fast the phone's course is swinging, so a turn keeps turning between fixes.
      let swing = 0;
      if (course != null && v > 0 && heard && now - heard.t > 0.2 && now - heard.t < 2.5) {
        swing = Math.max(-60, Math.min(60, (((course - heard.course + 540) % 360) - 180) / (now - heard.t)));
      }
      heard = course != null && v > 0 ? { course, t: now } : null;
      const next = { pts: xy, cum, t0: now, v, stop, course: v > 0 ? course : null, swing };
      if (!base) { base = next; return; }
      const cur = position(now);
      const dx = cur[0] - xy[0][0], dy = cur[1] - xy[0][1];
      const gap = Math.hypot(dx, dy);
      // Standing at a light, GPS wanders by metres each second; the car on screen
      // should stand still, not shuffle.
      if (v === 0 && base.v === 0 && gap < hold) return;
      if (gap > snap) { off = null; base = next; return; }
      const was = velocity(position, now - H);
      const round = v > 0 ? corner(cur, shown, xy, cum, v) : null;
      if (round) {
        off = null;
        base = { ...next, pts: round.pts, cum: round.cum, stop: Infinity, lead: { s0: round.fixAt, u0: v - Math.hypot(was[0], was[1]), k: ease * 1.5 } };
        return;
      }
      base = next;
      off = { x: dx, y: dy, vx: 0, vy: 0, t: now };
      const [bx, by] = velocity((t) => along(travelled(t)), now);
      off.vx = was[0] - bx;
      off.vy = was[1] - by;
    },

    // Where to draw the car now: { lon, lat, bearing } (bearing null until known).
    at(now) {
      if (!base) return null;
      const road = roadBearing(now);
      // Through a turn the road under the car says nothing until the car has left it, but
      // the phone's course sweeps round with the car. So where the two disagree the course
      // steers, carried on at its own rate until the next fix; along a road, where they
      // agree to within GPS noise, the road does, which keeps the view steady.
      let target = road;
      if (road != null && base.course != null && !base.lead) {
        const course = base.course + base.swing * Math.min(Math.max(0, now - base.t0), 1);
        const diff = ((course - road + 540) % 360) - 180;
        const w = Math.min(1, Math.max(0, (Math.abs(diff) - 8) / 17));
        target = (road + diff * w * w * (3 - 2 * w) + 360) % 360;
      }
      const dt = lastAt == null ? 0 : Math.max(0, now - lastAt);
      lastAt = now;
      if (target != null) {
        if (shown == null) shown = target;
        else {
          const diff = ((target - shown + 540) % 360) - 180;
          shown = (shown + diff * (1 - Math.exp(-dt / turn)) + 360) % 360;
        }
      }
      const p = toLL(position(now));
      return { lon: p[0], lat: p[1], bearing: shown };
    },
  };
}
