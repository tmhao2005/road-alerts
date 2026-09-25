// The road view: the roads around the car on a tilted ground plane, the road ahead picked
// out, and what is coming standing on the right shoulder, where Vietnamese signs stand.
//
// It draws only what the map says. Lane lines appear only where the map counts lanes, the
// road ahead is picked out only as far as it obviously goes, and a shoulder sign only
// where the badge is going to change.
import { makeView, toCamera, follow, ZOOM } from './src/view.js';
import { metresPerDegree } from './src/geo.js';
import { travel } from './src/oneway.js';
import { placeArrows } from './src/arrows.js';

// Carriageway widths in metres, a little generous so a side street still reads at a glance.
const WIDTH = {
  motorway: 15, trunk: 13, primary: 11, secondary: 9.5, tertiary: 8, unclassified: 6.5,
  residential: 6, living_street: 5, service: 4, road: 6,
  motorway_link: 7, trunk_link: 7, primary_link: 6.5, secondary_link: 6, tertiary_link: 6,
};
const RANK = {
  service: 0, living_street: 1, residential: 1, road: 1, unclassified: 2, tertiary: 3, tertiary_link: 3,
  secondary: 4, secondary_link: 4, primary: 5, primary_link: 5, trunk: 6, trunk_link: 6, motorway: 7, motorway_link: 7,
};
const LANE = 3.3;
// A one-way arrow in Google Maps' proportions: a slim shaft for the back half, a head half
// as wide as the arrow is long for the front. [along, across] in arrow lengths, tail to tip.
const ARROW = [[-0.5, -0.085], [0.02, -0.085], [0.02, -0.29], [0.5, 0], [0.02, 0.29], [0.02, 0.085], [-0.5, 0.085]];
const TWO_WAY = (p) => !['yes', '1', 'true', '-1'].includes(p.oneway) && p.junction !== 'roundabout' && !/^motorway/.test(p.highway);

export function roadWidth(p) {
  const base = WIDTH[p.highway] || 6;
  const lanes = parseInt(p.lanes, 10);
  return lanes > 0 ? Math.max(base * 0.8, Math.min(lanes * LANE, 24)) : base;
}

// Red is kept for one thing on this screen - over the limit - so nothing here uses it
// except the rim of a real speed sign.
export const THEMES = {
  light: {
    sky: ['#DCE5F0', '#EAEEF3'], ground: ['#EAEEF3', '#F1F2F4'],
    casing: '#CBD0D8', road: '#FFFFFF', minorCasing: '#D9DDE3', minor: '#FAFBFC',
    ahead: 'rgba(0, 122, 255, 0.13)', aheadEdge: 'rgba(0, 122, 255, 0.55)',
    lane: 'rgba(72, 78, 90, 0.42)', centre: '#E2A710', fog: 'rgba(234, 238, 243, ', arrow: '#818993',
    puck: '#007AFF', puckRim: '#FFFFFF', shadow: 'rgba(20, 30, 50, 0.22)',
    pill: 'rgba(255, 255, 255, 0.94)', pillInk: '#1C1C1E', housing: '#2C2C2E', lamp: '#E5E5EA', pole: '#8E9199',
  },
  dark: {
    sky: ['#030406', '#0E1014'], ground: ['#0E1014', '#16181C'],
    casing: '#24272D', road: '#3A3D45', minorCasing: '#202227', minor: '#2C2E34',
    ahead: 'rgba(10, 132, 255, 0.20)', aheadEdge: 'rgba(64, 156, 255, 0.75)',
    lane: 'rgba(235, 235, 245, 0.34)', centre: '#B98A0E', fog: 'rgba(14, 16, 20, ', arrow: '#8A919C',
    puck: '#0A84FF', puckRim: '#FFFFFF', shadow: 'rgba(0, 0, 0, 0.5)',
    pill: 'rgba(44, 44, 46, 0.94)', pillInk: '#F2F2F7', housing: '#0B0B0C', lamp: '#D1D1D6', pole: '#6C6E75',
  },
};

const FONT = "'Be Vietnam Pro', system-ui, -apple-system, sans-serif";

export function makeHud(canvas, options = {}) {
  const ctx = canvas.getContext('2d');
  let theme = THEMES[options.theme || 'light'];
  let view = null, W = 0, H = 0, dpr = 1;
  let origin = null, m = null;
  const local = new WeakMap(); // piece -> Float64Array of x, y metres from origin
  const extent = new WeakMap(); // piece -> [w, s, e, n] in degrees
  let scene = { pieces: [], walk: null, piece: null };
  const boards = new Map();    // shoulder items by id, kept a moment after they are passed
  const rects = new Map();     // last on-screen box of each shoulder sign, for the badge
  let carShift = 0;            // metres right of the centre line, eased
  let viewBearing = null;      // the camera's heading; north-up until the car's is known
  // Where the user has moved the view while stopped: metres east/north of the car, degrees
  // turned, zoom, degrees tipped by hand, and how far the camera has swung up overhead.
  // This at rest means the view follows the car.
  const user = { x: 0, y: 0, turn: 0, zoom: 1, tilt: 0, lift: 0 };
  let back = false;            // springing back to the car
  let rising = false;          // swinging up overhead as the hand takes the map
  let dirty = false;           // moved by a finger since the last frame
  let glide = null;            // an animated zoom: { zoom, at } to reach, about a screen point
  let coast = null;            // momentum after the fingers let go: { v: px/s, zoom: log/s, at }
  let raw = 1;                 // the zoom the fingers asked for, before the limits push back
  let focus = null;            // where the fingers last were, to spring back about
  let carCam = null;           // the car's own camera at the last frame: where it follows
  const baseScale = (options.view && options.view.scale) || 7;
  // Overhead, the camera also stands higher: at the driving zoom a plan shows only the
  // few car lengths around the car, so it climbs to where a few blocks each way are on
  // screen, about Google Maps' street level.
  const PLAN = 0.3;
  let bike = !!options.bike;    // a xe máy: some one-way streets are two-way for it
  // The 3x3 tiles around the car reach at least 2.2 km from it; the view is kept inside.
  const REACH = 1000;
  const FAR = 1600;
  let pool = [], poolAt = null, gathered = 0;
  // Parked, the screen is a map of where the car is: the camera rests overhead, with the car
  // in the middle of the map the panels leave uncovered rather than down by the panel where
  // the driving view keeps it. Driving, it rests in the driver's seat.
  let parked = false;
  let parkness = 0;             // 0 driving, 1 parked, eased between
  let ease = 0.14;              // seconds: quick for a spring back, slower for the swing between the two
  const rest = () => (parked ? { lift: 1, zoom: PLAN } : { lift: 0, zoom: 1 });

  // Capped at the window: before the stylesheet applies, a canvas's box follows its own
  // pixel size, and growing one to fit the other never stops.
  const box = () => options.size || [Math.min(canvas.clientWidth, innerWidth) || 1, Math.min(canvas.clientHeight, innerHeight) || 1];

  // Landscape on a dashboard mount: the numbers take the right-hand column, so the road is
  // centred in what is left.
  const viewFor = ({ zoom, tilt, lift }) => {
    const base = { ...(W > H * 1.2 ? { carX: 0.3, carY: 0.7, horizonY: 0.12 } : {}), ...options.view };
    const carY = base.carY ?? 0.64, parkY = options.parkY ?? carY;
    return makeView({ width: W, height: H, ...base, carY: carY + (parkY - carY) * parkness, scale: baseScale, zoom, tilt, lift });
  };

  function resize() {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    [W, H] = box();
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    view = viewFor(user);
  }

  // A city-centre block of tiles holds ~20,000 pieces; only the ones within reach of the
  // view are worth transforming every frame. Minor streets matter only nearer the car.
  function gather(major, minor) {
    const k = metresPerDegree(poolAt[1]);
    const rx = major / k.x, ry = major / k.y, mx = minor / k.x, my = minor / k.y;
    const near = [];
    for (const p of pool) {
      let e = extent.get(p);
      if (!e) {
        e = [Infinity, Infinity, -Infinity, -Infinity];
        for (const [x, y] of p.c) { if (x < e[0]) e[0] = x; if (y < e[1]) e[1] = y; if (x > e[2]) e[2] = x; if (y > e[3]) e[3] = y; }
        extent.set(p, e);
      }
      const minorRoad = (RANK[p.highway] ?? 1) <= 1;
      const ex = minorRoad ? mx : rx, ey = minorRoad ? my : ry;
      if (e[2] < poolAt[0] - ex || e[0] > poolAt[0] + ex || e[3] < poolAt[1] - ey || e[1] > poolAt[1] + ey) continue;
      near.push(p);
    }
    scene.pieces = near;
    gathered = Math.min(major, minor);
  }

  // Zoomed out or looking elsewhere, the view sees further from the car than the driving
  // view does, so more of the tiles are brought in, once, as it grows.
  function widen() {
    let r = 0;
    for (const [sx, sy] of [[0, 0], [W, 0], [0, H], [W, H]]) r = Math.max(r, Math.hypot(...view.unproject(sx, sy)));
    const need = Math.min(2400, Math.hypot(user.x, user.y) + Math.min(FAR, r) + 100);
    if (need > gathered) gather(Math.max(1100, need), Math.max(550, need));
  }

  // The hand's camera: where it looks, which way, how far out and how tipped.
  function handCam() {
    return { x: carCam.x + user.x, y: carCam.y + user.y, bearing: (carCam.bearing + user.turn + 360) % 360, zoom: user.zoom, tilt: user.tilt, lift: user.lift };
  }
  function setHand(c) {
    user.x = c.x - carCam.x; user.y = c.y - carCam.y;
    user.turn = ((c.bearing - carCam.bearing + 540) % 360) - 180;
    user.zoom = c.zoom; user.tilt = c.tilt; user.lift = c.lift;
    const far = Math.hypot(user.x, user.y);
    if (far > REACH) { user.x *= REACH / far; user.y *= REACH / far; }
    view = viewFor(user);
    back = false; dirty = true;
  }
  const move = (a, b, change) => { if (carCam && W) setHand(follow(viewFor, handCam(), a, b, change)); };

  // The hand's first move swings the camera up from the driver's seat to overhead: a map
  // being looked at is looked at from the sky, not from the side.
  function lookDown() { if (carCam && user.lift < 1) { rising = true; back = false; } }

  // Past the zoom limits the map gives a little, with growing resistance, and springs back
  // when let go.
  function soft(z) {
    if (z > ZOOM.max) return ZOOM.max * Math.pow(z / ZOOM.max, 0.3);
    if (z < ZOOM.min) return ZOOM.min * Math.pow(z / ZOOM.min, 0.3);
    return z;
  }
  const clampZoom = (z) => Math.max(ZOOM.min, Math.min(ZOOM.max, z));

  function pan(a, b) {
    if (!carCam || !W) return;
    lookDown();
    const cur = handCam(), next = follow(viewFor, cur, a, b);
    // A drag near the horizon is not a 2 km jump.
    const dx = next.x - cur.x, dy = next.y - cur.y, len = Math.hypot(dx, dy);
    const cap = Math.max(150, (2 * Math.hypot(b[0] - a[0], b[1] - a[1])) / view.px);
    if (len > cap) { next.x = cur.x + (dx * cap) / len; next.y = cur.y + (dy * cap) / len; }
    setHand(next);
  }

  // Momentum and animated zooms, a frame at a time.
  function animate(dt) {
    if (rising) {
      const left = 1 - user.lift;
      const step = left < 0.004 ? left : left * (1 - Math.exp(-dt / 0.1));
      // It climbs as it swings, about the point it looks at, and whatever zoom the fingers
      // or a double tap are heading for is carried up with it.
      const r = Math.pow(PLAN, step);
      move([view.cx, view.yCar], [view.cx, view.yCar], { lift: step, zoom: r });
      raw *= r;
      if (glide) glide.zoom = clampZoom(glide.zoom * r);
      if (step === left) { user.lift = 1; rising = false; }
    }
    if (glide) {
      const left = Math.log(glide.zoom / user.zoom);
      const step = Math.abs(left) < 0.004 ? left : left * (1 - Math.exp(-dt / 0.08));
      move(glide.at, glide.at, { zoom: Math.exp(step) });
      if (step === left) glide = null;
      raw = user.zoom;
    }
    if (coast) {
      const { v, at } = coast;
      if (Math.hypot(v[0], v[1]) > 15) pan(at, [at[0] + v[0] * dt, at[1] + v[1] * dt]);
      if (Math.abs(coast.zoom) > 0.02) {
        const to = clampZoom(user.zoom * Math.exp(coast.zoom * dt));
        move(at, at, { zoom: to / user.zoom });
        if (to === ZOOM.min || to === ZOOM.max) coast.zoom = 0;
      }
      const fade = Math.exp(-dt / 0.4);
      coast.v = [v[0] * fade, v[1] * fade];
      coast.zoom *= Math.exp(-dt / 0.15);
      raw = user.zoom;
      if (Math.hypot(...coast.v) <= 15 && Math.abs(coast.zoom) <= 0.02) coast = null;
    }
  }

  const toXY = (lon, lat) => [(lon - origin[0]) * m.x, (lat - origin[1]) * m.y];
  function xyOf(piece) {
    let a = local.get(piece);
    if (!a) {
      a = new Float64Array(piece.c.length * 2);
      piece.c.forEach(([lon, lat], i) => { a[2 * i] = (lon - origin[0]) * m.x; a[2 * i + 1] = (lat - origin[1]) * m.y; });
      local.set(piece, a);
    }
    return a;
  }

  // Keep only the stretch of a polyline in front of the near plane, splitting where it
  // passes behind the camera.
  function clipRuns(cam, xy) {
    const runs = [];
    let run = [], prev = null;
    const zMin = view.near + 2;
    for (let i = 0; i < xy.length; i += 2) {
      const p = toCamera(cam, xy[i], xy[i + 1]);
      if (prev) {
        const inA = prev[1] >= zMin, inB = p[1] >= zMin;
        if (inA !== inB) {
          const f = (zMin - prev[1]) / (p[1] - prev[1]);
          const q = [prev[0] + (p[0] - prev[0]) * f, zMin];
          if (inA) { run.push(q); runs.push(run); run = []; } else run.push(q);
        }
      }
      if (p[1] >= zMin) run.push(p);
      prev = p;
    }
    if (run.length > 1) runs.push(run);
    return runs.filter((r) => r.length > 1);
  }

  // A road as a filled ribbon: both edges offset on the ground, then projected, so it
  // narrows into the distance the way a real road does.
  function ribbonPath(pts, half, shift = 0) {
    const n = pts.length;
    const left = [], right = [];
    for (let i = 0; i < n; i++) {
      const a = pts[Math.max(0, i - 1)], b = pts[i], c = pts[Math.min(n - 1, i + 1)];
      let d1x = b[0] - a[0], d1z = b[1] - a[1], d2x = c[0] - b[0], d2z = c[1] - b[1];
      const l1 = Math.hypot(d1x, d1z) || 1, l2 = Math.hypot(d2x, d2z) || 1;
      d1x /= l1; d1z /= l1; d2x /= l2; d2z /= l2;
      if (i === 0) { d1x = d2x; d1z = d2z; }
      if (i === n - 1) { d2x = d1x; d2z = d1z; }
      let nx = d1z + d2z, nz = -(d1x + d2x);
      const nl = Math.hypot(nx, nz) || 1;
      nx /= nl; nz /= nl;
      const miter = Math.min(2.5, 1 / Math.max(0.4, nx * d1z - nz * d1x));
      const o = shift, h = half * miter;
      left.push(view.project(b[0] + nx * (o - h), b[1] + nz * (o - h)));
      right.push(view.project(b[0] + nx * (o + h), b[1] + nz * (o + h)));
    }
    // Every shape is wound the same way round, so a whole class of road can be filled in
    // one go: overlaps merge instead of cancelling, and no seams show where pieces meet.
    const ring = left.concat(right.reverse());
    wind(ring);
  }

  function wind(ring) {
    let area = 0;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) area += (ring[j][0] - ring[i][0]) * (ring[j][1] + ring[i][1]);
    if (area < 0) ring.reverse();
    ctx.moveTo(ring[0][0], ring[0][1]);
    for (let i = 1; i < ring.length; i++) ctx.lineTo(ring[i][0], ring[i][1]);
    ctx.closePath();
  }

  // A disc on the ground, so pieces of road meet in a rounded joint rather than a notch.
  function discPath(p, r) {
    const ring = [];
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2;
      ring.push(view.project(p[0] + Math.cos(a) * r, p[1] + Math.sin(a) * r));
    }
    wind(ring);
  }

  // How far to either side is on screen at depth z, plus a margin for wide roads.
  const visibleHalf = (z) => W / 2 / (view.px * view.factor(z)) + 40;
  // Seen from high up a road is still a line, not a hairline: at least this wide, in metres
  // at the current zoom, for a main road, a lesser one and a side street.
  const minHalf = (rank) => (rank >= 3 ? 1.6 : rank === 2 ? 1.2 : 0.9) / view.px;

  function drawGround() {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    const hz = view.yHor / H;
    // Looking down from high enough, there is no sky on screen at all.
    if (hz > 0.02) {
      g.addColorStop(0, theme.sky[0]);
      g.addColorStop(hz - 0.02, theme.sky[1]);
    }
    g.addColorStop(Math.max(0, Math.min(1, hz + 0.02)), theme.ground[0]);
    g.addColorStop(1, theme.ground[1]);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }

  function drawRoads(cam) {
    const drawn = [];
    for (const piece of scene.pieces) {
      const xy = xyOf(piece);
      // Cheap reject on the piece's extent before any clipping.
      let minZ = Infinity, maxZ = -Infinity, minX = Infinity, maxX = -Infinity;
      for (let i = 0; i < xy.length; i += 2) {
        const [x, z] = toCamera(cam, xy[i], xy[i + 1]);
        if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
        if (x < minX) minX = x; if (x > maxX) maxX = x;
      }
      if (maxZ < Math.max(view.near, view.back - 30) || minZ > Math.min(FAR, view.far + 30)) continue;
      const reach = visibleHalf(Math.max(0, maxZ));
      if (minX > reach || maxX < -reach) continue;
      const rank = RANK[piece.highway] ?? 1;
      if (rank <= 1 && minZ > 500 / Math.min(1, view.zoom)) continue;
      if (rank === 0 && view.px < 0.9) continue;
      const runs = clipRuns(cam, xy);
      if (runs.length) drawn.push({ piece, runs, rank, half: Math.max(roadWidth(piece) / 2, minHalf(rank)) });
    }
    drawn.sort((a, b) => a.rank - b.rank);
    // All casings first, then all surfaces, so junctions merge instead of overlapping;
    // each class of road in one fill.
    for (const pass of ['casing', 'surface']) {
      for (let i = 0; i < drawn.length;) {
        const rank = drawn[i].rank, minor = rank <= 1;
        const extra = pass === 'casing' ? Math.max(1.1, 0.7 / view.px) : 0;
        ctx.beginPath();
        for (; i < drawn.length && drawn[i].rank === rank; i++) {
          const d = drawn[i];
          // Round joints only where a road is wide enough on screen for a notch to show.
          const joints = (d.half + extra) * view.px > 3;
          for (const run of d.runs) {
            ribbonPath(run, d.half + extra);
            if (!joints) continue;
            discPath(run[0], d.half + extra);
            discPath(run[run.length - 1], d.half + extra);
          }
        }
        ctx.fillStyle = pass === 'casing' ? (minor ? theme.minorCasing : theme.casing) : (minor ? theme.minor : theme.road);
        ctx.fill();
      }
    }
    return drawn;
  }

  // Arrows along one-way streets, as in the map apps, pointing the way this vehicle may
  // go. Grey: blue is the road ahead and red is over the limit. Painted flat on the road,
  // so they stay where they are while the car drives over them, and shrink into the
  // distance with the road. They are laid out over the whole loaded map at once (see
  // arrows.js), again only when the tiles or the spacing change; an arrow that comes or
  // goes with a new layout fades rather than blinks.
  const layouts = new Map();   // gap -> arrows, for the pieces now loaded
  const shown = new Map();     // arrow key -> { a: the arrow, on: in the layout, alpha }
  let laidOut = null, fading = false;

  function layout(gap) {
    let list = layouts.get(gap);
    if (!list) {
      const roads = [];
      for (const piece of pool) {
        const way = travel(piece, bike);
        if (way) roads.push({ xy: xyOf(piece), way, rank: RANK[piece.highway] ?? 1, id: piece.id, piece });
      }
      layouts.set(gap, (list = placeArrows(roads, gap)));
    }
    return list;
  }

  function drawArrows(cam, drawn, dt) {
    // About 200 px apart on screen, at least 70 m, in doubling steps so they do not all
    // move during a pinch.
    const gap = 70 * Math.pow(2, Math.max(0, Math.round(Math.log2(200 / view.px / 70))));
    const list = layout(gap);
    if (list !== laidOut) {
      for (const e of shown.values()) e.on = false;
      for (const a of list) {
        const e = shown.get(a.key);
        if (e) { e.a = a; e.on = true; } else shown.set(a.key, { a, on: true, alpha: 0 });
      }
      laidOut = list;
    }
    // Only on roads drawn this frame: a side street is left out far away, and an arrow
    // must not lie on bare ground where it was.
    const roads = new Set(drawn.map((d) => d.piece));
    const k = 1 - Math.exp(-dt / 0.12);
    fading = false;
    ctx.fillStyle = theme.arrow;
    for (const [key, e] of shown) {
      e.alpha += ((e.on ? 1 : 0) - e.alpha) * k;
      if (!e.on && e.alpha < 0.01) { shown.delete(key); continue; }
      if (!e.on || e.alpha < 0.99) fading = true;
      const { road: { piece }, x, y, ux, uy } = e.a;
      if (!roads.has(piece)) continue;
      const [ax, az] = toCamera(cam, x, y);
      if (az < view.near + 8 || az > FAR) continue;
      const [sx, sy] = view.project(ax, az);
      if (sx < -40 || sx > W + 40 || sy < -40 || sy > H + 40) continue;
      // About half as long as the road is wide, up to a car's length.
      const rank = RANK[piece.highway] ?? 1;
      const len = Math.min(4.5, 0.9 * Math.max(roadWidth(piece) / 2, minHalf(rank)));
      const pts = ARROW.map(([t, w]) => view.project(...toCamera(cam, x + (ux * t + uy * w) * len, y + (uy * t - ux * w) * len)));
      // Far away it thins out rather than vanishing at a line.
      const size = Math.sqrt(Math.hypot(pts[3][0] - (pts[0][0] + pts[6][0]) / 2, pts[3][1] - (pts[0][1] + pts[6][1]) / 2) *
        Math.hypot(pts[2][0] - pts[4][0], pts[2][1] - pts[4][1]));
      const alpha = e.alpha * Math.max(0, Math.min(1, (size - 5) / 6));
      if (alpha < 0.02) continue;
      ctx.globalAlpha = alpha;
      path(pts);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  // The road ahead, tinted, fading out where the walk stopped at a junction it could not
  // see through: past there the app does not know which way the car will go.
  function drawAhead(cam) {
    const walk = scene.walk;
    if (!walk || walk.pts.length < 2) return;
    const xy = new Float64Array(walk.pts.length * 2);
    walk.pts.forEach(([lon, lat], i) => { const p = toXY(lon, lat); xy[2 * i] = p[0]; xy[2 * i + 1] = p[1]; });
    const runs = clipRuns(cam, xy);
    if (!runs.length) return;
    const half = Math.max((scene.piece ? roadWidth(scene.piece) : 8) / 2, minHalf(3));
    const endRun = runs[runs.length - 1];
    const end = view.project(...endRun[endRun.length - 1]);
    const car = view.project(0, 0);
    const g = ctx.createLinearGradient(0, car[1], 0, end[1]);
    const fadeFrom = walk.open ? 0.75 : 0.55;
    g.addColorStop(0, theme.ahead);
    g.addColorStop(fadeFrom, theme.ahead);
    g.addColorStop(1, theme.ahead.replace(/[\d.]+\)$/, '0)'));
    ctx.beginPath();
    for (const run of runs) ribbonPath(run, half - 0.6);
    ctx.fillStyle = g;
    ctx.fill();
  }

  // Lane lines, only where the map counts the lanes - never which lane goes where, which
  // OSM almost never says. Painted on the road like the arrows: each dash is measured from
  // its road's own start, so the dashes stay put and stream past as the car drives over
  // them, rather than being measured from the car and riding along with it. And every
  // counted road in view has them, so the street a turn leads into shows its lanes before
  // the car is on it. Near the car only, where they help.
  const LANES_NEAR = 220, DASH = 3, SPACE = 6;
  function drawLanes(cam, drawn) {
    if (view.px < 3) return;
    for (const d of drawn) {
      const p = d.piece, lanes = parseInt(p.lanes, 10);
      if (!(lanes > 1)) continue;
      const half = roadWidth(p) / 2, two = TWO_WAY(p);
      for (let k = 1; k < lanes; k++) {
        const off = -half + (k * 2 * half) / lanes;
        if (two && k === lanes / 2) {
          for (const run of d.runs) {
            const near = cutAt(run, LANES_NEAR);
            if (near.length > 1) dashes(near, off, null, theme.centre, 0.2);
          }
        } else paint(cam, xyOf(p), off, theme.lane, 0.16);
      }
    }
  }

  function paint(cam, xy, off, colour, width) {
    ctx.beginPath();
    const step = DASH + SPACE, zMin = view.near + 2;
    let s = 0;
    for (let i = 0; i + 3 < xy.length; i += 2) {
      const ax = xy[i], ay = xy[i + 1], bx = xy[i + 2], by = xy[i + 3];
      const len = Math.hypot(bx - ax, by - ay);
      if (!len) continue;
      const za = toCamera(cam, ax, ay)[1], zb = toCamera(cam, bx, by)[1];
      if (Math.min(za, zb) > LANES_NEAR || Math.max(za, zb) < zMin) { s += len; continue; }
      const ux = (bx - ax) / len, uy = (by - ay) / len, nx = uy, ny = -ux;
      // From the dash this stretch begins inside, so a dash carries on round a vertex.
      for (let t = -(s % step); t < len; t += step) {
        const t0 = Math.max(0, t), t1 = Math.min(len, t + DASH);
        if (t1 <= t0) continue;
        const quad = [[t0, -width], [t1, -width], [t1, width], [t0, width]].map(([u, w]) =>
          toCamera(cam, ax + ux * u + nx * (off + w), ay + uy * u + ny * (off + w)));
        if (quad.some(([, z]) => z < zMin || z > LANES_NEAR)) continue;
        const pts = quad.map(([x, z]) => view.project(x, z));
        ctx.moveTo(pts[0][0], pts[0][1]);
        for (let q = 1; q < 4; q++) ctx.lineTo(pts[q][0], pts[q][1]);
        ctx.closePath();
      }
      s += len;
    }
    ctx.fillStyle = colour;
    ctx.fill();
  }

  function cutAt(run, zMax) {
    const out = [run[0]];
    for (let i = 1; i < run.length; i++) {
      const a = run[i - 1], b = run[i];
      if (b[1] <= zMax) { out.push(b); continue; }
      if (a[1] < zMax) { const f = (zMax - a[1]) / (b[1] - a[1]); out.push([a[0] + (b[0] - a[0]) * f, zMax]); }
      break;
    }
    return out;
  }

  function dashes(pts, off, pattern, colour, width) {
    ctx.beginPath();
    let travelled = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (len === 0) continue;
      const ux = (b[0] - a[0]) / len, uz = (b[1] - a[1]) / len;
      const nx = uz, nz = -ux;
      const step = pattern ? pattern[0] + pattern[1] : len;
      let s = pattern ? (step - (travelled % step)) % step : 0;
      for (; s < len; s += step) {
        const e = Math.min(len, s + (pattern ? pattern[0] : len));
        const quad = [[s, -width], [e, -width], [e, width], [s, width]].map(([t, w]) =>
          view.project(a[0] + ux * t + nx * (off + w), a[1] + uz * t + nz * (off + w)));
        ctx.moveTo(quad[0][0], quad[0][1]);
        for (let q = 1; q < 4; q++) ctx.lineTo(quad[q][0], quad[q][1]);
        ctx.closePath();
      }
      travelled += len;
    }
    ctx.fillStyle = colour;
    ctx.fill();
  }

  // Haze toward the horizon, over where the loaded map runs out. It thins as the camera
  // rises, and there is none looking straight down.
  function drawFog() {
    const band = (view.yCar - view.yHor) * 0.42 * Math.min(1, view.zoom);
    if (!Number.isFinite(band) || view.yHor + band < 0) return;
    const g = ctx.createLinearGradient(0, view.yHor, 0, view.yHor + band);
    g.addColorStop(0, `${theme.fog}1)`);
    g.addColorStop(1, `${theme.fog}0)`);
    ctx.fillStyle = g;
    ctx.fillRect(0, view.yHor - 2, W, band + 2);
  }

  // The car: an arrow lying on the road, the way the map apps draw it.
  // car: where the car is in camera space; rel: its heading relative to the view, degrees.
  // It keeps its size on screen whatever the zoom, like the map apps' arrow.
  function drawCar(car, rel) {
    if (car[1] < view.near + 2) return;
    const shape = [[0, 4.2], [2.7, -3.0], [0, -1.5], [-2.7, -3.0]];
    const r = (rel * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r);
    const k = 1 / view.zoom;
    const at = (pts, grow = 0) => pts.map(([x, z]) => {
      const gx = x * k * (1 + grow), gz = z * k * (1 + grow);
      return view.project(car[0] + gx * c + gz * s, car[1] - gx * s + gz * c);
    });
    ctx.save();
    ctx.shadowColor = theme.shadow; ctx.shadowBlur = 14; ctx.shadowOffsetY = 4;
    path(at(shape, 0.24)); ctx.fillStyle = theme.puckRim; ctx.fill();
    ctx.restore();
    path(at(shape)); ctx.fillStyle = theme.puck; ctx.fill();
  }

  // Where the car is, facing nowhere yet: the plain location dot, not an arrow that would
  // claim a direction.
  function drawDot(car) {
    if (car[1] < view.near + 2) return;
    const [x, y] = view.project(car[0], car[1]);
    ctx.save();
    ctx.shadowColor = theme.shadow; ctx.shadowBlur = 12; ctx.shadowOffsetY = 3;
    ctx.beginPath(); ctx.arc(x, y, 12, 0, Math.PI * 2); ctx.fillStyle = theme.puckRim; ctx.fill();
    ctx.restore();
    ctx.beginPath(); ctx.arc(x, y, 8.5, 0, Math.PI * 2); ctx.fillStyle = theme.puck; ctx.fill();
  }

  function settle(dt) {
    const k = 1 - Math.exp(-dt / ease), to = rest();
    user.x -= user.x * k; user.y -= user.y * k; user.turn -= user.turn * k; user.tilt -= user.tilt * k;
    user.lift += (to.lift - user.lift) * k;
    user.zoom = Math.exp(Math.log(user.zoom) + (Math.log(to.zoom) - Math.log(user.zoom)) * k);
    raw = user.zoom;
    if (Math.hypot(user.x, user.y) < 0.3 && Math.abs(user.turn) < 0.3 && Math.abs(user.zoom / to.zoom - 1) < 0.004 && Math.abs(user.tilt) < 0.3 && Math.abs(user.lift - to.lift) < 0.004) {
      Object.assign(user, { x: 0, y: 0, turn: 0, tilt: 0 }, to);
      back = false;
    }
  }

  function path(pts) {
    ctx.beginPath();
    pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
    ctx.closePath();
  }

  // Signs shrink with distance, but gently: at 300 m a sign is still a sign, not a dot.
  const signSize = (f) => Math.max(26, Math.min(66, 70 * Math.pow(f, 0.55)));

  // cam places the signs; car is the car's own camera, which says how far ahead each one
  // is, whichever way the map has been moved.
  function drawBoards(cam, car, now) {
    const list = [];
    for (const b of boards.values()) {
      const [x, z] = toCamera(cam, b.x, b.y);
      const ahead = cam === car ? z : toCamera(car, b.x, b.y)[1];
      if (ahead < -25 || z < view.near + 2 || z > FAR) continue;
      list.push({ b, x, z, ahead });
    }
    // Nearest first, so a farther sign that would land on a nearer one is lifted above it
    // on a taller pole, the way plates stack on a real signpost.
    list.sort((a, c) => a.z - c.z);
    rects.clear();
    const placed = [], jobs = [];
    for (const { b, x, z, ahead } of list) {
      const [sx, sy, f] = view.project(x, z);
      const age = now - b.born;
      // Passed: it slides away behind the car. Dropped while still ahead (the road ahead
      // turned out different): it fades where it stands, quickly.
      const leaving = b.gone != null && ahead > 5 ? Math.max(0, 1 - (now - b.gone) / 0.3) : 1;
      if (leaving === 0) continue;
      const alpha = Math.min(1, age / 0.35) * (ahead < 0 ? Math.max(0, 1 + ahead / 25) : 1) * leaving;
      const pop = age < 0.6 ? 1 - 0.35 * Math.exp(-age * 9) * Math.cos(age * 14) : 1;
      // From high up a sign is a marker on a map, not a post at the roadside, so it is
      // drawn smaller, down to about 60%.
      const size = signSize(f) * pop * Math.min(1, 0.4 + 0.6 * Math.sqrt(view.zoom));
      const tall = b.kind === 'light' ? size * 1.08 : size;
      // The box a sign takes: the plate plus the distance label hanging under it.
      const below = ahead > 12 ? 44 : 6;
      let pole = size * 0.85;
      let top = sy - pole - tall;
      const left = sx - size / 2, right = sx + size / 2 + (ahead > 12 ? 64 : 0);
      for (const r of placed) {
        if (left < r.right && right > r.left && top < r.bottom && top + tall + below > r.top) {
          top = r.top - 6 - tall - below;
          pole = sy - top - tall;
        }
      }
      placed.push({ left, right, top, bottom: top + tall + below });
      jobs.push({ b, ahead, sx, sy, size, tall, pole, alpha });
    }
    // Paint far to near, so near things sit in front.
    for (const j of jobs.reverse()) {
      const { b, ahead, sx, sy, size, tall, pole, alpha } = j;
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = theme.pole; ctx.lineWidth = Math.max(1.5, size * 0.06);
      ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(sx, sy - pole); ctx.stroke();
      const cy = sy - pole - tall / 2;
      if (b.kind === 'limit') { drawLimitSign(sx, cy, size, b.max); rects.set(b.max, { x: sx - size / 2, y: cy - size / 2, size }); }
      else drawLamp(sx, cy, size);
      if (ahead > 12) distancePill(sx, cy + tall / 2 + 20, size, Math.max(10, Math.round(ahead / 10) * 10));
      ctx.globalAlpha = 1;
    }
  }

  function drawLimitSign(x, y, size, max) {
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.18)'; ctx.shadowBlur = size * 0.12; ctx.shadowOffsetY = size * 0.04;
    ctx.beginPath(); ctx.arc(x, y, size / 2, 0, Math.PI * 2); ctx.fillStyle = '#D92B34'; ctx.fill();
    ctx.restore();
    ctx.beginPath(); ctx.arc(x, y, size * 0.37, 0, Math.PI * 2); ctx.fillStyle = '#FFFFFF'; ctx.fill();
    ctx.fillStyle = '#15161A';
    ctx.font = `800 ${Math.round(size * (max >= 100 ? 0.34 : 0.42))}px ${FONT}`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(String(max), x, y + size * 0.03);
  }

  // Monochrome on purpose: a red lamp on this screen would read as "you are speeding".
  function drawLamp(x, y, size) {
    const w = size * 0.5, h = size * 1.08, r = w * 0.32;
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.2)'; ctx.shadowBlur = size * 0.12; ctx.shadowOffsetY = size * 0.04;
    roundRect(x - w / 2, y - h / 2, w, h, r); ctx.fillStyle = theme.housing; ctx.fill();
    ctx.restore();
    ctx.fillStyle = theme.lamp;
    for (let k = -1; k <= 1; k++) { ctx.beginPath(); ctx.arc(x, y + k * h * 0.29, w * 0.27, 0, Math.PI * 2); ctx.fill(); }
  }

  function distancePill(x, y, size, metresAway) {
    const text = `${metresAway} m`;
    const fs = Math.round(Math.max(11, Math.min(15, size * 0.24)));
    ctx.font = `700 ${fs}px ${FONT}`;
    const w = ctx.measureText(text).width + fs * 0.9, h = fs * 1.55;
    const px = x + size * 0.18, py = y - h / 2;
    roundRect(px, py, w, h, h / 2); ctx.fillStyle = theme.pill; ctx.fill();
    ctx.fillStyle = theme.pillInk; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText(text, px + fs * 0.45, py + h / 2 + 0.5);
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }

  return {
    resize,
    setTheme(name) { theme = THEMES[name] || THEMES.light; },

    // Called at each fix. lights and limits carry { at: [lon, lat], bearing }; the
    // renderer stands them on the right shoulder of the road ahead.
    // at: the car's [lon, lat]. walk is null while the direction of travel is unknown.
    setScene({ pieces, at, walk = null, piece, lights = [], limits = [] }, now) {
      if (!origin && at) { origin = at; m = metresPerDegree(origin[1]); }
      if (!origin) return;
      // A fresh list at every fix, but the pieces in it only change when a tile arrives or
      // the car moves on into another: only then are the arrows laid out again.
      if (pieces.length !== pool.length || pieces[0] !== pool[0] || pieces[pieces.length - 1] !== pool[pool.length - 1]) layouts.clear();
      pool = pieces; poolAt = at;
      scene = { pieces: [], walk, piece };
      gather(1100, 550);
      const half = piece ? roadWidth(piece) / 2 : 5;
      // One lamp per junction: a junction is often mapped as a signal node per approach.
      const lamps = [];
      for (const l of lights) if (!lamps.length || l.dist - lamps[lamps.length - 1].dist > 45) lamps.push(l);
      const items = [
        ...lamps.map((l) => ({ id: `l${l.id}`, kind: 'light', at: l.at, bearing: l.bearing })),
        // A change starting under the car is the badge's news, not the shoulder's.
        ...limits.filter((l) => l.dist > 15).map((l) => ({ id: `s${l.value.max}@${l.at[0].toFixed(5)},${l.at[1].toFixed(5)}`, kind: 'limit', max: l.value.max, at: l.at, bearing: l.bearing })),
      ];
      const seen = new Set();
      for (const it of items) {
        seen.add(it.id);
        const [x0, y0] = toXY(it.at[0], it.at[1]);
        const b = ((it.bearing ?? 0) * Math.PI) / 180;
        // Right of the direction of travel: east when heading north.
        const off = half + 2.2;
        const x = x0 + Math.cos(b) * off, y = y0 - Math.sin(b) * off;
        const old = boards.get(it.id);
        boards.set(it.id, { ...it, x, y, born: old && !old.gone ? old.born : now, seen: now, gone: null });
      }
      for (const [id, b] of boards) {
        if (seen.has(id)) continue;
        if (b.gone == null) b.gone = now;
        if (now - b.seen > 6) boards.delete(id);
      }
    },

    draw(pose, now, dt = 0) {
      // Follows its box: rotation, the stylesheet arriving late, a split-screen resize.
      const [bw, bh] = box();
      if (!view || bw !== W || bh !== H) resize();
      const step = Math.min(dt, 0.05);
      if (back) settle(step); else animate(step);
      const toPark = parked ? 1 : 0;
      parkness += (toPark - parkness) * (1 - Math.exp(-step / ease));
      if (Math.abs(toPark - parkness) < 0.002) parkness = toPark;
      view = viewFor(user);
      dirty = false;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawGround();
      if (!pose || !origin) return;
      const oriented = pose.bearing != null;
      // The first real heading swings the view round from north-up rather than snapping;
      // after that the motion module has already smoothed it.
      const target = oriented ? pose.bearing : 0;
      const turn = viewBearing == null ? 0 : ((target - viewBearing + 540) % 360) - 180;
      viewBearing = viewBearing == null || Math.abs(turn) < 25 ? target : (viewBearing + turn * (1 - Math.exp(-dt / 0.45)) + 360) % 360;
      const piece = scene.piece;
      const shift = oriented && piece && TWO_WAY(piece) ? roadWidth(piece) / 4 : 0;
      carShift += (shift - carShift) * (1 - Math.exp(-dt / 0.6));
      const [cx, cy] = toXY(pose.lon, pose.lat);
      const b = (viewBearing * Math.PI) / 180;
      // The camera sits on the car, including its lane, so the road opens up to its left -
      // unless it has been moved by hand while stopped.
      const carX = cx + Math.cos(b) * carShift, carY = cy - Math.sin(b) * carShift;
      carCam = { x: carX, y: carY, bearing: viewBearing };
      const moved = this.moved();
      const cam = moved ? handCam() : carCam;
      // Overhead at rest sees more than the driving view does, as moving it by hand does.
      if ((moved || user.lift > 0.004) && poolAt) widen();
      const car = toCamera(cam, carX, carY);
      const drawn = drawRoads(cam);
      drawArrows(cam, drawn, dt);
      if (oriented) drawAhead(cam);
      drawLanes(cam, drawn);
      drawFog();
      if (oriented) { drawCar(car, -user.turn); drawBoards(cam, carCam, now); } else drawDot(car);
    },

    // Looking around while stopped, the way a map app does it. Screen points are in the
    // canvas's CSS pixels, and the ground under a finger stays under that finger.
    // A finger landing stops whatever the map was still doing.
    hold() { coast = null; glide = null; back = false; raw = user.zoom; },
    // One finger moved from a to b.
    pan,
    // Two fingers: their centre moved from a to b while they spread by ratio and turned
    // the map by turn degrees.
    pinch(a, b, ratio, turn = 0) {
      if (!(ratio > 0) || !Number.isFinite(ratio)) return;
      lookDown();
      raw *= ratio;
      move(a, b, { zoom: soft(raw) / user.zoom, turn });
      focus = b;
    },
    // Two fingers sliding up tip the camera toward the horizon, down toward straight down.
    tilt(deg) { if (view) { lookDown(); move([view.cx, view.yCar], [view.cx, view.yCar], { tilt: deg }); } },
    // A double tap, or a two-finger tap: an animated zoom about that point.
    zoomAt(at, ratio) { lookDown(); coast = null; glide = { zoom: clampZoom(user.zoom * ratio), at }; },
    // The fingers let go while moving: the map carries on and slows down.
    fling(v, zoom, at) {
      const speed = Math.hypot(v[0], v[1]), cap = Math.min(1, 5000 / (speed || 1));
      const k = Math.max(-5, Math.min(5, zoom));
      coast = speed > 60 || Math.abs(k) > 0.3 ? { v: [v[0] * cap, v[1] * cap], zoom: k, at } : null;
    },
    // The fingers are off: past a zoom limit, spring back inside it.
    end() {
      const z = clampZoom(user.zoom);
      if (z !== user.zoom) { coast = null; glide = { zoom: z, at: focus || [view.cx, view.yCar] }; }
    },

    // Spring back to following the car.
    recenter() { coast = null; glide = null; rising = false; ease = 0.14; if (this.moved()) back = true; },
    // Parked or driving: where the camera rests, swung to rather than cut. instant places it
    // there at once, for a screen that opens already parked.
    park(on, instant = false) {
      parked = !!on;
      coast = null; glide = null; rising = false;
      ease = 0.3;
      if (instant) { Object.assign(user, { x: 0, y: 0, turn: 0, tilt: 0 }, rest()); raw = user.zoom; parkness = parked ? 1 : 0; back = false; return; }
      back = true;
    },
    setBike(on) { if (bike !== !!on) { bike = !!on; layouts.clear(); } },
    // Away from where the camera rests.
    moved() {
      const to = rest();
      return Math.hypot(user.x, user.y) > 1 || Math.abs(user.turn) > 1 || Math.abs(user.zoom / to.zoom - 1) > 0.02 ||
        Math.abs(user.tilt) > 1 || Math.abs(user.lift - to.lift) > 0.004 || glide != null || rising;
    },
    // Something on screen is changing without the car moving: a finger, momentum, an
    // animated zoom, the swing overhead or between parked and driving, the spring back, or
    // arrows fading.
    busy() { return dirty || back || rising || glide != null || coast != null || fading || parkness !== (parked ? 1 : 0); },

    // Where the shoulder sign for this limit was last drawn, so the badge can take it over.
    signRect(max) { return rects.get(max) || null; },
  };
}
