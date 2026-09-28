// What a driver has taught the app: speed signs the map does not have, learned from the
// answer to "Biển ghi bao nhiêu?" after a Sai, and how a taught sign is applied on the road.
//
// The answers are kept as given and the signs are worked out from them on every load. A
// mistake in the working-out is then fixed in code, never by repairing stored data, and
// answers from several phones combine by joining the lists.
//
// A lesson holds a place and a heading, never an OSM way id: a new map extract cannot
// orphan it, and the taught layer stays a database of its own beside the OSM one.
import { metres, bearing, angleBetween, metresPerDegree } from './geo.js';
import { walkAhead, snapped } from './path.js';
import { matchLive } from './live.js';

export const NEAR = 60;     // m: answers this close, facing the same way, are about one sign
export const FACING = 50;   // degrees apart two headings may be and still go the same way
export const ON_ROAD = 30;  // m from the road a stretch follows, and still on it
export const REACH = 2000;  // m of road looked along for where a sign stops applying
const BEHIND = 5;           // m behind a step's start a sign may be and still be passed on it

// A speed sign stops applying at the next junction (QCVN 41:2024, 26.8) - but meeting a
// ngõ, ngách, hẻm or a driveway is not one (26.9). On this map those are the residential,
// living_street and service roads, so for a sign below the law only these classes end it:
// missing a real junction holds the lower number too long, which fines nobody, while
// ending at a driveway would announce the law's 60 inside a 30.
const ROADS = new Set([
  'motorway', 'motorway_link', 'trunk', 'trunk_link', 'primary', 'primary_link',
  'secondary', 'secondary_link', 'tertiary', 'tertiary_link', 'unclassified',
]);

// lesson: { id, t, kind, at: [lon, lat], heading, max?, placed?, sign?, lesson? }
//   sign       a sign reading `max` stands at `at`, for traffic heading `heading`
//   gone       the taught sign `sign` is not there
//   ended      the taught sign `sign` no longer applied at `at`
//   still      the taught sign `sign` still applied at `at`
//   withdrawn  the driver takes back their answer `lesson`, as if never given
//
// Withdrawn is not gone. Gone says something about the road - the sign is not there - and
// once answers from several phones are joined it would overrule the others' too. Withdrawn
// only takes back one's own answer, so a mistaken tap on this phone cannot erase a sign
// someone else saw.
//
// Returns [{ id, at, heading, max, seen, placed, t, marks: [{ kind, at }], lessons: [id] }],
// t the newest answer about it and lessons every answer it was worked out from.
export function signsFrom(lessons) {
  const taken = new Set(lessons.filter((l) => l.kind === 'withdrawn').map((l) => l.lesson));
  const signs = [];
  const same = (l) => (s) => metres(s.at, l.at) <= NEAR && angleBetween(s.heading, l.heading) <= FACING;
  for (const l of [...lessons].sort((a, b) => Date.parse(a.t) - Date.parse(b.t))) {
    if (l.kind === 'withdrawn' || taken.has(l.id)) continue;
    if (l.kind === 'sign') {
      const s = signs.find(same(l));
      if (!s) { signs.push({ id: l.id, at: l.at, heading: l.heading, max: l.max, seen: 1, placed: !!l.placed, t: l.t, marks: [], lessons: [l.id] }); continue; }
      // The newest answer wins: signs get changed, and roadworks signs come and go.
      s.seen = s.max === l.max ? s.seen + 1 : 1;
      s.max = l.max;
      s.t = l.t;
      s.lessons.push(l.id);
      // Where the driver dragged the sign beats where they happened to tap.
      if (l.placed || !s.placed) Object.assign(s, { at: l.at, heading: l.heading, placed: !!l.placed });
    } else if (l.kind === 'gone') {
      const i = signs.findIndex((s) => s.id === l.sign);
      if (i >= 0) signs.splice(i, 1);
    } else {
      const s = signs.find((x) => x.id === l.sign);
      if (s) { s.marks.push({ kind: l.kind, at: l.at }); s.lessons.push(l.id); }
    }
  }
  return signs;
}

// Taking back a taught sign: one withdrawal for each answer it was worked out from, its
// marks included. Appended, never deleted, so the list stays the one a server could merge.
export function withdrawal(sign, t) {
  return sign.lessons.map((id) => ({ id: `w${id}`, t, kind: 'withdrawn', lesson: id }));
}

// The taught sign the car has just gone past, stepping from road point a to b: its foot
// lies along the step, beside the road, and it faces the way the car is going. Where two
// steps meet at an angle, a sign on the outside of the bend projects past the end of one
// and before the start of the next, so a step also takes a sign a few metres behind it.
export function passed(signs, a, b) {
  if (!a || !b) return null;
  const m = metresPerDegree(a[1]);
  const dx = (b[0] - a[0]) * m.x, dy = (b[1] - a[1]) * m.y, len = Math.hypot(dx, dy);
  if (len < 1) return null;
  const heading = bearing(a, b);
  for (const s of signs) {
    if (angleBetween(s.heading, heading) > FACING) continue;
    const sx = (s.at[0] - a[0]) * m.x, sy = (s.at[1] - a[1]) * m.y;
    const u = (sx * dx + sy * dy) / len, off = Math.abs(sx * dy - sy * dx) / len;
    if (u > -BEHIND && u <= len && off <= ON_ROAD) return s;
  }
  return null;
}

// Point p against a path.js walk: how far along it (s), how far off it, and the road's
// bearing there. Only the stretch from lo to hi is searched, so on a hairpin the car is
// not placed on the far side of the bend.
export function along(walk, p, lo = -Infinity, hi = Infinity) {
  const { pts, dist } = walk;
  let best = null;
  for (let i = 0; i < pts.length - 1; i++) {
    if (dist[i + 1] < lo || dist[i] > hi) continue;
    const a = pts[i], b = pts[i + 1], m = metresPerDegree(a[1]);
    const dx = (b[0] - a[0]) * m.x, dy = (b[1] - a[1]) * m.y, len2 = dx * dx + dy * dy;
    const px = (p[0] - a[0]) * m.x, py = (p[1] - a[1]) * m.y;
    const t = len2 ? Math.max(0, Math.min(1, (px * dx + py * dy) / len2)) : 0;
    const off = Math.hypot(px - t * dx, py - t * dy);
    if (!best || off < best.off) best = { s: dist[i] + t * (dist[i + 1] - dist[i]), off, bearing: bearing(a, b) };
  }
  return best;
}

// Distances along the walk where another road meets it. any: every road counts, not only
// the classes that make a junction in law.
export function crossings(walk, pieces, any = false) {
  const own = new Set(walk.legs.map((l) => l.piece.id));
  const index = new Map();
  walk.pts.forEach((p, i) => { if (i > 0) index.set(`${p[0]},${p[1]}`, i); });
  const hits = new Set();
  for (const pc of pieces) {
    if (own.has(pc.id) || !(any || ROADS.has(pc.highway))) continue;
    for (const q of pc.c) {
      const i = index.get(`${q[0]},${q[1]}`);
      if (i != null) hits.add(i);
    }
  }
  return [...hits].sort((a, b) => a - b).map((i) => walk.dist[i]);
}

// The taught signs standing beside a walk, facing the way it goes, nearest first.
export function signsOn(walk, signs, start = 0) {
  const out = [];
  for (const sign of signs) {
    const p = along(walk, sign.at);
    if (p && p.off <= ON_ROAD && p.s > start && angleBetween(p.bearing, sign.heading) <= FACING) out.push({ sign, s: p.s });
  }
  return out.sort((a, b) => a.s - b.s);
}

// Where a taught sign stops applying, in metres along a walk that passes it at `start`.
// law: the limit the map and statute give there, which decides which junctions end it.
// Returns { end, open, why }: open when nothing ended it before the walk ran out, so all
// that is known is that it runs at least that far. why: 'junction', 'sign' (the next taught
// sign), 'mark' (where the driver said it had ended) or 'open'.
export function stretchEnd(walk, sign, { pieces, law, signs = [], start = 0 }) {
  const on = (p) => p && p.off <= ON_ROAD && p.s >= start;
  // The driver's own marks, oldest first, each overruling whatever older one it contradicts.
  let lo = start, hi = Infinity;
  for (const k of sign.marks) {
    const p = along(walk, k.at);
    if (!on(p)) continue;
    if (k.kind === 'ended') { hi = p.s; if (lo >= hi) lo = start; }
    else { lo = Math.max(lo, p.s); if (hi <= lo) hi = Infinity; }
  }
  let end = hi, why = 'mark';
  // A new speed sign ends the one before it (26.8).
  const next = signsOn(walk, signs.filter((o) => o.id !== sign.id), start + NEAR)[0];
  if (next && next.s < end) { end = next.s; why = 'sign'; }
  const any = law == null || sign.max > law;
  const j = crossings(walk, pieces, any).find((d) => d > lo);
  if (j != null && j < end) { end = j; why = 'junction'; }
  const last = walk.dist[walk.dist.length - 1];
  // A walk that stopped short did so at a junction it could not see through: an end.
  if (end === Infinity && !walk.open) { end = last; why = 'junction'; }
  return end === Infinity ? { end: last, open: true, why: 'open' } : { end, open: false, why };
}

// Where a taught sign holds, worked out with nobody driving past it: from its foot along
// the road it faces, to where stretchEnd says it stops. For showing the stretch parked - on
// the review card as the answer is given, and in the list of taught signs.
// lawOf(piece): the limit the map and statute give on a piece, which decides which
// junctions end the sign. Returns { walk, end, open, why, piece, cross } or null off the
// map; cross is the road met where it ends, when that is a junction.
export function reachOf(sign, pieces, { lawOf = () => null, signs = [], bike = false } = {}) {
  const fix = { lon: sign.at[0], lat: sign.at[1], acc: ON_ROAD, heading: sign.heading, speed: 10 };
  const m = matchLive(pieces, fix, null, bike);
  if (!m) return null;
  const walk = walkAhead(pieces, m, sign.heading, REACH, snapped(m), bike);
  const law = lawOf(m.piece);
  const r = stretchEnd(walk, sign, { pieces, law, signs });
  const cross = r.why === 'junction' ? crossingAt(walk, pieces, r.end) : null;
  return { walk, ...r, piece: m.piece, cross };
}

// The road that meets a walk d metres along it, named ones first and the biggest of those.
// The road carrying on under its own name is not the road met, only more of the same.
function crossingAt(walk, pieces, d) {
  const i = walk.dist.findIndex((x) => Math.abs(x - d) < 0.5);
  if (i < 0) return null;
  const [lon, lat] = walk.pts[i];
  const own = new Set(walk.legs.map((l) => l.piece.id));
  const names = new Set(walk.legs.map((l) => l.piece.name).filter(Boolean));
  const rank = [...ROADS];
  const meet = pieces.filter((p) => !own.has(p.id) && !names.has(p.name) && p.c.some((q) => q[0] === lon && q[1] === lat));
  meet.sort((a, b) => !!b.name - !!a.name || (rank.indexOf(a.highway) + 1 || 99) - (rank.indexOf(b.highway) + 1 || 99));
  return meet[0] || null;
}

// How far into its stretch the car is at road point p, or null once it has turned off the
// road the stretch follows or come to its end. st: { walk, end, s }.
export function onStretch(st, p) {
  const q = along(st.walk, p, st.s - 50, st.s + 300);
  if (!q || q.off > ON_ROAD || q.s >= st.end) return null;
  return q.s;
}

// The direction of travel at p, from the fixes that led up to a report.
export function headingAt(trail, p, fallback = null) {
  let best = null;
  for (let i = 0; i < trail.length - 1; i++) {
    const a = trail[i], b = trail[i + 1];
    if (metres(a, b) < 2) continue;
    const q = along({ pts: [a, b], dist: [0, 1] }, p);
    if (!best || q.off < best.off) best = q;
  }
  return best ? Math.round(best.bearing) : fallback;
}

// The lesson in a reviewed report, or null. Its id is the report's, so answering again
// replaces it rather than adding a second opinion from the same moment.
//
// r.cause is explain.js's reading of the answer; r.taught is the taught sign in force at
// the tap, r.left one that had stopped applying shortly before it.
export function lessonFrom(r) {
  const a = r.answer;
  if (a == null || a === 'unsure') return null;
  const tap = [r.lon, r.lat];
  const at = r.signAt ? [r.signAt.lon, r.signAt.lat] : tap;
  const trail = [...(r.window || []).map((w) => [w.lon, w.lat]), tap];
  const base = { id: r.id, t: r.reviewedAt || r.t };
  const mark = (kind, sign, p) => ({ ...base, kind, sign, at: p, heading: headingAt(trail, p, r.heading) });
  switch (r.cause) {
    case 'gone': return { ...base, kind: 'gone', sign: r.taught.id };
    case 'ended': return mark('ended', r.taught.id, at);
    case 'still': return mark('still', r.left.id, tap);
    // The app had worked the number out and not yet shown it, or had it right.
    case 'lag': case 'same': case 'none': return null;
  }
  // Any other number is a sign someone read, whatever explain.js makes of why the app was
  // wrong: a zone or map-shape suspect is still a sign standing there.
  if (typeof a !== 'number') return null;
  return { ...base, kind: 'sign', at, heading: headingAt(trail, at, r.heading), max: a, placed: !!r.signAt };
}
