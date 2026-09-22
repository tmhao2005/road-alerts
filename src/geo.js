// Small geometry helpers. Distances use a local equirectangular projection, which is
// accurate to well under a metre over the few hundred metres a road match looks at.

const R = 6371008.8;

export function metresPerDegree(lat) {
  const k = Math.PI / 180;
  return { x: R * k * Math.cos(lat * k), y: R * k };
}

export function metres(a, b) {
  const m = metresPerDegree(a[1]);
  return Math.hypot((b[0] - a[0]) * m.x, (b[1] - a[1]) * m.y);
}

// Compass bearing from a to b, 0 = north, clockwise.
export function bearing(a, b) {
  const m = metresPerDegree(a[1]);
  const dx = (b[0] - a[0]) * m.x, dy = (b[1] - a[1]) * m.y;
  return ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360;
}

export function angleBetween(a, b) {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

// Distance in metres from p to segment ab, plus the parameter t of the nearest point.
// Points are [lon, lat].
export function pointSegment(p, a, b) {
  const m = metresPerDegree(p[1]);
  const ax = (a[0] - p[0]) * m.x, ay = (a[1] - p[1]) * m.y;
  const bx = (b[0] - p[0]) * m.x, by = (b[1] - p[1]) * m.y;
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : -(ax * dx + ay * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx, cy = ay + t * dy;
  return { dist: Math.hypot(cx, cy), t };
}

// Even-odd ray cast over every ring, so holes in a multipolygon cancel out correctly.
export function pointInRings(p, rings) {
  let inside = false;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i], [xj, yj] = ring[j];
      if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) {
        inside = !inside;
      }
    }
  }
  return inside;
}

export function bboxOf(coords) {
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const [x, y] of coords) {
    if (x < w) w = x; if (x > e) e = x;
    if (y < s) s = y; if (y > n) n = y;
  }
  return [w, s, e, n];
}

export function inBbox(p, b) {
  return p[0] >= b[0] && p[0] <= b[2] && p[1] >= b[1] && p[1] <= b[3];
}

// Google Maps copies coordinates as "lat, lng"; URLs carry "@lat,lng,zoom". Accept both
// and return [lon, lat].
export function parseCoordinate(text) {
  const at = /@(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/.exec(text);
  const plain = /(-?\d+(?:\.\d+)?)\s*[,\s]\s*(-?\d+(?:\.\d+)?)/.exec(text);
  const m = at || plain;
  if (!m) return null;
  const lat = Number(m[1]), lon = Number(m[2]);
  if (!(Math.abs(lat) <= 90 && Math.abs(lon) <= 180)) return null;
  return [lon, lat];
}
