// The road view: the roads around the car on a tilted ground plane, the road ahead picked
// out, and what is coming standing on the right shoulder, where Vietnamese signs stand.
//
// It draws only what the map says. Lane lines appear only where the map counts lanes, the
// road ahead is picked out only as far as it obviously goes, and a shoulder sign only
// where the badge is going to change.
import { makeView, toCamera } from './src/view.js';
import { metresPerDegree } from './src/geo.js';

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
    lane: 'rgba(72, 78, 90, 0.42)', centre: '#E2A710', fog: 'rgba(234, 238, 243, ',
    puck: '#007AFF', puckRim: '#FFFFFF', shadow: 'rgba(20, 30, 50, 0.22)',
    pill: 'rgba(255, 255, 255, 0.94)', pillInk: '#1C1C1E', housing: '#2C2C2E', lamp: '#E5E5EA', pole: '#8E9199',
  },
  dark: {
    sky: ['#030406', '#0E1014'], ground: ['#0E1014', '#16181C'],
    casing: '#24272D', road: '#3A3D45', minorCasing: '#202227', minor: '#2C2E34',
    ahead: 'rgba(10, 132, 255, 0.20)', aheadEdge: 'rgba(64, 156, 255, 0.75)',
    lane: 'rgba(235, 235, 245, 0.34)', centre: '#B98A0E', fog: 'rgba(14, 16, 20, ',
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

  // Capped at the window: before the stylesheet applies, a canvas's box follows its own
  // pixel size, and growing one to fit the other never stops.
  const box = () => options.size || [Math.min(canvas.clientWidth, innerWidth) || 1, Math.min(canvas.clientHeight, innerHeight) || 1];

  function resize() {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    [W, H] = box();
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    // Landscape on a dashboard mount: the numbers take the right-hand column, so the road
    // is centred in what is left.
    const wide = W > H * 1.2;
    view = makeView({ width: W, height: H, ...(wide ? { carX: 0.3, carY: 0.7, horizonY: 0.12 } : {}), ...options.view });
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

  function drawGround() {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    const hz = view.yHor / H;
    g.addColorStop(0, theme.sky[0]);
    g.addColorStop(Math.max(0, hz - 0.02), theme.sky[1]);
    g.addColorStop(Math.min(1, hz + 0.02), theme.ground[0]);
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
      if (maxZ < view.near || minZ > 1600) continue;
      const reach = visibleHalf(Math.max(0, maxZ));
      if (minX > reach || maxX < -reach) continue;
      const rank = RANK[piece.highway] ?? 1;
      if (rank <= 1 && minZ > 500) continue;
      const runs = clipRuns(cam, xy);
      if (runs.length) drawn.push({ piece, runs, rank, half: roadWidth(piece) / 2 });
    }
    drawn.sort((a, b) => a.rank - b.rank);
    // All casings first, then all surfaces, so junctions merge instead of overlapping;
    // each class of road in one fill.
    for (const pass of ['casing', 'surface']) {
      for (let i = 0; i < drawn.length;) {
        const rank = drawn[i].rank, minor = rank <= 1;
        const extra = pass === 'casing' ? 1.1 : 0;
        ctx.beginPath();
        for (; i < drawn.length && drawn[i].rank === rank; i++) {
          const d = drawn[i];
          for (const run of d.runs) {
            ribbonPath(run, d.half + extra);
            discPath(run[0], d.half + extra);
            discPath(run[run.length - 1], d.half + extra);
          }
        }
        ctx.fillStyle = pass === 'casing' ? (minor ? theme.minorCasing : theme.casing) : (minor ? theme.minor : theme.road);
        ctx.fill();
      }
    }
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
    const half = (scene.piece ? roadWidth(scene.piece) : 8) / 2;
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

  // Lane lines, only where the map counts the lanes; near the car only, where they help.
  function drawLanes(cam) {
    const walk = scene.walk;
    if (!walk) return;
    for (const leg of walk.legs) {
      const p = leg.piece;
      const lanes = parseInt(p.lanes, 10);
      if (!(lanes > 1)) continue;
      const pts = walk.pts.filter((_, i) => walk.dist[i] >= leg.start - 0.01 && walk.dist[i] <= leg.end + 0.01);
      if (pts.length < 2) continue;
      const xy = new Float64Array(pts.length * 2);
      pts.forEach(([lon, lat], i) => { const q = toXY(lon, lat); xy[2 * i] = q[0]; xy[2 * i + 1] = q[1]; });
      const half = roadWidth(p) / 2;
      const two = TWO_WAY(p);
      for (const run of clipRuns(cam, xy)) {
        const near = cutAt(run, 220);
        if (near.length < 2) continue;
        for (let k = 1; k < lanes; k++) {
          const off = -half + (k * 2 * half) / lanes;
          const centre = two && k === lanes / 2;
          dashes(near, off, centre ? null : [3, 6], centre ? theme.centre : theme.lane, centre ? 0.2 : 0.16);
        }
      }
    }
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

  function drawFog() {
    const g = ctx.createLinearGradient(0, view.yHor, 0, view.yHor + (view.yCar - view.yHor) * 0.42);
    g.addColorStop(0, `${theme.fog}1)`);
    g.addColorStop(1, `${theme.fog}0)`);
    ctx.fillStyle = g;
    ctx.fillRect(0, view.yHor - 2, W, (view.yCar - view.yHor) * 0.42 + 2);
  }

  // The car: an arrow lying on the road, the way the map apps draw it.
  function drawCar() {
    const shape = [[0, 4.2], [2.7, -3.0], [0, -1.5], [-2.7, -3.0]];
    const at = (pts, grow = 0) => pts.map(([x, z]) => view.project(x * (1 + grow), z * (1 + grow)));
    ctx.save();
    ctx.shadowColor = theme.shadow; ctx.shadowBlur = 14; ctx.shadowOffsetY = 4;
    path(at(shape, 0.24)); ctx.fillStyle = theme.puckRim; ctx.fill();
    ctx.restore();
    path(at(shape)); ctx.fillStyle = theme.puck; ctx.fill();
  }

  function path(pts) {
    ctx.beginPath();
    pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
    ctx.closePath();
  }

  // Signs shrink with distance, but gently: at 300 m a sign is still a sign, not a dot.
  const signSize = (f) => Math.max(26, Math.min(66, 70 * Math.pow(f, 0.55)));

  function drawBoards(cam, now) {
    const list = [];
    for (const b of boards.values()) {
      const [x, z] = toCamera(cam, b.x, b.y);
      if (z < -25 || z > 1600) continue;
      list.push({ b, x, z });
    }
    // Nearest first, so a farther sign that would land on a nearer one is lifted above it
    // on a taller pole, the way plates stack on a real signpost.
    list.sort((a, c) => a.z - c.z);
    rects.clear();
    const placed = [], jobs = [];
    for (const { b, x, z } of list) {
      const [sx, sy, f] = view.project(x, z);
      const age = now - b.born;
      // Passed: it slides away behind the car. Dropped while still ahead (the road ahead
      // turned out different): it fades where it stands, quickly.
      const leaving = b.gone != null && z > 5 ? Math.max(0, 1 - (now - b.gone) / 0.3) : 1;
      if (leaving === 0) continue;
      const alpha = Math.min(1, age / 0.35) * (z < 0 ? Math.max(0, 1 + z / 25) : 1) * leaving;
      const pop = age < 0.6 ? 1 - 0.35 * Math.exp(-age * 9) * Math.cos(age * 14) : 1;
      const size = signSize(f) * pop;
      const tall = b.kind === 'light' ? size * 1.08 : size;
      // The box a sign takes: the plate plus the distance label hanging under it.
      const below = z > 12 ? 44 : 6;
      let pole = size * 0.85;
      let top = sy - pole - tall;
      const left = sx - size / 2, right = sx + size / 2 + (z > 12 ? 64 : 0);
      for (const r of placed) {
        if (left < r.right && right > r.left && top < r.bottom && top + tall + below > r.top) {
          top = r.top - 6 - tall - below;
          pole = sy - top - tall;
        }
      }
      placed.push({ left, right, top, bottom: top + tall + below });
      jobs.push({ b, z, sx, sy, size, tall, pole, alpha });
    }
    // Paint far to near, so near things sit in front.
    for (const j of jobs.reverse()) {
      const { b, z, sx, sy, size, tall, pole, alpha } = j;
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = theme.pole; ctx.lineWidth = Math.max(1.5, size * 0.06);
      ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(sx, sy - pole); ctx.stroke();
      const cy = sy - pole - tall / 2;
      if (b.kind === 'limit') { drawLimitSign(sx, cy, size, b.max); rects.set(b.max, { x: sx - size / 2, y: cy - size / 2, size }); }
      else drawLamp(sx, cy, size);
      if (z > 12) distancePill(sx, cy + tall / 2 + 20, size, Math.max(10, Math.round(z / 10) * 10));
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
    setScene({ pieces, walk, piece, lights = [], limits = [] }, now) {
      if (!origin && walk) { origin = walk.pts[0]; m = metresPerDegree(origin[1]); }
      if (!origin) return;
      // A city-centre block of tiles holds ~20,000 pieces; only the ones within reach of
      // the view are worth transforming every frame.
      const at = walk ? walk.pts[0] : origin;
      const k = metresPerDegree(at[1]);
      const rx = 1100 / k.x, ry = 1100 / k.y, mx = 550 / k.x, my = 550 / k.y;
      const near = [];
      for (const p of pieces) {
        let e = extent.get(p);
        if (!e) {
          e = [Infinity, Infinity, -Infinity, -Infinity];
          for (const [x, y] of p.c) { if (x < e[0]) e[0] = x; if (y < e[1]) e[1] = y; if (x > e[2]) e[2] = x; if (y > e[3]) e[3] = y; }
          extent.set(p, e);
        }
        const minor = (RANK[p.highway] ?? 1) <= 1;
        const ex = minor ? mx : rx, ey = minor ? my : ry;
        if (e[2] < at[0] - ex || e[0] > at[0] + ex || e[3] < at[1] - ey || e[1] > at[1] + ey) continue;
        near.push(p);
      }
      scene = { pieces: near, walk, piece };
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
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawGround();
      if (!pose || !origin || pose.bearing == null) return;
      const piece = scene.piece;
      const target = piece && TWO_WAY(piece) ? roadWidth(piece) / 4 : 0;
      carShift += (target - carShift) * (1 - Math.exp(-dt / 0.6));
      const [cx, cy] = toXY(pose.lon, pose.lat);
      const b = (pose.bearing * Math.PI) / 180;
      // The camera sits on the car, including its lane, so the road opens up to its left.
      const cam = { x: cx + Math.cos(b) * carShift, y: cy - Math.sin(b) * carShift, bearing: pose.bearing };
      drawRoads(cam);
      drawAhead(cam);
      drawLanes(cam);
      drawFog();
      drawCar();
      drawBoards(cam, now);
    },

    // Where the shoulder sign for this limit was last drawn, so the badge can take it over.
    signRect(max) { return rects.get(max) || null; },
  };
}
