// Where a point on the road lands on the screen.
//
// The camera hangs behind and above the car, looking down at it. A true perspective camera
// shrinks a junction 500 m ahead to a few pixels, which is useless at a glance. So distance
// ahead is folded first (logarithmically, past `fold` metres) and the folded ground plane is
// then drawn in ordinary perspective. Near the car the view is honest; far away it is
// compressed, but the order of things along the road never changes, and nothing ever
// reaches the horizon.
//
// Looking around while stopped, the same camera swings up from the driver's seat to
// straight overhead (`lift`), so the streets are looked at the way a map is, from the sky,
// rather than from the side where they pile up at the horizon. From there zooming is
// zooming, as in any map: it no longer tips the camera. The fold fades as the camera tips
// over: seen from above there is no far distance left to squeeze, and a squeezed street
// grid would just look bent.
//
// Pure: no imports, so it runs under `node --test` and in the browser.

const RAD = Math.PI / 180;

// How far a hand can zoom: from the whole neighbourhood the loaded map tiles cover, down to
// a few car lengths.
export const ZOOM = { min: 0.065, max: 3 };
const MAX_PITCH = 72;   // tipped up this far, the horizon is mid-screen

const smooth = (t) => { const u = Math.max(0, Math.min(1, t)); return u * u * (3 - 2 * u); };

// Camera space: x metres to the right of the car, z metres ahead of it.
// cam: { x, y, bearing } in local metres (x east, y north), bearing in compass degrees.
export function toCamera(cam, px, py) {
  const b = cam.bearing * RAD;
  const s = Math.sin(b), c = Math.cos(b);
  const dx = px - cam.x, dy = py - cam.y;
  return [dx * c - dy * s, dx * s + dy * c];
}

// Back from camera space to local metres.
export function fromCamera(cam, x, z) {
  const b = cam.bearing * RAD;
  const s = Math.sin(b), c = Math.cos(b);
  return [cam.x + x * c + z * s, cam.y - x * s + z * c];
}

// width, height: the drawing area in CSS px.
// carX, carY, horizonY: where the car and the vanishing line sit in the driving view, as
// fractions of the width and height.
// depth: metres over which the ground halves in size; smaller looks more top-down.
// fold: metres ahead beyond which distance is compressed.
// scale: pixels per metre across the road at the car, for a 390 px wide screen.
// zoom: 1 is the driving view; below 1 the camera rises, above it comes closer.
// lift: how far the camera has swung up from the driver's angle, 0, to straight down, 1.
// tilt: degrees tipped by hand on top of that.
export function makeView({ width, height, carX = 0.5, carY = 0.64, horizonY = 0.17, depth = 90, fold = 220, scale = 7, zoom = 1, tilt = 0, lift = 0 }) {
  const cx = width * carX;
  const yCar = height * carY;
  const px0 = scale * (Math.min(width, height) / 390);
  // The driving camera, recovered from where the car and the horizon sit on screen.
  const drive = Math.acos(Math.min(0.999, (yCar - height * horizonY) / (px0 * depth))) / RAD;
  const focal = px0 * depth * Math.sin(drive * RAD);
  const auto = drive * (1 - lift);
  const pitch = Math.max(0, Math.min(Math.max(drive, MAX_PITCH), auto + tilt));
  const s = Math.sin(pitch * RAD), c = Math.cos(pitch * RAD);
  const px = px0 * zoom;
  // Metres over which the ground halves, and how far the horizon sits above the car on
  // screen: both endless once the camera looks straight down.
  const d = s > 1e-9 ? focal / (px * s) : Infinity;
  const h = s > 1e-9 ? (focal * c) / s : Infinity;
  const yHor = yCar - h;
  const strength = smooth((pitch - 0.7 * drive) / (0.3 * drive));
  const fe = strength > 1e-6 ? fold / strength : Infinity;
  const folded = (z) => (z > 0 && fe < Infinity ? fe * Math.log1p(z / fe) : z);
  const unfold = (z) => (z > 0 && fe < Infinity ? fe * Math.expm1(z / fe) : z);
  const near = -0.6 * d;

  const factor = (z) => (d === Infinity ? 1 : d / (folded(Math.max(z, near)) + d));

  const view = {
    width, height, cx, yCar, yHor, px, near, zoom, pitch, auto, drive,
    factor,
    // Screen position of a ground point, and how much it has shrunk there (1 at the car).
    project(x, z) {
      const f = factor(z);
      return [cx + x * px * f, yCar - px * c * folded(Math.max(z, near)) * f, f];
    },
    // The ground point under a screen point: what a finger is touching. At or above the
    // horizon there is no ground, so the point is taken just below it.
    unproject(sx, sy) {
      const up = Math.min(yCar - sy, h - 1);
      const f = Math.max(0.02, 1 - up / h);
      const zf = (f > 0.02 ? up : 0.98 * h) / (px * c * f);
      return [(sx - cx) / (px * f), unfold(zf)];
    },
  };
  // The ground at the top and bottom edges of the screen: how far the view reaches, for
  // culling. Endless while the sky shows.
  view.far = yHor > 0 ? Infinity : view.unproject(cx, 0)[1];
  view.back = view.unproject(cx, height)[1];
  return view;
}

// A gesture moves the camera the way a map app does: whatever ground was under the fingers
// stays under them while the view zooms, turns and tilts about them.
// viewFor(cam) makes the view for a camera; cam: { x, y, bearing, zoom, tilt, lift }, x
// and y being the ground point the camera looks at. a, b: the fingers' centre before and
// after, in screen px. change: zoom as a ratio, turn and tilt in degrees, lift as a share
// of the swing overhead.
export function follow(viewFor, cam, a, b, { zoom = 1, turn = 0, tilt = 0, lift = 0 } = {}) {
  const v0 = viewFor(cam);
  const g = fromCamera(cam, ...v0.unproject(a[0], a[1]));
  const next = {
    ...cam, zoom: cam.zoom * zoom, bearing: (((cam.bearing + turn) % 360) + 360) % 360, tilt: cam.tilt + tilt,
    lift: Math.max(0, Math.min(1, (cam.lift ?? 0) + lift)),
  };
  const v1 = viewFor(next);
  // Tipped past straight down or the limit, the hand's tilt is kept at what was used.
  next.tilt = v1.pitch - v1.auto;
  const h = fromCamera(next, ...v1.unproject(b[0], b[1]));
  next.x += g[0] - h[0];
  next.y += g[1] - h[1];
  return next;
}
