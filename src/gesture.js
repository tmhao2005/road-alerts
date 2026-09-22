// What fingers on the map mean, decided the way map apps decide it.
//
// A two-finger gesture declares itself in its first few pixels and then sticks to it: two
// fingers side by side moving up or down together tilt the map; anything else is a pinch.
// A pinch only starts turning the map once the fingers have twisted past a few degrees, so
// zooming does not knock the map askew.
//
// Pure: no imports, so it runs under `node --test` and in the browser.

const SLOP = 10;          // px the fingers travel before the gesture is decided
export const TWIST = 12;  // degrees of twist before a pinch starts turning the map

const dist = (p, q) => Math.hypot(q[0] - p[0], q[1] - p[1]);

// a0, b0: where the two fingers landed; a, b: where they are now, in screen px.
// 'tilt', 'pinch', or null while it is too early to tell.
export function readTwoFingers(a0, b0, a, b) {
  const da = [a[0] - a0[0], a[1] - a0[1]], db = [b[0] - b0[0], b[1] - b0[1]];
  if (Math.max(Math.hypot(...da), Math.hypot(...db)) < SLOP) return null;
  const sideBySide = Math.abs(b0[1] - a0[1]) < Math.abs(b0[0] - a0[0]) * 0.7;
  const upright = (d) => Math.abs(d[1]) > 2 * Math.abs(d[0]) && Math.abs(d[1]) > SLOP / 2;
  const together = da[1] * db[1] > 0;
  const steady = Math.abs(dist(a, b) / dist(a0, b0) - 1) < 0.15;
  return sideBySide && together && steady && upright(da) && upright(db) ? 'tilt' : 'pinch';
}

// Degrees the line between two fingers has turned from a0-b0 to a-b, in -180..180.
export function twistOf(a0, b0, a, b) {
  const angle = (p, q) => (Math.atan2(q[1] - p[1], q[0] - p[0]) * 180) / Math.PI;
  return ((angle(a, b) - angle(a0, b0) + 540) % 360) - 180;
}

// How fast the fingers were going as they lifted, from their last ~100 ms: v in px per
// second, and zoom as the log of the spread's growth per second. Fingers that stopped
// before lifting are not flicking, so the map stays where they left it.
// trail: [[t ms, x, y, spread], ...], oldest first; spread is absent for one finger.
export function flick(trail, now) {
  const still = { v: [0, 0], zoom: 0 };
  const recent = trail.filter(([t]) => now - t <= 100);
  if (recent.length < 2 || now - recent[recent.length - 1][0] > 50) return still;
  const [t0, x0, y0, s0] = recent[0], [t1, x1, y1, s1] = recent[recent.length - 1];
  const dt = (t1 - t0) / 1000;
  if (!(dt > 0.008)) return still;
  return {
    v: [(x1 - x0) / dt, (y1 - y0) / dt],
    zoom: s0 > 0 && s1 > 0 ? Math.log(s1 / s0) / dt : 0,
  };
}
